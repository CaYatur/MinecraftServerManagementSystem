import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as nbt from 'prismarine-nbt'
import { getServer } from './serverRegistry'
import { readProperties } from './serverFiles'
import { processManager } from './processManager'
import * as rcon from './rcon'
import { log } from '../logger'
import type { PlayerInfo } from '@shared/types'

function readJson<T>(file: string): T | null {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as T) : null
  } catch {
    return null
  }
}

function levelName(id: string): string {
  const map = Object.fromEntries(readProperties(id).entries.map((e) => [e.key, e.value]))
  return map['level-name'] || 'world'
}

interface CacheEntry {
  name: string
  uuid: string
}
interface OpEntry {
  uuid: string
  name: string
  level: number
}
interface BanEntry {
  uuid: string
  name: string
  reason?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tag(v: any): any {
  return v?.value
}

async function readPlayerData(file: string, p: PlayerInfo): Promise<void> {
  try {
    const { parsed } = await nbt.parse(readFileSync(file))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (parsed as any).value
    const pos = v?.Pos?.value?.value
    if (Array.isArray(pos)) {
      p.position = {
        x: Math.round(pos[0]),
        y: Math.round(pos[1]),
        z: Math.round(pos[2]),
        dimension: tag(v.Dimension)
      }
    }
    if (v?.Health) p.health = Math.round(tag(v.Health))
    if (v?.foodLevel) p.food = tag(v.foodLevel)
    if (v?.XpLevel) p.xpLevel = tag(v.XpLevel)
    p.lastSeen = statSync(file).mtimeMs
  } catch {
    /* ignore unreadable */
  }
}

export async function getPlayers(id: string): Promise<PlayerInfo[]> {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')
  const root = server.path
  const level = levelName(id)

  const usercache = readJson<CacheEntry[]>(join(root, 'usercache.json')) ?? []
  const ops = readJson<OpEntry[]>(join(root, 'ops.json')) ?? []
  const whitelist = readJson<CacheEntry[]>(join(root, 'whitelist.json')) ?? []
  const banned = readJson<BanEntry[]>(join(root, 'banned-players.json')) ?? []

  const runtime = processManager.getRuntime(id)
  const onlineNames = new Set(runtime?.players.names ?? [])
  const ips = runtime?.ips ?? {}

  const byUuid = new Map<string, PlayerInfo>()
  const ensure = (uuid: string, name: string): PlayerInfo => {
    const key = uuid || 'name:' + name
    let p = byUuid.get(key)
    if (!p) {
      p = { uuid, name, online: false, op: false, whitelisted: false, banned: false }
      byUuid.set(key, p)
    }
    if (name) p.name = name
    return p
  }

  for (const u of usercache) ensure(u.uuid, u.name)
  for (const o of ops) {
    const p = ensure(o.uuid, o.name)
    p.op = true
    p.opLevel = o.level
  }
  for (const w of whitelist) ensure(w.uuid, w.name).whitelisted = true
  for (const b of banned) {
    const p = ensure(b.uuid, b.name)
    p.banned = true
    p.banReason = b.reason
  }

  // Online players may not be in usercache yet.
  for (const name of onlineNames) {
    if (![...byUuid.values()].some((p) => p.name === name)) ensure('', name)
  }

  for (const p of byUuid.values()) {
    if (onlineNames.has(p.name)) p.online = true
    if (ips[p.name]) p.ip = ips[p.name]
    if (p.uuid) {
      const dat = join(root, level, 'playerdata', p.uuid + '.dat')
      if (existsSync(dat)) await readPlayerData(dat, p)
      const stats = readJson<{ stats?: Record<string, Record<string, number>> }>(
        join(root, level, 'stats', p.uuid + '.json')
      )
      const custom = stats?.stats?.['minecraft:custom']
      const ticks = custom?.['minecraft:play_time'] ?? custom?.['minecraft:play_one_minute']
      if (ticks) p.playtimeHours = Math.round((ticks / 20 / 3600) * 10) / 10
    }
  }

  return [...byUuid.values()].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

// ---- actions ----
async function route(id: string, cmd: string): Promise<void> {
  if (rcon.isConnected(id)) {
    await rcon.command(id, cmd)
    return
  }
  if (processManager.isRunning(id)) {
    processManager.sendCommand(id, cmd)
    return
  }
  throw new Error('requires-running')
}

function editArray<T>(file: string, mutate: (arr: T[]) => T[]): void {
  const arr = readJson<T[]>(file) ?? []
  writeFileSync(file, JSON.stringify(mutate(arr), null, 2), 'utf-8')
}

const running = (id: string): boolean => processManager.isRunning(id)

export async function setOp(id: string, p: PlayerInfo, on: boolean): Promise<void> {
  if (running(id)) return route(id, `${on ? 'op' : 'deop'} ${p.name}`)
  const server = getServer(id)!
  const file = join(server.path, 'ops.json')
  if (!p.uuid) throw new Error('uuid-unknown')
  editArray<OpEntry>(file, (arr) =>
    on
      ? arr.some((o) => o.uuid === p.uuid)
        ? arr
        : [...arr, { uuid: p.uuid, name: p.name, level: 4 }]
      : arr.filter((o) => o.uuid !== p.uuid)
  )
}

export async function setWhitelist(id: string, p: PlayerInfo, on: boolean): Promise<void> {
  if (running(id)) return route(id, `whitelist ${on ? 'add' : 'remove'} ${p.name}`)
  const server = getServer(id)!
  const file = join(server.path, 'whitelist.json')
  if (!p.uuid) throw new Error('uuid-unknown')
  editArray<CacheEntry>(file, (arr) =>
    on
      ? arr.some((w) => w.uuid === p.uuid)
        ? arr
        : [...arr, { uuid: p.uuid, name: p.name }]
      : arr.filter((w) => w.uuid !== p.uuid)
  )
}

export async function setBan(id: string, p: PlayerInfo, on: boolean, reason?: string): Promise<void> {
  if (running(id)) {
    return route(id, on ? `ban ${p.name} ${reason ?? ''}`.trim() : `pardon ${p.name}`)
  }
  const server = getServer(id)!
  const file = join(server.path, 'banned-players.json')
  if (!p.uuid) throw new Error('uuid-unknown')
  editArray<BanEntry & { created?: string; source?: string; expires?: string }>(file, (arr) =>
    on
      ? [
          ...arr.filter((b) => b.uuid !== p.uuid),
          {
            uuid: p.uuid,
            name: p.name,
            created: new Date().toISOString(),
            source: 'MSMS',
            expires: 'forever',
            reason: reason || 'Banned by an operator.'
          }
        ]
      : arr.filter((b) => b.uuid !== p.uuid)
  )
}

export async function kick(id: string, p: PlayerInfo, reason?: string): Promise<void> {
  await route(id, `kick ${p.name} ${reason ?? ''}`.trim())
}

export async function setGamemode(id: string, p: PlayerInfo, gm: string): Promise<void> {
  await route(id, `gamemode ${gm} ${p.name}`)
}

// ---- world / game controls (running only) ----
export async function worldControl(id: string, cmd: string): Promise<void> {
  await route(id, cmd)
  log.debug('worldControl', id, cmd)
}
