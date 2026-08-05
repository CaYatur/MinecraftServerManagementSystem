/**
 * The on-disk format for parsed map tiles (#133).
 *
 * Pure, because this is the part where a mistake is silent: a decoder that
 * mis-reads its own file produces a *plausible* map rather than an error, and
 * the cache then serves that wrong picture until somebody deletes it by hand.
 *
 * Why it is worth having at all: a 4 MB region of 1024 chunks costs about 1.5 s
 * to decompress, NBT-parse and extract surfaces from (#157 measured it — it was
 * 14 s before that), and #119's cache was a Map in memory, so every restart
 * paid it again. The encoded form of the same region is about 1 MB and reads
 * back in roughly 16 ms.
 */

import type { StructureKind } from './regionFormat'
import { STRUCTURE_KINDS } from './regionFormat'

/**
 * Bumped whenever the RENDERED OUTPUT changes — the colour table, the foliage
 * rule, the shading, the column layout.
 *
 * This is the field that stops a cache outliving its meaning. Keying on the
 * region's mtime alone says "the world has not changed", which is true and
 * beside the point when what changed is how we draw it: every existing cache
 * would go on serving the old picture forever, and an operator staring at a
 * map with the old colours has no way to connect it to an update they
 * installed. Changing any of those things and NOT bumping this is the bug.
 */
export const TILE_CACHE_VERSION = 4

const MAGIC = 0x4d53544c // 'MSTL'
const COLUMNS = 256
/** flags, r, g, b, then height as an i16. */
const BYTES_PER_COLUMN = 6
const HEADER_BYTES = 4 + 2 + 8 + 2

export interface CachedTile {
  colour: number[]
  height: number[]
  marks?: { kind: StructureKind; id: string; x: number; z: number }[]
}

export interface CachedRegion {
  mtimeMs: number
  /** Chunk slot (0..1023) to tile. A slot absent here was never generated. */
  tiles: Map<number, CachedTile>
}

/**
 * Encode a region's tiles.
 *
 * Fixed-width per column rather than a packed run-length: the caller gzips this,
 * and gzip finds the runs itself far better than a hand-rolled scheme would —
 * with none of the ways a hand-rolled one can be wrong.
 */
export function encodeRegionTiles(region: CachedRegion): Uint8Array {
  const parts: Uint8Array[] = []
  let bodyBytes = 0
  for (const [slot, tile] of region.tiles) {
    const marks = tile.marks ?? []
    let markBytes = 0
    const markBufs: Uint8Array[] = []
    for (const m of marks) {
      const id = new TextEncoder().encode(m.id.slice(0, 200))
      const b = new Uint8Array(1 + 4 + 4 + 1 + id.length)
      const dv = new DataView(b.buffer)
      b[0] = Math.max(0, STRUCTURE_KINDS.indexOf(m.kind))
      dv.setInt32(1, Math.trunc(m.x))
      dv.setInt32(5, Math.trunc(m.z))
      b[9] = id.length
      b.set(id, 10)
      markBufs.push(b)
      markBytes += b.length
    }
    const chunk = new Uint8Array(2 + 2 + COLUMNS * BYTES_PER_COLUMN + markBytes)
    const dv = new DataView(chunk.buffer)
    dv.setUint16(0, slot)
    dv.setUint16(2, markBufs.length)
    let o = 4
    for (let i = 0; i < COLUMNS; i++) {
      const c = tile.colour[i]
      // A column with no colour is transparent and MUST round-trip as one —
      // encoding it as black would paint the void over every ungenerated gap.
      chunk[o] = c >= 0 ? 1 : 0
      chunk[o + 1] = c >= 0 ? (c >> 16) & 255 : 0
      chunk[o + 2] = c >= 0 ? (c >> 8) & 255 : 0
      chunk[o + 3] = c >= 0 ? c & 255 : 0
      // Heights run -64..319 in modern worlds, which does not fit a byte.
      dv.setInt16(o + 4, Math.max(-32768, Math.min(32767, Math.trunc(tile.height[i] ?? 0))))
      o += BYTES_PER_COLUMN
    }
    for (const b of markBufs) {
      chunk.set(b, o)
      o += b.length
    }
    parts.push(chunk)
    bodyBytes += chunk.length
  }

  const out = new Uint8Array(HEADER_BYTES + bodyBytes)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, MAGIC)
  dv.setUint16(4, TILE_CACHE_VERSION)
  dv.setFloat64(6, region.mtimeMs)
  dv.setUint16(14, region.tiles.size)
  let at = HEADER_BYTES
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/**
 * Decode, or null.
 *
 * Null for every reason: wrong magic, wrong version, truncated, a length that
 * runs past the end. A cache is an optimisation, so the only correct response
 * to one that does not make sense is to ignore it and parse the world again —
 * never to throw, and never to return half of it.
 */
