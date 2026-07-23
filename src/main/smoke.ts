import { app, BrowserWindow } from 'electron'
import { existsSync, writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
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
import * as alertsMod from './core/alerts'
import * as worldsMod from './core/worlds'
import { listJavaInstalls, _resetJavaCache } from './core/javaScan'
import { checkJava, javaRequirement } from '@shared/javaCompat'
import { computeUptime, clipSessions } from '@shared/uptime'
import { evaluateRule, normalizeRule, IDLE, type AlertRule, type AlertSample } from '@shared/alerts'
import { analyze, type Finding } from '@shared/analysis'
import type { UptimeReport } from '@shared/uptime'
import type { JavaArgsConfig, MetricSeries, ServerConfig, ServerEvent } from '@shared/types'
import { alertsPath, uploadsDir } from './paths'
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

    // --- an old abnormal run is still bounded once 10s rows have expired ---
    {
      const CLIP = 'smoke-events-clip'
      const H = 3600_000
      const oldFrom = Date.now() - 10 * 86400_000 // past the 24h raw retention
      metrics._resetBuffers()
      // only 1m/1h rows survive that far back, so seed at that spacing
      for (let i = 0; i < 20; i++) {
        metrics.record(CLIP, { tps: 20, cpu: 5, rssMB: 900, players: 0 }, oldFrom + i * 60_000)
      }
      metrics.flushServer(CLIP)
      eventsMod.record(CLIP, 'server.ready', { ts: oldFrom })
      eventsMod.record(CLIP, 'server.starting', { ts: oldFrom + 8 * H })
      const rep = eventsMod.uptime(CLIP, oldFrom - H, oldFrom + 9 * H, oldFrom + 9 * H)
      // ~20 minutes of samples, not the 8 hours up to the relaunch
      if (rep.upMs > 40 * 60_000) return fail('old orphan run was not clipped: ' + rep.upMs)
      if (rep.upMs < 15 * 60_000) return fail('old orphan run over-clipped: ' + rep.upMs)
      metrics.dropServer(CLIP)
      eventsMod.dropServer(CLIP)
      console.log('EVENTS-SMOKE: old abnormal run bounded by 1m/1h metrics, not by the next launch')
    }

    // --- uptime pairing: the four cases that make this hard ---
    {
      const H = 3600_000
      const T = 1_700_000_000_000 // fixed base, no clock dependency
      let seq = 0
      const ev = (type: ServerEvent['type'], ts: number): ServerEvent => ({
        id: 'u' + seq++,
        serverId: 'u',
        ts,
        type,
        severity: 'info'
      })
      const near = (a: number, b: number): boolean => Math.abs(a - b) < 1000

      // plain run inside the window
      let r = computeUptime(
        [ev('server.starting', T), ev('server.ready', T + 60_000), ev('server.stopped', T + H)],
        T - H,
        T + 2 * H,
        T + 2 * H
      )
      if (!near(r.upMs, H - 60_000)) return fail('plain session uptime ' + r.upMs)
      if (r.windowFrom !== T) return fail('window should start when the server was first seen')
      if (r.crashes !== 0 || r.starts !== 1) return fail('plain session counters')

      // crashed before it ever became ready -> no uptime, but a crash
      r = computeUptime([ev('server.starting', T), ev('server.crashed', T + 5000)], T, T + H, T + H)
      if (r.upMs !== 0) return fail('failed start counted as uptime: ' + r.upMs)
      if (r.crashes !== 1 || r.starts !== 0) return fail('failed start counters')

      // still running: counted up to "now", flagged as up
      r = computeUptime([ev('server.ready', T)], T, T + 2 * H, T + H)
      if (!near(r.upMs, H)) return fail('open session uptime ' + r.upMs)
      if (!r.currentlyUp) return fail('open session not marked running')

      // started before the window, stopped inside it -> clipped at the start
      r = computeUptime([ev('server.ready', T - 5 * H), ev('server.stopped', T + H)], T, T + 2 * H, T + 2 * H)
      if (!near(r.upMs, H)) return fail('session straddling the start: ' + r.upMs)

      // started inside, ended after the window -> clipped at the end
      r = computeUptime([ev('server.ready', T + H), ev('server.stopped', T + 9 * H)], T, T + 2 * H, T + 2 * H)
      if (!near(r.upMs, H)) return fail('session straddling the end: ' + r.upMs)

      // MSMS closed mid-run: the next launch implicitly ends the open session
      r = computeUptime(
        [ev('server.ready', T), ev('server.starting', T + H), ev('server.ready', T + H + 60_000)],
        T,
        T + 2 * H,
        T + 2 * H
      )
      if (!near(r.upMs, 2 * H - 60_000)) return fail('reopened session uptime ' + r.upMs)
      if (r.sessions.length !== 2) return fail('expected two sessions, got ' + r.sessions.length)

      // ...and that upper bound gets tightened by the metrics we did record:
      // the machine died 10 minutes in, MSMS only relaunched 5 hours later.
      const orphan = computeUptime(
        [ev('server.ready', T), ev('server.starting', T + 5 * H), ev('server.ready', T + 5 * H + 1000)],
        T,
        T + 6 * H,
        T + 6 * H
      )
      if (!near(orphan.upMs, 6 * H - 1000)) return fail('unclipped orphan should span to relaunch')
      if (orphan.sessions[0].endedBy !== 'start') return fail('orphan session not marked')
      const clipped = clipSessions(orphan, (s) => (s.endedBy === 'start' ? s.from + 10 * 60_000 : null))
      if (clipped.upMs !== 10 * 60_000 + H - 1000) return fail('clipped uptime ' + clipped.upMs)
      if (clipped.ratio == null || clipped.ratio > 0.2) return fail('clipped ratio ' + clipped.ratio)

      // nothing recorded at all -> no ratio rather than a fake 0%
      if (computeUptime([], T, T + H, T + H).ratio !== null) return fail('empty history should have no ratio')

      // a fully up window is 100%, not more
      r = computeUptime([ev('server.ready', T - H), ev('server.stopped', T + 3 * H)], T, T + 2 * H, T + 2 * H)
      if (r.ratio == null || Math.abs(r.ratio - 1) > 0.001) return fail('full window ratio ' + r.ratio)
      console.log('EVENTS-SMOKE: uptime pairing OK (clipping, open runs, failed starts, reopen, empty)')
    }

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
 * Java compatibility + install scan verification (Stage 9).
 *
 * The table is the deliverable, so it is pinned version by version - a wrong
 * cell here tells someone their working setup is broken, or stays silent
 * while their server refuses to start.
 */
export async function runJavaSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('JAVA-SMOKE: FAIL -', m)
    app.exit(1)
  }
  try {
    // --- 1. the requirement table -----------------------------------------
    const cases: Array<[string, number, number | undefined]> = [
      // [mc version, expected min java, expected ceiling]
      ['1.8.9', 8, 11],
      ['1.12.2', 8, 11],
      ['1.16.5', 8, 11],
      ['1.17', 16, undefined],
      ['1.17.1', 16, undefined],
      ['1.18', 17, undefined],
      ['1.19.4', 17, undefined],
      ['1.20', 17, undefined],
      ['1.20.4', 17, undefined],
      ['1.20.5', 21, undefined], // the cutover
      ['1.20.6', 21, undefined],
      ['1.21', 21, undefined],
      ['1.21.4', 21, undefined]
    ]
    for (const [mc, min, ceiling] of cases) {
      const req = javaRequirement(mc)
      if (!req.known) return fail(`${mc}: not recognised`)
      if (req.min !== min) return fail(`${mc}: min java ${req.min}, expected ${min}`)
      if (req.maxKnownGood !== ceiling) {
        return fail(`${mc}: ceiling ${req.maxKnownGood}, expected ${ceiling}`)
      }
    }

    // --- 2. verdicts, including the two failure directions ----------------
    const v = (mc: string, java: number): string => checkJava(mc, java).verdict
    if (v('1.21', 17) !== 'too-old') return fail('1.21 on Java 17 should be too-old')
    if (v('1.21', 21) !== 'ok') return fail('1.21 on Java 21 should be ok')
    if (v('1.21', 22) !== 'ok') return fail('1.21 on Java 22 should be ok')
    if (v('1.20.4', 17) !== 'ok') return fail('1.20.4 on Java 17 should be ok')
    if (v('1.20.5', 17) !== 'too-old') return fail('1.20.5 on Java 17 should be too-old')
    if (v('1.12.2', 8) !== 'ok') return fail('1.12.2 on Java 8 should be ok')
    if (v('1.12.2', 11) !== 'ok') return fail('1.12.2 on Java 11 should be ok')
    if (v('1.12.2', 21) !== 'risky-new') return fail('1.12.2 on Java 21 should be risky-new')
    if (v('1.8.9', 7) !== 'too-old') return fail('1.8.9 on Java 7 should be too-old')

    // --- 3. silence when the version cannot be read -----------------------
    for (const odd of ['24w14a', '', 'latest', '1.20.4-pre1', '2.0']) {
      if (javaRequirement(odd).known) return fail(`"${odd}" should not be recognised`)
      if (v(odd, 21) !== 'unknown') return fail(`"${odd}" should give no verdict`)
    }
    if (v('1.21', 0) !== 'unknown') return fail('an unprobed java should give no verdict')
    console.log('JAVA-SMOKE: compatibility table OK (13 versions pinned, both failure directions, snapshots silent)')

    // --- 4. the scan finds the Java this machine actually has -------------
    _resetJavaCache()
    const installs = await listJavaInstalls(true)
    if (!installs.length) return fail('no Java found on a machine that just ran Java-based tests')
    for (const i of installs) {
      if (!i.major || i.major < 6) return fail('scan reported a bogus major: ' + JSON.stringify(i))
      if (!i.version) return fail('scan reported no version for ' + i.path)
      if (!['JAVA_HOME', 'PATH', 'installed'].includes(i.source)) return fail('bad source ' + i.source)
    }
    const paths = installs.map((i) => i.path.toLowerCase())
    if (new Set(paths).size !== paths.length) return fail('the scan listed the same path twice')
    for (let i = 1; i < installs.length; i++) {
      if (installs[i - 1].major < installs[i].major) return fail('installs are not newest-first')
    }
    // The cache must not re-scan, and must survive being asked twice.
    const again = await listJavaInstalls()
    if (again.length !== installs.length) return fail('the cached list disagreed with the scan')
    console.log(
      `JAVA-SMOKE: scan OK (${installs.length} install(s): ${installs.map((i) => `${i.major}/${i.source}`).join(', ')})`
    )

    console.log('JAVA-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
    fail('exception ' + String(e))
  }
}

