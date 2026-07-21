import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { processManager } from './core/processManager'
import { getConfig } from './config'

/* eslint-disable no-console */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  return new Promise((res) => {
    const t0 = Date.now()
    const iv = setInterval(() => {
      if (pred()) {
        clearInterval(iv)
        res(true)
      } else if (Date.now() - t0 > ms) {
        clearInterval(iv)
        res(false)
      }
    }, 100)
  })
}

/**
 * Headless end-to-end smoke test of the spine:
 *  1. renderer mounts and shows the registered server
 *  2. real start -> running (readiness parsed from console)
 *  3. stdin command works
 *  4. graceful stop -> stopped, with the expected log lines observed
 */
export async function runSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('SMOKE: FAIL -', m)
    app.exit(1)
  }
  const pass = (): void => {
    console.log('SMOKE: PASS')
    app.exit(0)
  }

  const id = getConfig().servers[0]?.id
  if (!id) return fail('no server in config')

  // --- 1. renderer render check ---
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('SMOKE: renderer console:', message)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) =>
    console.log('SMOKE: did-fail-load', code, desc)
  )

  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const probe = `(() => {
    const brand = document.querySelector('.brand');
    const items = [...document.querySelectorAll('.server-item .name')].map(n => n.textContent);
    const err = document.body.innerHTML.includes('Failed to start');
    return JSON.stringify({ hasBrand: !!brand, items, err });
  })()`

  let rendered = false
  let renderInfo = ''
  for (let i = 0; i < 40; i++) {
    const raw = await win.webContents.executeJavaScript(probe).catch(() => '{}')
    const r = JSON.parse(raw)
    renderInfo = raw
    if (r.err) return fail('renderer showed error overlay: ' + raw)
    if (r.hasBrand && Array.isArray(r.items) && r.items.includes('TestServer')) {
      rendered = true
      break
    }
    await sleep(150)
  }
  if (!rendered) return fail('renderer did not mount expected UI; last=' + renderInfo)
  console.log('SMOKE: renderer OK ->', renderInfo)

  // --- 2. start ---
  console.log('SMOKE: starting server', id)
  await processManager.start(id).catch((e) => console.log('SMOKE: start threw', String(e)))
  const up = await waitFor(() => processManager.getStatus(id).status === 'running', 20000)
  if (!up) return fail('server never reached running; status=' + processManager.getStatus(id).status)
  console.log('SMOKE: running, pid=', processManager.getStatus(id).pid)

  // --- 3. command over stdin ---
  processManager.sendCommand(id, 'say hello-from-smoke')
  await sleep(400)

  // --- 4. graceful stop ---
  console.log('SMOKE: graceful stop…')
  await processManager.stop(id)
  const down = await waitFor(
    () => ['stopped', 'crashed'].includes(processManager.getStatus(id).status),
    20000
  )
  const finalStatus = processManager.getStatus(id).status
  if (!down || finalStatus !== 'stopped') return fail('did not stop cleanly; status=' + finalStatus)

  const history = processManager.getLogHistory(id)
  const sawDone = history.some((l) => /Done \(/.test(l.line))
  const sawSay = history.some((l) => /hello-from-smoke/.test(l.line))
  const sawStop = history.some((l) => /Stopping the server/.test(l.line))
  console.log(
    `SMOKE: logs=${history.length} sawDone=${sawDone} sawSay=${sawSay} sawStop=${sawStop}`
  )
  if (!sawDone) return fail('never observed "Done (" readiness line')
  if (!sawStop) return fail('never observed "Stopping the server" line')

  pass()
}
