import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { IPC, EVT } from '@shared/ipc'
import { getConfig, updateConfig } from '../config'
import { resolveBaseDir } from '../paths'
import { resolveLanguage, defaultMessages, MESSAGE_KEYS } from '../i18n'
import { detectJava } from '../core/java'
import { listJavaInstalls } from '../core/javaScan'
import { detectServer } from '../core/serverDetect'
import * as registry from '../core/serverRegistry'
import { processManager } from '../core/processManager'
import * as audit from '../core/audit'
import * as joins from '../core/joins'
import { installJava } from '../core/javaProvision'
import { getProvider } from '../core/versions'
import { createServer } from '../core/createServer'
import { buildLaunchArgs } from '../core/javaArgs'
import * as files from '../core/serverFiles'
import * as players from '../core/players'
import * as rcon from '../core/rcon'
import * as mods from '../core/mods'
import * as backups from '../core/backups'
import * as worlds from '../core/worlds'
import * as scheduler from '../core/scheduler'
import * as alerts from '../core/alerts'
import { analyzeCrash } from '../core/crash'
import * as metrics from '../core/metrics'
import * as events from '../core/events'
import { checkForUpdates } from '../core/updates'
import { startWebServer, stopWebServer, getWebStatus } from '../web/server'
import * as auth from '../web/auth'
import * as economy from '../store/economy'
import * as site from '../web/site'
import { log } from '../logger'
import type { WebConfig, WebRole, Scope, Product, SiteConfig, SitePost } from '@shared/web'
import type {
  Bootstrap,
  Language,
  ThemeMode,
  ServerConfig,
  ServerType,
  StopOptions,
  PlayerInfo,
  TelemetryConfig,
  WorldDimension
} from '@shared/types'
import type { CreateServerOptions } from '@shared/versions'

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

async function buildBootstrap(): Promise<Bootstrap> {
  const config = getConfig()
  const javaDetected = await detectJava(config.defaults.javaPath).catch(() => null)
  return {
    baseDir: resolveBaseDir(),
    appVersion: app.getVersion(),
    systemLocale: app.getLocale(),
    resolvedLanguage: resolveLanguage(),
    config,
    platform: process.platform,
    javaDetected
  }
}

