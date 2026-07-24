import { app, BrowserWindow } from 'electron'
import { existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import AdmZip from 'adm-zip'
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
import { pickForgeRunJar } from './core/serverDetect'
import { downloadFile } from './core/net'
import { createServer as httpCreateServer } from 'node:http'
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
import {
  pickJavaFor,
  provisionPlan,
  adoptiumTarget,
  adoptiumAssetsUrl,
  pickAdoptiumPackage,
  isZipPackage,
  type AdoptiumAsset
} from '@shared/javaProvision'
import { diffUpdates } from '@shared/mods'
import type { MrVersion } from '@shared/mods'
import { computeUptime, clipSessions } from '@shared/uptime'
import { evaluateRule, normalizeRule, IDLE, type AlertRule, type AlertSample } from '@shared/alerts'
import { analyze, type Finding } from '@shared/analysis'
import {
  parseBridgeLine,
  hasBridgeMarker,
  reconcileTps,
  newBridgeSnapshot,
  BRIDGE_STALE_FACTOR,
  BRIDGE_DEFAULT_INTERVAL_MS,
  type BridgeSnapshot
} from '@shared/bridge'
import { filterAudit, type AuditEntry } from '@shared/audit'
import { aggregateJoins, type JoinRecord } from '@shared/joins'
import * as auditMod from './core/audit'
import type { UptimeReport } from '@shared/uptime'
import type { JavaArgsConfig, MetricSeries, ServerConfig, ServerEvent } from '@shared/types'
import { alertsPath, uploadsDir, auditDir } from './paths'
import { analyzeCrash } from './core/crash'
import { CREATABLE_TYPES, createErrorKey } from '@shared/versions'

/* eslint-disable no-console */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Build a zip by hand so a malicious entry name survives - adm-zip strips
 * `../` on addFile, so its own API cannot produce the archive a zip-slip guard
 * has to defend against. Stored (uncompressed) entries, which is all a test
 * needs.
 */
function craftZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const crc32 = (buf: Buffer): number => {
    let c = ~0
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const u16 = (n: number): Buffer => {
    const b = Buffer.alloc(2)
    b.writeUInt16LE(n >>> 0)
    return b
  }
  const u32 = (n: number): Buffer => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n >>> 0)
    return b
  }
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name)
    const crc = crc32(e.data)
    const lfh = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(e.data.length), u32(e.data.length), u16(name.length), u16(0), name, e.data
    ])
    centrals.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(e.data.length), u32(e.data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name
      ])
    )
    locals.push(lfh)
    offset += lfh.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(cd.length), u32(offset), u16(0)
  ])
  return Buffer.concat([...locals, cd, eocd])
}

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
 * Mod update-check verification (Stage 11).
 *
 * The judgement is pure - `diffUpdates` - so it is replayed against a captured
 * real Modrinth `version_files/update` response (the shape confirmed against
 * the live API: keyed by the hash we sent, latest version with primary-file
 * sha1). Three cases: a hash present with a different latest file (update), a
 * hash that IS the latest (current), and a hash Modrinth does not know
 * (unknown). The live POST and download are the thin shell around this and are
 * inspection-verified, not asserted here.
 */
export async function runModUpdateSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('MODUPDATE-SMOKE: FAIL -', m)
    app.exit(1)
  }
  try {
    // Real hashes/shape from LuckPerms on the live API (bukkit / 1.20.1).
    const OLD = '7ac3319812ed36ba099dd258e512b7f07b4e4d4a' // v5.5.0
    const NEW = 'dad091fbabe7cbb1db3dc1478eb1fe413520a014' // v5.5.53 (latest)
    const installed = [
      { path: 'plugins/LuckPerms-old.jar', name: 'LuckPerms-old', sha1: OLD },
      { path: 'plugins/LuckPerms-new.jar', name: 'LuckPerms-new', sha1: NEW },
      { path: 'plugins/HandMade.jar', name: 'HandMade', sha1: 'ffffffffffffffffffffffffffffffffffffffff' }
    ]
    // Modrinth returns the same latest version keyed by BOTH recognised hashes;
    // the unrecognised one is simply absent.
    const latest: MrVersion = {
      id: 'MBSY8toc',
      project_id: 'Vebnzrzj',
      version_number: 'v5.5.53-bukkit',
      files: [
        { primary: true, filename: 'LuckPerms-Bukkit-5.5.53.jar', hashes: { sha1: NEW } }
      ]
    }
    const byHash: Record<string, MrVersion> = { [OLD]: latest, [NEW]: latest }

    const updates = diffUpdates(installed, byHash)
    const byName = Object.fromEntries(updates.map((u) => [u.name, u]))

    const old = byName['LuckPerms-old']
    if (old.state !== 'update') return fail('an outdated jar was not flagged: ' + old.state)
    if (old.versionId !== 'MBSY8toc') return fail('update carried the wrong versionId: ' + old.versionId)
    if (old.projectId !== 'Vebnzrzj') return fail('update missing the projectId')
    if (old.latestVersion !== 'v5.5.53-bukkit') return fail('update missing the version name')
    if (old.filename !== 'LuckPerms-Bukkit-5.5.53.jar') return fail('update missing the filename')

    const cur = byName['LuckPerms-new']
    if (cur.state !== 'current') return fail('the latest jar was not seen as current: ' + cur.state)
    if (cur.versionId) return fail('a current mod should carry no versionId to install')

    const unk = byName['HandMade']
    if (unk.state !== 'unknown') return fail('a jar Modrinth does not know was judged: ' + unk.state)
    console.log('MODUPDATE-SMOKE: diff OK (update / current / unknown, versionId + filename carried)')

    // Version STRINGS must never decide it - only the hash. A "newer-looking"
    // number with the SAME file hash is still current.
    const sameHashHigherNumber: MrVersion = {
      id: 'x',
      project_id: 'p',
      version_number: 'v9.9.9',
      files: [{ primary: true, filename: 'x.jar', hashes: { sha1: OLD } }]
    }
    const noStringTrap = diffUpdates([installed[0]], { [OLD]: sameHashHigherNumber })
    if (noStringTrap[0].state !== 'current') {
      return fail('a higher version number with the same hash was mis-flagged as an update')
    }
    // ...and a lower-looking number with a DIFFERENT hash is still an update.
    const diffHashLowerNumber: MrVersion = {
      id: 'y',
      project_id: 'p',
      version_number: 'v0.0.1',
      files: [{ primary: true, filename: 'y.jar', hashes: { sha1: NEW } }]
    }
    if (diffUpdates([installed[0]], { [OLD]: diffHashLowerNumber })[0].state !== 'update') {
      return fail('a different hash was not an update just because its version string looked older')
    }
    console.log('MODUPDATE-SMOKE: decided by hash, never by version string')

    // Loader family: a Paper server must accept plugins tagged only bukkit or
    // spigot, or an old hand-added plugin's update reads as "unknown". Modded
    // and proxy loaders stay single (they do not cross-load).
    const paperLoaders = modsMod.loadersFor('paper')
    for (const l of ['paper', 'spigot', 'bukkit', 'purpur', 'folia']) {
      if (!paperLoaders.includes(l)) return fail(`paper server should accept ${l}-tagged plugins`)
    }
    if (modsMod.loadersFor('fabric').join() !== 'fabric') return fail('fabric widened its loader set')
    if (modsMod.loadersFor('forge').join() !== 'forge') return fail('forge widened its loader set')
    if (modsMod.loadersFor('velocity').join() !== 'velocity') return fail('velocity widened its loader set')
    if (modsMod.loadersFor('unknown').length !== 0) return fail('unknown type should not filter by loader')
    console.log('MODUPDATE-SMOKE: loader family OK (plugin servers widen, modded/proxy stay single)')

    console.log('MODUPDATE-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
    fail('exception ' + String(e))
  }
}

