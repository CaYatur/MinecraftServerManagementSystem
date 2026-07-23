/**
 * Telemetry store — the foundation every history/analytics feature builds on.
 *
 * Design notes
 * ------------
 * - Storage is plain CSV, one file per server per resolution, under
 *   `msms-data/metrics/<serverId>/<res>.csv`. No native module (the portable
 *   build cannot rely on node-gyp), trivially inspectable, and a day of 10s
 *   data is well under a megabyte.
 * - The three resolutions are filled INDEPENDENTLY from the same raw samples,
 *   not cascaded. Averages stay a plain sum/count and pruning one tier can
 *   never distort another.
 * - Every entry point takes an explicit timestamp, so a test can replay hours
 *   of history in milliseconds.
 *
 * `rss` is the server process' resident memory as reported by pidusage - it is
 * NOT the JVM heap, and `rssMax` is the peak RSS inside the bucket, not -Xmx.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { metricsDir } from '../paths'
import { getConfig } from '../config'
import { log } from '../logger'
import type {
  MetricPoint,
  MetricResolution,
  MetricSeries,
  MetricSummary,
  TelemetryConfig
} from '@shared/types'

export type { TelemetryConfig, MetricPoint, MetricSummary, MetricSeries }

export type Resolution = MetricResolution

export const RESOLUTIONS: Resolution[] = ['10s', '1m', '1h']

export const BUCKET_MS: Record<Resolution, number> = {
  '10s': 10_000,
  '1m': 60_000,
  '1h': 3_600_000
}

/** One reading taken from a running server. */
export interface MetricSample {
  /** Ticks per second, or null when RCON has not reported one yet. */
  tps: number | null
  /** Whole-CPU percentage (already normalized by core count). */
  cpu: number
  /** Resident memory of the server process, MB. */
  rssMB: number
  /** Players online at that moment. */
  players: number
}

export const DEFAULT_TELEMETRY: TelemetryConfig = {
  enabled: true,
  rawHours: 24,
  minuteDays: 14,
  hourDays: 365
}

export function telemetryConfig(): TelemetryConfig {
  return { ...DEFAULT_TELEMETRY, ...(getConfig().telemetry ?? {}) }
}

const HEADER = '#msms-metrics/1 ts,n,tps,tpsMin,cpu,cpuMax,rss,rssMax,players,playersMax'

// ---------------------------------------------------------------- accumulate

interface Bucket {
  start: number
  n: number
  tpsSum: number
  tpsN: number
  tpsMin: number
  cpuSum: number
  cpuMax: number
  rssSum: number
  rssMax: number
  plSum: number
  plMax: number
}

/** serverId -> resolution -> open bucket */
const open = new Map<string, Map<Resolution, Bucket>>()

function newBucket(start: number): Bucket {
  return {
    start,
    n: 0,
    tpsSum: 0,
    tpsN: 0,
    tpsMin: Infinity,
    cpuSum: 0,
    cpuMax: 0,
    rssSum: 0,
    rssMax: 0,
    plSum: 0,
    plMax: 0
  }
}

function add(b: Bucket, s: MetricSample): void {
  b.n++
  if (s.tps != null && Number.isFinite(s.tps)) {
    b.tpsSum += s.tps
    b.tpsN++
    if (s.tps < b.tpsMin) b.tpsMin = s.tps
  }
  b.cpuSum += s.cpu
  if (s.cpu > b.cpuMax) b.cpuMax = s.cpu
  b.rssSum += s.rssMB
  if (s.rssMB > b.rssMax) b.rssMax = s.rssMB
  b.plSum += s.players
  if (s.players > b.plMax) b.plMax = s.players
}

const r1 = (v: number): number => Math.round(v * 10) / 10

function toPoint(b: Bucket): MetricPoint {
  return {
    ts: b.start,
    n: b.n,
    tps: b.tpsN ? r1(b.tpsSum / b.tpsN) : null,
    tpsMin: b.tpsN ? r1(b.tpsMin) : null,
    cpu: r1(b.cpuSum / b.n),
    cpuMax: r1(b.cpuMax),
    rss: Math.round(b.rssSum / b.n),
    rssMax: Math.round(b.rssMax),
    players: r1(b.plSum / b.n),
    playersMax: b.plMax
  }
}

// --------------------------------------------------------------------- files

/** Server ids come from our own registry, but never trust one with a path. */
function safeId(serverId: string): string {
  const s = serverId.replace(/[^A-Za-z0-9._-]/g, '_')
  return s.slice(0, 80) || 'unknown'
}

