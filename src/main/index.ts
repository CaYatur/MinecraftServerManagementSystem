import { app, BrowserWindow, shell, Menu, session } from 'electron'
import { join } from 'node:path'
import { loadConfig, getConfig } from './config'
import { registerIpc } from './ipc/register'
import { processManager } from './core/processManager'
import { resolveBaseDir } from './paths'
import { log } from './logger'
import { runSmoke } from './smoke'

let mainWindow: BrowserWindow | null = null
let cleanupDone = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0e0f13',
    autoHideMenuBar: true,
    title: 'Minecraft Server Manager',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

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
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', focusExisting)

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    loadConfig()
    log.info(`MSMS starting. Base dir: ${resolveBaseDir()}`)
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
                "img-src 'self' data: https:; connect-src 'self' https:; font-src 'self' data:"
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
    log.info('Shutting down — stopping running servers…')
    try {
      await processManager.stopAll()
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
