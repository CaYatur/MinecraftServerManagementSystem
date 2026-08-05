import { app, BrowserWindow, shell, Menu, session, dialog } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadConfig, getConfig } from './config'
import { registerIpc } from './ipc/register'
import { processManager } from './core/processManager'
import { listServers } from './core/serverRegistry'
import { initScheduler, stopAllJobs } from './core/scheduler'
import { initWebServer, stopWebServer } from './web/server'
import { initEconomy } from './store/economy'
import { initMetrics, flushAll as flushMetrics } from './core/metrics'
import { initEvents } from './core/events'
import { initAudit } from './core/audit'
import { initAlerts } from './core/alerts'
import { initBlockColours } from './core/clientAssets'
import { resolveBaseDir } from './paths'
import { log } from './logger'
import { startTileWarming } from './core/tileWarm'
import {
  runSmoke,
  runWizardSmoke,
  runRealSmoke,
  runWebSmoke,
  runMetricsSmoke,
  runEventsSmoke,
  runAlertsSmoke,
  runAnalysisSmoke,
  runWorldsSmoke,
  runJavaSmoke,
  runModUpdateSmoke,
  runBridgeSmoke,
  runAuditSmoke
} from './smoke'
import { runShots } from './shots'
import { registerImageScheme, handleImageProtocol, IMG_SCHEME } from './imgProtocol'
import { SPLASH_HTML } from './splashHtml'

// Has to happen before the app is ready.
registerImageScheme()

let mainWindow: BrowserWindow | null = null
let splash: BrowserWindow | null = null
let splashShownAt = 0
let cleanupDone = false


/**
 * Refuse to close while a server is running, and say why.
 *
 * Quitting used to stop every server with `immediate: true` — no countdown, no
 * warning, no chance to say no. From the operator's side that is the app
 * closing and their players being dropped without a word; from a player's side
 * it is the server vanishing mid-sentence.
 *
 * So: ask first, and then stop properly. `immediate` is gone — the configured
 * countdown runs, which broadcasts to players and gives the world time to save.
 * A server that will not go down in time is killed rather than left orphaned,
 * because the alternative is a Java process holding the world files after MSMS
 * has exited.
 */
let quitConfirmed = false

function runningServerNames(): string[] {
  return listServers()
    .filter((s) => processManager.isRunning(s.id))
    .map((s) => s.name)
}

async function confirmQuit(parent?: BrowserWindow): Promise<boolean> {
  if (quitConfirmed) return true
  const names = runningServerNames()
  if (!names.length) return true
  const tr = getConfig().language === 'tr'
  const list = names.join(', ')
  const opts = {
    type: 'warning' as const,
    buttons: tr ? ['Sunucuları durdur ve kapat', 'Vazgeç'] : ['Stop servers and quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: tr ? 'Sunucu hâlâ çalışıyor' : 'A server is still running',
    message: tr
      ? names.length === 1
        ? `"${list}" hâlâ çalışıyor.`
        : `${names.length} sunucu hâlâ çalışıyor: ${list}`
      : names.length === 1
        ? `"${list}" is still running.`
        : `${names.length} servers are still running: ${list}`,
    detail: tr
      ? 'Kapatmadan önce durdurulacaklar. Oyunculara geri sayım duyurulur ve dünya kaydedilir; bu birkaç saniye sürebilir.'
      : 'They will be stopped before MSMS exits. Players get the countdown and the world is saved, which can take a few seconds.'
  }
  const r = parent
    ? await dialog.showMessageBox(parent, opts)
    : await dialog.showMessageBox(opts)
  if (r.response !== 0) return false
  quitConfirmed = true
  return true
}

/** Stop everything the way an operator would, then give up on stragglers. */
async function shutdownServers(): Promise<void> {
  const running = listServers().filter((s) => processManager.isRunning(s.id))
  if (!running.length) return
  log.info(`Shutting down — stopping ${running.length} running server(s) with the usual countdown…`)
  await Promise.all(
    running.map(async (s) => {
      try {
        // A ceiling, so one wedged server cannot keep the app alive forever.
        // Whatever is still up after it is killed rather than orphaned.
        await Promise.race([
          processManager.stop(s.id),
          new Promise((r) => setTimeout(r, 45_000))
        ])
      } catch (e) {
        log.warn(`Stopping ${s.name} failed:`, e)
      }
      if (processManager.isRunning(s.id)) {
        log.warn(`${s.name} did not stop in time; killing it`)
        try {
          await processManager.kill(s.id)
        } catch {
          /* nothing left to try */
        }
      }
    })
  )
}

function createSplash(): void {
  splash = new BrowserWindow({
    width: 440,
    height: 290,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    skipTaskbar: true,
    backgroundColor: '#00000000'
  })
  splashShownAt = Date.now()
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML))
}

function closeSplash(): void {
  if (splash && !splash.isDestroyed()) splash.close()
  splash = null
}

