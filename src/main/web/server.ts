import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { getConfig } from '../config'
import { log } from '../logger'
import { listServers, getServer } from '../core/serverRegistry'
import { processManager } from '../core/processManager'
import { getPlayers } from '../core/players'
import * as economy from '../store/economy'
import type { Product } from '@shared/web'
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
import type { Scope, WebStatus } from '@shared/web'

let server: Server | null = null

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
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    mcVersion: s.mcVersion,
    status: st.status,
    scopes
  }
}

// ---- routing ----
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'
  const ip = req.socket.remoteAddress ?? 'unknown'

  // ---- static panel (SPA) ----
  if (!path.startsWith('/api/')) {
    if (path === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
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
      return sendJson(res, 401, { error: 'invalid-credentials' })
    }
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
        return sendJson(res, 409, { error: 'server-not-running' })
      }
      return sendJson(res, 200, { ok: true })
    }
    if (sub === 'players' && method === 'GET') {
      if (!gate('players') && !can(user, id, 'view')) {
        return sendJson(res, 403, { error: 'forbidden', need: 'players' })
      }
      const players = await getPlayers(id)
      return sendJson(res, 200, { players })
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
      const b = (await readBody(req).catch(() => ({}))) as { mcName?: string; amount?: number }
      try {
        const balance = economy.addBalance(id, b.mcName ?? '', Number(b.amount) || 0)
        return sendJson(res, 200, { ok: true, balance })
      } catch (e) {
        return sendJson(res, 400, { error: String((e as Error)?.message ?? e) })
      }
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

export function startWebServer(): WebStatus {
  const cfg = getConfig().web ?? { enabled: false, port: 8722, bindLan: false }
  stopWebServer()
  initAuth()
  const host = cfg.bindLan ? '0.0.0.0' : '127.0.0.1'
  server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log.warn('web request error:', err)
      if (!res.headersSent) sendJson(res, 500, { error: 'server-error' })
    })
  })
  server.on('error', (err) => log.error('web server error:', err))
  server.listen(cfg.port, host, () => log.info(`Web panel on ${host}:${cfg.port}`))
  return getWebStatus()
}

export function stopWebServer(): void {
  if (server) {
    server.close()
    server = null
  }
}

export function getWebStatus(): WebStatus {
  const cfg = getConfig().web ?? { enabled: false, port: 8722, bindLan: false }
  const urls = [`http://127.0.0.1:${cfg.port}`]
  if (cfg.bindLan) urls.push(...lanUrls(cfg.port))
  return {
    running: !!server && server.listening,
    enabled: cfg.enabled,
    port: cfg.port,
    bindLan: cfg.bindLan,
    urls
  }
}

/** Start the web server on boot if enabled. */
export function initWebServer(): void {
  initAuth()
  if (getConfig().web?.enabled) startWebServer()
}
