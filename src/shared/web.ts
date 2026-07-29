import type { CrateAnimation } from './crate'
import type { StoreLayout } from './storefront'
import type { PublicMapConfig } from './livemap'
import type { ProfilePublishing } from './profile'

// Per-server permission scopes for web-panel users.
export type Scope =
  | 'view' // see status/stats/console output
  | 'console' // send console commands
  | 'power' // start/stop/restart/kill
  | 'players' // manage players + world controls
  | 'files' // read/write server files
  | 'backups' // create/restore backups
  | 'settings' // edit server settings
  | 'store' // manage the store/economy (Phase 6)
  // Its own scope, not folded into 'players' or 'settings' (#53): deleting or
  // resetting a world destroys data no backup outside MSMS knows about, and an
  // integration that needs to read the world list should not have to be trusted
  // with erasing one.
  | 'worlds' // activate/rename/clone/reset/delete worlds

export const SCOPES: Scope[] = [
  'view',
  'console',
  'power',
  'players',
  'files',
  'backups',
  'settings',
  'store',
  'worlds'
]

export type WebRole = 'owner' | 'user'

export interface WebConfig {
  /** Admin panel listener. */
  enabled: boolean
  port: number
  bindLan: boolean
  /** Public website listener (separate port + toggle). */
  siteEnabled: boolean
  sitePort: number
  /**
   * Origins allowed to call the API from a browser (#50). Default deny: an
   * absent or empty list means no cross-origin request is answered, which is
   * the right default for a surface authenticated with long-lived keys.
   */
  apiOrigins?: string[]
}

export interface ListenerStatus {
  enabled: boolean
  running: boolean
  port: number
  urls: string[]
}

/** User as exposed to the desktop UI (never includes the password hash). */
export interface WebUserView {
  /** Named roles assigned per server (#28). */
  roles?: Record<string, string[]>
  id: string
  username: string
  role: WebRole
  perms: Record<string, Scope[]>
  /** Linked Minecraft username — required for store purchases/delivery. */
  mcName?: string
  /** Account-level grant to read the global audit log (which carries player IPs). */
  canAudit?: boolean
  createdAt: number
}

// ---- store / economy ----
export interface CrateReward {
  name: string
  weight: number
  icon?: string
  /** Console commands run on win; {player} is replaced with the buyer's MC name. */
  commands: string[]
}

export type ProductType = 'item' | 'crate'

export interface Product {
  id: string
  type: ProductType
  name: string
  description: string
  price: number
  icon?: string
  /** For type 'item': commands run on purchase ({player} placeholder). */
  commands: string[]
  /** For type 'crate': weighted reward pool. */
  rewards: CrateReward[]
  /**
   * For type 'crate': the animation this crate plays (#75). Absent means
   * "inherit the store default", which is what every crate created before this
   * existed says - so they all keep playing exactly what they played before.
   */
  crateAnimation?: CrateAnimation
  /** Extra pictures beyond the icon, shown in the detail view (#77). */
  images?: string[]
  /** Prepared but not yet on sale. Filtered out server-side, not in CSS (#81). */
  hidden?: boolean
  /** Finite supply. Decremented atomically with the balance, so it cannot oversell. */
  stock?: number
  /** How many one player may ever buy. Counted from the purchase history. */
  perPlayerLimit?: number
  /** Operator ordering for the 'featured' sort; lower is earlier. */
  sort?: number
}

/**
 * One entry of a crate's contents as a buyer may see it (#79).
 *
 * `chancePct` rather than the raw weight: a weight is only meaningful next to
 * every other weight in the pool, and nobody should have to normalise a column
 * of numbers in their head to find out how likely something is. Crucially there
 * is no `commands` field - what a reward *runs* is server business and must
 * never reach a buyer-facing payload.
 */
export interface PublicReward {
  name: string
  icon?: string
  /** 0-100, rounded to one decimal. */
  chancePct: number
}

/** Product as shown to buyers (no raw commands leaked). */
export interface ProductPublic {
  id: string
  type: ProductType
  name: string
  description: string
  price: number
  icon?: string
  /** For a crate: its contents with odds, shown before buying (#79). */
  rewards?: PublicReward[]
  /** For a crate: the animation it will play, so a storefront can say so. */
  crateAnimation?: CrateAnimation
  /** Extra pictures for the detail view (#77). */
  images?: string[]
  /** Remaining supply, when the product has one at all (#81). */
  stock?: number
  /** How many one player may ever buy, when limited. */
  perPlayerLimit?: number
  /** How many the *asking* player already has. Undefined when nobody is signed in. */
  owned?: number
  /** Operator ordering for the 'featured' sort. */
  sort?: number
}

