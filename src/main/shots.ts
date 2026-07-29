import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as registry from './core/serverRegistry'
import { updateConfig } from './config'
import { log } from './logger'

/**
 * Documentation screenshots, taken by the app of itself (`MSMS_SHOTS=<dir>`).
 *
 * `webContents.capturePage()` renders the window's own content, so this does not
 * photograph the screen: nothing that happens to be in front of the app ends up
 * in the README, and the machine's other windows are never touched. The first
 * attempt at this used a screen grab and captured a game that was running.
 *
 * It also runs against a THROWAWAY base directory with servers invented here, so
 * the pictures show demo data rather than whoever ran it — a README should not
 * publish somebody's real server names, ports or player list.
 *
 * Reproducible on any machine, which is the point: the screenshots can be
 * retaken after a redesign instead of going stale until somebody notices.
 */

interface Shot {
  name: string
  /** Runs in the renderer before the capture. Returns when the view is settled. */
  setup: string
  /** Extra settle time in ms for views that fetch. */
  wait?: number
}

/**
 * Views are reached by clicking the real controls rather than by poking the
 * store: a screenshot taken through a back door can show a state the UI cannot
 * actually produce.
 *
 * By INDEX rather than by label. Matching on text broke twice — the tab bar is
 * not rendered at all until a server is selected, and "Web Panel" and "Web Site"
 * both contain "web", so both shots came out as the site.
 */
const clickNth = (sel: string, n: number): string => `
  (() => {
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
    if (!els[${n}]) return false;
    els[${n}].click();
    return true;
  })()`

/** Tab order, from `TABS` in App.tsx. */
const TAB = {
  dashboard: 0, console: 1, properties: 2, files: 3, players: 4, plugins: 5,
  history: 6, timeline: 7, backups: 8, scheduler: 9, crash: 10, store: 11
}
/** Sidebar footer order, from Sidebar.tsx: site, web panel, audit, settings. */
const FOOT = { site: 0, web: 1, audit: 2, settings: 3 }

const SHOTS: Shot[] = [
  { name: 'dashboard', setup: clickNth('.tab', TAB.dashboard), wait: 1000 },
  { name: 'console', setup: clickNth('.tab', TAB.console), wait: 800 },
  { name: 'properties', setup: clickNth('.tab', TAB.properties), wait: 900 },
  { name: 'files', setup: clickNth('.tab', TAB.files), wait: 1000 },
  { name: 'players', setup: clickNth('.tab', TAB.players), wait: 1200 },
  { name: 'plugins', setup: clickNth('.tab', TAB.plugins), wait: 1000 },
  { name: 'backups', setup: clickNth('.tab', TAB.backups), wait: 800 },
  { name: 'scheduler', setup: clickNth('.tab', TAB.scheduler), wait: 800 },
  { name: 'history', setup: clickNth('.tab', TAB.history), wait: 1400 },
  { name: 'store', setup: clickNth('.tab', TAB.store), wait: 1000 },
  { name: 'web-panel', setup: clickNth('.sidebar-foot .btn', FOOT.web), wait: 1200 },
  { name: 'site', setup: clickNth('.sidebar-foot .btn', FOOT.site), wait: 1200 },
  { name: 'settings', setup: clickNth('.sidebar-foot .btn', FOOT.settings), wait: 800 },
  // Last, because it opens a modal that would otherwise sit over every shot
  // after it.
  { name: 'create-server', setup: clickNth('.sidebar-actions .btn.primary', 0), wait: 1500 }
]

/** A couple of servers that plainly are not real, so nobody mistakes them for advice. */
function seedDemoServers(): void {
  const root = join(process.env['MSMS_BASE_DIR'] ?? app.getPath('temp'), 'demo')
  const make = (folder: string, name: string, type: string, mc: string): void => {
    const path = join(root, folder)
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, 'server.properties'),
      [
        'motd=A CaYaDev demo server',
        'server-port=25565',
        'max-players=20',
        'online-mode=true',
        'view-distance=10',
        'difficulty=normal',
        'level-name=world'
      ].join('\n'),
      'utf-8'
    )
    writeFileSync(join(path, 'server.jar'), 'demo', 'utf-8')
    mkdirSync(join(path, 'plugins'), { recursive: true })
    const sc = registry.makeServerConfig(path, name)
    if (sc) registry.registerServer({ ...sc, type: type as never, mcVersion: mc })
  }
  make('survival', 'Survival', 'paper', '1.21.4')
  make('creative', 'Creative', 'fabric', '1.21.1')
}