/**
 * World manager verification (Stage 7).
 *
 * Runs against a throwaway folder in the OS temp directory, never a
 * registered server, because this is the first suite that deletes things. The
 * assertions that matter most are the refusals: a guard that only lives in a
 * confirm dialog is not a guard.
 */
export async function runWorldsSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('WORLDS-SMOKE: FAIL -', m)
    app.exit(1)
  }
  const SID = 'smoke-worlds-server'
  const root = join(app.getPath('temp'), 'msms-worlds-smoke')
  const cleanup = (): void => {
    try {
      rmSync(root, { recursive: true, force: true })
      eventsMod.dropServer(SID)
      updateConfig((c) => {
        c.servers = c.servers.filter((s) => s.id !== SID)
      })
    } catch {
      /* best effort */
    }
  }

  /** A level.dat real enough for prismarine-nbt to read back. */
  const levelDat = (seed: number, version: string, gameType: number, hardcore: boolean): Buffer =>
    gzipSync(
      nbt.writeUncompressed({
        type: 'compound',
        name: '',
        value: {
          Data: {
            type: 'compound',
            value: {
              RandomSeed: { type: 'long', value: [0, seed] },
              GameType: { type: 'int', value: gameType },
              hardcore: { type: 'byte', value: hardcore ? 1 : 0 },
              Version: { type: 'compound', value: { Name: { type: 'string', value: version } } }
            }
          }
        }
      } as nbt.NBT)
    )

  const makeWorld = (name: string, opts: { dat?: Buffer; bytes?: number; dims?: string[] } = {}): void => {
    const dir = join(root, name)
    mkdirSync(join(dir, 'region'), { recursive: true })
    writeFileSync(join(dir, 'level.dat'), opts.dat ?? levelDat(12345, '1.21.4', 0, false))
    writeFileSync(join(dir, 'region', 'r.0.0.mca'), Buffer.alloc(opts.bytes ?? 1024))
    for (const d of opts.dims ?? []) mkdirSync(join(dir, d), { recursive: true })
  }

  try {
    cleanup()
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'server.properties'), 'level-name=world\nmax-players=20\n', 'utf-8')

    // Paper layout: the nether and end are SIBLING folders with their own
    // level.dat. Treating each as a world is the bug this suite exists for.
    makeWorld('world', { bytes: 2048 })
    makeWorld('world_nether', { bytes: 1024 })
    makeWorld('world_the_end', { bytes: 512 })
    // Vanilla layout: dimensions live inside.
    makeWorld('backup_world', { bytes: 4096, dims: ['DIM-1'] })
    // A `_nether` whose overworld does not exist is a world in its own right;
    // hiding it would make it unreachable. Its level.dat is deliberately junk.
    makeWorld('orphan_nether', { dat: Buffer.from('not really nbt'), bytes: 128 })
    mkdirSync(join(root, 'plugins'), { recursive: true }) // no level.dat -> not a world

    updateConfig((c) => {
      c.servers = c.servers.filter((s) => s.id !== SID)
      c.servers.push({
        id: SID,
        name: 'Worlds smoke',
        path: root,
        type: 'paper',
        mcVersion: '1.21.4',
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        java: {
          javaPath: '',
          minMemoryMB: 1024,
          maxMemoryMB: 2048,
          preset: 'basic',
          customArgs: '',
          extraFlags: '',
          jarFile: 'server.jar',
          nogui: true
        },
        autoRestart: false,
        autoRestartOnCrash: false
      })
    })

    // --- 1. grouping -------------------------------------------------------
    const list = await worldsMod.listWorlds(SID)
    const names = list.map((w) => w.name).join(',')
    if (names !== 'world,backup_world,orphan_nether' && names !== 'world,orphan_nether,backup_world') {
      return fail('worlds listed as: ' + names + ' (expected 3, dimensions folded in)')
    }
    const main = list.find((w) => w.name === 'world')!
    if (!main.active) return fail('level-name=world did not mark it active')
    if (main.dimensions.join('+') !== 'overworld+nether+end') {
      return fail('sibling dimensions not detected: ' + main.dimensions.join('+'))
    }
    const vanilla = list.find((w) => w.name === 'backup_world')!
    if (vanilla.dimensions.join('+') !== 'overworld+nether') {
      return fail('DIM-1 not detected as the nether: ' + vanilla.dimensions.join('+'))
    }
    if (vanilla.active) return fail('a second world claims to be active')
    // Folders on disk are NOT the dimension count: the confirm dialog quotes
    // this number, and for a vanilla world two dimensions live in one folder.
    if (main.folders !== 3) return fail('paper world reports ' + main.folders + ' folders, expected 3')
    if (vanilla.folders !== 1) return fail('vanilla world reports ' + vanilla.folders + ' folders, expected 1')
    // Size must cover the companion folders, not just the base one.
    if (main.sizeBytes < 3584) return fail('world size ' + main.sizeBytes + ' excludes its dimensions')
    console.log(`WORLDS-SMOKE: grouping OK (3 worlds from 5 level.dat folders, ${main.dimensions.length} dims on the active one)`)

    // --- 2. level.dat is best effort, never fatal ---------------------------
    if (main.seed !== '12345') return fail('seed read as ' + main.seed)
    if (main.version !== '1.21.4') return fail('version read as ' + main.version)
    const junk = list.find((w) => w.name === 'orphan_nether')!
    if (junk.seed !== undefined) return fail('made up a seed for an unreadable level.dat')
    if (junk.sizeBytes <= 0) return fail('a world with a corrupt level.dat lost its size')
    console.log('WORLDS-SMOKE: level.dat parsed where possible, corrupt one degrades quietly')

    // --- 3. the refusals ----------------------------------------------------
    const refuses = async (what: string, fn: () => unknown, expected: string): Promise<boolean> => {
      try {
        await fn()
      } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        if (msg === expected) return true
        fail(`${what}: refused with "${msg}", expected "${expected}"`)
        return false
      }
      fail(`${what}: was ALLOWED`)
      return false
    }
    if (!(await refuses('deleting the active world', () => worldsMod.deleteWorld(SID, 'world'), 'world-is-active'))) return
    if (!(await refuses('a traversal name', () => worldsMod.deleteWorld(SID, '../..'), 'invalid-name'))) return
    if (!(await refuses('a separator in the name', () => worldsMod.activateWorld(SID, 'a/b'), 'invalid-name'))) return
    if (!(await refuses('a world that is not there', () => worldsMod.activateWorld(SID, 'nope'), 'world-not-found'))) return
    if (!(await refuses('a folder with no level.dat', () => worldsMod.activateWorld(SID, 'plugins'), 'world-not-found'))) return
    if (existsSync(join(root, 'world', 'level.dat')) === false) return fail('a refused delete still removed files')
    console.log('WORLDS-SMOKE: refusals OK (active, traversal, separator, missing, non-world)')

    // --- 4. activate --------------------------------------------------------
    worldsMod.activateWorld(SID, 'backup_world')
    const props = readFileSync(join(root, 'server.properties'), 'utf-8')
    if (!/^level-name=backup_world$/m.test(props)) return fail('level-name not written: ' + props)
    if (!/max-players=20/.test(props)) return fail('activating a world damaged server.properties')
    const after = await worldsMod.listWorlds(SID)
    if (!after.find((w) => w.name === 'backup_world')?.active) return fail('activation not reflected')
    if (after.find((w) => w.name === 'world')?.active) return fail('two worlds active at once')
    if (after[0].name !== 'backup_world') return fail('the active world is not listed first')
    console.log('WORLDS-SMOKE: activate rewrites level-name and nothing else')

    // --- 5. delete takes the whole world, and only that world ---------------
    makeWorld('deleteme', { bytes: 256 })
    makeWorld('deleteme_nether', { bytes: 256 })
    if ((await worldsMod.listWorlds(SID)).length !== 4) return fail('fixture for the delete test is wrong')
    worldsMod.deleteWorld(SID, 'deleteme')
    if (existsSync(join(root, 'deleteme'))) return fail('the world survived its own deletion')
    if (existsSync(join(root, 'deleteme_nether'))) return fail('the nether was orphaned by the delete')
    for (const keep of ['world', 'world_nether', 'world_the_end', 'backup_world', 'orphan_nether']) {
      if (!existsSync(join(root, keep))) return fail('delete took "' + keep + '" with it')
    }
    const evs = eventsMod.query(SID, { types: ['world.deleted', 'world.activated'] })
    if (evs.events.length !== 2) return fail('world changes not on the timeline (' + evs.events.length + ')')
    if (evs.events[0].type !== 'world.deleted' || evs.events[0].text !== 'deleteme') {
      return fail('delete event wrong: ' + JSON.stringify(evs.events[0]))
    }
    if (evs.events[0].data?.folders !== 2) return fail('delete event did not count both folders')
    console.log('WORLDS-SMOKE: delete removes the world and its dimensions, leaves the rest alone')

    // --- 6. rename carries the dimensions, and level-name follows -----------
    // `backup_world` is the active one at this point, and it is the vanilla
    // layout (DIM-1 inside), so this covers the active + inner-dimension case.
    worldsMod.renameWorld(SID, 'backup_world', 'renamed_world')
    if (existsSync(join(root, 'backup_world'))) return fail('the old folder survived the rename')
    if (!existsSync(join(root, 'renamed_world', 'DIM-1'))) return fail('rename lost the inner dimension')
    if (!/^level-name=renamed_world$/m.test(readFileSync(join(root, 'server.properties'), 'utf-8'))) {
      return fail('renaming the active world did not update level-name')
    }
    // Now the Paper layout, which is NOT active: all three folders must move.
    worldsMod.renameWorld(SID, 'world', 'paper_world')
    for (const suffix of ['', '_nether', '_the_end']) {
      if (!existsSync(join(root, 'paper_world' + suffix))) return fail('rename left behind ' + suffix)
      if (existsSync(join(root, 'world' + suffix))) return fail('rename did not move ' + suffix)
    }
    if (/^level-name=paper_world$/m.test(readFileSync(join(root, 'server.properties'), 'utf-8'))) {
      return fail('renaming an inactive world stole level-name')
    }
    const renamed = await worldsMod.listWorlds(SID)
    if (renamed.find((w) => w.name === 'paper_world')?.dimensions.length !== 3) {
      return fail('renamed paper world lost its dimensions')
    }
    console.log('WORLDS-SMOKE: rename moves every folder, level-name follows only the active world')

    // --- 7. clone leaves the original alone ---------------------------------
    await worldsMod.cloneWorld(SID, 'paper_world', 'copy')
    for (const suffix of ['', '_nether', '_the_end']) {
      if (!existsSync(join(root, 'copy' + suffix))) return fail('clone missed ' + suffix)
      if (!existsSync(join(root, 'paper_world' + suffix))) return fail('clone consumed the original')
    }
    if (!existsSync(join(root, 'copy', 'region', 'r.0.0.mca'))) return fail('clone did not copy contents')
    const cloned = (await worldsMod.listWorlds(SID)).find((w) => w.name === 'copy')
    if (cloned?.seed !== '12345') return fail('the copy did not carry its level.dat')
    if (cloned?.active) return fail('a copy came out active')
    console.log('WORLDS-SMOKE: clone copies the whole world and leaves the original intact')

    // --- 8. rename/clone refuse to land on top of anything ------------------
    if (!(await refuses('renaming onto an existing world', () => worldsMod.renameWorld(SID, 'copy', 'paper_world'), 'target-exists'))) return
    // The collision is only on a COMPANION folder - the base name is free.
    mkdirSync(join(root, 'lonely_nether'), { recursive: true })
    if (!(await refuses('a companion-only collision', () => worldsMod.cloneWorld(SID, 'copy', 'lonely'), 'target-exists'))) return
    rmSync(join(root, 'lonely_nether'), { recursive: true, force: true })
    if (!(await refuses('renaming to a traversal', () => worldsMod.renameWorld(SID, 'copy', '../evil'), 'invalid-name'))) return
    if (existsSync(join(root, 'copy'))) {
      /* still there, as it must be */
    } else {
      return fail('a refused rename moved the world anyway')
    }
    console.log('WORLDS-SMOKE: rename/clone refuse existing targets, companions included')

    // --- 9. reset one dimension, both layouts -------------------------------
    // The active world's nether: allowed on purpose - this is the everyday job.
    if (!existsSync(join(root, 'renamed_world', 'DIM-1'))) return fail('vanilla fixture lost its DIM-1')
    worldsMod.resetDimension(SID, 'renamed_world', 'nether')
    if (existsSync(join(root, 'renamed_world', 'DIM-1'))) return fail('inner nether not reset')
    if (!existsSync(join(root, 'renamed_world', 'level.dat'))) return fail('resetting took the overworld')
    const activeAfterReset = (await worldsMod.listWorlds(SID)).find((w) => w.name === 'renamed_world')
    if (!activeAfterReset?.active) return fail('reset disturbed which world is active')
    if (activeAfterReset.dimensions.join('+') !== 'overworld') return fail('nether still listed after reset')

    worldsMod.resetDimension(SID, 'paper_world', 'end')
    if (existsSync(join(root, 'paper_world_the_end'))) return fail('sibling end not reset')
    if (!existsSync(join(root, 'paper_world_nether'))) return fail('resetting the end took the nether')
    if (!existsSync(join(root, 'paper_world', 'level.dat'))) return fail('resetting the end took the overworld')

    if (!(await refuses('resetting the overworld', () => worldsMod.resetDimension(SID, 'copy', 'overworld'), 'cannot-reset-overworld'))) return
    if (!existsSync(join(root, 'copy', 'level.dat'))) return fail('a refused overworld reset still deleted it')
    if (!(await refuses('resetting a dimension that is not there', () => worldsMod.resetDimension(SID, 'renamed_world', 'end'), 'dimension-not-found'))) return
    console.log('WORLDS-SMOKE: reset clears one dimension in both layouts, allowed on the active world, never the overworld')

    const changes = eventsMod.query(SID, { types: ['world.renamed', 'world.cloned', 'world.reset'] })
    if (changes.events.length !== 5) return fail('world changes on the timeline: ' + changes.events.length)

    cleanup()
    console.log('WORLDS-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
    cleanup()
    fail('exception ' + String(e))
  }
}

