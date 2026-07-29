import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { createReadStream, existsSync } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'
import { getConfig, updateConfig } from '../config'
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
import * as mods from '../core/mods'
import * as bridgeInstall from '../core/bridgeInstall'
import * as rcon from '../core/rcon'
import * as worldTiles from '../core/worldTiles'
import * as chunkAreas from '../core/chunkAreas'
import { areaChunkCount } from '@shared/chunkAreas'
import type { AreaInput } from '@shared/chunkAreas'
import { normalizeMapPerf } from '@shared/tileCache'
import { normalizeMapPage, mapPageAllows } from '@shared/mapPage'
import type { MapPageConfig, MapPageViewer } from '@shared/mapPage'
import { getMapPageHtml } from './mapPageHtml'
import { listJavaInstalls } from '../core/javaScan'
import { installJava } from '../core/javaProvision'
import {
  isModerationAction,
  isGamemode,
  isValidMcName,
  isValidWorldName,
  localOnlyJavaFields,
  moderationAuditAction,
  needsConfirm,
  sanitizeCommandArg,
  sanitizeTelemetryPatch
} from '@shared/ops'
import type { PlayerInfo } from '@shared/types'
import { bridgeFresh, bridgePlayers } from '@shared/bridge'
import { heatmap, livePlayers, mapBounds, normalizeDimension, redactPlayers, PUBLIC_MAP_DEFAULTS } from '@shared/livemap'
import { redactProfile } from '@shared/profile'
import type { ProfileViewer } from '@shared/profile'
import {
  newRefreshState,
  tryRefresh,
  FLUSH_REUSE_MS,
  INVENTORY_REFRESH
} from '@shared/refreshLimit'
import type { RefreshState } from '@shared/refreshLimit'

/** Same shape the rest of the app validates a Minecraft name with. */
const MC_NAME_RE = /^[A-Za-z0-9_]{3,16}$/

/**
 * The player roster, cached for a few seconds (#107).
 *
 * `getPlayers` parses every player's `.dat` with an NBT reader. Every other
 * public route answers from memory; this one is the first that reads the disk,
 * and the per-address budget allows ten requests a second — so without a cache
 * one visitor turns a cheap HTTP request into the whole world folder being
 * parsed, ten times a second, and a busy server has thousands of those files.
 *
 * The window is short because a profile showing a ten-second-old inventory is
 * fine and one that pins the process is not. Shared across callers rather than
 * per-address: the expensive part is the same work whoever asked for it.
 */
const rosterCache = new Map<string, { at: number; players: PlayerInfo[] }>()
const ROSTER_TTL_MS = 10_000

async function cachedRoster(serverId: string): Promise<PlayerInfo[]> {
  const hit = rosterCache.get(serverId)
  if (hit && Date.now() - hit.at < ROSTER_TTL_MS) return hit.players
  const players = await playersMod.getPlayers(serverId).catch(() => [] as PlayerInfo[])
  rosterCache.set(serverId, { at: Date.now(), players })
  return players
}

export function _resetRosterCache(): void {
  rosterCache.clear()
  refreshState.clear()
  lastFlush.clear()
}

// World tiles (#119) live in `core/worldTiles`, queue and all, so the desktop
// app and the two web surfaces share one parse budget rather than three.
const tilesFor = worldTiles.requestTiles
const parseWanted = worldTiles.parseWantedTiles

// ---- asking the server to write the inventory down (#117) ----
//
// Everything MSMS knows about an inventory comes from `playerdata/<uuid>.dat`,
// and Minecraft writes that when the world saves or the player disconnects. So
// the numbers are not wrong, they are OLD — up to the autosave interval, which
// is five minutes by default. A refresh button that only re-read the same file
// would be theatre; it has to ask the server to flush first.
const refreshState = new Map<string, RefreshState>()
const lastFlush = new Map<string, number>()

/**
 * Flush the world, then drop the cached roster so the next read is fresh.
 *
 * The flush is per-world, so concurrent refreshes share one: `FLUSH_REUSE_MS`
 * is what stops ten players with three-a-minute each becoming thirty saves a
 * minute on one world.
 */
async function flushAndInvalidate(serverId: string): Promise<boolean> {
  const now = Date.now()
  const last = lastFlush.get(serverId) ?? 0
  if (now - last < FLUSH_REUSE_MS) {
    rosterCache.delete(serverId)
    return true
  }
  if (!processManager.isRunning(serverId)) {
    // Nothing to flush: a stopped server wrote its player data on shutdown, so
    // what is on disk is already current. Re-reading it is the whole refresh.
    rosterCache.delete(serverId)
    return true
  }
  if (!rcon.isConnected(serverId)) return false
  lastFlush.set(serverId, now)
  await rcon.tryCommand(serverId, 'save-all')
  // The write is not instantaneous and the command returns before it lands.
  await new Promise((r) => setTimeout(r, 600))
  rosterCache.delete(serverId)
  return true
}

/**
 * Whether a refresh could do anything at all, checked BEFORE spending budget.
 *
 * A stopped server already wrote its player data on shutdown, so re-reading is
 * the whole refresh. A running one needs a channel to ask for the save. Without
 * this check the budget is spent first and the flush fails afterwards, so a
 * player on a server with no RCON burns three a minute on requests that do
 * nothing — the "a refusal costs nothing" rule the limiter is built around,
 * broken one layer above it.
 */
function canRefresh(serverId: string): boolean {
  return !processManager.isRunning(serverId) || rcon.isConnected(serverId)
}

/** One budget per actor, whoever they are: a player name or a panel username. */
function spendRefresh(actor: string): ReturnType<typeof tryRefresh> {
  const v = tryRefresh(refreshState.get(actor) ?? newRefreshState(), INVENTORY_REFRESH, Date.now())
  refreshState.set(actor, v.state)
  // Anyone with no live hits is indistinguishable from someone who has never
  // asked, so dropping them is free — and this map is keyed by a name a
  // stranger chooses, which is not something to grow without bound.
  if (refreshState.size > 512) {
    for (const [k, s] of refreshState) {
      if (!s.hits.length) refreshState.delete(k)
    }
  }
  return v
}
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
import { spendKeyToken, resetKeyBuckets } from './rate'
import { attachWs, closeAllWs, WS_PATH, WS_STREAMS } from './wsHub'
import { getApiDocsHtml } from './apiDocsHtml'
import { openApiDocument } from '@shared/openapi'
import { API_VERSION } from '@shared/apiSurface'
import {
  consumeToken,
  isOriginAllowed,
  newBucket,
  type Bucket,
  type KeyServers
} from '@shared/apikeys'
import { getPanelHtml } from './panelHtml'
import { SCOPES } from '@shared/web'
import type { Scope, WebStatus, WebConfig } from '@shared/web'

