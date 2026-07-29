/**
 * Reading Minecraft region files, the parts that are easy to get wrong (#119).
 *
 * Pure: no filesystem, no decompression. What lives here is the bit-level
 * decoding and the colour table — the half where a mistake produces a
 * *plausible* map rather than an error, which is the half worth testing.
 *
 * The format, briefly. `r.<x>.<z>.mca` starts with an 8 KiB header: 4 KiB of
 * location entries (1024 chunks, 3-byte sector offset + 1-byte sector count)
 * and 4 KiB of timestamps. Each chunk sits at `offset * 4096` as a 4-byte
 * length, a 1-byte compression id, then the compressed NBT.
 */

export const SECTOR_BYTES = 4096
export const CHUNKS_PER_REGION_AXIS = 32
/** 16x16 columns per chunk. */
export const CHUNK_AXIS = 16

export interface ChunkLocation {
  /** Byte offset into the region file, or 0 when the chunk is not generated. */
  offset: number
  byteLength: number
}

/**
 * The 1024 chunk locations, indexed `x + z * 32` with x/z local to the region.
 *
 * An entry of all zeroes means "never generated", which is normal and common —
 * a region file is allocated for a 512x512 block area the moment one chunk in
 * it is touched.
 */
export function parseLocationTable(header: Uint8Array): ChunkLocation[] {
  const out: ChunkLocation[] = []
  for (let i = 0; i < 1024; i++) {
    const b = i * 4
    if (b + 4 > header.length) {
      out.push({ offset: 0, byteLength: 0 })
      continue
    }
    const sector = (header[b] << 16) | (header[b + 1] << 8) | header[b + 2]
    const count = header[b + 3]
    out.push({
      offset: sector * SECTOR_BYTES,
      byteLength: count * SECTOR_BYTES
    })
  }
  return out
}

/** Local chunk coordinates to the index used by the location table. */
export function chunkSlot(localX: number, localZ: number): number {
  return localX + localZ * CHUNKS_PER_REGION_AXIS
}

/** Floor division that is correct for negatives — `-1 / 32 | 0` is not. */
export function regionOf(chunk: number): number {
  return Math.floor(chunk / CHUNKS_PER_REGION_AXIS)
}
export function localChunk(chunk: number): number {
  return ((chunk % CHUNKS_PER_REGION_AXIS) + CHUNKS_PER_REGION_AXIS) % CHUNKS_PER_REGION_AXIS
}

/**
 * How many bits one palette index takes.
 *
 * Never fewer than 4, whatever the palette size — a two-entry palette still
 * uses 4 bits per index in the block-state array.
 */
export function bitsPerIndex(paletteLength: number): number {
  const needed = Math.max(1, Math.ceil(Math.log2(Math.max(1, paletteLength))))
  return Math.max(4, needed)
}

/**
 * Whether indices may straddle a long.
 *
 * THE trap in this format. Before 1.16 the indices were packed continuously and
 * an index could span two longs; from 1.16 each long is padded so they never
 * do. Decoding one as the other produces a map that looks like a map — right
 * scale, right shape, wrong blocks, drifting further out of alignment the
 * further into the chunk you read. There is no error to catch, which is exactly
 * why this is a function with a test rather than an assumption in a loop.
 */
export type IndexPacking = 'spanning' | 'padded'

/** 1.16 is the cutover. `dataVersion` is on every chunk from 1.9 onward. */
export const DATA_VERSION_1_16 = 2566
export function packingFor(dataVersion: number | undefined): IndexPacking {
  return typeof dataVersion === 'number' && dataVersion < DATA_VERSION_1_16 ? 'spanning' : 'padded'
}

/**
 * Unpack `count` palette indices from an array of signed 64-bit longs.
 *
 * Longs arrive from NBT as BigInt. They are signed, so the sign bit is part of
 * the data and the shift has to be done on the unsigned interpretation — a
 * plain `>>` on a negative long silently fills with ones and every index in the
 * top bits comes back wrong.
 */
