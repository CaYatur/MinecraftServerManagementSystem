import { app, BrowserWindow } from 'electron'
import { existsSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import * as nbt from 'prismarine-nbt'
import { processManager } from './core/processManager'
import { getConfig, updateConfig } from './config'
import { startWebServer, stopWebServer } from './web/server'
import * as webAuth from './web/auth'
import * as webPlayerAuth from './web/playerAuth'
import * as economy from './store/economy'
import * as siteMod from './web/site'
import { pickSiteLang } from './web/siteLang'
import type { Product } from '@shared/web'
import { getProvider } from './core/versions'
import { createServer } from './core/createServer'
import { removeServer } from './core/serverRegistry'
import * as sf from './core/serverFiles'
import * as playersMod from './core/players'
import * as backupsMod from './core/backups'
import * as schedulerMod from './core/scheduler'
import * as modsMod from './core/mods'
import * as rcon from './core/rcon'
import * as metrics from './core/metrics'
import * as eventsMod from './core/events'
import { uploadsDir } from './paths'
import { analyzeCrash } from './core/crash'
import { CREATABLE_TYPES } from '@shared/versions'

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
 * Event store verification (Stage 2). Lays down a month of history with
 * synthetic timestamps, then checks filtering, ordering, counts, retention,
 * per-server isolation and cleanup.
 */
export async function runEventsSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('EVENTS-SMOKE: FAIL -', m)
    app.exit(1)
  }
  const SID = 'smoke-events-server'
  const OTHER = 'smoke-events-other'
  const wipe = (): void => {
    eventsMod.dropServer(SID)
    eventsMod.dropServer(OTHER)
  }

  try {
    wipe()
    const DAY = 86400_000
    const now = Date.now()

    // 30 days of history: one start/ready/stop cycle plus a join per day,
    // and a crash + failed backup on two known days.
    for (let d = 30; d >= 1; d--) {
      const base = now - d * DAY
      eventsMod.record(SID, 'server.starting', { ts: base, data: { type: 'paper' } })
      eventsMod.record(SID, 'server.ready', { ts: base + 20_000, data: { startupMs: 20_000 } })
      eventsMod.record(SID, 'player.join', { ts: base + 60_000, data: { player: 'Ada', online: 1 } })
      if (d === 3) eventsMod.record(SID, 'server.crashed', { ts: base + 120_000, data: { code: 1 } })
      else eventsMod.record(SID, 'server.stopped', { ts: base + 120_000, data: { code: 0 } })
      if (d === 5) eventsMod.record(SID, 'backup.failed', { ts: base + 90_000, text: 'disk full' })
    }
    eventsMod.record(OTHER, 'server.ready', { ts: now - DAY, data: { startupMs: 1 } })

    // --- range + ordering ---
    const all = eventsMod.query(SID, { from: now - 31 * DAY, to: now, limit: 2000 })
    if (all.total !== 121) return fail('expected 121 events in 30d, got ' + all.total)
    for (let i = 1; i < all.events.length; i++) {
      if (all.events[i - 1].ts < all.events[i].ts) return fail('events are not newest-first')
    }
    const week = eventsMod.query(SID, { from: now - 7 * DAY, to: now, limit: 2000 })
    if (week.total !== 29) return fail('expected 29 events in 7d, got ' + week.total)

    // --- filters ---
    const joins = eventsMod.query(SID, { from: 0, to: now, types: ['player.join'], limit: 2000 })
    if (joins.total !== 30) return fail('type filter returned ' + joins.total)
    if (joins.events.some((e) => e.type !== 'player.join')) return fail('type filter leaked')
    const bad = eventsMod.query(SID, { from: 0, to: now, severities: ['error'], limit: 2000 })
    if (bad.total !== 2) return fail('severity filter returned ' + bad.total)
    if (!bad.events.every((e) => e.severity === 'error')) return fail('severity filter leaked')
    // counts are computed before filtering, so the UI can show totals per type
    if (bad.counts['player.join'] !== 30) return fail('counts should ignore the filter')
    const capped = eventsMod.query(SID, { from: 0, to: now, limit: 5 })
    if (capped.events.length !== 5 || capped.total !== 121) return fail('limit is wrong')
    if (capped.events[0].ts !== all.events[0].ts) return fail('limit dropped the newest events')
    console.log('EVENTS-SMOKE: 30d history OK (range, ordering, type/severity filters, counts)')

    // --- per-server isolation ---
    if (eventsMod.query(OTHER, { from: 0, to: now }).total !== 1) return fail('server isolation')
    if (all.events.some((e) => e.serverId !== SID)) return fail('foreign events leaked in')

    // --- retention by age ---
    eventsMod.record(SID, 'server.stopped', { ts: now - 200 * DAY, data: { code: 0 } })
    const removed = eventsMod.prune(SID, now)
    if (removed !== 1) return fail('expected the 200-day-old event to expire, pruned ' + removed)
    if (eventsMod.query(SID, { from: 0, to: now, limit: 2000 }).total !== 121) {
      return fail('retention removed live events')
    }

    // --- retention by count ---
    for (let i = 0; i < eventsMod.MAX_EVENTS; i++) {
      eventsMod.record(SID, 'player.leave', { ts: now - 1000 + i, data: { player: 'B', online: 0 } })
    }
    eventsMod.prune(SID, now + 5000)
    const after = eventsMod.query(SID, { from: 0, to: now + 10_000, limit: 2000 })
    if (after.total > eventsMod.MAX_EVENTS) return fail('cap exceeded: ' + after.total)
    if (after.events[0].type !== 'player.leave') return fail('cap dropped the newest events')
    console.log(`EVENTS-SMOKE: retention OK (age + ${eventsMod.MAX_EVENTS} cap, newest kept)`)

    // --- cleanup ---
    eventsMod.dropServer(SID)
    if (eventsMod.query(SID, { from: 0, to: now + 10_000 }).total !== 0) {
      return fail('dropServer left events behind')
    }
    if (eventsMod.pruneOrphans() < 1) return fail('pruneOrphans found no orphan')
    if (eventsMod.query(OTHER, { from: 0, to: now }).total !== 0) return fail('orphan survived')
    for (const s of getConfig().servers) {
      // a registered server's log must never be swept
      eventsMod.record(s.id, 'schedule.run', { ts: now, text: 'orphan-guard' })
      eventsMod.pruneOrphans()
      const kept = eventsMod.query(s.id, { from: now - 1000, to: now + 1000 }).total
      if (kept < 1) return fail('orphan sweep deleted a live server log')
    }
    console.log('EVENTS-SMOKE: cleanup OK (dropped with the server, orphans swept, live logs kept)')

    wipe()
    console.log('EVENTS-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
    wipe()
    fail('exception ' + String(e))
  }
}

