/**
 * Reading a world into the tile cache before anyone looks at it (#161).
 *
 * Nothing parsed a region until somebody looked at it, so the map was cold the
 * first time it was opened on a world MSMS had not seen — and the two paths are
 * far apart: about 1.4 s to parse a region against about 13 ms to read one back
 * from the cache. A viewport is four to nine regions, so first-open was seconds
 * and every open after it was a tenth of one.
 *
 * This closes that gap by doing the parsing when nobody is waiting.
 *
 * Three things it must not do, all of which it would do naively:
 *
 *  - fight the map. A visitor looking at the map has to win, so the warmer
 *    stands aside whenever the pool has interactive work queued.
 *  - stall the start. A big explored world is thousands of regions; this is
 *    bounded per pass and resumable, never a loop that has to finish.
 *  - ignore the operator. `cache: false` means the operator asked for nothing
 *    to be written, so there is nothing to warm.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeMapPerf } from '@shared/tileCache'
import { getServer } from './serverRegistry'
import { log } from '../logger'
import { poolBacklog, poolReady } from './tilePool'
import { cachedRegionIsCurrent, regionDirsForServer, warmOneRegion } from './worldTiles'

/**
 * Regions read per pass, per server.
 *
 * The point is that this finishes eventually while never being the reason
 * something else is slow. A pass of 24 at roughly a second each is under half a
 * minute of background work, then it stands down until the next tick.
 */
const PER_PASS = 24

/** How often a pass starts. Long, because this is housekeeping. */
const TICK_MS = 60_000

/** Servers already fully warmed, so a finished world costs one directory scan. */
const done = new Set<string>()
let timer: NodeJS.Timeout | null = null
let running = false

export function _resetTileWarm(): void {
  done.clear()
  running = false
}

/**
 * Region files worth reading, nearest to the origin first.
 *
 * Spawn is where players are and where a map is first pointed, so warming
 * outward from it means the useful part is ready long before the far corners a
 * world accumulates from one player who once walked a long way.
 */
export function warmOrder(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const out: { name: string; d: number }[] = []
  for (const name of names) {
    const m = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(name)
    if (!m) continue
    const rx = Number(m[1])
    const rz = Number(m[2])
    if (!Number.isFinite(rx) || !Number.isFinite(rz)) continue
    out.push({ name, d: Math.max(Math.abs(rx), Math.abs(rz)) })
  }
  // Then by name, so two runs over the same world agree on the order and a
  // resumed pass picks up where the last one stopped rather than at random.
  out.sort((a, b) => a.d - b.d || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out.map((o) => o.name)
}

/** One pass over one server. Returns how many regions it actually parsed. */
export async function warmServer(serverId: string, budget = PER_PASS): Promise<number> {
  const s = getServer(serverId)
  if (!s) return 0
  const perf = normalizeMapPerf(s.map)
  // Nothing to warm INTO. Parsing without a cache to write to would be pure
  // cost: the work would be thrown away the moment it left memory.
  if (!perf.cache) return 0
  if (!poolReady()) return 0

  let parsed = 0
  let looked = 0
  for (const { dim, dir } of regionDirsForServer(serverId)) {
    if (!existsSync(dir)) continue
    for (const name of warmOrder(dir)) {
      if (parsed >= budget) return parsed
      // The map is being used. Whatever a visitor is waiting for matters more
      // than this does, so stand aside and pick up on the next tick.
      if (poolBacklog() > 0) return parsed
      const path = join(dir, name)
      looked++
      let mtimeMs = 0
      try {
        mtimeMs = statSync(path).mtimeMs
      } catch {
        continue
      }
      // Already cached and still current — the common case on the second run,
      // and it costs one stat and one small read rather than a parse.
      if (cachedRegionIsCurrent(serverId, path, mtimeMs)) continue
      await warmOneRegion(serverId, path, dim, perf)
      parsed++
    }
  }
  // A whole sweep that parsed nothing means this world is cached. Remembered so
  // a finished world is one directory listing a minute, not a stat per region.
  if (parsed === 0 && looked > 0) done.add(serverId)
  return parsed
}

async function tick(): Promise<void> {
  if (running) return
  running = true
  try {
    const { listServers } = await import('./serverRegistry')
    for (const s of listServers()) {
      if (done.has(s.id)) continue
      const n = await warmServer(s.id)
      if (n > 0) log.info(`Tile cache: warmed ${n} region(s) of "${s.name}" in the background`)
    }
  } catch (err) {
    log.warn('Tile warming pass failed: ' + String((err as Error)?.message ?? err))
  } finally {
    running = false
  }
}

/**
 * Start warming.
 *
 * The first pass waits: a map that is opened in the first few seconds should
 * have the threads to itself, and nothing about this is urgent.
 */
export function startTileWarming(): void {
  if (timer) return
  timer = setInterval(() => void tick(), TICK_MS)
  // Not the reason the process stays alive.
  timer.unref?.()
}

export function stopTileWarming(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

/** A world that changed is worth looking at again. */
export function tileWarmingWake(serverId: string): void {
  done.delete(serverId)
}
