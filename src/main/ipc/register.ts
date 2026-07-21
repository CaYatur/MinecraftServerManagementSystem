import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron'
import { IPC, EVT } from '@shared/ipc'
import { getConfig, updateConfig } from '../config'
import { resolveBaseDir } from '../paths'
import { resolveLanguage } from '../i18n'
import { detectJava } from '../core/java'
import { detectServer } from '../core/serverDetect'
import * as registry from '../core/serverRegistry'
import { processManager } from '../core/processManager'
import { getProvider } from '../core/versions'
import { createServer } from '../core/createServer'
import { log } from '../logger'
import type { Bootstrap, Language, ThemeMode, ServerConfig, ServerType, StopOptions } from '@shared/types'
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
  H(IPC.serversRemove, (_e, id: string, deleteFiles: boolean) =>
    registry.removeServer(id, deleteFiles)
  )
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

  // --- process control ---
  H(IPC.procStart, (_e, id: string) => processManager.start(id))
  H(IPC.procStop, (_e, id: string, opts?: StopOptions) => processManager.stop(id, opts))
  H(IPC.procRestart, (_e, id: string, opts?: StopOptions) => processManager.restart(id, opts))
  H(IPC.procKill, (_e, id: string) => processManager.kill(id))
  H(IPC.procCommand, (_e, id: string, command: string) => processManager.sendCommand(id, command))
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
      return { ok: true, server }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
  })

  log.info('IPC handlers registered')
}
