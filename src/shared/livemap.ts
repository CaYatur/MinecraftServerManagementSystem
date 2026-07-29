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

// ---- navigation (#104) ----

/**
 * Where the viewport is looking.
 *
 * Centre plus pixels-per-block rather than a rectangle. A rectangle has to be
 * recomputed whenever the canvas is resized, and every resize would then move
 * the view — which is how a map ends up jumping when a panel is opened on a
 * different screen. Centre and scale survive a resize unchanged.
 */
export interface MapView {
  cx: number
  cz: number
  /** Pixels per block. Larger is closer in. */
  scale: number
}

export interface Viewport {
  width: number
  height: number
}

/** One pixel per fifty blocks, up to eight pixels per block. */
export const MIN_SCALE = 0.02
export const MAX_SCALE = 8

export function clampScale(s: number): number {
  if (!Number.isFinite(s)) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

export function worldToScreen(
  p: { x: number; z: number },
  view: MapView,
  vp: Viewport
): { x: number; y: number } {
  return {
    x: vp.width / 2 + (p.x - view.cx) * view.scale,
    y: vp.height / 2 + (p.z - view.cz) * view.scale
  }
}

/** The inverse. This is the coordinate readout under the cursor. */
export function screenToWorld(
  pt: { x: number; y: number },
  view: MapView,
  vp: Viewport
): { x: number; z: number } {
  return {
    x: view.cx + (pt.x - vp.width / 2) / view.scale,
    z: view.cz + (pt.y - vp.height / 2) / view.scale
  }
}

/** The view that shows `b` with a little room, used as the starting position. */
export function fitView(b: MapBounds, vp: Viewport): MapView {
  const w = Math.max(1, b.maxX - b.minX)
  const h = Math.max(1, b.maxZ - b.minZ)
  return {
    cx: (b.minX + b.maxX) / 2,
    cz: (b.minZ + b.maxZ) / 2,
    scale: clampScale(Math.min(vp.width / w, vp.height / h) * 0.9)
  }
}

/**
 * Zoom by `factor`, keeping the world point under `anchor` where it is.
 *
 * The naive version scales around the centre, which drags whatever the user was
 * looking at away from the cursor — so zooming towards a base walks off it, and
 * the correction is another pan. Anchoring is what makes a wheel feel like a
 * wheel.
 */
export function zoomAt(view: MapView, vp: Viewport, anchor: { x: number; y: number }, factor: number): MapView {
  const before = screenToWorld(anchor, view, vp)
  const scale = clampScale(view.scale * factor)
  const after = screenToWorld(anchor, { ...view, scale }, vp)
  return { cx: view.cx + (before.x - after.x), cz: view.cz + (before.z - after.z), scale }
}

/** Drag: the world moves with the pointer, so the centre moves against it. */
export function panBy(view: MapView, dxPx: number, dyPx: number): MapView {
  return { ...view, cx: view.cx - dxPx / view.scale, cz: view.cz - dyPx / view.scale }
}

// ---- what a visitor is allowed to see (#104) ----

/**
 * A player as the PUBLIC map presents them.
 *
 * Deliberately not `LivePlayer`. The panel's map is for operators; the same
 * payload on a public page is a griefing tool — exact coordinates tell anyone
 * on the internet where every base is, and `y` additionally says whether
 * somebody is in a cave, which is when they cannot defend it.
 *
 * So the public shape drops `y`, `world` and (by default) `uuid`, and rounds
 * what is left. A separate type rather than an optional field, because the
 * difference has to be visible at every call site that returns one.
 */
export interface PublicMapPlayer {
  name?: string
  dim: string
  x: number
  z: number
}

export interface PublicMapConfig {
  enabled: boolean
  /** Which server's map is published. */
  serverId: string
  /** Coordinates are snapped to this many blocks. */
  round: number
  /** Draw skin heads, which means sending names to an avatar service. */
  heads: boolean
  names: boolean
  /**
   * Render the actual terrain under the markers (#119).
   *
   * Its own decision, separate from publishing the map. Player positions can be
   * rounded; terrain cannot — a rendered world is an accurate map of a private
   * server, every base and every farm on it, which is a different thing to
   * agree to than "show roughly where people are".
   */
  world: boolean
  /**
   * Publish structure markers — villages, dungeons, temples (#131).
   *
   * Separate again, and off. The terrain says what the land looks like; this
   * says where the loot is, and an operator can want one without the other.
   */
  structures: boolean
  /**
   * Read a ring of chunks around the viewport as well, so panning is already
   * drawn. Costs more parsing; changes nothing about the world.
   *
   * MSMS never GENERATES terrain — it reads what the server has written. A map
   * that could grow a world by being panned would be a map that can fill a disk.
   */
  loadAhead: boolean
}

/**
 * 64 blocks — four chunks — is enough to see where the server is busy and not
 * enough to walk to somebody's door. Off, rounded and named is the default
 * because publishing is the operator's decision and precision should be one
 * they make deliberately rather than one they inherit.
 */
export const PUBLIC_MAP_DEFAULTS: PublicMapConfig = {
  enabled: false,
  serverId: '',
  round: 64,
  heads: false,
  names: true,
  // The terrain is the map. Publishing a grid with dots on it and calling it a
  // live map was the thing that made the feature look broken (#135).
  world: true,
  structures: false,
  loadAhead: false
}

export const MAX_MAP_ROUND = 512

export function clampRound(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : PUBLIC_MAP_DEFAULTS.round
  return Math.min(MAX_MAP_ROUND, Math.max(0, v))
}

/**
 * Snap to a grid rather than adding noise.
 *
 * Jitter looks more private and is not: a watcher who samples the same player
 * for a minute averages the noise away and recovers the real position. A grid
 * is deterministic — every sample of a stationary player returns the same cell,
 * so there is nothing to average.
 */
export function redactPlayers(list: LivePlayer[], cfg: PublicMapConfig): PublicMapPlayer[] {
  const r = clampRound(cfg.round)
  const snap = (v: number): number => (r > 0 ? Math.round(v / r) * r : Math.round(v))
  return list.map((p) => ({
    // Heads are drawn from the NAME (#116) — the uuid MSMS holds is the offline
    // one on a cracked server and no skin service knows it. So a head needs the
    // name, and publishing a recognisable face while claiming names are hidden
    // would be a lie: a head identifies a player exactly as well as their name.
    ...(cfg.names || cfg.heads ? { name: p.name } : {}),
    dim: p.dim,
    x: snap(p.x),
    z: snap(p.z)
    // No uuid. It was here to key the avatar service and nothing else asks for
    // it, so the public payload is one identifier lighter.
  }))
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
