import type { BridgePlayer } from './bridge'

/**
 * Pure rules for the live world map (#26) and the live half of the player API
 * (#49).
 *
 * Both read the same feed — the position list the MSMS Bridge plugin sends on
 * every heartbeat — so the rules about what counts as "live", where the map is
 * centred and how a heatmap is bucketed live here rather than in the three
 * places that draw or serve it.
 */

/** A player position as the map and the API present it. */
export interface LivePlayer {
  name: string
  uuid?: string
  world?: string
  dim: string
  x: number
  y: number
  z: number
}

/**
 * Minecraft's own dimension keys, normalised.
 *
 * The plugin sends whatever `World.getEnvironment()` gives it, and a modded
 * server can send anything at all. Rather than reject an unknown dimension —
 * which would make players on a custom world invisible on the map, the one
 * place you would want to see them — the raw key is kept and only the three
 * vanilla ones are canonicalised.
 */
export function normalizeDimension(dim: unknown): string {
  const d = typeof dim === 'string' ? dim.trim().toLowerCase() : ''
  if (!d) return 'overworld'
  if (d === 'normal' || d === 'overworld' || d === 'minecraft:overworld') return 'overworld'
  if (d === 'nether' || d === 'the_nether' || d === 'minecraft:the_nether') return 'nether'
  if (d === 'the_end' || d === 'end' || d === 'minecraft:the_end') return 'end'
  return d.replace(/^minecraft:/, '')
}

/**
 * Keep only entries the map can actually plot.
 *
 * A bridge message can carry a player whose position the plugin could not read
 * (a login in progress, a world still loading). Those arrive with missing
 * coordinates, and plotting `undefined` puts everyone at the origin — which
 * looks like a crowd standing on spawn rather than like missing data.
 */
export function livePlayers(list: BridgePlayer[] | undefined): LivePlayer[] {
  if (!Array.isArray(list)) return []
  return list
    .filter(
      (p): p is BridgePlayer & { x: number; y: number; z: number } =>
        !!p?.name &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        Number.isFinite(p.z)
    )
    .map((p) => ({
      name: p.name,
      ...(p.uuid ? { uuid: p.uuid } : {}),
      ...(p.world ? { world: p.world } : {}),
      dim: normalizeDimension(p.dim),
      x: Math.round(p.x),
      y: Math.round(p.y),
      z: Math.round(p.z)
    }))
}

export interface MapBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/**
 * The area the map should show.
 *
 * `pad` keeps a player off the very edge of the canvas. The minimum span
 * matters more than it looks: with one player online, or several standing
 * together, the raw bounds collapse to a point and every scale derived from
 * them divides by zero. A floor of 64 blocks means a single player renders at a
 * sane zoom instead of infinitely magnified.
 */
export function mapBounds(players: LivePlayer[], pad = 32, minSpan = 64): MapBounds {
  if (!players.length) return { minX: -minSpan, maxX: minSpan, minZ: -minSpan, maxZ: minSpan }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of players) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  minX -= pad
  maxX += pad
  minZ -= pad
  maxZ += pad
  // Grow around the centre, so widening does not drag the view sideways.
  if (maxX - minX < minSpan) {
    const c = (maxX + minX) / 2
    minX = c - minSpan / 2
    maxX = c + minSpan / 2
  }
  if (maxZ - minZ < minSpan) {
    const c = (maxZ + minZ) / 2
    minZ = c - minSpan / 2
    maxZ = c + minSpan / 2
  }
  return { minX, maxX, minZ, maxZ }
}

/** Block coordinates to a 0..1 position inside the bounds. `z` maps to `y`. */
export function toCanvas(p: { x: number; z: number }, b: MapBounds): { x: number; y: number } {
  const w = b.maxX - b.minX || 1
  const h = b.maxZ - b.minZ || 1
  return { x: (p.x - b.minX) / w, y: (p.z - b.minZ) / h }
}

export interface HeatCell {
  /** Cell origin in block coordinates. */
  x: number
  z: number
  count: number
}

/**
 * Bucket positions into square cells for a heatmap.
 *
 * `cell` is in blocks; 16 is one chunk, which is the unit an operator actually
 * reasons about when they are looking for the lag source. Cells with nothing in
 * them are not emitted — a sparse list is far smaller than a dense grid over a
 * world that can be millions of blocks across.
 */
export function heatmap(points: { x: number; z: number }[], cell = 16): HeatCell[] {
  if (cell <= 0) return []
  const buckets = new Map<string, HeatCell>()
  for (const p of points) {
    const cx = Math.floor(p.x / cell) * cell
    const cz = Math.floor(p.z / cell) * cell
    const key = cx + ':' + cz
    const found = buckets.get(key)
    if (found) found.count++
    else buckets.set(key, { x: cx, z: cz, count: 1 })
  }
  // Busiest first: a consumer that truncates should keep the hot spots.
  return [...buckets.values()].sort((a, b) => b.count - a.count || a.x - b.x || a.z - b.z)
}