export interface StorePublic {
  currency: string
  products: ProductPublic[]
  /** Which crate animation this server's panel should play (#16). */
  crateAnimation: CrateAnimation
  /** Section order for the storefront (#80). */
  layout: StoreLayout
}

export interface StoreConfig {
  currency: string
  products: Product[]
  crateAnimation: CrateAnimation
  /** Whether crates or items come first on the storefront (#80). */
  layout: StoreLayout
}

/**
 * An economy category: what a balance change was *for*. Deliberately separate
 * from the product catalogue (#13) - an economy runs on grants, refunds, event
 * payouts and penalties that have no product behind them, and tying those to a
 * store item would force fake products into the shop just to label a payout.
 */
export interface EconomyCategory {
  id: string
  name: string
  /** Optional accent, e.g. '#4ade80'. */
  color?: string
}

export interface EconomyConfig {
  categories: EconomyCategory[]
}

/** Audit trail for every balance change (grants, removals, purchases). */
export interface LedgerEntry {
  id: string
  mcName: string
  delta: number
  balanceAfter: number
  reason: string
  /** Admin username that performed it, or 'purchase'. */
  by: string
  kind: 'grant' | 'remove' | 'set' | 'purchase'
  /** Economy category id, when the admin picked one. Never set for purchases. */
  category?: string
  at: number
}

export interface Txn {
  id: string
  mcName: string
  productId: string
  productName: string
  price: number
  reward?: string
  at: number
}

export interface BuyResult {
  ok: boolean
  error?: string
  balance?: number
  reward?: {
    name: string
    icon?: string
    crate: boolean
    pool?: { name: string; icon?: string }[]
    /**
     * Resolved server-side (#75). The client only ever has the reward, never
     * the product it came from, so the animation has to travel on the reward
     * or a per-crate setting cannot reach the thing that plays it.
     */
    animation?: CrateAnimation
  }
}

// ---- public website / CMS ----
export interface SitePost {
  id: string
  title: string
  /** Short summary shown in the list (optional; falls back to a body excerpt). */
  excerpt?: string
  /** Long body text. */
  body: string
  /** Cover image (uploads filename) shown in the list + detail header. */
  cover?: string
  /** Gallery images (uploads filenames). */
  images: string[]
  /** Admin username that published it. */
  author?: string
  at: number
  updatedAt?: number
}

export type SiteLayout = 'modern' | 'classic' | 'compact'
export type HeroStyle = 'gradient' | 'image' | 'minimal'

export interface SiteTheme {
  accent: string
  bg: string
  card: string
  text: string
  layout: SiteLayout
  heroStyle: HeroStyle
  heroImage?: string
  /** Uploaded logo filename (falls back to the CaYaDev mark). */
  logo?: string
  radius: number
}

export interface SiteI18n {
  defaultLang: string
  /** lang code -> (key -> text). 'en' and 'tr' ship built in; owners can add more. */
  langs: Record<string, Record<string, string>>
}

export interface SiteConfig {
  /** Servers shown on the site (profiles). */
  serverIds: string[]
  /** Which server the store belongs to. */
  storeServerId: string
  siteName: string
  tagline: string
  description: string
  discordUrl: string
  /** Address players connect with, shown on the public site (host or host:port). */
  serverIp: string
  showStore: boolean
  /** Live map on the public site (#104). Off by default; see PublicMapConfig. */
  map: PublicMapConfig
  /** What a stranger may read on a player's profile (#107). All off by default. */
  profile: ProfilePublishing
  theme: SiteTheme
  i18n: SiteI18n
  posts: SitePost[]
}

export interface ServerCard {
  id: string
  name: string
  version: string
  type: string
  running: boolean
  online: number
  max: number
}

export interface PublicSite {
  siteName: string
  tagline: string
  description: string
  discordUrl: string
  serverIp: string
  showStore: boolean
  /**
   * Whether the map tab exists, and how to draw it. Never the serverId — a
   * visitor has no use for it and the feed endpoint does not take one.
   */
  showMap: boolean
  mapHeads: boolean
  /** Whether the terrain is published too — a separate decision (#119). */
  mapWorld: boolean
  /** Whether a profile page is worth offering at all. */
  showProfiles: boolean
  theme: SiteTheme
  i18n: SiteI18n
  servers: ServerCard[]
  posts: SitePost[]
}

export interface WebStatus {
  bindLan: boolean
  panel: ListenerStatus
  site: ListenerStatus
  /** Browser origins allowed to call the API (#50). Empty = deny all. */
  apiOrigins: string[]
}
