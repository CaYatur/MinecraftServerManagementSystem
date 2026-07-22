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
  createdAt: number
}

export interface WebStatus {
  running: boolean
  enabled: boolean
  port: number
  bindLan: boolean
  urls: string[]
}
