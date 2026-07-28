/**
 * Live push over WebSocket (#27) — `GET /api/v1/stream`.
 *
 * Everything an integration can already read by polling, pushed instead:
 * console lines, the stats sample, run-state changes and timeline events.
 *
 * ## Why this file re-implements the guards
 *
 * `server.on('upgrade')` does not go through `handlePanel`. None of the checks
 * that make the REST surface safe — key resolution, the per-key token bucket,
 * the origin allowlist — run on an upgrade unless they run here. In particular
 * **browsers do not apply CORS to WebSocket**: a page on any origin can open one
 * to localhost and, if the server accepts it, read whatever it streams. The
 * `Origin` check below is the only thing standing there, so it is not optional.
 *
 * ## Auth
 *
 * A credential arrives one of two ways:
 *
 * - `Authorization: Bearer …` / `X-API-Key: …` — for anything that can set
 *   headers, which is every non-browser client.
 * - the `Sec-WebSocket-Protocol` header, as `msms.v1, msms-key.<secret>` or
 *   `msms.v1, msms-token.<session>` — for browsers, whose WebSocket API cannot
 *   set headers at all. Key secrets are `msms_<uuid>.<base64url>`, and every
 *   character of that is a valid HTTP token character, so they ride here
 *   unencoded.
 *
 * Deliberately **not** a query parameter. A URL is the one part of a request
 * that gets written to access logs, kept in browser history and forwarded in a
 * `Referer` — which is a poor place for a long-lived credential.
 */
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { createHash } from 'node:crypto'
import { log } from '../logger'
import { processManager } from '../core/processManager'
import { eventBus } from '../core/events'
import { getServer } from '../core/serverRegistry'
import * as apikeys from './apikeys'
import { principalForKey, resolveSession, can, type AuthUser } from './auth'
import { spendKeyToken } from './rate'
import { isOriginAllowed } from '@shared/apikeys'
import {
  WsParser,
  WS_CLOSE,
  WS_GUID,
  encodeClose,
  encodeJson,
  encodePing,
  encodePong
} from '@shared/wsframe'
import type { ServerEvent, ServerRuntimeStatus, ServerStats } from '@shared/types'

export const WS_PATH = '/api/v1/stream'
export const WS_SUBPROTOCOL = 'msms.v1'

/** Streams a client can subscribe to. All of them are reads. */
export const WS_STREAMS = ['console', 'stats', 'status', 'events'] as const
export type WsStream = (typeof WS_STREAMS)[number]

/**
 * Sockets one process will hold open. A stream costs a socket and a share of
 * every broadcast, so the ceiling is on the server rather than on politeness.
 */
const MAX_CONNECTIONS = 64
/** …and per credential, so one integration cannot take the whole ceiling. */
const MAX_PER_PRINCIPAL = 8

/**
 * How much unwritten data may pile up before the connection is dropped.
 *
 * `socket.write()` returning false does not stop anything — the data is queued
 * in memory. A subscriber to a chatty console that stops reading is therefore an
 * unbounded allocation any authenticated client can start, deliberately or by
 * suspending a laptop. Past this the connection is closed with 1013 rather than
 * silently dropping messages: a console feed with invisible holes in it is worse
 * than one that ends and says why.
 */
const MAX_BUFFERED_BYTES = 1024 * 1024

const PING_INTERVAL_MS = 30_000
/** Two missed pings. */
const PONG_TIMEOUT_MS = 75_000

interface Client {
  socket: Duplex
  parser: WsParser
  user: AuthUser
  principal: string
  /** serverId -> subscribed streams. */
  subs: Map<string, Set<WsStream>>
  lastPong: number
  closed: boolean
}

const clients = new Set<Client>()
let wired = false
let pingTimer: NodeJS.Timeout | null = null

// ---------------------------------------------------------------- handshake

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function acceptValue(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64')
}