/**
 * MSMS Bridge protocol + TPS reconciliation (Stage 12).
 *
 * Two traps this pins, both of which a self-authored test can silently pass:
 * (1) the marker is NOT at column 0 — Paper routes stdout through log4j2, so
 * real lines carry an `[HH:MM:SS INFO]:` (and sometimes `[STDOUT]`) preamble; a
 * parser anchored to `^` would pass its own clean fixtures yet fail live. So
 * the fixtures here deliberately wear that preamble. (2) a silenced bridge must
 * never pin a stale TPS on screen — once it goes quiet we fall back to RCON.
 */
export async function runBridgeSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('BRIDGE-SMOKE: FAIL -', m)
    app.exit(1)
  }
  try {
    // --- the marker is found anywhere in the line, not just at the start ---
    const clean = parseBridgeLine(
      '[MSMS-BRIDGE] {"v":1,"t":"tick","tps":19.9,"tps5":20,"tps15":20,"mspt":3.1}'
    )
    if (!clean || clean.t !== 'tick' || clean.tps !== 19.9 || clean.mspt !== 3.1) {
      return fail('a clean tick line did not parse')
    }
    // Real Paper output: a log4j2 preamble sits in front of the marker.
    const withPreamble = parseBridgeLine(
      '[12:34:56 INFO]: [MSMS-BRIDGE] {"v":1,"t":"hello","plugin":"MSMS-Bridge","pluginVersion":"1.0.0","server":"Paper","mc":"1.21.1","interval":5000}'
    )
    if (!withPreamble || withPreamble.t !== 'hello' || withPreamble.pluginVersion !== '1.0.0') {
      return fail('a hello behind a log4j2 preamble did not parse')
    }
    if (withPreamble.interval !== 5000) return fail('the hello interval was dropped')
    // Some setups insert a [STDOUT] tag between the preamble and the message.
    const withStdout = parseBridgeLine(
      '[12:34:57 INFO]: [STDOUT] [MSMS-BRIDGE] {"v":1,"t":"tick","tps":20,"tps5":20,"tps15":20,"mspt":2.0}'
    )
    if (!withStdout || withStdout.t !== 'tick' || withStdout.tps !== 20) {
      return fail('a tick behind a [STDOUT] tag did not parse')
    }
    console.log('BRIDGE-SMOKE: marker parsed at column 0, behind [INFO]: and behind [STDOUT]')

    // --- marker detection must not fire on ordinary console lines ---
    if (!hasBridgeMarker('[12:00:00 INFO]: [MSMS-BRIDGE] {"v":1,"t":"bye"}')) {
      return fail('a marked line was not detected')
    }
    if (hasBridgeMarker('[12:00:00 INFO]: Done (1.234s)! For help, type "help"')) {
      return fail('an ordinary log line was mistaken for a bridge line')
    }

    // --- marked-but-malformed: still detected (so it is hidden + warned),
    //     but parses to null so nothing acts on garbage ---
    const bad = '[12:00:01 INFO]: [MSMS-BRIDGE] {this is not json'
    if (!hasBridgeMarker(bad)) return fail('a malformed marked line lost its marker')
    if (parseBridgeLine(bad) !== null) return fail('malformed JSON should not parse')
    if (parseBridgeLine('[MSMS-BRIDGE] {"v":1,"t":"who-knows"}') !== null) {
      return fail('an unknown message type should not parse')
    }
    if (parseBridgeLine('[MSMS-BRIDGE] {"t":"tick","tps":20}') !== null) {
      return fail('a message with no protocol version should not parse')
    }
    if (parseBridgeLine('the server likes [MSMS-BRIDGE] a lot today') !== null) {
      return fail('a marker with no JSON after it should not parse')
    }
    if (parseBridgeLine('[MSMS-BRIDGE] {"v":1,"t":"tick","mspt":2}') !== null) {
      return fail('a tick with no tps should not parse')
    }
    console.log('BRIDGE-SMOKE: malformed / unknown / versionless rejected, marker still detected')

    // --- players message with positions; a nameless entry is dropped ---
    const players = parseBridgeLine(
      '[MSMS-BRIDGE] {"v":1,"t":"players","online":2,"list":[{"name":"Alex","uuid":"u1","world":"world","dim":"overworld","x":10.5,"y":64,"z":-3.2},{"noname":true}]}'
    )
    if (!players || players.t !== 'players') return fail('a players line did not parse')
    if (players.online !== 2) return fail('the players online count was lost')
    if (players.list.length !== 1) return fail('a nameless player entry was not dropped')
    if (players.list[0].name !== 'Alex' || players.list[0].x !== 10.5) {
      return fail('a player name/position was lost')
    }
    console.log('BRIDGE-SMOKE: players + positions parsed, nameless entry dropped')

    // --- TPS reconciliation: fresh bridge wins, silent bridge falls back ---
    const now = 1_000_000
    const fresh: BridgeSnapshot = {
      connected: true,
      intervalMs: BRIDGE_DEFAULT_INTERVAL_MS,
      lastTs: now - 1000,
      tps: 19.5,
      mspt: 4.0
    }
    const r1 = reconcileTps(fresh, 20, null, now)
    if (!r1.bridge || r1.tps !== 19.5 || r1.mspt !== 4.0) {
      return fail('a fresh bridge reading did not win over RCON')
    }
    // Quiet for longer than STALE_FACTOR intervals → stale → RCON wins, MSPT drops.
    const stale: BridgeSnapshot = {
      ...fresh,
      lastTs: now - BRIDGE_DEFAULT_INTERVAL_MS * (BRIDGE_STALE_FACTOR + 1)
    }
    const r2 = reconcileTps(stale, 20, 19.5, now)
    if (r2.bridge || r2.tps !== 20 || r2.mspt !== null) {
      return fail('a silent bridge did not fall back to the RCON reading')
    }
    // Stale AND no RCON → the last known value is carried, never frozen as "bridge".
    const r3 = reconcileTps(stale, null, 18.0, now)
    if (r3.bridge || r3.tps !== 18.0) {
      return fail('a stale bridge with no RCON did not carry the last value')
    }
    // Never connected → the plain RCON path.
    const r4 = reconcileTps(newBridgeSnapshot(), 20, null, now)
    if (r4.bridge || r4.tps !== 20) return fail('with no bridge the RCON reading should pass through')
    console.log('BRIDGE-SMOKE: fresh wins, silent falls back to RCON, last value carried')

    console.log('BRIDGE-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
    fail('exception ' + String(e))
  }
}

