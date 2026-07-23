/**
 * World manager — the folders on disk, grouped the way Minecraft actually
 * means them.
 *
 * The one thing to get right is that a "world" is not a folder with a
 * `level.dat` in it. Two layouts exist and both are normal:
 *
 *  - Bukkit/Spigot/Paper split the dimensions into SIBLING folders next to
 *    the overworld: `world`, `world_nether`, `world_the_end`. All three have
 *    their own `level.dat`.
 *  - Vanilla, Fabric and the Forge family keep them INSIDE the world as
 *    `DIM-1` (nether) and `DIM1` (the end).
 *
 * So on the most common server type, treating every `level.dat` as a world
 * shows one world three times - and worse, offers to delete its nether as if
 * it were independent. Here a world is a base folder plus whichever
 * dimensions belong to it, and every operation moves the whole set.
 *
 * `level-name` in server.properties is the single source of truth for which
 * world is active; nothing else decides it.
 */
import { existsSync, readdirSync, rmSync, statSync, type Dirent } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import * as nbt from 'prismarine-nbt'
import { getServer } from './serverRegistry'
import { readProperties, writeProperties } from './serverFiles'
import { processManager } from './processManager'
import * as events from './events'
import { log } from '../logger'
import type { WorldDimension, WorldInfo } from '@shared/types'

const NETHER_SUFFIX = '_nether'
const END_SUFFIX = '_the_end'

function serverRoot(id: string): string {
  const s = getServer(id)
  if (!s) throw new Error('server-not-found')
  return resolve(s.path)
}

/** Same contract as serverFiles' `safe`: never leave the server folder. */
function safeWorldPath(root: string, name: string): string {
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('invalid-name')
  const p = resolve(join(root, name))
  if (p !== root && !p.startsWith(root + sep)) throw new Error('path-escape')
  return p
}

export function activeWorldName(id: string): string {
  const map = Object.fromEntries(readProperties(id).entries.map((e) => [e.key, e.value]))
  return map['level-name'] || 'world'
}

function isWorldFolder(dir: string): boolean {
  return existsSync(join(dir, 'level.dat'))
}

/** Recursive size, yielding to the event loop - a world can be gigabytes. */
async function folderSize(dir: string): Promise<number> {
  let total = 0
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      total += await folderSize(full)
    } else {
      try {
        total += statSync(full).size
      } catch {
        /* vanished mid-walk */
      }
    }
    // Region files come in hundreds; let the UI breathe between them.
    if (total % 64 === 0) await Promise.resolve()
  }
  return total
}

/**
 * NBT longs do not fit in a JS number, so they arrive as a [high, low] pair.
 * World seeds routinely use the full 64 bits and are signed.
 */
function seedToString(v: unknown): string | undefined {
  if (typeof v === 'bigint' || typeof v === 'number') return String(v)
  if (typeof v === 'string' && v.trim()) return v
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
    return BigInt.asIntN(64, (BigInt(v[0]) << 32n) | BigInt(v[1] >>> 0)).toString()
  }
  return undefined
}

/**
 * Read what the level.dat will admit to. Best effort on purpose: the seed
 * moved between versions (`RandomSeed` -> `WorldGenSettings.seed`) and a
 * half-written level.dat must never take the whole list down with it.
 */
async function readLevelDat(dir: string): Promise<Pick<WorldInfo, 'seed' | 'gameMode' | 'hardcore' | 'version'>> {
  const out: Pick<WorldInfo, 'seed' | 'gameMode' | 'hardcore' | 'version'> = {}
  try {
    const parsed = await nbt.parse(await readFile(join(dir, 'level.dat')))
    const data = nbt.simplify(parsed.parsed) as Record<string, unknown>
    const d = (data.Data ?? {}) as Record<string, unknown>
    const seed = seedToString(
      d.RandomSeed ?? (d.WorldGenSettings as Record<string, unknown> | undefined)?.seed
    )
    if (seed !== undefined) out.seed = seed
    if (typeof d.GameType === 'number') out.gameMode = d.GameType
    if (typeof d.hardcore === 'number') out.hardcore = d.hardcore === 1
    const ver = d.Version as Record<string, unknown> | undefined
    if (ver && typeof ver.Name === 'string') out.version = ver.Name
  } catch (err) {
    log.debug('level.dat unreadable:', err)
  }
  return out
}