/** Refuse before the protocol switch, in the only language it can still speak. */
function refuse(socket: Duplex, code: number, text: string): void {
  socket.write(
    `HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    () => socket.destroy()
  )
}

interface Credential {
  user: AuthUser
  principal: string
}

/**
 * Resolve the caller. Returns null for "no usable credential" — the caller
 * answers 401 without saying which of the several ways it failed.
 */
function authenticate(req: IncomingMessage, protocols: string[]): Credential | null {
  const auth = header(req, 'authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined
  const fromHeader = header(req, 'x-api-key') ?? (bearer && apikeys.looksLikeKey(bearer) ? bearer : undefined)
  const fromProto = protocols.find((p) => p.startsWith('msms-key.'))?.slice('msms-key.'.length)
  const keySecret = fromHeader ?? fromProto
  if (keySecret) {
    const key = apikeys.resolveKey(keySecret)
    if (!key) return null
    // The same bucket the REST path spends from: opening streams is not a way
    // around the request limit.
    if (!spendKeyToken(key.id).allowed) return null
    apikeys.touchKey(key.id)
    return { user: principalForKey(key), principal: 'key:' + key.id }
  }
  const sessionToken =
    bearer ?? protocols.find((p) => p.startsWith('msms-token.'))?.slice('msms-token.'.length)
  if (!sessionToken) return null
  const user = resolveSession(sessionToken)
  return user ? { user, principal: 'user:' + user.username } : null
}

/**
 * Wire the upgrade handler onto the admin listener.
 *
 * `allowedOrigins` is read lazily rather than captured: the operator can change
 * it in settings while the server is running, and a captured copy would keep
 * admitting an origin they had just removed.
 */
export function attachWs(httpServer: Server, allowedOrigins: () => string[]): void {
  httpServer.on('upgrade', (req, socket) => {
    const duplex = socket as Duplex
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== WS_PATH) return refuse(duplex, 404, 'Not Found')
      if ((req.method ?? 'GET') !== 'GET') return refuse(duplex, 405, 'Method Not Allowed')
      if (header(req, 'sec-websocket-version') !== '13') {
        return refuse(duplex, 426, 'Upgrade Required')
      }
      const key = header(req, 'sec-websocket-key')
      if (!key) return refuse(duplex, 400, 'Bad Request')

      // Browsers do not apply CORS to WebSocket. Without this a page on any
      // origin could open a stream to a panel running on the visitor's machine.
      const origin = header(req, 'origin')
      if (origin && !isOriginAllowed(origin, allowedOrigins())) {
        return refuse(duplex, 403, 'Forbidden')
      }

      const protocols = (header(req, 'sec-websocket-protocol') ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      const cred = authenticate(req, protocols)
      if (!cred) return refuse(duplex, 401, 'Unauthorized')

      if (clients.size >= MAX_CONNECTIONS) return refuse(duplex, 503, 'Service Unavailable')
      let mine = 0
      for (const c of clients) if (c.principal === cred.principal) mine++
      if (mine >= MAX_PER_PRINCIPAL) return refuse(duplex, 429, 'Too Many Requests')

      // Only ever echo a subprotocol the client offered, and only the one that
      // names this protocol — echoing back the credential token would put it in
      // a response header for no reason.
      const speaks = protocols.includes(WS_SUBPROTOCOL)
      const lines = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptValue(key)}`
      ]
      if (speaks) lines.push(`Sec-WebSocket-Protocol: ${WS_SUBPROTOCOL}`)
      duplex.write(lines.join('\r\n') + '\r\n\r\n')
      // A stream of small JSON messages is exactly the traffic Nagle's algorithm
      // delays: without this a console line can sit in the kernel for 40ms
      // waiting for company. Typed as Duplex by the upgrade signature, but it is
      // always a Socket in practice — hence the guard rather than a cast.
      if ('setNoDelay' in duplex) (duplex as unknown as { setNoDelay(v: boolean): void }).setNoDelay(true)
      register(duplex, cred)
    } catch (err) {
      log.warn('ws upgrade failed:', err)
      try {
        duplex.destroy()
      } catch {
        /* already gone */
      }
    }
  })
  wire()
  startKeepalive()
}

