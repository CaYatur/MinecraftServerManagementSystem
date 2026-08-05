import { normalizeDimension } from './livemap'
import { clampRound } from './livemap'

/**
 * The map page (#146): a third listener whose whole job is one fullscreen map.
 *
 * A LISTENER, not a path on the public site. `WebConfig` already carries a port
 * and an enabled flag per surface, and the reason to follow that shape here is
 * not symmetry: a separate port is what lets an operator expose the map to
 * people who must not reach the shop or the admin panel, with a firewall rule
 * rather than with trust. "Yönetici kısıtlayabilmeli" has to mean something at
 * the network layer, not only in a template.
 *
 * Everything the page is allowed to show is decided here, once, and the feed is
 * built from this rather than from what the panel happens to send.
 */

/** Who may open the page at all. */
export type MapPageAccess =
  /** Anyone who can reach the port. */
  | 'open'
  /** A shared passphrase, checked once and remembered in a cookie. */
  | 'password'
  /** A player account from the public site, signed in. */
  | 'players'

export interface MapPageConfig {
  enabled: boolean
  port: number
  /** Which server's world is published. Empty means the page is not ready. */
  serverId: string
  /** Shown in the corner and as the document title. */
  title: string
  access: MapPageAccess
  /**
   * Pinned world. Empty means the visitor may switch between the dimensions
   * that exist — the map page is the one surface where browsing is the point.
   */
  fixedDim: string
  /** Terrain. Off means markers on a grid, which is not a map (#135). */
  world: boolean
  /** Live positions at all. Everything below is moot without it. */
  players: boolean
  names: boolean
  /** Draw skin heads, which means sending names to an avatar service. */
  heads: boolean
  /** Coordinates are snapped to this many blocks. */
  round: number
  structures: boolean
  /** Named chunk areas (#144). On: they are labels written to be read. */
  areas: boolean
  /** A density overlay. Off — it defeats the point of rounding coordinates. */
  heatmap: boolean
}

/**
 * Off, and cautious about everything except the two things that make it a map.
 *
 * Terrain and areas are on because a page with neither is a grid with dots on
 * it. Positions are on but rounded and nameless-by-default is NOT the choice
 * here — names are on, because a map of anonymous dots is not what anybody opens
 * a map page for, and the operator turning the page on has already decided to
 * publish. Precision stays coarse: 64 blocks is enough to see where the server
 * is busy and not enough to walk to somebody's door.
 */
export const MAP_PAGE_DEFAULTS: MapPageConfig = {
  enabled: false,
  port: 8724,
  serverId: '',
  title: 'Live Map',
  access: 'open',
  fixedDim: '',
  world: true,
  players: true,
  names: true,
  heads: true,
  // Exact, matching the public site — see PUBLIC_MAP_DEFAULTS. Rounding is the
  // opt-in now that the map draws terrain a player can be seen standing beside.
  round: 0,
  structures: false,
  areas: true,
  heatmap: false
}

export const MAX_MAP_TITLE = 60

/**
 * A dimension name becomes a FOLDER NAME when its regions are read, so anything
 * that is not a plain name is refused at the boundary rather than trusted at the
 * point of use. Shared with the public site's pinned world, which is where this
 * check was first needed.
 */
export function safeDimName(d: unknown): string {
  const s = typeof d === 'string' ? d.trim() : ''
  if (!s || s.length > 64) return ''
  if (!/^[A-Za-z0-9_.:-]+$/.test(s)) return ''
  if (s === '.' || s === '..' || s.includes('/') || s.includes('\\')) return ''
  return normalizeDimension(s)
}

/** Clamped on the way IN, so a wrong number is never written to the config. */
export function normalizeMapPage(raw: unknown): MapPageConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<MapPageConfig>
  const port = Number(c.port)
  const access: MapPageAccess =
    c.access === 'password' || c.access === 'players' ? c.access : 'open'
  const title = typeof c.title === 'string' ? c.title.trim().slice(0, MAX_MAP_TITLE) : ''
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  return {
    enabled: bool(c.enabled, false),
    // Not the panel's or the site's default, and not zero: a port the operating
    // system picks is a port nobody can bookmark.
    port: Number.isFinite(port) && port >= 1 && port <= 65535 ? Math.floor(port) : MAP_PAGE_DEFAULTS.port,
    serverId: typeof c.serverId === 'string' ? c.serverId : '',
    title: title || MAP_PAGE_DEFAULTS.title,
    access,
    fixedDim: safeDimName(c.fixedDim),
    world: bool(c.world, MAP_PAGE_DEFAULTS.world),
    players: bool(c.players, MAP_PAGE_DEFAULTS.players),
    names: bool(c.names, MAP_PAGE_DEFAULTS.names),
    heads: bool(c.heads, MAP_PAGE_DEFAULTS.heads),
    round: clampRound(c.round),
    structures: bool(c.structures, MAP_PAGE_DEFAULTS.structures),
    areas: bool(c.areas, MAP_PAGE_DEFAULTS.areas),
    heatmap: bool(c.heatmap, MAP_PAGE_DEFAULTS.heatmap)
  }
}

/** What the caller has proved about themselves, as far as this page cares. */
export interface MapPageViewer {
  /** Presented the passphrase and holds the cookie for it. */
  passed?: boolean
  /** Signed in as a linked player on the public site. */
  player?: boolean
}

/**
 * May this viewer see the map?
 *
 * Pure, and the single answer — the HTML route, every feed route and the smoke
 * all call this one function. A page whose door is checked in one place and
 * whose data is checked in another is a page that leaks its data.
 */
export function mapPageAllows(cfg: MapPageConfig, viewer: MapPageViewer): boolean {
  if (!cfg.enabled || !cfg.serverId) return false
  if (cfg.access === 'open') return true
  if (cfg.access === 'password') return !!viewer.passed
  return !!viewer.player
}

/**
 * The settings the PAGE is told about, which is not the whole config.
 *
 * The port is how it was reached, the server id names a machine, and the access
 * mode says how the door is guarded — none of that is a visitor's business, and
 * two of them are worth something to somebody probing.
 */
export interface MapPagePublic {
  title: string
  fixedDim: string
  world: boolean
  players: boolean
  names: boolean
  heads: boolean
  structures: boolean
  areas: boolean
  heatmap: boolean
  round: number
}

export function mapPagePublic(cfg: MapPageConfig): MapPagePublic {
  return {
    title: cfg.title,
    fixedDim: cfg.fixedDim,
    world: cfg.world,
    players: cfg.players,
    names: cfg.names,
    // A head identifies a player exactly as well as a name does, so drawing one
    // while claiming names are hidden would be a lie (#116).
    heads: cfg.heads && cfg.names,
    structures: cfg.structures,
    areas: cfg.areas,
    heatmap: cfg.heatmap,
    round: cfg.round
  }
}