export function decodeRegionTiles(buf: Uint8Array): CachedRegion | null {
  if (buf.length < HEADER_BYTES) return null
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0) !== MAGIC) return null
  if (dv.getUint16(4) !== TILE_CACHE_VERSION) return null
  const mtimeMs = dv.getFloat64(6)
  const count = dv.getUint16(14)

  const tiles = new Map<number, CachedTile>()
  let o = HEADER_BYTES
  for (let n = 0; n < count; n++) {
    if (o + 4 + COLUMNS * BYTES_PER_COLUMN > buf.length) return null
    const slot = dv.getUint16(o)
    const markCount = dv.getUint16(o + 2)
    o += 4
    const colour = new Array<number>(COLUMNS)
    const height = new Array<number>(COLUMNS)
    for (let i = 0; i < COLUMNS; i++) {
      colour[i] = buf[o] ? (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3] : -1
      height[i] = dv.getInt16(o + 4)
      o += BYTES_PER_COLUMN
    }
    const marks: CachedTile['marks'] = []
    for (let mi = 0; mi < markCount; mi++) {
      if (o + 10 > buf.length) return null
      const kind = STRUCTURE_KINDS[buf[o]] ?? 'other'
      const x = dv.getInt32(o + 1)
      const z = dv.getInt32(o + 5)
      const idLen = buf[o + 9]
      o += 10
      if (o + idLen > buf.length) return null
      const id = new TextDecoder().decode(buf.subarray(o, o + idLen))
      o += idLen
      marks.push({ kind, id, x, z })
    }
    tiles.set(slot, { colour, height, ...(marks.length ? { marks } : {}) })
  }
  return { mtimeMs, tiles }
}

// ---- per-server tuning ----

/**
 * What the map is allowed to cost on one server.
 *
 * Per server because a box running twenty of them and a laptop running one want
 * different answers, and the person who knows which is the operator.
 */
export interface MapPerfConfig {
  /** Keep parsed tiles on disk so a restart does not re-parse the world. */
  cache: boolean
  /** Regions held in memory. The working set; more is faster and heavier. */
  memoryRegions: number
  /** Minimum gap between two region parses, in ms. The politeness brake. */
  parseGapMs: number
  /** Ceiling on the on-disk cache, in MB. Oldest evicted first. */
  cacheLimitMB: number
  /**
   * Keep reading new area as the view moves.
   *
   * Off, the map draws what it already holds and stops there until asked — so
   * panning across a large world costs nothing at all. On a machine where the
   * reading itself is the problem, this is the switch that ends it; the price
   * is that new ground stays blank until you press to load it.
   */
  loadOnPan: boolean
}

export const MAP_PERF_DEFAULTS: MapPerfConfig = {
  cache: true,
  memoryRegions: 12,
  parseGapMs: 250,
  cacheLimitMB: 512,
  loadOnPan: true
}

/**
 * Clamp, because these arrive from a config file an operator can hand-edit and
 * every one of them is a way to hang the process: a parse gap of zero removes
 * the brake that keeps the console feed responsive, and a memory limit of a
 * million holds every region of a big world at once.
 */
export function normalizeMapPerf(raw: unknown): MapPerfConfig {
  const r = (raw ?? {}) as Partial<MapPerfConfig>
  const num = (v: unknown, lo: number, hi: number, dflt: number): number => {
    const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt
    return Math.min(hi, Math.max(lo, n))
  }
  return {
    cache: r.cache !== false,
    memoryRegions: num(r.memoryRegions, 2, 64, MAP_PERF_DEFAULTS.memoryRegions),
    parseGapMs: num(r.parseGapMs, 0, 5000, MAP_PERF_DEFAULTS.parseGapMs),
    cacheLimitMB: num(r.cacheLimitMB, 0, 20_000, MAP_PERF_DEFAULTS.cacheLimitMB),
    loadOnPan: r.loadOnPan !== false
  }
}
