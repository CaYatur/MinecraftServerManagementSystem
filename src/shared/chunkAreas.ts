import { normalizeDimension } from './livemap'

/**
 * Named, coloured regions of the map, measured in chunks (#144).
 *
 * An operator wants to say "these chunks are the spawn town, and this note
 * explains who owns them" and have that appear to everybody looking at the map
 * — the desktop app, the admin panel, the public site and the map page.
 *
 * All four draw it, so all four have to agree on what an area covers, which one
 * wins where they overlap, and what a visitor is allowed to read. That is what
 * this file is: no I/O, no rendering, just the answers. The alternative is four
 * implementations that disagree at the edges, which is how this codebase ended
 * up with three different maps in #129.
 */

/**
 * An inclusive rectangle in CHUNK coordinates.
 *
 * Rectangles rather than a list of chunks. A region 100 chunks square is one
 * rect or ten thousand pairs, and this payload is served to a public page on
 * every map load. An arbitrary shape is still expressible — it is several rects
 * — and a single clicked chunk is a 1x1, so the UI that selects by clicking and
 * the operator who types coordinates produce the same structure.
 */
export interface ChunkRect {
  x1: number
  z1: number
  x2: number
  z2: number
}

export interface ChunkArea {
  id: string
  name: string
  /** The "bu alan sahibi: ..." line. Shown on hover and on click. */
  note: string
  /** `#rrggbb`. */
  colour: string
  /** Which dimension this belongs to; an area without one paints the nether with overworld rectangles. */
  dim: string
  rects: ChunkRect[]
  /**
   * Kept off every map but the operator's own.
   *
   * The point of the feature is that areas are visible to everyone, so this is
   * off by default. It exists because an operator can have a reason to mark
   * chunks without announcing them — an investigation, a build in progress —
   * and the alternative is that they use the note field to lie.
   */
  hidden?: boolean
  createdAt: number
  updatedAt: number
}

/**
 * An area as the PUBLIC map presents it.
 *
 * A separate type, for the same reason `PublicMapPlayer` is one: the difference
 * has to be visible at every call site that returns one. Timestamps say when an
 * operator was working, and `hidden` would tell a visitor that hidden areas
 * exist — neither is any of their business.
 */
export interface PublicChunkArea {
  id: string
  name: string
  note: string
  colour: string
  dim: string
  rects: ChunkRect[]
}

/** Minecraft's world border in chunks: 30,000,000 blocks / 16. */
export const MAX_CHUNK = 1_875_000

export const MAX_AREAS = 200
export const MAX_RECTS_PER_AREA = 64
/**
 * A cap on area, not on ambition: 65,536 chunks is 1024 blocks square, which is
 * a large town. Without a cap one typo — a missing minus, a pasted coordinate in
 * blocks rather than chunks — asks every map to test a million chunks per frame.
 */
export const MAX_CHUNKS_PER_AREA = 65_536
export const MAX_NAME = 48
export const MAX_NOTE = 280

/** Suggested colours. Any valid `#rrggbb` is accepted; these are what the pickers offer. */
export const AREA_COLOURS = [
  '#e5484d',
  '#f76b15',
  '#ffb224',
  '#46a758',
  '#12a594',
  '#0091ff',
  '#8e4ec6',
  '#e93d82'
]

const clampChunk = (n: number): number => Math.min(MAX_CHUNK, Math.max(-MAX_CHUNK, Math.trunc(n)))

/** Corners in any order become `x1 <= x2`, `z1 <= z2`, inside the world border. */
export function normalizeRect(r: {
  x1: number
  z1: number
  x2: number
  z2: number
}): ChunkRect | null {
  const vals = [r.x1, r.z1, r.x2, r.z2]
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null
  const x1 = clampChunk(Math.min(r.x1, r.x2))
  const x2 = clampChunk(Math.max(r.x1, r.x2))
  const z1 = clampChunk(Math.min(r.z1, r.z2))
  const z2 = clampChunk(Math.max(r.z1, r.z2))
  return { x1, z1, x2, z2 }
}

export function rectChunks(r: ChunkRect): number {
  return (r.x2 - r.x1 + 1) * (r.z2 - r.z1 + 1)
}

export function rectHas(r: ChunkRect, cx: number, cz: number): boolean {
  return cx >= r.x1 && cx <= r.x2 && cz >= r.z1 && cz <= r.z2
}

const contains = (outer: ChunkRect, inner: ChunkRect): boolean =>
  inner.x1 >= outer.x1 && inner.x2 <= outer.x2 && inner.z1 >= outer.z1 && inner.z2 <= outer.z2

