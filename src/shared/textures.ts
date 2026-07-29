/**
 * Where a Minecraft item's picture lives inside the client jar (#127).
 *
 * Pure, because the answer is a list of guesses and guesses are exactly the kind
 * of thing that should be testable without a 28 MB download. The extractor uses
 * this to decide what to keep, and the lookup uses it to decide what to try.
 */

/** What the app knows about one version's extracted textures. */
export interface AssetStatus {
  version: string
  ready: boolean
  /** How many textures are on disk. */
  count: number
  /** True while a download for this version is in flight. */
  busy: boolean
  sizeMB: number
}

/** The two texture folders that matter. Order is the lookup order. */
export const TEXTURE_ROOTS = ['item', 'block'] as const

/**
 * Suffixes tried for a BLOCK whose id names no texture of its own.
 *
 * Most blocks have `block/<id>.png`, but the ones a player is most likely to be
 * holding do not: `grass_block` is `grass_block_top` and `_side`, a door is
 * `_top` and `_bottom`, a furnace is `_front`. Guessing the front-facing or top
 * texture is what makes a chest look like a chest instead of a text chip.
 *
 * `_top` before `_front` before `_side`: for the blocks where several exist, the
 * top is the face the inventory icon is drawn from.
 */
const BLOCK_SUFFIXES = ['_top', '_front', '_side', '_0', '_still', '_stage0']

/**
 * A few ids whose texture shares no prefix with them at all, so no suffix rule
 * can find it. Deliberately short: this is a list of exceptions, and every entry
 * is a thing an operator will actually see in an inventory.
 */
const ALIASES: Record<string, string> = {
  // Items whose texture is named for the thing rather than the item.
  wheat_seeds: 'item/wheat_seeds',
  redstone: 'item/redstone',
  // Blocks placed from an item with a different texture name.
  cobweb: 'block/cobweb',
  grass_block: 'block/grass_block_side',
  dirt_path: 'block/dirt_path_top',
  farmland: 'block/farmland',
  water_bucket: 'item/water_bucket',
  lava_bucket: 'item/lava_bucket',
  // The three that are drawn from an entity texture and have no block/item png.
  // Named so the lookup fails fast rather than trying eight paths.
  chest: 'block/oak_planks',
  trapped_chest: 'block/oak_planks',
  ender_chest: 'block/obsidian'
}

/**
 * Every path worth trying for one id, most likely first.
 *
 * `id` is expected to be already namespace-stripped and validated — the caller
 * is `itemIconId`, which refuses anything that is not a plain `[a-z0-9_]` id.
 * An empty or unsafe id yields no candidates rather than a path to try, so a
 * hand-edited NBT entry cannot reach into the cache directory.
 */
export function textureCandidates(id: string): string[] {
  const clean = String(id || '').replace(/^minecraft:/, '').trim().toLowerCase()
  if (!/^[a-z0-9_]{1,64}$/.test(clean)) return []
  const out: string[] = []
  const push = (p: string): void => {
    if (!out.includes(p)) out.push(p)
  }
  const alias = ALIASES[clean]
  if (alias) push(alias)
  push('item/' + clean)
  push('block/' + clean)
  for (const s of BLOCK_SUFFIXES) push('block/' + clean + s)
  return out
}

/**
 * Is this a texture the extractor should keep?
 *
 * The client jar holds thousands of files; only two folders are ever looked up,
 * and keeping the rest would turn a cache into a copy of the jar. Animated
 * textures ship a `.mcmeta` beside the png — the png itself is a vertical strip
 * of frames, which draws as a squashed column, so those are skipped rather than
 * shown wrong.
 */
export function wantsTexture(entryPath: string): boolean {
  const m = /^assets\/minecraft\/textures\/(item|block)\/([a-z0-9_]+)\.png$/.exec(
    entryPath.replace(/\\/g, '/')
  )
  return !!m
}

/** `assets/minecraft/textures/item/apple.png` -> `item/apple`. */
export function textureKey(entryPath: string): string {
  const m = /^assets\/minecraft\/textures\/(item|block)\/([a-z0-9_]+)\.png$/.exec(
    entryPath.replace(/\\/g, '/')
  )
  return m ? m[1] + '/' + m[2] : ''
}

/**
 * The Minecraft version whose assets should be used for a server.
 *
 * Snapshots, release candidates and modded version strings all reduce to the
 * release they are built on, because Mojang publishes a client jar per version
 * id and there is no point downloading twenty snapshots of one release to get
 * the same apple. Anything unrecognisable yields '' and the caller falls back.
 */
export function assetVersion(mcVersion: string): string {
  const m = /^(1\.\d{1,2}(?:\.\d{1,2})?)/.exec(String(mcVersion || '').trim())
  return m ? m[1] : ''
}
