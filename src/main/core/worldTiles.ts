/**
 * Turning region files into map tiles (#119).
 *
 * One tile is one chunk: 16x16 columns, each carrying the colour of its topmost
 * visible block and that block's height. The height is not decoration — the
 * renderer shades by the difference to the neighbouring column, which is what
 * makes terrain look like terrain rather than like a colour chart.
 *
 * Everything expensive is here and nothing expensive is on a request path: a
 * region is parsed once, kept in memory keyed by its mtime, and re-parsed only
 * when the world writes it. A visitor must never be able to make the process
 * parse a region synchronously — that is the amplification closed in #107, and
 * a region is three orders of magnitude more work than a player file.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { cacheDir } from '../paths'
import { MAX_TILES_PER_REQUEST } from '@shared/livemap'
import { decodeRegionTiles, encodeRegionTiles, normalizeMapPerf } from '@shared/tileCache'
import type { MapPerfConfig } from '@shared/tileCache'
import { getServer } from './serverRegistry'
import { readProperties } from './serverFiles'
import { log } from '../logger'
import { chunkSlot, localChunk, parseLocationTable, regionOf } from '@shared/regionFormat'
import { parseSlot, SECTOR_HEADER } from './regionParse'
import { parseOnWorker, poolReady } from './tilePool'
import type { ChunkTile } from './regionParse'
import type { StructureMark } from '@shared/regionFormat'

// The parse itself lives in `regionParse.ts`, which knows nothing about
// Electron so a worker thread can run it (#160).
export type { ChunkTile } from './regionParse'
export { tileFromChunk } from './regionParse'

interface RegionEntry {
  at: number
  mtimeMs: number
  /** Chunk slot -> tile, or null for a chunk that has never been generated. */
  tiles: Map<number, ChunkTile | null>
}

const regions = new Map<string, RegionEntry>()

/**
 * The tuning for the server whose region is being read.
 *
 * Looked up per call rather than captured: an operator changing the setting
 * should not have to restart to see it take effect, and these are cheap reads
 * off the in-memory config.
 */
function perfFor(serverId: string): MapPerfConfig {
  return normalizeMapPerf(getServer(serverId)?.map)
}

export function _resetWorldTiles(): void {
  regions.clear()
  resolvedDirs.clear()
}

// ---- the on-disk cache (#133) ----
//
// #119 kept parsed regions in memory only, so every restart re-parsed the
// world. Measured on a 4 MB region of 1024 chunks: 0.6 s to decompress and
// parse the NBT, and 0.8 s more to extract the surfaces — 1.5 s in total, and
// 14 s before #157. The encoded form of the same region reads back in about
// 16 ms, which is the whole reason this exists.

function cacheDirFor(): string {
  return ensureDir(join(cacheDir(), 'worldtiles'))
}

function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true })
  return p
}

/**
 * A stable filename for a region path.
 *
 * Hashed rather than sanitised: a region path contains drive letters, colons
 * and separators, and every scheme for flattening those into a filename either
 * collides or produces something unreadable. The version is in the CONTENT, not
 * the name, so a stale file is refused on read and then overwritten rather than
 * accumulating one file per version.
 */
function cacheFileFor(serverId: string, path: string): string {
  // The server id is a visible PREFIX rather than part of the hash, because
  // "clear this server's cache" has to be answerable from the filenames alone —
  // a hash cannot be reversed, so a single hashed key made the clear button
  // wipe every server's cache while claiming to clear one.
  const owner = createHash('sha1').update(serverId).digest('hex').slice(0, 12)
  return join(cacheDirFor(), owner + '-' + createHash('sha1').update(path).digest('hex') + '.tiles')
}

function readCachedRegion(serverId: string, path: string, mtimeMs: number): RegionEntry | null {
  try {
    const f = cacheFileFor(serverId, path)
    if (!existsSync(f)) return null
    const decoded = decodeRegionTiles(gunzipSync(readFileSync(f)))
    // The mtime says the world has not changed; the version inside the file
    // says we still draw it the same way. Both have to hold.
    if (!decoded || decoded.mtimeMs !== mtimeMs) return null
    return { at: Date.now(), mtimeMs, tiles: new Map(decoded.tiles) }
  } catch {
    // A corrupt or half-written cache is not an error, it is a cache miss.
    return null
  }
}