/** Folder holding one server's series files. */
export function metricsDirFor(serverId: string): string {
  const dir = join(metricsDir(), safeId(serverId))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function seriesPath(serverId: string, res: Resolution): string {
  return join(metricsDirFor(serverId), `${res}.csv`)
}

function fmt(v: number | null): string {
  return v == null ? '' : String(v)
}

function encode(p: MetricPoint): string {
  return [
    p.ts,
    p.n,
    fmt(p.tps),
    fmt(p.tpsMin),
    p.cpu,
    p.cpuMax,
    p.rss,
    p.rssMax,
    p.players,
    p.playersMax
  ].join(',')
}

function decode(line: string): MetricPoint | null {
  const c = line.split(',')
  if (c.length < 10) return null
  const ts = Number(c[0])
  if (!Number.isFinite(ts)) return null
  const num = (s: string): number => (s === '' ? 0 : Number(s) || 0)
  const opt = (s: string): number | null => (s === '' ? null : Number(s))
  return {
    ts,
    n: num(c[1]),
    tps: opt(c[2]),
    tpsMin: opt(c[3]),
    cpu: num(c[4]),
    cpuMax: num(c[5]),
    rss: num(c[6]),
    rssMax: num(c[7]),
    players: num(c[8]),
    playersMax: num(c[9])
  }
}

function appendPoint(serverId: string, res: Resolution, p: MetricPoint): void {
  const file = seriesPath(serverId, res)
  try {
    if (!existsSync(file)) writeFileSync(file, HEADER + '\n', 'utf-8')
    appendFileSync(file, encode(p) + '\n', 'utf-8')
  } catch (err) {
    log.warn('metrics append failed:', err)
  }
}

function readPoints(serverId: string, res: Resolution): MetricPoint[] {
  const file = seriesPath(serverId, res)
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf-8')
  } catch {
    return []
  }
  const out: MetricPoint[] = []
  for (const line of raw.split('\n')) {
    if (!line || line.charCodeAt(0) === 35 /* # */) continue
    const p = decode(line)
    if (p) out.push(p)
  }
  return out
}

function writePoints(serverId: string, res: Resolution, points: MetricPoint[]): void {
  const file = seriesPath(serverId, res)
  const tmp = file + '.tmp'
  try {
    writeFileSync(tmp, HEADER + '\n' + points.map(encode).join('\n') + (points.length ? '\n' : ''), 'utf-8')
    renameSync(tmp, file)
  } catch (err) {
    log.warn('metrics rewrite failed:', err)
  }
}

// ------------------------------------------------------------------ recording

/**
 * Feed one reading. `ts` is explicit so history can be replayed in tests.
 * Rows are written when a bucket boundary is crossed; call `flushServer` when
 * a server stops so the open buckets are not lost.
 */
export function record(serverId: string, sample: MetricSample, ts: number = Date.now()): void {
  if (!telemetryConfig().enabled) return
  let perRes = open.get(serverId)
  if (!perRes) {
    perRes = new Map()
    open.set(serverId, perRes)
  }
  for (const res of RESOLUTIONS) {
    const size = BUCKET_MS[res]
    const start = Math.floor(ts / size) * size
    const cur = perRes.get(res)
    if (cur && cur.start !== start) {
      if (cur.n) appendPoint(serverId, res, toPoint(cur))
      perRes.set(res, newBucket(start))
    } else if (!cur) {
      perRes.set(res, newBucket(start))
    }
    add(perRes.get(res)!, sample)
  }
}

/** Persist whatever is buffered for one server (call on stop). */
export function flushServer(serverId: string): void {
  const perRes = open.get(serverId)
  if (!perRes) return
  for (const res of RESOLUTIONS) {
    const b = perRes.get(res)
    if (b && b.n) appendPoint(serverId, res, toPoint(b))
  }
  open.delete(serverId)
}

/** Persist every open bucket (call on quit). */
export function flushAll(): void {
  for (const id of [...open.keys()]) flushServer(id)
}

// -------------------------------------------------------------------- query

/** Coarsest resolution that keeps a range readable without loading everything. */
export function autoResolution(from: number, to: number): Resolution {
  const span = Math.max(0, to - from)
  if (span <= 6 * 3600_000) return '10s'
  if (span <= 14 * 86400_000) return '1m'
  return '1h'
}