export async function runShots(): Promise<void> {
  const dir = process.env['MSMS_SHOTS']?.trim()
  if (!dir) {
    // eslint-disable-next-line no-console
    console.log('SHOTS: FAIL - MSMS_SHOTS must name an output directory')
    app.exit(1)
    return
  }
  mkdirSync(dir, { recursive: true })
  // English, whatever the machine's language is: this README is in English, and
  // a screenshot in another one documents nothing for most readers.
  updateConfig((c) => {
    c.language = 'en'
  })
  seedDemoServers()

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    // Off the desktop's usual area and without a taskbar entry: this window is
    // shown only so it repaints, and it should not look like the app opening.
    skipTaskbar: true,
    backgroundColor: '#0e0f13',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Hidden windows stop painting otherwise, and `capturePage` on a window
      // that never painted returns an empty image.
      backgroundThrottling: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  // Shown, transparent, and never focused.
  //
  // `capturePage()` on a HIDDEN window returns the last frame it happened to
  // paint, which is not the same thing as an empty image — it looks like a
  // working screenshot of the wrong screen. Every tab shot came out as the
  // console that way, while the page underneath had genuinely switched. A
  // window has to be composited to be captured; opacity 0 plus `showInactive`
  // gets that without taking focus or covering anything visibly.
  win.setOpacity(0)
  win.showInactive()
  await new Promise((r) => setTimeout(r, 2500))

  // A server has to be SELECTED before the tab bar exists at all — without this
  // every tab shot missed and the run reported 2 of 12.
  const picked = await win.webContents.executeJavaScript(clickNth('.server-item', 0))
  if (!picked) log.warn('SHOTS: no server to select; the tab shots will be empty')
  await new Promise((r) => setTimeout(r, 1200))

  // What the selectors actually see, printed once. Guessing at this cost two
  // runs: the tab indices were wrong and every shot came out as the console.
  const seen = (await win.webContents.executeJavaScript(`
    JSON.stringify({
      tabs: [...document.querySelectorAll('.tab')].map((e) => (e.textContent || '').trim()),
      foot: [...document.querySelectorAll('.sidebar-foot .btn')].map((e) => (e.textContent || '').trim())
    })`)) as string
  // eslint-disable-next-line no-console
  console.log('SHOTS: selectors see ' + seen)
  let taken = 0
  for (const shot of SHOTS) {
    try {
      const hit = await win.webContents.executeJavaScript(shot.setup)
      if (!hit) {
        log.warn(`SHOTS: could not reach "${shot.name}"`)
        continue
      }
      await new Promise((r) => setTimeout(r, shot.wait ?? 700))
      // Clicked again just before the capture. Selecting a server resets the
      // view asynchronously, and the first `dashboard.png` came out showing the
      // console — a screenshot of the wrong screen, under the right name, which
      // is the sort of documentation error nobody spots for a year.
      await win.webContents.executeJavaScript(shot.setup)
      await new Promise((r) => setTimeout(r, 500))
      const img = await win.webContents.capturePage()
      const png = img.toPNG()
      if (png.length < 5000) {
        log.warn(`SHOTS: "${shot.name}" came back blank (${png.length} bytes)`)
        continue
      }
      writeFileSync(join(dir, shot.name + '.png'), png)
      taken++
      // eslint-disable-next-line no-console
      console.log(`SHOTS: ${shot.name}.png (${Math.round(png.length / 1024)} KB)`)
      // A modal opened for a screenshot has to be closed before the next one,
      // or every later shot is taken through it.
      await win.webContents.executeJavaScript(
        `(() => { document.querySelectorAll('.modal-back, .modal-backdrop').forEach(() => {});
          const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
          document.dispatchEvent(esc); return true })()`
      )
      await new Promise((r) => setTimeout(r, 250))
    } catch (e) {
      log.warn(`SHOTS: "${shot.name}" failed:`, e)
    }
  }

  // eslint-disable-next-line no-console
  console.log(`SHOTS: ${taken}/${SHOTS.length} written to ${dir}`)
  app.exit(taken > 0 ? 0 : 1)
}