function writeCachedRegion(serverId: string, path: string, entry: RegionEntry): void {
  try {
    const usable = new Map<number, ChunkTile>()
    for (const [slot, tile] of entry.tiles) if (tile) usable.set(slot, tile)
    writeCachedBuffer(
      serverId,
      path,
      gzipSync(encodeRegionTiles({ mtimeMs: entry.mtimeMs, tiles: usable }), { level: 6 })
    )
  } catch {
    /* a cache that cannot be written still leaves a working map */
  }
}

/**
 * The same write, given the encoded bytes rather than the tiles.
 *
 * A worker already produced exactly this buffer, and re-encoding it here would
 * be doing on the main thread the work the worker exists to take off it (#160).
 */
function writeCachedBuffer(serverId: string, path: string, buf: Uint8Array): void {
  try {
    writtenSinceSweep += buf.length
    const f = cacheFileFor(serverId, path)
    // Through a temp file: a reader hitting a half-written cache would decode
    // garbage, and "garbage" here means a wrong map rather than an error.
    writeFileSync(f + '.tmp', buf)
    renameSync(f + '.tmp', f)
  } catch {
    /* a cache that cannot be written still leaves a working map */
  }
}

/**
 * Keep the cache under its ceiling, oldest first.
 *
 * Swept after a write rather than on a timer: the only moment it can grow is
 * the moment something was added, and a timer would be one more thing running
 * in a process that already has enough of them.
 */
/**
 * Bytes added since the last sweep.
 *
 * A sweep stats every file in the directory, and doing that after each region
 * means a directory scan per parse — a cost inside the thing that exists to
 * remove cost. Only worth doing once enough has been added to matter.
 */
let writtenSinceSweep = 0
const SWEEP_AFTER_BYTES = 32 * 1024 * 1024

function sweepCache(limitMB: number): void {
  if (writtenSinceSweep < SWEEP_AFTER_BYTES) return
  writtenSinceSweep = 0
  try {
    const dir = cacheDirFor()
    const files = readdirSync(dir)
      .filter((n) => n.endsWith('.tiles'))
      .map((n) => {
        const p = join(dir, n)
        const s = statSync(p)
        return { p, size: s.size, at: s.mtimeMs }
      })
    let total = files.reduce((a, f) => a + f.size, 0)
    const limit = limitMB * 1024 * 1024
    if (total <= limit) return
    for (const f of files.sort((a, b) => a.at - b.at)) {
      if (total <= limit) break
      rmSync(f.p, { force: true })
      total -= f.size
    }
  } catch {
    /* sweeping is housekeeping; failing at it must not fail a map */
  }
}

/** Drop cached regions for one server, or every server when given nothing. */
export function clearTileCache(serverId?: string): number {
  let n = 0
  try {
    const dir = cacheDirFor()
    const prefix = serverId ? createHash('sha1').update(serverId).digest('hex').slice(0, 12) + '-' : ''
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.tiles') || !name.startsWith(prefix)) continue
      rmSync(join(dir, name), { force: true })
      n++
    }
  } catch {
    /* nothing to clear */
  }
  // The memory cache is keyed by region path with no owner, so it goes whole.
  // Dropping too much of an optimisation is free; keeping a stale entry is not.
  regions.clear()
  return n
}

/** Matches the private copies in players.ts and backups.ts. */
function levelName(id: string): string {
  const map = Object.fromEntries(readProperties(id).entries.map((e) => [e.key, e.value]))
  return map['level-name'] || 'world'
}

/**
 * Where a dimension's region files live — and there is no single answer.
 *
 * Vanilla keeps them under one world folder: `world/DIM-1/region`. Bukkit and
 * everything descended from it (Paper, Purpur, Spigot) split them into sibling
 * folders instead: `world_nether/DIM-1/region`, `world_the_end/DIM1/region`.
 * MSMS only ever built the vanilla path, so on a Paper server — the type this
 * app is most used with — the nether and the end resolved to a folder that does
 * not exist and every tile lookup missed. Neither has ever rendered.
 *
 * Anything else is a custom world (Multiverse and friends), which is its own
 * top-level folder with a plain `region` inside it.
 *
 * Ordered candidates rather than a guess, because the layout is a property of
 * the server software and MSMS manages several kinds at once.
 */
