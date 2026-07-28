import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { createReadStream, existsSync } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'
import { getConfig } from '../config'
import { uploadsDir } from '../paths'
import { log } from '../logger'
import { listServers, getServer } from '../core/serverRegistry'
import * as registry from '../core/serverRegistry'
import * as files from '../core/serverFiles'
import type { JavaArgsConfig } from '@shared/types'
import { processManager } from '../core/processManager'
import { getPlayers } from '../core/players'
import * as playersMod from '../core/players'
import * as worldsMod from '../core/worlds'
import * as backupsMod from '../core/backups'
import {
  isModerationAction,
  isGamemode,
  isValidMcName,
  isValidWorldName,
  moderationAuditAction,
  needsConfirm,
  sanitizeCommandArg
} from '@shared/ops'
import type { PlayerInfo } from '@shared/types'
import { bridgeFresh, bridgePlayers } from '@shared/bridge'
import { heatmap, livePlayers, mapBounds, normalizeDimension } from '@shared/livemap'
import * as metrics from '../core/metrics'
import * as events from '../core/events'
import * as alerts from '../core/alerts'
import { extraScopesForAction } from '@shared/alerts'
import type { NewAlertRule } from '@shared/alerts'
import {
  analyze,
  ANALYSIS_EVENT_LIMIT,
  ANALYSIS_EVENT_TYPES,
  ANALYSIS_METRIC_LIMIT
} from '@shared/analysis'
import * as audit from '../core/audit'
import type { AuditSource } from '@shared/audit'
import * as economy from '../store/economy'
import * as site from './site'
import * as playerAuth from './playerAuth'
import { getPublicSiteHtml } from './publicSiteHtml'
import type { EconomyCategory, Product, SitePost } from '@shared/web'
import {
  initAuth,
  login,
  logout,
  resolveSession,
  principalForKey,
  can,
  scopesFor,
  visibleServerIds,
  type AuthUser
} from './auth'
import * as apikeys from './apikeys'
import {
  consumeToken,
  isOriginAllowed,
  newBucket,
  DEFAULT_KEY_LIMIT,
  type Bucket,
  type KeyServers
} from '@shared/apikeys'
import { getPanelHtml } from './panelHtml'
import { SCOPES } from '@shared/web'
import type { Scope, WebStatus, WebConfig } from '@shared/web'

let server: Server | null = null
let siteServer: Server | null = null

// ---- helpers ----
function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > 256 * 1024) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      raw += c
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Buffer a raw (binary) request body. Once it passes `maxBytes` we stop keeping
 * chunks — so memory stays bounded even for a chunked body with no
 * content-length — but keep reading to `end` so the caller can still answer a
 * clean 413 (destroying the socket mid-stream would surface as a reset instead).
 * Only an egregious overrun (>2x) gets the socket destroyed, to stop real abuse.
 * Used for image uploads; readBody is JSON-only + 256KB.
 */
function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxBytes) {
        tooBig = true
        if (size > maxBytes * 2) {
          reject(new Error('body-too-large'))
          req.destroy()
        }
        return
      }
      chunks.push(c)
    })
    req.on('end', () => (tooBig ? reject(new Error('body-too-large')) : resolve(Buffer.concat(chunks))))
    req.on('error', reject)
  })
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers['authorization']
  if (h && h.startsWith('Bearer ')) return h.slice(7)
  return undefined
}

// ---- API keys (#48) + safety rails (#50) ----

/**
 * The presented API key, if any. `X-API-Key` wins over `Authorization` so a
 * caller can hold a browser session and still drive the API as a key from the
 * same page. A bearer token only counts as a key when it is shaped like one -
 * otherwise a plain session token would be sent off to be hashed and refused.
 */
function apiKeyToken(req: IncomingMessage): string | undefined {
  const h = req.headers['x-api-key']
  const direct = Array.isArray(h) ? h[0] : h
  if (direct) return direct
  const b = bearer(req)
  return b && apikeys.looksLikeKey(b) ? b : undefined
}

/**
 * One token bucket per key, in memory. Deliberately not persisted: a restart
 * clearing the buckets is the correct behaviour for a burst brake, and writing
 * a file on every request would cost more than the limit saves.
 */
const keyBuckets = new Map<string, Bucket>()

function keyRateOk(keyId: string, res: ServerResponse): boolean {
  const now = Date.now()
  const b = keyBuckets.get(keyId) ?? newBucket(DEFAULT_KEY_LIMIT, now)
  const r = consumeToken(b, DEFAULT_KEY_LIMIT, now)
  keyBuckets.set(keyId, r.bucket)
  if (r.allowed) return true
  res.setHeader('Retry-After', String(r.retryAfterSec))
  sendJson(res, 429, { error: 'rate-limited', retryAfter: r.retryAfterSec })
  return false
}

/**
 * Per-IP budget for the unauthenticated public API (#50). Far larger than the
 * per-key one because a single visitor's browser polls the storefront, and
 * because a shared NAT puts a whole household behind one address.
 */
const PUBLIC_IP_LIMIT = { capacity: 300, refillPerSec: 10 }
const ipBuckets = new Map<string, Bucket>()

function publicRateOk(ip: string, res: ServerResponse): boolean {
  const now = Date.now()
  const b = ipBuckets.get(ip) ?? newBucket(PUBLIC_IP_LIMIT, now)
  const r = consumeToken(b, PUBLIC_IP_LIMIT, now)
  ipBuckets.set(ip, r.bucket)
  // A public listener sees unbounded distinct addresses, so this map has to be
  // swept. A bucket that has refilled to capacity is indistinguishable from a
  // fresh one, which makes dropping it free rather than a reset of someone's
  // budget.
  if (ipBuckets.size > 4096) {
    for (const [k, v] of ipBuckets) {
      if (v.tokens >= PUBLIC_IP_LIMIT.capacity) ipBuckets.delete(k)
    }
  }
  if (r.allowed) return true
  res.setHeader('Retry-After', String(r.retryAfterSec))
  sendJson(res, 429, { error: 'rate-limited', retryAfter: r.retryAfterSec })
  return false
}

/** Test seam: the buckets survive a `stopWebServer()`, which smoke runs rely on. */
export function _resetRateLimits(): void {
  keyBuckets.clear()
  ipBuckets.clear()
}

/**
 * Answer the CORS handshake for a cross-origin API call.
 *
 * Returns `true` when the request was a preflight and has been fully answered.
 * A disallowed origin gets **no** `Access-Control-Allow-*` header at all, which
 * is what makes the browser refuse it - there is no wildcard branch here, by
 * design: this surface is authenticated with long-lived credentials.
 */
function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin
  const allowed = isOriginAllowed(origin, webCfg().apiOrigins ?? [])
  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
    res.setHeader('Access-Control-Max-Age', '600')
    // Responses differ per origin; without this a shared cache could hand one
    // site the headers minted for another.
    res.setHeader('Vary', 'Origin')
  }
  if ((req.method ?? 'GET') === 'OPTIONS') {
    res.writeHead(allowed ? 204 : 403)
    res.end()
    return true
  }
  return false
}