// ------------------------------------------------------------------ clients

function register(socket: Duplex, cred: Credential): void {
  const client: Client = {
    socket,
    parser: new WsParser(),
    user: cred.user,
    principal: cred.principal,
    subs: new Map(),
    lastPong: Date.now(),
    closed: false
  }
  clients.add(client)
  socket.on('data', (chunk: Buffer) => {
    for (const ev of client.parser.push(new Uint8Array(chunk))) {
      if (ev.type === 'fail') {
        close(client, ev.code, ev.reason)
        return
      }
      if (ev.type === 'close') {
        close(client, WS_CLOSE.normal, '')
        return
      }
      if (ev.type === 'ping') {
        write(client, encodePong(ev.data))
        continue
      }
      if (ev.type === 'pong') {
        client.lastPong = Date.now()
        continue
      }
      if (ev.type === 'binary') {
        // The protocol is JSON. A binary frame is not a message this server has
        // any way to interpret, and guessing at one would be worse.
        close(client, WS_CLOSE.unsupportedData, 'text-frames-only')
        return
      }
      handleMessage(client, ev.text)
    }
  })
  socket.on('error', () => drop(client))
  socket.on('close', () => drop(client))
  send(client, {
    type: 'hello',
    protocol: WS_SUBPROTOCOL,
    streams: WS_STREAMS,
    user: client.user.username,
    role: client.user.role,
    maxPayloadBytes: 64 * 1024,
    pingIntervalMs: PING_INTERVAL_MS
  })
}

function drop(client: Client): void {
  client.closed = true
  clients.delete(client)
}

function close(client: Client, code: number, reason: string): void {
  if (client.closed) return
  client.closed = true
  clients.delete(client)
  try {
    client.socket.write(encodeClose(code, reason), () => client.socket.destroy())
  } catch {
    client.socket.destroy()
  }
}

function write(client: Client, frame: Uint8Array): void {
  if (client.closed) return
  try {
    client.socket.write(frame)
  } catch {
    drop(client)
    return
  }
  // Checked after the write, because that is when the queue has grown. A client
  // that has stopped reading is dropped rather than allowed to hold an
  // ever-larger buffer on the server's heap.
  if (client.socket.writableLength > MAX_BUFFERED_BYTES) {
    log.warn(`ws: dropping a backed-up subscriber (${client.principal})`)
    close(client, WS_CLOSE.tryAgainLater, 'too-slow')
  }
}

function send(client: Client, payload: unknown): void {
  write(client, encodeJson(payload))
}

// ----------------------------------------------------------------- messages

interface ClientMessage {
  op?: string
  serverId?: string
  streams?: unknown
}

function handleMessage(client: Client, text: string): void {
  let msg: ClientMessage
  try {
    msg = JSON.parse(text) as ClientMessage
  } catch {
    send(client, { type: 'error', error: 'invalid-json' })
    return
  }
  const op = msg.op ?? ''
  if (op === 'ping') {
    send(client, { type: 'pong', at: Date.now() })
    return
  }
  if (op !== 'subscribe' && op !== 'unsubscribe') {
    send(client, { type: 'error', error: 'unknown-op', op })
    return
  }
  const serverId = typeof msg.serverId === 'string' ? msg.serverId : ''
  if (!serverId || !getServer(serverId)) {
    send(client, { type: 'error', error: 'server-not-found', serverId })
    return
  }
  // Every stream here is a read of the same data `view` already grants over
  // HTTP, so `view` is the gate. Nothing on this socket mutates anything: a
  // subscriber cannot start a server or run a command, by construction, because
  // there is no op for it.
  if (!can(client.user, serverId, 'view')) {
    send(client, { type: 'error', error: 'forbidden', need: 'view', serverId })
    return
  }
  const asked = Array.isArray(msg.streams) ? msg.streams : []
  const wanted = WS_STREAMS.filter((s) => asked.includes(s))
  if (!wanted.length) {
    send(client, { type: 'error', error: 'no-valid-streams', streams: WS_STREAMS })
    return
  }
  if (op === 'subscribe') {
    const set = client.subs.get(serverId) ?? new Set<WsStream>()
    for (const s of wanted) set.add(s)
    client.subs.set(serverId, set)
    send(client, { type: 'subscribed', serverId, streams: [...set] })
  } else {
    const set = client.subs.get(serverId)
    if (set) {
      for (const s of wanted) set.delete(s)
      if (!set.size) client.subs.delete(serverId)
    }
    send(client, { type: 'unsubscribed', serverId, streams: [...(client.subs.get(serverId) ?? [])] })
  }
}