function regionDirCandidates(serverId: string, dim: string): string[] {
  const s = getServer(serverId)
  if (!s) return []
  const level = levelName(serverId)
  if (dim === 'overworld') return [join(s.path, level, 'region')]
  if (dim === 'nether') {
    return [join(s.path, level + '_nether', 'DIM-1', 'region'), join(s.path, level, 'DIM-1', 'region')]
  }
  if (dim === 'end') {
    return [join(s.path, level + '_the_end', 'DIM1', 'region'), join(s.path, level, 'DIM1', 'region')]
  }
  // A custom world. The name is not trusted — it arrives from a bridge message
  // and is about to become a path segment.
  const safe = dim.replace(/[^A-Za-z0-9_.-]/g, '')
  if (!safe || safe === '.' || safe === '..') return []
  return [join(s.path, safe, 'region'), join(s.path, safe, 'DIM-1', 'region'), join(s.path, safe, 'DIM1', 'region')]
}

/**
 * Which candidate directory this server actually uses, remembered.
 *
 * Resolving means an `existsSync` per candidate, and `peekChunkTile` runs once
 * per requested chunk — 64 a request, three candidates each. The layout is a
 * property of the server software and does not change while it runs.
 */
const resolvedDirs = new Map<string, string>()

function regionDirFor(serverId: string, dim: string): string | null {
  const key = serverId + '|' + dim
  const hit = resolvedDirs.get(key)
  if (hit) return hit
  const dirs = regionDirCandidates(serverId, dim)
  for (const d of dirs) {
    if (existsSync(d)) {
      resolvedDirs.set(key, d)
      return d
    }
  }
  // Nothing on disk yet. Answer with the first candidate rather than null, so a
  // caller reports a definite miss instead of "unknown" — "unknown" is what
  // makes a chunk get requested forever.
  return dirs[0] ?? null
}

function regionPath(serverId: string, dim: string, rx: number, rz: number): string | null {
  const dir = regionDirFor(serverId, dim)
  return dir ? join(dir, `r.${rx}.${rz}.mca`) : null
}


/**
 * The smallest gap between two region parses.
 *
 * The queue that feeds this yields between CHUNKS, which sounded like enough
 * and is not: the first chunk of an unseen region parses the whole file — up to
 * 1024 chunks of NBT — in one uninterrupted go. A visitor panning across an
 * explored world queues chunks from dozens of regions, and back-to-back parses
 * would hold the main thread for seconds at a time, which is the same thread
 * the console reader, the metrics timer and every other request live on.
 *
 * One region every quarter second still fills a viewport in a few seconds and
 * leaves the process responsive between them.
 */
const REGION_PARSE_GAP_MS = 250
let lastParseAt = 0

/** Whether a parse is allowed to start right now. */
export function parseBudgetReady(serverId?: string, now = Date.now()): boolean {
  const gap = serverId ? perfFor(serverId).parseGapMs : REGION_PARSE_GAP_MS
  return now - lastParseAt >= gap
}

/**
 * Parse one region file, or return the cached parse.
 *
 * Synchronous and slow by design — the callers are expected to keep this off
 * any request path, and to respect `parseBudgetReady`.
 */

/**
 * How many of a region's 1024 chunks to parse before letting the event loop
 * run.
 *
 * The main process serves every IPC call, so parsing a region in a single pass
 * freezes the whole app for as long as it takes — the console stops reading,
 * stats stop arriving, and the interface stutters while the map loads. Slicing
 * does not make the work shorter; it makes it interruptible, which is the part
 * that was hurting.
 *
 * 32 was chosen against a measurement of 180 ms a region, which was wrong: that
 * was the decompress and the NBT parse, about 4% of the real cost, and a region
 * actually took 14 seconds (#157). The same 32 slots were therefore blocking
 * for around 600 ms each, ten times the limit the smoke asserts — it did not
 * catch it because its fixture had no sections to render.
 *
 * A region is now about 1.5 s here, so 4 slots is around 6 ms in steady state.
 * 8 would be enough for that, and is not enough for the FIRST region a process
 * parses: measured over five runs, the first blocks for 40 ms against 15-19 ms
 * for every one after it, because V8 has not optimised these loops yet. The
 * first is the one an operator meets — they open the map, and it is the only
 * parse that has happened. Sized for that rather than for the average.
 *
 * The price is 256 event-loop turns per region instead of 32, and a
 * `setImmediate` costs microseconds.
 */
