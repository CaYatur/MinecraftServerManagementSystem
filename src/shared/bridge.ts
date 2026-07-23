/**
 * MSMS Bridge — wire protocol (v1).
 *
 * The in-server MSMS-Bridge plugin reports telemetry the console can't
 * otherwise expose — true TPS/MSPT read straight off the tick loop, player
 * positions, world events — by printing one marked line per message to the
 * server's standard output. The app already reads that stream, so the bridge
 * needs no extra port, socket, or firewall hole: it rides the pipe that is
 * already there.
 *
 * A message is a single line that CONTAINS the marker `[MSMS-BRIDGE]` followed
 * by a compact JSON object. The marker is deliberately NOT anchored to the
 * start of the line: Paper/Spigot route `System.out` through log4j2, so a line
 * reaches the app as `[12:34:56 INFO]: [MSMS-BRIDGE] {…}` (sometimes with a
 * `[STDOUT]` tag in between), never at column 0. Parsing therefore finds the
 * marker wherever it sits and reads the JSON after it.
 *
 * This module is pure — no I/O, no clock — so the whole protocol, and the
 * fresh-vs-stale reconciliation below, is smoke-testable.
 */

export const BRIDGE_MARKER = '[MSMS-BRIDGE]'
export const BRIDGE_PROTOCOL = 1

/** Default heartbeat cadence the app assumes until a `hello` says otherwise. */
export const BRIDGE_DEFAULT_INTERVAL_MS = 5000

/**
 * How many heartbeat intervals of silence before bridge telemetry is treated
 * as stale and we fall back to RCON. Generous enough to survive a GC pause or
 * a single dropped heartbeat, short enough that a crashed plugin can't pin a
 * frozen TPS on screen indefinitely.
 */
export const BRIDGE_STALE_FACTOR = 2.5

export interface BridgePlayer {
  name: string
  uuid?: string
  world?: string
  /** overworld | nether | the_end, or a raw dimension key. */
  dim?: string
  x?: number
  y?: number
  z?: number
}

export type BridgeMessage =
  | {
      v: number
      t: 'hello'
      plugin: string
      pluginVersion: string
      server: string
      mc: string
      /** Heartbeat cadence in ms the plugin intends to use. */
      interval?: number
    }
  | { v: number; t: 'tick'; tps: number; tps5: number | null; tps15: number | null; mspt: number | null }
  | { v: number; t: 'players'; online: number; list: BridgePlayer[] }
  | { v: number; t: 'event'; kind: string; text?: string; data?: Record<string, unknown> }
  | { v: number; t: 'bye' }

export type BridgeMessageType = BridgeMessage['t']

/** Does this raw console line carry a bridge marker at all? */
export function hasBridgeMarker(raw: string): boolean {
  return raw.includes(BRIDGE_MARKER)
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}
function str(x: unknown): string | undefined {
  return typeof x === 'string' && x.length > 0 ? x : undefined
}

function toPlayer(x: unknown): BridgePlayer | null {
  if (!x || typeof x !== 'object') return null
  const p = x as Record<string, unknown>
  const name = str(p.name)
  if (!name) return null
  const uuid = str(p.uuid)
  const world = str(p.world)
  const dim = str(p.dim)
  const x0 = num(p.x)
  const y0 = num(p.y)
  const z0 = num(p.z)
  return {
    name,
    ...(uuid ? { uuid } : {}),
    ...(world ? { world } : {}),
    ...(dim ? { dim } : {}),
    ...(x0 !== null ? { x: x0 } : {}),
    ...(y0 !== null ? { y: y0 } : {}),
    ...(z0 !== null ? { z: z0 } : {})
  }
}

/**
 * Parse a marked line into a typed message. Returns null when the line has no
 * marker OR when the payload is malformed / an unknown type. The caller tells
 * the two apart with `hasBridgeMarker`: a marked-but-null line is a protocol
 * error worth a warning (likely a version mismatch), while an unmarked line is
 * just an ordinary log line. Faithful — no clamping or normalization happens
 * here; the consumer decides what a sane TPS is.
 */
export function parseBridgeLine(raw: string): BridgeMessage | null {
  const at = raw.indexOf(BRIDGE_MARKER)
  if (at < 0) return null
  const json = raw.slice(at + BRIDGE_MARKER.length).trim()
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const m = obj as Record<string, unknown>
  const v = num(m.v)
  if (v === null) return null

  switch (m.t) {
    case 'hello': {
      const plugin = str(m.plugin)
      const pluginVersion = str(m.pluginVersion)
      const server = str(m.server)
      const mc = str(m.mc)
      if (!plugin || !pluginVersion || !server || !mc) return null
      const interval = num(m.interval)
      return {
        v,
        t: 'hello',
        plugin,
        pluginVersion,
        server,
        mc,
        ...(interval !== null && interval > 0 ? { interval } : {})
      }
    }
    case 'tick': {
      const tps = num(m.tps)
      if (tps === null) return null
      return { v, t: 'tick', tps, tps5: num(m.tps5), tps15: num(m.tps15), mspt: num(m.mspt) }
    }
    case 'players': {
      const online = num(m.online)
      if (online === null) return null
      const list = Array.isArray(m.list)
        ? m.list.map(toPlayer).filter((p): p is BridgePlayer => p !== null)
        : []
      return { v, t: 'players', online, list }
    }
    case 'event': {
      const kind = str(m.kind)
      if (!kind) return null
      const text = str(m.text)
      const data = m.data && typeof m.data === 'object' ? (m.data as Record<string, unknown>) : undefined
      return { v, t: 'event', kind, ...(text ? { text } : {}), ...(data ? { data } : {}) }
    }
    case 'bye':
      return { v, t: 'bye' }
    default:
      return null
  }
}

/**
 * The slice of bridge state the TPS reconciliation needs. Kept as a plain
 * shape (rather than a class) so the decision is a pure function the smoke can
 * exercise without a running process.
 */
export interface BridgeSnapshot {
  connected: boolean
  intervalMs: number
  /** When the last bridge message arrived (ms epoch); 0 = never. */
  lastTs: number
  tps: number | null
  mspt: number | null
}

export function newBridgeSnapshot(): BridgeSnapshot {
  return {
    connected: false,
    intervalMs: BRIDGE_DEFAULT_INTERVAL_MS,
    lastTs: 0,
    tps: null,
    mspt: null
  }
}

/** True while bridge telemetry is fresh enough to be trusted over RCON. */
export function bridgeFresh(b: BridgeSnapshot, now: number): boolean {
  return b.connected && b.lastTs > 0 && now - b.lastTs < b.intervalMs * BRIDGE_STALE_FACTOR
}

export interface ReconciledTps {
  tps: number | null
  mspt: number | null
  /** True when the reported figure came from a live bridge, not RCON. */
  bridge: boolean
}

/**
 * Decide which TPS/MSPT to report. A fresh bridge reading wins — it is truer
 * and carries MSPT that RCON's `tps` command can't. The moment the bridge goes
 * silent (plugin crash, long GC, idle), it is stale and we fall back to the
 * RCON reading, or to the last known value if RCON has none. This is exactly
 * the guard that stops a dead plugin from freezing a stale TPS on screen.
 */
export function reconcileTps(
  b: BridgeSnapshot,
  rconTps: number | null,
  prevTps: number | null,
  now: number
): ReconciledTps {
  if (bridgeFresh(b, now) && b.tps !== null) {
    return { tps: b.tps, mspt: b.mspt, bridge: true }
  }
  return { tps: rconTps ?? prevTps, mspt: null, bridge: false }
}
