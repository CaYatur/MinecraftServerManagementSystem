/**
 * Performance analysis — what the collected history actually means.
 *
 * Pure, like `./uptime.ts` and `./alerts.ts`: metrics + uptime + events + the
 * server's own configuration in, findings out. No I/O, no clock, no strings -
 * a finding is `{ code, severity, data }` and the UI owns the wording, so both
 * languages come from the same analysis and a test asserts on codes.
 *
 * The bar for shipping a finding is that it is *hard to be wrong about*. Every
 * rule here is proportional or sustained rather than peak-based (a single TPS
 * dip during a backup is not chronic lag), refuses to speak below a minimum
 * amount of data, and stays silent when the input cannot support it.
 *
 * MEMORY, IMPORTANT: `rss` is the process' resident memory, not the JVM heap.
 * RSS legitimately exceeds -Xmx (off-heap buffers, metaspace, GC structures,
 * the JVM itself), so high RSS is NOT evidence the heap is too small and this
 * module never claims it is. Only the unambiguous direction is reported: a
 * process that never comes close to its own -Xmx is over-allocated.
 */
import { MODDED_TYPES, PLUGIN_TYPES, TPS_TYPES } from './types'
import type { MetricPoint, MetricSeries, ServerConfig, ServerEvent, ServerType } from './types'
import type { UptimeReport } from './uptime'

export type FindingSeverity = 'info' | 'warn' | 'error'

export type FindingCode =
  | 'insufficient-data'
  | 'tps-unavailable'
  | 'chronic-lag'
  | 'lag-with-players'
  | 'cpu-saturated'
  | 'memory-over-allocated'
  | 'frequent-crashes'
  | 'no-backups'
  | 'aikars-flags'
  | 'healthy'

export interface Finding {
  code: FindingCode
  severity: FindingSeverity
  /** Numbers behind the claim; interpolated into the translated sentence. */
  data?: Record<string, string | number>
}

export interface AnalysisInput {
  series: MetricSeries
  /** From `events.uptime()` - crashes and starts are not recomputed here. */
  uptime: UptimeReport | null
  /** Events inside the window (crashes, readiness, backups). */
  events: ServerEvent[]
  server: Pick<ServerConfig, 'type' | 'java'>
  from: number
  to: number
}

// ------------------------------------------------------------------ thresholds
// Exported so the smoke asserts against the same numbers the analyzer uses.

/** Below this many raw readings nothing is diagnosed at all. */
export const MIN_SAMPLES = 120
/** ...and this many stored rows, so a handful of dense buckets cannot qualify. */
export const MIN_POINTS = 20

/** A bucket averaging under this is a laggy bucket. 20 is a perfect tick rate. */
export const LAG_TPS = 19
export const LAG_SHARE_WARN = 0.1
export const LAG_SHARE_ERROR = 0.3

export const CPU_HIGH = 85
export const CPU_SHARE_WARN = 0.15

/** Player-correlation needs both cohorts to be real, and a real difference. */
export const COHORT_MIN_POINTS = 10
export const COHORT_TPS_DELTA = 1.5

/** Only flag over-allocation for heaps big enough for it to be worth saying. */
export const OVERALLOC_MIN_XMX_MB = 2048
export const OVERALLOC_SHARE = 0.55

/** Backups are only "missing" once the window is long enough to expect one. */
export const BACKUP_WINDOW_DAYS = 3

/** Aikar's flags start paying off around here. */
export const AIKARS_MIN_HEAP_MB = 4096

const pct = (v: number): number => Math.round(v * 1000) / 10
const r1 = (v: number): number => Math.round(v * 10) / 10

function share(points: MetricPoint[], pred: (p: MetricPoint) => boolean): number {
  if (!points.length) return 0
  let n = 0
  for (const p of points) if (pred(p)) n++
  return n / points.length
}

function avgTps(points: MetricPoint[]): number | null {
  let sum = 0
  let w = 0
  for (const p of points) {
    if (p.tps == null) continue
    const n = Math.max(1, p.n)
    sum += p.tps * n
    w += n
  }
  return w ? sum / w : null
}

/**
 * Whether this server software can report a TPS at all. Vanilla and the
 * proxies cannot, so their empty TPS series is missing data, not a problem.
 */