// --------------------------------------------------------------- broadcast

function broadcast(serverId: string, stream: WsStream, payload: Record<string, unknown>): void {
  if (!clients.size) return
  const frame = encodeJson({ ...payload, type: stream, serverId })
  for (const client of [...clients]) {
    if (!client.subs.get(serverId)?.has(stream)) continue
    // Re-checked at send time, not only at subscribe time. Permissions change
    // while a socket is open, and a stream that keeps flowing after the scope
    // was revoked is a revocation that did not happen.
    if (!can(client.user, serverId, 'view')) {
      client.subs.delete(serverId)
      send(client, { type: 'error', error: 'forbidden', need: 'view', serverId })
      continue
    }
    write(client, frame)
  }
}

/** Sources are wired once per process, not once per connection. */
function wire(): void {
  if (wired) return
  wired = true

  processManager.on('log', (e: { serverId: string; line: { ts: number; line: string; stream: string } }) => {
    broadcast(e.serverId, 'console', { ts: e.line.ts, line: e.line.line, stream: e.line.stream })
  })
  processManager.on('status', (s: ServerRuntimeStatus) => {
    broadcast(s.id, 'status', { status: s.status, pid: s.pid, exitCode: s.exitCode })
  })
  processManager.on('stats', (s: ServerStats) => {
    broadcast(s.id, 'stats', {
      cpu: s.cpu,
      memoryMB: s.memoryMB,
      tps: s.tps,
      mspt: s.mspt,
      players: s.players,
      bridge: s.bridge,
      uptimeMs: s.uptimeMs
    })
  })
  eventBus.on('event', (e: ServerEvent) => {
    broadcast(e.serverId, 'events', { event: e })
  })
}

/**
 * The keepalive is per-listener, unlike the source wiring above: `closeAllWs`
 * clears it, and a web server that is started again must get it back. Folding
 * it into the once-only block meant a restarted panel had streams with no
 * liveness check at all.
 */
function startKeepalive(): void {
  if (pingTimer) return
  pingTimer = setInterval(sweep, PING_INTERVAL_MS)
  // Must not be the reason an otherwise idle app stays awake.
  pingTimer.unref?.()
}

function sweep(): void {
  const now = Date.now()
  for (const client of [...clients]) {
    if (now - client.lastPong > PONG_TIMEOUT_MS) {
      // A half-open TCP connection looks exactly like an idle healthy one until
      // something asks it to answer.
      close(client, WS_CLOSE.goingAway, 'no-pong')
      continue
    }
    write(client, encodePing())
  }
}

/** Close every stream — the web server is stopping. */
export function closeAllWs(): void {
  for (const client of [...clients]) close(client, WS_CLOSE.goingAway, 'server-stopping')
  clients.clear()
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
  // `wired` stays true: the source listeners are process-wide and re-attaching
  // them on the next start would deliver every line twice.
}

/** Test seam. */
export function wsClientCount(): number {
  return clients.size
}