export function registerIpc(): void {
  // main -> renderer event forwarding
  processManager.on('log', (e) => broadcast(EVT.serverLog, e))
  processManager.on('status', (s) => broadcast(EVT.serverStatus, s))
  processManager.on('stats', (s) => broadcast(EVT.serverStats, s))
  events.eventBus.on('event', (e) => broadcast(EVT.serverEvent, e))

  const H = ipcMain.handle.bind(ipcMain)

  H(IPC.bootstrap, () => buildBootstrap())
  H(IPC.appQuit, () => {
    app.quit()
  })
  H(IPC.openPath, (_e, target: string) => shell.openPath(target))
  H(IPC.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
    return Promise.resolve()
  })
  H(IPC.updateCheck, () => checkForUpdates())

  // --- config ---
  H(IPC.configGet, () => getConfig())
  H(IPC.configSetLanguage, (_e, lang: Language) => {
    const cfg = updateConfig((c) => {
      c.language = lang
    })
    broadcast(EVT.configChanged, cfg)
    return cfg
  })
  H(IPC.configSetTheme, (_e, theme: ThemeMode) => {
    const cfg = updateConfig((c) => {
      c.theme = theme
    })
    broadcast(EVT.configChanged, cfg)
    return cfg
  })
  H(IPC.configUpdateDefaults, (_e, patch: Partial<Bootstrap['config']['defaults']>) => {
    const cfg = updateConfig((c) => {
      c.defaults = { ...c.defaults, ...patch }
    })
    broadcast(EVT.configChanged, cfg)
    return cfg
  })
  H(IPC.messagesGet, () => ({
    keys: MESSAGE_KEYS,
    defaults: defaultMessages(),
    overrides: getConfig().serverMessages ?? {}
  }))
  H(IPC.messagesSet, (_e, overrides: Record<string, string>) => {
    updateConfig((c) => {
      c.serverMessages = overrides
    })
  })

  // --- dialogs ---
  H(IPC.dialogPickFolder, async (_e, defaultPath?: string) => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath || resolveBaseDir()
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })
  H(IPC.dialogPickFile, async (_e, filters?: { name: string; extensions: string[] }[]) => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters
    })
    return res.canceled ? null : res.filePaths[0] ?? null
  })

  // --- servers ---
  H(IPC.serversScan, () => registry.scanServers())
  H(IPC.serversList, () => registry.listServers())
  H(IPC.serversAdd, (_e, path: string) => registry.addServer(path))
  H(IPC.serversRemove, async (_e, id: string, deleteFiles: boolean) => {
    // Stop a running server before removing it (avoids orphaned processes and
    // locked-file deletes on Windows).
    audit.record({ source: 'panel', action: 'server.remove', actor: 'operator', serverId: id, detail: deleteFiles ? 'with files' : 'kept files' })
    if (processManager.isRunning(id)) await processManager.kill(id)
    registry.removeServer(id, deleteFiles)
    alerts.dropServer(id)
  })
  H(IPC.serversUpdate, (_e, id: string, patch: Partial<ServerConfig>) =>
    registry.updateServer(id, patch)
  )
  H(IPC.serversDetect, (_e, path: string) => {
    const d = detectServer(path)
    return { type: d.type, mcVersion: d.mcVersion, jarFile: d.jarFile }
  })
  H(IPC.serversSetActive, (_e, id: string) => {
    updateConfig((c) => {
      c.activeServerId = id
    })
  })
  H(IPC.argsPreview, (_e, java: Parameters<typeof buildLaunchArgs>[0], type: ServerType) =>
    buildLaunchArgs(java, type)
  )

  // --- process control ---
  // Desktop actions are the local operator; server control is the 'panel'
  // source, typed console commands the 'console' source.
  const opAudit = (action: string, id: string): void => {
    audit.record({ source: 'panel', action, actor: 'operator', serverId: id })
  }
  H(IPC.procStart, (_e, id: string) => {
    opAudit('server.start', id)
    return processManager.start(id)
  })
  H(IPC.procStop, (_e, id: string, opts?: StopOptions) => {
    opAudit('server.stop', id)
    return processManager.stop(id, opts)
  })
  H(IPC.procRestart, (_e, id: string, opts?: StopOptions) => {
    opAudit('server.restart', id)
    return processManager.restart(id, opts)
  })
  H(IPC.procKill, (_e, id: string) => {
    opAudit('server.kill', id)
    return processManager.kill(id)
  })
  H(IPC.procCommand, (_e, id: string, command: string) => {
    audit.record({ source: 'console', action: 'command.run', actor: 'operator', serverId: id, target: command })
    return processManager.sendCommand(id, command)
  })
  H(IPC.procStatus, (_e, id: string) => processManager.getStatus(id))
  H(IPC.procStatusAll, () => processManager.getAllStatus())
  H(IPC.procLogHistory, (_e, id: string) => processManager.getLogHistory(id))

  // --- versions + creation ---
  H(IPC.versionsList, (_e, type: ServerType, incl: boolean) =>
    getProvider(type).listVersions(incl)
  )
  H(IPC.versionsBuilds, (_e, type: ServerType, mc: string, incl: boolean) =>
    getProvider(type).listBuilds(mc, incl)
  )
  H(IPC.serverCreate, async (_e, opts: CreateServerOptions) => {
    try {
      const server = await createServer(opts, (p) => broadcast(EVT.createProgress, p))
      audit.record({ source: 'panel', action: 'server.create', actor: 'operator', serverId: server.id, target: server.name, detail: `${opts.type} ${opts.mcVersion}` })
      return { ok: true, server }
    } catch (err) {
      audit.record({ source: 'panel', action: 'server.create', actor: 'operator', ok: false, target: opts.name, detail: String((err as Error)?.message ?? err) })
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
  })

  // --- files + properties ---
  H(IPC.filesList, (_e, id: string, rel?: string) => files.listDir(id, rel))
  H(IPC.fileRead, (_e, id: string, rel: string) => files.readTextFile(id, rel))
  H(IPC.fileWrite, (_e, id: string, rel: string, content: string) =>
    files.writeTextFile(id, rel, content)
  )
  H(IPC.fileDelete, (_e, id: string, rel: string) => files.deleteEntry(id, rel))
  H(IPC.fileRename, (_e, id: string, rel: string, newName: string) =>
    files.renameEntry(id, rel, newName)
  )
  H(IPC.folderCreate, (_e, id: string, rel: string, name: string) =>
    files.createFolder(id, rel, name)
  )
  H(IPC.propsRead, (_e, id: string) => files.readProperties(id))
  H(IPC.propsWrite, (_e, id: string, updates: Record<string, string>) =>
    files.writeProperties(id, updates)
  )
  H(IPC.propsWriteRaw, (_e, id: string, raw: string) => files.writeRawProperties(id, raw))

  // --- players + world controls ---
  H(IPC.playersList, (_e, id: string) => players.getPlayers(id))
  H(IPC.playerOp, (_e, id: string, p: PlayerInfo, on: boolean) => players.setOp(id, p, on))
  H(IPC.playerWhitelist, (_e, id: string, p: PlayerInfo, on: boolean) =>
    players.setWhitelist(id, p, on)
  )
  H(IPC.playerBan, (_e, id: string, p: PlayerInfo, on: boolean, reason?: string) =>
    players.setBan(id, p, on, reason)
  )
  H(IPC.playerKick, (_e, id: string, p: PlayerInfo, reason?: string) =>
    players.kick(id, p, reason)
  )
  H(IPC.playerGamemode, (_e, id: string, p: PlayerInfo, gm: string) =>
    players.setGamemode(id, p, gm)
  )
  H(IPC.worldControl, (_e, id: string, cmd: string) => players.worldControl(id, cmd))
  H(IPC.rconStatus, (_e, id: string) => rcon.isConnected(id))

  // --- mods / plugins ---
  H(IPC.modsList, (_e, id: string) => mods.listMods(id))
  H(IPC.modToggle, (_e, id: string, rel: string, enable: boolean) =>
    mods.toggleMod(id, rel, enable)
  )
  H(IPC.modDelete, (_e, id: string, rel: string) => mods.deleteMod(id, rel))
  H(IPC.modAdd, async (_e, id: string, folder: 'plugins' | 'mods') => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Jar', extensions: ['jar'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    mods.addMod(id, folder, res.filePaths[0])
    return res.filePaths[0].split(/[\\/]/).pop() ?? null
  })
  H(IPC.modSearch, (_e, id: string, query: string) => mods.searchModrinth(id, query))
  H(IPC.modInstall, (_e, id: string, projectId: string) => mods.installModrinth(id, projectId))
  H(IPC.modCheckUpdates, (_e, id: string) => mods.checkUpdates(id))
  H(IPC.modApplyUpdate, (_e, id: string, path: string, versionId: string) =>
    mods.applyUpdate(id, path, versionId)
  )

  // --- java installs ---
  H(IPC.javaList, (_e, refresh?: boolean) => listJavaInstalls(!!refresh))
  // The renderer cannot resolve "auto" itself (JAVA_HOME/PATH live here), so it
  // asks. Mirrors processManager.start: the per-server path, else the app
  // default, else JAVA_HOME/PATH.
  H(IPC.javaResolve, (_e, override: string) =>
    detectJava((override && override.trim()) || getConfig().defaults.javaPath)
  )
  // Downloading + running a JRE is worth a line in the trail, like server.create.
  H(IPC.javaInstall, async (_e, major: number) => {
    try {
      const info = await installJava(major, (p) => broadcast(EVT.javaInstallProgress, p))
      audit.record({ source: 'panel', action: 'java.install', actor: 'operator', target: `temurin-${major}`, detail: info.version })
      return info
    } catch (err) {
      audit.record({ source: 'panel', action: 'java.install', actor: 'operator', ok: false, target: `temurin-${major}`, detail: String((err as Error)?.message ?? err) })
      throw err
    }
  })

  // --- worlds ---
  H(IPC.worldsList, (_e, id: string) => worlds.listWorlds(id))
  H(IPC.worldActivate, (_e, id: string, name: string) => worlds.activateWorld(id, name))
  H(IPC.worldDelete, (_e, id: string, name: string) => worlds.deleteWorld(id, name))
  H(IPC.worldRename, (_e, id: string, name: string, to: string) => worlds.renameWorld(id, name, to))
  H(IPC.worldClone, (_e, id: string, name: string, to: string) => worlds.cloneWorld(id, name, to))
  H(IPC.worldReset, (_e, id: string, name: string, dim: WorldDimension) =>
    worlds.resetDimension(id, name, dim)
  )
  H(IPC.worldExport, async (_e, id: string, name: string) => {
    const res = await dialog.showSaveDialog({
      defaultPath: `${name}.zip`,
      filters: [{ name: 'Zip', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePath) return null
    worlds.exportWorld(id, name, res.filePath)
    return res.filePath
  })
  H(IPC.worldImport, async (_e, id: string, newName: string) => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'World zip', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    await worlds.importWorld(id, res.filePaths[0], newName)
    return newName
  })

  // --- backups ---
  H(IPC.backupsList, (_e, id?: string) => backups.listBackups(id))
  H(IPC.backupCreate, (_e, id: string, opts: Parameters<typeof backups.createBackup>[1]) =>
    backups.createBackup(id, opts)
  )
  H(IPC.backupDelete, (_e, bid: string) => backups.deleteBackup(bid))
  H(IPC.backupRestore, (_e, bid: string) => backups.restoreBackup(bid))

  // --- scheduler ---
  H(IPC.schedulesList, () => scheduler.listTasks())
  H(IPC.scheduleCreate, (_e, input: scheduler.NewTask) => scheduler.createTask(input))
  H(IPC.scheduleUpdate, (_e, id: string, patch) => scheduler.updateTask(id, patch))
  H(IPC.scheduleDelete, (_e, id: string) => scheduler.deleteTask(id))
  H(IPC.scheduleRun, (_e, id: string) => scheduler.runTaskNow(id))

  // --- alert rules ---
  H(IPC.alertsList, (_e, serverId?: string) => alerts.listRules(serverId))
  H(IPC.alertCreate, (_e, input: alerts.NewAlertRule) => alerts.createRule(input))
  H(IPC.alertUpdate, (_e, id: string, patch) => alerts.updateRule(id, patch))
  H(IPC.alertDelete, (_e, id: string) => alerts.deleteRule(id))

  // --- crash analyzer ---
  H(IPC.crashAnalyze, (_e, id: string) => analyzeCrash(id))

  // --- timeline events ---
  H(IPC.eventsQuery, (_e, id: string, q?: events.EventQuery) => events.query(id, q))
  H(IPC.eventsUptime, (_e, id: string, from: number, to: number) => events.uptime(id, from, to))
  H(IPC.auditQuery, (_e, q?: audit.AuditQuery) => audit.query(q))
  H(IPC.auditJoins, (_e, q?: joins.JoinQuery) => joins.joins(q))

  // --- telemetry history ---
  H(IPC.metricsQuery, (_e, id: string, opts: metrics.QueryOptions) => metrics.query(id, opts))
  H(IPC.metricsConfigGet, () => metrics.telemetryConfig())
  H(IPC.metricsConfigSet, (_e, patch: Partial<TelemetryConfig>) => {
    updateConfig((c) => {
      c.telemetry = { ...metrics.telemetryConfig(), ...patch }
    })
    return metrics.telemetryConfig()
  })

  // --- web panel + users (trusted desktop side) ---
  H(IPC.webStatus, () => getWebStatus())
  H(IPC.webSetConfig, (_e, cfg: WebConfig) => {
    updateConfig((c) => {
      c.web = {
        enabled: !!cfg.enabled,
        port: Number(cfg.port) || 8722,
        bindLan: !!cfg.bindLan,
        siteEnabled: !!cfg.siteEnabled,
        sitePort: Number(cfg.sitePort) || 8723
      }
    })
    const w = getConfig().web
    if (w?.enabled || w?.siteEnabled) startWebServer()
    else stopWebServer()
    return getWebStatus()
  })
  H(IPC.webUsers, () => auth.listUsers())
  H(IPC.webUserCreate, (_e, input: { username: string; password: string; role: WebRole; perms: Record<string, Scope[]>; mcName?: string }) =>
    auth.createUser(input.username, input.password, input.role, input.perms, input.mcName)
  )
  H(IPC.webUserDelete, (_e, id: string) => auth.deleteUser(id))
  H(IPC.webUserPerms, (_e, id: string, perms: Record<string, Scope[]>) => auth.setUserPerms(id, perms))
  H(IPC.webUserAudit, (_e, id: string, canAudit: boolean) => {
    // Granting/revoking sight of the personal-data audit log is itself audited.
    const username = auth.setUserAudit(id, !!canAudit)
    audit.record({
      source: 'panel',
      action: 'user.audit-grant',
      actor: 'operator',
      target: username,
      detail: canAudit ? 'granted' : 'revoked'
    })
  })
  H(IPC.webUserPassword, (_e, id: string, password: string) => auth.setUserPassword(id, password))
  H(IPC.webUserMc, (_e, id: string, mcName: string) => auth.setUserMc(id, mcName))

  // --- store / economy (trusted desktop admin) ---
  H(IPC.storeGet, (_e, id: string) => ({
    ...economy.getStoreConfig(id),
    balances: economy.listBalances(id)
  }))
  H(IPC.storeCurrency, (_e, id: string, currency: string) => economy.setCurrency(id, currency))
  H(IPC.storeUpsert, (_e, id: string, product: Product) => economy.upsertProduct(id, product))
  H(IPC.storeDelete, (_e, id: string, productId: string) => economy.deleteProduct(id, productId))
  H(IPC.storeAddBalance, (_e, id: string, mcName: string, amount: number, reason?: string) =>
    economy.addBalance(id, mcName, amount, 'desktop', reason ?? '')
  )
  H(IPC.storeSetBalance, (_e, id: string, mcName: string, amount: number, reason?: string) =>
    economy.setBalance(id, mcName, amount, 'desktop', reason ?? '')
  )
  H(IPC.storeLedger, (_e, id: string, mcName?: string) => economy.getLedger(id, mcName))

  // --- public site / CMS (trusted desktop admin) ---
  H(IPC.siteGet, () => site.getSiteConfig())
  H(IPC.siteSet, (_e, patch: Partial<SiteConfig>) => site.setSiteConfig(patch))
  H(IPC.sitePostUpsert, (_e, post: Partial<SitePost>) => site.upsertPost(post, post.author))
  H(IPC.siteUploads, () => site.listUploads())
  H(IPC.siteLangAdd, (_e, code: string, copyFrom?: string) => site.addLanguage(code, copyFrom))
  H(IPC.siteLangRemove, (_e, code: string) => site.removeLanguage(code))
  H(IPC.sitePostDelete, (_e, id: string) => site.deletePost(id))
  H(IPC.siteUpload, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    if (res.canceled || !res.filePaths[0]) return null
    try {
      return site.saveImage(res.filePaths[0])
    } catch {
      return null
    }
  })

  log.info('IPC handlers registered')
}
