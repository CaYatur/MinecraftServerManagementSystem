/**
 * Turning a region file into tiles, with nothing but the file (#160).
 *
 * Split out of `worldTiles.ts` so a WORKER THREAD can do it. That module
 * reaches for the server registry, the app paths and the logger, all of which
 * pull in Electron; this one knows about a buffer, a dimension name and the
 * colour table, so it runs anywhere.
 *
 * THE COLOUR TABLE IS THE TRAP. `blockColour` reads module-level state that
 * `core/clientAssets.ts` fills at runtime from the operator's client jar, and a
 * worker starts with it EMPTY. A worker that is not given the table renders the
 * fallback palette, and `writeCachedRegion` then persists those colours to disk
 * where they outlive the process — a wrong map that survives restarts, with a
 * cache version that still matches. `tileWorker.ts` is handed the table before
 * it parses anything, and the pool re-sends it whenever it changes.
 */
import { gunzipSync, inflateSync } from 'node:zlib'
import * as nbt from 'prismarine-nbt'
import {
  bitsPerIndex,
  blockColour,
  indexAt,
  packingFor,
  parseLocationTable,
  prepareIndices,
  scanRuleFor,
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
export function tileFromChunk(chunk: any, dim = 'overworld'): ChunkTile | null {
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

  // The nether has a bedrock roof: a top-down scan finds it in every column and
  // paints the whole dimension one flat grey. `sawAir` per column is how a map
  // gets under it — solid blocks are skipped until an air gap has been seen.
  const rule = scanRuleFor(dim)
  const sawAir = rule.underRoof ? new Array<boolean>(colour.length).fill(false) : null
  // A column that is solid from the ceiling all the way down — a netherrack
  // pillar joining floor to roof — never shows an air gap, so the under-roof
  // rule would skip every block in it and leave a hole. The highest solid block
  // seen while skipping is kept as the answer for exactly that case.
  const fallbackColour = sawAir ? new Array<number>(colour.length).fill(-1) : null
  const fallbackHeight = sawAir ? new Array<number>(colour.length).fill(0) : null

  for (const { s, y: sectionY } of withY) {
    if (remaining === 0) break
    // Above the ceiling there is nothing worth looking at, and on the nether
    // that is most of the sections.
    if (rule.ceiling !== null && sectionY * CHUNK_AXIS > rule.ceiling) continue
    const states = tag(s.block_states) ?? tag(s.BlockStates)
    // A list, so unwrapped twice. See `listOf`.
    const paletteRaw = listOf(states?.palette).length ? listOf(states?.palette) : listOf(s.Palette)
    if (!paletteRaw.length) continue
    const names: string[] = paletteRaw.map((p: any) => String(tag(tag(p)?.Name) ?? ''))

    /**
     * The block rules, resolved once per PALETTE ENTRY.
     *
     * This is the whole cost of a map (#157). A section is 4096 positions and
     * its palette is at most a few dozen entries, and every one of these used
     * to run per position: a regex to strip the namespace, a Set lookup for
     * air, `seeThrough` (a Set miss then ten `endsWith` calls), and
     * `blockColour` with a second regex inside it. A fully generated chunk is
     * about 53 thousand of those to render 256 columns — 13 ms a chunk, 14
     * seconds a region, and the reason a viewport could take over a minute.
     *
     * Resolved per entry it is a few dozen, and the inner loop is array
     * indexing. Same answers: the arrays are built by the same functions in the
     * same order.
     */
    const invisible = names.map((n) => {
      // Air, and the plants a map looks through — see `seeThrough`. Without it
      // the surface is whatever is standing ON the ground rather than the
      // ground, which is how a bamboo jungle rendered as a maroon smear.
      const short = n.replace(/^minecraft:/, '')
      return !short || INVISIBLE.has(short) || seeThrough(short)
    })
    // A section a map sees nothing in — and above the surface that is most of
    // them, fifteen or so single-entry air palettes per chunk. Skipped HERE,
    // before the colours are looked up, before the indices are unpacked and
    // before anything is allocated, because the point is not to make those
    // sections cheaper but to stop touching them at all.
    if (invisible.every(Boolean)) {
      // Except under a roof, where an air section is not nothing: it is the gap
      // the scan is looking for. Recorded for every column in one pass instead
      // of by walking 4096 positions to reach the same conclusion. Every
      // section still standing here has its bottom layer at or below the
      // ceiling, so a full air layer covers all 256 columns.
      if (sawAir) sawAir.fill(true)
      continue
    }

    // Only now, for the sections that can actually contribute a colour.
    const packedColour = names.map((n) => {
      const c = blockColour(n.replace(/^minecraft:/, ''))
      return (c.r << 16) | (c.g << 8) | c.b
    })

    // A section whose palette is one entry has no data array at all — it is
    // 4096 of that block, which is how a solid stone or all-air section is
    // stored. Reading `data` there would skip the section entirely.
    // `data` is a longArray, which is wrapped once — unlike the palette beside
    // it, which is a list and wrapped twice.
    const longs = toLongs(tag(states?.data) ?? tag(s.BlockStates))
    const bits = bitsPerIndex(names.length)
    // `null` rather than 4096 zeroes: a uniform section reads palette entry 0
    // at every position, so the array only existed to say so.
    //
    // And prepared rather than unpacked: the loop below walks down from the top
    // layer and stops the moment every column has an answer, which on real
    // terrain is after two or three of the sixteen. Unpacking all 4096 did the
    // rest for nothing.
    const indices =
      names.length === 1 || !longs.length ? null : prepareIndices(longs, bits, packing)

    for (let y = CHUNK_AXIS - 1; y >= 0 && remaining > 0; y--) {
      // Neither of these depends on the column, and both used to be recomputed
      // 256 times a layer.
      const worldY = sectionY * CHUNK_AXIS + y
      if (rule.ceiling !== null && worldY > rule.ceiling) continue
      const base = y * 256
      // `x + z * CHUNK_AXIS` IS the column index, so the two loops the original
      // had over x and z collapse into one over the column in the same order.
      for (let col = 0; col < 256; col++) {
        if (colour[col] >= 0) continue
        const pi = indices ? indexAt(indices, base + col) : 0
        // An index past the end of its palette: the width comes from
        // `bitsPerIndex`, which rounds up, so a three-entry palette is read
        // four bits wide and corrupt data can address entry 15. The old code
        // resolved that to an empty name and treated it as invisible.
        const inv = pi >= names.length || invisible[pi]
        if (sawAir) {
          // Under a roof: remember the gap, and skip everything solid until
          // one has been seen. Without this the first hit is the roof itself.
          if (inv) sawAir[col] = true
          if (!sawAir[col]) {
            if (!inv && fallbackColour && fallbackColour[col] < 0) {
              fallbackColour[col] = packedColour[pi]
              if (fallbackHeight) fallbackHeight[col] = worldY
            }
            continue
          }
        }
        if (inv) continue
        colour[col] = packedColour[pi]
        height[col] = worldY
        remaining--
      }
    }
  }
  // Columns the under-roof rule skipped entirely fall back to the highest solid
  // block, so a floor-to-ceiling pillar is drawn rather than punched out.
  if (fallbackColour && fallbackHeight) {
    for (let i = 0; i < colour.length; i++) {
      if (colour[i] < 0 && fallbackColour[i] >= 0) {
        colour[i] = fallbackColour[i]
        height[i] = fallbackHeight[i]
        remaining--
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

export function decompress(buf: Buffer, kind: number): Buffer | null {
  try {
    if (kind === 1) return gunzipSync(buf)
    if (kind === 2) return inflateSync(buf)
    if (kind === 3) return buf
  } catch {
    /* a truncated or corrupt chunk is skipped, never fatal */
  }
  return null
}

/** A region header is two 4 KiB tables: locations, then timestamps. */
export const SECTOR_HEADER = 8192

/**
 * One chunk out of a region file, into `tiles`.
 *
 * Pulled out of the parse loop so the same work can be done in one pass or in
 * slices with the event loop running in between.
 */
export function parseSlot(
  file: Buffer,
  table: ReturnType<typeof parseLocationTable>,
  slot: number,
  tiles: Map<number, ChunkTile | null>,
  dim: string
): void {
  const loc = table[slot]
  if (!loc || !loc.offset || loc.offset + 5 > file.length) return
  const length = file.readUInt32BE(loc.offset)
  const kind = file[loc.offset + 4]
  const end = loc.offset + 5 + Math.max(0, length - 1)
  if (length <= 0 || end > file.length) return
  const raw = decompress(file.subarray(loc.offset + 5, end), kind)
  if (!raw) return
  try {
    tiles.set(slot, tileFromChunk(nbt.parseUncompressed(raw), dim))
  } catch {
    /* one unreadable chunk must not lose the region */
  }
}

/**
 * Every chunk of one region file, in a single pass.
 *
 * For a caller that is not on the thread the interface lives on — which is the
 * whole point of the worker. On the main thread use the sliced form.
 */
export function parseRegionBuffer(file: Buffer, dim: string): Map<number, ChunkTile | null> {
  const tiles = new Map<number, ChunkTile | null>()
  if (file.length < SECTOR_HEADER) return tiles
  const table = parseLocationTable(file.subarray(0, 4096))
  for (let slot = 0; slot < table.length; slot++) parseSlot(file, table, slot, tiles, dim)
  return tiles
}