// ---- login rate limiting ----
const loginAttempts = new Map<string, { count: number; ts: number }>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const rec = loginAttempts.get(ip)
  if (!rec || now - rec.ts > 15 * 60 * 1000) {
    loginAttempts.set(ip, { count: 0, ts: now })
    return false
  }
  return rec.count >= 8
}
function noteFail(ip: string): void {
  const rec = loginAttempts.get(ip) ?? { count: 0, ts: Date.now() }
  rec.count++
  loginAttempts.set(ip, rec)
}

function serverSummary(user: AuthUser, id: string): Record<string, unknown> | null {
  const s = getServer(id)
  if (!s) return null
  const st = processManager.getStatus(id)
  // scopesFor, not user.perms: this array is what the panel builds its UI from,
  // so reading only the DIRECT scopes would show a role-granted user the server
  // with every tab and control hidden - authorised by the API, locked out by
  // the interface.
  const scopes: Scope[] = user.role === 'owner' ? [...SCOPES] : scopesFor(user, id)
  // Live bits the panel shows in the list without a second request.
  const rt = processManager.getRuntime(id)
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    mcVersion: s.mcVersion,
    status: st.status,
    startedAt: st.startedAt,
    players: rt ? { online: rt.players.online, max: rt.players.max } : undefined,
    scopes
  }
}

const IMG_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