export function unpackIndices(
  longs: bigint[],
  bits: number,
  count: number,
  packing: IndexPacking
): number[] {
  const out = new Array<number>(count).fill(0)
  if (bits <= 0 || !longs.length) return out
  const mask = (1n << BigInt(bits)) - 1n
  const asUnsigned = (v: bigint): bigint => BigInt.asUintN(64, v)

  if (packing === 'padded') {
    const perLong = Math.floor(64 / bits)
    for (let i = 0; i < count; i++) {
      const longIndex = Math.floor(i / perLong)
      if (longIndex >= longs.length) break
      const shift = BigInt((i % perLong) * bits)
      out[i] = Number((asUnsigned(longs[longIndex]) >> shift) & mask)
    }
    return out
  }

  for (let i = 0; i < count; i++) {
    const bitPos = i * bits
    const longIndex = Math.floor(bitPos / 64)
    if (longIndex >= longs.length) break
    const offset = bitPos % 64
    let value = (asUnsigned(longs[longIndex]) >> BigInt(offset)) & mask
    // Straddling: take the remaining high bits from the next long.
    if (offset + bits > 64 && longIndex + 1 < longs.length) {
      const taken = 64 - offset
      const rest = asUnsigned(longs[longIndex + 1]) & ((1n << BigInt(bits - taken)) - 1n)
      value |= rest << BigInt(taken)
    }
    out[i] = Number(value & mask)
  }
  return out
}

/**
 * Blocks that are not surface.
 *
 * Air is obvious; the others are here because a map that stops at the first
 * non-air block puts every cave entrance and every tree at the wrong height,
 * and because water has to be recognised to be drawn as water rather than as
 * whatever is under it.
 */
export const INVISIBLE = new Set(['air', 'cave_air', 'void_air'])

/**
 * Blocks a map looks THROUGH to the ground below.
 *
 * Not cosmetic. The topmost block of a column is very often the plant standing
 * on it, and colouring the column by the plant is what turned a bamboo jungle
 * into a maroon smear and every meadow into blue-grey on a real world: the
 * three most common surface blocks after grass were `short_grass`, `vine` and
 * `fern`, none of which is what you see when you look down at that terrain.
 *
 * Leaves are deliberately NOT here — a forest canopy is exactly what you see
 * from above, and it is already green.
 */
export const SEE_THROUGH = new Set([
  'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush',
  'vine', 'glow_lichen', 'bamboo', 'bamboo_sapling', 'sugar_cane', 'cactus_flower',
  'poppy', 'dandelion', 'blue_orchid', 'allium', 'azure_bluet', 'oxeye_daisy',
  'cornflower', 'lily_of_the_valley', 'wither_rose', 'torchflower', 'pink_petals',
  'sunflower', 'lilac', 'rose_bush', 'peony', 'sweet_berry_bush',
  'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'warped_fungus',
  'cave_vines', 'cave_vines_plant', 'twisting_vines', 'twisting_vines_plant',
  'weeping_vines', 'weeping_vines_plant', 'hanging_roots', 'spore_blossom',
  'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'sea_pickle',
  'torch', 'wall_torch', 'soul_torch', 'soul_wall_torch', 'lantern', 'snow',
  'rail', 'powered_rail', 'detector_rail', 'activator_rail', 'ladder',
  'melon_stem', 'pumpkin_stem', 'wheat', 'carrots', 'potatoes', 'beetroots',
  'nether_wrt', 'cocoa', 'lily_pad', 'moss_carpet', 'fire', 'soul_fire',
  'crimson_roots', 'warped_roots', 'nether_sprouts', 'big_dripleaf', 'small_dripleaf'
])

/**
 * A block that decorates rather than covers. Suffix families, so a new flower
 * or sapling in a future version is skipped without a release.
 */