let server: Server | null = null
let siteServer: Server | null = null
let mapServer: Server | null = null

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
 * The buckets live in `./rate` so the WebSocket upgrade path spends from the
 * same budget. A limiter that only counts HTTP requests is one an integration
 * can walk around by opening streams instead.
 */
function keyRateOk(keyId: string, res: ServerResponse): boolean {
  const r = spendKeyToken(keyId)
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

/**
 * The spec and the reference page, built once.
 *
 * Both derive from a constant table, so the output cannot change while the
 * process runs. Building them per request would be ~120 KB of object graph and
 * string work on an unauthenticated route.
 */
let specJson: string | null = null
let docsHtml: string | null = null

function cachedSpec(): string {
  if (specJson === null) {
    buildCount++
    buildLog.push('spec')
    specJson = JSON.stringify(openApiDocument())
  }
  return specJson
}

function cachedDocs(): string {
  if (docsHtml === null) {
    buildCount++
    buildLog.push('docs')
    docsHtml = getApiDocsHtml()
  }
  return docsHtml
}

/**
 * The two app shells, built once and served with an ETag (#100).
 *
 * Both were rebuilt from their template literals on **every** request — a few
 * hundred KB of string work each — and both are served before any
 * authentication, on listeners with no per-address limit outside `/api/login`.
 * With `bindLan` on, that is a way to make the panel unresponsive from anywhere
 * on the network without holding a credential.
 *
 * Caching them is safe because neither depends on the request or on config:
 * every interpolation is a module constant, and everything an operator can
 * change — theme, languages, posts, logo — is fetched by the page at runtime
 * from `/api/public/site`. The smoke asserts exactly that, by changing site
 * config and requiring the HTML to come back byte-identical. If a later change
 * makes a page config-derived, that assertion fails rather than this cache
 * quietly serving yesterday's page.
 */
interface CachedPage {
  body: string
  etag: string
}

const pageCache = new Map<string, CachedPage>()

/**
 * Counted, not timed.
 *
 * The first version of this asserted that twenty requests averaged under 25ms.
 * Measured: 13.3ms per request uncached against 10.85ms cached — the loopback
 * round trip dwarfs the work, so the threshold could not fail and the test
 * proved nothing. A build counter is the same claim without the noise: twenty
 * requests must cause zero rebuilds, on any machine.
 */
let buildCount = 0
const buildLog: string[] = []

function cachedPage(key: string, build: () => string): CachedPage {
  let hit = pageCache.get(key)
  if (!hit) {
    buildCount++
    buildLog.push(key)
    const body = build()
    hit = { body, etag: '"' + createHash('sha1').update(body).digest('base64url') + '"' }
    pageCache.set(key, hit)
  }
  return hit
}

/** Test seam: how many times a cached artefact has actually been built. */
export function _buildCount(): number {
  return buildCount
}

/** Test seam: which artefacts were built, in order. Names a surprise rebuild. */
export function _buildLog(): string[] {
  return [...buildLog]
}

/** Test seam: drop the built artefacts so a rebuild can be observed. */
export function _resetPageCache(): void {
  pageCache.clear()
  specJson = null
  docsHtml = null
}

function sendPage(req: IncomingMessage, res: ServerResponse, page: CachedPage): void {
  // `no-cache` means "revalidate", not "do not store": the browser keeps the
  // copy and asks, and an unchanged shell costs a 304 with no body. A panel is
  // reloaded often, and the shell only changes when the app is upgraded.
  if (req.headers['if-none-match'] === page.etag) {
    res.writeHead(304, { ETag: page.etag, 'Cache-Control': 'no-cache' })
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    ETag: page.etag,
    'Cache-Control': 'no-cache'
  })
  res.end(page.body)
}