function createWindow(): void {
  const devIcon = join(__dirname, '../../build/icon.png')
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0e0f13',
    autoHideMenuBar: true,
    title: 'CaYaDev Server Manager',
    ...(existsSync(devIcon) ? { icon: devIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    const reveal = (): void => {
      mainWindow?.show()
      closeSplash()
    }
    // Keep the splash up for a brief minimum so it doesn't just flash.
    const elapsed = Date.now() - splashShownAt
    setTimeout(reveal, splashShownAt ? Math.max(0, 850 - elapsed) : 0)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('close', (e) => {
    // Asked HERE as well as on before-quit: closing the window is the usual way
    // out, and a dialog that appears after the window has already gone reads as
    // the app having crashed and then argued about it.
    if (quitConfirmed || cleanupDone) return
    if (!runningServerNames().length) return
    e.preventDefault()
    void confirmQuit(mainWindow ?? undefined).then((ok) => {
      if (ok) mainWindow?.close()
    })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function focusExisting(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
}

// Single-instance lock: two instances on the same launch dir = data corruption.
//
// Scoped to the launch dir, which is what that sentence actually says. Electron
// keys the lock on the userData path, and leaving that at its default made the
// lock app-wide — so a portable copy running from the user's desktop blocked a
// smoke run out of the repo, two installs that share no state at all. Pointing
// userData inside the launch dir makes the lock mean what it claims, and puts
// Electron's own cache next to everything else this app keeps, which is the
// portable behaviour the rest of the program already has.
app.setPath('userData', join(resolveBaseDir(), 'msms-data', 'chrome'))
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // A smoke run that loses the lock has tested nothing, and quitting 0 would
  // report that as a pass. One stray instance left behind by an earlier run
  // would then turn every gate green while executing none of them — which is
  // worse than a failing test, because it looks like a working one.
  if (Object.keys(process.env).some((k) => k.startsWith('MSMS_SMOKE'))) {
    // eslint-disable-next-line no-console
    console.log('SMOKE: FAIL - another instance holds the single-instance lock; nothing ran')
    app.exit(1)
  } else {
    app.quit()
  }
} else {
  app.on('second-instance', focusExisting)

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    loadConfig()
    log.info(`MSMS starting. Base dir: ${resolveBaseDir()}`)
    handleImageProtocol()
    registerIpc()

    // Strict CSP for the packaged (file://) renderer. Skipped in dev so Vite's
    // HMR websocket/module loading keeps working.
    if (!process.env['ELECTRON_RENDERER_URL']) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
                `img-src 'self' data: https: ${IMG_SCHEME}:; connect-src 'self' https:; font-src 'self' data:`
            ]
          }
        })
      })
    }

    if (process.env['MSMS_SMOKE']) {
      runSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_WIZARD']) {
      runWizardSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('WIZARD-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_REAL']) {
      runRealSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('REAL-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_EVENTS']) {
      runEventsSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('EVENTS-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_METRICS']) {
      runMetricsSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('METRICS-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_MODUPDATE']) {
      runModUpdateSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('MODUPDATE-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_BRIDGE']) {
      runBridgeSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('BRIDGE-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_AUDIT']) {
      runAuditSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('AUDIT-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_JAVA']) {
      runJavaSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('JAVA-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_WORLDS']) {
      runWorldsSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('WORLDS-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_ANALYSIS']) {
      runAnalysisSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('ANALYSIS-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_ALERTS']) {
      runAlertsSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('ALERTS-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }
    if (process.env['MSMS_SMOKE_WEB']) {
      runWebSmoke().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('WEB-SMOKE: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }

    // Documentation screenshots, taken by the app of itself. Before the splash
    // and the main window, because it makes its own.
    if (process.env['MSMS_SHOTS']) {
      runShots().catch((e) => {
        // eslint-disable-next-line no-console
        console.log('SHOTS: FAIL - exception', String(e))
        app.exit(1)
      })
      return
    }

    createSplash()
    initEconomy()
    initMetrics()
    initEvents()
    initAudit()
    initScheduler()
    initAlerts()
    // Averaged block colours, if any version's textures are on disk (#127).
    // Before the web server, because the public map draws from the same table.
    initBlockColours()
    initWebServer()
    // AFTER the colour table, never before: a warmer that ran first would parse
    // the world with the fallback palette and write those colours into the
    // cache, where they would outlive the process (#160, #161).
    startTileWarming()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Gracefully stop all servers before exiting (no orphaned Java processes).
  app.on('before-quit', async (e) => {
    if (cleanupDone) return
    e.preventDefault()
    // Every other way out — the menu, a signal, the taskbar — lands here.
    if (!(await confirmQuit(mainWindow ?? undefined))) return
    try {
      stopAllJobs()
      stopWebServer()
      await shutdownServers()
      flushMetrics()
    } catch (err) {
      log.error('Error during shutdown:', err)
    } finally {
      cleanupDone = true
      app.quit()
    }
  })
}

// Keep a reference so the config module is initialized eagerly.
void getConfig