const SLICE_SLOTS = 4

function loadRegion(
  serverId: string,
  path: string,
  dim: string,
  perf: MapPerfConfig
): RegionEntry | null {
  if (!existsSync(path)) return null
  let mtimeMs = 0
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    return null
  }
  const hit = regions.get(path)
  if (hit && hit.mtimeMs === mtimeMs) {
    hit.at = Date.now()
    return hit
  }

  // Disk before work. A region the server has not rewritten is the same region,
  // and re-parsing it is the cost this whole cache exists to avoid.
  if (perf.cache) {
    const cached = readCachedRegion(serverId, path, mtimeMs)
    if (cached) {
      regions.set(path, cached)
      trimMemory(perf.memoryRegions)
      return cached
    }
  }

  lastParseAt = Date.now()
  /**
   * A region that cannot be read is remembered as EMPTY rather than as "not
   * read yet".
   *
   * Returning null leaves `peekChunkTile` answering `undefined` forever, so the
   * client keeps asking, the queue keeps re-running it, and the chunk never
   * resolves — one unreadable region file is a permanent polling loop. An empty
   * entry is honest (there is nothing to draw) and terminates.
   */
  const giveUp = (): RegionEntry => {
    const empty: RegionEntry = { at: Date.now(), mtimeMs, tiles: new Map() }
    regions.set(path, empty)
    return empty
  }

  let file: Buffer
  try {
    file = readFileSync(path)
  } catch {
    return giveUp()
  }
  if (file.length < SECTOR_HEADER) return giveUp()

  const table = parseLocationTable(file.subarray(0, 4096))
  const tiles = new Map<number, ChunkTile | null>()
  for (let slot = 0; slot < table.length; slot++) parseSlot(file, table, slot, tiles, dim)

  const entry: RegionEntry = { at: Date.now(), mtimeMs, tiles }
  regions.set(path, entry)
  trimMemory(perf.memoryRegions)
  if (perf.cache) {
    writeCachedRegion(serverId, path, entry)
    sweepCache(perf.cacheLimitMB)
  }
  log.info(`World tiles: parsed ${tiles.size} chunks from ${path.split(/[\\/]/).pop()}`)
  return entry
}

/**
 * The same parse, in slices, with the event loop running in between.
 *
 * Only the queue calls this — a request path must never parse at all. The
 * synchronous `loadRegion` stays for callers that cannot await, and the two
 * produce the same entry: the smoke parses one region both ways and compares
 * every chunk.
 */
