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

export const SCOPES: Scope[] = [
  'view',
  'console',
  'power',
  'players',
  'files',
  'backups',
  'settings',
  'store'
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
}

export interface ListenerStatus {
  enabled: boolean
  running: boolean
  port: number
  urls: string[]
}

/** User as exposed to the desktop UI (never includes the password hash). */
export interface WebUserView {
  id: string
  username: string
  role: WebRole
  perms: Record<string, Scope[]>
  /** Linked Minecraft username — required for store purchases/delivery. */
  mcName?: string
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
}

/** Product as shown to buyers (no raw commands leaked). */
export interface ProductPublic {
  id: string
  type: ProductType
  name: string
  description: string
  price: number
  icon?: string
  rewardNames?: string[]
}

export interface StorePublic {
  currency: string
  products: ProductPublic[]
}

export interface StoreConfig {
  currency: string
  products: Product[]
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
  reward?: { name: string; icon?: string; crate: boolean; pool?: { name: string; icon?: string }[] }
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
  theme: SiteTheme
  i18n: SiteI18n
  servers: ServerCard[]
  posts: SitePost[]
}

export interface WebStatus {
  bindLan: boolean
  panel: ListenerStatus
  site: ListenerStatus
}
