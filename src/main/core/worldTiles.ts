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
import { existsSync, readFileSync, statSync } from 'node:fs'
import { inflateSync, gunzipSync } from 'node:zlib'
import { join } from 'node:path'
import * as nbt from 'prismarine-nbt'
import { getServer } from './serverRegistry'
import { readProperties } from './serverFiles'
import { log } from '../logger'
import {
  bitsPerIndex,
  blockColour,
  chunkSlot,
  localChunk,
  packingFor,
  parseLocationTable,
  regionOf,
  unpackIndices,
  seeThrough,
  structureKind,
  CHUNK_AXIS,
  INVISIBLE
} from '@shared/regionFormat'
import type { StructureMark } from '@shared/regionFormat'

/** A chunk's surface: 256 columns, row-major (x fastest). */
export interface ChunkTile {
  /** Packed 0xRRGGBB per column. */
  colour: number[]
  /** World Y of the drawn block, for cross-chunk shading. */
  height: number[]
  /**
   * Structures starting in this chunk (#131).
   *
   * Read from the same NBT the surface came from, so it costs one more object
   * lookup rather than a second pass over the world. Absent on most chunks.
   */
  marks?: StructureMark[]
}

interface RegionEntry {
  at: number
  mtimeMs: number
  /** Chunk slot -> tile, or null for a chunk that has never been generated. */
  tiles: Map<number, ChunkTile | null>
}

const regions = new Map<string, RegionEntry>()
/** A region is a few MB parsed; this is the ceiling on what is kept resident. */
const MAX_REGIONS = 12

export function _resetWorldTiles(): void {
  regions.clear()
}

/** Matches the private copies in players.ts and backups.ts. */
function levelName(id: string): string {
  const map = Object.fromEntries(readProperties(id).entries.map((e) => [e.key, e.value]))
  return map['level-name'] || 'world'
}

function dimensionFolder(dim: string): string {
  if (dim === 'nether') return join('DIM-1', 'region')
  if (dim === 'end') return join('DIM1', 'region')
  return 'region'
}

function regionPath(serverId: string, dim: string, rx: number, rz: number): string | null {
  const s = getServer(serverId)
  if (!s) return null
  return join(s.path, levelName(serverId), dimensionFolder(dim), `r.${rx}.${rz}.mca`)
}