/**
 * Tidy a selection: normalise every rect, drop the ones already covered by
 * another, merge neighbours that line up.
 *
 * Clicking chunks one at a time produces a pile of 1x1s, and a dragged box
 * redrawn twice produces duplicates. Both would be stored, sent and tested
 * forever. Merging only joins rects that share a full edge, so the union of the
 * output is exactly the union of the input — this tidies the shape, it never
 * changes which chunks are covered.
 */
export function normalizeRects(list: unknown): ChunkRect[] {
  if (!Array.isArray(list)) return []
  let out: ChunkRect[] = []
  for (const raw of list.slice(0, MAX_RECTS_PER_AREA * 4)) {
    const r = raw && typeof raw === 'object' ? normalizeRect(raw as ChunkRect) : null
    if (r) out.push(r)
  }

  // Merge until nothing more lines up. Bounded by the rect count, which is
  // capped above, so this cannot spin.
  let merged = true
  while (merged && out.length > 1) {
    merged = false
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]
        const b = out[j]
        let joined: ChunkRect | null = null
        if (a.z1 === b.z1 && a.z2 === b.z2 && (a.x2 + 1 === b.x1 || b.x2 + 1 === a.x1)) {
          joined = { x1: Math.min(a.x1, b.x1), x2: Math.max(a.x2, b.x2), z1: a.z1, z2: a.z2 }
        } else if (a.x1 === b.x1 && a.x2 === b.x2 && (a.z2 + 1 === b.z1 || b.z2 + 1 === a.z1)) {
          joined = { x1: a.x1, x2: a.x2, z1: Math.min(a.z1, b.z1), z2: Math.max(a.z2, b.z2) }
        } else if (contains(a, b)) {
          joined = a
        } else if (contains(b, a)) {
          joined = b
        }
        if (joined) {
          out = out.filter((_, k) => k !== i && k !== j)
          out.push(joined)
          merged = true
          break outer
        }
      }
    }
  }

  // Stable order, so two identical selections serialise identically and a diff
  // of the stored file shows real edits rather than reshuffling.
  out.sort((a, b) => a.x1 - b.x1 || a.z1 - b.z1 || a.x2 - b.x2 || a.z2 - b.z2)
  return out.slice(0, MAX_RECTS_PER_AREA)
}

export function areaChunkCount(a: Pick<ChunkArea, 'rects'>): number {
  let n = 0
  for (const r of a.rects) n += rectChunks(r)
  return n
}

export function areaHas(a: Pick<ChunkArea, 'rects'>, cx: number, cz: number): boolean {
  for (const r of a.rects) if (rectHas(r, cx, cz)) return true
  return false
}

/**
 * Which area owns this chunk, when several do.
 *
 * SMALLEST WINS. A plot inside a town inside a claimed continent should read as
 * the plot — the specific label is the informative one, and the big region is
 * still visible everywhere the small one is not. The alternative, an explicit
 * z-order field, is one more thing for four separate UIs to get right and for an
 * operator to have to think about.
 *
 * Ties break on the most recent edit, then on id, so the answer is total: every
 * surface resolves the same chunk to the same area, which is the whole point of
 * deciding it here instead of in each of them.
 */
export function areaIndex(areas: ChunkArea[], dim: string): ChunkArea[] {
  const want = normalizeDimension(dim)
  return areas
    .filter((a) => normalizeDimension(a.dim) === want)
    .map((a) => ({ a, size: areaChunkCount(a) }))
    .sort((p, q) => p.size - q.size || q.a.updatedAt - p.a.updatedAt || (q.a.id > p.a.id ? 1 : -1))
    .map((p) => p.a)
}

/** First hit in a list `areaIndex` has already ordered. */
export function areaAtIndexed(sorted: ChunkArea[], cx: number, cz: number): ChunkArea | undefined {
  for (const a of sorted) if (areaHas(a, cx, cz)) return a
  return undefined
}

/**
 * The one-off lookup: what is under this chunk?
 *
 * A renderer must NOT call this per chunk — it re-sorts and re-measures every
 * area each time, which at 200 areas over a screenful of chunks is millions of
 * comparisons a frame. Hoist `areaIndex` out of the loop and call
 * `areaAtIndexed`. This signature is for the hover readout, which happens once
 * per pointer move.
 */
export function areaAt(
  areas: ChunkArea[],
  cx: number,
  cz: number,
  dim: string
): ChunkArea | undefined {
  return areaAtIndexed(areaIndex(areas, dim), cx, cz)
}

/** Areas that touch this dimension, so a surface drawing one dimension tests only its own. */
export function areasFor(areas: ChunkArea[], dim: string): ChunkArea[] {
  const want = normalizeDimension(dim)
  return areas.filter((a) => normalizeDimension(a.dim) === want)
}

const HEX = /^#[0-9a-f]{6}$/i