function serveUpload(path: string, res: ServerResponse): void {
  const name = decodeURIComponent(path.slice('/uploads/'.length))
  const dir = resolve(uploadsDir())
  const file = resolve(join(dir, name))
  // Path-traversal sandbox + raster allowlist (no SVG).
  if (file !== dir && !file.startsWith(dir + sep)) {
    res.writeHead(404)
    res.end()
    return
  }
  const type = IMG_TYPES[extname(file).toLowerCase()]
  if (!type || !existsSync(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' })
  createReadStream(file).pipe(res)
}

async function handlePublic(
  path: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
  ip: string
): Promise<void> {
  const sub = path.slice('/api/public/'.length)

  if (sub === 'site' && method === 'GET') return sendJson(res, 200, site.publicSite())
  if (sub === 'status' && method === 'GET')
    return sendJson(res, 200, { servers: site.publicSite().servers })

  if (sub === 'register/start' && method === 'POST') {
    const b = (await readBody(req).catch(() => ({}))) as { mcName?: string }
    const r = await playerAuth.registerStart(site.siteServerId(), (b.mcName ?? '').trim(), ip)
    return sendJson(res, r.ok ? 200 : r.error === 'rate-limited' ? 429 : 400, r)
  }
  if (sub === 'register/verify' && method === 'POST') {
    const b = (await readBody(req).catch(() => ({}))) as {
      mcName?: string
      code?: string
      password?: string
    }
    const r = playerAuth.verify((b.mcName ?? '').trim(), b.code ?? '', b.password ?? '')
    if (r.ok) {
      audit.record({ source: 'public', action: 'account.register', actor: r.mcName, ok: true, ip, serverId: site.siteServerId() })
    }
    return sendJson(res, r.ok ? 200 : 400, r.ok ? { token: r.token, mcName: r.mcName } : r)
  }
  if (sub === 'login' && method === 'POST') {
    const b = (await readBody(req).catch(() => ({}))) as { mcName?: string; password?: string }
    const r = playerAuth.login((b.mcName ?? '').trim(), b.password ?? '')
    audit.record({ source: 'public', action: 'login', actor: (b.mcName ?? '').trim() || 'unknown', ok: r.ok, ip })
    if (!r.ok) return sendJson(res, 401, { error: 'invalid-credentials' })
    return sendJson(res, 200, { token: r.token, mcName: r.mcName })
  }
  if (sub === 'logout' && method === 'POST') {
    const t = bearer(req)
    if (t) playerAuth.logoutPlayer(t)
    return sendJson(res, 200, { ok: true })
  }

  const sid = site.siteServerId()
  if (sub === 'store' && method === 'GET') {
    if (!sid || !getServer(sid)) return sendJson(res, 200, { currency: '', products: [] })
    // Anonymous visitors get the catalogue; a signed-in one also gets their own
    // purchase counts, so a per-player limit can be shown as reached instead of
    // only discovered when the purchase is refused (#81).
    const who = playerAuth.resolvePlayerSession(bearer(req))
    return sendJson(res, 200, economy.publicStore(sid, who?.mcName))
  }

  // ---- player-token-only endpoints (never satisfied by an admin token) ----
  const player = playerAuth.resolvePlayerSession(bearer(req))
  if (sub === 'store/balance' && method === 'GET') {
    if (!player) return sendJson(res, 401, { error: 'login-required' })
    return sendJson(res, 200, {
      mcName: player.mcName,
      balance: sid ? economy.getBalance(sid, player.mcName) : 0,
      currency: sid ? economy.publicStore(sid).currency : ''
    })
  }
  if (sub === 'store/txns' && method === 'GET') {
    if (!player) return sendJson(res, 401, { error: 'login-required' })
    return sendJson(res, 200, { txns: sid ? economy.getTxns(sid, player.mcName) : [] })
  }
  if (sub === 'store/buy' && method === 'POST') {
    if (!player) return sendJson(res, 401, { error: 'login-required' })
    if (!sid) return sendJson(res, 400, { error: 'no-server' })
    const b = (await readBody(req).catch(() => ({}))) as { productId?: string }
    const result = economy.purchase(sid, player.mcName, b.productId ?? '')
    audit.record({
      source: 'public',
      action: 'purchase',
      actor: player.mcName,
      ok: result.ok,
      ip,
      serverId: sid,
      target: b.productId ?? '',
      ...(result.ok ? {} : { detail: result.error })
    })
    return sendJson(res, result.ok ? 200 : result.error === 'insufficient' ? 402 : 400, result)
  }

  return sendJson(res, 404, { error: 'not-found' })
}

// ---- PUBLIC WEBSITE listener (separate port; no admin routes exist here) ----
async function handleSite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'
  const ip = req.socket.remoteAddress ?? 'unknown'

  if (!path.startsWith('/api/')) {
    if (path === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
    if (path.startsWith('/uploads/')) return serveUpload(path, res)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(getPublicSiteHtml())
    return
  }
  if (path.startsWith('/api/public/')) {
    // Unauthenticated and internet-reachable when the operator opts into LAN,
    // so it is limited by address (#50). The panel API is limited per key
    // instead, which is the sharper signal once there is a credential.
    if (!publicRateOk(ip, res)) return
    return handlePublic(path, method, req, res, ip)
  }
  sendJson(res, 404, { error: 'not-found' })
}

// ---- ADMIN PANEL routing ----
async function handlePanel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'
  const ip = req.socket.remoteAddress ?? 'unknown'

  // Cross-origin handshake first: a preflight carries no credentials, so it has
  // to be answered before anything asks who the caller is.
  if (path.startsWith('/api/') && applyCors(req, res)) return

  // ---- static (admin panel listener) ----
  if (!path.startsWith('/api/')) {
    if (path === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
    // Sandboxed raster uploads (for post image previews in the panel).
    if (path.startsWith('/uploads/')) return serveUpload(path, res)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(getPanelHtml())
    return
  }

  // ---- public auth endpoints ----
  if (path === '/api/login' && method === 'POST') {
    if (rateLimited(ip)) return sendJson(res, 429, { error: 'too-many-attempts' })
    const body = (await readBody(req).catch(() => ({}))) as { username?: string; password?: string }
    const result = login(body.username ?? '', body.password ?? '')
    if (!result) {
      noteFail(ip)
      audit.record({ source: 'webpanel', action: 'login', actor: body.username || 'unknown', ok: false, ip })
      return sendJson(res, 401, { error: 'invalid-credentials' })
    }
    audit.record({ source: 'webpanel', action: 'login', actor: result.user.username, ok: true, ip })
    const ids = visibleServerIds(result.user)
    const servers = (ids === 'all' ? listServers().map((s) => s.id) : ids)
      .map((id) => serverSummary(result.user, id))
      .filter(Boolean)
    return sendJson(res, 200, {
      token: result.token,
      user: { username: result.user.username, role: result.user.role },
      servers
    })
  }

  // ---- everything else requires a session, or an API key (#48) ----
  let user: AuthUser | null
  const keyToken = apiKeyToken(req)
  if (keyToken) {
    const key = apikeys.resolveKey(keyToken)
    // Unknown, revoked, expired and wrong-secret all answer the same 401: the
    // response must not tell a caller which of those it got.
    if (!key) return sendJson(res, 401, { error: 'unauthorized' })
    if (!keyRateOk(key.id, res)) return
    apikeys.touchKey(key.id)
    user = principalForKey(key)
    // Mutations made by a machine credential are recorded. Reads are not:
    // an integration polling six endpoints would bury every human action in
    // the log, and the trail exists to answer "what changed, and who changed
    // it" - which a GET never answers.
    if (method !== 'GET') {
      audit.record({
        source: 'api',
        action: 'api.' + method.toLowerCase(),
        actor: user.username,
        target: path,
        ok: true,
        ip
      })
    }
  } else {
    user = resolveSession(bearer(req))
  }
  if (!user) return sendJson(res, 401, { error: 'unauthorized' })

  if (path === '/api/logout' && method === 'POST') {
    const tok = bearer(req)
    if (tok) logout(tok)
    return sendJson(res, 200, { ok: true })
  }

  if (path === '/api/me' && method === 'GET') {
    return sendJson(res, 200, { username: user.username, role: user.role, canAudit: user.canAudit ?? false })
  }

  if (path === '/api/servers' && method === 'GET') {
    const ids = visibleServerIds(user)
    const list = (ids === 'all' ? listServers().map((s) => s.id) : ids)
      .map((id) => serverSummary(user, id))
      .filter(Boolean)
    return sendJson(res, 200, { servers: list })
  }

  // ---- /api/servers/:id/... ----
  const m = path.match(/^\/api\/servers\/([^/]+)(?:\/(\w+))?$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    const sub = m[2]
    if (!getServer(id)) return sendJson(res, 404, { error: 'server-not-found' })

    const gate = (scope: Scope): boolean => {
      if (!can(user, id, scope)) {
        sendJson(res, 403, { error: 'forbidden', need: scope })
        return false
      }
      return true
    }

    if (!sub && method === 'GET') {
      if (!gate('view')) return
      return sendJson(res, 200, serverSummary(user, id))
    }
    if (sub === 'console' && method === 'GET') {
      if (!gate('view')) return
      const history = processManager.getLogHistory(id).slice(-250)
      return sendJson(res, 200, {
        lines: history.map((l) => ({ ts: l.ts, line: l.line, stream: l.stream })),
        status: processManager.getStatus(id).status
      })
    }
    // Performance analysis (#25): the same findings the desktop History tab
    // shows, computed server-side from the same three inputs. 'view' scope -
    // it is read-only advice about a server the user can already see.
    if (sub === 'analysis' && method === 'GET') {
      if (!gate('view')) return
      const server = getServer(id)
      if (!server) return sendJson(res, 404, { error: 'no-server' })
      const hours = Math.min(720, Math.max(1, Number(url.searchParams.get('hours')) || 24))
      const to = Date.now()
      const from = to - hours * 3600_000
      const series = metrics.query(id, { from, to, limit: ANALYSIS_METRIC_LIMIT })
      return sendJson(res, 200, {
        hours,
        findings: analyze({
          series,
          uptime: events.uptime(id, from, to),
          events: events.query(id, {
            from,
            to,
            types: ANALYSIS_EVENT_TYPES,
            limit: ANALYSIS_EVENT_LIMIT
          }).events,
          server: { type: server.type, java: server.java },
          from,
          to
        })
      })
    }
    // ---- alert rules (#24) ----
    // Base gate is 'settings'. A rule that DOES something when it fires also
    // demands that action's own scope - a stored auto-running console command
    // must not be creatable by someone who only holds 'settings'.
    if (sub === 'alerts' && method === 'GET') {
      if (!gate('settings')) return
      return sendJson(res, 200, { rules: alerts.listRules(id) })
    }
    if (sub === 'alerts' && method === 'POST') {
      if (!gate('settings')) return
      const b = (await readBody(req).catch(() => ({}))) as Partial<NewAlertRule> & { id?: string }
      // A DISABLED rule cannot execute anything, so it needs no action scope.
      // This is not a loophole, it is the safety valve: without it, a
      // settings-only admin who finds a runaway 'restart the server' rule would
      // be unable to switch it off, because turning it off would demand the
      // very permission they lack. Turning it back ON is still gated.
      const willRun = b.enabled !== false
      for (const need of willRun ? extraScopesForAction(b.action) : []) {
        if (!gate(need)) return
      }
      // serverId comes from the URL, never the body: otherwise 'settings' on
      // one server would let you write rules that act on another.
      const input = { ...b, serverId: id } as NewAlertRule
      if (!input.name || !input.metric) return sendJson(res, 400, { error: 'bad-rule' })
      try {
        let saved
        if (b.id) {
          const existing = alerts.listRules(id).find((r) => r.id === b.id)
          if (!existing) return sendJson(res, 404, { error: 'rule-not-found' })
          // Editing an existing rule INTO an action needs that action's scope
          // too - already checked above against the incoming body.
          saved = alerts.updateRule(b.id, { ...input, serverId: id })
        } else {
          saved = alerts.createRule(input)
        }
        // A rule that can run a command unattended is worth a trail entry -
        // the rule outlives the session that created it.
        audit.record({
          source: 'webpanel',
          action: b.id ? 'alert.update' : 'alert.create',
          actor: user.username,
          ok: true,
          ip,
          serverId: id,
          target: saved.name,
          detail: saved.action ? `${saved.metric} ${saved.comparison} ${saved.threshold} -> ${saved.action}` : `${saved.metric} ${saved.comparison} ${saved.threshold}`
        })
        return sendJson(res, 200, saved)
      } catch (e) {
        return sendJson(res, 400, { error: String((e as Error)?.message ?? e) })
      }
    }
    // DELETE, not POST /alerts/delete: the server-route regex above matches a
    // SINGLE path segment (`(?:\/(\w+))?`), so a nested path silently falls
    // through to the generic 404 instead of reaching this handler.
    if (sub === 'alerts' && method === 'DELETE') {
      if (!gate('settings')) return
      const ruleId = url.searchParams.get('ruleId') ?? ''
      const existing = alerts.listRules(id).find((r) => r.id === ruleId)
      if (!existing) return sendJson(res, 404, { error: 'rule-not-found' })
      alerts.deleteRule(existing.id)
      audit.record({
        source: 'webpanel',
        action: 'alert.delete',
        actor: user.username,
        ok: true,
        ip,
        serverId: id,
        target: existing.name
      })
      return sendJson(res, 200, { ok: true })
    }
    if (sub === 'power' && method === 'POST') {
      if (!gate('power')) return
      const b = (await readBody(req).catch(() => ({}))) as { action?: string }
      switch (b.action) {
        case 'start':
          await processManager.start(id).catch(() => {})
          break
        case 'stop':
          void processManager.stop(id)
          break
        case 'restart':
          void processManager.restart(id)
          break
        case 'kill':
          void processManager.kill(id)
          break
        default:
          return sendJson(res, 400, { error: 'bad-action' })
      }
      audit.record({ source: 'webpanel', action: 'server.' + b.action, actor: user.username, ok: true, ip, serverId: id })
      return sendJson(res, 200, { ok: true })
    }
    if (sub === 'command' && method === 'POST') {
      if (!gate('console')) return
      const b = (await readBody(req).catch(() => ({}))) as { command?: string }
      const cmd = (b.command ?? '').trim()
      if (!cmd) return sendJson(res, 400, { error: 'empty-command' })
      try {
        processManager.sendCommand(id, cmd)
      } catch {
        audit.record({ source: 'webpanel', action: 'command.run', actor: user.username, ok: false, ip, serverId: id, target: cmd })
        return sendJson(res, 409, { error: 'server-not-running' })
      }
      audit.record({ source: 'webpanel', action: 'command.run', actor: user.username, ok: true, ip, serverId: id, target: cmd })
      return sendJson(res, 200, { ok: true })
    }
    if (sub === 'players' && method === 'GET') {
      if (!gate('players') && !can(user, id, 'view')) {
        return sendJson(res, 403, { error: 'forbidden', need: 'players' })
      }
      const players = await getPlayers(id)
      return sendJson(res, 200, { players })
    }
    // Timeline: ?from&to (ms epoch) &types=a,b &limit=
    if (sub === 'events' && method === 'GET') {
      if (!gate('view')) return
      const now = Date.now()
      const typesParam = url.searchParams.get('types')
      return sendJson(res, 200, {
        ...events.query(id, {
          from: Number(url.searchParams.get('from')) || now - 7 * 86400_000,
          to: Number(url.searchParams.get('to')) || now,
          types: typesParam ? (typesParam.split(',') as events.ServerEventType[]) : undefined,
          limit: Math.min(500, Number(url.searchParams.get('limit')) || 100)
        })
      })
    }
    // Uptime over a window, derived from the timeline: ?from&to
    if (sub === 'uptime' && method === 'GET') {
      if (!gate('view')) return
      const now = Date.now()
      const from = Number(url.searchParams.get('from')) || now - 86400_000
      const to = Number(url.searchParams.get('to')) || now
      return sendJson(res, 200, events.uptime(id, from, to, now))
    }
    // Live map feed (#26): positions, bounds and a chunk heatmap in one call,
    // so a client redraws from a single response instead of stitching three.
    if (sub === 'map' && method === 'GET') {
      if (!gate('view')) return
      const rt = processManager.getRuntime(id)
      const now = Date.now()
      const all = rt ? livePlayers(bridgePlayers(rt.bridge, now)) : []
      // One dimension at a time: overworld and nether coordinates share an axis
      // but not a scale, and drawing them on one canvas puts a player in the
      // nether 8x closer to spawn than they are.
      const dim = normalizeDimension(url.searchParams.get('dim') ?? 'overworld')
      const players = all.filter((p) => p.dim === dim)
      const cell = Math.min(512, Math.max(1, Number(url.searchParams.get('cell')) || 16))
      return sendJson(res, 200, {
        // `bridge: false` is the honest answer when the plugin is absent or
        // silent — an empty player list on its own reads as "nobody online".
        bridge: rt ? bridgeFresh(rt.bridge, now) : false,
        dimension: dim,
        dimensions: [...new Set(all.map((p) => p.dim))].sort(),
        players,
        bounds: mapBounds(players),
        heatmap: heatmap(players, cell).slice(0, 500),
        cell,
        at: now
      })
    }
    // Performance history: ?from&to (ms epoch) &res=10s|1m|1h &limit=
    if (sub === 'metrics' && method === 'GET') {
      if (!gate('view')) return
      const now = Date.now()
      const from = Number(url.searchParams.get('from')) || now - 3600_000
      const to = Number(url.searchParams.get('to')) || now
      const asked = url.searchParams.get('res') as metrics.Resolution | null
      const resolution = asked && metrics.RESOLUTIONS.includes(asked) ? asked : undefined
      const limit = Math.min(5000, Number(url.searchParams.get('limit')) || 1000)
      return sendJson(res, 200, metrics.query(id, { from, to, resolution, limit }))
    }
  }

  // ---- files + config over HTTP (#53 part 2) ----
  const fm = path.match(/^\/api\/servers\/([^/]+)\/(files|config)(?:\/([\w-]+))?$/)
  if (fm) {
    const id = decodeURIComponent(fm[1])
    const group = fm[2]
    const action = fm[3] ?? ''
    if (!getServer(id)) return sendJson(res, 404, { error: 'server-not-found' })
    const gate = (scope: Scope): boolean => {
      if (!can(user, id, scope)) {
        sendJson(res, 403, { error: 'forbidden', need: scope })
        return false
      }
      return true
    }
    const trail = (op: string, target: string, ok: boolean, detail?: string): void => {
      audit.record({
        source: user.apiKey ? 'api' : 'webpanel',
        action: op,
        actor: user.username,
        ok,
        ip,
        serverId: id,
        target,
        ...(detail ? { detail } : {})
      })
    }
    /**
     * `core/serverFiles.ts` already refuses to leave the server root — every
     * entry point runs the path through `safe()`. What it does NOT do is stop a
     * caller reaching the files that decide what runs: replacing a jar or
     * dropping a plugin is code execution on the next start, and `eula.txt` or
     * `server.properties` change what the server is.
     *
     * That is not a reason to block them (an operator edits these constantly),
     * but it is a reason every write is audited with its path, and a reason
     * `files` is its own scope rather than part of `settings`.
     */
    const fileErr = (e: unknown): number => {
      const msg = String((e as Error)?.message ?? e)
      // A traversal attempt is a bad request; a missing file is a missing file.
      if (msg === 'path-escape') return 400
      if (msg.includes('ENOENT')) return 404
      return 400
    }

    if (group === 'files') {
      // Read is `files` too, not `view`: server files hold the RCON password,
      // and anything else an operator has pasted into a config.
      if (!gate('files')) return
      const rel = url.searchParams.get('path') ?? ''
      try {
        if (!action && method === 'GET') {
          // A directory lists; a file reads. One endpoint because a caller
          // walking a tree does not know which it has until it looks.
          const stat = url.searchParams.get('as')
          if (stat === 'file') return sendJson(res, 200, files.readTextFile(id, rel))
          return sendJson(res, 200, { path: rel, entries: files.listDir(id, rel) })
        }
        if (!action && method === 'POST') {
          const b = (await readBody(req).catch(() => ({}))) as { path?: string; content?: string }
          if (typeof b.path !== 'string' || typeof b.content !== 'string') {
            return sendJson(res, 400, { error: 'path-and-content-required' })
          }
          files.writeTextFile(id, b.path, b.content)
          trail('file.write', b.path, true, b.content.length + ' bytes')
          return sendJson(res, 200, { ok: true })
        }
        if (!action && method === 'DELETE') {
          const confirm = url.searchParams.get('confirm') === 'true'
          // Deleting a server file is not recoverable from inside MSMS.
          if (!confirm) {
            trail('file.delete', rel, false, 'confirm-required')
            return sendJson(res, 400, { error: 'confirm-required', op: 'file.delete' })
          }
          files.deleteEntry(id, rel)
          trail('file.delete', rel, true)
          return sendJson(res, 200, { ok: true })
        }
        if (action === 'folder' && method === 'POST') {
          const b = (await readBody(req).catch(() => ({}))) as { path?: string; name?: string }
          files.createFolder(id, b.path ?? '', b.name ?? '')
          trail('file.mkdir', (b.path ?? '') + '/' + (b.name ?? ''), true)
          return sendJson(res, 200, { ok: true })
        }
        if (action === 'rename' && method === 'POST') {
          const b = (await readBody(req).catch(() => ({}))) as { path?: string; newName?: string }
          files.renameEntry(id, b.path ?? '', b.newName ?? '')
          trail('file.rename', (b.path ?? '') + ' -> ' + (b.newName ?? ''), true)
          return sendJson(res, 200, { ok: true })
        }
      } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        if (method !== 'GET') trail('file.' + (method === 'DELETE' ? 'delete' : 'write'), rel, false, msg)
        return sendJson(res, fileErr(e), { error: msg })
      }
    }

    if (group === 'config') {
      if (!gate('settings')) return
      try {
        if (!action && method === 'GET') {
          const s = getServer(id)
          return sendJson(res, 200, {
            server: {
              id: s?.id,
              name: s?.name,
              type: s?.type,
              mcVersion: s?.mcVersion,
              path: s?.path,
              favorite: s?.favorite ?? false
            },
            java: s?.java ?? null,
            properties: files.readProperties(id)
          })
        }
        if (action === 'properties' && method === 'POST') {
          const b = (await readBody(req).catch(() => ({}))) as {
            updates?: Record<string, string>
            raw?: string
          }
          if (typeof b.raw === 'string') {
            files.writeRawProperties(id, b.raw)
            trail('config.properties', 'raw', true, b.raw.length + ' bytes')
          } else {
            const updates = b.updates ?? {}
            const keys = Object.keys(updates)
            if (!keys.length) return sendJson(res, 400, { error: 'updates-required' })
            // Values are written into a properties file, not a shell or a
            // console, so the only thing that can corrupt the file is a newline
            // smuggling in a second key.
            for (const k of keys) {
              if (/[\r\n]/.test(String(updates[k]))) {
                trail('config.properties', k, false, 'newline-in-value')
                return sendJson(res, 400, { error: 'newline-in-value', key: k })
              }
            }
            files.writeProperties(id, updates)
            trail('config.properties', keys.join(','), true)
          }
          return sendJson(res, 200, { properties: files.readProperties(id) })
        }
        if (action === 'java' && method === 'POST') {
          const b = (await readBody(req).catch(() => ({}))) as Partial<JavaArgsConfig>
          // updateServer merges `java` rather than replacing it, so a partial
          // patch keeps the rest of the preset intact.
          const updated = registry.updateServer(id, { java: b as JavaArgsConfig })
          trail('config.java', b.preset ?? 'update', true, JSON.stringify(b).slice(0, 200))
          return sendJson(res, 200, { java: updated?.java ?? null })
        }
        if (action === 'favorite' && method === 'POST') {
          const b = (await readBody(req).catch(() => ({}))) as { favorite?: boolean }
          const updated = registry.updateServer(id, { favorite: !!b.favorite })
          return sendJson(res, 200, { favorite: updated?.favorite ?? false })
        }
      } catch (e) {
        return sendJson(res, fileErr(e), { error: String((e as Error)?.message ?? e) })
      }
    }

    return sendJson(res, 404, { error: 'not-found' })
  }

  // ---- operations: moderation / worlds / backups (#53) ----
  //
  // Its own matcher rather than widening the single-segment one above: that
  // regex is `(?:\/(\w+))?$`, so a nested path silently falls through to the
  // generic 404 — the trap already documented on the alert routes. Widening it
  // would also have swallowed the `/store/...` block below.
  const om = path.match(/^\/api\/servers\/([^/]+)\/(players|worlds|backups)(?:\/([\w-]+))?$/)
  if (om) {
    const id = decodeURIComponent(om[1])
    const group = om[2]
    const action = om[3] ?? ''
    if (!getServer(id)) return sendJson(res, 404, { error: 'server-not-found' })
    const gate = (scope: Scope): boolean => {
      if (!can(user, id, scope)) {
        sendJson(res, 403, { error: 'forbidden', need: scope })
        return false
      }
      return true
    }
    const trail = (op: string, target: string, ok: boolean, detail?: string): void => {
      audit.record({
        source: user.apiKey ? 'api' : 'webpanel',
        action: op,
        actor: user.username,
        ok,
        ip,
        serverId: id,
        target,
        ...(detail ? { detail } : {})
      })
    }
    /**
     * A destructive op needs `confirm: true` on top of its scope. Not security —
     * a caller with the scope can always pass it — but a retry loop or a
     * mis-set variable should not be able to erase a world.
     */
    const confirmed = (op: string, body: { confirm?: boolean }): boolean => {
      if (!needsConfirm(op) || body.confirm === true) return true
      trail(op, '', false, 'confirm-required')
      sendJson(res, 400, { error: 'confirm-required', op })
      return false
    }

    // ---- moderation (players scope) ----
    //
    // No GET here: `/api/servers/:id/players` is a single path segment, so the
    // matcher above claims it and returns. A second handler would be dead code
    // that looks like the authoritative one.
    // ---- player detail + live map feed (#49, #26) ----
    if (group === 'players' && method === 'GET' && action) {
      // Stricter than the roster on purpose: the roster is "who plays here",
      // this is one person's inventory, ender chest, coordinates and playtime.
      // Reading that is a player-management act, not a status glance.
      if (!gate('players')) return
      if (!isValidMcName(action)) return sendJson(res, 400, { error: 'invalid-player-name' })
      const roster = await getPlayers(id)
      const found = roster.find((p) => p.name.toLowerCase() === action.toLowerCase())
      if (!found) return sendJson(res, 404, { error: 'player-not-found' })
      const rt = processManager.getRuntime(id)
      const live = rt ? livePlayers(bridgePlayers(rt.bridge, Date.now())) : []
      const mine = live.find((p) => p.name.toLowerCase() === action.toLowerCase())
      return sendJson(res, 200, {
        player: found,
        // Split from the stored fields rather than merged over them. The .dat
        // position is where the player was when the server last saved; the
        // bridge position is where they are now. Overwriting one with the
        // other would make a stale coordinate indistinguishable from a live
        // one, which is the whole question a caller is asking.
        live: mine ?? null,
        liveSource: mine ? 'bridge' : null
      })
    }

    if (group === 'players') {
      if (method === 'POST' && isModerationAction(action)) {
        if (!gate('players')) return
        const b = (await readBody(req).catch(() => ({}))) as {
          player?: string
          reason?: string
          gamemode?: string
        }
        const op = moderationAuditAction(action)
        // Validated before anything else: these values end up in a console
        // command, and `sendCommand` appends a newline — a name carrying one is
        // a second command run as the server operator.
        if (!isValidMcName(b.player)) {
          trail(op, String(b.player ?? ''), false, 'invalid-player-name')
          return sendJson(res, 400, { error: 'invalid-player-name' })
        }
        const name = b.player
        const reason = sanitizeCommandArg(b.reason)

        // Prefer the roster entry: op/ban/whitelist edit json files by uuid when
        // the server is stopped, and only the roster knows the uuid. A name that
        // has never joined can still be moderated on a RUNNING server, because
        // that path routes a console command by name.
        const roster = await getPlayers(id).catch(() => [])
        const known = roster.find((p) => p.name.toLowerCase() === name.toLowerCase())
        const target: PlayerInfo =
          known ?? { uuid: '', name, online: false, op: false, whitelisted: false, banned: false }

        try {
          switch (action) {
            case 'op':
            case 'deop':
              await playersMod.setOp(id, target, action === 'op')
              break
            case 'whitelist-add':
            case 'whitelist-remove':
              await playersMod.setWhitelist(id, target, action === 'whitelist-add')
              break
            case 'ban':
            case 'pardon':
              await playersMod.setBan(id, target, action === 'ban', reason || undefined)
              break
            case 'kick':
              await playersMod.kick(id, target, reason || undefined)
              break
            case 'gamemode': {
              if (!isGamemode(b.gamemode)) {
                trail(op, name, false, 'invalid-gamemode')
                return sendJson(res, 400, { error: 'invalid-gamemode' })
              }
              await playersMod.setGamemode(id, target, b.gamemode)
              break
            }
          }
          trail(op, name, true, reason || undefined)
          return sendJson(res, 200, { ok: true, player: name })
        } catch (e) {
          const msg = String((e as Error)?.message ?? e)
          trail(op, name, false, msg)
          // 'requires-running' and 'uuid-unknown' are the caller's problem to
          // act on (start the server, or use a name that has joined), not ours.
          return sendJson(res, msg === 'requires-running' || msg === 'uuid-unknown' ? 409 : 400, {
            error: msg
          })
        }
      }
    }

    // ---- worlds (worlds scope; reads need only view) ----
    if (group === 'worlds') {
      if (!action && method === 'GET') {
        if (!gate('view')) return
        return sendJson(res, 200, { worlds: await worldsMod.listWorlds(id) })
      }
      if (method === 'POST' || method === 'DELETE') {
        if (!gate('worlds')) return
        const b = (await readBody(req).catch(() => ({}))) as {
          name?: string
          newName?: string
          dimension?: string
          confirm?: boolean
        }
        const name = method === 'DELETE' ? (url.searchParams.get('name') ?? '') : (b.name ?? '')
        // A world name is a path component. `core/worlds.ts` builds paths from
        // it, so '..' would address the server directory itself.
        if (!isValidWorldName(name)) {
          return sendJson(res, 400, { error: 'invalid-world-name' })
        }
        const act = method === 'DELETE' ? 'delete' : action
        const op = 'world.' + act
        // A DELETE carries no body, so its confirmation is a query parameter -
        // the same split the backup routes make. Reading only the body here
        // meant `?confirm=true` was ignored and world deletion was unreachable.
        const confirm =
          method === 'DELETE' ? url.searchParams.get('confirm') === 'true' : b.confirm === true
        if (!confirmed(op, { confirm })) return
        try {
          switch (act) {
            case 'activate':
              worldsMod.activateWorld(id, name)
              break
            case 'rename':
              if (!isValidWorldName(b.newName)) return sendJson(res, 400, { error: 'invalid-world-name' })
              worldsMod.renameWorld(id, name, b.newName)
              break
            case 'clone':
              if (!isValidWorldName(b.newName)) return sendJson(res, 400, { error: 'invalid-world-name' })
              await worldsMod.cloneWorld(id, name, b.newName)
              break
            case 'reset':
              if (b.dimension !== 'overworld' && b.dimension !== 'nether' && b.dimension !== 'end') {
                return sendJson(res, 400, { error: 'invalid-dimension' })
              }
              worldsMod.resetDimension(id, name, b.dimension)
              break
            case 'delete':
              worldsMod.deleteWorld(id, name)
              break
            default:
              return sendJson(res, 404, { error: 'not-found' })
          }
          trail(op, name, true, b.newName ?? b.dimension ?? undefined)
          return sendJson(res, 200, { ok: true, worlds: await worldsMod.listWorlds(id) })
        } catch (e) {
          const msg = String((e as Error)?.message ?? e)
          trail(op, name, false, msg)
          // The refusals worlds.ts raises are all "you cannot do that to this
          // world right now" — a running server, the active world, a name that
          // is taken — which is a conflict, not a malformed request.
          return sendJson(res, 409, { error: msg })
        }
      }
    }

    // ---- backups (backups scope; reads need only view) ----
    if (group === 'backups') {
      if (!action && method === 'GET') {
        if (!gate('view')) return
        return sendJson(res, 200, { backups: backupsMod.listBackups(id) })
      }
      if (!action && method === 'POST') {
        if (!gate('backups')) return
        const b = (await readBody(req).catch(() => ({}))) as { kind?: 'world' | 'full' }
        try {
          // `destDir` is deliberately not accepted from the body: it is an
          // arbitrary filesystem path, and a backups-scoped API caller writing a
          // zip anywhere on the host is a different privilege from backing up a
          // world. The default location stands.
          const rec = await backupsMod.createBackup(id, {
            kind: b.kind === 'full' ? 'full' : 'world'
          })
          trail('backup.create', rec.fileName, true, Math.round(rec.size / 1048576) + ' MB')
          return sendJson(res, 200, rec)
        } catch (e) {
          const msg = String((e as Error)?.message ?? e)
          trail('backup.create', '', false, msg)
          return sendJson(res, 400, { error: msg })
        }
      }
      if (method === 'POST' && action === 'restore') {
        if (!gate('backups')) return
        const b = (await readBody(req).catch(() => ({}))) as { backupId?: string; confirm?: boolean }
        if (!confirmed('backup.restore', b)) return
        const rec = backupsMod.listBackups(id).find((x) => x.id === b.backupId)
        // Looked up within THIS server's backups: a backup id from another
        // server must not be restorable by someone scoped to this one.
        if (!rec) return sendJson(res, 404, { error: 'backup-not-found' })
        try {
          backupsMod.restoreBackup(rec.id)
          trail('backup.restore', rec.fileName, true)
          return sendJson(res, 200, { ok: true })
        } catch (e) {
          const msg = String((e as Error)?.message ?? e)
          trail('backup.restore', rec.fileName, false, msg)
          return sendJson(res, 409, { error: msg })
        }
      }
      if (method === 'DELETE' && !action) {
        if (!gate('backups')) return
        const backupId = url.searchParams.get('backupId') ?? ''
        const confirm = url.searchParams.get('confirm') === 'true'
        if (!confirmed('backup.delete', { confirm })) return
        const rec = backupsMod.listBackups(id).find((x) => x.id === backupId)
        if (!rec) return sendJson(res, 404, { error: 'backup-not-found' })
        backupsMod.deleteBackup(rec.id)
        trail('backup.delete', rec.fileName, true)
        return sendJson(res, 200, { ok: true })
      }
    }

    return sendJson(res, 404, { error: 'not-found' })
  }

  // ---- /api/servers/:id/store... ----
  const sm = path.match(/^\/api\/servers\/([^/]+)\/store(?:\/(.+))?$/)
  if (sm) {
    const id = decodeURIComponent(sm[1])
    const rest = sm[2] || ''
    if (!getServer(id)) return sendJson(res, 404, { error: 'server-not-found' })
    const gate = (scope: Scope): boolean => {
      if (!can(user, id, scope)) {
        sendJson(res, 403, { error: 'forbidden', need: scope })
        return false
      }
      return true
    }

    if (rest === '' && method === 'GET') {
      if (!gate('view')) return
      return sendJson(res, 200, economy.publicStore(id, user.mcName))
    }
    if (rest === 'balance' && method === 'GET') {
      if (!gate('view')) return
      return sendJson(res, 200, {
        mcName: user.mcName ?? null,
        balance: user.mcName ? economy.getBalance(id, user.mcName) : 0,
        currency: economy.publicStore(id).currency
      })
    }
    if (rest === 'txns' && method === 'GET') {
      if (!gate('view')) return
      return sendJson(res, 200, { txns: user.mcName ? economy.getTxns(id, user.mcName) : [] })
    }
    if (rest === 'buy' && method === 'POST') {
      if (!gate('view')) return
      if (!user.mcName) return sendJson(res, 400, { error: 'no-mc-linked' })
      const b = (await readBody(req).catch(() => ({}))) as { productId?: string }
      const result = economy.purchase(id, user.mcName, b.productId ?? '')
      // The public site audits its purchases; this route did not, so the same
      // action was in the trail or absent from it depending on which page it was
      // made from. Actor is the panel account that clicked Buy, with the
      // Minecraft name it delivered to in the detail — they are not always the
      // same person's identity.
      audit.record({
        source: 'webpanel',
        action: 'purchase',
        actor: user.username,
        ok: result.ok,
        ip,
        serverId: id,
        target: b.productId ?? '',
        detail: result.ok ? 'to ' + user.mcName : result.error
      })
      return sendJson(res, result.ok ? 200 : result.error === 'insufficient' ? 402 : 400, result)
    }
    // ---- admin (store scope) ----
    if (rest === 'admin' && method === 'GET') {
      if (!gate('store')) return
      return sendJson(res, 200, {
        ...economy.getStoreConfig(id),
        balances: economy.listBalances(id),
        categories: economy.listCategories(id)
      })
    }
    if (rest === 'admin/currency' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as { currency?: string }
      economy.setCurrency(id, b.currency ?? 'Coins')
      return sendJson(res, 200, { ok: true })
    }
    if (rest === 'admin/product' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as Product
      return sendJson(res, 200, economy.upsertProduct(id, b))
    }
    if (rest === 'admin/delete' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as { productId?: string }
      economy.deleteProduct(id, b.productId ?? '')
      return sendJson(res, 200, { ok: true })
    }
    if (rest === 'admin/balance' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as {
        mcName?: string
        amount?: number
        reason?: string
        category?: string
        mode?: 'add' | 'set'
      }
      // An API key acting here is not a web-panel session, and "which
      // integration created a million coins" is the question asked later.
      const who = {
        by: user.username,
        source: (user.apiKey ? 'api' : 'webpanel') as AuditSource,
        reason: b.reason ?? '',
        category: b.category
      }
      try {
        const balance =
          b.mode === 'set'
            ? economy.setBalance(id, b.mcName ?? '', Number(b.amount) || 0, who)
            : economy.addBalance(id, b.mcName ?? '', Number(b.amount) || 0, who)
        return sendJson(res, 200, { ok: true, balance })
      } catch (e) {
        return sendJson(res, 400, { error: String((e as Error)?.message ?? e) })
      }
    }
    if (rest === 'admin/layout' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as { layout?: string }
      return sendJson(res, 200, { layout: economy.setStoreLayout(id, b.layout) })
    }
    if (rest === 'admin/upload' && method === 'POST') {
      // Its own route rather than reusing /api/site/upload, which is gated on
      // the `settings` scope for the website's own server. A store manager who
      // may edit products should be able to give one a picture without also
      // being handed the keys to the public site.
      if (!gate('store')) return
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim()
      try {
        const buf = await readRawBody(req, site.MAX_UPLOAD)
        const name = site.saveImageBuffer(buf, mime)
        return sendJson(res, 200, { name, src: '/uploads/' + name })
      } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        const code =
          msg === 'body-too-large' || msg === 'image-too-large'
            ? 413
            : msg === 'unsupported-image-type'
              ? 415
              : 500
        return sendJson(res, code, { error: msg })
      }
    }
    if (rest === 'admin/crate-animation' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as { animation?: string }
      return sendJson(res, 200, { animation: economy.setCrateAnimation(id, b.animation) })
    }
    if (rest === 'admin/category' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as EconomyCategory
      return sendJson(res, 200, economy.upsertCategory(id, b))
    }
    if (rest === 'admin/category/delete' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as { categoryId?: string }
      economy.deleteCategory(id, b.categoryId ?? '')
      return sendJson(res, 200, { ok: true })
    }
    if (rest === 'admin/ledger' && method === 'GET') {
      if (!gate('store')) return
      return sendJson(res, 200, {
        ledger: economy.getLedger(id, url.searchParams.get('mcName') ?? undefined),
        balances: economy.listBalances(id),
        categories: economy.listCategories(id),
        currency: economy.publicStore(id).currency
      })
    }
  }

  // ---- site / news management from the admin panel ----
  if (path.startsWith('/api/site')) {
    const canSite = user.role === 'owner' || can(user, site.siteServerId(), 'settings')
    if (!canSite) return sendJson(res, 403, { error: 'forbidden', need: 'settings' })
    if (path === '/api/site/posts' && method === 'GET') {
      return sendJson(res, 200, { posts: site.getSiteConfig().posts })
    }
    if (path === '/api/site/uploads' && method === 'GET') {
      return sendJson(res, 200, { uploads: site.listUploads() })
    }
    // Upload a new image straight from the panel: raw bytes, content-type in the
    // header, size capped while streaming. Gated by canSite like the rest.
    if (path === '/api/site/upload' && method === 'POST') {
      const mime = String(req.headers['content-type'] || '').split(';')[0].trim()
      try {
        const buf = await readRawBody(req, site.MAX_UPLOAD)
        return sendJson(res, 200, { name: site.saveImageBuffer(buf, mime) })
      } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        // Validation failures are 4xx; anything else (e.g. a failed write) is ours.
        const code =
          msg === 'body-too-large' || msg === 'image-too-large'
            ? 413
            : msg === 'unsupported-image-type'
              ? 415
              : 500
        return sendJson(res, code, { error: msg })
      }
    }
    if (path === '/api/site/posts' && method === 'POST') {
      const b = (await readBody(req).catch(() => ({}))) as Partial<SitePost>
      // author is taken from the session — never from the client
      return sendJson(res, 200, site.upsertPost(b, user.username))
    }
    if (path === '/api/site/posts/delete' && method === 'POST') {
      const b = (await readBody(req).catch(() => ({}))) as { id?: string }
      site.deletePost(b.id ?? '')
      return sendJson(res, 200, { ok: true })
    }
  }

  // ---- API keys (#48): owner only, and never reachable with a key ----
  if (path.startsWith('/api/keys')) {
    // A key cannot mint or revoke keys. Otherwise a leaked key with any scope
    // could issue itself a wider one, and revoking the original would achieve
    // nothing - the whole point of revocation is that it ends the access.
    if (user.apiKey) return sendJson(res, 403, { error: 'forbidden', need: 'session' })
    if (user.role !== 'owner') return sendJson(res, 403, { error: 'forbidden', need: 'owner' })

    if (path === '/api/keys' && method === 'GET') {
      return sendJson(res, 200, { keys: apikeys.listKeys() })
    }
    if (path === '/api/keys' && method === 'POST') {
      const b = (await readBody(req).catch(() => ({}))) as {
        label?: string
        scopes?: Scope[]
        servers?: KeyServers
        expiresInDays?: number
        canAudit?: boolean
      }
      const created = apikeys.createKey({
        label: b.label ?? '',
        // Only scopes this build knows about. An unknown string in the list
        // would sit in the file forever, meaning nothing but looking granted.
        scopes: (Array.isArray(b.scopes) ? b.scopes : []).filter((s) => SCOPES.includes(s)),
        servers: b.servers === 'all' ? 'all' : Array.isArray(b.servers) ? b.servers : [],
        expiresInDays: Number(b.expiresInDays) || 0,
        canAudit: !!b.canAudit
      })
      audit.record({
        source: 'webpanel',
        action: 'apikey.create',
        actor: user.username,
        target: created.key.label,
        detail: created.key.scopes.join(',') || 'no scopes',
        ok: true,
        ip
      })
      // The secret is in this response and nowhere else, ever again.
      return sendJson(res, 200, created)
    }
    if (path === '/api/keys/revoke' && method === 'POST') {
      const b = (await readBody(req).catch(() => ({}))) as { keyId?: string }
      try {
        const k = apikeys.revokeKey(b.keyId ?? '')
        audit.record({
          source: 'webpanel',
          action: 'apikey.revoke',
          actor: user.username,
          target: k.label,
          ok: true,
          ip
        })
        return sendJson(res, 200, k)
      } catch {
        return sendJson(res, 404, { error: 'key-not-found' })
      }
    }
    if (path === '/api/keys' && method === 'DELETE') {
      const keyId = url.searchParams.get('keyId') ?? ''
      apikeys.deleteKey(keyId)
      audit.record({
        source: 'webpanel',
        action: 'apikey.delete',
        actor: user.username,
        target: keyId,
        ok: true,
        ip
      })
      return sendJson(res, 200, { ok: true })
    }
    return sendJson(res, 404, { error: 'not-found' })
  }

  // ---- global audit log (owner only: entries carry player IPs, personal data) ----
  if (path.startsWith('/api/audit')) {
    // Owner, or a co-admin explicitly granted the account-level audit permission.
    // (Entries carry player IPs — personal data — so this stays an explicit grant.)
    if (user.role !== 'owner' && !user.canAudit) {
      return sendJson(res, 403, { error: 'forbidden', need: 'audit' })
    }
    if (path === '/api/audit' && method === 'GET') {
      const q = url.searchParams
      const csv = (k: string): string[] | undefined => {
        const v = q.get(k)
        const parts = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
        return parts.length ? parts : undefined
      }
      const numOf = (k: string): number | undefined => {
        const v = q.get(k)
        if (v == null || v === '') return undefined
        const n = Number(v)
        return Number.isFinite(n) ? n : undefined
      }
      const okRaw = q.get('ok')
      // Only an explicit true/false filters; an empty or garbage ?ok= is ignored.
      const okFilter = okRaw === 'true' ? true : okRaw === 'false' ? false : undefined
      return sendJson(res, 200, audit.query({
        from: numOf('from'),
        to: numOf('to'),
        sources: csv('sources') as audit.AuditQuery['sources'],
        actions: csv('actions'),
        serverId: q.get('serverId') || undefined,
        actor: q.get('actor') || undefined,
        ip: q.get('ip') || undefined,
        text: q.get('text') || undefined,
        ok: okFilter,
        limit: numOf('limit'),
        offset: numOf('offset')
      }))
    }
  }

  sendJson(res, 404, { error: 'not-found' })
}