function summarize(points: MetricPoint[]): MetricSummary {
  const s: MetricSummary = {
    points: points.length,
    from: points.length ? points[0].ts : 0,
    to: points.length ? points[points.length - 1].ts : 0,
    tpsAvg: null,
    tpsMin: null,
    cpuAvg: 0,
    cpuMax: 0,
    rssAvg: 0,
    rssMax: 0,
    playersAvg: 0,
    playersMax: 0,
    samples: 0
  }
  if (!points.length) return s
  let tpsSum = 0
  let tpsW = 0
  let cpuSum = 0
  let rssSum = 0
  let plSum = 0
  let w = 0
  for (const p of points) {
    // Weight by sample count so a partial bucket does not count as a full one.
    const n = Math.max(1, p.n)
    w += n
    cpuSum += p.cpu * n
    rssSum += p.rss * n
    plSum += p.players * n
    if (p.cpuMax > s.cpuMax) s.cpuMax = p.cpuMax
    if (p.rssMax > s.rssMax) s.rssMax = p.rssMax
    if (p.playersMax > s.playersMax) s.playersMax = p.playersMax
    if (p.tps != null) {
      tpsSum += p.tps * n
      tpsW += n
    }
    if (p.tpsMin != null && (s.tpsMin == null || p.tpsMin < s.tpsMin)) s.tpsMin = r1(p.tpsMin)
  }
  s.samples = w
  s.cpuAvg = r1(cpuSum / w)
  s.rssAvg = Math.round(rssSum / w)
  s.playersAvg = r1(plSum / w)
  s.tpsAvg = tpsW ? r1(tpsSum / tpsW) : null
  return s
}

export interface QueryOptions {
  from: number
  to: number
  resolution?: Resolution
  /** Cap the number of returned rows (newest kept). */
  limit?: number
}

export function query(serverId: string, opts: QueryOptions): MetricSeries {
  const from = Math.min(opts.from, opts.to)
  const to = Math.max(opts.from, opts.to)
  const resolution =
    opts.resolution && RESOLUTIONS.includes(opts.resolution)
      ? opts.resolution
      : autoResolution(from, to)
  // Include buckets still open in memory so "now" is never a gap.
  const buffered: MetricPoint[] = []
  const b = open.get(serverId)?.get(resolution)
  if (b && b.n) buffered.push(toPoint(b))
  let points = [...readPoints(serverId, resolution), ...buffered]
    .filter((p) => p.ts >= from && p.ts <= to)
    .sort((a, z) => a.ts - z.ts)
  if (opts.limit && points.length > opts.limit) points = points.slice(points.length - opts.limit)
  return { serverId, resolution, from, to, points, summary: summarize(points) }
}

// ---------------------------------------------------------------- retention

export function retentionMs(res: Resolution, cfg: TelemetryConfig = telemetryConfig()): number {
  if (res === '10s') return Math.max(1, cfg.rawHours) * 3600_000
  if (res === '1m') return Math.max(1, cfg.minuteDays) * 86400_000
  return Math.max(1, cfg.hourDays) * 86400_000
}

/** Drop rows past their tier's retention. Returns how many rows were removed. */
export function prune(serverId: string, now: number = Date.now()): number {
  const cfg = telemetryConfig()
  let removed = 0
  for (const res of RESOLUTIONS) {
    const file = seriesPath(serverId, res)
    if (!existsSync(file)) continue
    const points = readPoints(serverId, res)
    const cutoff = now - retentionMs(res, cfg)
    const kept = points.filter((p) => p.ts >= cutoff)
    if (kept.length !== points.length) {
      removed += points.length - kept.length
      writePoints(serverId, res, kept)
    }
  }
  return removed
}

export function pruneAll(now: number = Date.now()): number {
  let removed = 0
  for (const s of getConfig().servers) removed += prune(s.id, now)
  return removed
}

/** Forget a server's history entirely (called when it is removed from MSMS). */
export function dropServer(serverId: string): void {
  open.delete(serverId)
  try {
    rmSync(metricsDirFor(serverId), { recursive: true, force: true })
  } catch (err) {
    log.warn('metrics cleanup failed:', err)
  }
}

/** Delete folders belonging to servers that are no longer registered. */
export function pruneOrphans(): number {
  const known = new Set(getConfig().servers.map((s) => safeId(s.id)))
  let dropped = 0
  let entries: string[]
  try {
    entries = readdirSync(metricsDir())
  } catch {
    return 0
  }
  for (const name of entries) {
    if (known.has(name)) continue
    try {
      rmSync(join(metricsDir(), name), { recursive: true, force: true })
      dropped++
    } catch {
      /* leave it for the next pass */
    }
  }
  return dropped
}

let pruneTimer: NodeJS.Timeout | null = null

/** Prune on boot, then hourly. Safe to call more than once. */
export function initMetrics(): void {
  try {
    const removed = pruneAll()
    const orphans = pruneOrphans()
    if (removed || orphans) {
      log.info(`Telemetry: pruned ${removed} expired rows, ${orphans} orphaned server folders`)
    }
  } catch (err) {
    log.warn('metrics prune failed:', err)
  }
  if (!pruneTimer) {
    pruneTimer = setInterval(() => {
      try {
        pruneAll()
      } catch {
        /* keep the timer alive */
      }
    }, 3600_000)
    pruneTimer.unref?.()
  }
}

/** Test helper: forget in-memory buckets without writing them. */
export function _resetBuffers(): void {
  open.clear()
}
