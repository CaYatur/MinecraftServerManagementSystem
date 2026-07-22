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
  LogLine,
  FileEntry,
  PropsData,
  PlayerInfo,
  BackupRecord,
  BackupOptions,
  ScheduleTask,
  ScheduleAction,
  CrashReport
} from './types'
import type { McVersion, BuildInfo, CreateServerOptions, CreateProgress } from './versions'
import type { ModEntry, ModrinthHit } from './mods'

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
  serverCreate: 'servers:create',

  filesList: 'files:list',
  fileRead: 'files:read',
  fileWrite: 'files:write',
  fileDelete: 'files:delete',
  fileRename: 'files:rename',
  folderCreate: 'files:mkdir',
  propsRead: 'props:read',
  propsWrite: 'props:write',
  propsWriteRaw: 'props:write-raw',

  playersList: 'players:list',
  playerOp: 'players:op',
  playerWhitelist: 'players:whitelist',
  playerBan: 'players:ban',
  playerKick: 'players:kick',
  playerGamemode: 'players:gamemode',
  worldControl: 'world:control',
  rconStatus: 'rcon:status',

  modsList: 'mods:list',
  modToggle: 'mods:toggle',
  modDelete: 'mods:delete',
  modAdd: 'mods:add',
  modSearch: 'mods:search',
  modInstall: 'mods:install',

  backupsList: 'backups:list',
  backupCreate: 'backups:create',
  backupDelete: 'backups:delete',
  backupRestore: 'backups:restore',

  schedulesList: 'sched:list',
  scheduleCreate: 'sched:create',
  scheduleUpdate: 'sched:update',
  scheduleDelete: 'sched:delete',
  scheduleRun: 'sched:run',

  crashAnalyze: 'crash:analyze'
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

  listDir(id: string, rel?: string): Promise<FileEntry[]>
  readFile(id: string, rel: string): Promise<{ content: string; binary: boolean }>
  writeFile(id: string, rel: string, content: string): Promise<void>
  deleteEntry(id: string, rel: string): Promise<void>
  renameEntry(id: string, rel: string, newName: string): Promise<void>
  createFolder(id: string, rel: string, name: string): Promise<void>
  readProperties(id: string): Promise<PropsData>
  writeProperties(id: string, updates: Record<string, string>): Promise<void>
  writeRawProperties(id: string, raw: string): Promise<void>

  getPlayers(id: string): Promise<PlayerInfo[]>
  setOp(id: string, player: PlayerInfo, on: boolean): Promise<void>
  setWhitelist(id: string, player: PlayerInfo, on: boolean): Promise<void>
  setBan(id: string, player: PlayerInfo, on: boolean, reason?: string): Promise<void>
  kickPlayer(id: string, player: PlayerInfo, reason?: string): Promise<void>
  setGamemode(id: string, player: PlayerInfo, gm: string): Promise<void>
  worldControl(id: string, cmd: string): Promise<void>
  rconConnected(id: string): Promise<boolean>

  listMods(id: string): Promise<ModEntry[]>
  toggleMod(id: string, rel: string, enable: boolean): Promise<void>
  deleteMod(id: string, rel: string): Promise<void>
  addMod(id: string, folder: 'plugins' | 'mods'): Promise<string | null>
  searchMods(id: string, query: string): Promise<ModrinthHit[]>
  installMod(id: string, projectId: string): Promise<string>

  listBackups(id?: string): Promise<BackupRecord[]>
  createBackup(id: string, opts: BackupOptions): Promise<BackupRecord>
  deleteBackup(backupId: string): Promise<void>
  restoreBackup(backupId: string): Promise<void>

  listSchedules(): Promise<ScheduleTask[]>
  createSchedule(input: {
    serverId: string
    name: string
    cron: string
    action: ScheduleAction
    payload?: string
    enabled?: boolean
  }): Promise<ScheduleTask>
  updateSchedule(id: string, patch: Partial<ScheduleTask>): Promise<ScheduleTask>
  deleteSchedule(id: string): Promise<void>
  runSchedule(id: string): Promise<void>

  analyzeCrash(id: string): Promise<CrashReport>

  // event subscriptions -> return unsubscribe fn
  onServerLog(cb: (e: ServerLogEvent) => void): () => void
  onServerStatus(cb: (s: ServerRuntimeStatus) => void): () => void
  onServerStats(cb: (s: ServerStats) => void): () => void
  onCreateProgress(cb: (p: CreateProgress) => void): () => void
  onToast(cb: (t: ToastEvent) => void): () => void
}