/**
 * Telemetry store verification (Stage 1). Replays three hours of readings with
 * synthetic timestamps, then checks the rows, the aggregates, range queries,
 * resolution picking, persistence across a buffer reset, and retention.
 */
export async function runMetricsSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('METRICS-SMOKE: FAIL -', m)
    app.exit(1)
  }
  const SID = 'smoke-metrics-server'
  const dir = join(metrics.metricsDirFor(SID))
  const wipe = (): void => rmSync(dir, { recursive: true, force: true })
  const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol

  try {
    wipe()
    metrics._resetBuffers()
    const saved = getConfig().telemetry
    updateConfig((c) => {
      c.telemetry = { enabled: true, rawHours: 24, minuteDays: 14, hourDays: 365 }
    })

    // 3 hours of readings every 2s, hour-aligned so bucket counts are exact.
    const HOUR = 3600_000
    const t0 = Math.floor(Date.now() / HOUR) * HOUR - 3 * HOUR
    const SAMPLES = (3 * HOUR) / 2000 // 5400
    const spikeAt = t0 + HOUR + 30_000 // one CPU spike + TPS dip
    for (let i = 0; i < SAMPLES; i++) {
      const ts = t0 + i * 2000
      const spike = ts === spikeAt
      metrics.record(
        SID,
        { tps: spike ? 5 : 20, cpu: spike ? 90 : 10, rssMB: 2048, players: spike ? 7 : 3 },
        ts
      )
    }
    metrics.flushServer(SID) // closes the still-open buckets, incl. the last hour

    // --- row counts per tier (independent aggregation, not cascaded) ---
    const all = { from: t0 - HOUR, to: t0 + 4 * HOUR }
    const raw = metrics.query(SID, { ...all, resolution: '10s', limit: 99999 })
    const min = metrics.query(SID, { ...all, resolution: '1m', limit: 99999 })
    const hour = metrics.query(SID, { ...all, resolution: '1h', limit: 99999 })
    if (raw.points.length !== 1080) return fail('10s rows expected 1080, got ' + raw.points.length)
    if (min.points.length !== 180) return fail('1m rows expected 180, got ' + min.points.length)
    if (hour.points.length !== 3) return fail('1h rows expected 3, got ' + hour.points.length)
    if (raw.points.some((p) => p.n !== 5)) return fail('a 10s row does not hold 5 samples')
    if (min.points.some((p) => p.n !== 30)) return fail('a 1m row does not hold 30 samples')
    if (hour.points.some((p) => p.n !== 1800)) return fail('a 1h row does not hold 1800 samples')

    // --- aggregates: the spike must survive downsampling at every tier ---
    for (const s of [raw, min, hour]) {
      if (s.summary.cpuMax !== 90) return fail(`${s.resolution}: cpuMax lost (${s.summary.cpuMax})`)
      if (s.summary.tpsMin !== 5) return fail(`${s.resolution}: tpsMin lost (${s.summary.tpsMin})`)
      if (s.summary.playersMax !== 7) return fail(`${s.resolution}: playersMax lost`)
      if (!near(s.summary.cpuAvg, 10, 0.1)) return fail(`${s.resolution}: cpuAvg ${s.summary.cpuAvg}`)
      if (!near(s.summary.tpsAvg ?? 0, 20, 0.1)) return fail(`${s.resolution}: tpsAvg`)
      if (s.summary.rssAvg !== 2048) return fail(`${s.resolution}: rssAvg ${s.summary.rssAvg}`)
      if (s.summary.samples !== SAMPLES) return fail(`${s.resolution}: samples ${s.summary.samples}`)
    }
    console.log('METRICS-SMOKE: 3h replay OK (1080/180/3 rows, spike + dip preserved at every tier)')

    // --- range queries + automatic resolution ---
    const win = metrics.query(SID, { from: t0 + HOUR, to: t0 + 2 * HOUR - 1, resolution: '10s', limit: 99999 })
    if (win.points.length !== 360) return fail('1h window expected 360 rows, got ' + win.points.length)
    if (win.points.some((p) => p.ts < t0 + HOUR || p.ts >= t0 + 2 * HOUR)) {
      return fail('range query leaked rows outside the window')
    }
    if (win.summary.cpuMax !== 90) return fail('window missed the spike it contains')
    const before = metrics.query(SID, { from: t0 - HOUR, to: t0 - 1, resolution: '10s' })
    if (before.points.length !== 0) return fail('empty range returned rows')
    if (metrics.autoResolution(t0, t0 + 3 * HOUR) !== '10s') return fail('auto res for 3h')
    if (metrics.autoResolution(t0, t0 + 10 * 86400_000) !== '1m') return fail('auto res for 10d')
    if (metrics.autoResolution(t0, t0 + 400 * 86400_000) !== '1h') return fail('auto res for 400d')
    const auto = metrics.query(SID, { from: t0, to: t0 + 3 * HOUR, limit: 99999 })
    if (auto.resolution !== '10s') return fail('query did not pick a resolution automatically')
    const capped = metrics.query(SID, { ...all, resolution: '10s', limit: 50 })
    if (capped.points.length !== 50) return fail('limit ignored, got ' + capped.points.length)
    if (capped.points[capped.points.length - 1].ts !== raw.points[raw.points.length - 1].ts) {
      return fail('limit did not keep the newest rows')
    }
    console.log('METRICS-SMOKE: range + auto-resolution + limit OK')

    // --- persistence: everything above must survive losing the in-memory buffers ---
    metrics._resetBuffers()
    const reread = metrics.query(SID, { ...all, resolution: '10s', limit: 99999 })
    if (reread.points.length !== 1080) return fail('rows lost after buffer reset')

    // --- retention: pruning one tier must not touch the others ---
    updateConfig((c) => {
      c.telemetry = { enabled: true, rawHours: 1, minuteDays: 14, hourDays: 365 }
    })
    const removed = metrics.prune(SID, t0 + 3 * HOUR)
    if (removed !== 720) return fail('expected 720 expired 10s rows, pruned ' + removed)
    const afterRaw = metrics.query(SID, { ...all, resolution: '10s', limit: 99999 })
    const afterMin = metrics.query(SID, { ...all, resolution: '1m', limit: 99999 })
    const afterHour = metrics.query(SID, { ...all, resolution: '1h', limit: 99999 })
    if (afterRaw.points.length !== 360) return fail('after prune 10s rows ' + afterRaw.points.length)
    if (afterRaw.points[0].ts !== t0 + 2 * HOUR) return fail('prune kept the wrong rows')
    if (afterMin.points.length !== 180) return fail('pruning 10s damaged the 1m tier')
    if (afterHour.points.length !== 3) return fail('pruning 10s damaged the 1h tier')
    console.log('METRICS-SMOKE: retention OK (720 raw rows expired, 1m/1h untouched)')

    // --- disabled telemetry records nothing ---
    updateConfig((c) => {
      c.telemetry = { enabled: false, rawHours: 24, minuteDays: 14, hourDays: 365 }
    })
    metrics.record(SID, { tps: 20, cpu: 1, rssMB: 1, players: 0 }, t0 + 3 * HOUR)
    metrics.flushServer(SID)
    if (metrics.query(SID, { ...all, resolution: '10s', limit: 99999 }).points.length !== 360) {
      return fail('telemetry wrote a row while disabled')
    }
    console.log('METRICS-SMOKE: disabled switch honoured')

    updateConfig((c) => {
      c.telemetry = saved
    })

    // --- cleanup: removing a server takes its history with it ---
    if (!existsSync(join(dir, '10s.csv'))) return fail('series file vanished early')
    metrics.dropServer(SID)
    if (existsSync(join(dir, '10s.csv'))) return fail('dropServer left the series behind')

    // --- orphaned folders (server deleted while MSMS was closed) ---
    const ORPHAN = 'smoke-orphan-server'
    metrics.record(ORPHAN, { tps: 20, cpu: 1, rssMB: 10, players: 0 }, t0)
    metrics.flushServer(ORPHAN)
    const orphanFile = join(metrics.metricsDirFor(ORPHAN), '10s.csv')
    if (!existsSync(orphanFile)) return fail('orphan fixture not written')
    if (metrics.pruneOrphans() < 1) return fail('pruneOrphans found nothing')
    if (existsSync(orphanFile)) return fail('orphan folder survived cleanup')
    for (const s of getConfig().servers) {
      if (!existsSync(metrics.metricsDirFor(s.id))) return fail('cleanup removed a live server')
    }
    console.log('METRICS-SMOKE: cleanup OK (history dropped with the server, orphans swept)')

    wipe()
    console.log('METRICS-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
    wipe()
    fail('exception ' + String(e))
  }
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

  // A long file so we can prove the editor scrolls.
  const longLines = Array.from({ length: 400 }, (_, i) => `line ${i + 1} — scroll test content`)
  sf.writeTextFile(id, 'scrolltest.txt', longLines.join('\n'))

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

  // ---- CMS image previews (msms-img://) must work without the web server ----
  {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const fixture = join(uploadsDir(), 'smoke-preview.png')
    writeFileSync(fixture, png)
    const loadImg = (url: string): Promise<string> =>
      win.webContents.executeJavaScript(
        `new Promise(r=>{const i=new Image();i.onload=()=>r('ok:'+i.naturalWidth+'x'+i.naturalHeight);i.onerror=()=>r('error');i.src=${JSON.stringify(url)}})`
      )
    const okRes = await loadImg('msms-img://upload/smoke-preview.png')
    if (okRes !== 'ok:1x1') return fail('upload preview did not load, got ' + okRes)

    // The real complaint: the CMS logo preview rendered blank. Drive the actual
    // Site view and check the <img> it renders really has pixels.
    const themeBefore = { ...siteMod.getSiteConfig().theme }
    siteMod.setSiteConfig({ theme: { ...themeBefore, logo: 'smoke-preview.png' } })
    await win.webContents.executeJavaScript(`document.querySelector('.sidebar-foot button')?.click()`)
    await sleep(400)
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.tab')].find(t=>/Design|Tasarım/i.test(t.textContent||''))?.click()`
    )
    await sleep(400)
    const shown: string = await win.webContents.executeJavaScript(
      `(()=>{const i=document.querySelector('img[src^="msms-img:"]');
       if(!i)return 'no-img';
       return i.complete&&i.naturalWidth>0?('ok:'+i.naturalWidth):'blank'})()`
    )
    if (!shown.startsWith('ok:')) {
      siteMod.setSiteConfig({ theme: { ...themeBefore, logo: themeBefore.logo ?? '' } })
      rmSync(fixture, { force: true })
      return fail('CMS logo preview rendered ' + shown)
    }

    // ...and clearing it the way the user does - X, then Save - must stick.
    await win.webContents.executeJavaScript(
      `(()=>{const i=document.querySelector('img[src^="msms-img:"]');if(!i)return;
       const b=[...i.closest('.row').querySelectorAll('button')];b[b.length-1].click()})()`
    )
    await sleep(200)
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b=>/Save|Kaydet/i.test(b.textContent||''))?.click()`
    )
    await sleep(500)
    const cleared: boolean = await win.webContents.executeJavaScript(
      `!document.querySelector('img[src^="msms-img:"]')`
    )
    const stored = siteMod.getSiteConfig().theme.logo
    siteMod.setSiteConfig({ theme: { ...themeBefore, logo: themeBefore.logo ?? '' } })
    rmSync(fixture, { force: true })
    if (!cleared) return fail('logo preview still visible after clearing it')
    if (stored) return fail('cleared logo came back after saving: ' + stored)
    const traversal = await loadImg('msms-img://upload/..%2F..%2Fconfig.json')
    if (traversal !== 'error') return fail('image protocol escaped the uploads folder')
    const missing = await loadImg('msms-img://upload/definitely-not-here.png')
    if (missing !== 'error') return fail('missing image did not fail')
    console.log(
      'SMOKE: image previews OK (CMS logo ' +
        shown +
        ', cleared via UI + save, traversal + missing blocked)'
    )
  }

  // Sweep every tab + settings + create to ensure no view crashes on mount.
  const viewCrashed = (): Promise<boolean> =>
    win.webContents.executeJavaScript(
      `(()=>{const h=document.querySelector('.center-fill h3');return !!(h&&/Something went wrong/.test(h.textContent||''))})()`
    )
  const tabCount: number = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.tab').length`
  )
  for (let i = 0; i < tabCount; i++) {
    await win.webContents.executeJavaScript(`document.querySelectorAll('.tab')[${i}]?.click()`)
    await sleep(220)
    if (await viewCrashed()) return fail('a view crashed on tab index ' + i)
  }
  await win.webContents.executeJavaScript(
    `document.querySelector('.sidebar-foot button')?.click()`
  )
  await sleep(220)
  if (await viewCrashed()) return fail('settings view crashed')
  await win.webContents.executeJavaScript(
    `document.querySelector('.sidebar-actions button')?.click()`
  )
  await sleep(300)
  if (await viewCrashed()) return fail('create view crashed')
  // Return to a server view (settings/create have no tab bar), then open a file
  // to verify the CodeMirror editor mounts.
  await win.webContents.executeJavaScript(`document.querySelector('.server-item')?.click()`)
  await sleep(300)
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.tab')].find(b=>/File|Dosya/.test(b.textContent))?.click()`
  )
  await sleep(400)
  await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.tree-row')].find(r=>/scrolltest/.test(r.textContent))?.click()`
  )
  await sleep(900)
  const diag = await win.webContents.executeJavaScript(`JSON.stringify({
    rows: document.querySelectorAll('.tree-row').length,
    names: [...document.querySelectorAll('.tree-name')].map(n=>n.textContent),
    tabs: document.querySelectorAll('.editor-tab').length,
    cm: !!document.querySelector('.cm-editor'),
    crashed: !!document.querySelector('.center-fill h3')
  })`)
  const cmOk = await win.webContents.executeJavaScript(`!!document.querySelector('.cm-editor')`)
  if (!cmOk) return fail('CodeMirror editor did not mount; diag=' + diag)

  // Prove the editor actually scrolls (scroller must overflow AND respond).
  const scrollInfo = await win.webContents.executeJavaScript(`(()=>{
    const s=document.querySelector('.cm-scroller'); if(!s) return JSON.stringify({no:1});
    const before=s.scrollTop; s.scrollTop=250; const after=s.scrollTop;
    return JSON.stringify({sh:s.scrollHeight,ch:s.clientHeight,before:before,after:after,ov:getComputedStyle(s).overflowY});
  })()`)
  const si = JSON.parse(scrollInfo)
  if (si.no) return fail('no .cm-scroller found')
  if (!(si.sh > si.ch + 20)) return fail('editor does not overflow (no scroll): ' + scrollInfo)
  if (si.after <= si.before) return fail('editor scroller did not scroll: ' + scrollInfo)
  sf.deleteEntry(id, 'scrolltest.txt')
  console.log(`SMOKE: editor scrolls OK (scrollHeight=${si.sh} clientHeight=${si.ch} scrollTop=${si.after})`)

  // --- 2. start ---
  let statsSeen = false
  const t0Events = Date.now() // everything after this is from this run
  processManager.on('stats', () => (statsSeen = true))
  console.log('SMOKE: starting server', id)
  await processManager.start(id).catch((e) => console.log('SMOKE: start threw', String(e)))
  const up = await waitFor(() => processManager.getStatus(id).status === 'running', 20000)
  if (!up) return fail('server never reached running; status=' + processManager.getStatus(id).status)
  console.log('SMOKE: running, pid=', processManager.getStatus(id).pid)

  // --- 2b. properties + files + stats ---
  const props = sf.readProperties(id)
  if (!props.entries.find((e) => e.key === 'motd')) return fail('props: motd not found')
  sf.writeProperties(id, { 'max-players': '42' })
  if (sf.readProperties(id).entries.find((e) => e.key === 'max-players')?.value !== '42') {
    return fail('props: write did not persist')
  }
  const dir = sf.listDir(id, '')
  if (!dir.find((e) => e.name === 'server.jar')) return fail('files: server.jar not listed')
  sf.writeTextFile(id, 'msms-test.txt', 'hello-msms')
  if (sf.readTextFile(id, 'msms-test.txt').content !== 'hello-msms') return fail('files: rw mismatch')
  sf.deleteEntry(id, 'msms-test.txt')
  console.log('SMOKE: props/files OK')

  await waitFor(() => statsSeen, 8000)
  if (!statsSeen) return fail('no stats event received')
  console.log('SMOKE: stats OK')

  // --- 2c. RCON auto-enable + player JSON merge ---
  const pm = Object.fromEntries(sf.readProperties(id).entries.map((e) => [e.key, e.value]))
  if (pm['enable-rcon'] !== 'true') return fail('rcon not auto-enabled in properties')
  if (!pm['rcon.password']) return fail('rcon password not generated')
  const uuid = '11111111-1111-1111-1111-111111111111'
  sf.writeTextFile(id, 'usercache.json', JSON.stringify([{ name: 'Steve', uuid }]))
  sf.writeTextFile(id, 'ops.json', JSON.stringify([{ uuid, name: 'Steve', level: 4 }]))
  const plist = await playersMod.getPlayers(id)
  const steve = plist.find((p) => p.name === 'Steve')
  sf.deleteEntry(id, 'usercache.json')
  sf.deleteEntry(id, 'ops.json')
  if (!steve || !steve.op) return fail('players: op merge failed')
  console.log('SMOKE: rcon-enable + players merge OK')

  // --- 2d. inventory NBT parse (write a real playerdata .dat) ---
  const spath = getConfig().servers.find((s) => s.id === id)?.path ?? ''
  const invUuid = '22222222-2222-2222-2222-222222222222'
  const pdDir = join(spath, 'world', 'playerdata')
  mkdirSync(pdDir, { recursive: true })
  const datBuf = nbt.writeUncompressed(
    {
      type: 'compound',
      name: '',
      value: {
        Health: { type: 'float', value: 20 },
        Inventory: {
          type: 'list',
          value: {
            type: 'compound',
            value: [
              {
                Slot: { type: 'byte', value: 0 },
                id: { type: 'string', value: 'minecraft:diamond_sword' },
                Count: { type: 'byte', value: 1 }
              }
            ]
          }
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    'big'
  )
  writeFileSync(join(pdDir, invUuid + '.dat'), datBuf)
  sf.writeTextFile(id, 'usercache.json', JSON.stringify([{ name: 'InvTester', uuid: invUuid }]))
  const players2 = await playersMod.getPlayers(id)
  const invp = players2.find((p) => p.name === 'InvTester')
  sf.deleteEntry(id, 'usercache.json')
  try {
    rmSync(join(spath, 'world'), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  if (!invp?.inventory?.some((it) => it.id === 'diamond_sword')) {
    return fail('inventory NBT not parsed')
  }
  console.log('SMOKE: inventory NBT parse OK')

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

  // The lifecycle we just drove must be on the timeline, exactly once.
  {
    const page = eventsMod.query(id, { from: t0Events, to: Date.now(), limit: 500 })
    const types = page.events.map((e) => e.type)
    for (const want of ['server.starting', 'server.ready', 'server.stopped'] as const) {
      if (!types.includes(want)) return fail(`timeline is missing ${want}; got ${types.join(',')}`)
    }
    const terminal = types.filter((x) =>
      ['server.stopped', 'server.crashed', 'server.error'].includes(x)
    )
    if (terminal.length !== 1) return fail('expected one terminal event, got ' + terminal.join(','))
    const stopped = page.events.find((e) => e.type === 'server.stopped')
    if (typeof stopped?.data?.uptimeMs !== 'number') return fail('stop event has no uptime')
    console.log('SMOKE: timeline recorded the run ->', types.reverse().join(' -> '))

    // ...and the Timeline view must actually render them, translated.
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.tab')].find(t=>/Timeline|Zaman/i.test(t.textContent||''))?.click()`
    )
    await sleep(600)
    const tl = JSON.parse(
      await win.webContents.executeJavaScript(
        `(()=>{const rows=[...document.querySelectorAll('.tl-row')];
         return JSON.stringify({rows:rows.length,
           first:(rows[0]?.querySelector('.tl-text')?.textContent||''),
           sev:[...new Set(rows.map(r=>r.className.replace('tl-row ','')))]})})()`
      )
    ) as { rows: number; first: string; sev: string[] }
    if (tl.rows < 3) return fail('timeline view rendered ' + tl.rows + ' rows')
    if (!tl.first || /^events\./.test(tl.first) || /\{\{/.test(tl.first)) {
      return fail('timeline text not translated: ' + tl.first)
    }
    console.log(`SMOKE: timeline view OK (${tl.rows} rows, "${tl.first}", ${tl.sev.join('/')})`)
  }

  // --- 5. mods / backups / scheduler / crash (server now stopped) ---
  const ml = modsMod.listMods(id)
  console.log('SMOKE: mods listed =', ml.length)

  const bk = await backupsMod.createBackup(id, { kind: 'full' })
  if (!backupsMod.listBackups(id).find((b) => b.id === bk.id)) return fail('backup not listed')
  backupsMod.deleteBackup(bk.id)
  if (backupsMod.listBackups(id).find((b) => b.id === bk.id)) return fail('backup not deleted')
  console.log('SMOKE: backup create/list/delete OK')

  const task = schedulerMod.createTask({
    serverId: id,
    name: 'smoke',
    cron: '0 4 * * *',
    action: 'backup'
  })
  if (!task.nextRun) return fail('schedule nextRun not computed')
  if (!schedulerMod.listTasks().find((tk) => tk.id === task.id)) return fail('schedule not created')
  schedulerMod.deleteTask(task.id)
  console.log('SMOKE: scheduler create/next/delete OK')

  const cr = analyzeCrash(id)
  console.log(`SMOKE: crash analyze source=${cr.source} findings=${cr.findings.length}`)

  pass()
}

/**
 * Wizard / version-provider smoke test against the live APIs:
 *  - every provider lists versions
 *  - a real (tiny) Fabric server is created, verified, then removed.
 */
export async function runWizardSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('WIZARD-SMOKE: FAIL -', m)
    app.exit(1)
  }

  // 1. Every creatable provider returns versions.
  for (const type of CREATABLE_TYPES) {
    try {
      const vs = await getProvider(type).listVersions(true)
      if (vs.length === 0) return fail(`${type}: 0 versions`)
      console.log(`WIZARD-SMOKE: ${type} -> ${vs.length} versions (latest ${vs[0].id})`)
    } catch (e) {
      return fail(`${type} listVersions threw: ${String(e)}`)
    }
  }

  // 2. Create a real Fabric server (tiny launcher jar).
  try {
    const games = await getProvider('fabric').listVersions(false)
    const mc = games[0].id
    console.log('WIZARD-SMOKE: creating Fabric server for', mc)
    const server = await createServer(
      {
        name: 'FabricSmoke',
        folderName: 'FabricSmoke',
        type: 'fabric',
        mcVersion: mc,
        memoryMB: 1024,
        preset: 'basic',
        acceptEula: true,
        onlineMode: false,
        port: 25599
      },
      (p) => console.log('WIZARD-SMOKE: progress', p.stage, p.percent ?? '')
    )
    const jarOk = existsSync(join(server.path, 'fabric-server-launch.jar'))
    const eulaOk = existsSync(join(server.path, 'eula.txt'))
    const propsOk = existsSync(join(server.path, 'server.properties'))
    const registered = getConfig().servers.some((s) => s.id === server.id)
    console.log(
      `WIZARD-SMOKE: jar=${jarOk} eula=${eulaOk} props=${propsOk} registered=${registered}`
    )
    // cleanup
    removeServer(server.id, true)
    if (!jarOk || !eulaOk || !propsOk || !registered) return fail('created server missing files')
  } catch (e) {
    return fail('fabric create threw: ' + String(e))
  }

  console.log('WIZARD-SMOKE: PASS')
  app.exit(0)
}

/**
 * REAL end-to-end test against an actual Paper server: create -> start ->
 * RCON connect -> list/tps parse -> players -> graceful stop. This exercises
 * the RCON / TPS / NBT / graceful-stop paths the mock structurally cannot.
 */
export async function runRealSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('REAL-SMOKE: FAIL -', m)
    app.exit(1)
  }
  const mc = process.env['MSMS_REAL_MC'] || '1.21.4'
  let serverId = ''
  try {
    console.log('REAL-SMOKE: creating Paper', mc)
    const server = await createServer(
      {
        name: 'RealPaper',
        folderName: 'RealPaper',
        type: 'paper',
        mcVersion: mc,
        memoryMB: 2048,
        preset: 'basic',
        acceptEula: true,
        onlineMode: false,
        port: 25599
      },
      (p) => console.log('REAL-SMOKE: progress', p.stage, p.percent ?? '')
    )
    serverId = server.id

    console.log('REAL-SMOKE: starting (world gen can take a while)…')
    await processManager.start(server.id)
    const up = await waitFor(() => processManager.getStatus(server.id).status === 'running', 150000)
    if (!up) return fail('paper never reached running; status=' + processManager.getStatus(server.id).status)
    console.log('REAL-SMOKE: running')

    const rconOk = await waitFor(() => rcon.isConnected(server.id), 30000)
    if (!rconOk) return fail('rcon did not connect to real server')
    console.log('REAL-SMOKE: rcon connected')

    const list = await rcon.listPlayers(server.id)
    console.log(`REAL-SMOKE: list parsed online=${list.online} max=${list.max}`)
    if (list.max <= 0) return fail('list parse failed (max=0)')

    await sleep(8000)
    const tps = rcon.getTps(server.id)
    console.log('REAL-SMOKE: tps parsed =', tps)
    if (tps == null || tps < 10) return fail('tps parse failed (got ' + tps + ', expected ~20)')

    const players = await playersMod.getPlayers(server.id)
    console.log('REAL-SMOKE: getPlayers count =', players.length)

    console.log('REAL-SMOKE: graceful stop…')
    await processManager.stop(server.id, { countdownSeconds: 2 })
    const down = await waitFor(
      () => ['stopped', 'crashed'].includes(processManager.getStatus(server.id).status),
      40000
    )
    if (!down) return fail('real server did not stop cleanly')
    console.log('REAL-SMOKE: stopped')
  } catch (e) {
    return fail('exception: ' + String(e))
  } finally {
    if (serverId) removeServer(serverId, true)
  }
  console.log('REAL-SMOKE: PASS')
  app.exit(0)
}

/**
 * Web-panel RBAC smoke: proves the DENIALS (401 no-token, 403 wrong-scope) and
 * a couple of allows, headlessly via fetch to 127.0.0.1.
 */
export async function runWebSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('WEB-SMOKE: FAIL -', m)
    app.exit(1)
  }
  webAuth.initAuth()
  for (const u of webAuth.listUsers()) {
    if (u.username === 'owner_t' || u.username === 'friend_t') webAuth.deleteUser(u.id)
  }
  const id = getConfig().servers[0]?.id
  if (!id) return fail('no server')
  const owner = webAuth.createUser('owner_t', 'ownerpass', 'owner', {})
  const friend = webAuth.createUser('friend_t', 'friendpass', 'user', { [id]: ['view', 'console'] })
  updateConfig((c) => {
    c.web = { enabled: true, port: 8799, bindLan: false, siteEnabled: true, sitePort: 8798 }
  })
  startWebServer()
  await sleep(500)

  const base = 'http://127.0.0.1:8799' // admin panel listener
  const siteBase = 'http://127.0.0.1:8798' // public website listener
  const post = (p: string, body: unknown, tok?: string): Promise<Response> =>
    fetch(base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      body: JSON.stringify(body)
    })
  const get = (p: string, tok?: string): Promise<Response> =>
    fetch(base + p, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} })
  // public website listener (separate port)
  const spost = (p: string, body: unknown, tok?: string): Promise<Response> =>
    fetch(siteBase + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
      body: JSON.stringify(body)
    })
  const sget = (p: string, tok?: string): Promise<Response> =>
    fetch(siteBase + p, { headers: tok ? { Authorization: 'Bearer ' + tok } : {} })

  try {
    let r = await post('/api/login', { username: 'owner_t', password: 'ownerpass' })
    if (r.status !== 200) return fail('owner login ' + r.status)
    const ot = ((await r.json()) as { token: string }).token

    r = await get('/api/servers')
    if (r.status !== 401) return fail('no-token expected 401, got ' + r.status)

    r = await get('/api/servers', ot)
    if (r.status !== 200) return fail('owner /servers ' + r.status)
    const servers = ((await r.json()) as { servers: { id: string }[] }).servers
    if (!servers.find((s) => s.id === id)) return fail('owner cannot see server')

    r = await post('/api/login', { username: 'friend_t', password: 'friendpass' })
    const ft = ((await r.json()) as { token: string }).token

    r = await post('/api/servers/' + id + '/power', { action: 'start' }, ft)
    if (r.status !== 403) return fail('friend power expected 403, got ' + r.status)

    r = await get('/api/servers/' + id + '/console', ft)
    if (r.status !== 200) return fail('friend console expected 200, got ' + r.status)

    r = await post('/api/login', { username: 'friend_t', password: 'wrongpw' })
    if (r.status !== 401) return fail('bad password expected 401, got ' + r.status)

    console.log('WEB-SMOKE: 401 (no token), 403 (wrong scope), 200 (allowed), 401 (bad pw) all correct')

    // ---- double-spend: two concurrent buys with balance for one -> exactly one wins ----
    webAuth.setUserMc(owner.id, 'Tester')
    economy.addBalance(id, 'Tester', 100)
    const prod = economy.upsertProduct(id, {
      id: '',
      type: 'item',
      name: 'TestItem',
      description: '',
      price: 100,
      commands: ['say {player} bought TestItem'],
      rewards: []
    } as Product)
    const buy = (): Promise<Response> =>
      post('/api/servers/' + id + '/store/buy', { productId: prod.id }, ot)
    const [r1, r2] = await Promise.all([buy(), buy()])
    const codes = [r1.status, r2.status].sort((a, b) => a - b)
    if (!(codes[0] === 200 && codes[1] === 402)) {
      return fail('double-spend expected [200,402], got [' + codes.join(',') + ']')
    }
    const finalBal = economy.getBalance(id, 'Tester')
    if (finalBal !== 0) return fail('double-spend balance should be 0, got ' + finalBal)
    economy.deleteProduct(id, prod.id)
    console.log('WEB-SMOKE: double-spend prevented (one 200, one 402, balance 0)')

    // ---- currency management (grant / remove / set) + audit ledger ----
    const balUrl = '/api/servers/' + id + '/store/admin/balance'
    // a user WITHOUT the 'store' scope must be refused
    r = await post(balUrl, { mcName: 'Tester', amount: 999 }, ft)
    if (r.status !== 403) return fail('non-store user granting balance expected 403, got ' + r.status)

    r = await post(balUrl, { mcName: 'Tester', amount: 250, reason: 'test grant' }, ot)
    if (r.status !== 200) return fail('grant expected 200, got ' + r.status)
    r = await post(balUrl, { mcName: 'Tester', amount: -100, reason: 'test remove' }, ot)
    if (r.status !== 200) return fail('remove expected 200, got ' + r.status)
    r = await post(balUrl, { mcName: 'Tester', amount: 50, mode: 'set', reason: 'test set' }, ot)
    if (r.status !== 200) return fail('set expected 200, got ' + r.status)

    r = await get('/api/servers/' + id + '/store/admin/ledger', ot)
    const led = ((await r.json()) as { ledger: { by: string; kind: string }[] }).ledger
    for (const kind of ['grant', 'remove', 'set', 'purchase']) {
      if (!led.some((e) => e.kind === kind)) return fail('ledger missing a "' + kind + '" entry')
    }
    if (!led.some((e) => e.kind === 'grant' && e.by === 'owner_t')) {
      return fail('ledger did not record the acting admin')
    }
    const finalBalance = economy.getBalance(id, 'Tester')
    if (finalBalance !== 50) return fail('balance after set should be 50, got ' + finalBalance)
    console.log('WEB-SMOKE: currency grant/remove/set + ledger OK (admin attributed, 403 for non-store)')

    // ---- public site (SITE listener) + separation + traversal ----
    r = await sget('/api/public/site')
    if (r.status !== 200) return fail('site /api/public/site expected 200, got ' + r.status)

    // the two listeners must be isolated: admin API must NOT exist on the site port
    r = await sget('/api/servers', ot)
    if (r.status !== 404) return fail('admin API must not exist on the site port, got ' + r.status)
    // ...and the public API must not exist on the panel port. Use a valid admin
    // token so we get past the auth gate — a 404 then proves no such route.
    r = await get('/api/public/site', ot)
    if (r.status !== 404) return fail('public API must not exist on the panel port, got ' + r.status)
    // unauthenticated it must not leak either
    r = await get('/api/public/site')
    if (r.status === 200) return fail('public API leaked on the panel port')

    r = await spost('/api/public/register/start', { mcName: 'Offliney' })
    if (r.status === 200) return fail('register-start should fail when the server is offline')

    r = await spost('/api/public/register/verify', { mcName: 'Offliney', code: '000000', password: 'pw12' })
    if (r.status === 200) return fail('verify with a wrong/absent code should fail')

    // an ADMIN token must NOT satisfy player auth
    r = await spost('/api/public/store/buy', { productId: 'x' }, ot)
    if (r.status !== 401) return fail('admin token on player route expected 401, got ' + r.status)

    // a PLAYER token must NOT satisfy admin auth (the dangerous direction)
    webPlayerAuth._testCreateAccount('PlayerT', 'playerpass')
    r = await spost('/api/public/login', { mcName: 'PlayerT', password: 'playerpass' })
    const pt = ((await r.json()) as { token: string }).token
    r = await post('/api/servers/' + id + '/power', { action: 'start' }, pt)
    if (r.status !== 401) return fail('player token on admin route expected 401, got ' + r.status)

    // uploads path-traversal sandbox (site listener)
    r = await sget('/uploads/..%2F..%2Fconfig.json')
    if (r.status !== 404) return fail('uploads traversal expected 404, got ' + r.status)

    console.log(
      'WEB-SMOKE: listener isolation + public routes + player/admin separation + traversal all correct'
    )

    // ---- site: custom language (A5) ----
    siteMod.addLanguage('de', 'en')
    siteMod.setLangString('de', 'nav.home', 'Startseite')
    let sres = await sget('/api/public/site')
    let sjson = (await sres.json()) as { i18n: { langs: Record<string, Record<string, string>> } }
    if (!sjson.i18n.langs.de) return fail('custom language not exposed on the site')
    if (sjson.i18n.langs.de['nav.home'] !== 'Startseite') return fail('custom language string not saved')
    if (!sjson.i18n.langs.en || !sjson.i18n.langs.tr) return fail('built-in languages missing')
    siteMod.removeLanguage('de')
    console.log('WEB-SMOKE: site i18n OK (en+tr built in, custom lang add/edit/remove)')

    // ---- site: visitors get their BROWSER language, English when unsupported ----
    // Same function the page runs (it is inlined into the site via .toString()).
    const av = ['en', 'tr', 'de']
    const langCases: [string, string][] = [
      [pickSiteLang(av, null, ['tr-TR', 'en-US']), 'tr'], // regional -> base subtag
      [pickSiteLang(av, null, ['de']), 'de'], // custom language added by the owner
      [pickSiteLang(av, null, ['fr-FR', 'es']), 'en'], // unsupported -> English
      [pickSiteLang(av, null, []), 'en'], // no browser hint at all
      [pickSiteLang(av, 'tr', ['en-US']), 'tr'], // explicit choice beats the browser
      [pickSiteLang(av, 'de', ['tr']), 'de'],
      [pickSiteLang(['en', 'tr'], 'de', ['fr']), 'en'], // stale choice (lang removed)
      [pickSiteLang(av, null, ['TR_tr']), 'tr'], // odd casing/separator
      [pickSiteLang(av, null, ['fr'], 'tr'), 'tr'] // owner-set fallback wins over en
    ]
    for (let i = 0; i < langCases.length; i++) {
      const [got, want] = langCases[i]
      if (got !== want) return fail(`lang case ${i}: expected ${want}, got ${got}`)
    }
    // and the page must actually ship that logic
    const siteHtml = await (await sget('/')).text()
    if (!siteHtml.includes('navigator.languages')) return fail('site html does not read navigator.languages')
    console.log('WEB-SMOKE: site language auto-detect OK (browser lang, en fallback, saved choice wins)')

    // ---- timeline over HTTP (Stage 2): scope-gated ----
    {
      // Keep the server's real timeline out of it.
      const efile = eventsMod.eventFile(id)
      const esnap = existsSync(efile) ? readFileSync(efile, 'utf-8') : null
      rmSync(efile, { force: true })
      try {
        const enow = Date.now()
        eventsMod.record(id, 'server.ready', { ts: enow - 2000, data: { startupMs: 1234 } })
        eventsMod.record(id, 'player.join', { ts: enow - 1000, data: { player: 'Ada', online: 1 } })
        r = await get(`/api/servers/${id}/events?from=${enow - 3600_000}&to=${enow}`, ft)
        if (r.status !== 200) return fail('events with view expected 200, got ' + r.status)
        const page = (await r.json()) as { events: { type: string }[]; total: number }
        if (page.total !== 2) return fail('events endpoint returned total ' + page.total)
        if (page.events[0].type !== 'player.join') return fail('events not newest-first over HTTP')
        r = await get(`/api/servers/${id}/events?from=${enow - 3600_000}&to=${enow}&types=player.join`, ft)
        const filtered = (await r.json()) as { events: { type: string }[] }
        if (filtered.events.length !== 1 || filtered.events[0].type !== 'player.join') {
          return fail('events type filter ignored over HTTP')
        }
        r = await get(`/api/servers/${id}/events`)
        if (r.status !== 401) return fail('events without token expected 401, got ' + r.status)
        r = await sget(`/api/servers/${id}/events`, ot)
        if (r.status !== 404) return fail('events leaked onto the site listener: ' + r.status)
        console.log('WEB-SMOKE: timeline endpoint OK (view-gated, ordering, filters, 401/404)')
      } finally {
        if (esnap == null) rmSync(efile, { force: true })
        else writeFileSync(efile, esnap, 'utf-8')
      }
    }

    // ---- site logo: setting AND clearing it must both stick ----
    {
      const original = { ...siteMod.getSiteConfig().theme }
      siteMod.setSiteConfig({ theme: { ...original, logo: 'smoke-logo.png' } })
      if (siteMod.getSiteConfig().theme.logo !== 'smoke-logo.png') return fail('logo not saved')
      // '' is how the UI asks for removal (undefined does not survive IPC)
      siteMod.setSiteConfig({ theme: { ...siteMod.getSiteConfig().theme, logo: '' } })
      if (siteMod.getSiteConfig().theme.logo) return fail('cleared logo came back')
      sres = await sget('/api/public/site')
      if (((await sres.json()) as { theme: { logo?: string } }).theme.logo) {
        return fail('cleared logo still served to the site')
      }
      siteMod.setSiteConfig({ theme: original })
      console.log('WEB-SMOKE: site logo set + clear both persist')
    }

    // ---- telemetry over HTTP (Stage 1): scope-gated, real rows ----
    // Snapshot the server's real history so the synthetic rows never survive.
    const mdir = metrics.metricsDirFor(id)
    const snapshot = new Map<string, string | null>()
    for (const mres of metrics.RESOLUTIONS) {
      const f = join(mdir, `${mres}.csv`)
      snapshot.set(f, existsSync(f) ? readFileSync(f, 'utf-8') : null)
      rmSync(f, { force: true }) // start clean so the assertions below are exact
    }
    try {
      const mnow = Date.now()
      metrics._resetBuffers()
      for (let i = 0; i < 60; i++) {
        metrics.record(id, { tps: 19.5, cpu: 12, rssMB: 1500, players: 2 }, mnow - (60 - i) * 2000)
      }
      metrics.flushServer(id)

      const range = `from=${mnow - 3600_000}&to=${mnow}`
      r = await get(`/api/servers/${id}/metrics?${range}`, ft) // friend has 'view'
      if (r.status !== 200) return fail('metrics with view expected 200, got ' + r.status)
      const series = (await r.json()) as {
        resolution: string
        points: { ts: number; cpu: number }[]
        summary: { cpuAvg: number; samples: number }
      }
      if (series.resolution !== '10s') return fail('metrics resolution ' + series.resolution)
      if (series.points.length < 10) return fail('metrics returned ' + series.points.length + ' rows')
      if (series.summary.cpuAvg !== 12) return fail('metrics cpuAvg ' + series.summary.cpuAvg)
      r = await get(`/api/servers/${id}/metrics?${range}&res=1h`, ft)
      if (((await r.json()) as { resolution: string }).resolution !== '1h') {
        return fail('explicit resolution ignored')
      }
      // a user with no scopes on this server must be refused
      const nosee = webAuth.createUser('nosee_t', 'noseepass', 'user', {})
      r = await post('/api/login', { username: 'nosee_t', password: 'noseepass' })
      const nt = ((await r.json()) as { token: string }).token
      r = await get(`/api/servers/${id}/metrics?${range}`, nt)
      if (r.status !== 403) return fail('metrics without view expected 403, got ' + r.status)
      r = await get(`/api/servers/${id}/metrics?${range}`)
      if (r.status !== 401) return fail('metrics without token expected 401, got ' + r.status)
      // and it must not exist on the public website listener
      r = await sget(`/api/servers/${id}/metrics?${range}`, ot)
      if (r.status !== 404) return fail('metrics leaked onto the site listener: ' + r.status)
      webAuth.deleteUser(nosee.id)
      console.log('WEB-SMOKE: metrics endpoint OK (view-gated, 401/403/404, resolutions honoured)')
    } finally {
      metrics._resetBuffers()
      for (const [f, content] of snapshot) {
        if (content == null) rmSync(f, { force: true })
        else writeFileSync(f, content, 'utf-8')
      }
    }

    // ---- site: publishing news FROM THE PANEL with author attribution (A6) ----
    // a user without 'settings' on the store server must be refused
    r = await post('/api/site/posts', { title: 'nope', body: 'x' }, ft)
    if (r.status !== 403) return fail('unprivileged panel post expected 403, got ' + r.status)

    r = await post('/api/site/posts', { title: 'From panel', body: 'Posted via the web panel.' }, ot)
    if (r.status !== 200) return fail('panel post expected 200, got ' + r.status)
    const created = (await r.json()) as { id: string; author?: string; at: number }
    if (created.author !== 'owner_t') return fail('post author not taken from session, got ' + created.author)
    // it must be visible publicly
    sres = await sget('/api/public/site')
    const pubPosts = ((await sres.json()) as { posts: { id: string; author?: string }[] }).posts
    if (!pubPosts.some((p) => p.id === created.id && p.author === 'owner_t')) {
      return fail('panel-created post not published to the site')
    }
    await post('/api/site/posts/delete', { id: created.id }, ot)
    console.log('WEB-SMOKE: panel news publishing OK (author attributed, 403 for unprivileged)')
  } catch (e) {
    return fail('exception: ' + String(e))
  } finally {
    webAuth.deleteUser(owner.id)
    webAuth.deleteUser(friend.id)
    stopWebServer()
    updateConfig((c) => {
      c.web = { enabled: false, port: 8722, bindLan: false, siteEnabled: false, sitePort: 8723 }
    })
  }
  console.log('WEB-SMOKE: PASS')
  app.exit(0)
}