/**
 * Audit trail: the pure filter (the searchable/filterable surface) and the
 * store round-trip incl. age prune (Stage 15). The filter is what an operator
 * leans on to answer "who did X from where", so the discriminating combinations
 * are pinned exactly.
 */
export async function runAuditSmoke(): Promise<void> {
  const fail = (m: string): void => {
    console.log('AUDIT-SMOKE: FAIL -', m)
    app.exit(1)
  }
  try {
    const t0 = 1_700_000_000_000
    let seq = 0
    const E = (o: Partial<AuditEntry> & Pick<AuditEntry, 'ts' | 'source' | 'action' | 'actor'>): AuditEntry => ({
      id: 'e' + seq++,
      ok: true,
      ...o
    })
    const rows: AuditEntry[] = [
      E({ ts: t0 - 6000, source: 'panel', action: 'server.start', actor: 'operator', serverId: 's2' }),
      E({ ts: t0 - 5000, source: 'console', action: 'command.run', actor: 'operator', target: 'say hi', serverId: 's1' }),
      E({ ts: t0 - 4000, source: 'webpanel', action: 'login', actor: 'admin', ip: '192.168.1.10' }),
      E({ ts: t0 - 3000, source: 'webpanel', action: 'login', actor: 'mallory', ip: '10.0.0.5', ok: false }),
      E({ ts: t0 - 2000, source: 'webpanel', action: 'balance.set', actor: 'admin', ip: '192.168.1.10', serverId: 's1', target: 'Steve', detail: 'set to 500' }),
      E({ ts: t0 - 1000, source: 'public', action: 'purchase', actor: 'Steve', ip: '8.8.8.8', serverId: 's1', target: 'VIP Crate' })
    ]

    // newest-first + per-source counts over the whole window
    const allp = filterAudit(rows, {})
    if (allp.total !== 6) return fail('unfiltered total ' + allp.total)
    if (allp.entries[0].action !== 'purchase') return fail('not sorted newest-first: ' + allp.entries[0].action)
    if (allp.bySource.webpanel !== 3 || allp.bySource.console !== 1 || allp.bySource.public !== 1 || allp.bySource.panel !== 1) {
      return fail('bySource wrong: ' + JSON.stringify(allp.bySource))
    }

    // source filter, and source + outcome together (the denied login)
    if (filterAudit(rows, { sources: ['webpanel'] }).total !== 3) return fail('source filter')
    const denied = filterAudit(rows, { sources: ['webpanel'], ok: false })
    if (denied.total !== 1 || denied.entries[0].actor !== 'mallory') return fail('failed-login filter missed')

    // actor is a case-insensitive substring; action is exact
    if (filterAudit(rows, { actor: 'ADMIN' }).total !== 2) return fail('actor substring/case')
    if (filterAudit(rows, { actions: ['login'] }).total !== 2) return fail('action filter')
    if (filterAudit(rows, { ip: '192.168' }).total !== 2) return fail('ip substring')

    // free text spans target + actor (Steve is a target on one row, actor on another)
    if (filterAudit(rows, { text: 'crate' }).total !== 1) return fail('text on target')
    if (filterAudit(rows, { text: 'steve' }).total !== 2) return fail('text across actor+target: ' + filterAudit(rows, { text: 'steve' }).total)
    if (filterAudit(rows, { serverId: 's1' }).total !== 3) return fail('serverId filter')

    // time window narrows both matches AND the bySource counts
    const win = filterAudit(rows, { from: t0 - 4500, to: t0 - 2500 })
    if (win.total !== 2) return fail('time window total ' + win.total)
    if (win.bySource.webpanel !== 2 || win.bySource.console) return fail('window bySource leaked outside range')

    // pagination bounds: offset walks, limit clamps to >=1, over-offset empties
    if (filterAudit(rows, { limit: 2 }).entries.length !== 2) return fail('limit')
    if (filterAudit(rows, { limit: 2, offset: 4 }).entries.length !== 2) return fail('offset window')
    if (filterAudit(rows, { offset: 6 }).entries.length !== 0) return fail('over-offset should be empty')
    const clamp = filterAudit(rows, { limit: 0 })
    if (clamp.entries.length !== 1 || clamp.total !== 6) return fail('limit 0 should clamp to 1 but keep total')
    console.log('AUDIT-SMOKE: filter OK (source+outcome, actor/ip substring, text, window+counts, pagination)')

    // ---- store round-trip incl. age prune (snapshot the real log first) ----
    const af = join(auditDir(), 'audit.jsonl')
    const snap = existsSync(af) ? readFileSync(af, 'utf-8') : null
    try {
      rmSync(af, { force: true })
      auditMod._reset()
      const rn = Date.now()
      auditMod.record({ source: 'console', action: 'command.run', actor: 'operator', target: 'stop', serverId: 's1', ts: rn - 1000 })
      auditMod.record({ source: 'webpanel', action: 'login', actor: 'admin', ip: '1.2.3.4', ok: false, ts: rn - 500 })
      auditMod.record({ source: 'system', action: 'ancient', actor: 'sys', ts: rn - (auditMod.MAX_AGE_DAYS + 1) * 86400_000 })
      let page = auditMod.query({})
      if (page.total !== 3) return fail('store did not read back 3 rows: ' + page.total)
      if (page.entries[0].action !== 'login') return fail('store not newest-first')
      if (page.entries[0].ok !== false) return fail('outcome ok=false did not persist')
      if (auditMod.query({ ok: false }).total !== 1) return fail('store ok filter')
      const removed = auditMod.prune(rn)
      if (removed !== 1) return fail('age prune should drop exactly the ancient row, dropped ' + removed)
      page = auditMod.query({})
      if (page.total !== 2 || page.entries.some((e) => e.action === 'ancient')) return fail('ancient row survived prune')
      console.log('AUDIT-SMOKE: store persists outcome, reads back newest-first, prunes by age')
    } finally {
      if (snap == null) rmSync(af, { force: true })
      else writeFileSync(af, snap, 'utf-8')
    }

    // ---- join / alt-account aggregation (pure, from join records) ----
    const jr: JoinRecord[] = [
      { player: 'Ada', ip: '1.1.1.1', ts: 100, serverId: 's1' },
      { player: 'Ada', ip: '1.1.1.1', ts: 300, serverId: 's1' },
      { player: 'Ada', ip: '2.2.2.2', ts: 200, serverId: 's2' },
      { player: 'Bob', ip: '1.1.1.1', ts: 250, serverId: 's1' }, // shares 1.1.1.1 with Ada -> alt
      { player: 'Carol', ts: 150, serverId: 's1' } // no IP
    ]
    const ja = aggregateJoins(jr)
    if (ja.totalJoins !== 5) return fail('joins total ' + ja.totalJoins)
    if (ja.knownIpJoins !== 4) return fail('joins knownIp ' + ja.knownIpJoins)
    if (ja.accountCount !== 3) return fail('joins accountCount ' + ja.accountCount)
    if (ja.altGroups !== 1) return fail('joins altGroups ' + ja.altGroups)
    if (ja.accounts.map((a) => a.player).join(',') !== 'Ada,Bob,Carol') return fail('accounts not newest-first')
    const ada = ja.accounts[0]
    if (ada.ips.join(',') !== '1.1.1.1,2.2.2.2') return fail('account IPs not recency-ordered: ' + ada.ips.join(','))
    if (ada.joins !== 3 || ada.servers.join(',') !== 's1,s2') return fail('account joins/servers wrong')
    if (ja.ips.length !== 2) return fail('ip table length ' + ja.ips.length)
    if (ja.ips[0].ip !== '1.1.1.1' || ja.ips[0].accounts.join(',') !== 'Ada,Bob' || ja.ips[0].joins !== 3) {
      return fail('shared IP not ranked first / wrong: ' + JSON.stringify(ja.ips[0]))
    }
    // minAccountsPerIp keeps only shared addresses; text matches an IP via its accounts too
    const alts = aggregateJoins(jr, { minAccountsPerIp: 2 })
    if (alts.ips.length !== 1 || alts.ips[0].ip !== '1.1.1.1') return fail('alts-only filter')
    const byName = aggregateJoins(jr, { text: 'bob' })
    if (byName.accounts.length !== 1 || byName.accounts[0].player !== 'Bob') return fail('joins text filter (account)')
    if (byName.ips.length !== 1 || byName.ips[0].ip !== '1.1.1.1') return fail('joins text filter (IP via account)')
    if (byName.altGroups !== 1) return fail('altGroups is a dataset property, must survive filtering')
    console.log('AUDIT-SMOKE: join/alt aggregation OK (by-account, shared-IP ranking, alts-only, text)')

    console.log('AUDIT-SMOKE: PASS')
    app.exit(0)
  } catch (e) {
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

    // --- 5. resolving "auto" - the path the default config takes ----------
    // Empty override must still come back with a real Java (JAVA_HOME/PATH),
    // which is what lets the picker warn a server nobody configured by hand.
    const { detectJava } = await import('./core/java')
    const auto = await detectJava('')
    if (!auto || !auto.major) return fail('resolving auto java returned nothing')
    const direct = await detectJava(installs[0].path)
    if (direct?.major !== installs[0].major) return fail('resolving an explicit path gave the wrong java')
    console.log(`JAVA-SMOKE: auto resolves to Java ${auto.major}, explicit paths honoured`)
    console.log(
      `JAVA-SMOKE: scan OK (${installs.length} install(s): ${installs.map((i) => `${i.major}/${i.source}`).join(', ')})`
    )

    // --- 6. the provision decision: pick a compatible install, or ask ------
    // The pick must respect the era ceiling: newest-is-best hands a 1.12 server
    // Java 21 (risky-new), which is the exact bug this replaces. `provisionPlan`
    // must instead say "install Java 8" even though a 21 is sitting right there.
    type J = { major: number; path: string }
    const fake = (major: number): J => ({ major, path: `/x/j${major}` })

    const only21 = [fake(21)]
    const p112 = provisionPlan(javaRequirement('1.12.2'), only21)
    if (p112.state !== 'needs-install') return fail('1.12 + only Java 21 must need an install')
    if (p112.suggestedMajor !== 8) return fail(`1.12 should suggest Java 8, got ${p112.suggestedMajor}`)
    if (p112.chosen !== null) return fail('1.12 + only Java 21 must not pick anything')
    if (pickJavaFor(javaRequirement('1.12.2'), only21) !== null) {
      return fail('pickJavaFor must reject a risky-new install')
    }

    // Both compatible → the one closest to `recommended` wins (8, not 11).
    const j8 = fake(8)
    const p112ok = provisionPlan(javaRequirement('1.12.2'), [fake(11), j8])
    if (p112ok.state !== 'ok' || p112ok.chosen?.major !== 8) {
      return fail(`1.12 + Java 8&11 should pick 8, got ${p112ok.state}/${p112ok.chosen?.major}`)
    }

    // Modern server, only old Javas → still an install (min not met).
    const p121 = provisionPlan(javaRequirement('1.21'), [fake(8), fake(17)])
    if (p121.state !== 'needs-install' || p121.suggestedMajor !== 21) {
      return fail(`1.21 + Java 8&17 should need Java 21, got ${p121.state}/${p121.suggestedMajor}`)
    }

    // Exact recommended beats a newer-but-also-ok install (17 over 21 for 1.18).
    const p118 = provisionPlan(javaRequirement('1.18'), [fake(21), fake(17)])
    if (p118.state !== 'ok' || p118.chosen?.major !== 17) {
      return fail(`1.18 + Java 17&21 should pick 17, got ${p118.state}/${p118.chosen?.major}`)
    }

    // An unreadable version stays silent — no plan, no nagging.
    if (provisionPlan(javaRequirement('24w14a'), only21).state !== 'unknown') {
      return fail('a snapshot version must yield an unknown plan')
    }
    console.log('JAVA-SMOKE: provision plan OK (ceiling respected, recommended preferred, snapshots silent)')

    // --- 7. Adoptium URL/package shaping (pure; the network fetch is not) ---
    const win = adoptiumTarget('win32', 'x64')
    if (win?.os !== 'windows' || win.arch !== 'x64') return fail('win32/x64 target wrong')
    const macArm = adoptiumTarget('darwin', 'arm64')
    if (macArm?.os !== 'mac' || macArm.arch !== 'aarch64') return fail('darwin/arm64 target wrong')
    const lin = adoptiumTarget('linux', 'x64')
    if (lin?.os !== 'linux' || lin.arch !== 'x64') return fail('linux/x64 target wrong')
    if (adoptiumTarget('freebsd' as NodeJS.Platform, 'x64') !== null) return fail('unknown OS must decline')
    if (adoptiumTarget('win32', 'ia32') !== null) return fail('unknown arch must decline')

    const url = adoptiumAssetsUrl(21, win!)
    for (const seg of ['/assets/latest/21/hotspot?', 'architecture=x64', 'image_type=jre', 'os=windows', 'vendor=eclipse']) {
      if (!url.includes(seg)) return fail(`assets URL missing "${seg}": ${url}`)
    }

    const goodAssets: AdoptiumAsset[] = [
      { release_name: 'jdk-21.0.1+12', binary: { package: { link: 'https://x/j.zip', checksum: 'abc123', name: 'OpenJDK21U-jre_x64_windows_hotspot_21.0.1_12.zip' } } }
    ]
    const pkg = pickAdoptiumPackage(goodAssets)
    if (pkg.link !== 'https://x/j.zip' || pkg.checksum !== 'abc123') return fail('package fields not read')
    if (!isZipPackage(pkg.name)) return fail('a .zip name should be a zip package')
    if (isZipPackage('OpenJDK21U-jre_x64_linux_hotspot_21.0.1_12.tar.gz')) return fail('a .tar.gz must not be a zip')

    let threwEmpty = false
    try {
      pickAdoptiumPackage([])
    } catch {
      threwEmpty = true
    }
    if (!threwEmpty) return fail('an empty assets response must throw, not proceed unverified')

    let threwNoChecksum = false
    try {
      pickAdoptiumPackage([{ binary: { package: { link: 'https://x/j.zip', name: 'j.zip' } } }])
    } catch {
      threwNoChecksum = true
    }
    if (!threwNoChecksum) return fail('a package with no checksum must throw')
    console.log('JAVA-SMOKE: Adoptium shaping OK (os/arch mapped, URL segments, package + checksum guarded)')

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

    // --- 10. export -> import round-trip ------------------------------------
    const zipPath = join(app.getPath('temp'), 'msms-world-export.zip')
    rmSync(zipPath, { force: true })
    worldsMod.exportWorld(SID, 'paper_world', zipPath)
    if (!existsSync(zipPath)) return fail('export wrote no file')
    // The archive keeps on-disk folder names, so a Paper world carries three.
    const exported = new AdmZip(zipPath).getEntries().map((e) => e.entryName.replace(/\\/g, '/'))
    if (!exported.some((n) => n.startsWith('paper_world/'))) return fail('export missing the overworld')
    if (!exported.some((n) => n.startsWith('paper_world_nether/'))) return fail('export missing the nether')

    await worldsMod.importWorld(SID, zipPath, 'imported_world')
    const back = (await worldsMod.listWorlds(SID)).find((w) => w.name === 'imported_world')
    if (!back) return fail('imported world did not appear')
    if (back.dimensions.join('+') !== 'overworld+nether') return fail('import lost a dimension: ' + back.dimensions.join('+'))
    if (back.seed !== '12345') return fail('imported world lost its level.dat')
    if (existsSync(join(root, 'paper_world', 'level.dat')) === false) return fail('export mutated the source')
    // A second import under the same name must refuse, not merge.
    if (!(await refuses('re-importing onto an existing world', () => worldsMod.importWorld(SID, zipPath, 'imported_world'), 'target-exists'))) return
    console.log('WORLDS-SMOKE: export/import round-trips, dimensions and level.dat intact')

    // --- 11. a hostile archive is refused before anything is written --------
    // Hand-crafted, because adm-zip strips `../` from anything it writes - so a
    // real attacker's zip is the only way to exercise the guard.
    const evilZip = join(app.getPath('temp'), 'msms-world-evil.zip')
    writeFileSync(
      evilZip,
      craftZip([
        { name: 'world/level.dat', data: levelDat(1, '1.21', 0, false) },
        // staging is root/.msms-import-*, so ../../ lands above the server root.
        { name: '../../pwned.txt', data: Buffer.from('gotcha') }
      ])
    )
    const escapeTarget = resolve(join(root, '..', 'pwned.txt'))
    rmSync(escapeTarget, { force: true })
    if (!(await refuses('a zip-slip archive', () => worldsMod.importWorld(SID, evilZip, 'evil'), 'unsafe-archive'))) return
    if (existsSync(escapeTarget)) return fail('a zip-slip entry escaped the target')
    if (existsSync(join(root, 'evil'))) return fail('a rejected import still created the world')
    // ...and a zip with no world in it is refused too.
    const emptyZip = join(app.getPath('temp'), 'msms-world-empty.zip')
    const empty = new AdmZip()
    empty.addFile('readme.txt', Buffer.from('not a world'))
    empty.writeZip(emptyZip)
    if (!(await refuses('a zip with no level.dat', () => worldsMod.importWorld(SID, emptyZip, 'nope'), 'not-a-world'))) return
    if (existsSync(join(root, 'nope'))) return fail('a worldless import left a folder behind')
    // No staging directory may survive any of that.
    const strays = readdirSync(root).filter((n) => n.startsWith('.msms-import-'))
    if (strays.length) return fail('an import left staging behind: ' + strays.join(','))
    rmSync(zipPath, { force: true })
    rmSync(evilZip, { force: true })
    rmSync(emptyZip, { force: true })
    console.log('WORLDS-SMOKE: import refuses zip-slip and worldless archives, cleans up after itself')

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
      // Export is the one world action allowed while running - its button must
      // be enabled even though delete/clone/rename are not.
      const exportBtn = JSON.parse(
        await win.webContents.executeJavaScript(
          `(()=>{const b=[...document.querySelectorAll('.world-row .btn.ghost')].find(x=>/Export|Zip/i.test(x.title||''));
           return JSON.stringify({present:!!b,disabled:!!b?.disabled})})()`
        )
      ) as { present: boolean; disabled: boolean }
      if (!exportBtn.present) return fail('the export button did not render')
      console.log(`SMOKE: worlds view OK (${wv.rows} world(s), "${wv.name}", delete disabled, export present)`)

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

        // The default config uses javaPath='' (auto). Its verdict must appear
        // WITHOUT selecting anything - this is the case that catches a server
        // nobody configured, and the one the first cut of this feature missed.
        const { detectJava } = await import('./core/java')
        const autoJava = await detectJava('')
        const autoWant = autoJava
          ? checkJava(mc, autoJava.major).verdict
          : 'unknown'
        const autoCls = JSON.parse(
          await win.webContents.executeJavaScript(
            `(()=>{const c=document.querySelector('.java-compat');
             return JSON.stringify({cls:c?c.className.replace('java-compat ',''):'',text:(c?.textContent||'').trim().slice(0,80)})})()`
          )
        ) as { cls: string; text: string }
        const autoExpectCls =
          autoWant === 'too-old' ? 'bad' : autoWant === 'risky-new' ? 'warn' : autoWant === 'ok' ? 'ok' : ''
        if (autoCls.cls !== autoExpectCls) {
          return fail(`auto java (${autoJava?.major}) on MC ${mc}: UI "${autoCls.cls}", table "${autoExpectCls}"`)
        }
        if (autoExpectCls && !/auto|otomatik/i.test(autoCls.text)) {
          return fail('auto verdict did not say it was auto-detected: ' + autoCls.text)
        }
        console.log(`SMOKE: java auto-verdict OK (auto -> Java ${autoJava?.major}, ${autoExpectCls || 'no verdict'})`)

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

  // The update-check control must render on the Plugins tab. Seed a jar so the
  // button is enabled, assert it is there, then remove it - no network here
  // (the diff itself is covered by MODUPDATE-SMOKE).
  {
    const serverPath = getConfig().servers.find((s) => s.id === id)?.path ?? ''
    const pluginsDir = join(serverPath, 'plugins')
    mkdirSync(pluginsDir, { recursive: true })
    const fakeJar = join(pluginsDir, 'SmokePlugin.jar')
    writeFileSync(fakeJar, Buffer.from('PK not really a jar'))
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.tab')].find(t=>/Plugins|Mods|Eklenti/i.test(t.textContent||''))?.click()`
    )
    await sleep(600)
    const mv = JSON.parse(
      await win.webContents.executeJavaScript(
        `(()=>{const btn=[...document.querySelectorAll('.btn')].find(b=>/Check for updates|Güncellemeleri denetle/i.test(b.textContent||''));
         const rows=[...document.querySelectorAll('.mod-row')].map(r=>(r.querySelector('.mod-name')?.textContent||'').trim());
         return JSON.stringify({checkBtn:!!btn,disabled:!!btn?.disabled,rows})})()`
      )
    ) as { checkBtn: boolean; disabled: boolean; rows: string[] }
    if (!mv.checkBtn) return fail('the check-for-updates button did not render')
    if (mv.disabled) return fail('check-for-updates was disabled with a plugin present')
    if (!mv.rows.some((r) => /SmokePlugin/.test(r))) return fail('the seeded plugin did not list')
    rmSync(fakeJar, { force: true })
    console.log('SMOKE: mods update control OK (button enabled with a plugin present)')
  }

  // ---- audit view (Stage 15 slice 4): the global audit log renders in the UI ----
  {
    const af = join(auditDir(), 'audit.jsonl')
    const asnap = existsSync(af) ? readFileSync(af, 'utf-8') : null
    try {
      rmSync(af, { force: true })
      auditMod._reset()
      auditMod.record({ source: 'panel', action: 'server.start', actor: 'operator', serverId: 'smoke-srv' })
      auditMod.record({ source: 'webpanel', action: 'login', actor: 'smokeadmin', ok: false, ip: '203.0.113.7' })
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.sidebar-foot .btn')].find(b=>/Audit|Denetim/i.test(b.textContent||''))?.click()`
      )
      await sleep(700)
      const av = JSON.parse(
        await win.webContents.executeJavaScript(
          `(()=>{const rows=[...document.querySelectorAll('.audit-table tbody tr')];
           const txt=document.querySelector('.audit-table')?.textContent||'';
           return JSON.stringify({rows:rows.length,hasTable:!!document.querySelector('.audit-table'),
             title:(document.querySelector('.section-title')?.textContent||'').trim(),
             hasOperator:/operator/.test(txt),hasFailIp:txt.indexOf('203.0.113.7')>=0})})()`
        )
      ) as { rows: number; hasTable: boolean; title: string; hasOperator: boolean; hasFailIp: boolean }
      if (!av.hasTable) return fail('audit view did not render its table')
      if (av.rows < 2) return fail('audit view showed ' + av.rows + ' row(s), expected 2')
      if (!av.hasOperator || !av.hasFailIp) return fail('audit rows missing actor/IP content')
      if (/audit\.|auditAct\.|\{\{/.test(av.title)) return fail('audit view not translated: ' + av.title)
      console.log('SMOKE: audit view OK (table renders — actor, source badge, denied login + IP)')

      // Joins & alts mode: two accounts sharing one IP must flag as an alt cluster.
      const jn = Date.now()
      eventsMod.record(id, 'player.join', { ts: jn - 4000, data: { player: 'Ada', online: 1, ip: '9.9.9.9' } })
      eventsMod.record(id, 'player.join', { ts: jn - 3000, data: { player: 'Ada', online: 1, ip: '9.9.9.9' } })
      eventsMod.record(id, 'player.join', { ts: jn - 2000, data: { player: 'Bob', online: 2, ip: '9.9.9.9' } })
      await win.webContents.executeJavaScript(
        `[...document.querySelectorAll('.section-title .btn')].find(b=>/Joins|Giriş/i.test(b.textContent||''))?.click()`
      )
      await sleep(700)
      const jv = JSON.parse(
        await win.webContents.executeJavaScript(
          `(()=>{const txt=[...document.querySelectorAll('.joins-table')].map(x=>x.textContent||'').join(' ');
           return JSON.stringify({has:!!document.querySelector('.joins-table'),
             alt:!!document.querySelector('.joins-table tr.joins-alt'),
             ip:txt.indexOf('9.9.9.9')>=0,ada:/Ada/.test(txt),bob:/Bob/.test(txt)})})()`
        )
      ) as { has: boolean; alt: boolean; ip: boolean; ada: boolean; bob: boolean }
      if (!jv.has) return fail('joins table did not render')
      if (!jv.ip || !jv.ada || !jv.bob) return fail('joins table missing shared IP / accounts')
      if (!jv.alt) return fail('shared IP not flagged as an alt cluster')
      console.log('SMOKE: audit joins view OK (shared IP flags Ada+Bob as alts)')
    } finally {
      if (asnap == null) rmSync(af, { force: true })
      else writeFileSync(af, asnap, 'utf-8')
    }
  }

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

  // 3. Forge/NeoForge run-jar fallback for pre-1.17 (the installer itself needs
  //    a real JDK, so exercise the pure jar-vs-args decision instead). #42
  {
    const inst12 = 'forge-1.12.2-14.23.5.2860-installer.jar'
    const pick12 = pickForgeRunJar(
      [inst12, 'forge-1.12.2-14.23.5.2860-universal.jar', 'minecraft_server.1.12.2.jar'],
      inst12,
      'forge'
    )
    if (pick12 !== 'forge-1.12.2-14.23.5.2860-universal.jar') {
      return fail('pre-1.12 forge should pick the universal jar, got ' + pick12)
    }
    const inst16 = 'forge-1.16.5-36.2.39-installer.jar'
    const pick16 = pickForgeRunJar([inst16, 'forge-1.16.5-36.2.39.jar'], inst16, 'forge')
    if (pick16 !== 'forge-1.16.5-36.2.39.jar') {
      return fail('1.16 forge should pick the loader run jar, got ' + pick16)
    }
    // 1.17+ leaves only the installer (it uses @args) -> no run jar to fall back to.
    const inst20 = 'forge-1.20.1-47.2.0-installer.jar'
    if (pickForgeRunJar([inst20], inst20, 'forge') !== null) {
      return fail('1.17+ forge (installer only) should yield no run jar')
    }
    // Never pick the installer itself, and never a plain vanilla server jar.
    if (pickForgeRunJar([inst12, 'minecraft_server.1.12.2.jar'], inst12, 'forge') !== null) {
      return fail('forge fallback must not pick the installer or a vanilla server jar')
    }
    // NeoForge keyword is honoured (defensive; NeoForge is always 1.20.1+).
    const instNeo = 'neoforge-20.4.100-installer.jar'
    if (
      pickForgeRunJar([instNeo, 'neoforge-20.4.100-universal.jar'], instNeo, 'neoforge') !==
      'neoforge-20.4.100-universal.jar'
    ) {
      return fail('neoforge fallback should pick the neoforge universal jar')
    }
    console.log('WIZARD-SMOKE: forge run-jar fallback OK (universal/loader/none, installer excluded)')
  }

  // 4. net.ts empty-download guard: a reachable 200 with a 0-byte body must fail
  //    as `empty-download`, not as a baffling checksum mismatch against the hash
  //    of empty input (the confusing Mohist symptom in #43). #43
  {
    const srv = httpCreateServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/java-archive' })
      res.end() // zero bytes, chunked (no content-length) so fetch still yields a body
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
    const addr = srv.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const dest = join(app.getPath('temp'), 'msms-empty-dl-test.jar')
    let msg = ''
    try {
      await downloadFile(`http://127.0.0.1:${port}/x.jar`, dest, {
        sha256: '5ad74546004d0e5b9a5b0f6f8e2b1c3d4e5f60718293a4b5c6d7e8f9011223344'
      })
    } catch (e) {
      msg = String((e as Error)?.message ?? e)
    }
    srv.close()
    try {
      rmSync(dest, { force: true })
    } catch {
      /* ignore */
    }
    if (!msg.includes('empty-download')) {
      return fail('0-byte download should throw empty-download, got: ' + (msg || '(no error)'))
    }
    if (/checksum mismatch/i.test(msg)) {
      return fail('0-byte download surfaced as a checksum mismatch instead of empty-download')
    }
    if (existsSync(dest)) return fail('empty-download must not leave a partial file behind')
    console.log('WIZARD-SMOKE: empty-download guard OK (0-byte body fails clearly, no checksum confusion, dest removed)')
  }

  // 5. Error legibility (#44): every raw code the creation path can throw must
  //    map to a non-raw wizard.* message; a genuinely-unknown string must still
  //    pass through. Pure + deterministic (no network).
  {
    const codes = [
      'no-build',
      'no-download',
      'no-server-jar-for-version',
      'unknown-version',
      'no-forge-build',
      'no-neoforge-build',
      'no-mohist-build',
      'empty-download: http://x/y.jar returned 0 bytes',
      'Checksum mismatch (got ab…, expected cd…)',
      'HTTP 404 for http://x/y.jar',
      'installer exited 1: boom',
      'installer-args-not-found',
      'folder-exists',
      'no-provider-for-banana'
    ]
    const unmapped = codes.filter((c) => createErrorKey(c) === null)
    if (unmapped.length) return fail('create error codes not mapped to a message: ' + unmapped.join(', '))
    if (createErrorKey('some novel unexpected failure') !== null) {
      return fail('createErrorKey must pass unknown strings through (null), not swallow them')
    }
    console.log(`WIZARD-SMOKE: create-error legibility OK (${codes.length} codes mapped, unknown passes through)`)
  }

  // 6. Provider matrix walk (#44, inspection): resolving a bogus version per
  //    provider must never yield a MALFORMED descriptor (that would fail
  //    illegibly). Throws are expected and tolerated — network-dependent — but
  //    logged with whether the code maps, so gaps surface without flakiness.
  {
    for (const type of CREATABLE_TYPES) {
      try {
        const r = await getProvider(type).resolve('0.0.0-nope')
        if (!/^https?:\/\/.+/.test(r.url) || !r.fileName) {
          return fail(`${type}: bogus version resolved to a malformed descriptor: ${JSON.stringify(r)}`)
        }
        console.log(`WIZARD-SMOKE: matrix ${type} bogus -> deferred (${r.url.slice(0, 52)}…)`)
      } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        console.log(`WIZARD-SMOKE: matrix ${type} bogus -> throw [${createErrorKey(msg) ? 'mapped' : 'RAW'}] ${msg.slice(0, 64)}`)
      }
    }
    console.log('WIZARD-SMOKE: provider matrix walked (bogus-version legibility inspected)')
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

    // ---- audit attribution (Stage 15 slice 2): web actions leave a trail ----
    {
      const af = join(auditDir(), 'audit.jsonl')
      const snap = existsSync(af) ? readFileSync(af, 'utf-8') : null
      try {
        rmSync(af, { force: true })
        auditMod._reset()
        await post('/api/login', { username: 'owner_t', password: 'nope' }) // 401
        await post('/api/login', { username: 'owner_t', password: 'ownerpass' }) // 200
        const logins = auditMod.query({ sources: ['webpanel'], actions: ['login'] })
        const okE = logins.entries.find((e) => e.ok)
        const failE = logins.entries.find((e) => !e.ok)
        if (!okE || okE.actor !== 'owner_t') return fail('a successful web login was not audited with its actor')
        if (!okE.ip) return fail('a web audit entry carries no source IP')
        if (!failE || failE.actor !== 'owner_t') return fail('a denied web login was not audited (who tried is the point)')
        if (failE.ok !== false) return fail('a denied login was audited as ok')
        console.log('WEB-SMOKE: web-panel login audited — success + denied, with actor + IP')
      } finally {
        if (snap == null) rmSync(af, { force: true })
        else writeFileSync(af, snap, 'utf-8')
      }
    }

    // ---- audit log over HTTP (#7): owner-only, filterable ----
    {
      const af = join(auditDir(), 'audit.jsonl')
      const snap = existsSync(af) ? readFileSync(af, 'utf-8') : null
      try {
        rmSync(af, { force: true })
        auditMod._reset()
        const bt = Date.now()
        auditMod.record({ source: 'webpanel', action: 'login', actor: 'owner_t', ok: true, ip: '198.51.100.9', ts: bt - 4000 })
        auditMod.record({ source: 'webpanel', action: 'login', actor: 'mallory', ok: false, ip: '198.51.100.9', ts: bt - 3000 })
        auditMod.record({ source: 'console', action: 'command.run', actor: 'operator', target: 'stop', serverId: id, ts: bt - 2000 })
        auditMod.record({ source: 'public', action: 'purchase', actor: 'Steve', ok: true, ip: '203.0.113.4', target: 'VIP', ts: bt - 1000 })

        // gate: no token -> 401, non-owner -> 403 (entries carry player IPs)
        let ra = await get('/api/audit')
        if (ra.status !== 401) return fail('no-token audit expected 401, got ' + ra.status)
        ra = await get('/api/audit', ft)
        if (ra.status !== 403) return fail('non-owner audit expected 403, got ' + ra.status)

        // owner sees the whole log, newest-first, with per-source counts
        ra = await get('/api/audit', ot)
        if (ra.status !== 200) return fail('owner audit expected 200, got ' + ra.status)
        const pg = (await ra.json()) as {
          entries: { action: string; actor: string }[]
          total: number
          bySource: Record<string, number>
        }
        if (pg.total !== 4) return fail('audit endpoint total ' + pg.total)
        if (pg.entries[0].action !== 'purchase') return fail('audit endpoint not newest-first')
        if (pg.bySource.webpanel !== 2 || pg.bySource.console !== 1 || pg.bySource.public !== 1) {
          return fail('audit endpoint bySource wrong: ' + JSON.stringify(pg.bySource))
        }

        // filters ride the query string
        ra = await get('/api/audit?sources=public&text=vip', ot)
        const f1 = (await ra.json()) as { total: number; entries: { actor: string }[] }
        if (f1.total !== 1 || f1.entries[0].actor !== 'Steve') return fail('audit endpoint source+text filter')
        ra = await get('/api/audit?ok=false', ot)
        const f2 = (await ra.json()) as { total: number; entries: { actor: string }[] }
        if (f2.total !== 1 || f2.entries[0].actor !== 'mallory') return fail('audit endpoint ok=false filter')
        console.log('WEB-SMOKE: audit log over HTTP OK (owner 200 newest-first + filters, non-owner 403, no-token 401)')
      } finally {
        if (snap == null) rmSync(af, { force: true })
        else writeFileSync(af, snap, 'utf-8')
      }
    }

    // ---- audit as a grantable account-level permission (#45) ----
    // A dedicated user so we never flip friend_t's state under the other tests.
    {
      const auditor = webAuth.createUser('auditor_t', 'auditorpass', 'user', {})
      const rl = await post('/api/login', { username: 'auditor_t', password: 'auditorpass' })
      const at = ((await rl.json()) as { token: string }).token
      let ra = await get('/api/audit', at)
      if (ra.status !== 403) return fail('non-owner without canAudit expected 403, got ' + ra.status)
      // grant -> reflected on the next request (resolveSession rebuilds from the store)
      webAuth.setUserAudit(auditor.id, true)
      ra = await get('/api/audit', at)
      if (ra.status !== 200) return fail('granted canAudit expected 200, got ' + ra.status)
      // /api/me carries the flag so the panel can reveal the Audit tab
      ra = await get('/api/me', at)
      const me = (await ra.json()) as { canAudit?: boolean }
      if (me.canAudit !== true) return fail('/api/me should report canAudit=true, got ' + JSON.stringify(me))
      // revoke -> back to 403
      webAuth.setUserAudit(auditor.id, false)
      ra = await get('/api/audit', at)
      if (ra.status !== 403) return fail('revoked canAudit expected 403, got ' + ra.status)
      webAuth.deleteUser(auditor.id)
      console.log('WEB-SMOKE: audit grant OK (non-owner 403 → granted 200 + /api/me flag → revoked 403)')
    }

    // ---- panel image upload (raw bytes, validated, settings-gated) ----
    {
      // a real 1x1 PNG so saveImageBuffer's checks run against genuine bytes
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        'base64'
      )
      const upload = (mime: string, body: Uint8Array, tok?: string): Promise<Response> =>
        fetch(base + '/api/site/upload', {
          method: 'POST',
          headers: { 'Content-Type': mime, ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
          body
        })
      let ru = await upload('image/png', png)
      if (ru.status !== 401) return fail('upload no-token expected 401, got ' + ru.status)
      ru = await upload('image/png', png, ft)
      if (ru.status !== 403) return fail('upload non-settings expected 403, got ' + ru.status)
      ru = await upload('image/svg+xml', png, ot)
      if (ru.status !== 415) return fail('upload svg (stored-XSS type) expected 415, got ' + ru.status)
      ru = await upload('image/png', new Uint8Array(siteMod.MAX_UPLOAD + 1), ot)
      if (ru.status !== 413) return fail('upload oversized expected 413, got ' + ru.status)
      ru = await upload('image/png', png, ot)
      if (ru.status !== 200) return fail('upload valid expected 200, got ' + ru.status)
      const un = ((await ru.json()) as { name: string }).name
      if (!un || !un.endsWith('.png')) return fail('upload returned no .png name: ' + un)
      if (!siteMod.listUploads().includes(un)) return fail('uploaded file not listed in uploads')
      siteMod.deleteUpload(un)
      console.log('WEB-SMOKE: panel image upload OK (401/403/415/413 guarded; valid 200 lands in uploads)')
    }

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

    // ---- store config admin surface (products + currency), driven by the panel Manage tab ----
    // These are the exact endpoints the new store-config UI calls; verify scope + round-trip.
    r = await get('/api/servers/' + id + '/store/admin', ft)
    if (r.status !== 403) return fail('non-store GET store/admin expected 403, got ' + r.status)
    r = await get('/api/servers/' + id + '/store/admin', ot)
    if (r.status !== 200) return fail('store GET store/admin expected 200, got ' + r.status)
    const cfg = (await r.json()) as {
      currency: string
      products: Product[]
      balances: Record<string, number>
    }
    if (typeof cfg.currency !== 'string' || !Array.isArray(cfg.products) || !cfg.balances) {
      return fail('store/admin config missing currency/products/balances')
    }
    // currency edit is store-scope only
    const curUrl = '/api/servers/' + id + '/store/admin/currency'
    r = await post(curUrl, { currency: 'Gems' }, ft)
    if (r.status !== 403) return fail('non-store set currency expected 403, got ' + r.status)
    r = await post(curUrl, { currency: 'Gems' }, ot)
    if (r.status !== 200) return fail('set currency expected 200, got ' + r.status)
    if (economy.publicStore(id).currency !== 'Gems') return fail('currency not persisted')
    economy.setCurrency(id, cfg.currency) // restore
    // upsert a crate product over HTTP; the weighted reward pool must round-trip
    const crate = {
      id: '',
      type: 'crate',
      name: 'PanelCrate',
      description: 'via panel',
      price: 40,
      commands: [],
      rewards: [{ name: 'Rare', weight: 25, commands: ['give {player} minecraft:diamond 1'] }]
    } as Product
    r = await post('/api/servers/' + id + '/store/admin/product', crate, ft)
    if (r.status !== 403) return fail('non-store upsert product expected 403, got ' + r.status)
    r = await post('/api/servers/' + id + '/store/admin/product', crate, ot)
    if (r.status !== 200) return fail('upsert product expected 200, got ' + r.status)
    const saved = (await r.json()) as Product
    if (!saved.id) return fail('upserted product has no id')
    if (saved.type !== 'crate' || saved.rewards.length !== 1 || saved.rewards[0].name !== 'Rare') {
      return fail('crate rewards did not round-trip: ' + JSON.stringify(saved.rewards))
    }
    if (!economy.getStoreConfig(id).products.some((p) => p.id === saved.id)) {
      return fail('upserted product not in config')
    }
    // delete is store-scope only
    const delUrl = '/api/servers/' + id + '/store/admin/delete'
    r = await post(delUrl, { productId: saved.id }, ft)
    if (r.status !== 403) return fail('non-store delete product expected 403, got ' + r.status)
    r = await post(delUrl, { productId: saved.id }, ot)
    if (r.status !== 200) return fail('delete product expected 200, got ' + r.status)
    if (economy.getStoreConfig(id).products.some((p) => p.id === saved.id)) {
      return fail('product not deleted')
    }
    console.log(
      'WEB-SMOKE: store config admin OK (GET config, currency, crate upsert round-trip, delete; 403 for non-store)'
    )

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

    // ---- site server IP (Stage 14): trimmed, capped, served to the site ----
    {
      const originalIp = siteMod.getSiteConfig().serverIp
      siteMod.setSiteConfig({ serverIp: '  play.example.com  ' })
      if (siteMod.getSiteConfig().serverIp !== 'play.example.com') {
        return fail('server IP was not trimmed on save: ' + JSON.stringify(siteMod.getSiteConfig().serverIp))
      }
      siteMod.setSiteConfig({ serverIp: 'x'.repeat(200) })
      if (siteMod.getSiteConfig().serverIp.length !== 120) return fail('server IP was not capped at 120')
      siteMod.setSiteConfig({ serverIp: 'mc.demo.net:25566' })
      sres = await sget('/api/public/site')
      if (((await sres.json()) as { serverIp?: string }).serverIp !== 'mc.demo.net:25566') {
        return fail('server IP was not served to the public site')
      }
      siteMod.setSiteConfig({ serverIp: originalIp })
      console.log('WEB-SMOKE: site server IP trims, caps, and reaches the public payload')
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