/** Test seam: the buckets survive a `stopWebServer()`, which smoke runs rely on. */
export function _resetRateLimits(): void {
  resetKeyBuckets()
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

  // Registration and reset are the same claim ("I own this name") and share one
  // decision (#105). Registration could already overwrite an existing account's
  // password, so it WAS a reset — hardening reset while leaving that open would
  // secure the harder door and leave the easier one ajar.
  if ((sub === 'register/start' || sub === 'reset/start') && method === 'POST') {
    const b = (await readBody(req).catch(() => ({}))) as { mcName?: string }
    const r = await playerAuth.verifyStart(
      site.siteServerId(),
      (b.mcName ?? '').trim(),
      ip,
      sub === 'reset/start' ? 'reset' : 'register'
    )
    return sendJson(res, r.status, r.body)
  }
  // Reset's second step IS `verify`: it consumes the same single-use code and
  // sets the password. A separate route would be a second way into the same
  // state, and two places to get the attempt counting right.
  if (sub === 'reset/verify' && method === 'POST') {
    const b = (await readBody(req).catch(() => ({}))) as {
      mcName?: string
      code?: string
      password?: string
    }
    const r = playerAuth.verify((b.mcName ?? '').trim(), b.code ?? '', b.password ?? '')
    return sendJson(res, r.ok ? 200 : 400, r.ok ? { token: r.token, mcName: r.mcName } : r)
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

  // ---- the public live map (#104) ----
  //
  // A separate payload from the panel's, not the same one with fields hidden in
  // the client. `redactPlayers` returns a different TYPE, so a field the panel
  // gains later cannot arrive here by being spread through.
  if (sub === 'map' && method === 'GET') {
    const cfg = site.publicMapConfig()
    // 404, not an empty map: with the setting off there is no such resource,
    // and answering 200 would tell a prober that a map exists and is empty.
    if (!cfg) return sendJson(res, 404, { error: 'not-found' })
    const rt = processManager.getRuntime(cfg.serverId)
    const now = Date.now()
    const all = rt ? livePlayers(bridgePlayers(rt.bridge, now)) : []
    // `path` here is already stripped of the query, so the dimension is read
    // from the raw url. A missing or unparseable one is the overworld.
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams
    // A pinned world overrides what the visitor asks for and what the players
    // are standing in: the point of pinning is that the site always shows the
    // same place, with nobody online and whatever the query says (#137).
    const dim = cfg.fixedDim
      ? normalizeDimension(cfg.fixedDim)
      : normalizeDimension(q.get('dim') ?? 'overworld')
    const players = redactPlayers(all.filter((p) => p.dim === dim), cfg)
    return sendJson(res, 200, {
      bridge: rt ? bridgeFresh(rt.bridge, now) : false,
      dimension: dim,
      // One entry when pinned, so the page has nothing to offer a switcher —
      // a control that cannot change the answer is not a control.
      dimensions: cfg.fixedDim ? [dim] : [...new Set(all.map((p) => p.dim))].sort(),
      pinned: !!cfg.fixedDim,
      players,
      // Bounds from the ROUNDED positions. Deriving them from the exact ones
      // would publish a tighter box than the dots inside it, and the corner of
      // that box is a player's real coordinate to within a pixel.
      bounds: mapBounds(players.map((p) => ({ ...p, name: p.name ?? '', y: 0 }))),
      round: cfg.round,
      heads: cfg.heads,
      // The operator's map budget applies to every surface that reads these
      // tiles, and the public site is one of them — the settings UI says so, so
      // the feed has to carry it (#136).
      loadOnPan: normalizeMapPerf(getServer(cfg.serverId)?.map).loadOnPan,
      at: now
    })
  }

  // ---- a player's profile (#107) ----
  //
  // See `cachedRoster`: this is the only public route that touches the disk.
  //
  // Who is asking decides what comes back, and the decision is a pure table in
  // @shared/profile because it is the whole security of the feature. Fields are
  // OMITTED, never sent-and-hidden: a page can be read with the network tab
  // open, and "we shipped it but did not draw it" is not a privacy setting.
  // Refresh MY inventory (#117). Own only: the flush is a real cost, and one
  // visitor should not be able to spend it on behalf of everyone on the server.
  if (sub === 'profile/refresh' && method === 'POST') {
    const tok0 = bearer(req)
    const who = playerAuth.resolvePlayerSession(tok0)
    if (!who) return sendJson(res, 401, { error: tok0 ? 'session-expired' : 'login-required' })
    const rsid = site.siteServerId()
    if (!rsid || !getServer(rsid)) return sendJson(res, 404, { error: 'not-found' })
    // Before the budget, not after.
    if (!canRefresh(rsid)) return sendJson(res, 409, { error: 'server-unreachable' })
    const verdict = spendRefresh('player:' + who.mcName.toLowerCase())
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSec))
      return sendJson(res, 429, {
        error: 'rate-limited',
        window: verdict.window,
        retryAfter: verdict.retryAfterSec
      })
    }
    const ok = await flushAndInvalidate(rsid)
    return sendJson(res, 200, { ok, flushed: ok })
  }

  if (sub === 'profile' && method === 'GET') {
    const psid = site.siteServerId()
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams
    const tok = bearer(req)
    const session = playerAuth.resolvePlayerSession(tok)
    // A credential that was SUPPLIED and did not resolve is a different fact
    // from no credential at all, and treating them the same is what made a
    // restarted app tell a signed-in player they do not exist (#120). This says
    // nothing about any name — it is about the token — so the 404-vs-200 rule
    // for anonymous requests is untouched.
    if (tok && !session) return sendJson(res, 401, { error: 'session-expired' })
    const asked = (q.get('name') ?? '').trim() || session?.mcName || ''
    if (!MC_NAME_RE.test(asked)) return sendJson(res, 400, { error: 'invalid-name' })
    if (!psid || !getServer(psid)) return sendJson(res, 404, { error: 'not-found' })
    const viewer: ProfileViewer = !session
      ? 'anonymous'
      : session.mcName.toLowerCase() === asked.toLowerCase()
        ? 'owner'
        : 'stranger'
    const roster = await cachedRoster(psid)
    const p = roster.find((x) => x.name.toLowerCase() === asked.toLowerCase())
    // Existence is decided by the ROSTER alone for anyone but the owner.
    //
    // Consulting `isRegistered` here for a stranger would make 200-vs-404
    // answer "does this name have a website account?" for every name that has
    // never played — the same enumeration oracle closed in #105, reopened in a
    // different endpoint. The owner is already authenticated as that name, so
    // telling them their own account exists reveals nothing, and it is the only
    // way someone who registered on a server that has never run can see their
    // own profile.
    if (!p && !(viewer === 'owner' && playerAuth.isRegistered(asked))) {
      return sendJson(res, 404, { error: 'not-found' })
    }
    return sendJson(
      res,
      200,
      redactProfile(
        {
          mcName: p?.name ?? asked,
          ...(p?.uuid ? { uuid: p.uuid } : {}),
          ...(p ? { online: p.online } : {}),
          ...(playerAuth.registeredAt(asked) ? { registeredAt: playerAuth.registeredAt(asked) } : {}),
          ...(p?.lastSeen ? { lastSeen: p.lastSeen } : {}),
          // When the inventory was actually written. Without it a player who
          // just picked something up sees an old number with nothing to explain
          // it, which reads as a bug rather than as a save interval (#117).
          ...(p?.lastSeen ? { dataAt: p.lastSeen } : {}),
          ...(typeof p?.playtimeHours === 'number' ? { playtimeHours: p.playtimeHours } : {}),
          ...(p?.inventory ? { inventory: p.inventory } : {}),
          ...(p?.enderChest ? { enderChest: p.enderChest } : {}),
          ...(p && (p.health !== undefined || p.food !== undefined || p.xpLevel !== undefined)
            ? { stats: { health: p.health, food: p.food, xpLevel: p.xpLevel } }
            : {}),
          ...(p?.position ? { location: p.position } : {})
        },
        viewer,
        site.profilePublishing()
      )
    )
  }

  // The world under the public map (#119). A separate setting from publishing
  // the map itself: player positions are rounded, and terrain cannot be — a
  // rendered world is an accurate map of a private server, which is a different
  // decision from "show where people are".
  if (sub === 'map/tiles' && method === 'GET') {
    const cfg = site.publicMapConfig()
    if (!cfg || !cfg.world) return sendJson(res, 404, { error: 'not-found' })
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams
    const dim = normalizeDimension(q.get('dim') ?? 'overworld')
    // Structures only when the operator published them, whatever the caller
    // asks for: where every village and dungeon is turns a public site into a
    // treasure map of a private world.
    return sendJson(
      res,
      200,
      tilesFor(cfg.serverId, dim, parseWanted(q.get('c')), { marks: cfg.structures })
    )
  }

  // Named chunk areas, as a visitor may read them (#144).
  //
  // Tied to publishing the map at all, not to publishing the terrain: an area is
  // a label the operator wrote on purpose, so it is fit to show wherever the map
  // is. `listPublicAreas` drops the hidden ones and the timestamps; the panel's
  // own route is the one that returns everything.
  if (sub === 'map/areas' && method === 'GET') {
    const cfg = site.publicMapConfig()
    if (!cfg) return sendJson(res, 404, { error: 'not-found' })
    const q = new URL(req.url ?? '/', 'http://localhost').searchParams
    const dim = cfg.fixedDim
      ? normalizeDimension(cfg.fixedDim)
      : normalizeDimension(q.get('dim') ?? 'overworld')
    return sendJson(res, 200, { dimension: dim, areas: chunkAreas.listPublicAreas(cfg.serverId, dim) })
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
    // Limited per address like the public API below it: the page and the
    // uploads it references are served without a credential, so an unlimited
    // one is a way to spend the process from anywhere that can reach the port.
    if (!publicRateOk(ip, res)) return
    if (path.startsWith('/uploads/')) return serveUpload(path, res)
    return sendPage(req, res, cachedPage('site', getPublicSiteHtml))
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
  const rawPath = url.pathname
  /**
   * `/api/v1/...` is the **published** surface (#27); `/api/...` is the same
   * router, and is what the panel's own page calls.
   *
   * One rewrite rather than a second route table. Two tables drift, and the
   * version that drifts is always the documented one — an integration would
   * then be reading a spec for a router the app no longer runs.
   *
   * The unversioned form stays because the panel bundle uses it and because
   * breaking it would break every existing key. What `v1` adds is a promise:
   * this shape does not change under a caller. A `v2` would be a second prefix
   * here, not an edit to this one.
   */
  const path = rawPath.startsWith('/api/v1/') ? '/api' + rawPath.slice(7) : rawPath
  const method = req.method ?? 'GET'
  const ip = req.socket.remoteAddress ?? 'unknown'

  // Cross-origin handshake first: a preflight carries no credentials, so it has
  // to be answered before anything asks who the caller is.
  if (path.startsWith('/api/') && applyCors(req, res)) return

  // The index, the spec and the reference page are served before authentication,
  // and are the only routes that are. All three are descriptions of the
  // software — the same bytes on every install, generated from a constant table,
  // carrying no server name, id or count — so there is nothing in them to
  // withhold. Requiring a credential would also make the docs page useless to
  // the thing that needs it most: a browser, which cannot set an Authorization
  // header on a navigation.
  //
  // Rate limited per address, and built once. Both matter because these three
  // are the only unauthenticated routes on this listener: the spec is ~120 KB
  // and the page not much less, so rebuilding either per request hands anyone
  // who can reach the port a way to spend the event loop without a credential.
  // Their input is constant, so the answer is too — the cost is now one buffer
  // write, and the per-IP bucket caps even that.
  if (
    rawPath === '/api/v1' ||
    rawPath === '/api/v1/openapi.json' ||
    rawPath === '/api/v1/docs'
  ) {
    if (method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' })
    if (!publicRateOk(ip, res)) return
    if (rawPath === '/api/v1') {
      return sendJson(res, 200, {
        version: API_VERSION,
        openapi: '/api/v1/openapi.json',
        docs: '/api/v1/docs',
        stream: WS_PATH,
        streams: WS_STREAMS
      })
    }
    if (rawPath === '/api/v1/openapi.json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      })
      res.end(cachedSpec())
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300'
    })
    res.end(cachedDocs())
    return
  }

  // ---- static (admin panel listener) ----
  if (!path.startsWith('/api/')) {
    if (path === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
    // Same reasoning as the site listener: unauthenticated, so limited.
    if (!publicRateOk(ip, res)) return
    // Sandboxed raster uploads (for post image previews in the panel).
    if (path.startsWith('/uploads/')) return serveUpload(path, res)
    return sendPage(req, res, cachedPage('panel', getPanelHtml))
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
  //
  // One optional NESTED segment. `\w` does not match a slash, so the previous
  // shape silently refused every two-part sub-route: `/map/tiles` matched
  // nothing and fell through to the 404 at the bottom of this function, which
  // is why the world rendered in the desktop app (IPC) and nowhere on the web.
  //
  // Still `\w`-only per segment, so a sub-route cannot express `..` or anything
  // else that would mean something to a path.
  const m = path.match(/^\/api\/servers\/([^/]+)(?:\/(\w+(?:\/\w+)?))?$/)
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
    // Deregister a server (#53 part 3). Owner session only, and the files stay.
    //
    // `removeServer(id, true)` is a recursive delete of a directory tree and
    // `addServer(path)` takes a host filesystem path chosen by the caller —
    // the same class of thing `javaPath` was refused for in #93. An HTTP caller
    // does not name paths on the host and does not erase directories. Forgetting
    // is recoverable (the folder is untouched and a rescan finds it again),
    // which is exactly why this half can be exposed and the other half cannot.
    //
    // `role !== 'owner'` is session-only by construction: `principalForKey`
    // always builds `role: 'user'`, deliberately — a key carries scopes, never a
    // role — so no API key can reach this however it is scoped.
    if (!sub && method === 'DELETE') {
      if (user.role !== 'owner') return sendJson(res, 403, { error: 'forbidden', need: 'owner' })
      const target = getServer(id)
      const forgetTrail = (ok: boolean, detail: string): void => {
        audit.record({
          source: user.apiKey ? 'api' : 'webpanel',
          action: 'server.forget',
          actor: user.username,
          ok,
          ip,
          serverId: id,
          target: target?.name ?? id,
          detail
        })
      }
      if (url.searchParams.get('confirm') !== 'true') {
        forgetTrail(false, 'confirm-required')
        return sendJson(res, 400, { error: 'confirm-required', op: 'server.forget' })
      }
      // Dropping a running server from the registry would orphan the process:
      // every lookup that reaches for its config to stop it would 404.
      if (processManager.isRunning(id)) {
        forgetTrail(false, 'server-running')
        return sendJson(res, 409, { error: 'server-running' })
      }
      // `filesKept: true` on its own would be a half-truth. `removeServer` also
      // calls `metrics.dropServer` and `events.dropServer` — a recursive delete
      // of this server's metric folder and its event log. Those are MSMS's own
      // records, not the server's files, and nothing brings them back: a rescan
      // re-adds the folder under a NEW id, with no history attached. So the
      // response says what was destroyed, rather than only what was spared.
      //
      // `alerts.dropServer` is a separate call because `removeServer` does not
      // make it — the desktop handler in `ipc/register.ts` pairs them by hand,
      // and this route has to as well. Left out, the rules for a server that no
      // longer exists stay in the store until the next launch, when initAlerts
      // sweeps them.
      const rulesDropped = alerts.listRules(id).length
      registry.removeServer(id, false)
      alerts.dropServer(id)
      forgetTrail(true, `files kept; history + ${rulesDropped} alert rule(s) dropped`)
      return sendJson(res, 200, {
        ok: true,
        filesKept: true,
        historyDropped: true,
        alertRulesRemoved: rulesDropped
      })
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
    // What the map costs on this server (#133). `settings`, because it is a
    // persisted server setting, not a per-session view preference.
    if (sub === 'map/perf' && method === 'GET') {
      if (!gate('settings')) return
      return sendJson(res, 200, normalizeMapPerf(getServer(id)?.map))
    }
    if (sub === 'map/perf' && method === 'POST') {
      if (!gate('settings')) return
      const b = (await readBody(req).catch(() => ({}))) as Record<string, unknown>
      // Clamped on the way IN. A value only fixed when it is read is still a
      // wrong number sitting in the config file.
      const next = normalizeMapPerf({ ...normalizeMapPerf(getServer(id)?.map), ...b })
      registry.updateServer(id, { map: next })
      audit.record({
        source: user.apiKey ? 'api' : 'webpanel',
        action: 'map.perf',
        actor: user.username,
        ok: true,
        ip,
        serverId: id,
        detail: JSON.stringify(next)
      })
      return sendJson(res, 200, next)
    }
    if (sub === 'map/cache' && method === 'DELETE') {
      if (!gate('settings')) return
      const removed = worldTiles.clearTileCache(id)
      return sendJson(res, 200, { ok: true, removed })
    }
    if (sub === 'map/tiles' && method === 'GET') {
      if (!gate('view')) return
      const dim = normalizeDimension(url.searchParams.get('dim') ?? 'overworld')
      // An operator may ask for structures on their own map without a setting —
      // they can already read the world folder. The public feed cannot.
      return sendJson(
        res,
        200,
        tilesFor(id, dim, parseWanted(url.searchParams.get('c')), {
          marks: url.searchParams.get('marks') === '1'
        })
      )
    }
    // ---- named chunk areas (#144) ----
    //
    // Gated like the rest of the map's configuration: `view` to read, `settings`
    // to change. Not `worlds` — writing a label on a map should not require the
    // scope that can delete the world underneath it.
    if (sub === 'areas' && method === 'GET') {
      if (!gate('view')) return
      // The operator's own list, hidden areas included. `publicChunkAreas` is
      // what strips those, and it is only ever called on the public routes.
      return sendJson(res, 200, { areas: chunkAreas.listAreas(id) })
    }
    if (sub === 'areas' && method === 'POST') {
      if (!gate('settings')) return
      const b = (await readBody(req).catch(() => ({}))) as AreaInput & { areaId?: string }
      try {
        // One route for both, keyed on whether the caller named an existing
        // area. The alternative is a third path segment, and this router has
        // already shipped one route nobody could reach because of that (#130).
        const area = b.areaId
          ? chunkAreas.updateArea(id, b.areaId, b)
          : chunkAreas.createArea(id, b)
        audit.record({
          source: user.apiKey ? 'api' : 'webpanel',
          action: b.areaId ? 'area.update' : 'area.create',
          actor: user.username,
          target: area.name,
          detail: area.dim + ' ' + areaChunkCount(area) + ' chunks',
          ok: true,
          ip,
          serverId: id
        })
        return sendJson(res, 200, area)
      } catch (e) {
        const why = String(e).replace(/^Error:\s*/, '')
        return sendJson(res, why === 'area-not-found' ? 404 : 400, { error: why })
      }
    }
    if (sub === 'areas' && method === 'DELETE') {
      if (!gate('settings')) return
      const areaId = url.searchParams.get('areaId') ?? ''
      const gone = chunkAreas.listAreas(id).find((a) => a.id === areaId)
      try {
        chunkAreas.deleteArea(id, areaId)
      } catch {
        return sendJson(res, 404, { error: 'area-not-found' })
      }
      audit.record({
        source: user.apiKey ? 'api' : 'webpanel',
        action: 'area.delete',
        actor: user.username,
        target: gone?.name ?? areaId,
        ok: true,
        ip,
        serverId: id
      })
      return sendJson(res, 200, { ok: true })
    }
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
          // javaPath / customArgs / extraFlags decide what binary runs and with
          // what command line. `settings` means "edit server settings", not "run
          // arbitrary programs as the MSMS process", so they are desktop-only -
          // where the caller is the operator at the machine, who already has
          // full filesystem access anyway.
          const forbidden = localOnlyJavaFields(b as Record<string, unknown>)
          if (forbidden.length) {
            trail('config.java', forbidden.join(','), false, 'local-only-field')
            return sendJson(res, 403, { error: 'local-only-field', fields: forbidden })
          }
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

  // ---- account claims waiting for a human (#105) ----
  //
  // `settings`, not `players`. Approving is granting somebody the credentials to
  // a website account with a balance and a purchase history; the scope that
  // already means "change how this server is secured" is the honest home for it.
  // `players` means kick/ban/gamemode, which is authority over a session, not
  // over an identity.
  const am = path.match(/^\/api\/servers\/([^/]+)\/player-requests(?:\/(approve|deny))?$/)
  if (am) {
    const id = decodeURIComponent(am[1])
    if (!getServer(id)) return sendJson(res, 404, { error: 'server-not-found' })
    if (!can(user, id, 'settings')) return sendJson(res, 403, { error: 'forbidden', need: 'settings' })
    if (!am[2] && method === 'GET') {
      return sendJson(res, 200, { requests: playerAuth.pendingApprovals(id) })
    }
    const b2 = (await readBody(req).catch(() => ({}))) as { id?: string }
    if (am[2] === 'approve' && method === 'POST') {
      const out = await playerAuth.approveRequest(b2.id ?? '', user.username)
      return sendJson(res, out.ok ? 200 : 409, out)
    }
    if (am[2] === 'deny' && method === 'POST') {
      const ok = playerAuth.denyRequest(b2.id ?? '', user.username)
      return sendJson(res, ok ? 200 : 404, { ok })
    }
    return sendJson(res, 404, { error: 'not-found' })
  }

  // ---- the Bridge plugin (#103) ----
  //
  // `files` for the same reason as the mods routes: installing it writes a jar
  // into the server directory, which `files` already permits outright. Status is
  // gated too rather than left on `view` — it names the installed version and
  // whether a release check reached GitHub, which is inventory, not a dashboard
  // number.
  const bm = path.match(/^\/api\/servers\/([^/]+)\/bridge(?:\/(install))?$/)
  if (bm) {
    const id = decodeURIComponent(bm[1])
    if (!getServer(id)) return sendJson(res, 404, { error: 'server-not-found' })
    if (!can(user, id, 'files')) return sendJson(res, 403, { error: 'forbidden', need: 'files' })
    try {
      if (!bm[2] && method === 'GET') {
        return sendJson(res, 200, await bridgeInstall.bridgeStatus(id))
      }
      if (bm[2] === 'install' && method === 'POST') {
        // No body is read. The caller asks for "the bridge on this server" and
        // the app resolves what that means — a version or a URL crossing this
        // boundary would turn a `files` request into "write a file of my
        // choosing into your server folder".
        const out = await bridgeInstall.installBridge(id, {
          by: user.username,
          source: user.apiKey ? 'api' : 'webpanel'
        })
        return sendJson(res, out.ok ? 200 : 409, out)
      }
    } catch (e) {
      return sendJson(res, 500, { error: String(e) })
    }
    return sendJson(res, 404, { error: 'not-found' })
  }

  // ---- plugins / mods over HTTP (#53 part 3) ----
  //
  // Gated on `files`, not a new `mods` scope. Installing a plugin writes a jar
  // into the server directory and deleting one removes a file from it — both are
  // things `files` already permits outright. A separate scope would be a strict
  // subset of one the caller must already hold to do the same work by hand: it
  // would look like a boundary while being none.
  const mm = path.match(/^\/api\/servers\/([^/]+)\/mods(?:\/([\w-]+))?$/)
  if (mm) {
    const id = decodeURIComponent(mm[1])
    const action = mm[2] ?? ''
    if (!getServer(id)) return sendJson(res, 404, { error: 'server-not-found' })
    if (!can(user, id, 'files')) return sendJson(res, 403, { error: 'forbidden', need: 'files' })
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
    try {
      if (!action && method === 'GET') {
        return sendJson(res, 200, { mods: mods.listMods(id) })
      }
      if (action === 'search' && method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').trim()
        if (!q) return sendJson(res, 400, { error: 'query-required' })
        return sendJson(res, 200, { hits: await mods.searchModrinth(id, q) })
      }
      if (action === 'updates' && method === 'GET') {
        return sendJson(res, 200, await mods.checkUpdates(id))
      }
      if (action === 'detail' && method === 'GET') {
        const pid = (url.searchParams.get('projectId') ?? '').trim()
        if (!pid) return sendJson(res, 400, { error: 'projectId-required' })
        return sendJson(res, 200, await mods.modrinthDetail(id, pid))
      }
      if (action === 'install' && method === 'POST') {
        const b = (await readBody(req).catch(() => ({}))) as {
          projectId?: string
          versionId?: string
        }
        if (!b.projectId) return sendJson(res, 400, { error: 'projectId-required' })
        // The download URL is resolved server-side from the project's own
        // version list; the caller names a project, never a file.
        const file = await mods.installModrinth(id, b.projectId, b.versionId)
        trail('mod.install', file, true, b.projectId)
        return sendJson(res, 200, { file })
      }
      if (action === 'update' && method === 'POST') {
        const b = (await readBody(req).catch(() => ({}))) as { rel?: string; versionId?: string }
        if (!b.rel || !b.versionId) {
          return sendJson(res, 400, { error: 'rel-and-versionId-required' })
        }
        const file = await mods.applyUpdate(id, b.rel, b.versionId)
        trail('mod.update', file, true, b.rel)
        return sendJson(res, 200, { file })
      }
      if (action === 'toggle' && method === 'POST') {
        const b = (await readBody(req).catch(() => ({}))) as { rel?: string; enable?: boolean }
        if (!b.rel) return sendJson(res, 400, { error: 'rel-required' })
        mods.toggleMod(id, b.rel, !!b.enable)
        trail('mod.toggle', b.rel, true, b.enable ? 'enabled' : 'disabled')
        return sendJson(res, 200, { ok: true })
      }
      if (!action && method === 'DELETE') {
        const rel = url.searchParams.get('rel') ?? ''
        // Shape first, then intent: a call with no `rel` at all is malformed,
        // and auditing it as a refused delete of "" records a decision nobody
        // made.
        if (!rel) return sendJson(res, 400, { error: 'rel-required' })
        if (url.searchParams.get('confirm') !== 'true') {
          trail('mod.delete', rel, false, 'confirm-required')
          return sendJson(res, 400, { error: 'confirm-required', op: 'mod.delete' })
        }
        mods.deleteMod(id, rel)
        trail('mod.delete', rel, true)
        return sendJson(res, 200, { ok: true })
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      if (method !== 'GET') trail('mod.' + (action || 'delete'), '', false, msg)
      // `invalid-mod-path` is the caller naming something outside plugins/ or
      // mods/ — a malformed request, not a conflict with the server's state.
      return sendJson(res, msg === 'invalid-mod-path' ? 400 : 409, { error: msg })
    }
    return sendJson(res, 404, { error: 'not-found' })
  }

  // ---- host-wide settings: Java runtimes, telemetry (#53 part 3) ----
  //
  // None of these belong to one server, so a per-server scope cannot express
  // them and they are owner-only. Note what that means for keys: `principalForKey`
  // always builds a principal with `role: 'user'`, deliberately — a key carries
  // scopes, never a role — so every `role !== 'owner'` check below is
  // session-only by construction. There is no such thing as an owner key.
  if (path === '/api/java' && method === 'GET') {
    if (user.role !== 'owner') return sendJson(res, 403, { error: 'forbidden', need: 'owner' })
    const refresh = url.searchParams.get('refresh') === 'true'
    return sendJson(res, 200, { installs: await listJavaInstalls(refresh) })
  }
  if (path === '/api/java/install' && method === 'POST') {
    if (user.role !== 'owner') return sendJson(res, 403, { error: 'forbidden', need: 'owner' })
    const b = (await readBody(req).catch(() => ({}))) as { major?: number }
    const major = Number(b.major)
    // The major version is the only input, and it selects from Adoptium's own
    // release list — the caller never names a URL or a path.
    if (!Number.isInteger(major) || major < 8 || major > 64) {
      return sendJson(res, 400, { error: 'invalid-major' })
    }
    try {
      const info = await installJava(major)
      audit.record({
        source: 'webpanel',
        action: 'java.install',
        actor: user.username,
        ok: true,
        ip,
        target: String(major),
        detail: info.path
      })
      return sendJson(res, 200, info)
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      audit.record({
        source: 'webpanel',
        action: 'java.install',
        actor: user.username,
        ok: false,
        ip,
        target: String(major),
        detail: msg
      })
      return sendJson(res, 400, { error: msg })
    }
  }
  if (path === '/api/telemetry' && (method === 'GET' || method === 'POST')) {
    if (user.role !== 'owner') return sendJson(res, 403, { error: 'forbidden', need: 'owner' })
    if (method === 'GET') return sendJson(res, 200, metrics.telemetryConfig())
    const parsed = sanitizeTelemetryPatch(await readBody(req).catch(() => null))
    if (!parsed.ok) {
      audit.record({
        source: 'webpanel',
        action: 'telemetry.config',
        actor: user.username,
        ok: false,
        ip,
        target: parsed.field ?? '',
        detail: parsed.error
      })
      return sendJson(res, 400, { error: parsed.error, ...(parsed.field ? { field: parsed.field } : {}) })
    }
    updateConfig((c) => {
      c.telemetry = { ...metrics.telemetryConfig(), ...parsed.patch }
    })
    audit.record({
      source: 'webpanel',
      action: 'telemetry.config',
      actor: user.username,
      ok: true,
      ip,
      target: Object.keys(parsed.patch).join(',')
    })
    return sendJson(res, 200, metrics.telemetryConfig())
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
    // There is deliberately no `buy` here (#102). Buying belongs to the public
    // site, where the buyer is a player signed in with their own Minecraft name
    // and their own balance. This route spent currency on a `view` gate — the
    // scope granted to someone who should be able to look and nothing else —
    // and the panel's only caller was a Buy button sitting in what an operator
    // opens to check their own storefront. Removing the button and leaving the
    // route would keep the part that costs money.
    //
    // Breaking change for integrations: POST /api/v1/servers/{id}/store/buy is
    // gone rather than re-gated. A store-scoped key can already grant balance
    // and deliver rewards, so re-gating would only move the same capability
    // behind a name that does not describe it.
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
    // Rewards paid for and not yet handed over (#106). Holding them is only
    // acceptable if somebody can see the list and release them.
    if (rest === 'admin/pending' && method === 'GET') {
      if (!gate('store')) return
      return sendJson(res, 200, { pending: economy.pendingDeliveries(id) })
    }
    if (rest === 'admin/deliver' && method === 'POST') {
      if (!gate('store')) return
      const b = (await readBody(req).catch(() => ({}))) as { queueId?: string }
      const out = await economy.releaseDelivery(id, b.queueId ?? '', user.username)
      return sendJson(res, out.ok ? 200 : out.error === 'not-found' ? 404 : 409, out)
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
    // Reversible, unlike revoke. Pausing an integration and destroying a leaked
    // credential are different actions and must not share a button.
    if (path === '/api/keys/disabled' && method === 'POST') {
      const b = (await readBody(req).catch(() => ({}))) as { keyId?: string; disabled?: boolean }
      try {
        const k = apikeys.setKeyDisabled(b.keyId ?? '', !!b.disabled)
        audit.record({
          source: 'webpanel',
          action: b.disabled ? 'apikey.disable' : 'apikey.enable',
          actor: user.username,
          target: k.label,
          ok: true,
          ip
        })
        return sendJson(res, 200, k)
      } catch (e) {
        const why = String(e).includes('revoked') ? 'key-revoked' : 'key-not-found'
        return sendJson(res, why === 'key-revoked' ? 409 : 404, { error: why })
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

// ---- the map page (#146) ----
//
// Its own listener, so an operator can hand out the map without handing out the
// shop or the panel — a firewall rule rather than trust. Its own handler for the
// same reason the public site has one: the answer to "may this caller see this"
// is different here, and a shared handler with a mode flag is how a surface ends
// up returning another surface's payload.

function mapPageCfg(): MapPageConfig {
  return normalizeMapPage(getConfig().web?.mapPage)
}

/**
 * An install-specific salt for the map cookie, generated once and kept in
 * memory.
 *
 * In memory rather than on disk deliberately: restarting MSMS invalidates every
 * map cookie, which is a cheap way for an operator to shut a leaked link without
 * having to change the passphrase and tell everybody the new one. It never
 * protects anything at rest — the passphrase itself is stored in the clear
 * beside it, because a shared doorcode is something an operator has to be able
 * to read back.
 */
let mapSalt = ''
function mapPageSalt(): string {
  if (!mapSalt) mapSalt = randomBytes(16).toString('hex')
  return mapSalt
}

/**
 * The passphrase cookie. A hash of the passphrase and the install's own secret,
 * so the cookie cannot be recomputed from the passphrase alone by somebody who
 * guessed it elsewhere, and every install's cookies are worthless on any other.
 */
function mapPassToken(pass: string): string {
  return createHash('sha256').update(mapPageSalt()).update('.').update(pass).digest('hex').slice(0, 32)
}

function mapViewer(req: IncomingMessage, cfg: MapPageConfig): MapPageViewer {
  const cookies = String(req.headers.cookie ?? '')
  const m = /(?:^|;\s*)msms_map=([a-f0-9]{32})/.exec(cookies)
  const stored = getConfig().web?.mapPagePass ?? ''
  return {
    // Compared against the token for the CURRENT passphrase, so changing it
    // logs everybody out — which is the only thing changing it is for.
    passed: !!m && !!stored && m[1] === mapPassToken(stored),
    player: !!playerAuth.resolvePlayerSession(bearer(req) || mapPlayerCookie(req))
  }
}

/**
 * The map page signs players in ITSELF, and holds the session in a cookie.
 *
 * It cannot borrow the public site's. That token lives in `localStorage` under
 * `msms_ptoken`, and localStorage is per ORIGIN — a different port is a
 * different origin, so the map page on 8724 cannot read what the site on 8723
 * wrote, whatever the two agree to call it. Reaching for the site's token was
 * the first version of this and it made `players` a door that never opened.
 *
 * A cookie instead, set by this listener on its own origin. Cookies are not
 * isolated by port, which is a weakness elsewhere and the mechanism here.
 */
function mapPlayerCookie(req: IncomingMessage): string {
  const m = /(?:^|;\s*)msms_map_player=([^;]+)/.exec(String(req.headers.cookie ?? ''))
  return m ? decodeURIComponent(m[1]) : ''
}

async function handleMapPage(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method ?? 'GET'
  const cfg = mapPageCfg()
  const viewer = mapViewer(req, cfg)
  const ok = mapPageAllows(cfg, viewer)

  if (path === '/' && method === 'GET') {
    // The shell is served whatever the gate says — it IS the gate. The feeds
    // below are what actually refuse, so a visitor sees a door rather than a
    // blank page, and no map data rides along with it.
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(getMapPageHtml(cfg))
    return
  }
  if (path === '/api/map/state' && method === 'GET') {
    if (!cfg.enabled || !cfg.serverId) return sendJson(res, 404, { error: 'not-found' })
    // The access MODE is told to a visitor who is refused, because they need to
    // know which door they are standing at. Nothing else about the config is.
    return sendJson(res, 200, { allowed: ok, access: cfg.access })
  }
  if (path === '/api/map/open' && method === 'POST') {
    if (cfg.access !== 'password') return sendJson(res, 404, { error: 'not-found' })
    const b = (await readBody(req).catch(() => ({}))) as { pass?: string }
    const stored = getConfig().web?.mapPagePass ?? ''
    const given = String(b.pass ?? '')
    // Timing-safe, and only after both are known to be the same length —
    // `timingSafeEqual` throws on a mismatch, which is itself a length oracle.
    const a = Buffer.from(mapPassToken(given))
    const c = Buffer.from(mapPassToken(stored))
    const good = !!stored && a.length === c.length && timingSafeEqual(a, c)
    audit.record({
      source: 'public',
      action: 'mappage.open',
      actor: 'visitor',
      ok: good,
      ip: req.socket.remoteAddress ?? 'unknown',
      serverId: cfg.serverId
    })
    if (!good) return sendJson(res, 401, { error: 'bad-passphrase' })
    res.setHeader(
      'Set-Cookie',
      // HttpOnly: the page never reads this, only sends it. SameSite=Lax so a
      // link from elsewhere still opens the map, which is the whole use.
      `msms_map=${mapPassToken(stored)}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`
    )
    return sendJson(res, 200, { ok: true })
  }

  if (path === '/api/map/login' && method === 'POST') {
    if (cfg.access !== 'players') return sendJson(res, 404, { error: 'not-found' })
    const b = (await readBody(req).catch(() => ({}))) as { mcName?: string; password?: string }
    const r = playerAuth.login((b.mcName ?? '').trim(), b.password ?? '')
    audit.record({
      source: 'public',
      action: 'mappage.login',
      actor: (b.mcName ?? '').trim() || 'unknown',
      ok: r.ok,
      ip: req.socket.remoteAddress ?? 'unknown',
      serverId: cfg.serverId
    })
    if (!r.ok) return sendJson(res, 401, { error: 'invalid-credentials' })
    res.setHeader(
      'Set-Cookie',
      // Session-length, unlike the passphrase cookie: this one stands for a
      // person, and a person's session should not outlive their browser.
      `msms_map_player=${encodeURIComponent(r.token)}; Path=/; HttpOnly; SameSite=Lax`
    )
    return sendJson(res, 200, { ok: true, mcName: r.mcName })
  }

  // Everything below is data. One gate, checked here, for all of it.
  if (!ok) return sendJson(res, 403, { error: 'forbidden' })

  if (path === '/api/map' && method === 'GET') {
    const rt = processManager.getRuntime(cfg.serverId)
    const now = Date.now()
    // `players: false` means positions are not published at all — not that they
    // are hidden in the client, which is the same payload with a flag on it.
    const all = cfg.players && rt ? livePlayers(bridgePlayers(rt.bridge, now)) : []
    const dim = cfg.fixedDim || normalizeDimension(url.searchParams.get('dim') ?? 'overworld')
    const shown = redactPlayers(all.filter((p) => p.dim === dim), {
      ...PUBLIC_MAP_DEFAULTS,
      serverId: cfg.serverId,
      round: cfg.round,
      names: cfg.names,
      heads: cfg.heads && cfg.names
    })
    const cell = Math.min(512, Math.max(1, Number(url.searchParams.get('cell')) || 16))
    return sendJson(res, 200, {
      bridge: rt ? bridgeFresh(rt.bridge, now) : false,
      dimension: dim,
      dimensions: cfg.fixedDim ? [dim] : [...new Set(all.map((p) => p.dim))].sort(),
      pinned: !!cfg.fixedDim,
      players: shown,
      // From the ROUNDED positions: bounds derived from the exact ones publish a
      // tighter box than the dots inside it, and its corner is somebody's real
      // coordinate to within a pixel.
      bounds: mapBounds(shown.map((p) => ({ ...p, name: p.name ?? '', y: 0 }))),
      round: cfg.round,
      heads: cfg.heads && cfg.names,
      ...(cfg.heatmap ? { heatmap: heatmap(shown, cell), cell } : {}),
      loadOnPan: normalizeMapPerf(getServer(cfg.serverId)?.map).loadOnPan,
      at: now
    })
  }
  if (path === '/api/map/tiles' && method === 'GET') {
    if (!cfg.world) return sendJson(res, 404, { error: 'not-found' })
    const dim = cfg.fixedDim || normalizeDimension(url.searchParams.get('dim') ?? 'overworld')
    // Structures only when the operator published them, whatever the caller
    // asks for: where every dungeon is turns a map into a treasure map.
    return sendJson(
      res,
      200,
      tilesFor(cfg.serverId, dim, parseWanted(url.searchParams.get('c')), { marks: cfg.structures })
    )
  }
  if (path === '/api/map/areas' && method === 'GET') {
    if (!cfg.areas) return sendJson(res, 200, { areas: [] })
    const dim = cfg.fixedDim || normalizeDimension(url.searchParams.get('dim') ?? 'overworld')
    return sendJson(res, 200, { dimension: dim, areas: chunkAreas.listPublicAreas(cfg.serverId, dim) })
  }
  return sendJson(res, 404, { error: 'not-found' })
}

function webCfg(): Required<WebConfig> {
  const c = getConfig().web
  return {
    enabled: c?.enabled ?? false,
    port: c?.port ?? 8722,
    bindLan: c?.bindLan ?? false,
    siteEnabled: c?.siteEnabled ?? false,
    sitePort: c?.sitePort ?? 8723,
    mapPage: normalizeMapPage(c?.mapPage),
    mapPagePass: c?.mapPagePass ?? '',
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
  if (cfg.enabled) {
    server = listen(handlePanel, cfg.port, host, 'Web panel')
    // Only the admin listener. The public website has no credentials to check
    // an upgrade against, and nothing on it to stream.
    if (server) attachWs(server, () => webCfg().apiOrigins ?? [])
  }
  if (cfg.siteEnabled) siteServer = listen(handleSite, cfg.sitePort, host, 'Website')
  const mp = mapPageCfg()
  // Not started without a server chosen: a listener that answers 404 to
  // everything is a port open for nothing.
  if (mp.enabled && mp.serverId) mapServer = listen(handleMapPage, mp.port, host, 'Map page')
  return getWebStatus()
}

export function stopWebServer(): void {
  if (server) {
    // Before `close()`: an open upgrade is a socket the http server does not
    // track, so closing the listener leaves every stream connected and the
    // callback that waits for "no more connections" never fires.
    closeAllWs()
    server.close()
    server = null
  }
  if (siteServer) {
    siteServer.close()
    siteServer = null
  }
  if (mapServer) {
    mapServer.close()
    mapServer = null
  }
}

function urlsFor(port: number, bindLan: boolean): string[] {
  const urls = [`http://127.0.0.1:${port}`]
  if (bindLan) urls.push(...lanUrls(port))
  return urls
}

export function getWebStatus(): WebStatus {
  const cfg = webCfg()
  const mp = mapPageCfg()
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
    },
    map: {
      enabled: mp.enabled,
      running: !!mapServer && mapServer.listening,
      port: mp.port,
      urls: urlsFor(mp.port, cfg.bindLan)
    },
    mapPage: mp
  }
}

/** Start the web server on boot if enabled. */
export function initWebServer(): void {
  initAuth()
  playerAuth.initPlayerAuth()
  site.initSite()
  const cfg = webCfg()
  if (cfg.enabled || cfg.siteEnabled || mapPageCfg().enabled) startWebServer()
}