function dimensionsOf(root: string, base: string): WorldDimension[] {
  const dims: WorldDimension[] = ['overworld']
  const dir = join(root, base)
  if (existsSync(join(root, base + NETHER_SUFFIX)) || existsSync(join(dir, 'DIM-1'))) {
    dims.push('nether')
  }
  if (existsSync(join(root, base + END_SUFFIX)) || existsSync(join(dir, 'DIM1'))) {
    dims.push('end')
  }
  return dims
}

/**
 * Every folder that belongs to one world: the base plus its sibling
 * dimensions. Used by delete so a world never leaves half of itself behind.
 */
export function worldFolders(root: string, base: string): string[] {
  return [base, base + NETHER_SUFFIX, base + END_SUFFIX]
    .map((n) => join(root, n))
    .filter((p) => existsSync(p))
}

/** Base world names, with the sibling dimension folders folded away. */
export function worldNames(root: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
  const present = new Set(entries)
  return entries
    .filter((name) => {
      if (!isWorldFolder(join(root, name))) return false
      // `world_nether` is a dimension of `world`, not a world - unless the
      // overworld it claims to belong to does not exist, in which case it is
      // a world in its own right and hiding it would lose it.
      for (const suffix of [NETHER_SUFFIX, END_SUFFIX]) {
        if (name.endsWith(suffix) && present.has(name.slice(0, -suffix.length))) return false
      }
      return true
    })
    .sort((a, b) => a.localeCompare(b))
}

export async function listWorlds(id: string): Promise<WorldInfo[]> {
  const root = serverRoot(id)
  const active = activeWorldName(id)
  const out: WorldInfo[] = []
  for (const name of worldNames(root)) {
    const dir = join(root, name)
    let size = 0
    for (const folder of worldFolders(root, name)) size += await folderSize(folder)
    let lastPlayed = 0
    try {
      lastPlayed = statSync(join(dir, 'level.dat')).mtimeMs
    } catch {
      /* keep 0 */
    }
    out.push({
      name,
      active: name === active,
      sizeBytes: size,
      lastPlayed,
      dimensions: dimensionsOf(root, name),
      ...(await readLevelDat(dir))
    })
  }
  // Active first, then most recently played.
  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.lastPlayed - a.lastPlayed)
}

// ------------------------------------------------------------------ mutations
//
// The guards live here rather than in the UI. A confirm dialog is a courtesy;
// this is the part that has to be true however the call arrives - IPC, the web
// panel later, or a test.

function assertStopped(id: string): void {
  // Windows keeps handles open on a running world, and a delete part-way
  // through a region write corrupts what survives.
  if (processManager.isRunning(id)) throw new Error('server-running')
}

/** Point server.properties at another world. Takes effect on next start. */
export function activateWorld(id: string, name: string): void {
  const root = serverRoot(id)
  assertStopped(id)
  const dir = safeWorldPath(root, name)
  if (!isWorldFolder(dir)) throw new Error('world-not-found')
  if (name === activeWorldName(id)) return
  writeProperties(id, { 'level-name': name })
  events.record(id, 'world.activated', { text: name })
  log.info(`World "${name}" activated for ${id}`)
}

/** Delete a world and every dimension folder that belongs to it. */
export function deleteWorld(id: string, name: string): void {
  const root = serverRoot(id)
  assertStopped(id)
  const dir = safeWorldPath(root, name)
  if (!isWorldFolder(dir)) throw new Error('world-not-found')
  // Deleting what the server is configured to load would leave it generating
  // a brand new world on next start - almost never what was meant.
  if (name === activeWorldName(id)) throw new Error('world-is-active')

  const folders = worldFolders(root, name)
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
  events.record(id, 'world.deleted', { text: name, data: { folders: folders.length } })
  log.info(`World "${name}" deleted for ${id} (${folders.length} folder(s))`)
}