async function loadRegionSliced(
  serverId: string,
  path: string,
  dim: string,
  perf: MapPerfConfig
): Promise<RegionEntry | null> {
  if (!existsSync(path)) return null
  let mtimeMs = 0
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    return null
  }
  const hit = regions.get(path)
  if (hit && hit.mtimeMs === mtimeMs) {
    hit.at = Date.now()
    return hit
  }
  if (perf.cache) {
    const cached = readCachedRegion(serverId, path, mtimeMs)
    if (cached) {
      regions.set(path, cached)
      trimMemory(perf.memoryRegions)
      return cached
    }
  }

  lastParseAt = Date.now()
  const giveUp = (): RegionEntry => {
    const empty: RegionEntry = { at: Date.now(), mtimeMs, tiles: new Map() }
    regions.set(path, empty)
    return empty
  }

  // A worker thread if there is one (#160). The parse is about 1.4 s and this
  // thread answers every IPC call, serves the web panel and reads the console;
  // slicing made that interruptible, not absent. Off-thread it is absent, and
  // several regions parse at once.
  //
  // The worker hands back the ENCODED region, already gzipped, which is also
  // exactly what the disk cache stores — so a hit costs one decode either way
  // and nothing rebuilds 1024 objects across a thread boundary.
  if (poolReady()) {
    const r = await parseOnWorker(path, dim)
    if (!r.error && r.buf) {
      const decoded = decodeRegionTiles(gunzipSync(r.buf))
      if (decoded) {
        const entry: RegionEntry = { at: Date.now(), mtimeMs: r.mtimeMs, tiles: new Map(decoded.tiles) }
        regions.set(path, entry)
        trimMemory(perf.memoryRegions)
        if (perf.cache) {
          writeCachedBuffer(serverId, path, r.buf)
          sweepCache(perf.cacheLimitMB)
        }
        // Nothing blocked this thread, so there is no slice to report.
        lastSliceMs = 0
        log.info(`World tiles: parsed ${r.chunks} chunks from ${path.split(/[\/]/).pop()} on a worker`)
        return entry
      }
    }
    if (r.error === 'unreadable') return giveUp()
    // Anything else falls through to the on-thread parse below rather than
    // showing the operator an empty map.
  }

  let file: Buffer
  try {
    file = readFileSync(path)
  } catch {
    return giveUp()
  }
  if (file.length < SECTOR_HEADER) return giveUp()

  const table = parseLocationTable(file.subarray(0, 4096))
  const tiles = new Map<number, ChunkTile | null>()
  let longest = 0
  for (let from = 0; from < table.length; from += SLICE_SLOTS) {
    const t0 = Date.now()
    const to = Math.min(table.length, from + SLICE_SLOTS)
    for (let slot = from; slot < to; slot++) parseSlot(file, table, slot, tiles, dim)
    longest = Math.max(longest, Date.now() - t0)
    // `setImmediate`, not a timer: this yields to the event loop once and comes
    // straight back, so IPC and the console reader get their turn without the
    // parse taking noticeably longer overall.
    await new Promise((r) => setImmediate(r))
  }
  // The number that matters is the longest block, not the total: the total is
  // work that has to happen either way, the block is what the interface feels.
  lastSliceMs = longest

  const entry: RegionEntry = { at: Date.now(), mtimeMs, tiles }
  regions.set(path, entry)
  trimMemory(perf.memoryRegions)
  if (perf.cache) {
    writeCachedRegion(serverId, path, entry)
    sweepCache(perf.cacheLimitMB)
  }
  log.info(
    `World tiles: parsed ${tiles.size} chunks from ${path.split(/[\/]/).pop()} ` +
      `(longest uninterrupted slice ${longest} ms)`
  )
  return entry
}

/** Longest uninterrupted parse block of the last sliced parse. Read by the smoke. */
let lastSliceMs = 0
export function lastParseSliceMs(): number {
  return lastSliceMs
}

/** The queue's own tile lookup: parses in slices rather than in one block. */
export async function chunkTileSliced(
  serverId: string,
  dim: string,
  chunkX: number,
  chunkZ: number
): Promise<void> {
  const path = regionPath(serverId, dim, regionOf(chunkX), regionOf(chunkZ))
  if (!path) return
  await loadRegionSliced(serverId, path, dim, perfFor(serverId))
}

