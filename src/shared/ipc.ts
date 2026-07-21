// Central registry of IPC channel names + the typed API surface the preload
// exposes to the renderer as `window.msms`.

import type {
  AppConfig,
  Bootstrap,
  Language,
  ThemeMode,
  ServerConfig,
  ServerRuntimeStatus,
  ServerStats,
  ServerType,
  StopOptions,
  LogLine
} from './types'
import type { McVersion, BuildInfo, CreateServerOptions, CreateProgress } from './versions'

/** request/response channels (renderer -> main via invoke). */
export const IPC = {
  bootstrap: 'app:bootstrap',
  appQuit: 'app:quit',
  openPath: 'app:open-path',
  openExternal: 'app:open-external',

  configGet: 'config:get',
  configSetLanguage: 'config:set-language',
  configSetTheme: 'config:set-theme',
  configUpdateDefaults: 'config:update-defaults',

  dialogPickFolder: 'dialog:pick-folder',
  dialogPickFile: 'dialog:pick-file',

  serversScan: 'servers:scan',
  serversList: 'servers:list',
  serversAdd: 'servers:add',
  serversRemove: 'servers:remove',
  serversUpdate: 'servers:update',
  serversDetect: 'servers:detect',
  serversSetActive: 'servers:set-active',

  procStart: 'process:start',
  procStop: 'process:stop',
  procRestart: 'process:restart',
  procKill: 'process:kill',
  procCommand: 'process:command',
  procStatus: 'process:status',
  procStatusAll: 'process:status-all',
  procLogHistory: 'process:log-history',

  versionsList: 'versions:list',
  versionsBuilds: 'versions:builds',
  serverCreate: 'servers:create'
} as const

/** event channels (main -> renderer via webContents.send). */
export const EVT = {
  serverLog: 'evt:server-log',
  serverStatus: 'evt:server-status',
  serverStats: 'evt:server-stats',
  configChanged: 'evt:config-changed',
  createProgress: 'evt:create-progress',
  toast: 'evt:toast'
} as const

export interface ServerLogEvent {
  serverId: string
  line: LogLine
}

export interface ToastEvent {
  kind: 'info' | 'success' | 'warning' | 'error'
  /** i18n key OR literal message. */
  message: string
  /** interpolation params for the i18n key. */
  params?: Record<string, string | number>
}

export interface AddServerResult {
  ok: boolean
  server?: ServerConfig
  error?: string
}

export interface CreateServerResult {
  ok: boolean
  server?: ServerConfig
  error?: string
}

/** Typed API exposed to the renderer. */
export interface MsmsApi {
  bootstrap(): Promise<Bootstrap>
  quit(): Promise<void>
  openPath(target: string): Promise<void>
  openExternal(url: string): Promise<void>

  getConfig(): Promise<AppConfig>
  setLanguage(lang: Language): Promise<AppConfig>
  setTheme(theme: ThemeMode): Promise<AppConfig>
  updateDefaults(patch: Partial<AppConfig['defaults']>): Promise<AppConfig>

  pickFolder(defaultPath?: string): Promise<string | null>
  pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>

  scanServers(): Promise<ServerConfig[]>
  listServers(): Promise<ServerConfig[]>
  addServer(path: string): Promise<AddServerResult>
  removeServer(id: string, deleteFiles: boolean): Promise<void>
  updateServer(id: string, patch: Partial<ServerConfig>): Promise<ServerConfig>
  detectServerType(path: string): Promise<{ type: ServerType; mcVersion: string; jarFile: string }>
  setActiveServer(id: string): Promise<void>

  startServer(id: string): Promise<void>
  stopServer(id: string, opts?: StopOptions): Promise<void>
  restartServer(id: string, opts?: StopOptions): Promise<void>
  killServer(id: string): Promise<void>
  sendCommand(id: string, command: string): Promise<void>
  getStatus(id: string): Promise<ServerRuntimeStatus>
  getAllStatus(): Promise<ServerRuntimeStatus[]>
  getLogHistory(id: string): Promise<LogLine[]>

  listVersions(type: ServerType, includeUnstable: boolean): Promise<McVersion[]>
  listBuilds(type: ServerType, mc: string, includeUnstable: boolean): Promise<BuildInfo[]>
  createServer(opts: CreateServerOptions): Promise<CreateServerResult>

  // event subscriptions -> return unsubscribe fn
  onServerLog(cb: (e: ServerLogEvent) => void): () => void
  onServerStatus(cb: (s: ServerRuntimeStatus) => void): () => void
  onServerStats(cb: (s: ServerStats) => void): () => void
  onCreateProgress(cb: (p: CreateProgress) => void): () => void
  onToast(cb: (t: ToastEvent) => void): () => void
}
