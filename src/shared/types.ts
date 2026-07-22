// Domain types shared across main / preload / renderer.

export type ServerType =
  | 'vanilla'
  | 'paper'
  | 'folia'
  | 'purpur'
  | 'spigot'
  | 'bukkit'
  | 'fabric'
  | 'quilt'
  | 'forge'
  | 'neoforge'
  | 'mohist'
  | 'arclight'
  | 'velocity'
  | 'waterfall'
  | 'bungeecord'
  | 'unknown'

/** Server software families and what capabilities they expose. */
export const MODDED_TYPES: ServerType[] = ['forge', 'neoforge', 'fabric', 'quilt', 'mohist', 'arclight']
export const PLUGIN_TYPES: ServerType[] = ['paper', 'folia', 'purpur', 'spigot', 'bukkit', 'mohist', 'arclight']
export const PROXY_TYPES: ServerType[] = ['velocity', 'waterfall', 'bungeecord']
/** Types that support the `tps` console command / Paper timings. */
export const TPS_TYPES: ServerType[] = ['paper', 'folia', 'purpur', 'mohist', 'arclight']

export type ServerStatus =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'

export type JavaPreset =
  | 'basic'
  | 'aikars'
  | 'aikars-large' // >12GB heap tuning
  | 'proxy'
  | 'custom'

export interface JavaArgsConfig {
  javaPath: string // '' => auto-detect
  minMemoryMB: number
  maxMemoryMB: number
  preset: JavaPreset
  /** Full JVM + program arg string used when preset === 'custom'. */
  customArgs: string
  /** Extra flags appended after the preset flags (advanced). */
  extraFlags: string
  jarFile: string // e.g. 'server.jar', 'paper.jar'
  nogui: boolean
  /**
   * For Forge/NeoForge (1.17+) which launch via an @args file instead of `-jar`.
   * When set (and preset !== 'custom'), the launch becomes:
   *   java <jvm flags> @<argsFile> [nogui]
   */
  argsFile?: string
}

export interface ServerConfig {
  id: string
  name: string
  path: string
  type: ServerType
  mcVersion: string
  /** Loader/build version, e.g. paper build number or forge version. */
  buildVersion?: string
  createdAt: number
  lastUsedAt: number
  java: JavaArgsConfig
  autoRestart: boolean
  autoRestartOnCrash: boolean
  favorite?: boolean
  /** Optional per-server backup destination override. */
  backupDir?: string
}

export interface ServerRuntimeStatus {
  id: string
  status: ServerStatus
  pid?: number
  startedAt?: number
  exitCode?: number | null
}

export interface ServerStats {
  id: string
  cpu: number // percent of one core (can exceed 100 on multi-core)
  memoryMB: number
  players: { online: number; max: number; names: string[] }
  tps: number | null
  uptimeMs: number
}

export type LogStream = 'stdout' | 'stderr' | 'system'

export interface LogLine {
  id: string
  ts: number
  line: string
  stream: LogStream
}

export type Language = 'auto' | 'en' | 'tr'
export type ResolvedLanguage = 'en' | 'tr'
export type ThemeMode = 'dark' | 'light' | 'system'

export interface AppDefaults {
  javaPath: string
  maxMemoryMB: number
  minMemoryMB: number
  javaPreset: JavaPreset
  /** Seconds of in-game countdown before a graceful stop/restart. */
  stopCountdownSeconds: number
  autoEnableRcon: boolean
}

export interface AppConfig {
  version: number
  language: Language
  theme: ThemeMode
  servers: ServerConfig[]
  activeServerId?: string
  defaults: AppDefaults
  web?: import('./web').WebConfig
  /** Absolute base/launch directory the app is operating from. */
  baseDir?: string
  /** User overrides for server-facing broadcast/kick messages (key -> text). */
  serverMessages?: Record<string, string>
}

export interface ServerMessages {
  keys: string[]
  defaults: Record<string, string>
  overrides: Record<string, string>
}

export interface Bootstrap {
  baseDir: string
  appVersion: string
  systemLocale: string
  resolvedLanguage: ResolvedLanguage
  config: AppConfig
  platform: NodeJS.Platform
  javaDetected: JavaInfo | null
}

export interface JavaInfo {
  path: string
  version: string
  major: number
}

export interface UpdateInfo {
  current: string
  latest?: string
  available: boolean
  url?: string
}

export interface PlayerInfo {
  uuid: string
  name: string
  online: boolean
  op: boolean
  opLevel?: number
  whitelisted: boolean
  banned: boolean
  banReason?: string
  position?: { x: number; y: number; z: number; dimension?: string }
  health?: number
  food?: number
  xpLevel?: number
  lastSeen?: number
  playtimeHours?: number
  ip?: string
  inventory?: InventoryItem[]
}

export interface InventoryItem {
  slot: number
  id: string
  count: number
}

export type PlayerAction =
  | 'op'
  | 'deop'
  | 'whitelist-add'
  | 'whitelist-remove'
  | 'ban'
  | 'pardon'
  | 'kick'
  | 'gamemode'

export interface FileEntry {
  name: string
  path: string // relative to server root, forward-slashed
  isDir: boolean
  size: number
  mtime: number
}

export interface PropsData {
  entries: { key: string; value: string }[]
  raw: string
}

export interface BackupRecord {
  id: string
  serverId: string
  serverName: string
  fileName: string
  path: string
  size: number
  createdAt: number
  kind: 'world' | 'full'
}

export interface BackupOptions {
  kind: 'world' | 'full'
  /** Destination directory (can be on another drive). Empty => default location. */
  destDir?: string
}

export type ScheduleAction = 'restart' | 'stop' | 'start' | 'backup' | 'command' | 'broadcast'

export interface ScheduleTask {
  id: string
  serverId: string
  name: string
  cron: string
  action: ScheduleAction
  payload?: string
  enabled: boolean
  lastRun?: number
  nextRun?: number
}

export interface CrashFinding {
  severity: 'error' | 'warning' | 'info'
  title: string
  detail: string
  suggestion: string
}

export interface CrashReport {
  findings: CrashFinding[]
  logTail: string
  source: string
}

export interface StopOptions {
  /** true => restart after stop. */
  restart?: boolean
  /** Override countdown seconds. */
  countdownSeconds?: number
  /** Skip countdown and stop immediately (still graceful save). */
  immediate?: boolean
  /** Custom kick/shutdown reason (already localized by caller if provided). */
  reason?: string
}