export function normalizeColour(c: unknown): string {
  if (typeof c !== 'string') return AREA_COLOURS[0]
  const s = c.trim()
  if (HEX.test(s)) return s.toLowerCase()
  // `#abc` is valid CSS and would render, but storing both forms means two
  // spellings of one colour and a palette that never matches the swatch.
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase()
  }
  return AREA_COLOURS[0]
}

export type AreaInput = {
  name?: unknown
  note?: unknown
  colour?: unknown
  dim?: unknown
  rects?: unknown
  hidden?: unknown
}

export type AreaCheck =
  | { ok: true; value: Omit<ChunkArea, 'id' | 'createdAt' | 'updatedAt'> }
  | { ok: false; error: string }

/**
 * Validate an area from anywhere — the panel, the desktop app, or a stranger
 * with an API key. The API is the reason this returns a reason: a UI can grey
 * out the save button, an HTTP caller gets whatever the body said.
 */
export function checkArea(input: AreaInput): AreaCheck {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return { ok: false, error: 'name-required' }
  if (name.length > MAX_NAME) return { ok: false, error: 'name-too-long' }
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  if (note.length > MAX_NOTE) return { ok: false, error: 'note-too-long' }

  const rects = normalizeRects(input.rects)
  if (!rects.length) return { ok: false, error: 'no-chunks' }
  const size = areaChunkCount({ rects })
  if (size > MAX_CHUNKS_PER_AREA) return { ok: false, error: 'too-many-chunks' }

  return {
    ok: true,
    value: {
      name,
      note,
      colour: normalizeColour(input.colour),
      dim: normalizeDimension(input.dim),
      rects,
      ...(input.hidden ? { hidden: true } : {})
    }
  }
}

/** Strip an area down to what a visitor may read, and drop the hidden ones entirely. */
export function publicChunkAreas(areas: ChunkArea[], dim?: string): PublicChunkArea[] {
  const want = dim === undefined || dim === '' ? undefined : normalizeDimension(dim)
  const out: PublicChunkArea[] = []
  for (const a of areas) {
    if (a.hidden) continue
    if (want !== undefined && normalizeDimension(a.dim) !== want) continue
    out.push({
      id: a.id,
      name: a.name,
      note: a.note,
      colour: a.colour,
      dim: normalizeDimension(a.dim),
      rects: a.rects
    })
  }
  return out
}

/**
 * Parse typed chunk coordinates — the half of the feature that exists because
 * clicking 400 chunks is not a plan.
 *
 * Accepts, one per line or comma-separated:
 *   `10,20`            a single chunk
 *   `10,20 - 15,25`    a rectangle, corners in any order
 *   `10 20`            spaces work too, because people type what they see
 *
 * Returns what it understood and what it did not, rather than failing whole: a
 * pasted list with one bad line should not throw away the other forty.
 */
export function parseChunkInput(text: string): { rects: ChunkRect[]; bad: string[] } {
  const bad: string[] = []
  const rects: ChunkRect[] = []
  const lines = String(text || '')
    .split(/[\n;]+/)
    .map((l) => l.trim())
    .filter(Boolean)

  for (const line of lines) {
    const nums = line.match(/-?\d+/g)
    if (!nums || (nums.length !== 2 && nums.length !== 4)) {
      bad.push(line)
      continue
    }
    const n = nums.map(Number)
    const r =
      n.length === 2
        ? normalizeRect({ x1: n[0], z1: n[1], x2: n[0], z2: n[1] })
        : normalizeRect({ x1: n[0], z1: n[1], x2: n[2], z2: n[3] })
    if (r) rects.push(r)
    else bad.push(line)
  }
  return { rects: normalizeRects(rects), bad }
}

/**
 * A rect list back to the individual chunks it covers.
 *
 * The inverse of `normalizeRects`, and it exists for one thing: taking a chunk
 * OUT of a selection. Rects are merged on the way in, so the chunk a click lands
 * on is usually in the middle of a rectangle covering forty others — dropping
 * that rectangle would throw away the rest.
 *
 * Capped at `MAX_CHUNKS_PER_AREA`, the same ceiling `checkArea` enforces, so
 * this cannot be asked to build a list an area could never have held anyway.
 */
export function expandRects(rects: ChunkRect[]): ChunkRect[] {
  const out: ChunkRect[] = []
  for (const r of rects) {
    for (let x = r.x1; x <= r.x2; x++) {
      for (let z = r.z1; z <= r.z2; z++) {
        if (out.length >= MAX_CHUNKS_PER_AREA) return out
        out.push({ x1: x, z1: z, x2: x, z2: z })
      }
    }
  }
  return out
}

/** Block coordinates to the chunk containing them. Negative-safe, which `/16|0` is not. */
export function chunkOf(x: number, z: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / 16), cz: Math.floor(z / 16) }
}