/** Longs out of prismarine-nbt, which gives signed 64-bit values as [hi, lo]. */
function toLongs(raw: unknown): bigint[] {
  if (!Array.isArray(raw)) return []
  return raw.map((v) => {
    if (typeof v === 'bigint') return v
    if (Array.isArray(v) && v.length === 2) {
      // [high, low], both signed 32-bit. The high word carries the sign.
      return BigInt.asIntN(64, (BigInt(v[0]) << 32n) | (BigInt(v[1] >>> 0) & 0xffffffffn))
    }
    if (typeof v === 'number') return BigInt(Math.trunc(v))
    return 0n
  })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function tag(v: any): any {
  return v && typeof v === 'object' && 'value' in v ? v.value : v
}

/**
 * Unwrap an NBT *list*, which prismarine-nbt wraps twice.
 *
 * A list arrives as `{type:'list', value:{type:'compound', value:[...]}}` — the
 * outer wrapper says "list", the inner one says what the elements are. One
 * `tag()` leaves you holding the inner descriptor object, not the array.
 *
 * This is not a nicety. Reading `sections` happened to work because the code
 * unwrapped it twice by accident, while `palette` was unwrapped once — so
 * `Array.isArray(palette)` was false for every section of every chunk, every
 * section was skipped, and the world renderer produced nothing at all. The
 * smoke tested the bit decoding and never a real chunk, so nothing caught it.
 */
function listOf(v: any): any[] {
  const once = tag(v)
  const twice = tag(once)
  return Array.isArray(twice) ? twice : Array.isArray(once) ? once : []
}

/**
 * The topmost visible block of every column in one chunk.
 *
 * Sections are walked from the highest down, and within a section from y=15
 * down, stopping at the first block that is not air. A column that is nothing
 * but air the whole way — under an unlit sky, or a chunk that is only partly
 * generated — is left transparent rather than drawn as the void.
 */
export function tileFromChunk(chunk: any): ChunkTile | null {
  const v = tag(chunk)
  if (!v) return null
  const dataVersion = tag(v.DataVersion)
  const packing = packingFor(typeof dataVersion === 'number' ? dataVersion : undefined)
  // 1.18+ uses `sections`; 1.13-1.17 used `Level.Sections`.
  const sections = listOf(v.sections).length ? listOf(v.sections) : listOf(tag(v.Level)?.Sections)
  if (!sections.length) return null

  const withY = sections
    .map((s: any) => ({ s: tag(s), y: Number(tag(tag(s)?.Y)) }))
    .filter((x) => Number.isFinite(x.y))
    .sort((a, b) => b.y - a.y)

  const colour = new Array<number>(CHUNK_AXIS * CHUNK_AXIS).fill(-1)
  const height = new Array<number>(CHUNK_AXIS * CHUNK_AXIS).fill(0)
  let remaining = colour.length

  for (const { s, y: sectionY } of withY) {
    if (remaining === 0) break
    const states = tag(s.block_states) ?? tag(s.BlockStates)
    // A list, so unwrapped twice. See `listOf`.
    const paletteRaw = listOf(states?.palette).length ? listOf(states?.palette) : listOf(s.Palette)
    if (!paletteRaw.length) continue
    const names: string[] = paletteRaw.map((p: any) => String(tag(tag(p)?.Name) ?? ''))
    // A section whose palette is one entry has no data array at all — it is
    // 4096 of that block, which is how a solid stone or all-air section is
    // stored. Reading `data` there would skip the section entirely.
    // `data` is a longArray, which is wrapped once — unlike the palette beside
    // it, which is a list and wrapped twice.
    const longs = toLongs(tag(states?.data) ?? tag(s.BlockStates))
    const bits = bitsPerIndex(names.length)
    const indices =
      names.length === 1 || !longs.length
        ? new Array<number>(4096).fill(0)
        : unpackIndices(longs, bits, 4096, packing)

    for (let y = CHUNK_AXIS - 1; y >= 0 && remaining > 0; y--) {
      for (let z = 0; z < CHUNK_AXIS; z++) {
        for (let x = 0; x < CHUNK_AXIS; x++) {
          const col = x + z * CHUNK_AXIS
          if (colour[col] >= 0) continue
          const name = names[indices[y * 256 + z * CHUNK_AXIS + x]] ?? ''
          const short = name.replace(/^minecraft:/, '')
          // Air, and the plants a map looks through — see `seeThrough`. Without
          // it the surface is whatever is standing ON the ground rather than
          // the ground, which is how a bamboo jungle rendered as a maroon smear.
          if (!short || INVISIBLE.has(short) || seeThrough(short)) continue
          const c = blockColour(short)
          colour[col] = (c.r << 16) | (c.g << 8) | c.b
          height[col] = sectionY * CHUNK_AXIS + y
          remaining--
        }
      }
    }
  }
  // Nothing at all: an ungenerated or empty chunk, which is not a tile.
  if (remaining === colour.length) return null
  const marks = structuresOf(v)
  return { colour, height, ...(marks.length ? { marks } : {}) }
}

/**
 * Structures whose start is in this chunk.
 *
 * `structures.starts` is keyed by structure id and each entry carries the chunk
 * it starts in — `ChunkX`/`ChunkZ` in chunk units, which is why they are
 * multiplied here rather than used raw. A chunk that merely CONTAINS part of a
 * structure lists it in `References`, not `starts`, so this yields one mark per
 * structure rather than one per chunk it sprawls across.
 */
function structuresOf(v: any): StructureMark[] {
  const starts = tag(tag(v.structures)?.starts) ?? tag(tag(tag(v.Level)?.Structures)?.Starts)
  if (!starts || typeof starts !== 'object') return []
  const out: StructureMark[] = []
  for (const [id, raw] of Object.entries(starts)) {
    const s = tag(raw)
    if (!s || typeof s !== 'object') continue
    const cx = Number(tag((s as any).ChunkX))
    const cz = Number(tag((s as any).ChunkZ))
    if (!Number.isFinite(cx) || !Number.isFinite(cz)) continue
    out.push({
      kind: structureKind(id),
      id: String(id).replace(/^minecraft:/, ''),
      x: cx * CHUNK_AXIS + CHUNK_AXIS / 2,
      z: cz * CHUNK_AXIS + CHUNK_AXIS / 2
    })
  }
  return out
}

function decompress(buf: Buffer, kind: number): Buffer | null {
  try {
    if (kind === 1) return gunzipSync(buf)
    if (kind === 2) return inflateSync(buf)
    if (kind === 3) return buf
  } catch {
    /* a truncated or corrupt chunk is skipped, never fatal */
  }
  return null
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
export function parseBudgetReady(now = Date.now()): boolean {
  return now - lastParseAt >= REGION_PARSE_GAP_MS
}

/**
 * Parse one region file, or return the cached parse.
 *
 * Synchronous and slow by design — the callers are expected to keep this off
 * any request path, and to respect `parseBudgetReady`.
 */
function loadRegion(path: string): RegionEntry | null {
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

  lastParseAt = Date.now()
  let file: Buffer
  try {
    file = readFileSync(path)
  } catch {
    return null
  }
  if (file.length < SECTOR_HEADER) return null

  const table = parseLocationTable(file.subarray(0, 4096))
  const tiles = new Map<number, ChunkTile | null>()
  for (let slot = 0; slot < table.length; slot++) {
    const loc = table[slot]
    if (!loc.offset || loc.offset + 5 > file.length) continue
    const length = file.readUInt32BE(loc.offset)
    const kind = file[loc.offset + 4]
    const end = loc.offset + 5 + Math.max(0, length - 1)
    if (length <= 0 || end > file.length) continue
    const raw = decompress(file.subarray(loc.offset + 5, end), kind)
    if (!raw) continue
    try {
      tiles.set(slot, tileFromChunk(nbt.parseUncompressed(raw)))
    } catch {
      /* one unreadable chunk must not lose the region */
    }
  }

  const entry: RegionEntry = { at: Date.now(), mtimeMs, tiles }
  regions.set(path, entry)
  if (regions.size > MAX_REGIONS) {
    const oldest = [...regions.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) regions.delete(oldest[0])
  }
  log.info(`World tiles: parsed ${tiles.size} chunks from ${path.split(/[\\/]/).pop()}`)
  return entry
}

const SECTOR_HEADER = 8192

/**
 * A tile ONLY if its region is already parsed.
 *
 * `undefined` means "not known yet, ask again"; `null` means "parsed, and there
 * is no chunk there". The distinction is what lets a request answer instantly
 * without ever triggering a parse — and what lets the client tell an empty area
 * from one it simply has not received yet.
 */
export function peekChunkTile(
  serverId: string,
  dim: string,
  chunkX: number,
  chunkZ: number
): ChunkTile | null | undefined {
  const path = regionPath(serverId, dim, regionOf(chunkX), regionOf(chunkZ))
  if (!path) return null
  if (!existsSync(path)) return null
  const hit = regions.get(path)
  if (!hit) return undefined
  let mtimeMs = 0
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    return null
  }
  if (hit.mtimeMs !== mtimeMs) return undefined
  hit.at = Date.now()
  return hit.tiles.get(chunkSlot(localChunk(chunkX), localChunk(chunkZ))) ?? null
}

/**
 * Serve what is parsed, queue what is not.
 *
 * Lives here rather than in the web server so the desktop app and the two web
 * surfaces share one queue and one parse budget — three callers each with their
 * own would be three times the work and three different maps, which is the
 * complaint this consolidates.
 */
const queue: { serverId: string; dim: string; cx: number; cz: number }[] = []
let working = false

export function requestTiles(
  serverId: string,
  dim: string,
  want: { cx: number; cz: number }[],
  opts: { marks?: boolean } = {}
): { tiles: Record<string, { c: number[]; h: number[]; m?: StructureMark[] }>; pending: number } {
  const tiles: Record<string, { c: number[]; h: number[]; m?: StructureMark[] }> = {}
  const missing: { cx: number; cz: number }[] = []
  for (const w of want) {
    const t = peekChunkTile(serverId, dim, w.cx, w.cz)
    if (t === undefined) missing.push(w)
    // Structures are omitted unless asked for. They are a spoiler, and a
    // payload that carries them "in case" is one the public feed could leak.
    else if (t) {
      tiles[w.cx + ',' + w.cz] = {
        c: t.colour,
        h: t.height,
        ...(opts.marks && t.marks ? { m: t.marks } : {})
      }
    }
  }
  for (const m of missing) {
    if (queue.length > 4096) break
    if (!queue.some((q) => q.serverId === serverId && q.dim === dim && q.cx === m.cx && q.cz === m.cz)) {
      queue.push({ serverId, dim, ...m })
    }
  }
  if (missing.length && !working) void drain()
  return { tiles, pending: missing.length }
}

async function drain(): Promise<void> {
  working = true
  try {
    while (queue.length) {
      // Yielding between chunks is not enough on its own: the first chunk of an
      // unseen region parses the whole file. Wait for the parse budget.
      if (!parseBudgetReady()) {
        await new Promise((r) => setTimeout(r, 60))
        continue
      }
      const job = queue.shift()
      if (!job) break
      try {
        chunkTile(job.serverId, job.dim, job.cx, job.cz)
      } catch {
        /* one bad region must not stop the queue */
      }
      await new Promise((r) => setImmediate(r))
    }
  } finally {
    working = false
  }
}

/** `cx,cz;cx,cz…`, capped so one call cannot ask for a whole world. */
export const MAX_TILES_PER_REQUEST = 64

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
  const region = loadRegion(path)
  if (!region) return null
  return region.tiles.get(chunkSlot(localChunk(chunkX), localChunk(chunkZ))) ?? null
}