export function reportsTps(type: ServerType): boolean {
  return TPS_TYPES.includes(type)
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { error: 0, warn: 1, info: 2 }

export function analyze(input: AnalysisInput): Finding[] {
  const { series, uptime, events, server, from, to } = input
  const points = series.points
  const out: Finding[] = []
  const windowDays = Math.max(0, (to - from) / 86400_000)

  // --- nothing is diagnosed from a handful of readings ---------------------
  if (series.summary.samples < MIN_SAMPLES || points.length < MIN_POINTS) {
    return [
      {
        code: 'insufficient-data',
        severity: 'info',
        data: { samples: series.summary.samples, needed: MIN_SAMPLES }
      }
    ]
  }

  // --- tick rate ------------------------------------------------------------
  const withTps = points.filter((p) => p.tps != null)
  if (!withTps.length) {
    // Never call a server laggy because it cannot answer the question.
    out.push({
      code: 'tps-unavailable',
      severity: 'info',
      data: { type: server.type, canReport: reportsTps(server.type) ? 1 : 0 }
    })
  } else {
    const laggy = share(withTps, (p) => (p.tps as number) < LAG_TPS)
    if (laggy >= LAG_SHARE_WARN) {
      out.push({
        code: 'chronic-lag',
        severity: laggy >= LAG_SHARE_ERROR ? 'error' : 'warn',
        data: {
          share: pct(laggy),
          avg: r1(avgTps(withTps) ?? 0),
          min: series.summary.tpsMin ?? 0
        }
      })
    }

    // Does the lag follow the players? Both cohorts must be substantial, and
    // the gap big enough that it is not sampling noise.
    const peak = series.summary.playersMax
    if (peak >= 2) {
      const busy = withTps.filter((p) => p.players >= peak * 0.6)
      const quiet = withTps.filter((p) => p.players <= peak * 0.25)
      const busyTps = avgTps(busy)
      const quietTps = avgTps(quiet)
      if (
        busy.length >= COHORT_MIN_POINTS &&
        quiet.length >= COHORT_MIN_POINTS &&
        busyTps != null &&
        quietTps != null &&
        quietTps - busyTps >= COHORT_TPS_DELTA
      ) {
        out.push({
          code: 'lag-with-players',
          severity: 'warn',
          data: {
            busyTps: r1(busyTps),
            quietTps: r1(quietTps),
            players: Math.ceil(peak * 0.6),
            peak
          }
        })
      }
    }
  }

  // --- CPU -----------------------------------------------------------------
  const hot = share(points, (p) => p.cpu >= CPU_HIGH)
  if (hot >= CPU_SHARE_WARN) {
    out.push({
      code: 'cpu-saturated',
      severity: 'warn',
      data: { share: pct(hot), avg: series.summary.cpuAvg, max: series.summary.cpuMax }
    })
  }

  // --- memory (see the header: RSS is not the heap) -------------------------
  const xmx = server.java.maxMemoryMB
  if (xmx >= OVERALLOC_MIN_XMX_MB && series.summary.rssMax < xmx * OVERALLOC_SHARE) {
    out.push({
      code: 'memory-over-allocated',
      severity: 'info',
      data: {
        rssMax: series.summary.rssMax,
        xmx,
        share: pct(series.summary.rssMax / xmx)
      }
    })
  }

  // --- stability ------------------------------------------------------------
  const crashes = uptime?.crashes ?? 0
  if (crashes > 0) {
    out.push({
      code: 'frequent-crashes',
      severity: crashes >= 3 ? 'error' : 'warn',
      data: { crashes, days: r1(windowDays) }
    })
  }

  // --- backups --------------------------------------------------------------
  if (windowDays >= BACKUP_WINDOW_DAYS && !events.some((e) => e.type === 'backup.created')) {
    out.push({ code: 'no-backups', severity: 'warn', data: { days: Math.round(windowDays) } })
  }

  // --- launch flags ---------------------------------------------------------
  const tunable = PLUGIN_TYPES.includes(server.type) || MODDED_TYPES.includes(server.type)
  if (tunable && server.java.preset === 'basic' && xmx >= AIKARS_MIN_HEAP_MB) {
    out.push({ code: 'aikars-flags', severity: 'info', data: { xmx } })
  }

  if (!out.length) {
    return [
      {
        code: 'healthy',
        severity: 'info',
        data: {
          days: r1(windowDays),
          samples: series.summary.samples,
          ...(series.summary.tpsAvg != null ? { tps: series.summary.tpsAvg } : {})
        }
      }
    ]
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