// ---- lifecycle ----
export function lanUrls(port: number): string[] {
  const urls: string[] = []
  const ifaces = networkInterfaces()
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) urls.push(`http://${net.address}:${port}`)
    }
  }
  return urls
}

function webCfg(): Required<WebConfig> {
  const c = getConfig().web
  return {
    enabled: c?.enabled ?? false,
    port: c?.port ?? 8722,
    bindLan: c?.bindLan ?? false,
    siteEnabled: c?.siteEnabled ?? false,
    sitePort: c?.sitePort ?? 8723,
    apiOrigins: Array.isArray(c?.apiOrigins) ? c.apiOrigins : []
  }
}

function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  port: number,
  host: string,
  label: string
): Server {
  const s = createServer((req, res) => {
    handler(req, res).catch((err) => {
      log.warn(`${label} request error:`, err)
      if (!res.headersSent) sendJson(res, 500, { error: 'server-error' })
    })
  })
  s.on('error', (err) => log.error(`${label} error:`, err))
  s.listen(port, host, () => log.info(`${label} on ${host}:${port}`))
  return s
}

export function startWebServer(): WebStatus {
  const cfg = webCfg()
  stopWebServer()
  initAuth()
  playerAuth.initPlayerAuth()
  site.initSite()
  const host = cfg.bindLan ? '0.0.0.0' : '127.0.0.1'
  if (cfg.enabled) server = listen(handlePanel, cfg.port, host, 'Web panel')
  if (cfg.siteEnabled) siteServer = listen(handleSite, cfg.sitePort, host, 'Website')
  return getWebStatus()
}

export function stopWebServer(): void {
  if (server) {
    server.close()
    server = null
  }
  if (siteServer) {
    siteServer.close()
    siteServer = null
  }
}

function urlsFor(port: number, bindLan: boolean): string[] {
  const urls = [`http://127.0.0.1:${port}`]
  if (bindLan) urls.push(...lanUrls(port))
  return urls
}

export function getWebStatus(): WebStatus {
  const cfg = webCfg()
  return {
    bindLan: cfg.bindLan,
    apiOrigins: cfg.apiOrigins,
    panel: {
      enabled: cfg.enabled,
      running: !!server && server.listening,
      port: cfg.port,
      urls: urlsFor(cfg.port, cfg.bindLan)
    },
    site: {
      enabled: cfg.siteEnabled,
      running: !!siteServer && siteServer.listening,
      port: cfg.sitePort,
      urls: urlsFor(cfg.sitePort, cfg.bindLan)
    }
  }
}

/** Start the web server on boot if enabled. */
export function initWebServer(): void {
  initAuth()
  playerAuth.initPlayerAuth()
  site.initSite()
  const cfg = webCfg()
  if (cfg.enabled || cfg.siteEnabled) startWebServer()
}
