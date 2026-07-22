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
  enabled: boolean
  port: number
  bindLan: boolean
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

export interface WebStatus {
  running: boolean
  enabled: boolean
  port: number
  bindLan: boolean
  urls: string[]
}