/**
 * Performance analyzer verification (Stage 6).
 *
 * Replays four shaped histories through the real metric store and asserts the
 * exact finding codes. The healthy case is the important one: it carries a
 * short lag dip on purpose, because an analyzer that cannot stay quiet about
 * ordinary noise is worse than none.
 */
export async function runAnalysisSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('ANALYSIS-SMOKE: FAIL -', m)
    app.exit(1)
  }
  const SID = 'smoke-analysis-server'
  const wipe = (): void => rmSync(metrics.metricsDirFor(SID), { recursive: true, force: true })

  const java = (over: Partial<JavaArgsConfig> = {}): JavaArgsConfig => ({
    javaPath: '',
    minMemoryMB: 1024,
    maxMemoryMB: 8192,
    preset: 'aikars',
    customArgs: '',
    extraFlags: '',
    jarFile: 'server.jar',
    nogui: true,
    ...over
  })

  const report = (crashes: number): UptimeReport => ({
    windowFrom: 0,
    windowTo: 0,
    windowMs: 0,
    upMs: 0,
    downMs: 0,
    ratio: 1,
    sessions: [],
    starts: crashes,
    crashes,
    longestUpMs: 0,
    currentlyUp: true
  })

  /** Lay down 6 h of 30 s readings and read them back at 1-minute resolution. */
  const build = (t0: number, sample: (i: number) => metrics.MetricSample): MetricSeries => {
    wipe()
    metrics._resetBuffers()
    for (let i = 0; i < 720; i++) metrics.record(SID, sample(i), t0 + i * 30_000)
    metrics.flushServer(SID)
    return metrics.query(SID, { from: t0, to: t0 + 6 * 3600_000, resolution: '1m', limit: 5000 })
  }

  const codes = (f: Finding[]): string => f.map((x) => x.code).join(',')

  try {
    const saved = getConfig().telemetry
    updateConfig((c) => {
      c.telemetry = { enabled: true, rawHours: 24, minuteDays: 14, hourDays: 365 }
    })
    const HOUR = 3600_000
    const t0 = Math.floor(Date.now() / HOUR) * HOUR - 6 * HOUR
    const to = t0 + 6 * HOUR

    // --- 1. a server with real problems -----------------------------------
    // 40% of the time: 10 players, 12 TPS, 95% CPU. The rest: empty and fine.
    const busy = (i: number): boolean => i % 60 < 24
    const sick = build(t0, (i) => ({
      tps: busy(i) ? 12 : 20,
      cpu: busy(i) ? 95 : 20,
      rssMB: 1200,
      players: busy(i) ? 10 : 0
    }))
    if (sick.points.length !== 360) return fail('fixture built ' + sick.points.length + ' points, expected 360')
    const bad = analyze({
      series: sick,
      uptime: report(3),
      events: [],
      server: { type: 'paper', java: java({ preset: 'basic' }) },
      from: t0,
      to
    })
    const want = [
      'chronic-lag',
      'frequent-crashes',
      'lag-with-players',
      'cpu-saturated',
      'memory-over-allocated',
      'aikars-flags'
    ].join(',')
    if (codes(bad) !== want) return fail('sick server -> ' + codes(bad) + '\n  expected ' + want)
    const lag = bad[0]
    if (lag.severity !== 'error') return fail('40% laggy buckets should be an error, got ' + lag.severity)
    if (lag.data?.share !== 40) return fail('lag share computed as ' + lag.data?.share + '%, expected 40')
    const corr = bad.find((f) => f.code === 'lag-with-players')
    if (corr?.data?.busyTps !== 12 || corr?.data?.quietTps !== 20) {
      return fail('player correlation wrong: ' + JSON.stringify(corr?.data))
    }
    const mem = bad.find((f) => f.code === 'memory-over-allocated')
    if (mem?.data?.rssMax !== 1200 || mem?.data?.xmx !== 8192) {
      return fail('memory finding wrong: ' + JSON.stringify(mem?.data))
    }
    console.log('ANALYSIS-SMOKE: problem server OK (6 findings, error first, numbers exact)')

    // --- 2. a healthy server, including a dip that must NOT be called lag ---
    const ok = build(t0, (i) => ({
      tps: i % 60 < 3 ? 10 : 20, // 5% of buckets dip - under the 10% floor
      cpu: 25,
      rssMB: 6000,
      players: 3
    }))
    const good = analyze({
      series: ok,
      uptime: report(0),
      events: [],
      server: { type: 'paper', java: java() },
      from: t0,
      to
    })
    if (codes(good) !== 'healthy') return fail('healthy server -> ' + codes(good))
    console.log('ANALYSIS-SMOKE: healthy server stays quiet (a 5% dip is not chronic lag)')

    // --- 3. too little history to say anything ------------------------------
    wipe()
    metrics._resetBuffers()
    for (let i = 0; i < 30; i++) {
      metrics.record(SID, { tps: 5, cpu: 99, rssMB: 100, players: 0 }, t0 + i * 30_000)
    }
    metrics.flushServer(SID)
    const thin = analyze({
      series: metrics.query(SID, { from: t0, to, resolution: '1m', limit: 5000 }),
      uptime: report(0),
      events: [],
      server: { type: 'paper', java: java({ preset: 'basic' }) },
      from: t0,
      to
    })
    if (codes(thin) !== 'insufficient-data') return fail('thin history -> ' + codes(thin))
    console.log('ANALYSIS-SMOKE: refuses to diagnose from 30 readings')

    // --- 4. software that cannot report a tick rate --------------------------
    const vanilla = build(t0, () => ({ tps: null, cpu: 25, rssMB: 6000, players: 3 }))
    const quiet = analyze({
      series: vanilla,
      uptime: report(0),
      events: [],
      server: { type: 'vanilla', java: java() },
      from: t0,
      to
    })
    if (codes(quiet) !== 'tps-unavailable') return fail('vanilla server -> ' + codes(quiet))
    // Same empty series on Paper means something else entirely: RCON is off.
    // Telling that owner their software cannot report TPS would be wrong.
    const rconOff = analyze({
      series: vanilla,
      uptime: report(0),
      events: [],
      server: { type: 'paper', java: java() },
      from: t0,
      to
    })
    if (codes(rconOff) !== 'tps-not-reported') return fail('paper without RCON -> ' + codes(rconOff))
    console.log('ANALYSIS-SMOKE: missing TPS reported as missing, and the two reasons kept apart')

    // --- 5. backups are only expected once the window is long enough ---------
    const longFrom = to - 10 * 86400_000
    const backupless = analyze({
      series: ok,
      uptime: report(0),
      events: [],
      server: { type: 'paper', java: java() },
      from: longFrom,
      to
    })
    if (!backupless.some((f) => f.code === 'no-backups')) {
      return fail('10 days without a backup was not flagged')
    }
    const withBackup = analyze({
      series: ok,
      uptime: report(0),
      events: [
        {
          id: 'b',
          serverId: SID,
          ts: to - 86400_000,
          type: 'backup.created',
          severity: 'success'
        }
      ],
      server: { type: 'paper', java: java() },
      from: longFrom,
      to
    })
    if (withBackup.some((f) => f.code === 'no-backups')) return fail('flagged a server that has backups')
    console.log('ANALYSIS-SMOKE: backup reminder honours both the window and the evidence')

    updateConfig((c) => {
      c.telemetry = saved
    })
    wipe()
    console.log('ANALYSIS-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
    wipe()
    fail('exception ' + String(e))
  }
}

