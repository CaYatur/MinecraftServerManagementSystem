import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { createReadStream, existsSync } from 'node:fs'
import { join, extname, resolve, sep } from 'node:path'
import { getConfig } from '../config'
import { uploadsDir } from '../paths'
import { log } from '../logger'
import { listServers, getServer } from '../core/serverRegistry'
import { processManager } from '../core/processManager'
import { getPlayers } from '../core/players'
import * as metrics from '../core/metrics'
import * as events from '../core/events'
import * as audit from '../core/audit'
import * as economy from '../store/economy'
import * as site from './site'
import * as playerAuth from './playerAuth'
import { getPublicSiteHtml } from './publicSiteHtml'
import type { Product, SitePost } from '@shared/web'
import {
  initAuth,
  login,
  logout,
  resolveSession,
  can,
  visibleServerIds,
  type AuthUser
} from './auth'
import { getPanelHtml } from './panelHtml'
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

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers['authorization']
  if (h && h.startsWith('Bearer ')) return h.slice(7)
  return undefined
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
  const scopes: Scope[] = user.role === 'owner'
    ? (['view', 'console', 'power', 'players', 'files', 'backups', 'settings', 'store'] as Scope[])
    : user.perms[id] ?? []
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
    return sendJson(res, 200, economy.publicStore(sid))
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
  if (path.startsWith('/api/public/')) return handlePublic(path, method, req, res, ip)
  sendJson(res, 404, { error: 'not-found' })
}

// ---- ADMIN PANEL routing ----
async function handlePanel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'
  const ip = req.socket.remoteAddress ?? 'unknown'

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

  // ---- everything else requires a session ----
  const user = resolveSession(bearer(req))
  if (!user) return sendJson(res, 401, { error: 'unauthorized' })

  if (path === '/api/logout' && method === 'POST') {
    const tok = bearer(req)
    if (tok) logout(tok)
    return sendJson(res, 200, { ok: true })
  }

  if (path === '/api/me' && method === 'GET') {
    return sendJson(res, 200, { username: user.username, role: user.role })
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
      return sendJson(res, 200, economy.publicStore(id))
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
      return sendJson(res, result.ok ? 200 : result.error === 'insufficient' ? 402 : 400, result)
    }
    // ---- admin (store scope) ----
    if (rest === 'admin' && method === 'GET') {
      if (!gate('store')) return
      return sendJson(res, 200, {
        ...economy.getStoreConfig(id),
        balances: economy.listBalances(id)
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
        mode?: 'add' | 'set'
      }
      try {
        const balance =
          b.mode === 'set'
            ? economy.setBalance(id, b.mcName ?? '', Number(b.amount) || 0, user.username, b.reason ?? '')
            : economy.addBalance(id, b.mcName ?? '', Number(b.amount) || 0, user.username, b.reason ?? '')
        return sendJson(res, 200, { ok: true, balance })
      } catch (e) {
        return sendJson(res, 400, { error: String((e as Error)?.message ?? e) })
      }
    }
    if (rest === 'admin/ledger' && method === 'GET') {
      if (!gate('store')) return
      return sendJson(res, 200, {
        ledger: economy.getLedger(id, url.searchParams.get('mcName') ?? undefined),
        balances: economy.listBalances(id),
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
    // Existing uploads can be attached from the panel; uploading itself stays a
    // desktop-only action (no unauthenticated/large-body upload endpoint).
    if (path === '/api/site/uploads' && method === 'GET') {
      return sendJson(res, 200, { uploads: site.listUploads() })
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

  // ---- global audit log (owner only: entries carry player IPs, personal data) ----
  if (path.startsWith('/api/audit')) {
    if (user.role !== 'owner') return sendJson(res, 403, { error: 'forbidden', need: 'owner' })
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
      return sendJson(res, 200, audit.query({
        from: numOf('from'),
        to: numOf('to'),
        sources: csv('sources') as audit.AuditQuery['sources'],
        actions: csv('actions'),
        serverId: q.get('serverId') || undefined,
        actor: q.get('actor') || undefined,
        ip: q.get('ip') || undefined,
        text: q.get('text') || undefined,
        ok: okRaw == null ? undefined : okRaw === 'true',
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
    sitePort: c?.sitePort ?? 8723
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