function trimMemory(keep: number): void {
  while (regions.size > keep) {
    const oldest = [...regions.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (!oldest) break
    regions.delete(oldest[0])
  }
}


/**
 * A tile ONLY if its region is already parsed.
 *
 * `undefined` means "not known yet, ask again"; `null` means "parsed, and there
 * is no chunk there". The distinction is what lets a request answer instantly
 * without ever triggering a parse — and what lets the client tell an empty area
 * from one it simply has not received yet.
 */
function loadedRegion(path: string): RegionEntry | null | undefined {
  let mtimeMs = 0
  try {
    // One stat answers both questions: whether the region exists and whether a
    // cached parse is still current. The old request path did exists + stat for
    // every chunk, so one 64-chunk batch could hit the same Windows file 128
    // times before doing any useful work.
    mtimeMs = statSync(path).mtimeMs
  } catch {
    return null
  }
  const hit = regions.get(path)
  if (!hit || hit.mtimeMs !== mtimeMs) return undefined
  hit.at = Date.now()
  return hit
}

export function peekChunkTile(
  serverId: string,
  dim: string,
  chunkX: number,
  chunkZ: number
): ChunkTile | null | undefined {
  const path = regionPath(serverId, dim, regionOf(chunkX), regionOf(chunkZ))
  if (!path) return null
  const region = loadedRegion(path)
  if (region === undefined) return undefined
  if (!region) return null
  return region.tiles.get(chunkSlot(localChunk(chunkX), localChunk(chunkZ))) ?? null
}

/**
 * Serve what is parsed, queue what is not.
 *
 * Lives here rather than in the web server so the desktop app and the two web
 * surfaces share one queue and one parse budget — three callers each with their
 * own would be three times the work and three different maps, which is the
 * complaint this consolidates.
 */
const queue: { serverId: string; dim: string; cx: number; cz: number; key: string }[] = []
const queuedRegions = new Set<string>()
let working = false

function regionJobKey(serverId: string, dim: string, cx: number, cz: number): string {
  return `${serverId}\u0000${dim}\u0000${regionOf(cx)},${regionOf(cz)}`
}

export function requestTiles(
  serverId: string,
  dim: string,
  want: { cx: number; cz: number }[],
  opts: { marks?: boolean } = {}
): {
  tiles: Record<string, { c: number[]; h: number[]; m?: StructureMark[] }>
  /** Chunks read and found to hold nothing — as opposed to not read yet. */
  empty: string[]
  pending: number
} {
  const tiles: Record<string, { c: number[]; h: number[]; m?: StructureMark[] }> = {}
  const empty: string[] = []
  const missing: { cx: number; cz: number }[] = []
  const byRegion = new Map<string, { path: string; chunks: { cx: number; cz: number }[] }>()

  for (const w of want) {
    const path = regionPath(serverId, dim, regionOf(w.cx), regionOf(w.cz))
    if (!path) {
      empty.push(w.cx + ',' + w.cz)
      continue
    }
    const group = byRegion.get(path)
    if (group) group.chunks.push(w)
    else byRegion.set(path, { path, chunks: [w] })
  }

  // Resolve each .mca file once per request. A normal viewport asks for many
  // chunks from the same region; grouping avoids dozens of duplicate stat calls.
  for (const group of byRegion.values()) {
    const region = loadedRegion(group.path)
    if (region === undefined) {
      missing.push(...group.chunks)
      const first = group.chunks[0]
      const key = regionJobKey(serverId, dim, first.cx, first.cz)
      if (queue.length <= 4096 && !queuedRegions.has(key)) {
        queuedRegions.add(key)
        queue.push({ serverId, dim, cx: first.cx, cz: first.cz, key })
      }
      continue
    }
    if (!region) {
      for (const w of group.chunks) empty.push(w.cx + ',' + w.cz)
      continue
    }
    for (const w of group.chunks) {
      const t = region.tiles.get(chunkSlot(localChunk(w.cx), localChunk(w.cz))) ?? null
      if (!t) {
        empty.push(w.cx + ',' + w.cz)
        continue
      }
      // Structures are omitted unless asked for. They are a spoiler, and a
      // payload that carries them "in case" is one the public feed could leak.
      tiles[w.cx + ',' + w.cz] = {
        c: t.colour,
        h: t.height,
        ...(opts.marks && t.marks ? { m: t.marks } : {})
      }
    }
  }

  if (missing.length && !working) void drain()
  return { tiles, empty, pending: missing.length }
}

async function drain(): Promise<void> {
  working = true
  try {
    while (queue.length) {
      const job = queue.shift()
      if (!job) break
      // The budget is a brake on PARSING, and applying it to every job throttled
      // the cache hits too — which after #134 is almost every read, and is why
      // loading felt no quicker with the cache than without it (#136).
      //
      // Measured rather than predicted: run the job, then look at whether it
      // parsed. Predicting meant re-stat'ing the region file to guess at work
      // the very next call was about to do anyway.
      const before = lastParseAt
      try {
        // Sliced: a region takes about 1.5 s and this thread answers every IPC
        // call, so parsing one in a single block froze the interface for that
        // long. Same work, interruptible — see `SLICE_SLOTS`.
        await chunkTileSliced(job.serverId, job.dim, job.cx, job.cz)
      } catch {
        /* one bad region must not stop the queue */
      } finally {
        queuedRegions.delete(job.key)
      }
      if (lastParseAt !== before) {
        // It really parsed. Stand back for the configured gap so the console
        // reader and everything else on this thread get a turn.
        await new Promise((r) => setTimeout(r, perfFor(job.serverId).parseGapMs))
      } else {
        await new Promise((r) => setImmediate(r))
      }
    }
  } finally {
    working = false
  }
}

/**
 * `cx,cz;cx,cz…`, capped so one call cannot ask for a whole world.
 *
 * Re-exported rather than declared: the clients have to cap against the SAME
 * number, and when they did not, everything past the server's limit came back
 * unmentioned and was marked permanently empty (#159).
 */
export { MAX_TILES_PER_REQUEST }

export function parseWantedTiles(raw: string | null | undefined): { cx: number; cz: number }[] {
  const out: { cx: number; cz: number }[] = []
  for (const pair of (raw ?? '').split(';')) {
    const [a, b] = pair.split(',')
    const cx = Number(a)
    const cz = Number(b)
    if (Number.isSafeInteger(cx) && Number.isSafeInteger(cz)) out.push({ cx, cz })
    if (out.length >= MAX_TILES_PER_REQUEST) break
  }
  return out
}

/** One chunk's tile, parsing the region if needed. Never call from a request. */
export function chunkTile(
  serverId: string,
  dim: string,
  chunkX: number,
  chunkZ: number
): ChunkTile | null {
  const path = regionPath(serverId, dim, regionOf(chunkX), regionOf(chunkZ))
  if (!path) return null
  const region = loadRegion(serverId, path, dim, perfFor(serverId))
  if (!region) return null
  return region.tiles.get(chunkSlot(localChunk(chunkX), localChunk(chunkZ))) ?? null
}


// ---- what the background warmer needs (#161) ----

/**
 * Every dimension directory this server actually has on disk.
 *
 * The warmer cannot ask for "the region folder" — a Paper server keeps the
 * nether and the end in sibling folders, and a custom world is a top-level one
 * of its own, which is the layout `regionDirCandidates` exists to resolve.
 */
export function regionDirsForServer(serverId: string): { dim: string; dir: string }[] {
  const out: { dim: string; dir: string }[] = []
  const seen = new Set<string>()
  for (const dim of ['overworld', 'nether', 'end']) {
    const dir = regionDirFor(serverId, dim)
    if (!dir || seen.has(dir) || !existsSync(dir)) continue
    seen.add(dir)
    out.push({ dim, dir })
  }
  return out
}

/**
 * Whether the cache already holds this region as it stands on disk.
 *
 * Cheap on purpose: the warmer asks this once per region per pass, and on a
 * warmed world the answer is yes for every one of them. Reading the file and
 * checking its mtime is what makes a second pass cost a directory walk rather
 * than a world.
 */
export function cachedRegionIsCurrent(serverId: string, path: string, mtimeMs: number): boolean {
  const hit = regions.get(path)
  if (hit && hit.mtimeMs === mtimeMs) return true
  return !!readCachedRegion(serverId, path, mtimeMs)
}

/**
 * Parse one region into the cache, without touching the in-memory working set.
 *
 * Deliberately NOT `loadRegionSliced`: warming a thousand regions through that
 * would evict the handful an operator is actually looking at, over and over.
 * The disk cache is the point here; memory belongs to whoever is looking.
 */
export async function warmOneRegion(
  serverId: string,
  path: string,
  dim: string,
  perf: MapPerfConfig
): Promise<boolean> {
  if (!poolReady()) return false
  const r = await parseOnWorker(path, dim)
  if (r.error || !r.buf) return false
  if (perf.cache) {
    writeCachedBuffer(serverId, path, r.buf)
    sweepCache(perf.cacheLimitMB)
  }
  return true
}