/**
 * Alert rule verification (Stage 5).
 *
 * Two halves, because the feature has two: the pure evaluator is replayed with
 * synthetic timestamps (a sustained breach, a recovery, a dropout, a cooldown,
 * the startup grace), and then the engine on top of it is checked for the
 * things a pure function cannot express - persistence, the recorded event, the
 * window reset when a server stops, and a cooldown that survives a restart.
 */
export async function runAlertsSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('ALERTS-SMOKE: FAIL -', m)
    app.exit(1)
  }
  const SID = 'smoke-alerts-server'
  const bak = alertsPath() + '.smokebak'
  const hadRules = existsSync(alertsPath())

  /** Feed a rule a stream of samples and collect the moments it fires. */
  const replay = (
    rule: AlertRule,
    from: number,
    to: number,
    step: number,
    sample: (ts: number) => AlertSample
  ): number[] => {
    let st = { ...IDLE }
    const fires: number[] = []
    for (let ts = from; ts <= to; ts += step) {
      const r = evaluateRule(rule, st, sample(ts), ts)
      st = r.state
      if (r.fired) fires.push(ts)
    }
    return fires
  }

  const rule = (over: Partial<AlertRule> = {}): AlertRule =>
    normalizeRule({
      id: 'r',
      serverId: SID,
      name: 'test',
      metric: 'tps',
      comparison: 'below',
      threshold: 15,
      forSeconds: 60,
      cooldownSeconds: 300,
      graceSeconds: 0,
      ...over
    })

  /** A healthy server that has been up for a day. */
  const S = (over: Partial<AlertSample> = {}): AlertSample => ({
    tps: 20,
    cpu: 10,
    rssMB: 2048,
    players: 3,
    uptimeMs: 86_400_000,
    ...over
  })

  const restore = (): void => {
    try {
      if (hadRules && existsSync(bak)) {
        copyFileSync(bak, alertsPath())
        rmSync(bak, { force: true })
      } else if (!hadRules) {
        rmSync(alertsPath(), { force: true })
      }
    } catch {
      /* best effort */
    }
  }

  try {
    if (hadRules) copyFileSync(alertsPath(), bak)
    const t0 = Date.now() - 86_400_000

    // --- 1. a breach has to hold before it fires, then respects the cooldown --
    const sustained = replay(rule(), t0, t0 + 900_000, 2000, () => S({ tps: 10 }))
    // 60s to arm, then one every 300s: 60, 360, 660.
    if (sustained.length !== 3) return fail('sustained: expected 3 fires, got ' + sustained.length)
    if (sustained[0] !== t0 + 60_000) return fail('sustained: fired at ' + (sustained[0] - t0) + 'ms, not 60s')
    if (sustained[1] !== t0 + 360_000 || sustained[2] !== t0 + 660_000) {
      return fail('cooldown: repeats at ' + sustained.map((f) => (f - t0) / 1000).join('/') + 's')
    }

    // --- 2. a single good sample restarts the countdown --------------------
    const flapping = replay(rule(), t0, t0 + 100_000, 10_000, (ts) =>
      S({ tps: ts === t0 + 50_000 ? 20 : 10 })
    )
    if (flapping.length !== 0) return fail('a recovery did not reset the window')

    // --- 3. nothing fires while the metric is inside the threshold ---------
    if (replay(rule(), t0, t0 + 3600_000, 10_000, () => S({ tps: 20 })).length !== 0) {
      return fail('fired while the server was healthy')
    }
    // ... and the same rule with the comparison flipped is equally quiet.
    const cpuRule = rule({ metric: 'cpu', comparison: 'above', threshold: 85 })
    if (replay(cpuRule, t0, t0 + 600_000, 10_000, () => S({ cpu: 80 })).length !== 0) {
      return fail('"above" fired below its threshold')
    }
    if (replay(cpuRule, t0, t0 + 600_000, 10_000, () => S({ cpu: 90 })).length !== 2) {
      return fail('"above" did not fire above its threshold')
    }

    // --- 4. a missing reading holds the window, it never creates one -------
    const dropout = replay(rule(), t0, t0 + 100_000, 10_000, (ts) =>
      S({ tps: ts > t0 + 30_000 && ts < t0 + 70_000 ? null : 10 })
    )
    if (dropout.length !== 1 || dropout[0] !== t0 + 70_000) {
      return fail('a TPS dropout broke the sustained window')
    }
    if (replay(rule(), t0, t0 + 3600_000, 10_000, () => S({ tps: null })).length !== 0) {
      return fail('fired on a server that never reported a TPS')
    }

    // --- 5. the startup grace swallows the world-load spike ----------------
    const graced = replay(rule({ graceSeconds: 120 }), t0, t0 + 400_000, 10_000, (ts) =>
      S({ tps: 10, uptimeMs: ts - t0 })
    )
    if (graced[0] !== t0 + 180_000) {
      return fail('grace: first fire at ' + ((graced[0] - t0) / 1000 || -1) + 's, expected 180s')
    }
    console.log('ALERTS-SMOKE: evaluator OK (sustain, cooldown, recovery, dropout, grace, both directions)')

    // ------------------------------------------------------------------ engine
    // A throwaway server so the engine's own orphan sweep does not eat the
    // fixtures, and so no real server's timeline is polluted.
    const fixture: ServerConfig = {
      id: SID,
      name: 'Alerts smoke',
      path: join(app.getPath('temp'), 'msms-alerts-smoke'),
      type: 'paper',
      mcVersion: '1.21',
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      java: {
        javaPath: '',
        minMemoryMB: 1024,
        maxMemoryMB: 2048,
        preset: 'basic',
        customArgs: '',
        extraFlags: '',
        jarFile: 'server.jar',
        nogui: true
      },
      autoRestart: false,
      autoRestartOnCrash: false
    }
    updateConfig((c) => {
      c.servers = c.servers.filter((s) => s.id !== SID)
      c.servers.push(fixture)
    })

    alertsMod._reset()
    rmSync(alertsPath(), { force: true })

    // --- 6. CRUD + the clamps that stop a rule alerting every two seconds --
    const created = alertsMod.createRule({
      serverId: SID,
      name: '  Low TPS  ',
      metric: 'tps',
      comparison: 'below',
      threshold: 15,
      forSeconds: -5,
      cooldownSeconds: 0
    })
    if (created.name !== 'Low TPS') return fail('rule name not trimmed')
    if (created.forSeconds !== 0) return fail('negative forSeconds not clamped')
    if (created.cooldownSeconds !== 5) return fail('zero cooldown not clamped, got ' + created.cooldownSeconds)
    if (alertsMod.listRules(SID).length !== 1) return fail('created rule not listed')
    if (alertsMod.listRules('other-server').length !== 0) return fail('rules leaked across servers')
    alertsMod.deleteRule(created.id)
    if (alertsMod.listRules(SID).length !== 0) return fail('deleted rule still listed')

    // --- 7. a fire is recorded, counted, and carries what it saw -----------
    const evFile = eventsMod.eventFile(SID)
    rmSync(evFile, { force: true })
    const live = alertsMod.createRule({
      serverId: SID,
      name: 'Low TPS',
      metric: 'tps',
      comparison: 'below',
      threshold: 15,
      forSeconds: 60,
      cooldownSeconds: 300,
      graceSeconds: 0
    })
    for (let ts = t0; ts <= t0 + 600_000; ts += 10_000) {
      alertsMod.handleSample(SID, S({ tps: 10 }), ts)
    }
    const fired = eventsMod.query(SID, { from: t0 - 1000, to: t0 + 700_000, types: ['alert.triggered'] })
    if (fired.events.length !== 2) return fail('engine recorded ' + fired.events.length + ' alerts, expected 2')
    const first = fired.events[fired.events.length - 1] // query is newest-first
    if (first.ts !== t0 + 60_000) return fail('first alert recorded at the wrong time')
    if (first.severity !== 'warn') return fail('alert severity is ' + first.severity)
    if (first.text !== 'Low TPS') return fail('alert lost the rule name')
    const d = first.data ?? {}
    if (d.metric !== 'tps' || d.threshold !== 15 || d.value !== 10 || d.heldSeconds !== 60) {
      return fail('alert data wrong: ' + JSON.stringify(d))
    }
    const stored = alertsMod.listRules(SID)[0]
    if (stored.fireCount !== 2) return fail('fireCount is ' + stored.fireCount)
    if (stored.lastFired !== t0 + 360_000) return fail('lastFired not persisted')
    console.log('ALERTS-SMOKE: engine OK (2 alerts recorded with metric, value and duration)')

    // --- 8. stopping a server forgets the window but keeps the cooldown ----
    alertsMod.deleteRule(live.id)
    const reset = alertsMod.createRule({
      serverId: SID,
      name: 'Reset check',
      metric: 'players',
      comparison: 'below',
      threshold: 1,
      forSeconds: 60,
      cooldownSeconds: 300,
      graceSeconds: 0
    })
    rmSync(evFile, { force: true })
    const t1 = t0 + 3600_000
    for (let ts = t1; ts <= t1 + 50_000; ts += 10_000) alertsMod.handleSample(SID, S({ players: 0 }), ts)
    alertsMod.resetServer(SID) // server stopped 50 s into the breach
    for (let ts = t1 + 60_000; ts <= t1 + 110_000; ts += 10_000) {
      alertsMod.handleSample(SID, S({ players: 0 }), ts)
    }
    if (eventsMod.query(SID, { from: t1, to: t1 + 200_000, types: ['alert.triggered'] }).events.length) {
      return fail('a restart inherited the sustained window and alerted early')
    }
    alertsMod.handleSample(SID, S({ players: 0 }), t1 + 125_000) // 65 s after the reset
    if (eventsMod.query(SID, { from: t1, to: t1 + 200_000, types: ['alert.triggered'] }).events.length !== 1) {
      return fail('the window did not restart after the reset')
    }
    console.log('ALERTS-SMOKE: window reset on stop OK (no early alert, rearms cleanly)')

    // --- 9. the cooldown outlives the app being closed ---------------------
    alertsMod.deleteRule(reset.id)
    const persist = alertsMod.createRule({
      serverId: SID,
      name: 'Cooldown check',
      metric: 'cpu',
      comparison: 'above',
      threshold: 50,
      forSeconds: 0,
      cooldownSeconds: 300,
      graceSeconds: 0
    })
    rmSync(evFile, { force: true })
    const t2 = t1 + 7200_000
    alertsMod.handleSample(SID, S({ cpu: 90 }), t2)
    alertsMod._reset()
    alertsMod.initAlerts() // as if MSMS had been restarted
    if (alertsMod.listRules(SID).length !== 1) return fail('rules did not survive a reload')
    alertsMod.handleSample(SID, S({ cpu: 90 }), t2 + 10_000)
    let n = eventsMod.query(SID, { from: t2 - 1000, to: t2 + 999_000, types: ['alert.triggered'] }).events.length
    if (n !== 1) return fail('cooldown was lost across a reload (' + n + ' alerts)')
    alertsMod.handleSample(SID, S({ cpu: 90 }), t2 + 300_000)
    n = eventsMod.query(SID, { from: t2 - 1000, to: t2 + 999_000, types: ['alert.triggered'] }).events.length
    if (n !== 2) return fail('rule stayed silent after its cooldown expired')
    console.log('ALERTS-SMOKE: cooldown survives a restart, then rearms')

    // --- 10. cleanup: rules follow their server out of the app -------------
    alertsMod.dropServer(SID)
    if (alertsMod.listRules(SID).length !== 0) return fail('dropServer left rules behind')
    void persist
    alertsMod.createRule({
      serverId: 'ghost-server',
      name: 'Orphan',
      metric: 'tps',
      comparison: 'below',
      threshold: 5
    })
    if (alertsMod.pruneOrphans() !== 1) return fail('pruneOrphans missed a rule with no server')
    if (alertsMod.listRules().length !== 0) return fail('orphan rule survived the sweep')
    console.log('ALERTS-SMOKE: cleanup OK (rules dropped with the server, orphans swept)')

    eventsMod.dropServer(SID)
    updateConfig((c) => {
      c.servers = c.servers.filter((s) => s.id !== SID)
    })
    restore()
    console.log('ALERTS-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
    try {
      eventsMod.dropServer(SID)
      updateConfig((c) => {
        c.servers = c.servers.filter((s) => s.id !== SID)
      })
    } catch {
      /* best effort */
    }
    restore()
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

  // ---- app shell layout (nobody can eyeball this window, so measure it) ----
  {
    const layout = JSON.parse(
      await win.webContents.executeJavaScript(
        `(()=>{const app=document.querySelector('.app'),sb=document.querySelector('.sidebar');
         const r=sb?sb.getBoundingClientRect():null;
         /* content inside a deliberately scrollable strip is not "broken" */
         const scrollable=e=>{for(let p=e.parentElement;p;p=p.parentElement){
           const o=getComputedStyle(p).overflowX;if(o==='auto'||o==='scroll')return true}return false};
         const over=[...document.querySelectorAll('.app *')]
           .filter(e=>e.getBoundingClientRect().right>window.innerWidth+2&&!scrollable(e))
           .map(e=>e.className&&e.className.baseVal===undefined?String(e.className):e.tagName).slice(0,4);
         return JSON.stringify({cols:app?getComputedStyle(app).gridTemplateColumns:'',
           sidebarW:r?Math.round(r.width):0,sidebarLeft:r?Math.round(r.left):-1,
           innerW:window.innerWidth,overflow:over})})()`
      )
    ) as { cols: string; sidebarW: number; sidebarLeft: number; innerW: number; overflow: string[] }
    if (layout.sidebarLeft !== 0) return fail('sidebar is not flush left: ' + JSON.stringify(layout))
    if (layout.sidebarW < 200 || layout.sidebarW > 300) return fail('sidebar width ' + layout.sidebarW)
    if (layout.cols.split(' ').length !== 2) return fail('app grid has ' + layout.cols)
    if (layout.overflow.length) return fail('elements overflow the window: ' + layout.overflow.join(','))
    console.log(`SMOKE: app layout OK (grid ${layout.cols}, sidebar ${layout.sidebarW}px, no overflow)`)
  }

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

  // --- 2b2. the running guard, which only a real running server can prove ---
  // The name is deliberately one that does not exist: if the guard were ever
  // removed this still deletes nothing, but it must be refused for the right
  // reason, before anything else is even looked at.
  {
    let refused = ''
    try {
      worldsMod.deleteWorld(id, 'no-such-world-here')
    } catch (e) {
      refused = String((e as Error)?.message ?? e)
    }
    if (refused !== 'server-running') {
      return fail('deleting a world while running was refused with "' + refused + '"')
    }
    // Listing stays available while running (read-only) - and a stub server
    // with no world yet must come back empty rather than throw.
    const live = await worldsMod.listWorlds(id)
    if (!Array.isArray(live)) return fail('listWorlds did not return a list while running')
    console.log(`SMOKE: world guard OK (delete refused while running, ${live.length} world(s) listed)`)
  }

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

    // History view: charts must actually draw the run we just recorded.
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.tab')].find(t=>/History|Geçmiş/i.test(t.textContent||''))?.click()`
    )
    await sleep(900)
    const hv = JSON.parse(
      await win.webContents.executeJavaScript(
        `(()=>{const charts=[...document.querySelectorAll('.chart')];
         const paths=[...document.querySelectorAll('.chart svg path')].map(p=>p.getAttribute('d')||'');
         const drawn=paths.filter(d=>/^M [\\d.]+ [\\d.]+/.test(d)).length;
         const up=document.querySelector('.uptime-bar');
         const pct=(up?.parentElement?.querySelector('b')?.textContent)||'';
         return JSON.stringify({charts:charts.length,drawn,pct,
           bar:up?.querySelector('span')?.style.width||''})})()`
      )
    ) as { charts: number; drawn: number; pct: string; bar: string }
    if (hv.charts !== 4) return fail('history view rendered ' + hv.charts + ' charts')
    if (hv.drawn < 1) return fail('no chart path was drawn')
    if (!/%/.test(hv.pct)) return fail('uptime not computed in the UI: ' + hv.pct)
    console.log(`SMOKE: history view OK (${hv.charts} charts, ${hv.drawn} paths, uptime ${hv.pct}, bar ${hv.bar})`)

    // The analysis panel reads the same data back as sentences. This run is
    // seconds long, so the honest verdict is "not enough history".
    const an = JSON.parse(
      await win.webContents.executeJavaScript(
        `(()=>{const f=[...document.querySelectorAll('.finding')];
         return JSON.stringify({n:f.length,
           text:(f[0]?.querySelector('.finding-text')?.textContent||''),
           fix:(f[0]?.querySelector('.finding-fix')?.textContent||'')})})()`
      )
    ) as { n: number; text: string; fix: string }
    if (an.n < 1) return fail('analysis panel rendered no findings')
    for (const s of [an.text, an.fix]) {
      if (!s || /^analysis\./.test(s) || /\{\{/.test(s)) return fail('finding not translated: ' + s)
    }
    console.log(`SMOKE: analysis panel OK (${an.n} finding(s), "${an.text}")`)

    // Automation tab: both halves must render, and a rule must survive the
    // whole round trip - preset -> form -> IPC -> disk -> list -> delete.
    const rulesBak = alertsPath() + '.smokebak'
    const hadRules = existsSync(alertsPath())
    if (hadRules) copyFileSync(alertsPath(), rulesBak)
    alertsMod.initAlerts() // the boot path the smoke branch skips
    try {
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.tab')].find(t=>/Automation|Otomasyon/i.test(t.textContent||''))?.click()`
      )
      await sleep(400)
      const sections = JSON.parse(
        await win.webContents.executeJavaScript(
          `(()=>{const b=[...document.querySelectorAll('.btn.sm')].map(x=>(x.textContent||'').trim());
           return JSON.stringify({buttons:b.slice(0,2),cron:!!document.querySelector('.input.mono')})})()`
        )
      ) as { buttons: string[]; cron: boolean }
      if (sections.buttons.length !== 2) return fail('automation sections missing: ' + JSON.stringify(sections))
      if (!sections.cron) return fail('scheduled tasks section did not render')

      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.btn.sm')].find(b=>/Alert rules|Uyarı kuralları/i.test(b.textContent||''))?.click()`
      )
      await sleep(300)
      const before = alertsMod.listRules(id).length
      const form = JSON.parse(
        await win.webContents.executeJavaScript(
          `(()=>{const p=[...document.querySelectorAll('.btn.ghost.sm')];
           const low=p.find(b=>/Low TPS|Düşük TPS/i.test(b.textContent||''));
           if(low)low.click();
           return JSON.stringify({presets:p.length,
             name:(document.querySelector('.input')||{}).value||'',
             selects:document.querySelectorAll('.select').length})})()`
        )
      ) as { presets: number; name: string; selects: number }
      if (form.presets < 5) return fail('alert presets missing (' + form.presets + ')')
      if (form.selects < 3) return fail('rule form did not render its selects')
      await sleep(150)
      const filled = await win.webContents.executeJavaScript(
        `(document.querySelector('.input')||{}).value||''`
      )
      if (!filled) return fail('clicking a preset did not fill the form')

      // Create it through the button the user would press.
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.btn.primary')].find(b=>/Create rule|Kural oluştur/i.test(b.textContent||''))?.click()`
      )
      await sleep(500)
      const after = alertsMod.listRules(id)
      if (after.length !== before + 1) return fail('creating a rule from the UI did not reach disk')
      const made = after[after.length - 1]
      if (made.metric !== 'tps' || made.comparison !== 'below') return fail('preset values lost: ' + JSON.stringify(made))
      const listed = JSON.parse(
        await win.webContents.executeJavaScript(
          `(()=>{const r=[...document.querySelectorAll('.mod-row')];
           return JSON.stringify({rows:r.length,text:(r[0]?.textContent||'').slice(0,90)})})()`
        )
      ) as { rows: number; text: string }
      if (listed.rows < 1) return fail('created rule is not listed in the UI')
      if (/alerts\.|\{\{/.test(listed.text)) return fail('rule row not translated: ' + listed.text)

      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.mod-row .btn.danger')].pop()?.click()`
      )
      await sleep(400)
      if (alertsMod.listRules(id).length !== before) return fail('deleting a rule from the UI did not stick')
      console.log(`SMOKE: automation view OK (${form.presets} presets, "${filled}" created + deleted via UI)`)

      // Worlds share the Backups tab. The active world must render and its
      // delete button must be disabled - the UI guard behind the core one.
      // The stub server never generates a world, so lay a minimal one down.
      const worldFixture = join(getConfig().servers.find((s) => s.id === id)?.path ?? '', 'world')
      mkdirSync(worldFixture, { recursive: true })
      writeFileSync(
        join(worldFixture, 'level.dat'),
        gzipSync(
          nbt.writeUncompressed({
            type: 'compound',
            name: '',
            value: {
              Data: {
                type: 'compound',
                value: { Version: { type: 'compound', value: { Name: { type: 'string', value: '1.21.4' } } } }
              }
            }
          } as nbt.NBT)
        )
      )
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.tab')].find(t=>/Backups|Yedek/i.test(t.textContent||''))?.click()`
      )
      await sleep(700)
      const wv = JSON.parse(
        await win.webContents.executeJavaScript(
          `(()=>{const rows=[...document.querySelectorAll('.world-row')];
           const first=rows[0];
           return JSON.stringify({rows:rows.length,
             name:(first?.querySelector('.mod-name')?.textContent||'').trim(),
             badge:!!first?.querySelector('.badge'),
             delDisabled:!!first?.querySelector('.btn.danger')?.disabled,
             meta:(first?.querySelector('.dim')?.textContent||'').slice(0,60)})})()`
        )
      ) as { rows: number; name: string; badge: boolean; delDisabled: boolean; meta: string }
      if (wv.rows < 1) return fail('worlds section rendered no worlds')
      if (!wv.badge) return fail('the active world is not badged in the UI')
      if (!wv.delDisabled) return fail('the UI offers to delete the active world')
      if (/worlds\.|\{\{/.test(wv.name + wv.meta)) return fail('world row not translated: ' + wv.meta)
      console.log(`SMOKE: worlds view OK (${wv.rows} world(s), "${wv.name}", delete disabled)`)

      // Close the IPC seam: the three-argument calls are the ones a swapped
      // preload binding would break at runtime and nowhere else. Clone is the
      // safe one to drive for real - it only ever creates, and the copy is
      // removed again through the UI's own delete.
      const clonePath = worldFixture + '_copy'
      try {
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('.world-row .btn.ghost')].find(b=>/Duplicate|Kopyala/i.test(b.title||''))?.click()`
        )
        await sleep(300)
        await win.webContents.executeJavaScript(
          `document.querySelector('.modal .btn.primary')?.click()`
        )
        await sleep(1200)
        const cloned = JSON.parse(
          await win.webContents.executeJavaScript(
            `(()=>{const r=[...document.querySelectorAll('.world-row')];
             return JSON.stringify({rows:r.length,names:r.map(x=>(x.querySelector('.mod-name')?.textContent||'').trim())})})()`
          )
        ) as { rows: number; names: string[] }
        if (!existsSync(clonePath)) return fail('cloning through the UI never reached the disk')
        if (cloned.rows !== 2) return fail('the clone did not appear in the list (' + cloned.rows + ' rows)')

        // ...and delete it again, which also proves the destructive path is
        // wired to the right world: the copy, never the active one.
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('.world-row')].find(r=>!r.querySelector('.badge'))?.querySelector('.btn.danger')?.click()`
        )
        await sleep(300)
        await win.webContents.executeJavaScript(`document.querySelector('.modal .btn.danger')?.click()`)
        await sleep(900)
        if (existsSync(clonePath)) return fail('deleting the clone through the UI did nothing')
        if (!existsSync(worldFixture)) return fail('the UI deleted the ACTIVE world instead of the copy')
        console.log('SMOKE: world clone + delete round-tripped through the UI')

        // Java picker: the dropdown must list what the scan found, and
        // choosing one must produce the verdict the shared table gives for
        // this server's Minecraft version - computed here, not hardcoded, so
        // the assertion holds on any machine.
        const found = await listJavaInstalls()
        const oldest = [...found].sort((a, b) => a.major - b.major)[0]
        if (!oldest) return fail('no Java on this machine to drive the picker with')
        const mc = getConfig().servers.find((s) => s.id === id)?.mcVersion ?? ''
        const expected = checkJava(mc, oldest.major).verdict
        await win.webContents.executeJavaScript(
          `[...document.querySelectorAll('.tab')].find(t=>/Dashboard|Panel|Genel/i.test(t.textContent||''))?.click()`
        )
        await sleep(900)
        const opts = JSON.parse(
          await win.webContents.executeJavaScript(
            `(()=>{const s=[...document.querySelectorAll('.select')].find(x=>[...x.options].some(o=>/^Java \\d/.test(o.text)));
             return JSON.stringify({found:!!s,opts:s?[...s.options].map(o=>o.text):[]})})()`
          )
        ) as { found: boolean; opts: string[] }
        if (!opts.found) return fail('the Java picker did not render')
        if (opts.opts.filter((o) => /^Java \d/.test(o)).length !== found.length) {
          return fail('picker lists ' + opts.opts.length + ' entries for ' + found.length + ' installs')
        }
        const verdictClass = JSON.parse(
          await win.webContents.executeJavaScript(
            `(()=>{const s=[...document.querySelectorAll('.select')].find(x=>[...x.options].some(o=>/^Java \\d/.test(o.text)));
             const set=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set;
             set.call(s, ${JSON.stringify(oldest.path)});
             s.dispatchEvent(new Event('change',{bubbles:true}));
             return new Promise(r=>setTimeout(()=>{const c=document.querySelector('.java-compat');
               r(JSON.stringify({cls:c?c.className.replace('java-compat ',''):'',text:(c?.textContent||'').trim().slice(0,70)}))},300))})()`
          )
        ) as { cls: string; text: string }
        const want = expected === 'too-old' ? 'bad' : expected === 'risky-new' ? 'warn' : expected === 'ok' ? 'ok' : ''
        if (verdictClass.cls !== want) {
          return fail(`Java ${oldest.major} on MC ${mc}: UI said "${verdictClass.cls}", table says "${want}"`)
        }
        if (want && /args\.|\{\{/.test(verdictClass.text)) {
          return fail('compatibility line not translated: ' + verdictClass.text)
        }
        console.log(
          `SMOKE: java picker OK (${found.length} listed, Java ${oldest.major} on MC ${mc} -> ${want || 'no verdict'})`
        )
      } finally {
        rmSync(clonePath, { recursive: true, force: true })
        rmSync(worldFixture, { recursive: true, force: true })
      }
    } finally {
      alertsMod._reset()
      if (hadRules) {
        copyFileSync(rulesBak, alertsPath())
        rmSync(rulesBak, { force: true })
      } else {
        rmSync(alertsPath(), { force: true })
      }
    }
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
        r = await get(`/api/servers/${id}/uptime?from=${enow - 3600_000}&to=${enow}`, ft)
        if (r.status !== 200) return fail('uptime with view expected 200, got ' + r.status)
        const rep = (await r.json()) as { ratio: number | null; sessions: unknown[]; starts: number }
        if (rep.ratio == null || rep.starts !== 1) return fail('uptime endpoint: ' + JSON.stringify(rep))
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
