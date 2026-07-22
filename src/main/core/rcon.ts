import { Rcon } from 'rcon-client'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getServer } from './serverRegistry'
import { readProperties, writeProperties } from './serverFiles'
import { log } from '../logger'
import { PROXY_TYPES, TPS_TYPES } from '@shared/types'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Conn {
  rcon: Rcon
  tps: number | null
  tpsTimer?: NodeJS.Timeout
}

const conns = new Map<string, Conn>()
const connecting = new Set<string>()
const aborting = new Set<string>()

function propMap(id: string): Record<string, string> {
  return Object.fromEntries(readProperties(id).entries.map((e) => [e.key, e.value]))
}

/**
 * Make sure RCON is enabled in server.properties before the server starts, so the
 * app can drive the console (players, world controls, live TPS). Returns the port/pass,
 * or null when RCON isn't applicable (proxy / no properties file).
 */
export function ensureRconEnabled(id: string): { port: number; password: string } | null {
  const server = getServer(id)
  if (!server || PROXY_TYPES.includes(server.type)) return null
  if (!existsSync(join(server.path, 'server.properties'))) return null

  const map = propMap(id)
  const updates: Record<string, string> = {}
  if (map['enable-rcon'] !== 'true') updates['enable-rcon'] = 'true'
  let port = parseInt(map['rcon.port'] || '0', 10)
  if (!port) {
    port = 25575
    updates['rcon.port'] = String(port)
  }
  let password = map['rcon.password'] || ''
  if (!password) {
    password = randomBytes(12).toString('hex')
    updates['rcon.password'] = password
  }
  // Broadcasting rcon output to ops floods chat; keep it off.
  if (map['broadcast-rcon-to-ops'] === undefined) updates['broadcast-rcon-to-ops'] = 'false'
  if (Object.keys(updates).length) writeProperties(id, updates)
  return { port, password }
}

/** Connect (with retries) after the server reports ready. */
export async function connect(id: string): Promise<void> {
  if (conns.has(id) || connecting.has(id)) return
  const server = getServer(id)
  if (!server || PROXY_TYPES.includes(server.type)) return
  const map = propMap(id)
  if (map['enable-rcon'] !== 'true') return
  const port = parseInt(map['rcon.port'] || '25575', 10)
  const password = map['rcon.password'] || ''
  if (!password) return
  const host = map['server-ip']?.trim() || '127.0.0.1'

  connecting.add(id)
  aborting.delete(id)
  try {
    for (let i = 0; i < 12; i++) {
      if (aborting.has(id)) return // server stopped while we were retrying
      try {
        const rcon = await Rcon.connect({ host, port, password, timeout: 4000 })
        const conn: Conn = { rcon, tps: null }
        conns.set(id, conn)
        rcon.on('end', () => teardown(id))
        rcon.on('error', () => {})
        startTps(id)
        log.info(`RCON connected: ${server.name}`)
        return
      } catch {
        await sleep(1500)
      }
    }
    log.warn(`RCON could not connect for ${server.name}`)
  } finally {
    connecting.delete(id)
    aborting.delete(id)
  }
}

function teardown(id: string): void {
  const c = conns.get(id)
  if (!c) return
  if (c.tpsTimer) clearInterval(c.tpsTimer)
  conns.delete(id)
}

export function disconnect(id: string): void {
  // Abort any in-flight connect retry loop as well.
  if (connecting.has(id)) aborting.add(id)
  const c = conns.get(id)
  if (!c) return
  if (c.tpsTimer) clearInterval(c.tpsTimer)
  c.rcon.end().catch(() => {})
  conns.delete(id)
}

export function isConnected(id: string): boolean {
  return conns.has(id)
}

export async function command(id: string, cmd: string): Promise<string> {
  const c = conns.get(id)
  if (!c) throw new Error('rcon-not-connected')
  return c.rcon.send(cmd)
}

/** Best-effort send: RCON if available, else nothing. */
export async function tryCommand(id: string, cmd: string): Promise<string | null> {
  try {
    return await command(id, cmd)
  } catch {
    return null
  }
}

export interface OnlineList {
  online: number
  max: number
  names: string[]
}

export async function listPlayers(id: string): Promise<OnlineList> {
  const res = await command(id, 'list')
  const clean = res.replace(/§[0-9a-fk-or]/gi, '')
  const m = clean.match(/There are (\d+) of a max of (\d+) players online:?\s*(.*)/i)
  if (!m) return { online: 0, max: 0, names: [] }
  const names = m[3].trim()
    ? m[3]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []
  return { online: parseInt(m[1], 10), max: parseInt(m[2], 10), names }
}

function startTps(id: string): void {
  const server = getServer(id)
  if (!server || !TPS_TYPES.includes(server.type)) return
  const c = conns.get(id)
  if (!c) return
  const poll = async (): Promise<void> => {
    const r = await tryCommand(id, 'tps')
    if (!r) return
    const clean = r.replace(/§[0-9a-fk-or]/gi, '')
    // Paper: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 20.0" — take the FIRST
    // number AFTER the colon (a naive first-digit match grabs the "1" in "1m").
    const after = clean.slice(clean.lastIndexOf(':') + 1)
    const m = after.match(/(\d+(?:\.\d+)?)/)
    if (m) c.tps = Math.min(20, parseFloat(m[1]))
  }
  void poll()
  c.tpsTimer = setInterval(() => void poll(), 5000)
}

export function getTps(id: string): number | null {
  return conns.get(id)?.tps ?? null
}

export function disconnectAll(): void {
  for (const id of [...conns.keys()]) disconnect(id)
}
