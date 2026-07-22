import { contextBridge, ipcRenderer } from 'electron'
import { IPC, EVT } from '@shared/ipc'
import type { MsmsApi } from '@shared/ipc'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: MsmsApi = {
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  quit: () => ipcRenderer.invoke(IPC.appQuit),
  openPath: (target) => ipcRenderer.invoke(IPC.openPath, target),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),

  getConfig: () => ipcRenderer.invoke(IPC.configGet),
  setLanguage: (lang) => ipcRenderer.invoke(IPC.configSetLanguage, lang),
  setTheme: (theme) => ipcRenderer.invoke(IPC.configSetTheme, theme),
  updateDefaults: (patch) => ipcRenderer.invoke(IPC.configUpdateDefaults, patch),

  pickFolder: (defaultPath) => ipcRenderer.invoke(IPC.dialogPickFolder, defaultPath),
  pickFile: (filters) => ipcRenderer.invoke(IPC.dialogPickFile, filters),

  scanServers: () => ipcRenderer.invoke(IPC.serversScan),
  listServers: () => ipcRenderer.invoke(IPC.serversList),
  addServer: (path) => ipcRenderer.invoke(IPC.serversAdd, path),
  removeServer: (id, deleteFiles) => ipcRenderer.invoke(IPC.serversRemove, id, deleteFiles),
  updateServer: (id, patch) => ipcRenderer.invoke(IPC.serversUpdate, id, patch),
  detectServerType: (path) => ipcRenderer.invoke(IPC.serversDetect, path),
  setActiveServer: (id) => ipcRenderer.invoke(IPC.serversSetActive, id),

  startServer: (id) => ipcRenderer.invoke(IPC.procStart, id),
  stopServer: (id, opts) => ipcRenderer.invoke(IPC.procStop, id, opts),
  restartServer: (id, opts) => ipcRenderer.invoke(IPC.procRestart, id, opts),
  killServer: (id) => ipcRenderer.invoke(IPC.procKill, id),
  sendCommand: (id, command) => ipcRenderer.invoke(IPC.procCommand, id, command),
  getStatus: (id) => ipcRenderer.invoke(IPC.procStatus, id),
  getAllStatus: () => ipcRenderer.invoke(IPC.procStatusAll),
  getLogHistory: (id) => ipcRenderer.invoke(IPC.procLogHistory, id),

  listVersions: (type, incl) => ipcRenderer.invoke(IPC.versionsList, type, incl),
  listBuilds: (type, mc, incl) => ipcRenderer.invoke(IPC.versionsBuilds, type, mc, incl),
  createServer: (opts) => ipcRenderer.invoke(IPC.serverCreate, opts),

  listDir: (id, rel) => ipcRenderer.invoke(IPC.filesList, id, rel),
  readFile: (id, rel) => ipcRenderer.invoke(IPC.fileRead, id, rel),
  writeFile: (id, rel, content) => ipcRenderer.invoke(IPC.fileWrite, id, rel, content),
  deleteEntry: (id, rel) => ipcRenderer.invoke(IPC.fileDelete, id, rel),
  renameEntry: (id, rel, newName) => ipcRenderer.invoke(IPC.fileRename, id, rel, newName),
  createFolder: (id, rel, name) => ipcRenderer.invoke(IPC.folderCreate, id, rel, name),
  readProperties: (id) => ipcRenderer.invoke(IPC.propsRead, id),
  writeProperties: (id, updates) => ipcRenderer.invoke(IPC.propsWrite, id, updates),
  writeRawProperties: (id, raw) => ipcRenderer.invoke(IPC.propsWriteRaw, id, raw),

  getPlayers: (id) => ipcRenderer.invoke(IPC.playersList, id),
  setOp: (id, player, on) => ipcRenderer.invoke(IPC.playerOp, id, player, on),
  setWhitelist: (id, player, on) => ipcRenderer.invoke(IPC.playerWhitelist, id, player, on),
  setBan: (id, player, on, reason) => ipcRenderer.invoke(IPC.playerBan, id, player, on, reason),
  kickPlayer: (id, player, reason) => ipcRenderer.invoke(IPC.playerKick, id, player, reason),
  setGamemode: (id, player, gm) => ipcRenderer.invoke(IPC.playerGamemode, id, player, gm),
  worldControl: (id, cmd) => ipcRenderer.invoke(IPC.worldControl, id, cmd),
  rconConnected: (id) => ipcRenderer.invoke(IPC.rconStatus, id),

  onServerLog: (cb) => subscribe(EVT.serverLog, cb),
  onServerStatus: (cb) => subscribe(EVT.serverStatus, cb),
  onServerStats: (cb) => subscribe(EVT.serverStats, cb),
  onCreateProgress: (cb) => subscribe(EVT.createProgress, cb),
  onToast: (cb) => subscribe(EVT.toast, cb)
}

contextBridge.exposeInMainWorld('msms', api)