export function seeThrough(name: string): boolean {
  if (SEE_THROUGH.has(name)) return true
  return (
    name.endsWith('_tulip') ||
    name.endsWith('_sapling') ||
    name.endsWith('_carpet') ||
    name.endsWith('_banner') ||
    name.endsWith('_sign') ||
    name.endsWith('_button') ||
    name.endsWith('_pressure_plate') ||
    name.endsWith('_candle') ||
    name.endsWith('_coral_fan') ||
    name.endsWith('_coral_wall_fan')
  )
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/**
 * Block id to colour.
 *
 * A table rather than the real textures, deliberately for now: the honest
 * long-term answer is to average the actual texture from the client jar Mojang
 * publishes, which needs no third party and would cover modded blocks by
 * reading their resource packs. Until then this covers what a Minecraft world
 * is mostly made of, and `blockColour` falls back to a stable colour derived
 * from the name so an unknown block is consistent rather than invisible.
 */
const COLOURS: Record<string, Rgb> = {
  // The common ones are Minecraft's own map colours rather than eyeballed
  // values — that is the palette the game shows on a map item, so it is the
  // one a player recognises. Mine were darker and redder, which turned a
  // jungle's podzol floor into a maroon smear next to the green canopy.
  grass_block: { r: 127, g: 178, b: 56 },
  dirt: { r: 151, g: 109, b: 77 },
  coarse_dirt: { r: 151, g: 109, b: 77 },
  podzol: { r: 129, g: 86, b: 49 },
  stone: { r: 112, g: 112, b: 112 },
  andesite: { r: 136, g: 136, b: 136 },
  diorite: { r: 188, g: 188, b: 188 },
  granite: { r: 149, g: 103, b: 86 },
  deepslate: { r: 78, g: 78, b: 84 },
  cobblestone: { r: 127, g: 127, b: 127 },
  gravel: { r: 136, g: 126, b: 126 },
  sand: { r: 247, g: 233, b: 163 },
  red_sand: { r: 190, g: 102, b: 33 },
  sandstone: { r: 216, g: 203, b: 155 },
  water: { r: 63, g: 118, b: 228 },
  lava: { r: 216, g: 106, b: 26 },
  snow: { r: 245, g: 245, b: 250 },
  snow_block: { r: 245, g: 245, b: 250 },
  ice: { r: 165, g: 194, b: 245 },
  packed_ice: { r: 141, g: 180, b: 245 },
  blue_ice: { r: 116, g: 167, b: 253 },
  // Canopy: darker than the grass under it, so a forest reads as a forest.
  oak_leaves: { r: 46, g: 110, b: 30 },
  birch_leaves: { r: 110, g: 150, b: 66 },
  spruce_leaves: { r: 42, g: 80, b: 45 },
  jungle_leaves: { r: 48, g: 116, b: 26 },
  acacia_leaves: { r: 98, g: 134, b: 40 },
  dark_oak_leaves: { r: 38, g: 88, b: 26 },
  azalea_leaves: { r: 82, g: 128, b: 48 },
  oak_log: { r: 102, g: 81, b: 50 },
  spruce_log: { r: 58, g: 40, b: 22 },
  birch_log: { r: 216, g: 214, b: 207 },
  jungle_log: { r: 85, g: 67, b: 25 },
  netherrack: { r: 111, g: 54, b: 52 },
  end_stone: { r: 221, g: 223, b: 165 },
  obsidian: { r: 21, g: 18, b: 30 },
  bedrock: { r: 85, g: 85, b: 85 },
  clay: { r: 160, g: 166, b: 179 },
  terracotta: { r: 152, g: 94, b: 67 },
  moss_block: { r: 89, g: 109, b: 45 },
  mud: { r: 60, g: 55, b: 60 },
  farmland: { r: 110, g: 78, b: 52 },
  grass_path: { r: 148, g: 121, b: 65 },
  dirt_path: { r: 148, g: 121, b: 65 },
  // Seen from above on a real world often enough to be worth naming, rather
  // than left to the hash fallback — which is stable but arbitrary, and an
  // arbitrary colour on a common block is what makes a map look wrong.
  mycelium: { r: 111, g: 100, b: 105 },
  rooted_dirt: { r: 144, g: 103, b: 76 },
  mossy_cobblestone: { r: 106, g: 117, b: 92 },
  calcite: { r: 223, g: 224, b: 220 },
  tuff: { r: 108, g: 110, b: 103 },
  dripstone_block: { r: 145, g: 111, b: 92 },
  basalt: { r: 73, g: 71, b: 78 },
  blackstone: { r: 42, g: 35, b: 41 },
  soul_sand: { r: 81, g: 62, b: 50 },
  soul_soil: { r: 75, g: 57, b: 46 },
  magma_block: { r: 142, g: 74, b: 34 },
  glowstone: { r: 231, g: 187, b: 111 },
  crimson_nylium: { r: 130, g: 31, b: 31 },
  warped_nylium: { r: 43, g: 115, b: 112 },
  bamboo_block: { r: 152, g: 165, b: 63 },
  pumpkin: { r: 198, g: 118, b: 24 },
  melon: { r: 111, g: 145, b: 32 },
  hay_block: { r: 166, g: 137, b: 24 },
  glass: { r: 200, g: 220, b: 232 },
  cobweb: { r: 220, g: 224, b: 228 },
  amethyst_block: { r: 133, g: 97, b: 191 },
  cactus: { r: 85, g: 127, b: 47 },
  brick_block: { r: 150, g: 97, b: 83 },
  bricks: { r: 150, g: 97, b: 83 }
}

/** Water reads as water on a map, so the renderer needs to know which is which. */
export const WATERY = new Set(['water', 'bubble_column'])

export function blockColour(rawName: string): Rgb {
  const name = String(rawName || '').replace(/^minecraft:/, '')
  const hit = COLOURS[name]
  if (hit) return hit
  // Families, so a wood or a wool variant is close to right without 400 entries.
  if (name.endsWith('_leaves')) return COLOURS.oak_leaves
  if (name.endsWith('_log') || name.endsWith('_wood')) return COLOURS.oak_log
  if (name.endsWith('_planks')) return { r: 162, g: 130, b: 78 }
  if (name.includes('deepslate')) return COLOURS.deepslate
  if (name.includes('sandstone')) return COLOURS.sandstone
  if (name.includes('terracotta')) return COLOURS.terracotta
  if (name.includes('concrete')) return { r: 125, g: 125, b: 140 }
  if (name.includes('stone') || name.includes('ore')) return COLOURS.stone
  // Stable, not random: an unknown block must look the same on every tile and
  // every reload, or the map shimmers as chunks are re-rendered.
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return { r: 90 + (h % 60), g: 90 + ((h >> 8) % 60), b: 90 + ((h >> 16) % 60) }
}

/**
 * Shade a colour by how much higher it is than the column to the north.
 *
 * This is what makes terrain read as terrain: without it a map is a flat colour
 * chart and a cliff is invisible. The factors are the ones every Minecraft map
 * renderer converged on — a step up is lighter, a step down darker, level
 * ground untouched.
 */
/**
 * Structure kinds worth showing, grouped so a filter has a handful of choices
 * rather than the forty names Minecraft actually uses (#131).
 *
 * The raw ids are namespaced and version-dependent (`minecraft:village_plains`,
 * `minecraft:pillager_outpost`, …), so grouping happens here and the UI filters
 * on the group.
 */
export type StructureKind = 'village' | 'dungeon' | 'temple' | 'fortress' | 'mine' | 'other'

export const STRUCTURE_KINDS: StructureKind[] = [
  'village',
  'dungeon',
  'temple',
  'fortress',
  'mine',
  'other'
]

export function structureKind(rawId: string): StructureKind {
  const id = String(rawId || '').replace(/^minecraft:/, '').toLowerCase()
  if (id.startsWith('village')) return 'village'
  if (id.includes('mineshaft')) return 'mine'
  if (id.includes('fortress') || id.includes('bastion') || id.includes('stronghold')) return 'fortress'
  if (
    id.includes('temple') ||
    id.includes('pyramid') ||
    id.includes('igloo') ||
    id.includes('hut') ||
    id.includes('jungle_pyramid') ||
    id.includes('desert_pyramid')
  ) {
    return 'temple'
  }
  if (
    id.includes('monument') ||
    id.includes('mansion') ||
    id.includes('outpost') ||
    id.includes('trial_chambers') ||
    id.includes('ancient_city') ||
    id.includes('ruined_portal') ||
    id.includes('shipwreck') ||
    id.includes('ocean_ruin') ||
    id.includes('buried_treasure')
  ) {
    return 'dungeon'
  }
  return 'other'
}

/** One structure, as the map draws it. */
export interface StructureMark {
  kind: StructureKind
  /** The raw id, so a tooltip can name the actual thing. */
  id: string
  /** Block coordinates of the structure's start. */
  x: number
  z: number
}

export function shade(colour: Rgb, dh: number): Rgb {
  const f = dh > 0 ? 1.12 : dh < 0 ? 0.86 : 1
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)))
  return { r: clamp(colour.r), g: clamp(colour.g), b: clamp(colour.b) }
}
