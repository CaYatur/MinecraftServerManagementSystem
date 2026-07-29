import { app, BrowserWindow } from 'electron'
import { existsSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import AdmZip from 'adm-zip'
import * as nbt from 'prismarine-nbt'
import { processManager } from './core/processManager'
import { LineSplitter } from './core/lineSplitter'
import { buildLaunchArgs } from './core/javaArgs'
import { getConfig, updateConfig } from './config'
import {
  startWebServer,
  stopWebServer,
  _resetRateLimits,
  _resetPageCache,
  _buildCount,
  _buildLog
} from './web/server'
import * as webAuth from './web/auth'
import * as apikeys from './web/apikeys'
import { DEFAULT_KEY_LIMIT, consumeToken, newBucket, isOriginAllowed } from '@shared/apikeys'
import * as webPlayerAuth from './web/playerAuth'
import * as economy from './store/economy'
import * as siteMod from './web/site'
import { pickSiteLang } from './web/siteLang'
import { SCOPES } from '@shared/web'
import type { LedgerEntry, Product, Scope } from '@shared/web'
import { categoryName, filterLedger, ledgerSummary } from '@shared/economy'
import { ANALYSIS_EVENT_LIMIT, ANALYSIS_EVENT_TYPES } from '@shared/analysis'
import { effectiveScopes, normalizeScopes } from '@shared/rbac'
import {
  filterProducts,
  isSafeImageSrc,
  normalizeLayout,
  sanitizeImages,
  sections,
  MAX_PRODUCT_IMAGES
} from '@shared/storefront'
import * as rolesMod from './web/roles'
import {
  CRATE_ANIMATIONS,
  DEFAULT_CRATE_ANIMATION,
  crateDuration,
  normalizeCrateAnimation,
  resolveCrateAnimation
} from '@shared/crate'
import { getProvider } from './core/versions'
import { createServer } from './core/createServer'
import { pickForgeRunJar } from './core/serverDetect'
import { downloadFile } from './core/net'
import { createServer as httpCreateServer } from 'node:http'
import { connect as netConnect } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import {
  WsParser,
  WS_GUID,
  WS_OP,
  WS_CLOSE,
  WS_MAX_PAYLOAD,
  encodeClientFrame,
  encodeFrame,
  maskPayload
} from '@shared/wsframe'
import { runInNewContext } from 'node:vm'
import { getPanelHtml } from './web/panelHtml'
import { getPublicSiteHtml } from './web/publicSiteHtml'
import { CRATE_CSS } from '@shared/crateUi'
import { openApiDocument } from '@shared/openapi'
import { clampGrace, deliveryDecision, queueReason, HOLD_REASONS } from '@shared/delivery'
import { API_PREFIX, API_ROUTES } from '@shared/apiSurface'
import { usageSamples, API_KEY_HEADER } from '@shared/apiUsage'
import { MODERATION_ACTIONS, WORLD_ACTIONS } from '@shared/ops'
import { removeServer } from './core/serverRegistry'
import * as sf from './core/serverFiles'
import * as files from './core/serverFiles'
import * as registry from './core/serverRegistry'
import * as playersMod from './core/players'
import * as backupsMod from './core/backups'
import * as schedulerMod from './core/scheduler'
import * as modsMod from './core/mods'
import * as bridgeInstallMod from './core/bridgeInstall'
import * as worldTilesMod from './core/worldTiles'
import {
  decodeRegionTiles,
  encodeRegionTiles,
  normalizeMapPerf,
  MAP_PERF_DEFAULTS,
  TILE_CACHE_VERSION
} from '@shared/tileCache'
import type { CachedRegion, CachedTile } from '@shared/tileCache'
import {
  bridgeNeed,
  bridgeVersionOf,
  compareBridgeVersions,
  installPlan,
  pickBridgeAsset,
  sha256Of
} from '@shared/bridgeRelease'
import type { GhRelease } from '@shared/bridgeRelease'
import { iconFor, iconSvg, ICON_BOX, STRUCTURE_ICONS } from '@shared/mapIcons'
import { STRUCTURE_KINDS } from '@shared/regionFormat'
import {
  bitsPerIndex,
  blockColour,
  localChunk,
  packingFor,
  parseLocationTable,
  regionOf,
  shade,
  unpackIndices
} from '@shared/regionFormat'
import { publicVerifyReply, verifyDecision } from '@shared/playerVerify'
import { newRefreshState, tryRefresh, INVENTORY_REFRESH } from '@shared/refreshLimit'
import {
  avatarUrl,
  canSee,
  itemIconId,
  itemIconUrl,
  itemLabel,
  redactProfile,
  PROFILE_PUBLISHING_DEFAULTS
} from '@shared/profile'
import type { FullProfile, ProfileField, ProfilePublishing, ProfileViewer } from '@shared/profile'
import * as rcon from './core/rcon'
import * as metrics from './core/metrics'
import * as eventsMod from './core/events'
import * as alertsMod from './core/alerts'
import * as worldsMod from './core/worlds'
import * as areasMod from '@shared/chunkAreas'
import * as areasMod2 from './core/chunkAreas'
import {
  isValidMcName,
  isValidWorldName,
  sanitizeCommandArg
} from '@shared/ops'
import {
  heatmap,
  livePlayers,
  mapBounds,
  normalizeDimension,
  clampRound,
  clampScale,
  fitView,
  panBy,
  redactPlayers,
  screenToWorld,
  worldToScreen,
  zoomAt,
  MAX_SCALE,
  MIN_SCALE,
  PUBLIC_MAP_DEFAULTS
} from '@shared/livemap'
import type { LivePlayer, MapView } from '@shared/livemap'
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
import {
  diffUpdates,
  folderForLoaders,
  pickCompatibleVersion,
  planModSwap,
  safeJarName
} from '@shared/mods'
import type { MrVersion, MrVersionInfo } from '@shared/mods'
import { computeUptime, clipSessions } from '@shared/uptime'
import { evaluateRule, normalizeRule, IDLE, type AlertRule, type AlertSample } from '@shared/alerts'
import { analyze, type Finding } from '@shared/analysis'
import {
  parseBridgeLine,
  hasBridgeMarker,
  reconcileTps,
  newBridgeSnapshot,
  BRIDGE_MARKER,
  BRIDGE_STALE_FACTOR,
  BRIDGE_DEFAULT_INTERVAL_MS,
  type BridgeSnapshot
} from '@shared/bridge'
import { filterAudit, type AuditEntry } from '@shared/audit'
import { aggregateJoins, type JoinRecord } from '@shared/joins'
import * as auditMod from './core/audit'
import type { UptimeReport } from '@shared/uptime'
import type { JavaArgsConfig, MetricSeries, ServerConfig, ServerEvent, ServerType } from '@shared/types'
import { alertsPath, uploadsDir, auditDir, dataDir } from './paths'
import { analyzeCrash } from './core/crash'
import { CREATABLE_TYPES, createErrorKey } from '@shared/versions'

/* eslint-disable no-console */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * A WebSocket client built from the codec under test, over a raw socket (#27).
 *
 * Not the platform `WebSocket`, on purpose. Two reasons: a compliant client
 * cannot produce the frames the server most needs to refuse — an unmasked one,
 * an oversized one — and the browser API cannot set an `Authorization` header,
 * which is half of the auth surface here. Driving the socket by hand tests both,
 * and reads the handshake itself rather than trusting that it happened.
 */
interface WsTestClient {
  status: number
  upgraded: boolean
  acceptOk: boolean
  protocol: string
  messages: Record<string, unknown>[]
  closes: { code: number; reason: string }[]
  fails: string[]
  ended: boolean
  send(value: unknown): void
  raw(bytes: Uint8Array): void
  wait(pred: (m: Record<string, unknown>) => boolean, ms?: number): Promise<Record<string, unknown> | null>
  end(): void
}

function wsTestConnect(
  port: number,
  opts: { path?: string; headers?: Record<string, string>; protocols?: string[] } = {}
): Promise<WsTestClient> {
  return new Promise((resolve) => {
    const key = randomBytes(16).toString('base64')
    const expected = createHash('sha1').update(key + WS_GUID).digest('base64')
    // Reading the SERVER side of the conversation, so the masking rule inverts:
    // server-to-client frames must not be masked.
    const parser = new WsParser({ requireMask: false })
    const sock = netConnect({ host: '127.0.0.1', port })
    let head = Buffer.alloc(0)
    let upgraded = false
    let settled = false

    const client: WsTestClient = {
      status: 0,
      upgraded: false,
      acceptOk: false,
      protocol: '',
      messages: [],
      closes: [],
      fails: [],
      ended: false,
      send: (value) => sock.write(encodeClientFrame(WS_OP.text, new TextEncoder().encode(JSON.stringify(value)))),
      raw: (bytes) => sock.write(Buffer.from(bytes)),
      wait: async (pred, ms = 3000) => {
        const until = Date.now() + ms
        for (;;) {
          const hit = client.messages.find(pred)
          if (hit) return hit
          if (Date.now() > until) return null
          await sleep(20)
        }
      },
      end: () => sock.destroy()
    }
    const settle = (): void => {
      if (settled) return
      settled = true
      resolve(client)
    }

    const feed = (chunk: Uint8Array): void => {
      for (const ev of parser.push(chunk)) {
        if (ev.type === 'text') {
          try {
            client.messages.push(JSON.parse(ev.text) as Record<string, unknown>)
          } catch {
            client.fails.push('non-json:' + ev.text.slice(0, 40))
          }
        } else if (ev.type === 'close') {
          client.closes.push({ code: ev.code, reason: ev.reason })
        } else if (ev.type === 'fail') {
          client.fails.push(ev.reason)
        }
      }
    }

    sock.on('connect', () => {
      const lines = [
        `GET ${opts.path ?? '/api/v1/stream'} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13'
      ]
      if (opts.protocols?.length) lines.push(`Sec-WebSocket-Protocol: ${opts.protocols.join(', ')}`)
      for (const [k, v] of Object.entries(opts.headers ?? {})) lines.push(`${k}: ${v}`)
      sock.write(lines.join('\r\n') + '\r\n\r\n')
    })
    sock.on('data', (chunk: Buffer) => {
      if (!upgraded) {
        head = Buffer.concat([head, chunk])
        const at = head.indexOf('\r\n\r\n')
        if (at < 0) return
        const text = head.subarray(0, at).toString('utf-8')
        const rest = head.subarray(at + 4)
        client.status = Number(text.split(' ')[1]) || 0
        const accept = /sec-websocket-accept:\s*(\S+)/i.exec(text)?.[1] ?? ''
        client.acceptOk = accept === expected
        client.protocol = /sec-websocket-protocol:\s*(\S+)/i.exec(text)?.[1] ?? ''
        upgraded = true
        client.upgraded = client.status === 101
        settle()
        if (client.upgraded && rest.length) feed(new Uint8Array(rest))
        return
      }
      feed(new Uint8Array(chunk))
    })
    sock.on('error', () => {
      client.ended = true
      settle()
    })
    sock.on('close', () => {
      client.ended = true
      settle()
    })
  })
}

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

    // Browse-search loaders (#47): what the Modrinth tab filters by, so mods and
    // plugins don't mix. Plugin servers = Bukkit family, modded = single loader,
    // hybrid (mohist) = plugin family UNION its mod loaders (both must show),
    // proxy = single, vanilla/unknown = unfiltered.
    const sl = (t: Parameters<typeof modsMod.searchLoaders>[0]): string[] => modsMod.searchLoaders(t)
    for (const l of ['paper', 'spigot', 'bukkit', 'purpur', 'folia']) {
      if (!sl('paper').includes(l)) return fail(`paper browse should search ${l}`)
    }
    if (sl('fabric').join() !== 'fabric') return fail('fabric browse should search only fabric')
    if (sl('forge').join() !== 'forge') return fail('forge browse should search only forge')
    if (sl('velocity').join() !== 'velocity') return fail('velocity browse should search only velocity')
    // hybrid must surface BOTH plugins and Forge mods
    const moh = sl('mohist')
    for (const l of ['paper', 'spigot', 'bukkit', 'forge']) {
      if (!moh.includes(l)) return fail(`mohist (hybrid) browse should search ${l}, got ${moh.join()}`)
    }
    if (sl('vanilla').length !== 0) return fail('vanilla browse should not filter by loader')
    console.log('MODUPDATE-SMOKE: browse-search loaders OK (plugin family, modded single, hybrid unions both)')

    // Compatibility pick (#47 detail view). Same doctrine as the diff: recency
    // comes from date_published, NEVER from the version string, and a stable
    // release outranks a newer pre-release.
    const V = (
      id: string,
      num: string,
      loaders: string[],
      games: string[],
      type: string,
      date: string
    ): MrVersionInfo => ({
      id,
      project_id: 'p',
      version_number: num,
      version_type: type,
      loaders,
      game_versions: games,
      date_published: date,
      files: [{ primary: true, filename: `${id}.jar`, hashes: { sha1: id } }]
    })
    const pool: MrVersionInfo[] = [
      V('a', 'v9.9.9', ['fabric'], ['1.20.1'], 'release', '2026-01-01T00:00:00Z'),
      V('b', 'v1.0.0', ['paper', 'spigot'], ['1.20.1'], 'release', '2025-06-01T00:00:00Z'),
      V('c', 'v2.0.0', ['paper'], ['1.20.1'], 'beta', '2025-12-01T00:00:00Z'),
      V('d', 'v3.0.0', ['paper'], ['1.21.4'], 'release', '2026-02-01T00:00:00Z')
    ]

    // A Paper 1.20.1 server must not get the Fabric build even though it is the
    // newest of all, and must prefer the stable release over the newer beta.
    const paperPick = pickCompatibleVersion(pool, {
      mcVersion: '1.20.1',
      loaders: modsMod.searchLoaders('paper')
    })
    if (paperPick?.id !== 'b') {
      return fail('paper 1.20.1 should pick the stable paper/spigot build, got ' + paperPick?.id)
    }
    // Nothing for this MC version -> undefined, but the loader still has builds.
    const noMc = pickCompatibleVersion(pool, {
      mcVersion: '1.7.10',
      loaders: modsMod.searchLoaders('paper')
    })
    if (noMc) return fail('an unsupported MC version must not report a compatible build')
    const anyMc = pickCompatibleVersion(pool, { loaders: modsMod.searchLoaders('paper') })
    if (anyMc?.id !== 'd') return fail('latest-for-loader should be the newest paper release')
    // A loader with no builds at all -> undefined (not a silent wrong pick).
    if (pickCompatibleVersion(pool, { loaders: ['neoforge'] })) {
      return fail('a loader with no builds must not report a compatible build')
    }
    // No loader filter (unknown server type) = do not exclude anything.
    if (!pickCompatibleVersion(pool, { loaders: [] })) {
      return fail('an unfiltered pick should still find something')
    }
    // Version STRINGS must not decide: 'v1.0.0' beat 'v9.9.9' above purely on
    // loader match, and here a lexically tiny number wins on date.
    const dateWins = pickCompatibleVersion(
      [
        V('old', 'v10.0.0', ['paper'], ['1.20.1'], 'release', '2024-01-01T00:00:00Z'),
        V('new', 'v2.0.0', ['paper'], ['1.20.1'], 'release', '2026-01-01T00:00:00Z')
      ],
      { mcVersion: '1.20.1', loaders: ['paper'] }
    )
    if (dateWins?.id !== 'new') return fail('recency must come from the date, not the version text')
    console.log('MODUPDATE-SMOKE: compatibility pick OK (loader + MC filter, release > newer beta, date not version text)')

    // Hybrid install folder: mohist runs Bukkit plugins AND Forge mods, so the
    // version's own loaders decide the folder - the server type cannot.
    if (folderForLoaders(['forge'], 'plugins') !== 'mods') return fail('a forge build must go to mods/')
    if (folderForLoaders(['paper', 'spigot'], 'mods') !== 'plugins') {
      return fail('a bukkit-family build must go to plugins/')
    }
    if (folderForLoaders([], 'mods') !== 'mods') return fail('no loaders should use the fallback')
    if (folderForLoaders(undefined, 'plugins') !== 'plugins') {
      return fail('missing loaders should use the fallback')
    }
    console.log('MODUPDATE-SMOKE: install folder decided by version loaders (hybrid-safe)')

    // The update file-swap (#29): previously reachable only by downloading a
    // jar, now a pure decision.
    const ci = { caseInsensitive: true }
    const cs = { caseInsensitive: false }

    // A renamed jar must be removed, or the server loads both copies.
    const renamed = planModSwap('plugins/LuckPerms-5.4.0.jar', 'LuckPerms-5.5.53.jar', ci)
    if (renamed.newName !== 'LuckPerms-5.5.53.jar') return fail('wrong new name: ' + renamed.newName)
    if (renamed.removeRel !== 'plugins/LuckPerms-5.4.0.jar') {
      return fail('a renamed jar must be removed, got ' + renamed.removeRel)
    }
    // A same-name update was overwritten by the download - removing it deletes
    // the new jar.
    if (planModSwap('plugins/LuckPerms.jar', 'LuckPerms.jar', ci).removeRel !== null) {
      return fail('a same-name update must not delete the file it just wrote')
    }
    // THE TRAP: on Windows/macOS these are one file. A case-sensitive compare
    // says "different", deletes the "old" one, and the server is left with no
    // plugin at all.
    if (planModSwap('plugins/LuckPerms.jar', 'luckperms.jar', ci).removeRel !== null) {
      return fail('a case-only rename on a case-insensitive fs must NOT be deleted')
    }
    // ...but on Linux they really are two files, so the old one must go.
    if (planModSwap('plugins/LuckPerms.jar', 'luckperms.jar', cs).removeRel !== 'plugins/LuckPerms.jar') {
      return fail('a case-only rename on a case-sensitive fs is a real rename')
    }
    // A disabled plugin stays disabled - an update must never switch a plugin
    // the operator turned off back on.
    const dis = planModSwap('plugins/LuckPerms-5.4.0.jar.disabled', 'LuckPerms-5.5.53.jar', ci)
    if (dis.newName !== 'LuckPerms-5.5.53.jar.disabled') return fail('update re-enabled a disabled plugin')
    if (dis.removeRel !== 'plugins/LuckPerms-5.4.0.jar.disabled') return fail('old disabled jar not removed')
    // ...and a disabled jar whose name is otherwise unchanged is still one file.
    if (planModSwap('plugins/LuckPerms.jar.disabled', 'LuckPerms.jar', ci).removeRel !== null) {
      return fail('a disabled same-name update must not delete itself')
    }
    // mods/ is preserved, and the removal path is rebuilt under the right folder.
    const modded = planModSwap('mods/fabric-api-0.1.jar', 'fabric-api-0.2.jar', ci)
    if (modded.folder !== 'mods') return fail('mods/ folder lost')
    if (modded.removeRel !== 'mods/fabric-api-0.1.jar') return fail('wrong removal path for mods/')
    // A filename from the API is joined straight onto a server directory, so it
    // must not be able to steer the write out of it.
    if (safeJarName('../../../start.bat') !== 'start.bat') return fail('unix traversal not stripped')
    if (safeJarName('..\\..\\evil.jar') !== 'evil.jar') return fail('windows traversal not stripped')
    if (safeJarName('plugins/Sub/Thing.jar') !== 'Thing.jar') return fail('directory part not stripped')
    if (safeJarName('.hidden.jar') !== 'hidden.jar') return fail('leading dots not stripped')
    for (const bad of ['', '..', '/', '\\', '...']) {
      let threw = false
      try {
        safeJarName(bad)
      } catch {
        threw = true
      }
      if (!threw) return fail('a name that reduces to nothing must be refused: ' + JSON.stringify(bad))
    }
    // ...and the swap plan applies it, so a traversal name cannot reach join().
    if (planModSwap('plugins/A.jar', '../../evil.jar', ci).newName !== 'evil.jar') {
      return fail('planModSwap did not sanitise the new filename')
    }
    console.log('MODUPDATE-SMOKE: update swap OK (case-collision safe, disabled stays disabled, traversal stripped)')

    // ---- region decoding (#119) ----
    {
      // The packing change at 1.16 is the trap: before it an index could span
      // two longs, after it each long is padded so they never do. Decode one as
      // the other and you get a map that LOOKS like a map — right scale, right
      // shape, wrong blocks, drifting further out of alignment the deeper into
      // the chunk you read. There is no exception to catch, which is why this
      // is a table rather than an assumption.
      if (packingFor(2565) !== 'spanning') return fail('a pre-1.16 chunk was read as padded')
      if (packingFor(2566) !== 'padded') return fail('1.16 was read as spanning')
      if (packingFor(3700) !== 'padded') return fail('a modern chunk was read as spanning')
      if (packingFor(undefined) !== 'padded') return fail('an unknown version should assume modern')

      // Padded: 5 bits, so 12 per long with 4 bits of padding left over. Index
      // 12 must come from the SECOND long, not from the top of the first.
      const padded = unpackIndices([0b00010_00001n, 0b00111n], 5, 14, 'padded')
      if (padded[0] !== 1 || padded[1] !== 2) return fail('padded low indices wrong: ' + padded.slice(0, 2))
      if (padded[12] !== 7) return fail('padded index 12 came from the wrong long: ' + padded[12])

      // Spanning: the same 5-bit indices packed continuously. Index 12 starts
      // at bit 60 and takes its top bit from the next long — the exact case the
      // padded reader gets wrong.
      let packed = 0n
      for (let i = 0; i < 13; i++) packed |= BigInt(i % 32) << BigInt(i * 5)
      const spanLongs = [BigInt.asIntN(64, packed), BigInt.asIntN(64, packed >> 64n)]
      const spanning = unpackIndices(spanLongs, 5, 13, 'spanning')
      for (let i = 0; i < 12; i++) {
        if (spanning[i] !== i % 32) return fail('spanning index ' + i + ' was ' + spanning[i])
      }
      // ...and the two readers disagree exactly where they should.
      const asPadded = unpackIndices(spanLongs, 5, 13, 'padded')
      if (asPadded[12] === spanning[12]) {
        return fail('the two packings produced the same straddling index — one of them is not implemented')
      }

      // A negative long is normal: these are signed 64-bit values and the sign
      // bit is data. A plain shift fills with ones and every high index comes
      // back wrong.
      const negative = unpackIndices([-1n], 4, 16, 'padded')
      if (negative.some((v) => v !== 15)) return fail('a negative long decoded to ' + negative[0])

      // Four bits minimum whatever the palette holds.
      if (bitsPerIndex(1) !== 4 || bitsPerIndex(16) !== 4) return fail('small palettes must still use 4 bits')
      if (bitsPerIndex(17) !== 5) return fail('17 entries needs 5 bits')
      if (bitsPerIndex(4096) !== 12) return fail('4096 entries needs 12 bits')

      // The location table, including the "never generated" case that covers
      // most of a fresh region file.
      const header = new Uint8Array(4096)
      header[0] = 0
      header[1] = 0
      header[2] = 2
      header[3] = 1
      const table = parseLocationTable(header)
      if (table[0].offset !== 2 * 4096) return fail('chunk 0 offset wrong: ' + table[0].offset)
      if (table[0].byteLength !== 4096) return fail('chunk 0 length wrong')
      if (table[1].offset !== 0) return fail('an ungenerated chunk reported an offset')
      if (parseLocationTable(new Uint8Array(0)).length !== 1024) {
        return fail('a truncated header must still describe 1024 slots')
      }

      // Negative coordinates: `-1 / 32 | 0` is 0, which would put every chunk
      // west of spawn in the wrong region file.
      if (regionOf(-1) !== -1) return fail('regionOf(-1) should be -1')
      if (regionOf(-32) !== -1 || regionOf(-33) !== -2) return fail('regionOf is wrong for negatives')
      if (localChunk(-1) !== 31) return fail('localChunk(-1) should be 31')
      if (localChunk(-32) !== 0) return fail('localChunk(-32) should be 0')

      // Colours are stable — an unknown block must look the same on every tile
      // and every reload, or the map shimmers as chunks are re-rendered.
      const a = blockColour('some_modded_block')
      const b = blockColour('some_modded_block')
      if (a.r !== b.r || a.g !== b.g || a.b !== b.b) return fail('an unknown block colour is not stable')
      if (blockColour('minecraft:water').b <= blockColour('minecraft:water').r) {
        return fail('water is not blue')
      }
      if (blockColour('birch_leaves').g <= blockColour('birch_leaves').r) return fail('leaves are not green')
      // Shading is what makes a cliff visible.
      const flat = shade({ r: 100, g: 100, b: 100 }, 0)
      if (shade({ r: 100, g: 100, b: 100 }, 3).r <= flat.r) return fail('a step up is not lighter')
      if (shade({ r: 100, g: 100, b: 100 }, -3).r >= flat.r) return fail('a step down is not darker')

      // A real chunk, built as real NBT and read back by the real function.
      //
      // The bit decoding above was tested and the CHUNK READER was not, and
      // that is exactly where the bug was: prismarine-nbt wraps a list twice
      // (`{type:'list', value:{type:'compound', value:[...]}}`) and the palette
      // was unwrapped once. `Array.isArray` was false for every section of
      // every chunk, every section was skipped, and the world renderer produced
      // nothing at all — on a real world, silently, with every pure test green.
      {
        const section = (y: number, names: string[], data?: bigint[]): unknown => ({
          Y: { type: 'byte', value: y },
          block_states: {
            type: 'compound',
            value: {
              palette: {
                type: 'list',
                value: {
                  type: 'compound',
                  value: names.map((n) => ({ Name: { type: 'string', value: n } }))
                }
              },
              ...(data
                ? { data: { type: 'longArray', value: data.map((b) => [Number(b >> 32n), Number(b & 0xffffffffn)]) } }
                : {})
            }
          }
        })
        const chunkNbt = {
          type: 'compound',
          name: '',
          value: {
            DataVersion: { type: 'int', value: 4435 },
            sections: {
              type: 'list',
              value: {
                type: 'compound',
                // Air above, solid stone below: the reader must walk down past
                // the air and stop on the stone.
                value: [section(5, ['minecraft:air']), section(4, ['minecraft:stone'])]
              }
            }
          }
        }
        const tile = worldTilesMod.tileFromChunk(chunkNbt)
        if (!tile) return fail('a valid chunk produced no tile — the reader found no sections')
        if (tile.colour.length !== 256) return fail('a tile is not 16x16')
        const stone = blockColour('stone')
        const want = (stone.r << 16) | (stone.g << 8) | stone.b
        if (tile.colour.some((c) => c !== want)) return fail('a solid stone chunk did not render as stone')
        // Height is the top of the stone section: Y=4 means blocks 64..79, and
        // the surface is the highest of them.
        if (tile.height.some((h) => h !== 4 * 16 + 15)) {
          return fail('the surface height is wrong: ' + tile.height[0])
        }
        // Foliage is looked THROUGH: the grass standing on the ground is not
        // the ground, and colouring by it turned a bamboo jungle maroon.
        const planted = worldTilesMod.tileFromChunk({
          type: 'compound',
          name: '',
          value: {
            DataVersion: { type: 'int', value: 4435 },
            sections: {
              type: 'list',
              value: {
                type: 'compound',
                value: [section(5, ['minecraft:short_grass']), section(4, ['minecraft:grass_block'])]
              }
            }
          }
        })
        const grass = blockColour('grass_block')
        if (!planted) return fail('a planted chunk produced no tile')
        if (planted.colour[0] !== ((grass.r << 16) | (grass.g << 8) | grass.b)) {
          return fail('the map coloured a column by the plant standing on it, not the ground')
        }
        // The nether has a bedrock roof, so a top-down scan finds bedrock in
        // every column and paints the whole dimension one flat grey. A nether
        // map has to get UNDER the roof: skip solid blocks until an air gap has
        // been seen, then take the first thing below it (#135).
        const netherish = {
          type: 'compound',
          name: '',
          value: {
            DataVersion: { type: 'int', value: 4435 },
            sections: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  section(8, ['minecraft:bedrock']), // the roof, at y=128..143
                  section(7, ['minecraft:air']), // the gap a player flies through
                  section(6, ['minecraft:netherrack']) // the floor they stand on
                ]
              }
            }
          }
        }
        const roof = worldTilesMod.tileFromChunk(netherish, 'overworld')
        const floor = worldTilesMod.tileFromChunk(netherish, 'nether')
        const bedrock = blockColour('bedrock')
        const netherrack = blockColour('netherrack')
        if (!roof || !floor) return fail('a nether-shaped chunk produced no tile')
        // Read as an overworld it finds the roof — which is the bug.
        if (roof.colour[0] !== ((bedrock.r << 16) | (bedrock.g << 8) | bedrock.b)) {
          return fail('the overworld rule should have stopped at the bedrock roof')
        }
        // Read as the nether it finds the floor.
        if (floor.colour[0] !== ((netherrack.r << 16) | (netherrack.g << 8) | netherrack.b)) {
          return fail('the nether rule did not get under the roof')
        }
        if (floor.height[0] >= 128) return fail('the nether surface is above the roof: ' + floor.height[0])

        // An all-air chunk is not a tile at all.
        if (
          worldTilesMod.tileFromChunk({
            type: 'compound',
            name: '',
            value: {
              DataVersion: { type: 'int', value: 4435 },
              sections: { type: 'list', value: { type: 'compound', value: [section(5, ['minecraft:air'])] } }
            }
          })
        ) {
          return fail('an all-air chunk produced a tile')
        }
      }

      // ---- the on-disk tile cache (#133) ----
      //
      // A decoder that mis-reads its own file produces a plausible map rather
      // than an error, and then serves it until somebody deletes the cache by
      // hand. So the codec round-trips, and every way it can be handed
      // nonsense answers null.
      {
        const mk = (n: number): CachedTile => ({
          colour: Array.from({ length: 256 }, (_, i) => (i % 7 === 0 ? -1 : (i * 977 + n) & 0xffffff)),
          height: Array.from({ length: 256 }, (_, i) => ((i * 13 + n) % 384) - 64)
        })
        const region: CachedRegion = {
          mtimeMs: 1_700_000_000_123,
          tiles: new Map([
            [0, mk(1)],
            [511, { ...mk(2), marks: [{ kind: 'village', id: 'village_plains', x: 8, z: -24 }] }],
            [1023, { ...mk(3), marks: [
              { kind: 'dungeon', id: 'ancient_city', x: -1_000_000, z: 2_000_000 },
              { kind: 'mine', id: 'mineshaft', x: 0, z: 0 }
            ] }]
          ])
        }
        const back = decodeRegionTiles(encodeRegionTiles(region))
        if (!back) return fail('a freshly encoded region did not decode')
        if (back.mtimeMs !== region.mtimeMs) return fail('the mtime did not survive the round trip')
        if (back.tiles.size !== 3) return fail('a chunk was lost: ' + back.tiles.size)
        for (const [slot, want] of region.tiles) {
          const got = back.tiles.get(slot)
          if (!got) return fail('chunk ' + slot + ' vanished')
          for (let i = 0; i < 256; i++) {
            // Transparent columns are the ones that matter: encoded as black
            // they would paint the void over every ungenerated gap.
            if (got.colour[i] !== want.colour[i]) {
              return fail('colour ' + i + ' of chunk ' + slot + ': ' + got.colour[i] + ' vs ' + want.colour[i])
            }
            // Heights run -64..319, which does not fit a byte.
            if (got.height[i] !== want.height[i]) {
              return fail('height ' + i + ' of chunk ' + slot + ': ' + got.height[i] + ' vs ' + want.height[i])
            }
          }
          if ((got.marks ?? []).length !== (want.marks ?? []).length) {
            return fail('marks lost on chunk ' + slot)
          }
          for (let mi = 0; mi < (want.marks ?? []).length; mi++) {
            const a = (want.marks ?? [])[mi]
            const b = (got.marks ?? [])[mi]
            if (a.kind !== b.kind || a.id !== b.id || a.x !== b.x || a.z !== b.z) {
              return fail('mark ' + mi + ' of chunk ' + slot + ' changed: ' + JSON.stringify(b))
            }
          }
        }

        // A cache written by an older renderer must be REFUSED, not decoded.
        // Keying on the world's mtime alone says "the world has not changed",
        // which is true and beside the point when what changed is how we draw
        // it — every existing cache would serve the old colours forever.
        const stale = encodeRegionTiles(region)
        new DataView(stale.buffer).setUint16(4, TILE_CACHE_VERSION - 1)
        if (decodeRegionTiles(stale)) return fail('a cache from an older format version was accepted')

        // Nonsense of every shape is a miss, never a throw and never half a map.
        const good = encodeRegionTiles(region)
        const wrongMagic = good.slice()
        wrongMagic[0] ^= 0xff
        if (decodeRegionTiles(wrongMagic)) return fail('a file with the wrong magic was accepted')
        if (decodeRegionTiles(new Uint8Array(0))) return fail('an empty buffer was accepted')
        if (decodeRegionTiles(new Uint8Array(8))) return fail('a runt buffer was accepted')
        for (const cut of [17, 200, good.length - 1]) {
          if (decodeRegionTiles(good.slice(0, cut))) {
            return fail('a buffer truncated to ' + cut + ' bytes was accepted')
          }
        }
        // A count that claims more chunks than the bytes hold.
        const lying = good.slice()
        new DataView(lying.buffer).setUint16(14, 900)
        if (decodeRegionTiles(lying)) return fail('a chunk count past the end of the buffer was accepted')

        // The tuning is clamped: every one of these is a way to hang the
        // process, and they arrive from a config file an operator can edit.
        const wild = normalizeMapPerf({ memoryRegions: 1e9, parseGapMs: -5, cacheLimitMB: -1 })
        if (wild.memoryRegions > 64) return fail('memoryRegions was not clamped: ' + wild.memoryRegions)
        if (wild.parseGapMs < 0) return fail('a negative parse gap survived')
        if (wild.cacheLimitMB < 0) return fail('a negative cache limit survived')
        if (normalizeMapPerf({}).cache !== true) return fail('caching must default to on')
        if (normalizeMapPerf({ cache: false }).cache !== false) return fail('caching cannot be turned off')
        if (normalizeMapPerf(null).memoryRegions !== MAP_PERF_DEFAULTS.memoryRegions) {
          return fail('an absent config did not fall back to the defaults')
        }
        if (normalizeMapPerf({}).loadOnPan !== true) return fail('loading as the view moves must default on')
        if (normalizeMapPerf({ loadOnPan: false }).loadOnPan !== false) {
          return fail('loading as the view moves cannot be turned off')
        }
      }

      // ---- structure glyphs (#136) ----
      //
      // Path data is drawn by `new Path2D(...)`, which throws nothing on
      // nonsense — a malformed path renders as an empty shape, so a typo
      // produces a marker with a hole in it and no error anywhere.
      {
        for (const kind of STRUCTURE_KINDS) {
          const ic = iconFor(kind)
          if (!ic.path) return fail('no glyph for ' + kind)
          if (!ic.colour.startsWith('#')) return fail('the ' + kind + ' glyph has no colour')
          if (!ic.label) return fail('the ' + kind + ' glyph has no label')
          // Every command a path may contain, and nothing else. A stray letter
          // silently truncates the shape at that point.
          if (!/^[MmLlHhVvCcSsQqTtAaZz0-9smart.,\-\s]+$/.test(ic.path.replace(/[a-z]/gi, (c) => c))) {
            return fail('the ' + kind + ' glyph has characters a path cannot hold')
          }
          if (!/^[Mm]/.test(ic.path.trim())) return fail('the ' + kind + ' glyph does not start with a move')
          if (!/[Zz]\s*$/.test(ic.path.trim())) return fail('the ' + kind + ' glyph is not closed')
          // Inside the 24-box it claims, or it will not sit where it is placed.
          for (const n of ic.path.match(/-?\d+(\.\d+)?/g) ?? []) {
            const v = Number(n)
            if (v < -1 || v > ICON_BOX + 1) {
              return fail('the ' + kind + ' glyph leaves its box: ' + v)
            }
          }
        }
        // An unknown kind still draws something rather than nothing.
        if (iconFor('not-a-structure') !== STRUCTURE_ICONS.other) {
          return fail('an unknown structure kind has no fallback glyph')
        }
        if (!iconSvg('village', 12).includes('width="12"')) return fail('the legend svg ignores its size')
      }

      console.log('MODUPDATE-SMOKE: region decoding OK (1.16 packing split, real NBT chunk renders, foliage seen through, cache round-trips)')
    }

    // ---- the Bridge plugin installer (#103) ----
    {
      const rel = (
        assets: { name: string; url?: string; digest?: string }[],
        extra: Partial<GhRelease> = {}
      ): GhRelease => ({
        tag_name: 'v9',
        published_at: '2026-01-01T00:00:00Z',
        assets: assets.map((a) => ({
          name: a.name,
          browser_download_url:
            a.url ?? 'https://github.com/CaYatur/MinecraftServerManagementSystem/releases/download/v9/' + a.name,
          ...(a.digest ? { digest: a.digest } : {})
        })),
        ...extra
      })

      // The asset picker takes the newest MATCHING jar, and nothing else on the
      // release. A release carries whatever its author uploaded — installers,
      // checksums, a screenshot — and "contains MSMS-Bridge" is not a filter.
      const picked = pickBridgeAsset([
        rel([{ name: 'CaYaDev Server Manager-0.1.0-portable.exe' }, { name: 'MSMS-Bridge-1.0.0.jar' }]),
        rel([{ name: 'MSMS-Bridge-1.2.0.jar' }]),
        rel([{ name: 'MSMS-Bridge-1.1.0.jar' }])
      ])
      if (picked?.version !== '1.2.0') return fail('the newest bridge jar was not picked: ' + picked?.version)
      if (picked.name !== 'MSMS-Bridge-1.2.0.jar') return fail('picked the wrong asset name')

      // Ordered by the jar's own version, not by publication date: that is the
      // number the update check compares against what is installed, and sorting
      // by one while comparing the other lets a re-published older jar read as
      // an upgrade.
      const republished = pickBridgeAsset([
        rel([{ name: 'MSMS-Bridge-1.0.0.jar' }], { published_at: '2026-06-01T00:00:00Z' }),
        rel([{ name: 'MSMS-Bridge-2.0.0.jar' }], { published_at: '2025-01-01T00:00:00Z' })
      ])
      if (republished?.version !== '2.0.0') return fail('a re-published older jar outranked a newer one')

      for (const bad of [
        'MSMS-Bridge.jar',
        'MSMS-Bridge-1.0.0.jar.txt',
        'my-MSMS-Bridge-1.0.0.jar',
        'MSMS-Bridge-1.0.0.zip',
        'MSMS-Bridge-notes.jar'
      ]) {
        if (pickBridgeAsset([rel([{ name: bad }])])) return fail('accepted a non-bridge asset: ' + bad)
      }
      // A matching NAME on a URL somewhere else is the interesting one: the name
      // is what the picker matches, and the URL is what gets downloaded.
      if (pickBridgeAsset([rel([{ name: 'MSMS-Bridge-1.0.0.jar', url: 'https://evil.example/x.jar' }])])) {
        return fail('accepted a bridge asset hosted off GitHub')
      }
      if (pickBridgeAsset([rel([{ name: 'MSMS-Bridge-1.0.0.jar', url: 'http://github.com/x.jar' }])])) {
        return fail('accepted a bridge asset over plain http')
      }
      // Drafts and pre-releases: clicking "install" on a warning is not opting
      // into a test build.
      if (pickBridgeAsset([rel([{ name: 'MSMS-Bridge-3.0.0.jar' }], { prerelease: true })])) {
        return fail('a pre-release was offered as the newest bridge')
      }
      if (pickBridgeAsset([rel([{ name: 'MSMS-Bridge-3.0.0.jar' }], { draft: true })])) {
        return fail('a draft release was offered as the newest bridge')
      }
      if (pickBridgeAsset([])) return fail('an empty release list produced an asset')

      // Only a sha256 digest is accepted. GitHub publishes `sha256:<hex>`; a
      // sha1 or a truncated hex would otherwise be handed to the downloader as
      // if it were one, and the download would fail with a checksum error that
      // blames the file.
      const good = 'a'.repeat(64)
      if (sha256Of('sha256:' + good) !== good) return fail('a valid sha256 digest was rejected')
      for (const bad of ['sha1:' + 'a'.repeat(40), good, 'sha256:' + 'a'.repeat(63), '', null]) {
        if (sha256Of(bad)) return fail('accepted a bad digest: ' + String(bad))
      }
      const digested = pickBridgeAsset([
        rel([{ name: 'MSMS-Bridge-1.0.0.jar', digest: 'sha256:' + good }])
      ])
      if (digested?.sha256 !== good) return fail('the published digest did not reach the asset')

      // The version comparison is numeric, unlike the Modrinth one — this string
      // comes out of a filename this project publishes in a format it defines,
      // so reading it is not the guess that sorting someone else's is.
      if (compareBridgeVersions('1.10.0', '1.9.0') <= 0) return fail('1.10.0 must beat 1.9.0')
      if (compareBridgeVersions('1.0', '1.0.0') !== 0) return fail('1.0 and 1.0.0 are the same version')
      if (compareBridgeVersions('2.0.0', '10.0.0') >= 0) return fail('10.0.0 must beat 2.0.0')

      // The decision an operator sees.
      const need = (type: ServerType, installed: string | null, latest: string | null): string =>
        bridgeNeed({ type, installed, latest }).state
      if (need('paper', null, '1.0.0') !== 'missing') return fail('paper with no jar should be "missing"')
      if (need('paper', '1.0.0', '1.0.0') !== 'ok') return fail('paper with the current jar should be "ok"')
      if (need('paper', '1.0.0', '1.1.0') !== 'outdated') return fail('an older jar should be "outdated"')
      if (need('paper', '2.0.0', '1.0.0') !== 'ok') return fail('a newer jar than published is not outdated')
      // Nothing to offer is not a warning: a button that does nothing is worse
      // than silence.
      if (bridgeNeed({ type: 'paper', installed: null, latest: null }).actionable) {
        return fail('offered an install with no jar available anywhere')
      }
      if (need('paper', '1.0.0', null) !== 'ok') return fail('an installed jar with no known latest is fine')
      for (const t of ['vanilla', 'fabric', 'forge', 'velocity', 'bukkit'] as ServerType[]) {
        if (need(t, null, '1.0.0') !== 'unsupported') return fail(t + ' should not be told to install the bridge')
      }
      for (const t of ['paper', 'purpur', 'folia', 'spigot'] as ServerType[]) {
        if (need(t, null, '1.0.0') !== 'missing') return fail(t + ' should be offered the bridge')
      }

      // What the install actually tries, in order. Committing to one source
      // makes the bundled jar a fallback for exactly one failure — GitHub's API
      // being unreachable — and leaves the commoner one uncovered: the API
      // answering while the asset download fails, which would refuse the
      // install with a perfectly good jar sitting on disk.
      const plan = (r: string | null, b: string | null): string =>
        installPlan({
          remote: r ? { version: r } : null,
          bundled: b ? { version: b } : null
        }).join(',')
      if (plan('1.2.0', '1.0.0') !== 'github,bundled') {
        return fail('a failed download would not fall back to the bundled jar: ' + plan('1.2.0', '1.0.0'))
      }
      if (plan('1.0.0', '1.0.0') !== 'github,bundled') return fail('equal versions should still fall back')
      // Downloading a jar older than the one on disk is work done to arrive
      // somewhere worse.
      if (plan('0.9.0', '1.0.0') !== 'bundled') return fail('an older release should not be downloaded')
      if (plan('1.0.0', null) !== 'github') return fail('with no bundled jar there is nothing to fall back to')
      if (plan(null, '1.0.0') !== 'bundled') return fail('with no release the bundled jar is the plan')
      if (plan(null, null) !== '') return fail('with nothing available the plan must be empty')

      // The jar that ships with the app, which is the whole offline story. An
      // absent one would make every assertion above true and the feature
      // useless on the box a server manager actually runs on.
      const bundled = bridgeInstallMod.bundledBridge()
      if (!bundled) return fail('no bridge jar ships with the app')
      if (!bridgeVersionOf(bundled.name)) return fail('the bundled jar is not named like one: ' + bundled.name)
      // ...and it is the jar the sources describe. A committed build output can
      // drift from the code it was built from, and nothing else would notice.
      const declared = /^version:\s*(.+)$/m.exec(
        readFileSync(join(process.cwd(), 'bridge', 'src', 'main', 'resources', 'plugin.yml'), 'utf-8')
      )?.[1]?.trim()
      if (declared !== bundled.version) {
        return fail('the bundled jar is ' + bundled.version + ' but plugin.yml declares ' + declared)
      }
      if (!bridgeInstallMod.bundledBridgeSha256()) return fail('the bundled jar could not be hashed')

      console.log(
        'MODUPDATE-SMOKE: bridge installer OK (asset picked by version, off-GitHub/http/draft/prerelease refused, ' +
          'digest sha256-only, need table, bundled ' + bundled.version + ' matches plugin.yml)'
      )
    }

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
    // The plugin reports through its own logger now rather than System.out, so
    // Paper puts the PLUGIN NAME in front of the marker — and the plugin is
    // called `MSMS-Bridge` while the marker is `[MSMS-BRIDGE]`. Those differ
    // only in case, and the parser slices at the first match: if the two ever
    // became the same string, every message would be cut at the wrong place and
    // parse as nothing. That is one rename away, so it is asserted.
    const viaLogger = parseBridgeLine(
      '[12:34:58 INFO]: [MSMS-Bridge] [MSMS-BRIDGE] {"v":1,"t":"tick","tps":19.5,"tps5":20,"tps15":20,"mspt":4.2}'
    )
    if (!viaLogger || viaLogger.t !== 'tick' || viaLogger.tps !== 19.5) {
      return fail('a tick behind the plugin logger prefix did not parse')
    }
    // Tied to the real sources rather than to a literal: the marker the parser
    // looks for, and the name Paper prints in front of it.
    const pluginName = /^name:\s*(.+)$/m
      .exec(readFileSync(join(process.cwd(), 'bridge', 'src', 'main', 'resources', 'plugin.yml'), 'utf-8'))?.[1]
      ?.trim()
    if (!pluginName) return fail('plugin.yml has no name')
    if (BRIDGE_MARKER === '[' + pluginName + ']') {
      return fail('the marker is identical to the plugin name — the logger prefix would be sliced instead')
    }
    console.log('BRIDGE-SMOKE: marker parsed at column 0, behind [INFO]:, [STDOUT] and the plugin logger prefix')

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
      mspt: 4.0,
      players: [],
      playersTs: 0
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

    // --- 12. chunk areas: the rules four map surfaces have to share (#144) ---
    {
      const at = (rs: number[][]): { x1: number; z1: number; x2: number; z2: number }[] =>
        rs.map((r) => ({ x1: r[0], z1: r[1], x2: r[2], z2: r[3] }))
      const mk = (over: Partial<areasMod.ChunkArea>): areasMod.ChunkArea => ({
        id: 'a',
        name: 'A',
        note: '',
        colour: '#e5484d',
        dim: 'overworld',
        rects: [{ x1: 0, z1: 0, x2: 0, z2: 0 }],
        createdAt: 1,
        updatedAt: 1,
        ...over
      })

      // Corners in any order. An operator dragging up-and-left produces x2 < x1,
      // and a rect stored that way covers nothing at all.
      const back = areasMod.normalizeRect({ x1: 5, z1: 9, x2: 1, z2: 2 })
      if (!back || back.x1 !== 1 || back.x2 !== 5 || back.z1 !== 2 || back.z2 !== 9) {
        return fail('a backwards rect was not straightened: ' + JSON.stringify(back))
      }
      if (areasMod.normalizeRect({ x1: 0, z1: 0, x2: NaN, z2: 0 })) return fail('NaN made a rect')
      const huge = areasMod.normalizeRect({ x1: 0, z1: 0, x2: 9e9, z2: 0 })
      if (!huge || huge.x2 !== areasMod.MAX_CHUNK) return fail('a rect escaped the world border')

      // Merging must not change WHICH chunks are covered - only how they are
      // written down. Four clicked chunks in a row are one rect; the union is
      // identical either way, and that is the property worth testing.
      const clicked = at([[0, 0, 0, 0], [1, 0, 1, 0], [2, 0, 2, 0], [3, 0, 3, 0]])
      const merged = areasMod.normalizeRects(clicked)
      if (merged.length !== 1) return fail('four chunks in a row did not merge: ' + JSON.stringify(merged))
      for (let cx = -1; cx <= 4; cx++) {
        const before = clicked.some((r) => areasMod.rectHas(r, cx, 0))
        const after = merged.some((r) => areasMod.rectHas(r, cx, 0))
        if (before !== after) return fail('merging changed coverage at chunk ' + cx)
      }
      // A rect inside another disappears into it; a duplicate collapses.
      if (areasMod.normalizeRects(at([[0, 0, 9, 9], [2, 2, 3, 3]])).length !== 1) {
        return fail('a contained rect survived')
      }
      if (areasMod.normalizeRects(at([[0, 0, 4, 4], [0, 0, 4, 4]])).length !== 1) {
        return fail('a duplicate rect survived')
      }
      // Rects that merely touch at a corner are not neighbours.
      if (areasMod.normalizeRects(at([[0, 0, 0, 0], [1, 1, 1, 1]])).length !== 2) {
        return fail('two diagonal chunks were merged into one rect')
      }

      // Dimension scoping. Without it, an area drawn in the overworld paints the
      // same rectangle over the nether, where it means nothing.
      const over = mk({ id: 'o', rects: at([[0, 0, 9, 9]]) })
      const nether = mk({ id: 'n', dim: 'nether', rects: at([[0, 0, 9, 9]]) })
      if (areasMod.areaAt([over, nether], 5, 5, 'overworld')?.id !== 'o') return fail('overworld lookup')
      if (areasMod.areaAt([over, nether], 5, 5, 'nether')?.id !== 'n') return fail('nether lookup')
      if (areasMod.areaAt([over], 5, 5, 'nether')) return fail('an overworld area answered in the nether')
      // `the_nether` and `minecraft:the_nether` are the same place.
      if (areasMod.areaAt([nether], 5, 5, 'minecraft:the_nether')?.id !== 'n') return fail('dimension aliasing')

      // Smallest wins, so the specific label beats the containing one.
      const town = mk({ id: 'town', rects: at([[0, 0, 99, 99]]) })
      const plot = mk({ id: 'plot', rects: at([[4, 4, 5, 5]]) })
      if (areasMod.areaAt([town, plot], 5, 5, 'overworld')?.id !== 'plot') return fail('the big area won')
      if (areasMod.areaAt([plot, town], 5, 5, 'overworld')?.id !== 'plot') return fail('order changed the answer')
      if (areasMod.areaAt([town, plot], 50, 50, 'overworld')?.id !== 'town') return fail('outside the plot')
      // Same size: the later edit wins, and the answer is stable either way round.
      const older = mk({ id: 'x', rects: at([[0, 0, 1, 1]]), updatedAt: 10 })
      const newer = mk({ id: 'y', rects: at([[0, 0, 1, 1]]), updatedAt: 20 })
      if (areasMod.areaAt([older, newer], 0, 0, 'overworld')?.id !== 'y') return fail('tie-break')
      if (areasMod.areaAt([newer, older], 0, 0, 'overworld')?.id !== 'y') return fail('tie-break is order-dependent')
      // The indexed form is what renderers use; it must agree with the one-off.
      const idx = areasMod.areaIndex([town, plot], 'overworld')
      if (areasMod.areaAtIndexed(idx, 5, 5)?.id !== 'plot') return fail('the indexed lookup disagrees')

      // What a visitor may read. A field added to `ChunkArea` and forgotten here
      // is how private data reaches a public page, so this asserts the shape
      // exactly rather than spot-checking it.
      const secret = mk({ id: 's', name: 'staff', hidden: true })
      const shown = mk({ id: 'p', name: 'spawn', note: 'bu alan sahibi: CaYatur' })
      const pub = areasMod.publicChunkAreas([secret, shown])
      if (pub.length !== 1 || pub[0].id !== 'p') return fail('a hidden area was published')
      if (pub[0].note !== 'bu alan sahibi: CaYatur') return fail('the note did not survive')
      const keys = Object.keys(pub[0]).sort().join(',')
      if (keys !== 'colour,dim,id,name,note,rects') return fail('public area shape drifted: ' + keys)

      // Typed coordinates, the half that exists because clicking 400 chunks is
      // not a plan. One bad line must not throw away the good ones.
      const typed = areasMod.parseChunkInput('10,20\n30 40 - 32 42\nnonsense\n-5,-5')
      if (typed.bad.length !== 1) return fail('bad lines: ' + JSON.stringify(typed.bad))
      if (!typed.rects.some((r) => areasMod.rectHas(r, 31, 41))) return fail('the ranged line was lost')
      if (!typed.rects.some((r) => areasMod.rectHas(r, -5, -5))) return fail('negative chunks were lost')
      if (typed.rects.some((r) => areasMod.rectHas(r, 11, 20))) return fail('a single chunk grew')

      // Validation, which the API leans on: every refusal names its reason.
      const bad: [string, areasMod.AreaInput][] = [
        ['name-required', { name: '  ', rects: at([[0, 0, 0, 0]]) }],
        ['no-chunks', { name: 'x', rects: [] }],
        ['name-too-long', { name: 'n'.repeat(areasMod.MAX_NAME + 1), rects: at([[0, 0, 0, 0]]) }],
        ['note-too-long', { name: 'x', note: 'n'.repeat(areasMod.MAX_NOTE + 1), rects: at([[0, 0, 0, 0]]) }],
        ['too-many-chunks', { name: 'x', rects: at([[0, 0, 4000, 4000]]) }]
      ]
      for (const [why, input] of bad) {
        const c = areasMod.checkArea(input)
        if (c.ok || c.error !== why) return fail('expected ' + why + ', got ' + JSON.stringify(c))
      }
      const good = areasMod.checkArea({
        name: '  test alanı  ',
        note: 'bu alan sahibi: CaYatur',
        colour: '#ABC',
        dim: 'THE_NETHER',
        rects: at([[3, 3, 3, 3], [4, 3, 4, 3]])
      })
      if (!good.ok) return fail('a good area was refused: ' + good.error)
      if (good.value.name !== 'test alanı') return fail('the name was not trimmed')
      if (good.value.colour !== '#aabbcc') return fail('short hex was not expanded: ' + good.value.colour)
      if (good.value.dim !== 'nether') return fail('the dimension was not normalised: ' + good.value.dim)
      if (good.value.rects.length !== 1) return fail('adjacent chunks were not merged on save')
      if (areasMod.normalizeColour('rgb(1,2,3)') !== areasMod.AREA_COLOURS[0]) return fail('a junk colour got through')

      // Negative block coordinates are the classic off-by-one: `-1/16|0` is 0,
      // which puts the chunk west of spawn one chunk east of it.
      if (areasMod.chunkOf(-1, -1).cx !== -1) return fail('chunkOf rounds negatives towards zero')
      if (areasMod.chunkOf(16, 31).cx !== 1 || areasMod.chunkOf(16, 31).cz !== 1) return fail('chunkOf')
      console.log('WORLDS-SMOKE: chunk areas OK (merge keeps coverage, smallest wins, hidden stays hidden)')
    }

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

  // ---- console line decoding (#83) ----
  // Pure and instant, so it runs before the heavy part: if the console mangles
  // text there is no point starting a server to watch it happen.
  {
    // Turkish, a section-sign colour code, and an emoji: 2-, 2- and 4-byte
    // sequences, which is the whole range of ways a chunk boundary can cut a
    // character in half.
    const line = 'Oyuncu Çağan bağlandı — §aTamam ✅ ğüşiöç\n'
    const bytes = Buffer.from(line, 'utf-8')

    // Split at every single byte offset. Any offset that lands inside a
    // multi-byte sequence is the bug: the old `chunk.toString('utf-8')` emitted
    // U+FFFD there and mis-decoded the continuation bytes in the next chunk.
    for (let cut = 1; cut < bytes.length; cut++) {
      const ls = new LineSplitter()
      const out = [...ls.push(bytes.subarray(0, cut)), ...ls.push(bytes.subarray(cut))]
      if (out.length !== 1 || out[0] !== line.trimEnd()) {
        return fail(`a chunk boundary at byte ${cut} corrupted the line: ${JSON.stringify(out)}`)
      }
    }

    // Prove the assertion above is actually testing something - a naive decode
    // of the same split must fail, or the loop is checking nothing.
    const mid = bytes.indexOf(0xc3) + 1 // inside the two bytes of 'Ç'
    const naive =
      bytes.subarray(0, mid).toString('utf-8') + bytes.subarray(mid).toString('utf-8')
    if (!naive.includes('�')) return fail('the split-character fixture no longer splits one')

    // A shared splitter across two streams must be impossible by construction;
    // interleaving halves through one is exactly the corruption to avoid.
    const shared = new LineSplitter()
    shared.push(bytes.subarray(0, mid))
    const strayOut = shared.push(Buffer.from('stderr noise\n', 'utf-8'))
    if (strayOut.length && strayOut[0] === 'stderr noise') {
      return fail('a shared splitter passed the other stream through cleanly, hiding the hazard')
    }

    // A line with no trailing newline is held, then released on flush - a
    // crashing server ends mid-line and that line is the reason it crashed.
    const tail = new LineSplitter()
    if (tail.push(Buffer.from('java.lang.OutOfMemoryError: Çöp', 'utf-8')).length !== 0) {
      return fail('an unterminated line was emitted before its newline')
    }
    if (!tail.pending) return fail('an unterminated line was not held')
    if (tail.flush() !== 'java.lang.OutOfMemoryError: Çöp') return fail('flush lost the last line')
    if (tail.flush() !== '') return fail('flush returned the same line twice')
    // Flushed on both 'exit' and 'close', so it has to stay usable afterwards:
    // decoder.end() must not leave the splitter unable to decode a later chunk.
    const late = [...tail.push(Buffer.from('geç', 'utf-8')), tail.flush()]
    if (late.join('') !== 'geç') return fail('the splitter stopped working after a flush')

    // Multiple lines in one chunk, and CRLF, both still work.
    const multi = new LineSplitter().push(Buffer.from('bir\r\niki\r\nüç\n', 'utf-8'))
    if (multi.join('|') !== 'bir|iki|üç') return fail('multi-line chunk split wrong: ' + multi.join('|'))
    console.log('SMOKE: console decoding OK (no byte offset can split a character)')

    // Decoding correctly only helps if the server wrote UTF-8 in the first
    // place. It does not by default: on a Turkish Windows with Temurin 21,
    // `System.out` used cp1254 and dropped a checkmark to a literal `?`.
    const argCfg = {
      preset: 'aikars' as const,
      javaPath: '',
      minMemoryMB: 2048,
      maxMemoryMB: 4096,
      extraFlags: '',
      customArgs: '',
      nogui: true,
      jarFile: 'server.jar'
    }
    for (const preset of ['aikars', 'basic', 'proxy', 'custom'] as const) {
      const args = buildLaunchArgs({ ...argCfg, preset, customArgs: '-jar server.jar' }, 'paper')
      for (const p of ['stdout.encoding', 'stderr.encoding', 'sun.stdout.encoding', 'sun.stderr.encoding']) {
        if (!args.includes('-D' + p + '=UTF-8')) return fail(`${preset} preset does not set -D${p}`)
      }
      // Before -jar / @argsfile, or the JVM treats them as program arguments.
      const firstProgramArg = args.findIndex((a) => a === '-jar' || a.startsWith('@'))
      const lastEnc = args.map((a) => a.startsWith('-Dstdout.encoding')).lastIndexOf(true)
      if (firstProgramArg >= 0 && lastEnc > firstProgramArg) {
        return fail(`${preset} put an encoding flag after -jar, where the JVM ignores it`)
      }
    }
    // ...and the user still gets the last word, because the JVM takes the last
    // definition of a property on the command line.
    const overridden = buildLaunchArgs(
      { ...argCfg, extraFlags: '-Dstdout.encoding=windows-1254' },
      'paper'
    )
    const encFlags = overridden.filter((a) => a.startsWith('-Dstdout.encoding='))
    if (encFlags[encFlags.length - 1] !== '-Dstdout.encoding=windows-1254') {
      return fail('a user-set console encoding did not survive as the last one')
    }
    console.log('SMOKE: launch args force UTF-8 console output on every preset, user-overridable')
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
  // ---- the Store view, mounted for real ----
  //
  // The tab sweep above proves nothing crashes, which is not the same as
  // nothing being broken. A `t()` call for a key that exists in neither locale
  // renders the key itself - `common.clear` did exactly that - and TypeScript
  // cannot catch it, because `tr` is typed as `typeof en` and both were simply
  // missing it. So: open the product editor and assert no raw key is on screen.
  {
    await win.webContents.executeJavaScript(`document.querySelector('.server-item')?.click()`)
    await sleep(250)
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.tab')].find(b=>/Store|Mağaza/i.test(b.textContent||''))?.click()`
    )
    await sleep(300)
    // The catalogue lives behind the second section tab.
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.tabs .tab')].pop()?.click()`
    )
    await sleep(250)
    // "Add crate" opens the editor with every new control on it.
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('button')].find(b=>/Add crate|Sandık ekle|Kasa ekle/i.test(b.textContent||''))?.click()`
    )
    await sleep(400)
    if (await viewCrashed()) return fail('the store product editor crashed on mount')

    // Put a value in the icon field first. Half the controls on an image field
    // only exist once it has one - the clear button among them - so probing an
    // untouched editor would miss exactly the strings least likely to be
    // translated. React owns the input, so the native setter plus a bubbling
    // event is what makes it notice.
    await win.webContents.executeJavaScript(`(()=>{
      const inp = document.querySelector('input[placeholder*="uploads"]');
      if (!inp) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, 'https://example.invalid/icon.png');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)
    await sleep(250)

    const storeProbe = await win.webContents.executeJavaScript(`(()=>{
      // Attributes as well as text. A missing key is just as broken in a
      // tooltip, and innerText does not contain one - the first version of this
      // assertion read only innerText and passed with common.clear missing,
      // which is the exact bug it was written for.
      let hay = document.body.innerText || '';
      for (const el of document.querySelectorAll('[title],[placeholder],[aria-label]')) {
        hay += ' ' + (el.getAttribute('title') || '') +
               ' ' + (el.getAttribute('placeholder') || '') +
               ' ' + (el.getAttribute('aria-label') || '');
      }
      // A translation key that resolved to nothing looks exactly like its key.
      const raw = (hay.match(/\\b(?:store|common|web)\\.[a-zA-Z_][a-zA-Z0-9_.-]*/g) || []);
      return JSON.stringify({
        raw: [...new Set(raw)],
        modal: !!document.querySelector('.modal'),
        anim: [...document.querySelectorAll('select')].some(s =>
          [...s.options].some(o => /reel/i.test(o.value))),
        imageFields: document.querySelectorAll('input[placeholder*="uploads"]').length
      })
    })()`)
    const sp = JSON.parse(storeProbe) as {
      raw: string[]
      modal: boolean
      anim: boolean
      imageFields: number
    }
    if (!sp.modal) return fail('the store product editor did not open; probe=' + storeProbe)
    if (sp.raw.length) return fail('untranslated keys rendered in the store view: ' + sp.raw.join(', '))
    if (!sp.anim) return fail('the crate editor has no animation picker (#75)')
    if (sp.imageFields < 1) return fail('the crate editor has no image field (#76)')
    // Close it again so the file-editor assertions below start from a clean view.
    await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.modal-actions button')][0]?.click()`
    )
    await sleep(200)
    console.log(
      'SMOKE: store editor OK (opens, animation picker + image fields present, no untranslated keys)'
    )
  }

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

    // Restoring a backup over a LIVE world corrupts it - the server holds region
    // files open and writes its in-memory state back on its own schedule. The
    // desktop only ever warned about it in a dialog ("Stop the server first"),
    // which an API caller never reads, and core had no guard at all until #53
    // made restore reachable over HTTP.
    const made = await backupsMod.createBackup(id, { kind: 'full' })
    let restoreRefused = ''
    try {
      backupsMod.restoreBackup(made.id)
    } catch (e) {
      restoreRefused = String((e as Error)?.message ?? e)
    }
    backupsMod.deleteBackup(made.id)
    if (restoreRefused !== 'server-running') {
      return fail('restoring a backup while running was refused with "' + restoreRefused + '"')
    }
    console.log('SMOKE: restore refused while the server is running')
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
/**
 * Run one of the served pages' inline `<script>` in a stub DOM.
 *
 * The panel and the website are hand-written vanilla JS inside a TypeScript
 * template literal, which means every backslash resolves twice and nothing
 * type-checks it. A mis-escaped quote produces a page that throws on load and
 * shows a blank screen - and the only thing that catches it today is opening a
 * browser. This makes the parse itself an assertion, and lets a test click
 * through the parts that build markup.
 *
 * Only what the exercised code paths touch is stubbed; a missing capability
 * shows up as a thrown error, which is the correct outcome.
 */
interface StubNode {
  id: string
  innerHTML: string
  textContent: string
  value: string
  checked: boolean
  className: string
  style: Record<string, string> & { cssText?: string; setProperty(k: string, v: string): void }
  lang?: string
  classList: {
    add(c: string): void
    remove(c: string): void
    toggle(c: string, on?: boolean): void
    contains(c: string): boolean
  }
  children: StubNode[]
  querySelector(): StubNode
  querySelectorAll(): StubNode[]
  appendChild(): void
  addEventListener(): void
  focus(): void
  setSelectionRange(): void
  width: number
  height: number
  getBoundingClientRect(): { width: number; height: number; top: number; left: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getContext(): any
}

interface PageRun {
  ctx: Record<string, unknown>
  byId(id: string): StubNode
  calls: unknown[][]
}

function runPageScript(html: string, seed: Record<string, unknown> = {}): PageRun {
  const m = html.match(/<script>([\s\S]*?)<\/script>/)
  if (!m) throw new Error('page has no inline script')

  const nodes = new Map<string, StubNode>()
  const mkNode = (id: string): StubNode => {
    const cls = new Set<string>()
    const n: StubNode = {
      id,
      innerHTML: '',
      textContent: '',
      value: '',
      checked: false,
      className: '',
      lang: '',
      style: Object.assign(Object.create(null), { setProperty: () => {} }),
      classList: {
        add: (c) => void cls.add(c),
        remove: (c) => void cls.delete(c),
        toggle: (c, on) => {
          if (on === undefined) cls.has(c) ? cls.delete(c) : cls.add(c)
          else if (on) cls.add(c)
          else cls.delete(c)
        },
        contains: (c) => cls.has(c)
      },
      children: [],
      querySelector: () => mkNode(''),
      querySelectorAll: () => [],
      appendChild: () => {},
      addEventListener: () => {},
      focus: () => {},
      setSelectionRange: () => {},
      // Enough of a canvas for the map to run its drawing pass. Nothing is
      // rasterised — what is being asserted is the wiring and the text around
      // it, not the pixels.
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ width: 640, height: 400, top: 0, left: 0 }),
      getContext: () => ({
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        arc: () => {},
        fill: () => {},
        fillRect: () => {},
        fillText: () => {},
        // Areas draw outlines and a dashed selection (#144). A stub that is
        // missing a method the page calls fails the whole run with a TypeError,
        // which reads like a bug in the page rather than a gap in the stub.
        strokeRect: () => {},
        strokeText: () => {},
        setLineDash: () => {},
        drawImage: () => {},
        set font(_v: string) {},
        set fillStyle(_v: string) {},
        set strokeStyle(_v: string) {},
        set lineWidth(_v: number) {},
        set textAlign(_v: string) {},
        set textBaseline(_v: string) {}
      })
    }
    return n
  }
  // Pre-create every id the markup declares, so a lookup that should succeed
  // does, and one for an element that does not exist still returns something
  // rather than throwing in a way that hides the real assertion.
  for (const id of html.matchAll(/id="([^"]+)"/g)) nodes.set(id[1], mkNode(id[1]))

  const calls: unknown[][] = []
  const document = {
    getElementById: (id: string): StubNode => {
      if (!nodes.has(id)) nodes.set(id, mkNode(id))
      return nodes.get(id) as StubNode
    },
    // The pages escape by round-tripping through textContent/innerHTML, so the
    // stub has to actually escape or every escaping assertion would pass.
    createElement: (): StubNode => {
      const n = mkNode('')
      let text = ''
      Object.defineProperty(n, 'textContent', {
        get: () => text,
        set: (v: string) => {
          text = v == null ? '' : String(v)
        }
      })
      Object.defineProperty(n, 'innerHTML', {
        get: () => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        set: (v: string) => {
          text = v
        }
      })
      return n
    },
    querySelector: (): StubNode => mkNode(''),
    querySelectorAll: (): StubNode[] => [],
    addEventListener: () => {},
    head: mkNode('head'),
    body: mkNode('body'),
    // Both pages set `documentElement.lang` and read `.style` off it on load.
    documentElement: mkNode('html')
  }

  const ctx: Record<string, unknown> = {
    document,
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    location: { hash: '#/' },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    // Pages load avatars and bake tiles with these. Present but inert: the
    // assertions are about the wiring and the text, never the pixels.
    Image: class {
      crossOrigin = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_v: string) {
        /* never resolves, so a head stays the dot — which is the fallback path */
      }
    },
    alert: (msg: string) => calls.push(['alert', msg]),
    confirm: () => true,
    encodeURIComponent,
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollTo: () => {},
    scrollY: 0,
    innerWidth: 1280,
    innerHeight: 800,
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    IntersectionObserver: class {
      observe(): void {}
      disconnect(): void {}
    },
    navigator: { language: 'en', languages: ['en'], clipboard: { writeText: () => Promise.resolve() } },
    fetch: (path: string, opts?: { method?: string; body?: string }) => {
      calls.push(['fetch', path, opts?.method ?? 'GET', opts?.body])
      // Both pages call something on load. An empty `{}` makes those bootstrap
      // paths throw asynchronously, and an unhandled rejection in the test
      // output is how a real one later goes unnoticed — so the shapes they
      // destructure on startup are answered plausibly.
      // The map feed, so `mapRefresh` can be exercised end to end through each
      // page's own api() (#115). Answering the generic `{servers:[],...}` here
      // would make the refresh bail on a missing `dimension` and hide exactly
      // the failure the assertion is for.
      const body: Record<string, unknown> = /\/map(\?|$)/.test(path)
        ? {
            bridge: false,
            dimension: 'overworld',
            dimensions: ['overworld'],
            players: [],
            bounds: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 },
            heatmap: [],
            cell: 16,
            at: Date.now()
          }
        : path.includes('/api/public/site')
        ? {
            siteName: 'Test',
            tagline: '',
            description: '',
            servers: [],
            posts: [],
            showStore: true,
            i18n: { defaultLang: 'en', langs: { en: {} } }
          }
        : { servers: [], products: [], lines: [], entries: [] }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    },
    ...seed
  }
  ctx['window'] = ctx
  ctx['globalThis'] = ctx
  // Throws on a syntax error, which is the first thing this is here to catch.
  runInNewContext(m[1], ctx, { filename: 'page.js' })
  Object.assign(ctx, seed) // seeds that the script's own `var` declarations reset
  return { ctx, byId: (id) => document.getElementById(id), calls }
}

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
  const del = (p: string, tok?: string): Promise<Response> =>
    fetch(base + p, {
      method: 'DELETE',
      headers: tok ? { Authorization: 'Bearer ' + tok } : {}
    })
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
    // Driven through the public site, which since #102 is the only surface that
    // buys. The panel route was removed: it spent currency behind a `view` gate.
    {
      const storeServerBefore = siteMod.getSiteConfig().storeServerId
      siteMod.setSiteConfig({ storeServerId: id })
      economy.addBalance(id, 'Tester', 100, { by: 'desktop', source: 'panel' })
      const prod = economy.upsertProduct(id, {
        id: '',
        type: 'item',
        name: 'TestItem',
        description: '',
        price: 100,
        commands: ['say {player} bought TestItem'],
        rewards: []
      } as Product)
      webPlayerAuth._testCreateAccount('Tester', 'testerpass')
      const lr = await spost('/api/public/login', { mcName: 'Tester', password: 'testerpass' })
      const tt = ((await lr.json()) as { token: string }).token
      if (!tt) return fail('the double-spend probe could not sign in as a player')
      const buy = (): Promise<Response> =>
        spost('/api/public/store/buy', { productId: prod.id }, tt)
      const [r1, r2] = await Promise.all([buy(), buy()])
      const codes = [r1.status, r2.status].sort((a, b) => a - b)
      if (!(codes[0] === 200 && codes[1] === 402)) {
        return fail('double-spend expected [200,402], got [' + codes.join(',') + ']')
      }
      const finalBal = economy.getBalance(id, 'Tester')
      if (finalBal !== 0) return fail('double-spend balance should be 0, got ' + finalBal)

      // ...and the panel cannot buy at all — checked with the OWNER token, so a
      // refusal cannot be mistaken for a missing scope. Removing the Buy button
      // while leaving the route would keep the part that costs money.
      const gone = await post('/api/servers/' + id + '/store/buy', { productId: prod.id }, ot)
      if (gone.status !== 404) {
        return fail('the panel buy route answered ' + gone.status + ' to an owner, expected 404')
      }
      if (economy.getBalance(id, 'Tester') !== 0) return fail('the panel buy route spent currency')

      economy.deleteProduct(id, prod.id)
      siteMod.setSiteConfig({ storeServerId: storeServerBefore })
      console.log('WEB-SMOKE: double-spend prevented (one 200, one 402, balance 0); panel buy route gone')
    }

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

    // ---- balance administration is in the audit trail (#68) ----
    // A player spending currency was audited as `purchase`; an admin creating
    // currency out of nothing was not, which left the higher-privilege action
    // of the two out of the global trail.
    {
      const af = join(auditDir(), 'audit.jsonl')
      const snap = existsSync(af) ? readFileSync(af, 'utf-8') : null
      try {
        rmSync(af, { force: true })
        auditMod._reset()

        // web panel: grant, remove, set — all three, all attributed
        await post(balUrl, { mcName: 'Auditee', amount: 500, reason: 'event' }, ot)
        await post(balUrl, { mcName: 'Auditee', amount: -200 }, ot)
        await post(balUrl, { mcName: 'Auditee', amount: 42, mode: 'set' }, ot)
        // ...and a refusal, which is itself interesting
        const badName = await post(balUrl, { mcName: 'no', amount: 1 }, ot)
        if (badName.status !== 400) return fail('an invalid mc name expected 400, got ' + badName.status)

        const entries = auditMod.query({ actions: ['balance.grant', 'balance.remove', 'balance.set'] }).entries
        const kinds = new Set(entries.map((e) => e.action))
        for (const k of ['balance.grant', 'balance.remove', 'balance.set']) {
          if (!kinds.has(k)) return fail('no audit entry for ' + k)
        }
        if (!entries.every((e) => e.actor === 'owner_t')) {
          return fail('a balance audit entry lost its actor: ' + entries.map((e) => e.actor).join(','))
        }
        if (!entries.every((e) => e.serverId === id)) return fail('a balance audit entry lost its server')
        if (!entries.some((e) => e.ok === false && e.detail === 'invalid-mcname')) {
          return fail('a refused balance change was not audited')
        }
        if (!entries.some((e) => e.source === 'webpanel')) return fail('web balance change not sourced webpanel')

        // The recorded delta must be what was APPLIED, not what was asked for:
        // addBalance clamps at zero, so removing more than the balance holds
        // removes only what is there.
        economy.setBalance(id, 'Auditee', 300, { by: 'desktop', source: 'panel' })
        auditMod._reset()
        rmSync(af, { force: true })
        economy.addBalance(id, 'Auditee', -500, { by: 'desktop', source: 'panel' })
        const clamped = auditMod.query({ actions: ['balance.remove'] }).entries[0]
        if (!clamped) return fail('a clamped removal was not audited')
        if (!clamped.detail?.startsWith('-300 -> 0')) {
          return fail('audit recorded the requested amount, not the applied one: ' + clamped.detail)
        }
        if (clamped.source !== 'panel') return fail('a desktop balance change was not sourced panel')

        // An API key doing it is distinguishable from a human session.
        const k = apikeys.createKey({ label: 'smoke_bal', scopes: ['store'], servers: [id] })
        auditMod._reset()
        rmSync(af, { force: true })
        const viaKey = await fetch(base + balUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': k.secret },
          body: JSON.stringify({ mcName: 'Auditee', amount: 7 })
        })
        if (viaKey.status !== 200) return fail('key balance grant expected 200, got ' + viaKey.status)
        const keyEntries = auditMod.query({ actions: ['balance.grant'] }).entries
        if (!keyEntries.some((e) => e.source === 'api' && e.actor.startsWith('key:'))) {
          return fail('a key-driven balance change was not attributed to the key')
        }
        apikeys.deleteKey(k.key.id)

        // The panel used to buy, unaudited, on a `view` gate. Both halves are
        // gone with the route (#102); what still has to hold is that the
        // surface which DOES buy records it. Attribution matters more here than
        // it did in the panel: the actor is a player, not an account an
        // operator can look up.
        {
          const storeServerBefore = siteMod.getSiteConfig().storeServerId
          siteMod.setSiteConfig({ storeServerId: id })
          const prod = economy.upsertProduct(id, {
            id: '',
            type: 'item',
            name: 'AuditBuy',
            description: '',
            price: 1,
            commands: [],
            rewards: []
          } as Product)
          economy.addBalance(id, 'Auditee', 10, { by: 'smoke', source: 'panel' })
          auditMod._reset()
          rmSync(af, { force: true })
          webPlayerAuth._testCreateAccount('Auditee', 'auditeepass')
          const alr = await spost('/api/public/login', { mcName: 'Auditee', password: 'auditeepass' })
          const apt = ((await alr.json()) as { token: string }).token
          const bought = await spost('/api/public/store/buy', { productId: prod.id }, apt)
          if (bought.status !== 200) return fail('public buy expected 200, got ' + bought.status)
          const buys = auditMod.query({ actions: ['purchase'] }).entries
          if (!buys.some((e) => e.source === 'public' && e.actor === 'Auditee')) {
            return fail('a purchase made from the public site was not audited')
          }
          economy.deleteProduct(id, prod.id)
          siteMod.setSiteConfig({ storeServerId: storeServerBefore })
        }
        console.log('WEB-SMOKE: balance administration + public purchases audited (per source, applied delta, refusals)')
      } finally {
        if (snap == null) rmSync(af, { force: true })
        else writeFileSync(af, snap, 'utf-8')
      }
    }

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

    // ---- a paid reward is never dropped (#106) ----
    {
      const pendUrl = '/api/servers/' + id + '/store/admin/pending'
      const relUrl = '/api/servers/' + id + '/store/admin/deliver'
      const item: Product = {
        id: '',
        type: 'item',
        name: 'Delivery Probe',
        description: '',
        price: 1,
        commands: ['give {player} minecraft:stone 1'],
        rewards: []
      } as Product
      r = await post('/api/servers/' + id + '/store/admin/product', item, ot)
      const probe = (await r.json()) as Product
      const before = economy.pendingDeliveries(id).length
      economy.setBalance(id, 'Steve', 50, { by: 'smoke', source: 'system', reason: 'probe' })
      const bought = economy.purchase(id, 'Steve', probe.id)
      if (!bought.ok) return fail('the delivery probe purchase failed: ' + JSON.stringify(bought))
      // The fixture server is not running, so nothing can carry the command.
      // The old code called runCommands anyway — it did nothing, and the entry
      // had already been removed from the queue. The reward simply vanished.
      await sleep(50)
      const pend = economy.pendingDeliveries(id)
      if (pend.length !== before + 1) {
        return fail('a purchase with no running server left ' + (pend.length - before) + ' entries, expected 1')
      }
      const held = pend[0]
      if (held.reason !== 'server-down') return fail('held for the wrong reason: ' + held.reason)
      if (held.rewardName !== 'Delivery Probe') return fail('the held entry lost the reward name')

      // Visible to an operator, scope-gated like the rest of the store.
      r = await get(pendUrl, ft)
      if (r.status !== 403) return fail('pending list without store scope expected 403, got ' + r.status)
      r = await get(pendUrl, ot)
      if (r.status !== 200) return fail('pending list expected 200, got ' + r.status)
      const listed = (await r.json()) as { pending: { id: string; reason: string }[] }
      if (!listed.pending.some((p) => p.id === held.id)) return fail('the held reward is not listed')

      // Releasing while nothing can carry the command must fail AND keep it.
      // The whole point of the rewrite: a failed hand-over never dequeues.
      r = await post(relUrl, { queueId: held.id }, ot)
      if (r.status !== 409) return fail('releasing with the server down expected 409, got ' + r.status)
      if (!economy.pendingDeliveries(id).some((p) => p.id === held.id)) {
        return fail('a failed release removed the reward anyway')
      }
      r = await post(relUrl, { queueId: 'no-such-entry' }, ot)
      if (r.status !== 404) return fail('releasing an unknown entry expected 404, got ' + r.status)

      await post('/api/servers/' + id + '/store/admin/delete', { productId: probe.id }, ot)
      console.log('WEB-SMOKE: delivery queue OK (held with a reason, listed, and a failed release keeps it)')
    }

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

    // ---- who may claim a name, and how (#105) ----
    {
      // Every combination, with the expected verdict written out here rather
      // than computed by calling the function under test. A table that derives
      // its own answers passes whatever the code happens to do.
      const D = (i: {
        purpose: 'register' | 'reset'
        validName?: boolean
        onlineMode?: boolean
        serverUp?: boolean
        playerOnline?: boolean
        accountExists?: boolean
        rateLimited?: boolean
      }): string => {
        const d = verifyDecision({
          purpose: i.purpose,
          validName: i.validName !== false,
          onlineMode: i.onlineMode !== false,
          serverUp: i.serverUp !== false,
          playerOnline: i.playerOnline !== false,
          accountExists: !!i.accountExists,
          rateLimited: !!i.rateLimited
        })
        return d.action === 'refuse' ? 'refuse:' + d.reason : d.action
      }
      const rows: [string, Parameters<typeof D>[0], string][] = [
        ['a normal registration', { purpose: 'register' }, 'issue'],
        ['a normal reset', { purpose: 'reset', accountExists: true }, 'issue'],
        // THE point of the issue. On a cracked server anyone can join as
        // anyone, so the whisper proves nothing and a human decides.
        ['reset on a cracked server', { purpose: 'reset', accountExists: true, onlineMode: false }, 'approve'],
        // ...and the same gate on registration, or the easier door stays open:
        // registration overwrites an existing account's password, so it IS a
        // reset by another name.
        ['registration on a cracked server', { purpose: 'register', onlineMode: false }, 'approve'],
        ['a bad name', { purpose: 'register', validName: false }, 'refuse:invalid-name'],
        // Rate limiting outranks everything that reads state, so probing cannot
        // enumerate anything faster than the limit allows.
        ['a rate-limited bad name', { purpose: 'register', validName: false, rateLimited: true }, 'refuse:invalid-name'],
        ['a rate-limited reset', { purpose: 'reset', accountExists: true, rateLimited: true }, 'refuse:rate-limited'],
        ['a rate-limited cracked reset', { purpose: 'reset', accountExists: true, onlineMode: false, rateLimited: true }, 'refuse:rate-limited'],
        ['reset for a name with no account', { purpose: 'reset' }, 'refuse:no-account'],
        // ...and a missing account is decided AFTER the server checks, so a
        // reset for a name nobody owns is indistinguishable from any other
        // request that could not be started.
        ['no account and the server is down', { purpose: 'reset', serverUp: false }, 'refuse:server-offline'],
        ['no account and nobody online', { purpose: 'reset', playerOnline: false }, 'refuse:not-online'],
        ['server down', { purpose: 'register', serverUp: false }, 'refuse:server-offline'],
        ['player not online', { purpose: 'register', playerOnline: false }, 'refuse:not-online'],
        // Offline mode does not rescue a player who is not there: the code is
        // whispered in game either way.
        ['cracked and not online', { purpose: 'register', onlineMode: false, playerOnline: false }, 'refuse:not-online']
      ]
      for (const [label, input, expected] of rows) {
        const got = D(input)
        if (got !== expected) return fail('verify "' + label + '" gave ' + got + ', expected ' + expected)
      }

      // The exhaustive sweep, checking the one invariant that matters: the
      // in-game code is NEVER issued on its own when the server cannot say who
      // is holding the keyboard.
      let swept = 0
      for (const purpose of ['register', 'reset'] as const) {
        for (const validName of [true, false]) {
          for (const onlineMode of [true, false]) {
            for (const serverUp of [true, false]) {
              for (const playerOnline of [true, false]) {
                for (const accountExists of [true, false]) {
                  for (const rateLimited of [true, false]) {
                    const d = verifyDecision({
                      purpose, validName, onlineMode, serverUp, playerOnline, accountExists, rateLimited
                    })
                    swept++
                    if (d.action === 'issue' && !onlineMode) {
                      return fail(
                        'a code was issued on a cracked server: ' +
                          JSON.stringify({ purpose, playerOnline, accountExists })
                      )
                    }
                    if (d.action !== 'refuse' && !validName) return fail('an invalid name got past the gate')
                    if (d.action !== 'refuse' && rateLimited) return fail('a rate-limited request got past the gate')
                    if (d.action !== 'refuse' && !playerOnline) {
                      return fail('a code was issued to a player who is not there')
                    }
                  }
                }
              }
            }
          }
        }
      }

      // What the caller is told. A reset for a name with no account must look
      // exactly like one for a name that has one, or the endpoint becomes an
      // account-enumeration oracle answering one name per request.
      //
      // Checked on BOTH kinds of server. Checking only the online-mode one
      // passes while the hole is open on the other — and the cracked server is
      // where it matters most, because that is where taking an account over is
      // easiest to begin with.
      const base = { validName: true, serverUp: true, playerOnline: true, rateLimited: false }
      for (const onlineMode of [true, false]) {
        const noAcc = publicVerifyReply(
          verifyDecision({ ...base, onlineMode, purpose: 'reset', accountExists: false })
        )
        const hasAcc = publicVerifyReply(
          verifyDecision({ ...base, onlineMode, purpose: 'reset', accountExists: true })
        )
        if (JSON.stringify(noAcc) !== JSON.stringify(hasAcc)) {
          return fail(
            'a reset revealed whether the account exists (online-mode=' + onlineMode + '): ' +
              JSON.stringify(noAcc) + ' vs ' + JSON.stringify(hasAcc)
          )
        }
      }
      // ...and the same for registration, which answers for any name at all.
      for (const onlineMode of [true, false]) {
        const reg = publicVerifyReply(
          verifyDecision({ ...base, onlineMode, purpose: 'register', accountExists: false })
        )
        const res = publicVerifyReply(
          verifyDecision({ ...base, onlineMode, purpose: 'reset', accountExists: true })
        )
        if (JSON.stringify(reg) !== JSON.stringify(res)) {
          return fail('register and reset are distinguishable (online-mode=' + onlineMode + ')')
        }
      }
      // ...and no reply ever carries a code.
      for (const d of [
        verifyDecision({ ...base, onlineMode: true, purpose: 'register', accountExists: false }),
        verifyDecision({ ...base, onlineMode: false, purpose: 'reset', accountExists: true })
      ]) {
        if (/\d{6}/.test(JSON.stringify(publicVerifyReply(d)))) {
          return fail('a start reply carried something code-shaped')
        }
      }
      console.log(
        'WEB-SMOKE: player verification OK (12 rows, ' + swept +
          ' combinations, no code without online-mode, no enumeration)'
      )
    }

    // ---- who may read a profile (#107) ----
    {
      const ALL: ProfileField[] = [
        'identity', 'dates', 'playtime', 'inventory', 'enderChest', 'stats', 'location'
      ]
      const OPEN: ProfileField[] = ['identity', 'dates', 'playtime']
      const GATED: ProfileField[] = ['inventory', 'enderChest', 'stats', 'location']
      const viewers: ProfileViewer[] = ['owner', 'stranger', 'anonymous']

      // Exhaustive: every field, every viewer, every combination of the four
      // toggles. The expected answer is stated here as a rule, not read back
      // from the function being tested.
      let checked = 0
      for (let mask = 0; mask < 16; mask++) {
        const pub: ProfilePublishing = {
          inventory: !!(mask & 1),
          enderChest: !!(mask & 2),
          stats: !!(mask & 4),
          location: !!(mask & 8)
        }
        for (const viewer of viewers) {
          for (const field of ALL) {
            const expected = OPEN.includes(field) || viewer === 'owner' || pub[field as keyof ProfilePublishing]
            const got = canSee(field, viewer, pub)
            checked++
            if (got !== !!expected) {
              return fail(
                'profile visibility wrong for ' + field + '/' + viewer + ' with ' + JSON.stringify(pub)
              )
            }
          }
        }
      }
      // The two rules that matter, stated separately so a change to the loop
      // above cannot quietly take them with it.
      for (const field of GATED) {
        if (canSee(field, 'stranger', PROFILE_PUBLISHING_DEFAULTS)) {
          return fail('a stranger can read ' + field + ' by default')
        }
        if (canSee(field, 'anonymous', PROFILE_PUBLISHING_DEFAULTS)) {
          return fail('an anonymous visitor can read ' + field + ' by default')
        }
        if (!canSee(field, 'owner', PROFILE_PUBLISHING_DEFAULTS)) {
          return fail('a player cannot read their own ' + field)
        }
      }

      // Redaction OMITS. A field the viewer may not see must be absent from the
      // payload, not sent and hidden in the page — a page can be read with the
      // network tab open.
      const full: FullProfile = {
        mcName: 'Steve',
        uuid: 'u-1',
        registeredAt: 1,
        lastSeen: 2,
        playtimeHours: 3,
        inventory: [{ slot: 0, id: 'minecraft:diamond', count: 64 }],
        enderChest: [{ slot: 0, id: 'minecraft:netherite_ingot', count: 1 }],
        stats: { health: 20, food: 20, xpLevel: 30 },
        location: { x: 100, y: 12, z: -400, dimension: 'overworld' }
      }
      const strangerView = redactProfile(full, 'stranger', PROFILE_PUBLISHING_DEFAULTS) as unknown as Record<string, unknown>
      for (const f of GATED) {
        if (f in strangerView) return fail('a stranger payload carries "' + f + '"')
      }
      if (JSON.stringify(strangerView).includes('netherite')) {
        return fail('a withheld field leaked into the payload anyway')
      }
      if (strangerView.mcName !== 'Steve') return fail('redaction dropped the name')
      // ...and the page is told what was withheld, so it can say so rather than
      // simply stopping.
      const hidden = strangerView.hidden as string[]
      for (const f of GATED) {
        if (!hidden.includes(f)) return fail('the payload did not report "' + f + '" as withheld')
      }

      // Each toggle removes exactly its own field and nothing else.
      for (const only of GATED) {
        const pub = { ...PROFILE_PUBLISHING_DEFAULTS, [only]: true } as ProfilePublishing
        const view = redactProfile(full, 'stranger', pub) as unknown as Record<string, unknown>
        if (!(only in view)) return fail('turning on ' + only + ' did not publish it')
        for (const other of GATED) {
          if (other !== only && other in view) {
            return fail('turning on ' + only + ' also published ' + other)
          }
        }
      }
      // The owner sees everything regardless of the toggles.
      const ownView = redactProfile(full, 'owner', PROFILE_PUBLISHING_DEFAULTS) as unknown as Record<string, unknown>
      for (const f of GATED) {
        if (!(f in ownView)) return fail('a player could not see their own ' + f)
      }
      if ((ownView.hidden as string[]).length !== 0) return fail('an owner was told something was withheld')

      // ---- heads and item icons (#116) ----
      {
        // Keyed by NAME. Keyed by uuid, every head on an offline-mode server
        // was a broken image, because the uuid MSMS holds there is the derived
        // offline one and no skin service has ever seen it. A uuid must not be
        // able to masquerade as a name and end up in the URL.
        const offlineUuid = 'f84c6a79-0a4e-45e0-879b-cd49ebd4c4e2'
        if (avatarUrl(offlineUuid).includes(offlineUuid)) {
          return fail('a uuid reached the avatar URL — heads are keyed by name')
        }
        if (!avatarUrl('CaYatur').includes('CaYatur')) return fail('the avatar URL lost the name')
        // A name is interpolated into a URL path, so anything that is not one
        // has to become the fallback face rather than escape the path.
        for (const bad of ['../../etc/passwd', 'a b', '', 'x'.repeat(40), 'Steve?x=1']) {
          const u = avatarUrl(bad)
          if (!u.includes('/Steve/')) return fail('a bad name was not replaced: ' + JSON.stringify(bad))
          if (/[?#]|\.\./.test(u.slice('https://minotar.net/helm/'.length))) {
            return fail('a bad name escaped the URL path: ' + JSON.stringify(bad))
          }
        }
        // Sizes are clamped: the value reaches a path segment.
        if (!/\/512\.png$/.test(avatarUrl('Steve', 99999))) return fail('avatar size was not clamped')

        // Item ids come out of a player's NBT, which a modded or hand-edited
        // item can put anything into.
        if (itemIconId('minecraft:water_bucket') !== 'water_bucket') return fail('the namespace was not stripped')
        for (const bad of ['../evil', 'a b', 'x/y', '', 'a'.repeat(80)]) {
          if (itemIconId(bad) !== '') return fail('a bad item id was accepted: ' + JSON.stringify(bad))
          if (itemIconUrl(bad) !== '') return fail('a bad item id produced a URL: ' + JSON.stringify(bad))
        }
        // ...and the fallback text is always available, which is what the slot
        // shows when the picture cannot be fetched.
        if (itemLabel('minecraft:netherite_ingot') !== 'Netherite Ingot') {
          return fail('the item label is not readable: ' + itemLabel('minecraft:netherite_ingot'))
        }
        if (itemLabel('') !== '?') return fail('an empty item id has no label')
      }

      // ---- pinning the public map to one world (#137) ----
      {
        const before = siteMod.getSiteConfig().map
        try {
          siteMod.setSiteConfig({ map: { ...before, enabled: true, serverId: id, fixedDim: 'nether' } })
          const cfg = siteMod.publicMapConfig()
          if (cfg?.fixedDim !== 'nether') return fail('the pinned world did not survive the config')

          // A dimension name becomes a path segment when the tiles are read, so
          // anything that is not a plain name is refused at the boundary rather
          // than trusted at the point of use.
          for (const bad of ['../../etc', 'a/b', '..', '.', 'x'.repeat(80), 'a b']) {
            siteMod.setSiteConfig({ map: { ...before, enabled: true, serverId: id, fixedDim: bad } })
            const got = siteMod.getSiteConfig().map.fixedDim
            if (got !== '') return fail('a bad pinned world was accepted: ' + JSON.stringify(bad) + ' -> ' + got)
          }

          // Pinned, the feed answers with that world whatever the caller asks
          // for, and offers exactly one — a switcher that cannot change the
          // answer is not a switcher.
          siteMod.setSiteConfig({ map: { ...before, enabled: true, serverId: id, fixedDim: 'end' } })
          const pr2 = await sget('/api/public/map?dim=overworld')
          if (pr2.status !== 200) return fail('the pinned public map expected 200, got ' + pr2.status)
          const feed = (await pr2.json()) as { dimension: string; dimensions: string[]; pinned: boolean }
          if (feed.dimension !== 'end') return fail('the pin did not override the query: ' + feed.dimension)
          if (!feed.pinned) return fail('the feed did not say it was pinned')
          if (feed.dimensions.length !== 1 || feed.dimensions[0] !== 'end') {
            return fail('a pinned feed offered a switcher: ' + JSON.stringify(feed.dimensions))
          }

          // A custom world keeps its case: the name becomes a folder name, and
          // lower-casing it finds `myworld/region` for a folder called
          // `MyWorld` — which works on Windows and does not on Linux.
          if (normalizeDimension('MyWorld') !== 'MyWorld') {
            return fail('a custom world name was case-folded: ' + normalizeDimension('MyWorld'))
          }
          // ...while the three real dimensions still canonicalise.
          if (normalizeDimension('THE_END') !== 'end') return fail('THE_END did not canonicalise')
          if (normalizeDimension('minecraft:the_nether') !== 'nether') return fail('the nether id did not canonicalise')
          if (normalizeDimension('') !== 'overworld') return fail('an empty dimension is not the overworld')

          // Unpinned, it follows the query again.
          siteMod.setSiteConfig({ map: { ...before, enabled: true, serverId: id, fixedDim: '' } })
          const pr3 = await sget('/api/public/map?dim=nether')
          const feed3 = (await pr3.json()) as { dimension: string; pinned: boolean }
          if (feed3.dimension !== 'nether') return fail('an unpinned map ignored the query')
          if (feed3.pinned) return fail('an unpinned map claimed to be pinned')
        } finally {
          siteMod.setSiteConfig({ map: before })
        }
      }

      // ---- named chunk areas over HTTP (#144) ----
      {
        const areasUrl = '/api/servers/' + id + '/areas'
        const before = siteMod.getSiteConfig().map
        areasMod2._reset()
        try {
          if ((await get(areasUrl)).status !== 401) return fail('the area list answered without a token')
          if ((await post(areasUrl, { name: 'x', rects: [{ x1: 0, z1: 0, x2: 0, z2: 0 }] }, ft)).status !== 403) {
            return fail('a session without `settings` could write an area')
          }

          // Two adjacent chunks go in; one rectangle comes back. The tidy-up is
          // in the shared layer and this proves the route actually runs it,
          // rather than storing whatever the caller sent.
          let r2 = await post(
            areasUrl,
            {
              name: 'test alanı',
              note: 'bu alan sahibi: CaYatur',
              colour: '#46a758',
              dim: 'overworld',
              rects: [{ x1: 10, z1: 10, x2: 10, z2: 10 }, { x1: 11, z1: 10, x2: 11, z2: 10 }]
            },
            ot
          )
          if (r2.status !== 200) return fail('creating an area: ' + r2.status + ' ' + (await r2.text()))
          const made = (await r2.json()) as { id: string; rects: unknown[]; name: string }
          if (made.rects.length !== 1) return fail('the route stored an untidied selection')
          if (made.name !== 'test alanı') return fail('the name did not survive the round trip')

          // Editing keeps the id — a UI that renders by id would otherwise see
          // every edit as a delete and an insert.
          r2 = await post(areasUrl, { areaId: made.id, name: 'renamed', dim: 'overworld', rects: [{ x1: 10, z1: 10, x2: 10, z2: 10 }], hidden: true }, ot)
          if (r2.status !== 200) return fail('editing an area: ' + r2.status)
          const edited = (await r2.json()) as { id: string; hidden?: boolean; name: string }
          if (edited.id !== made.id) return fail('an edit changed the id')
          if (!edited.hidden) return fail('the area did not hide')

          // ...and unhiding has to work. `checkArea` only sets `hidden` when it
          // is true, so a naive spread would leave a hidden area hidden forever.
          r2 = await post(areasUrl, { areaId: made.id, name: 'renamed', dim: 'overworld', rects: [{ x1: 10, z1: 10, x2: 10, z2: 10 }], hidden: false }, ot)
          if ((await r2.json() as { hidden?: boolean }).hidden) return fail('an area could not be unhidden')

          // Every refusal names itself, because an API caller has nothing else
          // to go on.
          r2 = await post(areasUrl, { name: '', rects: [{ x1: 0, z1: 0, x2: 0, z2: 0 }] }, ot)
          if (r2.status !== 400 || (await r2.json() as { error: string }).error !== 'name-required') {
            return fail('a nameless area was not refused by name')
          }
          r2 = await post(areasUrl, { name: 'huge', rects: [{ x1: 0, z1: 0, x2: 4000, z2: 4000 }] }, ot)
          if ((await r2.json() as { error: string }).error !== 'too-many-chunks') return fail('an enormous area got through')
          r2 = await post(areasUrl, { areaId: 'nope', name: 'x', rects: [{ x1: 0, z1: 0, x2: 0, z2: 0 }] }, ot)
          if (r2.status !== 404) return fail('editing a missing area: ' + r2.status)

          // The public feed. A hidden area must not appear, and neither must the
          // timestamps — this is the check that a field added to `ChunkArea`
          // later does not quietly reach a stranger.
          const hidden = await post(areasUrl, { name: 'staff only', dim: 'overworld', hidden: true, rects: [{ x1: 50, z1: 50, x2: 51, z2: 51 }] }, ot)
          if (hidden.status !== 200) return fail('creating a hidden area: ' + hidden.status)
          siteMod.setSiteConfig({ map: { ...before, enabled: true, serverId: id, fixedDim: '' } })
          const pr = await sget('/api/public/map/areas?dim=overworld')
          if (pr.status !== 200) return fail('the public area feed: ' + pr.status)
          const pub = (await pr.json()) as { areas: Record<string, unknown>[] }
          if (pub.areas.length !== 1) return fail('the public feed carried ' + pub.areas.length + ' areas, expected 1')
          if (pub.areas[0].name === 'staff only') return fail('a hidden area reached the public site')
          const shape = Object.keys(pub.areas[0]).sort().join(',')
          if (shape !== 'colour,dim,id,name,note,rects') return fail('the public area shape drifted: ' + shape)

          // A dimension the areas are not in returns none of them, rather than
          // painting overworld rectangles over the nether.
          const nether = (await (await sget('/api/public/map/areas?dim=nether')).json()) as { areas: unknown[] }
          if (nether.areas.length !== 0) return fail('overworld areas appeared in the nether')

          // With the map unpublished there is no such resource at all — 404, not
          // an empty list, for the same reason `/api/public/map` answers 404.
          siteMod.setSiteConfig({ map: { ...before, enabled: false } })
          if ((await sget('/api/public/map/areas')).status !== 404) return fail('areas leaked with the map off')

          const del2 = await del(areasUrl + '?areaId=' + made.id, ot)
          if (del2.status !== 200) return fail('deleting an area: ' + del2.status)
          if ((await del(areasUrl + '?areaId=' + made.id, ot)).status !== 404) return fail('a second delete was not a 404')
          const left = (await (await get(areasUrl, ot)).json()) as { areas: { id: string; name: string }[] }
          if (!Array.isArray(left.areas)) return fail('the area list lost its shape')
          if (left.areas.some((a) => a.id === made.id)) return fail('a deleted area came back')
          // The operator's own list keeps the hidden one the public feed dropped.
          if (!left.areas.some((a) => a.name === 'staff only')) return fail('the hidden area vanished for the operator too')
        } finally {
          siteMod.setSiteConfig({ map: before })
          areasMod2._reset()
        }
        console.log('WEB-SMOKE: chunk areas over HTTP OK (gated, tidied, hidden ones stay off the public feed)')
      }

      console.log('WEB-SMOKE: profile visibility OK (' + checked + ' checks, omitted not hidden, per-field toggles)')

      // ---- the refresh budget (#117) ----
      {
        const t0 = 1_000_000
        let st = newRefreshState()
        const go = (at: number): ReturnType<typeof tryRefresh> => {
          const v = tryRefresh(st, INVENTORY_REFRESH, at)
          st = v.state
          return v
        }
        // Three a minute, then refused.
        for (let i = 0; i < 3; i++) {
          if (!go(t0 + i).allowed) return fail('refresh ' + (i + 1) + ' of 3 was refused')
        }
        const fourth = go(t0 + 4)
        if (fourth.allowed) return fail('a fourth refresh inside the minute was allowed')
        if (fourth.window !== 'minute') return fail('the wrong window refused: ' + fourth.window)
        if (fourth.retryAfterSec < 1) return fail('a refusal must say how long to wait')

        // THE rule that separates this from the verification limiter: a refusal
        // costs nothing. Both windows govern the same person here, so charging
        // the hourly budget for a request the per-minute window already refused
        // would let someone clicking a dead-looking button burn their whole hour
        // without a single refresh happening.
        const spentByRefusals = st.hits.length
        for (let i = 0; i < 50; i++) go(t0 + 5 + i)
        if (st.hits.length !== spentByRefusals) {
          return fail('refused refreshes consumed budget: ' + st.hits.length + ' vs ' + spentByRefusals)
        }

        // ...and the minute window rolls.
        if (!go(t0 + 61_000).allowed) return fail('the minute window did not roll')

        // The hourly cap holds even when every minute window is clear: one
        // every 30s for exactly an hour is 120 attempts against a cap of 100.
        let hr = newRefreshState()
        const grantsAt: number[] = []
        const refusedBy = new Set<string>()
        for (let i = 0; i < 120; i++) {
          const at = t0 + i * 30_000
          const v = tryRefresh(hr, INVENTORY_REFRESH, at)
          hr = v.state
          if (v.allowed) grantsAt.push(at)
          else refusedBy.add(String(v.window))
        }
        if (grantsAt.length !== INVENTORY_REFRESH.perHour) {
          return fail('the hourly cap granted ' + grantsAt.length + ', expected ' + INVENTORY_REFRESH.perHour)
        }
        // ...and it was the HOUR that refused, not the minute — one every 30s
        // never comes close to three a minute.
        if (!refusedBy.has('hour')) return fail('the hourly cap never refused')
        if (refusedBy.has('minute')) return fail('the minute window refused one request every 30s')

        // The window SLIDES, so more are granted once the oldest fall out —
        // that is the point of it, not a leak. What must hold is the invariant:
        // never more than `perHour` grants inside any 60-minute span.
        let slid = newRefreshState()
        const all: number[] = []
        for (let i = 0; i < 400; i++) {
          const at = t0 + i * 30_000
          const v = tryRefresh(slid, INVENTORY_REFRESH, at)
          slid = v.state
          if (v.allowed) all.push(at)
        }
        if (all.length <= INVENTORY_REFRESH.perHour) {
          return fail('the hourly window never rolled over 200 minutes')
        }
        for (const start of all) {
          const inWindow = all.filter((t) => t >= start && t - start < 60 * 60_000).length
          if (inWindow > INVENTORY_REFRESH.perHour) {
            return fail('an hour window held ' + inWindow + ' grants, over the cap')
          }
        }
      }

      // ---- and over HTTP ----
      const profileBefore = siteMod.getSiteConfig().profile
      const storeBefore = siteMod.getSiteConfig().storeServerId
      try {
        siteMod.setSiteConfig({ storeServerId: id, profile: { ...PROFILE_PUBLISHING_DEFAULTS } })
        webPlayerAuth._testCreateAccount('Profiley', 'profpass')
        const plr = await spost('/api/public/login', { mcName: 'Profiley', password: 'profpass' })
        const ptok = ((await plr.json()) as { token: string }).token
        if (!ptok) return fail('the profile probe could not sign in')

        // A name that is neither on the roster nor registered is a 404, and a
        // malformed one never reaches the roster read at all.
        let pr = await sget('/api/public/profile?name=' + encodeURIComponent('no-such-player'))
        if (pr.status !== 400 && pr.status !== 404) {
          return fail('an unknown profile expected 400/404, got ' + pr.status)
        }
        pr = await sget('/api/public/profile?name=' + encodeURIComponent('../../etc/passwd'))
        if (pr.status !== 400) return fail('a malformed profile name expected 400, got ' + pr.status)

        // Own profile, signed in. It exists because the account does, even with
        // no roster entry on a server that has never run.
        pr = await sget('/api/public/profile', ptok)
        if (pr.status !== 200) return fail('own profile expected 200, got ' + pr.status)
        const own = (await pr.json()) as { mcName: string; hidden: string[] }
        if (own.mcName !== 'Profiley') return fail('own profile returned the wrong player')
        if (own.hidden.length !== 0) return fail('a player was told their own data was withheld')

        // ...and a STRANGER asking about that same name gets the same answer
        // they would get for a name nobody has ever heard of. The fixture
        // server has no roster, so `Profiley` exists only as a website account
        // — and answering 200 for it while answering 404 for `Nobodyy` would
        // make this endpoint report which names have accounts, one per request.
        // That is the oracle closed in #105, in a different route.
        const strangerHit = await sget('/api/public/profile?name=Profiley')
        const strangerMiss = await sget('/api/public/profile?name=Nobodyy')
        if (strangerHit.status !== strangerMiss.status) {
          return fail(
            'a stranger can tell a registered name from an unknown one: ' +
              strangerHit.status + ' vs ' + strangerMiss.status
          )
        }
        // Whatever a stranger does get back must carry none of the gated fields.
        pr = await sget('/api/public/profile?name=Profiley')
        if (pr.status === 200) {
          const strange = (await pr.json()) as unknown as Record<string, unknown>
          for (const f of GATED) {
            if (f in strange) return fail('an anonymous profile read carried "' + f + '"')
          }
        }
        // An admin token must not be a player token here either: the endpoint
        // decides "owner" from a PLAYER session, and an operator holding a panel
        // token is a stranger to every player account.
        // An admin panel token is not a player session. It used to fall through
        // as "anonymous"; since #120 a credential that was supplied and did not
        // resolve is refused outright, which is both clearer and consistent
        // with every other player route.
        //
        // Asserted as `=== 401` rather than "if it happened to be 200": guarding
        // the body check behind a status that no longer occurs is a test that
        // silently stopped testing, which is what this assertion became when
        // the 401 landed.
        pr = await sget('/api/public/profile?name=Profiley', ot)
        if (pr.status !== 401) {
          return fail('an admin token on the public profile expected 401, got ' + pr.status)
        }
        // ...and a dead PLAYER token is refused the same way, which is the
        // restart case: the browser still holds a token the server forgot.
        pr = await sget('/api/public/profile', 'deadbeef'.repeat(8))
        if (pr.status !== 401) {
          return fail('a stale player token expected 401, got ' + pr.status)
        }
        // The anonymous rule is untouched by all of that — no credential still
        // means "answer as a stranger", not "refuse".
        pr = await sget('/api/public/profile?name=Profiley')
        if (pr.status === 401) return fail('an anonymous profile read was refused as if it had a token')

        // Refresh is own-only and needs a session: the flush is a real cost and
        // one visitor must not be able to spend it for everybody.
        let rr = await spost('/api/public/profile/refresh', {})
        if (rr.status !== 401) return fail('an anonymous refresh expected 401, got ' + rr.status)
        rr = await spost('/api/public/profile/refresh', {}, ot)
        if (rr.status !== 401) return fail('an admin token refresh expected 401, got ' + rr.status)
        // Three, then the fourth is refused with a wait the caller can act on.
        for (let i = 0; i < 3; i++) {
          rr = await spost('/api/public/profile/refresh', {}, ptok)
          if (rr.status !== 200) return fail('refresh ' + (i + 1) + ' expected 200, got ' + rr.status)
        }
        rr = await spost('/api/public/profile/refresh', {}, ptok)
        if (rr.status !== 429) return fail('a fourth refresh expected 429, got ' + rr.status)
        if (!rr.headers.get('retry-after')) return fail('a refused refresh sent no Retry-After')
        // The three 200s above are themselves the assertion that feasibility is
        // checked before the budget: the fixture server is stopped, so a refresh
        // is possible (its data was written on shutdown) and must not 409.
        console.log('WEB-SMOKE: public profile OK (own vs stranger, admin token is a stranger, 400 on a bad name)')
      } finally {
        siteMod.setSiteConfig({ storeServerId: storeBefore, profile: profileBefore })
      }
    }

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
      // Same defence as setr_t below: an assertion failing after this point
      // skips the cleanup, and the leftover then breaks every later run with
      // username-taken - which masks the real failure.
      for (const u of webAuth.listUsers()) {
        if (u.username === 'nosee_t') webAuth.deleteUser(u.id)
      }
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

      // Performance analysis endpoint (#25): read-only advice about a server
      // the user can already see, so it rides the same 'view' gate as metrics.
      r = await get(`/api/servers/${id}/analysis`, ot)
      if (r.status !== 200) return fail('analysis as owner expected 200, got ' + r.status)
      const an = (await r.json()) as { hours: number; findings: { code: string; severity: string }[] }
      if (!Array.isArray(an.findings)) return fail('analysis did not return a findings array')
      if (an.hours !== 24) return fail('analysis default window should be 24h, got ' + an.hours)
      // Every finding must carry a code and a severity the panel can style.
      for (const f of an.findings) {
        if (!f.code) return fail('a finding arrived with no code')
        if (!['info', 'warn', 'error'].includes(f.severity)) {
          return fail('unknown finding severity: ' + f.severity)
        }
      }
      r = await get(`/api/servers/${id}/analysis?hours=999999`, ot)
      if (r.status !== 200) return fail('an absurd window should clamp, not fail: ' + r.status)
      if (((await r.json()) as { hours: number }).hours !== 720) return fail('hours not clamped to 720')
      r = await get(`/api/servers/${id}/analysis`, nt)
      if (r.status !== 403) return fail('analysis without view expected 403, got ' + r.status)
      r = await get(`/api/servers/${id}/analysis`)
      if (r.status !== 401) return fail('analysis without token expected 401, got ' + r.status)
      r = await sget(`/api/servers/${id}/analysis`, ot)
      if (r.status !== 404) return fail('analysis leaked onto the site listener: ' + r.status)
      console.log('WEB-SMOKE: analysis endpoint OK (view-gated, window clamped, findings well-formed)')

      // Regression: analyze() must see backup.created even on a chatty server.
      // events.query returns the NEWEST matching events up to `limit`, so an
      // unfiltered query fills that budget with player joins and pushes the
      // backup out - and the no-backups finding then fires on a server that is
      // backed up nightly. This is why both surfaces share ANALYSIS_EVENT_*.
      // A UNIQUE id per run. Reusing one accumulated 401 events per run into the
      // same store, and once MAX_EVENTS pruning kicked in it dropped the OLDEST
      // by timestamp - which is the backup (2 h) rather than the joins (1 h).
      // The fixture then quietly stopped containing the thing it asserts, and
      // the test started failing on a code path that was fine.
      const noisy = `analysis-noise-${Date.now()}`
      const nowE = Date.now()
      eventsMod.record(noisy, 'backup.created', { text: 'daily.zip', ts: nowE - 7200_000 })
      for (let i = 0; i < 400; i++) {
        eventsMod.record(noisy, 'player.join', { text: 'P' + i, ts: nowE - 3600_000 + i })
      }
      const win = { from: nowE - 86400_000, to: nowE }
      const unfiltered = eventsMod.query(noisy, win).events
      if (unfiltered.some((e) => e.type === 'backup.created')) {
        return fail('the noise fixture is not noisy enough to prove the regression')
      }
      const filtered = eventsMod.query(noisy, {
        ...win,
        types: ANALYSIS_EVENT_TYPES,
        limit: ANALYSIS_EVENT_LIMIT
      }).events
      if (!filtered.some((e) => e.type === 'backup.created')) {
        return fail('the shared analysis query lost backup.created behind player noise')
      }
      // The fixture server is not in the registry, so this deletes its event
      // file rather than leaving one behind per run.
      eventsMod.pruneOrphans()
      console.log('WEB-SMOKE: analysis event query keeps backups visible under 400 joins')

      // ---- alert rules over the panel (#24) ----
      // The escalation guard is the point: a rule with action 'command' is a
      // stored console command that runs unattended, so 'settings' alone must
      // not be enough to create one.
      // A failed assertion below skips the cleanup at the end, so an earlier
      // failed run would otherwise poison every later one with username-taken.
      for (const u of webAuth.listUsers()) {
        if (u.username === 'setr_t') webAuth.deleteUser(u.id)
      }
      const setr = webAuth.createUser('setr_t', 'setrpass', 'user', { [id]: ['view', 'settings'] })
      r = await post('/api/login', { username: 'setr_t', password: 'setrpass' })
      const st = ((await r.json()) as { token: string }).token

      r = await get(`/api/servers/${id}/alerts`, st)
      if (r.status !== 200) return fail('alerts list with settings expected 200, got ' + r.status)
      r = await get(`/api/servers/${id}/alerts`, nt)
      if (r.status !== 403) return fail('alerts list without settings expected 403, got ' + r.status)

      // plain alert (no action) - settings is enough
      r = await post(`/api/servers/${id}/alerts`, { name: 'LowTPS', metric: 'tps', comparison: 'below', threshold: 15 }, st)
      if (r.status !== 200) return fail('plain rule with settings expected 200, got ' + r.status)
      const madeRule = (await r.json()) as { id: string; serverId: string; name: string }
      if (madeRule.serverId !== id) return fail('rule did not take its serverId from the URL')

      // command action - settings alone must NOT be enough
      r = await post(`/api/servers/${id}/alerts`, { name: 'Evil', metric: 'tps', comparison: 'below', threshold: 5, action: 'command', payload: 'op attacker' }, st)
      if (r.status !== 403) return fail('command rule with only settings expected 403, got ' + r.status)
      // ...nor may an existing harmless rule be EDITED into one
      r = await post(`/api/servers/${id}/alerts`, { id: madeRule.id, name: 'LowTPS', metric: 'tps', comparison: 'below', threshold: 15, action: 'command', payload: 'op attacker' }, st)
      if (r.status !== 403) return fail('editing a rule into a command needs console, got ' + r.status)
      if (alertsMod.listRules(id).some((x) => x.action === 'command')) {
        return fail('a command rule was stored despite the 403')
      }
      // power / backup actions demand their own scopes too
      r = await post(`/api/servers/${id}/alerts`, { name: 'Idle', metric: 'players', comparison: 'below', threshold: 1, action: 'stop' }, st)
      if (r.status !== 403) return fail('stop action needs power, got ' + r.status)
      r = await post(`/api/servers/${id}/alerts`, { name: 'Bk', metric: 'tps', comparison: 'below', threshold: 5, action: 'backup' }, st)
      if (r.status !== 403) return fail('backup action needs backups scope, got ' + r.status)
      // the owner holds everything, so the same command rule is allowed
      r = await post(`/api/servers/${id}/alerts`, { name: 'OwnerCmd', metric: 'tps', comparison: 'below', threshold: 5, action: 'command', payload: 'say lag' }, ot)
      if (r.status !== 200) return fail('owner should be able to create a command rule, got ' + r.status)
      const ownerRule = (await r.json()) as { id: string }

      // A settings-only admin MUST be able to switch off a dangerous rule they
      // cannot create - otherwise the guard makes a runaway rule unstoppable by
      // the person most likely to be looking at it.
      r = await post(`/api/servers/${id}/alerts`, { id: ownerRule.id, name: 'OwnerCmd', metric: 'tps', comparison: 'below', threshold: 5, action: 'command', payload: 'say lag', enabled: false }, st)
      if (r.status !== 200) return fail('settings should be able to DISABLE a command rule, got ' + r.status)
      if (alertsMod.listRules(id).find((x) => x.id === ownerRule.id)?.enabled !== false) {
        return fail('the rule was not actually disabled')
      }
      // ...but must not be able to switch it back on.
      r = await post(`/api/servers/${id}/alerts`, { id: ownerRule.id, name: 'OwnerCmd', metric: 'tps', comparison: 'below', threshold: 5, action: 'command', payload: 'say lag', enabled: true }, st)
      if (r.status !== 403) return fail('settings must not re-enable a command rule, got ' + r.status)
      if (alertsMod.listRules(id).find((x) => x.id === ownerRule.id)?.enabled !== false) {
        return fail('a refused re-enable still changed the rule')
      }

      // a rule cannot be aimed at another server by body
      r = await post(`/api/servers/${id}/alerts`, { name: 'Cross', metric: 'tps', comparison: 'below', threshold: 9, serverId: 'some-other-server' }, st)
      if (r.status !== 200) return fail('cross-server rule create failed unexpectedly: ' + r.status)
      if (((await r.json()) as { serverId: string }).serverId !== id) {
        return fail('a body serverId overrode the URL server')
      }
      // Deleting an unknown rule must 404 FROM THE HANDLER. Asserting the error
      // body matters: an unmatched route also 404s, so a status-only check
      // passes even when the endpoint does not exist at all - which is exactly
      // how the first version of this test passed against a dead route.
      r = await del(`/api/servers/${id}/alerts?ruleId=no-such-rule`, st)
      if (r.status !== 404) return fail('deleting an unknown rule expected 404, got ' + r.status)
      if (((await r.json()) as { error: string }).error !== 'rule-not-found') {
        return fail('the 404 came from the router, not the alerts handler')
      }
      r = await del(`/api/servers/${id}/alerts?ruleId=${ownerRule.id}`, st)
      if (r.status !== 200) return fail('delete expected 200, got ' + r.status)
      if (alertsMod.listRules(id).some((x) => x.id === ownerRule.id)) return fail('rule not deleted')
      webAuth.deleteUser(setr.id)
      console.log('WEB-SMOKE: alert rules OK (action scope escalation blocked, serverId forced from URL)')

      // ---- named roles (#28) ----
      // Pure union first: roles only ever ADD, and an unknown role adds nothing.
      const defs = [
        { id: 'r-mod', name: 'Mod', scopes: ['view', 'console'] as Scope[] },
        { id: 'r-files', name: 'Files', scopes: ['files'] as Scope[] }
      ]
      const eff = effectiveScopes(['view'], ['r-mod', 'r-files'], defs).sort()
      if (eff.join() !== 'console,files,view') return fail('role union wrong: ' + eff.join())
      if (effectiveScopes(['view'], ['r-mod', 'r-mod'], defs).sort().join() !== 'console,view') {
        return fail('a repeated role should not duplicate scopes')
      }
      // A deleted role must revoke what it granted, not linger.
      if (effectiveScopes(['view'], ['r-gone'], defs).join() !== 'view') {
        return fail('an unknown role id must contribute nothing')
      }
      if (effectiveScopes(undefined, undefined, defs).length !== 0) {
        return fail('no perms and no roles should be no scopes')
      }
      // Junk scopes never survive normalisation into a grant.
      if (normalizeScopes(['view', 'notascope', 42, null]).join() !== 'view') {
        return fail('invalid scopes were not dropped')
      }

      // End to end through a real user + the HTTP gate.
      for (const u of webAuth.listUsers()) if (u.username === 'role_t') webAuth.deleteUser(u.id)
      rolesMod._reset()
      const rl = rolesMod.upsertRole({ name: 'Console only', scopes: ['view', 'console'] })
      const roleUser = webAuth.createUser('role_t', 'rolepass', 'user', {})
      webAuth.setUserRoles(roleUser.id, { [id]: [rl.id] })
      r = await post('/api/login', { username: 'role_t', password: 'rolepass' })
      const rt = ((await r.json()) as { token: string }).token
      // The server is visible even though `perms` is empty - the grant is the role.
      r = await get('/api/servers', rt)
      const visible = ((await r.json()) as { servers: { id: string }[] }).servers
      if (!visible.some((x) => x.id === id)) return fail('a role-only grant did not make the server visible')
      // The scopes array in the listing is what the panel builds its UI from:
      // authorised-but-invisible is as broken as unauthorised.
      const roleScopes = (visible.find((x) => x.id === id) as unknown as { scopes: string[] }).scopes
      if (!roleScopes?.includes('console')) {
        return fail('role scopes did not reach the listing the panel renders from: ' + JSON.stringify(roleScopes))
      }
      if (roleScopes.includes('power')) return fail('the listing advertised a scope the role does not grant')
      r = await post(`/api/servers/${id}/command`, { command: 'say hi' }, rt)
      if (r.status === 403) return fail('a role granting console was refused')
      // ...and a scope the role does NOT carry is still refused.
      r = await post(`/api/servers/${id}/power`, { action: 'stop' }, rt)
      if (r.status !== 403) return fail('a role must not grant power it does not list, got ' + r.status)
      // Deleting the role revokes the access immediately.
      rolesMod.deleteRole(rl.id)
      r = await post(`/api/servers/${id}/command`, { command: 'say hi' }, rt)
      if (r.status !== 403) return fail('deleting a role did not revoke it, got ' + r.status)
      // Built-ins are not editable or deletable, and cannot be shadowed.
      let refused = false
      try {
        rolesMod.upsertRole({ id: 'moderator', name: 'Pwn', scopes: ['view', 'console', 'power', 'files'] })
      } catch {
        refused = true
      }
      if (!refused) return fail('a built-in role must not be redefinable')
      if (!rolesMod.listRoles().some((x) => x.id === 'moderator' && x.scopes.length === 3)) {
        return fail('the built-in moderator role was altered')
      }
      // Assigning a role id that does not exist must not be stored as a grant.
      webAuth.setUserRoles(roleUser.id, { [id]: ['nope'] })
      if (webAuth.listUsers().find((x) => x.id === roleUser.id)?.roles?.[id]) {
        return fail('a dangling role id was stored')
      }
      webAuth.deleteUser(roleUser.id)
      rolesMod._reset()
      console.log('WEB-SMOKE: named roles OK (union grants, delete revokes, built-ins immutable)')
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

    // Ledger filter + summary (#14). Pure, and shared by the desktop Store view
    // and the panel, so both surfaces must agree on what a filter means.
    const ledEntries: LedgerEntry[] = [
      { id: '1', mcName: 'Steve', delta: 100, balanceAfter: 100, reason: 'event win', by: 'owner_t', kind: 'grant', at: 3 },
      { id: '2', mcName: 'Alex', delta: -40, balanceAfter: 60, reason: 'refund fix', by: 'desktop', kind: 'remove', at: 2 },
      { id: '3', mcName: 'Steve', delta: -25, balanceAfter: 75, reason: 'Rank', by: 'purchase', kind: 'purchase', at: 1 },
      { id: '4', mcName: 'Notch', delta: 500, balanceAfter: 500, reason: '', by: 'owner_t', kind: 'set', at: 0 }
    ]
    if (filterLedger(ledEntries).length !== 4) return fail('an empty filter must not drop entries')
    if (filterLedger(ledEntries, { text: 'steve' }).length !== 2) {
      return fail('player search should be case-insensitive')
    }
    // Searching the ACTOR is the point of #15 - "what did this admin change".
    const byOwner = filterLedger(ledEntries, { text: 'owner_t' })
    if (byOwner.length !== 2 || byOwner.some((e) => e.by !== 'owner_t')) {
      return fail('searching by actor should return exactly that actor entries')
    }
    if (filterLedger(ledEntries, { text: 'refund' }).length !== 1) return fail('reason should be searchable')
    if (filterLedger(ledEntries, { kind: 'purchase' }).length !== 1) return fail('kind filter broken')
    if (filterLedger(ledEntries, { kind: 'all' }).length !== 4) return fail("'all' must not filter")
    // text AND kind together, not either/or
    if (filterLedger(ledEntries, { text: 'steve', kind: 'grant' }).length !== 1) {
      return fail('text and kind must both apply')
    }
    // Order is preserved (newest-first) - the UI does not re-sort.
    if (filterLedger(ledEntries, { text: 'steve' }).map((e) => e.id).join() !== '1,3') {
      return fail('filter must preserve ledger order')
    }
    const sum = ledgerSummary(ledEntries)
    if (sum.count !== 4) return fail('summary count wrong')
    if (sum.granted !== 600) return fail('granted should total grants+sets: ' + sum.granted)
    if (sum.removed !== 40) return fail('removed should be positive and exclude purchases: ' + sum.removed)
    if (sum.spent !== 25) return fail('spent should be the positive purchase total: ' + sum.spent)
    console.log('WEB-SMOKE: ledger filter + summary OK (actor searchable, purchases not double-counted)')

    // Economy categories (#13): a category filter, and the 'none' bucket that
    // finds purchases and everything recorded before categories existed.
    const catLed: LedgerEntry[] = [
      { id: 'a', mcName: 'Steve', delta: 10, balanceAfter: 10, reason: '', by: 'o', kind: 'grant', category: 'event', at: 3 },
      { id: 'b', mcName: 'Alex', delta: 5, balanceAfter: 5, reason: '', by: 'o', kind: 'grant', category: 'reward', at: 2 },
      { id: 'c', mcName: 'Steve', delta: -5, balanceAfter: 5, reason: '', by: 'purchase', kind: 'purchase', at: 1 }
    ]
    if (filterLedger(catLed, { category: 'event' }).map((e) => e.id).join() !== 'a') {
      return fail('category filter did not select the right entry')
    }
    if (filterLedger(catLed, { category: 'all' }).length !== 3) return fail("category 'all' must not filter")
    if (filterLedger(catLed, {}).length !== 3) return fail('an absent category must not filter')
    // 'none' is how an operator finds what was never labelled.
    if (filterLedger(catLed, { category: 'none' }).map((e) => e.id).join() !== 'c') {
      return fail("category 'none' should return exactly the uncategorised entries")
    }
    if (filterLedger(catLed, { category: 'event', text: 'alex' }).length !== 0) {
      return fail('category and text must both apply')
    }
    // An unknown category id is never recorded: a ledger entry is an audit
    // record and must not claim a label nothing on the server defines.
    const evSrv = 'cat-smoke-server'
    economy.upsertCategory(evSrv, { id: 'bonus', name: 'Bonus' })
    economy.addBalance(evSrv, 'Steve', 50, { by: 'tester', source: 'panel', reason: 'ok', category: 'bonus' })
    economy.addBalance(evSrv, 'Steve', 50, { by: 'tester', source: 'panel', reason: 'nope', category: 'not-a-real-category' })
    const recorded = economy.getLedger(evSrv)
    if (recorded[1]?.category !== 'bonus') return fail('a real category should be recorded')
    if (recorded[0]?.category !== undefined) return fail('an invented category must not be recorded')
    // Deleting a category must NOT rewrite history.
    economy.deleteCategory(evSrv, 'bonus')
    if (economy.getLedger(evSrv)[1]?.category !== 'bonus') {
      return fail('deleting a category rewrote a past ledger entry')
    }
    if (categoryName(economy.listCategories(evSrv), 'bonus') !== 'bonus') {
      return fail('a deleted category should fall back to its raw id')
    }
    console.log('WEB-SMOKE: economy categories OK (validated on write, history not rewritten on delete)')

    // Crate animation (#16): a bad value must never stop a player receiving
    // what they paid for, so every path coerces to a real animation.
    if (normalizeCrateAnimation('spin') !== 'spin') return fail('a valid animation was rejected')
    for (const bad of [undefined, null, '', 'nope', 42, {}, []]) {
      if (normalizeCrateAnimation(bad) !== DEFAULT_CRATE_ANIMATION) {
        return fail('a bad animation did not fall back to the default: ' + String(bad))
      }
    }
    if (crateDuration('instant') !== 0) return fail('instant should have no wait')
    if (crateDuration('garbage') !== crateDuration(DEFAULT_CRATE_ANIMATION)) {
      return fail('an unknown animation should time like the default')
    }
    if (CRATE_ANIMATIONS[0].id !== DEFAULT_CRATE_ANIMATION) {
      return fail('the default should be the first option in the picker')
    }
    // Round-trip through the store, including the buyer-facing payload - the
    // panel plays the animation from publicStore, not from the admin config.
    const anSrv = 'crate-smoke-server'
    if (economy.getStoreConfig(anSrv).crateAnimation !== DEFAULT_CRATE_ANIMATION) {
      return fail('a fresh store should default its animation')
    }
    if (economy.setCrateAnimation(anSrv, 'flip') !== 'flip') return fail('set did not return the value')
    if (economy.getStoreConfig(anSrv).crateAnimation !== 'flip') return fail('animation did not persist')
    if (economy.publicStore(anSrv).crateAnimation !== 'flip') {
      return fail('the buyer-facing store must carry the animation')
    }
    if (economy.setCrateAnimation(anSrv, 'not-real') !== DEFAULT_CRATE_ANIMATION) {
      return fail('an invalid animation must be coerced, not stored')
    }
    console.log('WEB-SMOKE: crate animation OK (coerced on every path, reaches the buyer payload)')

    // ---- per-crate animation + buyer-visible contents (#75, #79) ----
    {
      // Pure resolution first: crate wins, absent inherits, garbage degrades.
      if (resolveCrateAnimation({ crateAnimation: 'flip' }, 'burst') !== 'flip') {
        return fail("a crate's own animation did not win over the store default")
      }
      if (resolveCrateAnimation({}, 'burst') !== 'burst') return fail('an unset crate did not inherit')
      if (resolveCrateAnimation(undefined, 'burst') !== 'burst') return fail('no product did not inherit')
      if (resolveCrateAnimation({ crateAnimation: 'nope' }, 'burst') !== DEFAULT_CRATE_ANIMATION) {
        return fail('a garbage per-crate animation was not coerced to the app default')
      }
      if (resolveCrateAnimation({}, 'nope') !== DEFAULT_CRATE_ANIMATION) {
        return fail('a garbage store default was not coerced')
      }

      const cs = 'crate-public-' + Date.now()
      economy.setCrateAnimation(cs, 'burst')
      const secret = 'lp user {player} parent set vip'
      const pinned = economy.upsertProduct(cs, {
        id: '',
        type: 'crate',
        name: 'Pinned',
        description: '',
        price: 10,
        commands: [],
        crateAnimation: 'spin',
        rewards: [
          { name: 'Rare', weight: 1, commands: [secret] },
          { name: 'Common', weight: 3, commands: ['say hi'] }
        ]
      } as Product)
      economy.upsertProduct(cs, {
        id: '',
        type: 'crate',
        name: 'Inheriting',
        description: '',
        price: 10,
        commands: [],
        rewards: [{ name: 'Only', weight: 0, commands: [] }]
      } as Product)
      if (pinned.crateAnimation !== 'spin') return fail('a per-crate animation did not persist')

      const pub = economy.publicStore(cs)
      const pinnedPub = pub.products.find((p) => p.name === 'Pinned')
      const inheritPub = pub.products.find((p) => p.name === 'Inheriting')
      if (pinnedPub?.crateAnimation !== 'spin') return fail('the pinned crate did not publish its own animation')
      if (inheritPub?.crateAnimation !== 'burst') return fail('the inheriting crate did not publish the store default')

      // Odds, not weights: 1 and 3 is 25/75, whatever the numbers were.
      const odds = (pinnedPub?.rewards ?? []).map((r) => r.chancePct)
      if (odds.join(',') !== '25,75') return fail('weights were not normalised to odds: ' + odds.join(','))
      // An all-zero pool must not divide by zero.
      if (inheritPub?.rewards?.[0]?.chancePct !== 100) {
        return fail('an all-zero weight pool produced ' + String(inheritPub?.rewards?.[0]?.chancePct))
      }

      // ...and the roll has to honour what was published. An all-zero pool used
      // to land on the last reward every single time while the storefront
      // advertised an even split. Publishing odds the roll ignores is worse
      // than publishing none.
      {
        const flat = economy.upsertProduct(cs, {
          id: '',
          type: 'crate',
          name: 'Unweighted',
          description: '',
          price: 0,
          commands: [],
          rewards: ['A', 'B', 'C', 'D'].map((n) => ({ name: n, weight: 0, commands: [] }))
        } as Product)
        const seen = new Set<string>()
        for (let i = 0; i < 400; i++) {
          const r = economy.purchase(cs, 'Steve', flat.id)
          if (!r.ok) return fail('free crate purchase failed: ' + String(r.error))
          seen.add(r.reward?.name ?? '')
        }
        // 400 draws from 4 outcomes missing one is ~1 in 10^49; a fixed pick
        // shows up as a single name, which is what this is here to catch.
        if (seen.size !== 4) {
          return fail('an unweighted pool only ever rolled: ' + [...seen].join(','))
        }
      }

      // The invariant that matters: a reward's commands are console commands,
      // and telling every visitor what they are is telling them exactly what to
      // get a compromised account to run.
      const serialised = JSON.stringify(pub)
      if (serialised.includes(secret) || serialised.includes('commands')) {
        return fail('reward commands crossed into the buyer-facing payload')
      }

      // ...and the resolved animation rides on the purchase result, because the
      // buyer never has the product it came from.
      economy.addBalance(cs, 'Steve', 100, { by: 'smoke', source: 'panel' })
      const bought = economy.purchase(cs, 'Steve', pinned.id)
      if (!bought.ok) return fail('crate purchase failed: ' + String(bought.error))
      if (bought.reward?.animation !== 'spin') {
        return fail('the purchase result did not carry the crate animation: ' + String(bought.reward?.animation))
      }
      console.log('WEB-SMOKE: per-crate animation OK (own beats default, odds published, commands never are)')
    }

    // ---- storefront: images, availability, sections, search (#76-#82) ----
    {
      // Image sources are attacker-controlled - any store-scoped web user can
      // set one, and it renders for every visitor to the public site.
      for (const good of [
        '',
        'https://cdn.example/x.png',
        'http://cdn.example/x.png',
        '/uploads/a-b_c.1.png',
        'HTTPS://CDN.EXAMPLE/X.PNG'
      ]) {
        if (!isSafeImageSrc(good)) return fail('a legitimate image source was refused: ' + good)
      }
      for (const bad of [
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==',
        '//evil.example/x.png',
        '/uploads/../../secrets.json',
        '/uploads/sub/dir.png',
        '/uploads/.env',
        'file:///etc/passwd',
        'vbscript:msgbox',
        42 as unknown as string
      ]) {
        if (isSafeImageSrc(bad)) return fail('an unsafe image source was accepted: ' + String(bad))
      }
      if (sanitizeImages(['https://a/1.png', 'javascript:x', '/uploads/b.png']).length !== 2) {
        return fail('sanitizeImages kept something it should have dropped')
      }
      if (sanitizeImages(Array(40).fill('https://a/1.png')).length !== MAX_PRODUCT_IMAGES) {
        return fail('sanitizeImages did not cap the gallery')
      }

      const sfid = 'storefront-' + Date.now()
      const mk = (over: Partial<Product>): Product =>
        economy.upsertProduct(sfid, {
          id: '',
          type: 'item',
          name: 'X',
          description: '',
          price: 10,
          commands: [],
          rewards: [],
          ...over
        } as Product)

      // The chokepoint drops a hostile icon rather than storing it.
      const dirty = mk({
        name: 'Dirty',
        icon: 'javascript:alert(1)',
        images: ['https://ok.example/a.png', 'data:image/svg+xml,<svg onload=alert(1)>'],
        type: 'crate',
        rewards: [{ name: 'R', weight: 1, icon: 'javascript:alert(2)', commands: [] }]
      })
      if (dirty.icon) return fail('a javascript: icon was stored: ' + dirty.icon)
      if (dirty.images?.length !== 1) return fail('a data: gallery image was stored')
      if (dirty.rewards[0].icon) return fail('a javascript: reward icon was stored')

      // Hidden means absent from the payload, not merely styled out - shipping
      // it would leak an unlaunched product's name, price and reward list, and
      // leave its id buyable.
      const secretProduct = mk({ name: 'Unlaunched', hidden: true, price: 999 })
      const stocked = mk({ name: 'Limited', stock: 2, price: 1 })
      const capped = mk({ name: 'Capped', perPlayerLimit: 1, price: 1 })
      mk({ name: 'Zebra', price: 300, sort: 5 })
      mk({ name: 'Apple', price: 50, sort: 1, type: 'crate', rewards: [{ name: 'Sword', weight: 1, commands: [] }] })

      const anon = JSON.stringify(economy.publicStore(sfid))
      if (anon.includes('Unlaunched')) return fail('a hidden product reached the public payload')
      if (economy.publicStore(sfid).products.some((p) => p.id === secretProduct.id)) {
        return fail('a hidden product was listed')
      }
      economy.addBalance(sfid, 'Steve', 500, { by: 'smoke', source: 'panel' })
      // ...and it is not buyable by id either.
      const sneak = economy.purchase(sfid, 'Steve', secretProduct.id)
      if (sneak.ok) return fail('a hidden product was bought by id')

      // Stock cannot oversell, and the count is visible.
      if (economy.purchase(sfid, 'Steve', stocked.id).ok !== true) return fail('first stocked buy failed')
      if (economy.purchase(sfid, 'Steve', stocked.id).ok !== true) return fail('second stocked buy failed')
      const third = economy.purchase(sfid, 'Steve', stocked.id)
      if (third.ok) return fail('a product with 2 in stock sold 3')
      if (third.error !== 'out-of-stock') return fail('overselling reported as ' + String(third.error))
      const stockedPub = economy.publicStore(sfid).products.find((p) => p.id === stocked.id)
      if (stockedPub?.stock !== 0) return fail('remaining stock not published: ' + String(stockedPub?.stock))

      // Per-player limit counts from the purchase history.
      if (!economy.purchase(sfid, 'Steve', capped.id).ok) return fail('first capped buy failed')
      const over = economy.purchase(sfid, 'Steve', capped.id)
      if (over.ok || over.error !== 'limit-reached') return fail('per-player limit not enforced')
      // ...and it is per player, not global.
      economy.addBalance(sfid, 'Alex', 50, { by: 'smoke', source: 'panel' })
      if (!economy.purchase(sfid, 'Alex', capped.id).ok) {
        return fail('one player hitting their limit blocked everybody else')
      }
      // The asking player's own count travels, so the UI can say so up front.
      const forSteve = economy.publicStore(sfid, 'Steve').products.find((p) => p.id === capped.id)
      if (forSteve?.owned !== 1) return fail('owned count not reported: ' + String(forSteve?.owned))
      if (economy.publicStore(sfid).products.find((p) => p.id === capped.id)?.owned !== undefined) {
        return fail('an anonymous visitor was told somebody else owned counts')
      }

      // Sections, search and sort are one shared rule for all three UIs.
      const cat = economy.publicStore(sfid).products
      const secs = sections(cat, 'crates-first')
      if (secs[0].type !== 'crate') return fail('crates-first did not put crates first')
      if (sections(cat, 'items-first')[0].type !== 'item') return fail('items-first is not honoured')
      if (sections(cat, 'mixed').length !== 1) return fail('mixed should be one section')
      if (sections(cat.filter((p) => p.type === 'item'), 'crates-first').length !== 1) {
        return fail('an empty section was emitted as a heading with nothing under it')
      }
      if (normalizeLayout('nonsense') !== 'crates-first') return fail('a bad layout was not coerced')

      const byPrice = filterProducts(cat, { sort: 'price-asc' }).map((p) => p.price)
      if (byPrice.join() !== [...byPrice].sort((a, b) => a - b).join()) return fail('price sort is wrong')
      const featured = filterProducts(cat, { sort: 'featured' })
      if (featured[0].name !== 'Apple') return fail('featured order ignored the sort field')
      // Searching a crate by what is inside it is the whole point of indexing rewards.
      const found = filterProducts(cat, { text: 'sword' })
      if (found.length !== 1 || found[0].name !== 'Apple') {
        return fail('searching a crate by its contents found ' + found.map((p) => p.name).join(','))
      }
      if (filterProducts(cat, { type: 'crate' }).some((p) => p.type !== 'crate')) {
        return fail('the type filter let something else through')
      }
      // The two new admin routes carry the `store` scope, not `settings`.
      const layoutUrl = '/api/servers/' + id + '/store/admin/layout'
      r = await post(layoutUrl, { layout: 'items-first' }, ft)
      if (r.status !== 403) return fail('non-store layout change expected 403, got ' + r.status)
      r = await post(layoutUrl, { layout: 'items-first' }, ot)
      if (r.status !== 200) return fail('layout change expected 200, got ' + r.status)
      if (economy.getStoreConfig(id).layout !== 'items-first') return fail('layout did not persist')
      r = await post(layoutUrl, { layout: 'nonsense' }, ot)
      if (((await r.json()) as { layout: string }).layout !== 'crates-first') {
        return fail('a nonsense layout was stored rather than coerced')
      }

      // Product images upload under the store scope. Deliberately NOT the
      // site's /api/site/upload, which needs `settings` - a store manager
      // should not need the keys to the public website to add a picture.
      const upUrl = base + '/api/servers/' + id + '/store/admin/upload'
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64'
      )
      const upload = (tok: string, type: string): Promise<Response> =>
        fetch(upUrl, {
          method: 'POST',
          headers: { 'Content-Type': type, Authorization: 'Bearer ' + tok },
          body: png
        })
      r = await upload(ft, 'image/png')
      if (r.status !== 403) return fail('non-store image upload expected 403, got ' + r.status)
      r = await upload(ot, 'text/html')
      if (r.status !== 415) return fail('an html upload expected 415, got ' + r.status)
      r = await upload(ot, 'image/png')
      if (r.status !== 200) return fail('store image upload expected 200, got ' + r.status)
      const up = (await r.json()) as { name: string; src: string }
      if (!up.src.startsWith('/uploads/')) return fail('upload did not return a servable path: ' + up.src)
      if (!isSafeImageSrc(up.src)) return fail('upload returned a path its own validator refuses')
      rmSync(join(uploadsDir(), up.name), { force: true })

      console.log('WEB-SMOKE: storefront OK (image allowlist, hidden/stock/limit enforced, sections + search)')
    }

    // ---- the served pages actually run, and the crate editor has its picker ----
    {
      let panel: PageRun
      let site: PageRun
      try {
        // A mis-escaped quote in these template literals produces a page that
        // throws on load and renders blank. Parsing them is the assertion.
        panel = runPageScript(getPanelHtml(), {
          current: { id, name: 'S', scopes: ['view', 'store'], status: 'stopped' }
        })
        site = runPageScript(getPublicSiteHtml())
      } catch (e) {
        return fail('a served page threw on load: ' + String(e))
      }

      const call = <T>(name: string, ...args: unknown[]): T =>
        (panel.ctx[name] as (...a: unknown[]) => T)(...args)

      // #74: the panel could always reach the crate-animation route, and never
      // offered a control that called it.
      call('pmNew', 'crate')
      const editor = panel.byId('pmBox').innerHTML
      if (!/id="pmAnim"/.test(editor)) return fail('the crate editor has no animation picker')
      for (const a of CRATE_ANIMATIONS) {
        if (!editor.includes('value="' + a.id + '"')) return fail('picker is missing ' + a.id)
      }
      // Exactly one selected option. Two means the browser silently takes the
      // last, so a crate that inherits would display someone else's animation.
      const selectedCount = (editor.match(/ selected/g) ?? []).length
      if (selectedCount !== 1) return fail('animation picker has ' + selectedCount + ' selected options')
      if (!/<option value=""[^>]* selected/.test(editor)) {
        return fail('a new crate does not default to inheriting the store animation')
      }

      // An untouched crate must NOT pin an animation - absent means "inherit",
      // and storing today's default would stop it following a later change.
      panel.calls.length = 0
      call('pmSave')
      const posted = panel.calls.find((c) => String(c[1]).endsWith('/store/admin/product'))
      if (!posted) return fail('saving a crate from the panel posted nothing')
      const body = JSON.parse(String(posted[3])) as Product
      if (body.type !== 'crate') return fail('the panel posted the wrong product type')
      if ('crateAnimation' in body) return fail('an inheriting crate pinned an animation anyway')

      // ...and a chosen one does travel.
      ;(panel.ctx['pmDraft'] as { crateAnimation: string }).crateAnimation = 'flip'
      panel.calls.length = 0
      call('pmSave')
      const posted2 = panel.calls.find((c) => String(c[1]).endsWith('/store/admin/product'))
      const body2 = JSON.parse(String(posted2?.[3])) as Product
      if (body2.crateAnimation !== 'flip') return fail('a chosen crate animation was not sent')

      // #79: contents render with odds, and hostile reward data cannot escape
      // the attribute it is written into.
      const evil = 'x" onerror="alert(1)'
      const contents = call<string>('crateContentsHtml', [
        { name: '<b>boom</b>', icon: evil, chancePct: 5 },
        { name: 'Common', chancePct: 95 }
      ])
      if (!contents.includes('95%') || !contents.includes('5%')) return fail('odds not rendered')
      if (contents.includes('onerror="alert(1)"')) return fail('a reward icon escaped its attribute')
      if (contents.includes('<b>boom</b>')) return fail('a reward name was not escaped')
      if (!contents.includes('cp-rare')) return fail('a long-odds reward is not marked as one')

      // The website must have the same engine, not its old hardcoded reel.
      for (const fn of ['openCrate', 'crateContentsHtml', 'cratePreview']) {
        if (typeof site.ctx[fn] !== 'function') return fail('the public site is missing ' + fn)
      }
      const siteHtml = getPublicSiteHtml()
      if (siteHtml.includes('5.2s cubic-bezier') || siteHtml.includes('},5300)')) {
        return fail('the public site still has its hardcoded 5.3s reel')
      }
      // #78/#80/#82: the storefront a buyer sees, rendered by both pages from
      // the same shared code, so they cannot disagree about it.
      const evilIcon = 'x" onerror="alert(1)'
      const GIFT_EMOJI = String.fromCodePoint(0x1f381)
      // #102: each page declares what its storefront is for, by running its own
      // bootstrap. Setting SF.mode from the test would assert nothing — both
      // pages paste the same STORE_JS, so the mode only means anything if the
      // host actually sets it. Grep cannot tell them apart for the same reason.
      ;(panel.ctx['loadStore'] as () => void)()
      ;(site.ctx['loadStore'] as () => void)()
      await sleep(20)
      const panelMode = (panel.ctx['SF'] as { mode: string }).mode
      const siteMode = (site.ctx['SF'] as { mode: string }).mode
      if (panelMode !== 'preview') return fail('the panel storefront is in "' + panelMode + '" mode')
      if (siteMode !== 'buy') return fail('the public storefront is in "' + siteMode + '" mode')

      for (const page of [panel, site]) {
        const buying = (page.ctx['SF'] as { mode: string }).mode === 'buy'
        const ctx = page.ctx as Record<string, (...a: unknown[]) => unknown> & {
          SF: {
            products: unknown[]
            layout: string
            text: string
            type: string
            sort: string
            detail: unknown
          }
        }
        ctx.SF.products = [
          {
            id: 'p1',
            type: 'crate',
            name: 'Mythic Crate',
            description: 'good stuff',
            price: 100,
            icon: evilIcon,
            rewards: [{ name: 'Netherite', chancePct: 5 }]
          },
          { id: 'p2', type: 'item', name: 'VIP Rank', description: '', price: 50 },
          { id: 'p3', type: 'item', name: 'Sold Out Thing', description: '', price: 5, stock: 0 }
        ]
        ctx.SF.layout = 'crates-first'
        ctx['sfRender']()
        const box = page.byId('sfBox').innerHTML
        if (!box.includes('sf-grid')) return fail('the storefront rendered no grid')
        // The gift emoji is gone: it renders as a different picture on every
        // platform and carries no accessible name.
        if (box.includes(GIFT_EMOJI)) return fail('the storefront still uses the gift emoji')
        if (!box.includes('<svg')) return fail('the crate badge is not an inline svg')
        if (!box.includes('sf-sec-head')) return fail('crates and items were not split into sections')
        if (box.indexOf('Mythic Crate') > box.indexOf('VIP Rank')) {
          return fail('crates-first put items above crates')
        }
        // Sold out is stated, and where it can be bought the button is disabled
        // rather than failing on click. In preview there is nothing to spend,
        // and the product that ran out is the one an operator most wants to
        // open — so the state is shown and the action stays live.
        if (!box.includes('sold-out')) return fail('a sold-out product was not marked as one')
        if (buying && !box.includes('disabled')) {
          return fail('a sold-out product was still offered for sale')
        }
        // The heart of #102. Not a markup check — both pages paste the same
        // STORE_JS, so every card in both of them carries the same
        // `sfAction(...)` attribute. What differs is what that call does, so
        // that is what is asserted: press the card's own action and watch for a
        // request that spends money.
        if (buying) {
          if (box.includes('sf-previewbar')) return fail('the public storefront claims to be a preview')
        } else {
          if (!box.includes('sf-previewbar')) return fail('the panel storefront is not framed as a preview')
          if (!box.includes('sfEdit(')) return fail('the panel storefront offers no way to author')
          // ...and only for someone who may. The storefront is visible with
          // 'view' and editing needs 'store', so the two are not the same
          // audience — without this the canEdit check could be ignored
          // entirely and the assertion above would still pass.
          const canEditBefore = (ctx.SF as unknown as { canEdit: boolean }).canEdit
          ;(ctx.SF as unknown as { canEdit: boolean }).canEdit = false
          ctx['sfRender']()
          if (page.byId('sfBox').innerHTML.includes('sfEdit(')) {
            return fail('the panel offers to edit products to a viewer who cannot')
          }
          ;(ctx.SF as unknown as { canEdit: boolean }).canEdit = canEditBefore
          ctx['sfRender']()
        }
        // Opening the editor from the detail closes it. .sf-modal is z-index 75
        // and .pm-modal is 50, so an editor opened over an open detail renders
        // underneath it, behind a dimmed backdrop.
        if (!buying) {
          ctx['sfOpen']('p1')
          if (!ctx.SF.detail) return fail('the panel detail did not open')
          ;(ctx['sfEdit'] as unknown as (id: string) => void)('p1')
          if (ctx.SF.detail) return fail('opening the product editor left the detail on top of it')
        }
        // A signed-in visitor, or the buy path stops at the login modal and the
        // assertion below would pass without ever reaching a purchase.
        const asAny = ctx as unknown as Record<string, unknown>
        if (buying) asAny['ptoken'] = 'smoke-token'
        const catalogue = ctx.SF.products
        page.calls.length = 0
        ;(ctx['sfAction'] as unknown as (id: string) => void)('p2')
        await sleep(5)
        const spent = page.calls.some((c) => String(c[1]).includes('/store/buy'))
        if (buying && !spent) return fail('the public storefront no longer buys anything')
        if (!buying && spent) return fail('the panel storefront spent currency from a preview')
        // The buy path reloads the catalogue on the way out, and the stub
        // answers with an empty one. Put the fixture back for what follows —
        // including the signed-out token, which a later block depends on.
        if (buying) asAny['ptoken'] = ''
        ctx.SF.products = catalogue
        ctx['sfRender']()
        if (box.includes('onerror="alert(1)"')) return fail('a product icon escaped its attribute')

        // Every inline SVG carries its own width and height. One with only a
        // viewBox has no intrinsic size, so a host that does not happen to
        // style it renders the replaced-element default — 300x150px — and the
        // glyph swallows the page. That shipped: the icon was sized in
        // .sf-badge and nowhere else.
        for (const tag of box.match(/<svg[^>]*>/g) ?? []) {
          if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) {
            return fail('an inline svg has no intrinsic size: ' + tag.slice(0, 60))
          }
        }
        // ...and the section heading does not repeat the glyph next to its own
        // label.
        const head = /<div class="sf-sec-head">([\s\S]*?)<\/div>/.exec(box)?.[1] ?? ''
        if (head.includes('<svg')) return fail('the section heading still carries a crate glyph')

        // Set here so the detail assertions below can check it is NOT shown.
        ;(ctx.SF.products[0] as { crateAnimation?: string }).crateAnimation = 'spin'

        // Search reaches into a crate's contents, which is how people look for one.
        ctx.SF.text = 'netherite'
        ctx['sfRender']()
        const searched = page.byId('sfBox').innerHTML
        if (!searched.includes('Mythic Crate') || searched.includes('VIP Rank')) {
          return fail('searching by crate contents did not filter correctly')
        }
        ctx.SF.text = 'nothing-matches-this'
        ctx['sfRender']()
        if (!page.byId('sfBox').innerHTML.includes('sf-empty')) {
          return fail('an empty search result said nothing')
        }
        ctx.SF.text = ''

        // The detail view opens and carries the contents list.
        ctx['sfOpen']('p1')
        const detail = page.byId('sfDetail').innerHTML
        if (!detail.includes('Mythic Crate')) return fail('the detail view did not open the product')
        if (!detail.includes('5%')) return fail('the detail view did not list the crate odds')
        if (detail.includes('onerror="alert(1)"')) return fail('the detail view escaped nothing')
        // ...and does not name the animation. "Opens with: spin" told a buyer
        // the internal id of a transition they are about to watch anyway.
        if (/\bspin\b/.test(detail)) return fail('the detail view leaks the crate animation id')

        // Reloading the catalogue with the detail open refreshes it. Assigning
        // SF.products left the open detail pointing at the previous load's
        // object, so a refused purchase re-rendered the grid with the new stock
        // while the detail kept showing the old — Buy still enabled, next click
        // failing the same way.
        ctx['sfSetProducts']([
          { id: 'p1', type: 'crate', name: 'Mythic Crate', price: 100, stock: 0, rewards: [] },
          { id: 'p2', type: 'item', name: 'VIP Rank', price: 50 }
        ])
        const reopened = page.byId('sfDetail').innerHTML
        if (!reopened.includes('Mythic Crate')) return fail('a catalogue reload dropped the open detail')
        if (buying && !/sf-actions[\s\S]*disabled/.test(reopened)) {
          return fail('the reopened detail still offers a product that just sold out')
        }
        if (!buying && /sf-actions[\s\S]*sfBuy\(/.test(reopened)) {
          return fail('the panel detail view still offers to buy')
        }
        // ...and a product that is gone entirely closes rather than lingering.
        ctx['sfSetProducts']([{ id: 'p2', type: 'item', name: 'VIP Rank', price: 50 }])
        if (ctx.SF.detail) return fail('the detail stayed open for a product that no longer exists')
      }

      // Buying while signed out closes the product first. Both overlays are
      // fixed, so without this the login form opened underneath the detail the
      // visitor had just clicked Buy in.
      {
        const ctx = site.ctx as Record<string, (...a: unknown[]) => unknown> & {
          SF: { detail: unknown }
          ptoken: string
        }
        // Seeded here rather than inherited: the block above deliberately ends
        // with p1 removed from the catalogue.
        ctx['sfSetProducts']([{ id: 'p1', type: 'item', name: 'VIP Rank', price: 50 }])
        // The page starts with no stored token, so this is the signed-out path.
        site.byId('authModal').classList.add('hidden')
        ctx['sfOpen']('p1')
        if (!ctx.SF.detail) return fail('the site detail did not open')
        ctx['buy']('p1')
        if (ctx.SF.detail) return fail('buying while signed out left the product detail open')
        if (site.byId('authModal').classList.contains('hidden')) {
          return fail('buying while signed out did not open the login')
        }
      }

      // The crate overlay has to outrank the desktop app's own modal layer
      // (.modal-backdrop, z-index 90) — the crate editor launches the preview,
      // so at 80 the animation played behind the dialog that asked for it — and
      // stay under the toast layer (100), so an error about a purchase is
      // readable over the animation announcing it.
      {
        const z = Number(/\.crate-modal\{[^}]*z-index:(\d+)/.exec(CRATE_CSS)?.[1] ?? 0)
        if (!(z > 90 && z < 100)) return fail('the crate overlay z-index is ' + z + ', expected 91-99')
      }

      // The public page has exactly one crate modal. It had two of its buttons:
      // the shared modal was pasted in beside the leftovers of the hand-written
      // one it replaced, so a bare OK button sat at the bottom of the site.
      for (const dupe of ['id="crateOk"', 'id="crateResult"', 'class="crate-modal', 'id="sfModal"']) {
        const n = siteHtml.split(dupe).length - 1
        if (n !== 1) return fail('the public page has ' + n + ' of ' + dupe + ', expected 1')
      }
      // #26: the map tab draws from a feed, on a canvas the stub cannot paint —
      // so this asserts the wiring and the empty-state copy, which is what a
      // reader with no bridge installed actually sees.
      {
        const ctx = panel.ctx as Record<string, (...a: unknown[]) => unknown>
        ;(panel.ctx as { MAP: { data: unknown } }).MAP.data = {
          bridge: false,
          dimension: 'overworld',
          dimensions: ['overworld'],
          players: [],
          bounds: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 },
          heatmap: [],
          cell: 16,
          at: Date.now()
        }
        // #116: the pages carry their own copies of the avatar and item helpers,
      // embedded by stringifying the function. That only holds while each one is
      // self-contained: a stringified function that calls another throws a
      // ReferenceError in the page the moment the bundler renames the callee,
      // and the source it was compiled from stays perfectly valid — so nothing
      // else in the build would notice. Checked by calling the PAGE's copies.
      for (const [label, page] of [['panel', panel], ['site', site]] as const) {
        const pctx = page.ctx as Record<string, (...a: unknown[]) => unknown>
        if (typeof pctx['avatarUrl'] !== 'function') {
          return fail('the ' + label + ' page has no embedded avatarUrl')
        }
        for (const n of ['CaYatur', '../../etc/passwd', 'Steve']) {
          if (pctx['avatarUrl'](n, 32) !== avatarUrl(n, 32)) {
            return fail('the ' + label + ' page avatarUrl disagrees for ' + JSON.stringify(n))
          }
        }
        // The map legend's glyph builder, embedded the same way. It reads the
        // icon table through a name the page has to define under exactly that
        // identifier — get it wrong and the legend throws in the browser with
        // nothing wrong in the source (#116, again).
        if (typeof pctx['mapIconSvg'] !== 'function') {
          return fail('the ' + label + ' page has no embedded mapIconSvg')
        }
        for (const k of ['village', 'mine', 'not-a-kind']) {
          if (pctx['mapIconSvg'](k, 14) !== iconSvg(k, 14)) {
            return fail('the ' + label + ' page mapIconSvg disagrees for ' + k)
          }
        }
        // Only the site embeds the item helpers; the panel has no inventory.
        if (typeof pctx['itemIconUrl'] === 'function') {
          for (const idv of ['minecraft:water_bucket', '../evil', '']) {
            if (pctx['itemIconUrl'](idv) !== itemIconUrl(idv)) {
              return fail('the ' + label + ' page itemIconUrl disagrees for ' + JSON.stringify(idv))
            }
          }
        }
      }

      // #115: BOTH pages must be able to fetch a frame with their own api().
        // The assertions below seed MAP.data and call mapDraw directly, which is
        // exactly why they missed the real bug: the shared module read `r.body`,
        // which is the panel's response shape, so on the public site every poll
        // threw on `undefined.dimension` and the map never drew at all. Nothing
        // that skips mapRefresh can see that.
        for (const [label, page] of [['panel', panel], ['site', site]] as const) {
          const pctx = page.ctx as Record<string, (...a: unknown[]) => unknown>
          const pm = page.ctx as { MAP: { data: unknown } }
          pm.MAP.data = null
          let threw = ''
          const onErr = (e: unknown): void => {
            threw = String(e)
          }
          process.on('unhandledRejection', onErr)
          try {
            await (pctx['mapRefresh']() as unknown as Promise<void> | undefined)
            await sleep(20)
          } finally {
            process.off('unhandledRejection', onErr)
          }
          if (threw) return fail('the ' + label + ' map threw while refreshing: ' + threw)
          if (!pm.MAP.data) {
            return fail('the ' + label + ' map got no frame from its own api() — see #115')
          }
          // ...and the status came from the response rather than staying on its
          // initial text, which is what "Bridge not connected" forever looked
          // like.
          const state = page.byId('mpState').textContent
          if (!/Bridge (live|not connected)/.test(state)) {
            return fail('the ' + label + ' map did not set a bridge state: ' + JSON.stringify(state))
          }
        }

        const mapState = panel.ctx as {
          MAP: { data: { bridge: boolean; players: unknown[] }; bridge: unknown; msg: string }
        }
        ctx['mapDraw']()
        const empty = panel.byId('mpEmpty').innerHTML
        if (!/MSMS-Bridge/.test(empty)) {
          return fail('the map does not tell a reader why it is empty: ' + JSON.stringify(empty))
        }
        // #103: the empty state offers to fix it. The warning lives here rather
        // than in a global banner because this is where the operator finds out
        // positions are missing.
        if (/mapInstallBridge/.test(empty)) {
          return fail('the map offered an install before the status was known')
        }
        mapState.MAP.bridge = { state: 'missing', latest: '1.0.0', actionable: true, source: 'bundled' }
        ctx['mapDraw']()
        const offered = panel.byId('mpEmpty').innerHTML
        if (!/mapInstallBridge/.test(offered)) return fail('a paper server with no bridge was offered nothing')
        if (!/1\.0\.0/.test(offered)) return fail('the install offer does not say which version')
        // A server type that cannot run it is told so, and offered nothing.
        mapState.MAP.bridge = { state: 'unsupported', actionable: false, source: null }
        ctx['mapDraw']()
        const unsupported = panel.byId('mpEmpty').innerHTML
        if (/mapInstallBridge/.test(unsupported)) {
          return fail('a server type that cannot run the bridge was offered it anyway')
        }
        if (!/cannot run/.test(unsupported)) return fail('an unsupported server was told nothing')
        mapState.MAP.bridge = null

        // #118: the offer must survive the case the old placement could not
        // reach — a supported server with no bridge AND players on it. The
        // empty state does not render then, so an operator on a busy server was
        // shown nothing at all.
        {
          const pctx = panel.ctx as Record<string, (...a: unknown[]) => unknown>
          const pnl = panel.ctx as { BR: unknown }
          pnl.BR = { state: 'missing', latest: '1.0.0', actionable: true, source: 'bundled' }
          pctx['renderBridgeNotice']()
          if (panel.byId('brNotice').classList.contains('hidden')) {
            return fail('the panel bridge notice stayed hidden with a jar to offer')
          }
          if (!/MSMS-Bridge/.test(panel.byId('brTitle').textContent)) {
            return fail('the bridge notice does not say what is missing')
          }
          // ...and it says what the jar unlocks. "Install MSMS-Bridge" on its
          // own is not a reason to click anything.
          if (!/TPS|position|map/i.test(panel.byId('brWhy').textContent)) {
            return fail('the bridge notice does not say why it matters')
          }
          // Nothing to act on = no banner. A permanent one is noise.
          for (const dead of [
            { state: 'ok', actionable: false },
            { state: 'unsupported', actionable: false },
            { state: 'missing', actionable: false }
          ]) {
            pnl.BR = dead
            pctx['renderBridgeNotice']()
            if (!panel.byId('brNotice').classList.contains('hidden')) {
              return fail('the bridge notice showed for ' + JSON.stringify(dead))
            }
          }
          // An install result belongs to the server it happened on. Opening
          // another server must not leave the last one's outcome sitting under
          // its notice.
          panel.byId('brMsg').textContent = 'Installed 1.0.0. Restart the server to load it.'
          pctx['loadBridgeNotice']()
          if (panel.byId('brMsg').textContent !== '') {
            return fail('a previous install message survived a server switch')
          }

          pnl.BR = null
          pctx['renderBridgeNotice']()
        }

        // #104: the page carries its own copy of the view transform, because a
        // page pasted together as a string cannot import from @shared. So the
        // two implementations are checked against each other here — that is the
        // only thing standing between them and a silent divergence.
        {
          const pctx = panel.ctx as Record<string, (...a: unknown[]) => unknown>
          const pmap = panel.ctx as { MAP: { view: MapView; vp: { width: number; height: number } } }
          // Let the page set its own viewport from the stub's rect: mapDraw
          // recomputes it every frame, so a value seeded here would be replaced
          // the moment anything redraws and the comparison would be against a
          // viewport the page is not using.
          pctx['mapDraw']()
          const pvp = { ...pmap.MAP.vp }
          for (const view of [
            { cx: 0, cz: 0, scale: 1 },
            { cx: -4321, cz: 987, scale: 0.05 },
            { cx: 100, cz: -100, scale: 6 }
          ]) {
            pmap.MAP.view = { ...view }
            for (const p of [{ x: 0, z: 0 }, { x: 5000, z: -5000 }]) {
              const mine = worldToScreen(p, view, pvp)
              const theirs = pctx['mapW2S'](p) as { x: number; y: number }
              if (Math.abs(mine.x - theirs.x) > 1e-6 || Math.abs(mine.y - theirs.y) > 1e-6) {
                return fail('the page transform disagrees with @shared/livemap at scale ' + view.scale)
              }
              const back = pctx['mapS2W']({ x: theirs.x, y: theirs.y }) as { x: number; z: number }
              if (Math.abs(back.x - p.x) > 1e-6 || Math.abs(back.z - p.z) > 1e-6) {
                return fail('the page inverse does not round-trip at scale ' + view.scale)
              }
            }
          }
          // ...and zooming on the page anchors on the cursor too.
          pmap.MAP.view = { cx: 0, cz: 0, scale: 1 }
          const anchor = { x: 640, y: 120 }
          const under = pctx['mapS2W'](anchor) as { x: number; z: number }
          pctx['mapZoomAt'](anchor, 2)
          const still = pctx['mapS2W'](anchor) as { x: number; z: number }
          if (Math.abs(still.x - under.x) > 1e-6 || Math.abs(still.z - under.z) > 1e-6) {
            return fail('the page zoom moved the point under the cursor')
          }
          if (pmap.MAP.view.scale !== 2) return fail('the page zoom did not change scale')
        }

        // #144: and its own copy of the chunk-area rules, for the same reason.
        // Which area owns a chunk has to read the same on all four surfaces, so
        // the page's answer is compared to `areaAt`'s over a battery that
        // includes every case the rule is made of — nesting, ties, dimensions,
        // and the negative coordinates that `|0` gets wrong.
        {
          const pctx = panel.ctx as Record<string, (...a: unknown[]) => unknown>
          const mk = (o: Partial<areasMod.ChunkArea>): areasMod.ChunkArea => ({
            id: 'a', name: 'A', note: '', colour: '#e5484d', dim: 'overworld',
            rects: [{ x1: 0, z1: 0, x2: 0, z2: 0 }], createdAt: 1, updatedAt: 1, ...o
          })
          const battery: areasMod.ChunkArea[] = [
            mk({ id: 'town', rects: [{ x1: -20, z1: -20, x2: 20, z2: 20 }] }),
            // Three deep, so "smallest wins" is tested against a chain rather
            // than a single pair — a rule that picks the smaller of two can
            // still pick the wrong one of three.
            mk({ id: 'district', rects: [{ x1: -10, z1: -10, x2: 0, z2: 0 }] }),
            mk({ id: 'plot', rects: [{ x1: -5, z1: -5, x2: -1, z2: -1 }] }),
            mk({ id: 'tieA', rects: [{ x1: 38, z1: 38, x2: 41, z2: 41 }], updatedAt: 5 }),
            mk({ id: 'tieB', rects: [{ x1: 38, z1: 38, x2: 41, z2: 41 }], updatedAt: 9 }),
            mk({ id: 'hell', dim: 'the_nether', rects: [{ x1: -20, z1: -20, x2: 20, z2: 20 }] }),
            mk({ id: 'custom', dim: 'MyWorld', rects: [{ x1: 0, z1: 0, x2: 4, z2: 4 }] })
          ]
          // EVERY chunk in the range, not a sampled stride. A stride of 3 and 7
          // stepped straight over the 3x3 plot and the 2x2 tie pair, so the
          // battery compared only the cases where nothing overlaps — it stayed
          // green with the page's smallest-wins rule deleted outright.
          let compared = 0
          let overlaps = 0
          for (const dim of ['overworld', 'nether', 'minecraft:the_nether', 'MyWorld', 'end']) {
            for (let cx = -25; cx <= 45; cx++) {
              for (let cz = -25; cz <= 45; cz++) {
                const mine = areasMod.areaAt(battery, cx, cz, dim)
                const theirs = pctx['mapAreaAt'](battery, cx, cz, dim) as areasMod.ChunkArea | null
                if ((mine?.id ?? null) !== (theirs?.id ?? null)) {
                  return fail(
                    'the page disagrees about ' + cx + ',' + cz + ' in ' + dim +
                    ': app says ' + (mine?.id ?? 'none') + ', page says ' + (theirs?.id ?? 'none')
                  )
                }
                compared++
                // Count the chunks where the rule actually has to choose. A
                // battery that never lands on a contested chunk proves nothing,
                // and that is exactly how the first version of this passed.
                if (battery.filter((a) => areasMod.areaAt([a], cx, cz, dim)).length > 1) overlaps++
              }
            }
          }
          // The chunk each block belongs to, which is where `|0` bites: -1/16|0
          // is 0, so a boundary at x=0 would be off by one all the way down.
          for (const b of [-1, -16, -17, 0, 15, 16, 31, -1000]) {
            const mine = areasMod.chunkOf(b, b)
            const theirs = pctx['mapChunkOf'](b, b) as { cx: number; cz: number }
            if (mine.cx !== theirs.cx || mine.cz !== theirs.cz) {
              return fail('the page puts block ' + b + ' in chunk ' + theirs.cx + ', not ' + mine.cx)
            }
          }
          // The dimension normaliser they both depend on, including the custom
          // world whose case must survive because it becomes a folder name.
          for (const d of ['', 'normal', 'THE_END', 'minecraft:the_nether', 'MyWorld', 'nether']) {
            if (normalizeDimension(d) !== pctx['mapNormDim'](d)) {
              return fail('the page normalises ' + JSON.stringify(d) + ' differently')
            }
          }
          if (compared < 5000) return fail('the area cross-check barely ran: ' + compared)
          if (overlaps < 20) return fail('the battery never hit a contested chunk: ' + overlaps)

          // The panel's chunk picker. Clicking builds a selection, clicking the
          // same chunk again takes it back, and the result is tidied the way the
          // server will tidy it — so the count the operator reads is the count
          // that gets stored.
          const pnl = panel.ctx as { AREA_PICK: areasMod.ChunkRect[]; AREA_PICKING: boolean }
          pnl.AREA_PICK = []
          pnl.AREA_PICKING = true
          for (let cx = 0; cx < 4; cx++) pctx['areaPickChunk'](cx, 0)
          if (pnl.AREA_PICK.length !== 1) {
            return fail('the picker did not merge a row: ' + JSON.stringify(pnl.AREA_PICK))
          }
          if (areasMod.areaChunkCount({ rects: pnl.AREA_PICK }) !== 4) return fail('the picker lost a chunk')
          // Taking one out of the MIDDLE is the case that matters: the rect it
          // sits in covers three others, and dropping the rect drops them too.
          pctx['areaPickChunk'](1, 0)
          if (areasMod.areaChunkCount({ rects: pnl.AREA_PICK }) !== 3) {
            return fail('removing one chunk took ' + (4 - areasMod.areaChunkCount({ rects: pnl.AREA_PICK })) + ' with it')
          }
          for (const c of [0, 2, 3]) {
            if (!pnl.AREA_PICK.some((r) => areasMod.rectHas(r, c, 0))) return fail('chunk ' + c + ' was lost')
          }
          if (pnl.AREA_PICK.some((r) => areasMod.rectHas(r, 1, 0))) return fail('the removed chunk came back')
          // The panel tidies with its own copy of the merge, so it has to agree
          // with the shared one — otherwise the operator counts one thing and
          // the server stores another.
          const theirsTidy = pctx['areaTidy']([
            { x1: 0, z1: 0, x2: 0, z2: 0 }, { x1: 1, z1: 0, x2: 1, z2: 0 },
            { x1: 5, z1: 5, x2: 9, z2: 9 }, { x1: 6, z1: 6, x2: 7, z2: 7 }
          ]) as areasMod.ChunkRect[]
          const mineTidy = areasMod.normalizeRects([
            { x1: 0, z1: 0, x2: 0, z2: 0 }, { x1: 1, z1: 0, x2: 1, z2: 0 },
            { x1: 5, z1: 5, x2: 9, z2: 9 }, { x1: 6, z1: 6, x2: 7, z2: 7 }
          ])
          // By value, not by JSON: the two build their objects with the fields
          // in different orders, which `JSON.stringify` reports as a difference
          // and no consumer of these rects can even observe.
          const canon = (rs: areasMod.ChunkRect[]): string =>
            rs.map((r) => [r.x1, r.z1, r.x2, r.z2].join(',')).join(' ')
          if (canon(theirsTidy) !== canon(mineTidy)) {
            return fail('the panel tidies differently: ' + canon(theirsTidy) + ' vs ' + canon(mineTidy))
          }
          pnl.AREA_PICKING = false
          pnl.AREA_PICK = []
        }

        // #104: the same empty state on the PUBLIC page must not talk about
        // plugins. A visitor did not come to hear which jar the operator has
        // not installed, and it is an operator's business told to the internet.
        {
          const sctx = site.ctx as Record<string, (...a: unknown[]) => unknown>
          const smap = site.ctx as { MAP: { data: unknown; bridge: unknown } }
          smap.MAP.bridge = null
          smap.MAP.data = {
            bridge: false,
            dimension: 'overworld',
            dimensions: ['overworld'],
            players: [],
            bounds: { minX: -64, maxX: 64, minZ: -64, maxZ: 64 },
            round: 64,
            heads: false,
            at: Date.now()
          }
          sctx['mapDraw']()
          const pubEmpty = site.byId('mpEmpty').innerHTML
          if (/Bridge|plugin/i.test(pubEmpty)) {
            return fail('the public map told a visitor about the bridge plugin: ' + pubEmpty)
          }
          if (/mapInstallBridge/.test(pubEmpty)) return fail('the public map offered a plugin install')
          if (!pubEmpty) return fail('the public map said nothing at all about being empty')
          // ...and it hides the two controls its feed cannot honour. A button
          // that does nothing is worse than no button.
          if (site.byId('mpHeadsBtn').style.display !== 'none') {
            return fail('the public map offers a heads toggle its feed refuses')
          }
          if (site.byId('mpHeatBtn').style.display !== 'none') {
            return fail('the public map offers a heatmap toggle with no heatmap')
          }
        }

        // ...and with players it stops claiming the plugin is missing.
        mapState.MAP.data.bridge = true
        mapState.MAP.data.players = [{ name: 'Alex', dim: 'overworld', x: 10, y: 64, z: 10 }]
        ctx['mapDraw']()
        if (panel.byId('mpEmpty').innerHTML !== '') return fail('the map showed an empty state with a player on it')
        if (!panel.byId('mpList').innerHTML.includes('Alex')) return fail('the map did not list a live player')
        if (!panel.byId('mpCount').innerHTML.includes('1')) return fail('the map did not count its players')
      }
      console.log('WEB-SMOKE: panel + site scripts parse; crate picker, storefront, map tab, detail and escaping OK')
    }

    // ---- files + config over HTTP (#53 part 2) ----
    {
      const fBase = '/api/servers/' + id + '/files'
      const cBase = '/api/servers/' + id + '/config'
      const af = join(auditDir(), 'audit.jsonl')
      const snap = existsSync(af) ? readFileSync(af, 'utf-8') : null
      // Snapshotted before anything is touched, restored in `finally`.
      const javaSnapshot = getConfig().servers.find((s) => s.id === id)?.java
      const motdSnapshot = files
        .readProperties(id)
        .entries.find((e) => e.key === 'motd')?.value
      const fileKey = apikeys.createKey({ label: 'smoke_files', scopes: ['files'], servers: [id] })
      const cfgKey = apikeys.createKey({ label: 'smoke_cfg', scopes: ['settings'], servers: [id] })
      const kget = (p: string, k: string): Promise<Response> =>
        fetch(base + p, { headers: { 'X-API-Key': k } })
      const kpost = (p: string, body: unknown, k: string): Promise<Response> =>
        fetch(base + p, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': k },
          body: JSON.stringify(body)
        })
      const kdel = (p: string, k: string): Promise<Response> =>
        fetch(base + p, { method: 'DELETE', headers: { 'X-API-Key': k } })
      try {
        rmSync(af, { force: true })
        auditMod._reset()

        // Reading files needs `files`, not `view`: server.properties holds the
        // RCON password, among whatever else an operator has pasted in.
        r = await get(fBase, ft)
        if (r.status !== 403) return fail('file list without the files scope expected 403, got ' + r.status)
        r = await kget(fBase, cfgKey.secret)
        if (r.status !== 403) return fail('a settings key read files, got ' + r.status)

        r = await kget(fBase, fileKey.secret)
        if (r.status !== 200) return fail('file list expected 200, got ' + r.status + ' ' + (await r.text()))
        const listing = (await r.json()) as { entries: { name: string }[] }
        if (!listing.entries.some((e) => e.name === 'server.jar')) {
          return fail('the file list is missing the fixture jar')
        }

        // Traversal is refused by core, and reported as a bad request rather
        // than a server error.
        for (const bad of ['../../secrets', '..\\..\\secrets', '/etc/passwd']) {
          r = await kget(fBase + '?path=' + encodeURIComponent(bad), fileKey.secret)
          // The only thing that matters is that it is not served. Whether core
          // calls it path-escape (400) or the path simply is not there (404) is
          // its business, not this assertion's.
          if (r.ok) return fail('a traversing path was served: ' + bad)
        }

        // Write, read back, then delete — and delete needs confirmation, since
        // nothing inside MSMS can bring the file back.
        r = await kpost(fBase, { path: 'api-smoke.txt', content: 'hello-api' }, fileKey.secret)
        if (r.status !== 200) return fail('file write expected 200, got ' + r.status + ' ' + (await r.text()))
        r = await kget(fBase + '?as=file&path=api-smoke.txt', fileKey.secret)
        const readBack = (await r.json()) as { content: string }
        if (readBack.content !== 'hello-api') return fail('file read-back mismatch: ' + readBack.content)
        if (!auditMod.query({ actions: ['file.write'] }).entries.some((e) => e.target === 'api-smoke.txt')) {
          return fail('a file write was not audited with its path')
        }
        r = await kdel(fBase + '?path=api-smoke.txt', fileKey.secret)
        if (r.status !== 400) return fail('file delete without confirm expected 400, got ' + r.status)
        r = await kdel(fBase + '?path=api-smoke.txt&confirm=true', fileKey.secret)
        if (r.status !== 200) return fail('file delete expected 200, got ' + r.status)
        if (files.listDir(id, '').some((e) => e.name === 'api-smoke.txt')) {
          return fail('the file survived its delete')
        }

        // ---- config ----
        r = await kget(cBase, fileKey.secret)
        if (r.status !== 403) return fail('a files key read config, got ' + r.status)
        r = await kget(cBase, cfgKey.secret)
        if (r.status !== 200) return fail('config read expected 200, got ' + r.status)
        const cfgBody = (await r.json()) as {
          server: { id: string }
          properties: { entries: { key: string; value: string }[] }
        }
        if (cfgBody.server.id !== id) return fail('config returned the wrong server')
        if (!cfgBody.properties.entries.length) return fail('config returned no properties')

        // A newline in a value would smuggle a second key into the file.
        r = await kpost(cBase + '/properties', { updates: { motd: 'hi\nmax-players=999' } }, cfgKey.secret)
        if (r.status !== 400) return fail('a newline in a property value expected 400, got ' + r.status)
        if (((await r.json()) as { error: string }).error !== 'newline-in-value') {
          return fail('the newline refusal gave the wrong error')
        }
        if (!auditMod.query({ actions: ['config.properties'] }).entries.some((e) => e.ok === false)) {
          return fail('a refused property write was not audited')
        }

        const before = Object.fromEntries(
          files.readProperties(id).entries.map((e) => [e.key, e.value])
        )
        r = await kpost(cBase + '/properties', { updates: { motd: 'api-smoke-motd' } }, cfgKey.secret)
        if (r.status !== 200) return fail('property write expected 200, got ' + r.status)
        const after = Object.fromEntries(files.readProperties(id).entries.map((e) => [e.key, e.value]))
        if (after['motd'] !== 'api-smoke-motd') return fail('the property write did not land')
        // The rest of the file must be untouched — writeProperties merges.
        if (after['enable-rcon'] !== before['enable-rcon']) {
          return fail('a targeted property write disturbed another key')
        }
        // The three fields that decide what binary runs are desktop-only,
        // whatever scope the caller holds. `settings` is not a licence to run
        // arbitrary programs as the MSMS process.
        for (const field of ['javaPath', 'customArgs', 'extraFlags']) {
          r = await kpost(cBase + '/java', { [field]: 'C:/evil.exe' }, cfgKey.secret)
          if (r.status !== 403) return fail(field + ' over HTTP expected 403, got ' + r.status)
          const body = (await r.json()) as { error: string; fields: string[] }
          if (body.error !== 'local-only-field' || !body.fields.includes(field)) {
            return fail(field + ' was refused for the wrong reason: ' + JSON.stringify(body))
          }
          // ...and it really did not land.
          const now = getConfig().servers.find((x) => x.id === id)?.java as unknown as Record<string, unknown>
          if (now[field] === 'C:/evil.exe') return fail(field + ' was written despite the 403')
        }
        if (!auditMod.query({ actions: ['config.java'] }).entries.some((e) => e.ok === false)) {
          return fail('a refused java field was not audited')
        }
        // A patch mixing a safe field with a forbidden one is refused whole,
        // rather than partially applied.
        r = await kpost(cBase + '/java', { minMemoryMB: 512, javaPath: 'C:/evil.exe' }, cfgKey.secret)
        if (r.status !== 403) return fail('a mixed patch expected 403, got ' + r.status)
        if (getConfig().servers.find((x) => x.id === id)?.java.minMemoryMB === 512) {
          return fail('a refused patch still applied its safe half')
        }

        // Java config merges rather than replacing, or a partial patch would
        // wipe the preset it did not mention.
        r = await kpost(cBase + '/java', { maxMemoryMB: 3072 }, cfgKey.secret)
        if (r.status !== 200) return fail('java config write expected 200, got ' + r.status)
        const javaAfter = getConfig().servers.find((s) => s.id === id)?.java
        if (javaAfter?.maxMemoryMB !== 3072) return fail('the java patch did not land')
        if (javaAfter?.preset !== javaSnapshot?.preset) {
          return fail('a partial java patch replaced the preset: ' + String(javaAfter?.preset))
        }
        if (javaAfter?.extraFlags === undefined) {
          return fail('a partial java patch dropped extraFlags, which breaks the launch')
        }
        console.log('WEB-SMOKE: files + config over HTTP OK (scope split, traversal refused, writes audited)')
      } finally {
        // In `finally`, not inline. A failed assertion between the patch and an
        // inline restore leaves the shared dev-root fixture with a partial java
        // config, and every other gate then fails to start a server for reasons
        // that have nothing to do with what they test. That already happened
        // once here, which is why it moved.
        if (javaSnapshot) registry.updateServer(id, { java: javaSnapshot })
        if (motdSnapshot !== undefined) files.writeProperties(id, { motd: motdSnapshot })
        apikeys.deleteKey(fileKey.key.id)
        apikeys.deleteKey(cfgKey.key.id)
        try {
          files.deleteEntry(id, 'api-smoke.txt')
        } catch {
          /* already gone */
        }
        if (snap == null) rmSync(af, { force: true })
        else writeFileSync(af, snap, 'utf-8')
      }
    }

    // ---- mods, Java, telemetry, deregister (#53 part 3) ----
    {
      const fixture = getConfig().servers.find((s) => s.id === id)
      if (!fixture) return fail('the fixture server vanished before the mods gate')
      const mBase = '/api/servers/' + id + '/mods'
      const jarRel = 'plugins/smoke-mod.jar'
      const jarAbs = join(fixture.path, 'plugins', 'smoke-mod.jar')
      const af = join(auditDir(), 'audit.jsonl')
      const snap = existsSync(af) ? readFileSync(af, 'utf-8') : null
      const telemetrySnapshot = getConfig().telemetry
      // The deregister test needs a server it is allowed to lose. Under
      // msms-data/ because scanServers skips that folder — a fixture the
      // discovery pass re-adds would make "it is gone" untestable.
      const forgetRoot = join(dataDir(), 'smoke-forget-server')
      const forgetId = 'smoke-forget-' + Date.now()
      const modKey = apikeys.createKey({ label: 'smoke_mods', scopes: ['files'], servers: [id] })
      // Every scope there is, on every server. It still must not reach an
      // owner-only route: a key carries scopes, never a role.
      const superKey = apikeys.createKey({
        label: 'smoke_super',
        scopes: [...SCOPES],
        servers: 'all',
        canAudit: true
      })
      const kget = (p: string, k: string): Promise<Response> =>
        fetch(base + p, { headers: { 'X-API-Key': k } })
      const kpost = (p: string, body: unknown, k: string): Promise<Response> =>
        fetch(base + p, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': k },
          body: JSON.stringify(body)
        })
      const kdel = (p: string, k: string): Promise<Response> =>
        fetch(base + p, { method: 'DELETE', headers: { 'X-API-Key': k } })
      try {
        rmSync(af, { force: true })
        auditMod._reset()
        mkdirSync(join(fixture.path, 'plugins'), { recursive: true })
        writeFileSync(jarAbs, 'not really a jar', 'utf-8')

        // ---- plugins / mods ----
        // `files`, not `view`: installing a jar is what runs at the next start.
        r = await get(mBase, ft)
        if (r.status !== 403) return fail('mod list without files scope expected 403, got ' + r.status)
        r = await kget(mBase, modKey.secret)
        if (r.status !== 200) return fail('mod list expected 200, got ' + r.status + ' ' + (await r.text()))
        const modList = (await r.json()) as { mods: { path: string; enabled: boolean }[] }
        if (!modList.mods.some((mo) => mo.path === jarRel)) {
          return fail('the seeded jar is missing from the mod list')
        }

        // ---- account claims waiting for a human (#105) ----
        {
          const pBase = '/api/servers/' + id + '/player-requests'
          // `settings`, not `players`: approving grants somebody credentials to
          // a website account with a balance. The `files` key carries neither,
          // which is the point — it is not a scope that should reach this.
          r = await kget(pBase, modKey.secret)
          if (r.status !== 403) return fail('player-requests with a files key expected 403, got ' + r.status)
          r = await get(pBase, ot)
          if (r.status !== 200) return fail('player-requests expected 200 for an owner, got ' + r.status)
          const q = (await r.json()) as { requests: unknown[] }
          if (!Array.isArray(q.requests)) return fail('player-requests did not return a list')
          // The fixture runs in online mode, so nothing should be queued: with
          // Mojang authentication on, the in-game code proves ownership by
          // itself and a human has nothing to add.
          if (q.requests.length !== 0) return fail('an online-mode server queued a claim for approval')
          r = await post(pBase + '/approve', { id: 'no-such-request' }, ot)
          if (r.status !== 409) return fail('approving a missing request expected 409, got ' + r.status)
          r = await post(pBase + '/deny', { id: 'no-such-request' }, ot)
          if (r.status !== 404) return fail('denying a missing request expected 404, got ' + r.status)
          r = await post(pBase + '/approve', { id: 'x' }, ft)
          if (r.status !== 403) return fail('approving without settings expected 403, got ' + r.status)
        }

        // ---- a key can be switched off and back on (#EK) ----
        {
          const k2 = apikeys.createKey({ label: 'smoke_toggle', scopes: ['view'], servers: 'all' })
          const probe = '/api/servers/' + id
          if ((await kget(probe, k2.secret)).status !== 200) return fail('a fresh key could not read')

          // Drive the call from the route table rather than from what the
          // handler happens to read. Those two disagreed until #142 — the doc
          // said `id`, the server read `keyId` — and an integrator who followed
          // the doc exactly got a 404 from revoke and a 200 from a delete that
          // deleted nothing. A test that spells the field itself would have
          // stayed green through all of it.
          const doc = API_ROUTES.find((rt) => rt.path === '/keys/disabled' && rt.method === 'POST')
          const idField = Object.keys(doc?.body ?? {}).find((f) => f !== 'disabled')
          if (!idField) return fail('the disable route documents no key field')

          // Owner session only. A key must never be able to switch keys off:
          // that is the same escalation that keeps key minting off the API.
          const byKey = await kpost('/api/keys/disabled', { [idField]: k2.key.id, disabled: true }, superKey.secret)
          if (byKey.status !== 403) return fail('an API key could disable a key: ' + byKey.status)

          const viaHttp = await post('/api/keys/disabled', { [idField]: k2.key.id, disabled: true }, ot)
          if (viaHttp.status !== 200) {
            return fail('owner disable over HTTP: ' + viaHttp.status + ' ' + (await viaHttp.text()))
          }
          if (!((await viaHttp.json()) as { disabled?: boolean }).disabled) {
            return fail('the route did not report it off')
          }

          // Disabling is checked by `isKeyUsable`, which is the single answer to
          // "may this key be used" — a switch honoured in some places and not
          // others is worse than no switch.
          const off = await kget(probe, k2.secret)
          if (off.status !== 401) return fail('a disabled key still worked: ' + off.status)

          // ...and reversible, unlike revoke. That is the whole reason it is a
          // separate flag: pausing an integration must not require destroying
          // its credential.
          apikeys.setKeyDisabled(k2.key.id, false)
          if ((await kget(probe, k2.secret)).status !== 200) return fail('a re-enabled key did not work')

          // A revoked key cannot be quietly resurrected by the reversible one —
          // over HTTP too, where the answer is 409 rather than a thrown string.
          apikeys.revokeKey(k2.key.id)
          let threw = false
          try {
            apikeys.setKeyDisabled(k2.key.id, false)
          } catch {
            threw = true
          }
          if (!threw) return fail('enabling resurrected a revoked key')
          const undead = await post('/api/keys/disabled', { [idField]: k2.key.id, disabled: false }, ot)
          if (undead.status !== 409) return fail('reviving a revoked key over HTTP: ' + undead.status)
          if ((await kget(probe, k2.secret)).status !== 401) return fail('a revoked key still worked')
          apikeys.deleteKey(k2.key.id)

          // The usage samples are what an operator follows to make a first
          // request, so they have to name the header the server actually reads
          // and carry no fake secret.
          const samples = usageSamples({ baseUrl: 'http://127.0.0.1:8080' })
          if (samples.length < 3) return fail('too few usage samples')
          for (const s of samples) {
            if (!s.code.includes(API_KEY_HEADER)) return fail(s.lang + ' does not send the key header')
            // Not `API_PREFIX + '/servers'`: two of the three samples put the
            // prefix in a BASE constant and append the path at the call site.
            if (!s.code.includes(API_PREFIX)) return fail(s.lang + ' does not use the versioned prefix')
            if (!s.code.includes('/servers')) return fail(s.lang + ' does not call a real route')
            if (!s.code.includes('PASTE_YOUR_KEY_HERE')) {
              return fail(s.lang + ' has something that looks like a real key in it')
            }
          }

          // The panel serves this function as source, via `.toString()`. Reading
          // the source for a forbidden identifier would not catch the bug: the
          // bundler *renames* module bindings, so the dead reference is not
          // called `API_PREFIX` by the time it reaches the page. Run it the way
          // the page does instead — with no scope around it at all — which is
          // the only thing that turns the ReferenceError into a failure here.
          let detached: typeof usageSamples
          try {
            detached = new Function('return (' + usageSamples.toString() + ')')() as typeof usageSamples
          } catch (e) {
            return fail('usageSamples could not even be re-parsed: ' + String(e))
          }
          try {
            const outside = detached({ baseUrl: 'http://127.0.0.1:8080' })
            if (JSON.stringify(outside) !== JSON.stringify(samples)) {
              return fail('usageSamples gives the page a different answer than the app')
            }
          } catch (e) {
            return fail('usageSamples leans on module scope it will not have in the page: ' + String(e))
          }
          const withKey = usageSamples({ baseUrl: 'http://x', key: 'msms_abc.def' })
          if (!withKey[0].code.includes('msms_abc.def')) return fail('a supplied key did not reach the sample')
        }

        // ---- the bridge plugin (#103) ----
        {
          const bBase = '/api/servers/' + id + '/bridge'
          r = await get(bBase, ft)
          if (r.status !== 403) return fail('bridge status without files scope expected 403, got ' + r.status)
          r = await post(bBase + '/install', {}, ft)
          if (r.status !== 403) return fail('bridge install without files scope expected 403, got ' + r.status)
          r = await kget(bBase, modKey.secret)
          if (r.status !== 200) return fail('bridge status expected 200, got ' + r.status)
          const st = (await r.json()) as { state: string; source: string | null }
          // The fixture is a plain server folder with no recognised jar, so the
          // honest answer is that its type cannot run the plugin.
          if (!['unsupported', 'missing', 'ok', 'outdated'].includes(st.state)) {
            return fail('bridge status returned an unknown state: ' + st.state)
          }
          // The install route reads NO body. A version or a URL crossing this
          // boundary would turn a `files` request into "write a file of my
          // choosing into your server folder", so a caller supplying either
          // must not be able to change the outcome.
          const withJunk = await kpost(
            bBase + '/install',
            { url: 'https://evil.example/x.jar', version: '9.9.9', name: '../../evil.jar' },
            modKey.secret
          )
          const plain = await kpost(bBase + '/install', {}, modKey.secret)
          if (withJunk.status !== plain.status) {
            return fail(
              'the bridge install answered differently when the caller named a url/version: ' +
                withJunk.status + ' vs ' + plain.status
            )
          }
          if (existsSync(join(fixture.path, 'plugins', 'evil.jar'))) {
            return fail('a caller-supplied name reached the filesystem')
          }
          r = await kget(bBase + '/nonsense', modKey.secret)
          if (r.status !== 404) return fail('an unknown bridge sub-route expected 404, got ' + r.status)
        }

        // Missing parameters are refused before anything reaches Modrinth, so
        // this stays true with the network unplugged.
        r = await kget(mBase + '/search', modKey.secret)
        if (r.status !== 400) return fail('a search with no query expected 400, got ' + r.status)
        r = await kget(mBase + '/detail', modKey.secret)
        if (r.status !== 400) return fail('a detail with no projectId expected 400, got ' + r.status)
        r = await kpost(mBase + '/install', {}, modKey.secret)
        if (r.status !== 400) return fail('an install with no projectId expected 400, got ' + r.status)
        r = await kpost(mBase + '/update', { rel: jarRel }, modKey.secret)
        if (r.status !== 400) return fail('an update with no versionId expected 400, got ' + r.status)

        // A path outside plugins/ or mods/ is the caller naming something they
        // may not name — a malformed request, not a conflict with server state.
        r = await kpost(mBase + '/toggle', { rel: '../../evil.jar', enable: false }, modKey.secret)
        if (r.status !== 400) return fail('a traversing mod path expected 400, got ' + r.status)
        if (((await r.json()) as { error: string }).error !== 'invalid-mod-path') {
          return fail('the traversal refusal gave the wrong error')
        }

        r = await kpost(mBase + '/toggle', { rel: jarRel, enable: false }, modKey.secret)
        if (r.status !== 200) return fail('mod disable expected 200, got ' + r.status)
        if (existsSync(jarAbs)) return fail('disabling did not rename the jar')
        if (!existsSync(jarAbs + '.disabled')) return fail('the disabled jar is not there')
        if (!auditMod.query({ actions: ['mod.toggle'] }).entries.some((e) => e.detail === 'disabled')) {
          return fail('a mod toggle was not audited')
        }

        // Delete: shape first, then intent. A call with no `rel` is malformed,
        // and auditing it as a refused delete of "" records a decision nobody
        // made.
        r = await kdel(mBase, modKey.secret)
        if (r.status !== 400) return fail('a delete with no rel expected 400, got ' + r.status)
        if (auditMod.query({ actions: ['mod.delete'] }).entries.length) {
          return fail('a malformed delete was audited as a refused delete')
        }
        r = await kdel(mBase + '?rel=' + encodeURIComponent(jarRel + '.disabled'), modKey.secret)
        if (r.status !== 400) return fail('a delete without confirm expected 400, got ' + r.status)
        if (!auditMod.query({ actions: ['mod.delete'] }).entries.some((e) => e.ok === false)) {
          return fail('a refused delete was not audited')
        }
        r = await kdel(
          mBase + '?confirm=true&rel=' + encodeURIComponent(jarRel + '.disabled'),
          modKey.secret
        )
        if (r.status !== 200) return fail('mod delete expected 200, got ' + r.status)
        if (existsSync(jarAbs + '.disabled')) return fail('the jar survived its delete')

        // ---- Java + telemetry: owner-only, and no key is an owner ----
        for (const [label, p] of [
          ['java list', '/api/java'],
          ['telemetry read', '/api/telemetry']
        ] as [string, string][]) {
          r = await get(p, ft)
          if (r.status !== 403) return fail(label + ' as a non-owner expected 403, got ' + r.status)
          // The point of this one: the key holds every scope on every server and
          // still cannot reach a host-wide route, because principalForKey never
          // issues a role.
          r = await kget(p, superKey.secret)
          if (r.status !== 403) {
            return fail(label + ' with an all-scope key expected 403, got ' + r.status)
          }
          r = await get(p, ot)
          if (r.status !== 200) return fail(label + ' as owner expected 200, got ' + r.status)
        }
        const installs = ((await (await get('/api/java', ot)).json()) as { installs: unknown[] }).installs
        if (!Array.isArray(installs)) return fail('the java list is not an array')

        // The only input is a major version, and it selects from a release list
        // rather than naming a URL. Nonsense is refused before any download.
        for (const bad of [0, 999, 'twenty-one', 21.5]) {
          r = await post('/api/java/install', { major: bad }, ot)
          if (r.status !== 400) return fail('java install major=' + bad + ' expected 400, got ' + r.status)
        }

        // Telemetry is persisted, so a bad value does not fail the request that
        // set it — it fails every prune afterwards, across restarts.
        for (const [body, field] of [
          [{ rawHours: 'abc' }, 'rawHours'],
          [{ enabled: 'false' }, 'enabled'],
          [{ rawHours: 1.5 }, 'rawHours'],
          [{ minuteDays: 0 }, 'minuteDays'],
          [{ hourDays: 99999 }, 'hourDays'],
          [{ rawDays: 3 }, 'rawDays']
        ] as [Record<string, unknown>, string][]) {
          r = await post('/api/telemetry', body, ot)
          if (r.status !== 400) {
            return fail('telemetry ' + JSON.stringify(body) + ' expected 400, got ' + r.status)
          }
          const err = (await r.json()) as { field?: string }
          if (err.field !== field) return fail('telemetry refusal named ' + err.field + ', expected ' + field)
        }
        if (getConfig().telemetry?.rawHours !== telemetrySnapshot?.rawHours) {
          return fail('a refused telemetry patch changed the stored config')
        }
        r = await post('/api/telemetry', { rawHours: 48 }, ot)
        if (r.status !== 200) return fail('a valid telemetry patch expected 200, got ' + r.status)
        if (metrics.telemetryConfig().rawHours !== 48) return fail('the telemetry patch did not land')
        // Merging, not replacing: a patch that names one tier keeps the others.
        if (metrics.telemetryConfig().enabled !== true) {
          return fail('a partial telemetry patch dropped `enabled`')
        }

        // ---- deregister: owner only, confirmed, and the files stay ----
        mkdirSync(forgetRoot, { recursive: true })
        writeFileSync(join(forgetRoot, 'server.jar'), 'fixture', 'utf-8')
        updateConfig((c) => {
          c.servers.push({
            ...fixture,
            id: forgetId,
            name: 'Forget me',
            path: forgetRoot
          })
        })
        // Seeded so the response's claim about what it destroyed can be checked
        // against something, rather than trusted.
        alertsMod.createRule({
          serverId: forgetId,
          name: 'smoke forget rule',
          metric: 'tps',
          comparison: 'below',
          threshold: 5
        })
        const fBaseId = '/api/servers/' + forgetId
        r = await del(fBaseId + '?confirm=true', ft)
        if (r.status !== 403) return fail('deregister as a non-owner expected 403, got ' + r.status)
        r = await kdel(fBaseId + '?confirm=true', superKey.secret)
        if (r.status !== 403) return fail('deregister with an all-scope key expected 403, got ' + r.status)
        r = await del(fBaseId, ot)
        if (r.status !== 400) return fail('deregister without confirm expected 400, got ' + r.status)
        if (!getConfig().servers.some((s) => s.id === forgetId)) {
          return fail('an unconfirmed deregister removed the server anyway')
        }
        r = await del(fBaseId + '?confirm=true', ot)
        if (r.status !== 200) return fail('deregister expected 200, got ' + r.status + ' ' + (await r.text()))
        const forgot = (await r.json()) as { alertRulesRemoved?: number; historyDropped?: boolean }
        if (getConfig().servers.some((s) => s.id === forgetId)) {
          return fail('the server is still registered after a deregister')
        }
        // The whole reason this half is exposed and `deleteFiles` is not.
        if (!existsSync(join(forgetRoot, 'server.jar'))) {
          return fail('deregister deleted the server files')
        }
        // ...but MSMS's own records for it DO go, so the response must say so
        // rather than reporting `filesKept: true` and letting that read as
        // "nothing was lost".
        if (alertsMod.listRules(forgetId).length) {
          return fail('a rule for the forgotten server survived, so the response is wrong')
        }
        if (forgot.historyDropped !== true || forgot.alertRulesRemoved !== 1) {
          return fail(
            'deregister under-reported what it destroyed: ' + JSON.stringify(forgot)
          )
        }
        if (!auditMod.query({ actions: ['server.forget'] }).entries.some((e) => e.ok === true)) {
          return fail('a deregister was not audited')
        }

        console.log(
          'WEB-SMOKE: mods + java + telemetry + deregister OK (files-scoped, owner-only host routes, files kept)'
        )
      } finally {
        apikeys.deleteKey(modKey.key.id)
        apikeys.deleteKey(superKey.key.id)
        updateConfig((c) => {
          c.servers = c.servers.filter((s) => s.id !== forgetId)
          c.telemetry = telemetrySnapshot
        })
        rmSync(forgetRoot, { recursive: true, force: true })
        rmSync(jarAbs, { force: true })
        rmSync(jarAbs + '.disabled', { force: true })
        if (snap == null) rmSync(af, { force: true })
        else writeFileSync(af, snap, 'utf-8')
      }
    }

    // ---- reward delivery safety (#106) ----
    {
      // The decision table, enumerated with the expected verdict written out
      // here rather than computed from the same helper the route calls. Every
      // row is a real situation, and the answer is either "deliver on evidence"
      // or "keep it" — never "drop it".
      const base = {
        serverRunning: true,
        canSend: true,
        playerOnline: true,
        bridgeInWorld: false,
        onlineMode: true,
        joinedAgoMs: undefined as number | undefined,
        graceMs: 20_000,
        holdWhenUnverified: true
      }
      const rows: [string, Partial<typeof base>, string][] = [
        // Nothing can carry the command — the old code ran it anyway, into
        // nowhere, having already dequeued the reward.
        ['server stopped', { serverRunning: false }, 'hold:server-down'],
        ['no rcon and no process', { canSend: false }, 'hold:server-down'],
        ['player not connected', { playerOnline: false }, 'hold:player-offline'],
        // Online mode: Mojang authenticated the session, so being connected is
        // enough — but not in the first seconds after joining.
        ['online mode, settled', {}, 'deliver'],
        ['online mode, just joined', { joinedAgoMs: 500 }, 'wait'],
        ['online mode, grace elapsed', { joinedAgoMs: 25_000 }, 'deliver'],
        // Cracked: anyone can be connected as this name, and a login plugin is
        // probably holding them where an item would be lost.
        ['cracked, nothing else', { onlineMode: false }, 'hold:needs-approval'],
        ['cracked, just joined', { onlineMode: false, joinedAgoMs: 500 }, 'hold:needs-approval'],
        // ...unless the bridge can locate them in a world.
        ['cracked but bridge sees them', { onlineMode: false, bridgeInWorld: true }, 'deliver'],
        [
          'cracked, bridge sees them, still in grace',
          { onlineMode: false, bridgeInWorld: true, joinedAgoMs: 100 },
          'wait'
        ],
        // ...or unless the operator turned the safety off.
        ['cracked, holding disabled', { onlineMode: false, holdWhenUnverified: false }, 'deliver'],
        [
          'cracked, holding disabled, just joined',
          { onlineMode: false, holdWhenUnverified: false, joinedAgoMs: 10 },
          'wait'
        ],
        // Offline beats everything: there is nobody to give it to.
        [
          'offline outranks the bridge',
          { playerOnline: false, bridgeInWorld: true, onlineMode: false },
          'hold:player-offline'
        ]
      ]
      for (const [label, patch, expected] of rows) {
        const d = deliveryDecision({ ...base, ...patch })
        const got = d.action === 'hold' ? 'hold:' + d.reason : d.action
        if (got !== expected) {
          return fail('delivery "' + label + '" gave ' + got + ', expected ' + expected)
        }
        if (d.action === 'wait' && !(d.ms > 0)) return fail('delivery "' + label + '" waits 0ms')
      }
      // No input combination may lose the reward. The action being one of three
      // known strings is not the property that matters — what matters is that
      // every non-delivery names a queue reason, because that is what makes the
      // entry survive the process. `wait` is the branch that forgets: it looks
      // like progress, so it is the one that ends up living in a timer closure
      // and nowhere durable.
      let swept = 0
      for (const running of [true, false]) {
        for (const online of [true, false]) {
          for (const bridge of [true, false]) {
            for (const mode of [true, false]) {
              for (const hold of [true, false]) {
                for (const joined of [undefined, 0, 5_000, 60_000]) {
                  const d = deliveryDecision({
                    ...base,
                    serverRunning: running,
                    canSend: running,
                    playerOnline: online,
                    bridgeInWorld: bridge,
                    onlineMode: mode,
                    holdWhenUnverified: hold,
                    joinedAgoMs: joined
                  })
                  swept++
                  if (!['deliver', 'wait', 'hold'].includes(d.action)) {
                    return fail('delivery produced an unknown action: ' + JSON.stringify(d))
                  }
                  const q = queueReason(d)
                  if (d.action === 'deliver') {
                    if (q !== null) return fail('a delivery still claimed queue reason ' + q)
                  } else if (q === null) {
                    return fail(
                      'a "' + d.action + '" decision named no queue reason, so nothing would persist it: ' +
                        JSON.stringify({ running, online, bridge, mode, hold, joined })
                    )
                  } else if (!HOLD_REASONS.includes(q)) {
                    return fail('queue reason "' + q + '" is not in HOLD_REASONS')
                  }
                }
              }
            }
          }
        }
      }
      if (clampGrace(0) < 1000) return fail('the grace clamp allows an instant delivery')
      if (clampGrace('nonsense') !== 20_000) return fail('a junk grace did not fall back to the default')

      console.log(
        'WEB-SMOKE: delivery decision OK (13 rows, ' + swept + ' combinations, every non-delivery persists)'
      )
    }

    // ---- the documented surface matches the router (#51) ----
    {
      const doc = openApiDocument()
      const documented = Object.keys(doc.paths as Record<string, unknown>)

      // The versioned prefix is a rewrite, not a second table: the same route
      // must answer under both.
      r = await get('/api/v1/servers', ot)
      if (r.status !== 200) return fail('/api/v1/servers expected 200, got ' + r.status)
      const v1List = (await r.json()) as { servers: { id: string }[] }
      r = await get('/api/servers', ot)
      const unversioned = (await r.json()) as { servers: { id: string }[] }
      if (v1List.servers.length !== unversioned.servers.length) {
        return fail('the versioned and unversioned prefixes disagree')
      }
      r = await get('/api/v1/servers/' + id + '/console', ot)
      if (r.status !== 200) return fail('a nested v1 path expected 200, got ' + r.status)
      // The rewrite is anchored: a path that merely contains the prefix is not it.
      r = await get('/api/v2/servers', ot)
      if (r.status === 200) return fail('/api/v2 answered as if it were v1')

      // The index, the spec and the reference page need no credential — they
      // describe the software, not this install.
      r = await fetch(base + '/api/v1')
      if (r.status !== 200) return fail('the v1 index expected 200 without a credential, got ' + r.status)
      r = await fetch(base + '/api/v1/openapi.json')
      if (r.status !== 200) return fail('the spec expected 200 without a credential, got ' + r.status)
      const served = await r.text()
      if (served !== JSON.stringify(doc)) return fail('the served spec is not the generated one')
      // Unauthenticated and ~120 KB, so it is limited by address like the other
      // credential-less reads, and built once rather than per request. The same
      // bucket the public site spends from allows 300 of burst, so twenty in a
      // row does not trip it.
      for (let i = 0; i < 20; i++) {
        const again = await fetch(base + '/api/v1/openapi.json')
        if (again.status !== 200) return fail('a repeated spec fetch returned ' + again.status)
        if ((await again.text()) !== served) return fail('the spec changed between requests')
      }

      // ---- the app shells are built once, and safely so (#100) ----
      //
      // Both were rebuilt from their template literals per request, and both are
      // served before authentication. Caching them is only safe because neither
      // depends on config — every interpolation is a module constant, and
      // everything an operator can change is fetched by the page at runtime.
      // This is the assertion that keeps that true: change site config, and the
      // HTML must come back byte-identical. If a later change makes a page
      // config-derived, this fails rather than the cache quietly serving
      // yesterday's page.
      {
        const before = getPublicSiteHtml()
        const themeSnapshot = { ...siteMod.getSiteConfig().theme }
        const nameSnapshot = siteMod.getSiteConfig().siteName
        siteMod.setSiteConfig({
          theme: { ...themeSnapshot, accent: '#00ff88' },
          siteName: 'Cache Probe'
        })
        const after = getPublicSiteHtml()
        siteMod.setSiteConfig({ theme: themeSnapshot, siteName: nameSnapshot })
        if (before !== after) {
          return fail('the site page is config-derived, so caching it would serve a stale theme')
        }
        const panelBefore = getPanelHtml()
        if (getPanelHtml() !== panelBefore) return fail('the panel page is not deterministic')

        // Served once, then revalidated: an unchanged shell costs a 304.
        const p1 = await fetch(base + '/')
        if (p1.status !== 200) return fail('the panel page expected 200, got ' + p1.status)
        const tag = p1.headers.get('etag')
        if (!tag) return fail('the panel page carries no ETag')
        const body1 = await p1.text()
        const p2 = await fetch(base + '/', { headers: { 'If-None-Match': tag } })
        if (p2.status !== 304) return fail('a matching ETag expected 304, got ' + p2.status)
        if ((await p2.text()).length !== 0) return fail('a 304 carried a body')
        // Counted, not timed. The first version of this asserted an average
        // under 25ms across twenty requests; measured, the loopback round trip
        // is 13.3ms per request uncached against 10.85ms cached, so the
        // threshold could not fail and the assertion proved nothing. Counting
        // builds is the same claim with the noise removed.
        //
        // Every artefact is warmed first: a baseline taken before something's
        // FIRST request counts that legitimate build as a cache miss. The
        // counter caught exactly that here, which a timing threshold never
        // would have.
        await fetch(base + '/api/v1/docs')
        await fetch(base + '/api/v1/openapi.json')
        const buildsBefore = _buildCount()
        for (let i = 0; i < 20; i++) {
          const again = await fetch(base + '/')
          if ((await again.text()) !== body1) return fail('the panel page changed between requests')
          await fetch(base + '/api/v1/openapi.json')
          await fetch(base + '/api/v1/docs')
        }
        if (_buildCount() !== buildsBefore) {
          return fail(
            'sixty requests rebuilt ' +
              (_buildCount() - buildsBefore) +
              ' artefact(s): ' +
              _buildLog().slice(buildsBefore).join(', ')
          )
        }
        // ...and the memo is a memo, not a one-shot: after a reset the next
        // request builds again rather than serving an empty page.
        _resetPageCache()
        const rebuilt = await fetch(base + '/')
        if ((await rebuilt.text()) !== body1) return fail('the page differed after a cache reset')
        if (_buildCount() !== buildsBefore + 1) {
          return fail('a cache reset did not cause exactly one rebuild')
        }
      }
      // ...and nothing about this install may be in them, or "no credential" is
      // a disclosure rather than a convenience.
      const fixtureName = getConfig().servers.find((s) => s.id === id)?.name ?? ''
      r = await fetch(base + '/api/v1/docs')
      if (r.status !== 200) return fail('the docs page expected 200, got ' + r.status)
      const docsHtml = await r.text()
      for (const [what, text] of [
        ['spec', served],
        ['docs page', docsHtml]
      ] as [string, string][]) {
        if (text.includes(id)) return fail('the ' + what + ' leaks a server id')
        if (fixtureName && text.includes(fixtureName)) return fail('the ' + what + ' leaks a server name')
      }
      // No CDN: the panel's CSP forbids external assets, and a reference page
      // that needs the internet is a poor way to document a LAN tool.
      if (/(src|href)="https?:\/\//.test(docsHtml.replace(/http:\/\/127\.0\.0\.1/g, ''))) {
        return fail('the docs page pulls in an external asset')
      }

      /**
       * Coverage, derived from the ROUTER'S OWN SOURCE rather than from the
       * table the spec is generated from.
       *
       * A test that walks the spec's paths and checks each one exists can only
       * find routes that were documented and then deleted — never the reverse,
       * which is the failure that actually happens. So the route literals are
       * read out of `handlePanel` itself and each one must appear in the table.
       */
      const srcPath = join(process.cwd(), 'src', 'main', 'web', 'server.ts')
      if (!existsSync(srcPath)) return fail('cannot read the router source at ' + srcPath)
      const whole = readFileSync(srcPath, 'utf-8')
      const from = whole.indexOf('async function handlePanel')
      const to = whole.indexOf('export function startWebServer')
      if (from < 0 || to < 0 || to < from) return fail('could not isolate handlePanel in the source')
      const router = whole.slice(from, to)

      // `/api/…` literals, mapped onto the versioned form the table uses.
      for (const m of router.matchAll(/\b(?:raw)?[Pp]ath === '(\/api\/[^']*)'/g)) {
        const lit = m[1]
        const want = lit.startsWith('/api/v1') ? lit : API_PREFIX + lit.slice(4)
        if (!documented.includes(want)) {
          return fail('the router serves ' + lit + ' and the spec does not document it')
        }
      }

      // Sub-paths chosen by string comparison: `sub`, `action`, `rest`.
      // These are covered by a wildcard segment in the table (the eight
      // moderation actions, the four world actions) rather than by a path each.
      const wildcardCovered = new Set<string>([...MODERATION_ACTIONS, ...WORLD_ACTIONS, 'delete'])
      const segments = new Set<string>()
      for (const p of documented) for (const seg of p.split('/')) if (seg && !seg.startsWith('{')) segments.add(seg)
      for (const m of router.matchAll(/\b(?:sub|action|rest) === '([^']+)'/g)) {
        const token = m[1]
        if (!token || wildcardCovered.has(token)) continue
        // `rest` carries multi-segment values like `admin/category/delete`.
        if (token.split('/').every((seg) => segments.has(seg))) continue
        return fail('the router handles "' + token + '" and the spec documents no such path')
      }

      // ...and the other direction: nothing in the table may be invented.
      for (const p of documented) {
        const literals = p.slice(API_PREFIX.length).split('/').filter((s) => s && !s.startsWith('{'))
        const leaf = literals[literals.length - 1]
        if (!leaf) continue
        if (!router.includes("'" + leaf) && !router.includes('/' + leaf)) {
          return fail('the spec documents ' + p + ' and the router has no such route')
        }
      }

      // ...and the router can actually REACH them (#130).
      //
      // Everything above compares documentation to source literals, which says
      // nothing about routing. `/servers/{id}/map/tiles` was documented, present
      // as a literal in the handler, and unreachable for weeks: the route
      // matcher's `\w+` cannot match a slash, so every two-segment sub-route
      // fell through to the 404 at the bottom. The desktop app hid it by going
      // over IPC.
      //
      // A 404 with `not-found` is the fall-through; anything else — a real
      // answer, a 400, a 403 — means the route was found.
      {
        const fixture = getConfig().servers.find((s) => s.id === id)
        if (!fixture) return fail('the fixture server vanished before the reachability check')
        let checked = 0
        for (const route of API_ROUTES) {
          if (route.method !== 'GET') continue
          if (!route.path.startsWith('/servers/{id}')) continue
          const url = '/api' + route.path.replace('{id}', encodeURIComponent(id))
          // Only fixed paths. A route with another placeholder needs a value
          // that exists, and a legitimate "no such player" is indistinguishable
          // from "no such route" — which would make this assert nothing useful
          // about routing while looking like it did.
          if (url.includes('{')) continue
          // Owner token: a refusal for want of scope would hide the real
          // question, which is whether the router found the route at all.
          const rr = await get(url, ot)
          checked++
          if (rr.status === 404) {
            const body = (await rr.json().catch(() => ({}))) as { error?: string }
            if (body.error === 'not-found') {
              return fail('the router cannot reach a documented route: GET ' + url)
            }
          }
        }
        if (checked < 10) return fail('the reachability check only tried ' + checked + ' routes')
      }

      // Keep the checked-in copy current. It is a generated artefact, and a
      // stale one in the repo is worse than none — an integrator reads the file
      // in the repository, not the one this process would serve.
      writeFileSync(join(process.cwd(), 'docs', 'openapi.json'), JSON.stringify(doc, null, 2) + '\n', 'utf-8')

      console.log(
        'WEB-SMOKE: api docs OK (' + documented.length + ' documented paths, router-derived coverage both ways, no install data)'
      )
    }

    // ---- WebSocket frame codec (#27), pure ----
    {
      const enc = new TextEncoder()
      const dec = new TextDecoder()
      const textFrames = (evs: ReturnType<WsParser['push']>): string[] =>
        evs.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)

      // A frame delivered in one piece.
      let p = new WsParser()
      const hello = encodeClientFrame(WS_OP.text, enc.encode('{"op":"ping"}'))
      if (textFrames(p.push(hello))[0] !== '{"op":"ping"}') return fail('ws: a whole frame did not decode')

      // ...and the same frame delivered one byte at a time. TCP is a stream: a
      // parser that only works on whole frames works only in a test.
      p = new WsParser()
      let got: string[] = []
      for (let i = 0; i < hello.length; i++) got = got.concat(textFrames(p.push(hello.subarray(i, i + 1))))
      if (got.length !== 1 || got[0] !== '{"op":"ping"}') {
        return fail('ws: a byte-at-a-time frame produced ' + got.length + ' messages')
      }
      if (p.pending !== 0) return fail('ws: bytes were left buffered after a complete frame')

      // Three frames in one read, which is what a busy client actually looks like.
      p = new WsParser()
      const three = new Uint8Array(hello.length * 3)
      three.set(hello, 0)
      three.set(hello, hello.length)
      three.set(hello, hello.length * 2)
      if (textFrames(p.push(three)).length !== 3) return fail('ws: three frames in one chunk did not all decode')

      // A fragmented message assembles, and only then.
      p = new WsParser()
      const part1 = encodeClientFrame(WS_OP.text, enc.encode('{"a":'), undefined, false)
      const part2 = encodeClientFrame(WS_OP.continuation, enc.encode('1}'))
      if (textFrames(p.push(part1)).length !== 0) return fail('ws: a partial message was delivered early')
      if (textFrames(p.push(part2))[0] !== '{"a":1}') return fail('ws: fragments did not reassemble')

      // Every frame from a client is masked. An unmasked one is not a client.
      p = new WsParser()
      const unmasked = encodeFrame(WS_OP.text, enc.encode('hi'))
      const bad = p.push(unmasked)
      if (bad[0]?.type !== 'fail' || (bad[0] as { code: number }).code !== WS_CLOSE.protocolError) {
        return fail('ws: an unmasked client frame was accepted')
      }
      // ...and the parser stays shut afterwards rather than resynchronising.
      if (p.push(hello).length !== 0) return fail('ws: the parser kept reading after a protocol failure')

      // Server-to-client frames must NOT be masked, and must set FIN.
      if ((unmasked[0] & 0x80) === 0) return fail('ws: an outgoing frame did not set FIN')
      if ((unmasked[1] & 0x80) !== 0) return fail('ws: an outgoing frame was masked')
      // The rule is a property of the direction, not of the parser: a client
      // reading a server accepts unmasked and refuses masked. Both halves are
      // checked, because a parser that only enforces one of them is a parser
      // that cannot read the frames this same file encodes.
      const clientSide = new WsParser({ requireMask: false })
      if (textFrames(clientSide.push(unmasked))[0] !== 'hi') {
        return fail('ws: a client-side parser could not read a server frame')
      }
      if (new WsParser({ requireMask: false }).push(hello)[0]?.type !== 'fail') {
        return fail('ws: a masked server frame was accepted by a client-side parser')
      }

      // The length ladder: 125 (7-bit), 126 (16-bit), 65536 (64-bit).
      for (const size of [125, 126, 1000, 65535, WS_MAX_PAYLOAD]) {
        p = new WsParser()
        const body = 'x'.repeat(size)
        const round = textFrames(p.push(encodeClientFrame(WS_OP.text, enc.encode(body))))
        if (round[0] !== body) return fail('ws: a ' + size + '-byte payload did not round-trip')
      }
      // One byte past the cap is refused rather than allocated.
      p = new WsParser()
      const over = p.push(encodeClientFrame(WS_OP.text, enc.encode('y'.repeat(WS_MAX_PAYLOAD + 1))))
      if (over[0]?.type !== 'fail' || (over[0] as { code: number }).code !== WS_CLOSE.tooBig) {
        return fail('ws: an oversized payload was accepted')
      }
      // The same cap on the assembled message, or fragments are a way around it.
      p = new WsParser()
      const half = encodeClientFrame(WS_OP.text, enc.encode('z'.repeat(WS_MAX_PAYLOAD)), undefined, false)
      p.push(half)
      const spill = p.push(encodeClientFrame(WS_OP.continuation, enc.encode('z')))
      if (spill[0]?.type !== 'fail') return fail('ws: fragments walked past the payload cap')

      // Control frames are never fragmented and never long.
      p = new WsParser()
      const longPing = p.push(encodeClientFrame(WS_OP.ping, enc.encode('p'.repeat(126))))
      if (longPing[0]?.type !== 'fail') return fail('ws: an over-long control frame was accepted')
      p = new WsParser()
      const splitPing = p.push(encodeClientFrame(WS_OP.ping, enc.encode('p'), undefined, false))
      if (splitPing[0]?.type !== 'fail') return fail('ws: a fragmented control frame was accepted')

      // A reserved bit means an extension nobody negotiated.
      p = new WsParser()
      const rsv = encodeClientFrame(WS_OP.text, enc.encode('hi'))
      rsv[0] |= 0x40
      if (p.push(rsv)[0]?.type !== 'fail') return fail('ws: a reserved bit was ignored')

      // Invalid UTF-8 in a text frame is 1007, not a string of question marks.
      p = new WsParser()
      const junk = new Uint8Array([0xc3, 0x28])
      const utf = p.push(encodeClientFrame(WS_OP.text, junk))
      if (utf[0]?.type !== 'fail' || (utf[0] as { code: number }).code !== WS_CLOSE.invalidPayload) {
        return fail('ws: invalid UTF-8 was decoded anyway')
      }

      // Masking is its own inverse, which is the only reason unmasking in place
      // is safe.
      const sample = enc.encode('round trip')
      const maskKey = new Uint8Array([1, 2, 3, 4])
      const copy = sample.slice()
      maskPayload(maskPayload(copy, maskKey), maskKey)
      if (dec.decode(copy) !== 'round trip') return fail('ws: masking is not its own inverse')

      console.log('WEB-SMOKE: ws codec OK (split reads, fragments, masking, length ladder, protocol refusals)')
    }

    // ---- WebSocket live stream (#27) ----
    {
      const open: WsTestClient[] = []
      const connect = async (
        o: { path?: string; headers?: Record<string, string>; protocols?: string[] } = {}
      ): Promise<WsTestClient> => {
        const c = await wsTestConnect(8799, o)
        open.push(c)
        return c
      }
      const streamKey = apikeys.createKey({ label: 'smoke_ws', scopes: ['view'], servers: [id] })
      try {
        // No credential at all.
        let c = await connect()
        if (c.upgraded) return fail('ws: an unauthenticated upgrade succeeded')
        if (c.status !== 401) return fail('ws: an unauthenticated upgrade returned ' + c.status)

        // A credential for a path that is not the stream.
        c = await connect({ path: '/api/v1/nope', headers: { Authorization: 'Bearer ' + ot } })
        if (c.upgraded) return fail('ws: an upgrade on an unknown path succeeded')

        // An origin the operator has not allowed. Browsers do not apply CORS to
        // WebSocket, so this check is the only one there is.
        c = await connect({
          headers: { Authorization: 'Bearer ' + ot, Origin: 'https://evil.example' }
        })
        if (c.upgraded) return fail('ws: a disallowed origin was upgraded')
        if (c.status !== 403) return fail('ws: a disallowed origin returned ' + c.status)

        // ...but the page this listener itself served is not cross-origin, and
        // `apiOrigins` is default-deny. Judging an upgrade by the allowlist
        // alone would refuse the admin panel's own page — the most likely
        // browser client there is — until an operator thought to allowlist
        // their own address.
        c = await connect({
          headers: { Authorization: 'Bearer ' + ot, Origin: 'http://127.0.0.1:8799' }
        })
        if (!c.upgraded) return fail('ws: the panel’s own origin was refused (' + c.status + ')')
        c.end()
        // A different port on the same machine is still another origin.
        c = await connect({
          headers: { Authorization: 'Bearer ' + ot, Origin: 'http://127.0.0.1:8798' }
        })
        if (c.upgraded) return fail('ws: another port on this host was treated as same-origin')

        // Session token by header.
        c = await connect({ headers: { Authorization: 'Bearer ' + ot } })
        if (!c.upgraded) return fail('ws: an owner session was refused (' + c.status + ')')
        if (!c.acceptOk) return fail('ws: the Sec-WebSocket-Accept value is wrong')
        let msg = await c.wait((m) => m.type === 'hello')
        if (!msg) return fail('ws: no hello frame after upgrade')
        if (msg.user !== 'owner_t') return fail('ws: hello named the wrong user')
        c.end()

        // ...and by subprotocol, which is all a browser can send. The selected
        // subprotocol must be echoed, and must be the protocol name — never the
        // element carrying the credential.
        c = await connect({ protocols: ['msms.v1', 'msms-token.' + ot] })
        if (!c.upgraded) return fail('ws: subprotocol auth was refused (' + c.status + ')')
        if (c.protocol !== 'msms.v1') return fail('ws: the echoed subprotocol was ' + c.protocol)
        c.end()

        // An API key works too, and is limited by the same bucket as HTTP.
        c = await connect({ headers: { 'X-API-Key': streamKey.secret } })
        if (!c.upgraded) return fail('ws: an API key was refused (' + c.status + ')')
        if (!(await c.wait((m) => m.type === 'hello'))) return fail('ws: no hello for a key')

        // Subscribing is scope-checked, on the same `view` the REST reads need.
        c.send({ op: 'subscribe', serverId: 'no-such-server', streams: ['console'] })
        if (!(await c.wait((m) => m.error === 'server-not-found'))) {
          return fail('ws: subscribing to an unknown server was not refused')
        }
        c.send({ op: 'subscribe', serverId: id, streams: ['nonsense'] })
        if (!(await c.wait((m) => m.error === 'no-valid-streams'))) {
          return fail('ws: an unknown stream name was not refused')
        }
        c.send({ op: 'subscribe', serverId: id, streams: ['console', 'status'] })
        msg = await c.wait((m) => m.type === 'subscribed')
        if (!msg) return fail('ws: subscribe was not acknowledged')

        // The live path, end to end: a console line emitted by the process
        // manager reaches a subscriber as a console message.
        processManager.emit('log', {
          serverId: id,
          line: { id: 'x', ts: Date.now(), line: 'ws-smoke-line', stream: 'stdout' }
        })
        msg = await c.wait((m) => m.type === 'console')
        if (!msg) return fail('ws: a console line never reached the subscriber')
        if (msg.line !== 'ws-smoke-line') return fail('ws: the console line arrived mangled')
        if (msg.serverId !== id) return fail('ws: the console line lost its server id')

        // A line for a server this socket did not subscribe to must not arrive.
        const before = c.messages.length
        processManager.emit('log', {
          serverId: 'some-other-server',
          line: { id: 'y', ts: Date.now(), line: 'not-for-you', stream: 'stdout' }
        })
        await sleep(150)
        if (c.messages.slice(before).some((m) => m.line === 'not-for-you')) {
          return fail('ws: a subscriber received another server’s console')
        }

        // Unsubscribe means unsubscribe.
        c.send({ op: 'unsubscribe', serverId: id, streams: ['console'] })
        if (!(await c.wait((m) => m.type === 'unsubscribed'))) return fail('ws: unsubscribe was not acknowledged')
        const after = c.messages.length
        processManager.emit('log', {
          serverId: id,
          line: { id: 'z', ts: Date.now(), line: 'after-unsubscribe', stream: 'stdout' }
        })
        await sleep(150)
        if (c.messages.slice(after).some((m) => m.line === 'after-unsubscribe')) {
          return fail('ws: an unsubscribed stream kept delivering')
        }

        // The socket is read-only by construction: there is no op that changes
        // anything, and an unknown one is refused rather than ignored.
        c.send({ op: 'power', serverId: id, action: 'start' })
        if (!(await c.wait((m) => m.error === 'unknown-op'))) return fail('ws: an unknown op was not refused')

        // A user with no scope on the server cannot subscribe.
        for (const u of webAuth.listUsers()) if (u.username === 'nobody_t') webAuth.deleteUser(u.id)
        webAuth.createUser('nobody_t', 'nobodypass', 'user', {})
        const nr = await post('/api/login', { username: 'nobody_t', password: 'nobodypass' })
        const nt = ((await nr.json()) as { token: string }).token
        const noc = await connect({ headers: { Authorization: 'Bearer ' + nt } })
        if (!noc.upgraded) return fail('ws: a scopeless user could not even connect')
        noc.send({ op: 'subscribe', serverId: id, streams: ['console'] })
        if (!(await noc.wait((m) => m.error === 'forbidden'))) {
          return fail('ws: a user with no view scope was allowed to subscribe')
        }

        // Protocol violations close the connection rather than being tolerated.
        const rude = await connect({ headers: { Authorization: 'Bearer ' + ot } })
        if (!rude.upgraded) return fail('ws: the protocol-violation client could not connect')
        await rude.wait((m) => m.type === 'hello')
        rude.raw(encodeFrame(WS_OP.text, new TextEncoder().encode('unmasked')))
        await sleep(200)
        if (!rude.closes.some((x) => x.code === WS_CLOSE.protocolError)) {
          return fail('ws: an unmasked client frame did not close the connection')
        }

        console.log(
          'WEB-SMOKE: ws stream OK (401/403 on upgrade, header + subprotocol auth, scoped subscribe, live console, unmasked frame closed)'
        )
      } finally {
        for (const c of open) c.end()
        apikeys.deleteKey(streamKey.key.id)
        for (const u of webAuth.listUsers()) if (u.username === 'nobody_t') webAuth.deleteUser(u.id)
      }
    }

    // ---- player detail + live map (#49, #26) ----
    {
      // Pure map math first.
      if (normalizeDimension('minecraft:the_nether') !== 'nether') return fail('dimension not normalised')
      if (normalizeDimension('NORMAL') !== 'overworld') return fail('NORMAL is the overworld')
      if (normalizeDimension('') !== 'overworld') return fail('a missing dimension is not the overworld')
      // An unknown (modded) dimension is kept, not dropped: hiding those players
      // loses them from the one screen you would look for them on.
      if (normalizeDimension('twilightforest:twilight') !== 'twilightforest:twilight') {
        return fail('a modded dimension was rewritten')
      }

      // A position the plugin could not read must not plot at the origin.
      const feed = [
        { name: 'Alex', x: 100, y: 64, z: -40, dim: 'normal' },
        { name: 'Steve', x: 108, y: 70, z: -36, dim: 'NORMAL' },
        { name: 'Ghost', dim: 'normal' },
        { name: '', x: 1, y: 1, z: 1 },
        { name: 'Nether', x: 12, y: 40, z: 12, dim: 'the_nether' }
      ]
      const live = livePlayers(feed)
      if (live.length !== 3) return fail('livePlayers kept ' + live.length + ', expected 3')
      if (live.some((p) => p.name === 'Ghost')) return fail('a player with no position was plotted')
      if (live.some((p) => !p.name)) return fail('a nameless entry was plotted')

      // Bounds never collapse to a point, or every scale derived from them
      // divides by zero and one player renders infinitely magnified.
      const one = mapBounds([{ name: 'A', dim: 'overworld', x: 0, y: 0, z: 0 }])
      if (one.maxX - one.minX < 64) return fail('bounds collapsed for a single player')
      if (Math.abs((one.maxX + one.minX) / 2) > 0.001) return fail('bounds did not grow around the centre')
      const none = mapBounds([])
      if (!(none.maxX > none.minX && none.maxZ > none.minZ)) return fail('empty bounds are degenerate')

      // Heatmap buckets by chunk, busiest first, and emits nothing for empty cells.
      const heat = heatmap(
        [
          { x: 0, z: 0 },
          { x: 5, z: 5 },
          { x: 15, z: 15 },
          { x: 100, z: 0 }
        ],
        16
      )
      if (heat.length !== 2) return fail('heatmap produced ' + heat.length + ' cells, expected 2')
      if (heat[0].count !== 3) return fail('heatmap did not put the busiest cell first')
      if (heatmap([{ x: 1, z: 1 }], 0).length !== 0) return fail('a zero cell size should produce nothing')
      // Negative coordinates must floor toward -inf, or the cell left of spawn
      // and the cell right of it merge into one.
      const neg = heatmap([{ x: -1, z: -1 }, { x: 1, z: 1 }], 16)
      if (neg.length !== 2) return fail('negative coordinates shared a cell with positive ones')

      // ---- pan / zoom / readout (#104) ----
      {
        const vp = { width: 800, height: 500 }
        // Round-trip at every zoom level. The readout under the cursor IS this
        // inverse, so a transform that only works at one scale reads out a
        // coordinate that is wrong everywhere else.
        for (const scale of [MIN_SCALE, 0.1, 1, 3.7, MAX_SCALE]) {
          const view: MapView = { cx: 1234, cz: -5678, scale }
          for (const p of [{ x: 0, z: 0 }, { x: 1234, z: -5678 }, { x: -99999, z: 88888 }]) {
            const back = screenToWorld(worldToScreen(p, view, vp), view, vp)
            if (Math.abs(back.x - p.x) > 1e-6 || Math.abs(back.z - p.z) > 1e-6) {
              return fail('world/screen round-trip drifted at scale ' + scale)
            }
          }
        }
        // The centre of the viewport is the centre of the view, by definition.
        const centred = worldToScreen({ x: 10, z: 20 }, { cx: 10, cz: 20, scale: 2 }, vp)
        if (centred.x !== 400 || centred.y !== 250) return fail('the view centre is not at the viewport centre')

        // Zoom keeps the world point under the cursor fixed. Scaling around the
        // centre instead drags whatever the user was looking at away from the
        // pointer, so zooming towards something walks off it.
        const anchor = { x: 700, y: 90 }
        const before: MapView = { cx: 0, cz: 0, scale: 1 }
        const under = screenToWorld(anchor, before, vp)
        for (const f of [1.15, 1 / 1.15, 4, 0.25]) {
          const after = zoomAt(before, vp, anchor, f)
          const still = screenToWorld(anchor, after, vp)
          if (Math.abs(still.x - under.x) > 1e-6 || Math.abs(still.z - under.z) > 1e-6) {
            return fail('zooming by ' + f + ' moved the point under the cursor')
          }
        }
        // ...and it cannot zoom past the limits, in either direction.
        if (zoomAt(before, vp, anchor, 1e9).scale !== MAX_SCALE) return fail('zoom escaped MAX_SCALE')
        if (zoomAt(before, vp, anchor, 1e-9).scale !== MIN_SCALE) return fail('zoom escaped MIN_SCALE')
        if (clampScale(Number.NaN) !== 1) return fail('a non-finite scale did not fall back')

        // Dragging right moves the world right, so the centre moves left.
        const panned = panBy({ cx: 0, cz: 0, scale: 2 }, 100, -50)
        if (panned.cx !== -50 || panned.cz !== 25) return fail('pan moved the wrong way or distance')
        // Fit is a starting position, not a constraint: it must land inside the
        // scale limits for a world that is millions of blocks across.
        const wide = fitView({ minX: -3_000_000, maxX: 3_000_000, minZ: -3_000_000, maxZ: 3_000_000 }, vp)
        if (wide.scale < MIN_SCALE || wide.scale > MAX_SCALE) return fail('fitView escaped the scale limits')
        if (wide.cx !== 0 || wide.cz !== 0) return fail('fitView did not centre a symmetric world')
      }

      // ---- what a visitor is allowed to see (#104) ----
      {
        const exact: LivePlayer[] = [
          { name: 'Alex', uuid: 'u-1', world: 'world', dim: 'overworld', x: 1234, y: 12, z: -987 }
        ]
        const pub = redactPlayers(exact, { ...PUBLIC_MAP_DEFAULTS, enabled: true, serverId: 's' })
        const one = pub[0] as unknown as Record<string, unknown>
        // The panel payload's fields must not arrive here by being spread
        // through. Height is the sharp one: y=12 says "in a cave", which is
        // when a player cannot defend the base you would then walk to.
        for (const leaked of ['y', 'world', 'uuid']) {
          if (leaked in one) return fail('the public map payload carries "' + leaked + '"')
        }
        if (one.x === 1234 || one.z === -987) return fail('the public map published exact coordinates')
        if (Math.abs((one.x as number) - 1234) > 32) return fail('rounding moved a player more than half a cell')
        // Deterministic, not jittered: a watcher who samples a stationary
        // player repeatedly must not be able to average the noise away.
        const again = redactPlayers(exact, { ...PUBLIC_MAP_DEFAULTS, enabled: true, serverId: 's' })
        if (again[0].x !== pub[0].x || again[0].z !== pub[0].z) return fail('redaction is not deterministic')
        // Opt-ins.
        // Heads are drawn from the name since #116, so heads-on must publish
        // the name even when names are off — a recognisable face identifies a
        // player exactly as well as their name, and claiming otherwise would be
        // a lie. The uuid is gone from the payload entirely: it keyed the old
        // avatar lookup and nothing else ever asked for it.
        const withHeads = redactPlayers(exact, {
          ...PUBLIC_MAP_DEFAULTS, enabled: true, serverId: 's', heads: true, names: false
        })
        if (withHeads[0].name !== 'Alex') return fail('heads on should carry the name to draw one')
        if ('uuid' in (withHeads[0] as unknown as Record<string, unknown>)) {
          return fail('the public map payload still carries a uuid')
        }
        const noNames = redactPlayers(exact, { ...PUBLIC_MAP_DEFAULTS, enabled: true, serverId: 's', names: false })
        if ('name' in (noNames[0] as unknown as Record<string, unknown>)) {
          return fail('names off still published a name')
        }
        if (clampRound(-5) !== 0) return fail('a negative rounding was accepted')
        if (clampRound(99999) !== 512) return fail('rounding was not capped')
        if (clampRound('lots') !== PUBLIC_MAP_DEFAULTS.round) return fail('a junk rounding did not fall back')
        if (PUBLIC_MAP_DEFAULTS.enabled) return fail('the public map is on by default')
        if (PUBLIC_MAP_DEFAULTS.heads) return fail('avatar heads are on by default')
      }

      // ---- the endpoints ----
      // The map feed is view-gated and honest about the bridge being absent.
      r = await get('/api/servers/' + id + '/map', ft)
      if (r.status !== 200) return fail('map feed expected 200 for a view user, got ' + r.status)
      const mapBody = (await r.json()) as {
        bridge: boolean
        players: unknown[]
        bounds: { minX: number; maxX: number }
        dimension: string
      }
      if (mapBody.bridge !== false) return fail('the map claimed a live bridge with no plugin running')
      if (mapBody.players.length !== 0) return fail('the map invented players')
      if (!(mapBody.bounds.maxX > mapBody.bounds.minX)) return fail('the map served degenerate bounds')
      if (mapBody.dimension !== 'overworld') return fail('the map defaulted to the wrong dimension')

      // ---- the PUBLIC map feed (#104) ----
      {
        const mapBefore = siteMod.getSiteConfig().map
        try {
          // Off by default, and 404 rather than an empty map: answering 200
          // tells a prober that a map exists and is merely empty.
          siteMod.setSiteConfig({ map: { ...mapBefore, enabled: false } })
          let pr = await sget('/api/public/map')
          if (pr.status !== 404) return fail('the public map answered ' + pr.status + ' while off')
          const offSite = (await (await sget('/api/public/site')).json()) as { showMap: boolean }
          if (offSite.showMap) return fail('the site advertised a map tab while the map was off')

          // On, but pointed at a server that no longer exists. The setting
          // outliving its server is exactly what a plain boolean misses.
          siteMod.setSiteConfig({ map: { ...mapBefore, enabled: true, serverId: 'gone-' + Date.now() } })
          pr = await sget('/api/public/map')
          if (pr.status !== 404) return fail('the public map served a deregistered server')

          siteMod.setSiteConfig({ map: { ...mapBefore, enabled: true, serverId: id, round: 64 } })
          pr = await sget('/api/public/map')
          if (pr.status !== 200) return fail('the public map expected 200 when on, got ' + pr.status)
          const pub = (await pr.json()) as Record<string, unknown>
          if (pub.round !== 64) return fail('the public map did not report its rounding')
          if (pub.heads !== false) return fail('the public map claimed heads without the setting')
          // The panel's fields must not be here. A heatmap is a density map of
          // where people are, which is the thing rounding exists to blur.
          for (const leaked of ['heatmap', 'cell']) {
            if (leaked in pub) return fail('the public map payload carries "' + leaked + '"')
          }
          // And the page only offers the tab when the feed will answer.
          const onSite = (await (await sget('/api/public/site')).json()) as { showMap: boolean }
          if (!onSite.showMap) return fail('the map was on and the site did not advertise it')
          console.log('WEB-SMOKE: public map OK (404 while off or serverless, redacted payload, no heatmap)')
        } finally {
          siteMod.setSiteConfig({ map: mapBefore })
        }
      }

      // Detail is gated harder than the roster: it is one person's inventory,
      // ender chest and coordinates, not "who plays here".
      r = await get('/api/servers/' + id + '/players/Rosterd', ft)
      if (r.status !== 403) return fail('player detail without players scope expected 403, got ' + r.status)
      r = await get('/api/servers/' + id + '/players/no', ot)
      if (r.status !== 400) return fail('an invalid name expected 400, got ' + r.status)
      r = await get('/api/servers/' + id + '/players/NoSuchPlayer', ot)
      if (r.status !== 404) return fail('an unknown player expected 404, got ' + r.status)

      // Seed a roster entry the way the server itself would, then read it back.
      {
        const srv = getConfig().servers.find((s) => s.id === id)
        const cache = join(srv?.path ?? '', 'usercache.json')
        writeFileSync(cache, JSON.stringify([{ uuid: 'cccc-dddd', name: 'Detailed' }]), 'utf-8')
        r = await get('/api/servers/' + id + '/players/detailed', ot)
        if (r.status !== 200) return fail('player detail expected 200, got ' + r.status + ' ' + (await r.text()))
        const body = (await r.json()) as {
          player: { name: string }
          live: unknown
          liveSource: string | null
        }
        if (body.player.name !== 'Detailed') return fail('detail returned the wrong player')
        // No bridge running, so the live half must say so rather than quietly
        // presenting the last saved position as a current one.
        if (body.live !== null || body.liveSource !== null) {
          return fail('detail reported a live position with no bridge: ' + JSON.stringify(body.live))
        }
        rmSync(cache, { force: true })
      }
      console.log('WEB-SMOKE: player detail + live map OK (scope split, no-bridge honest, map math)')
    }

    // ---- operations API: moderation / worlds / backups (#53) ----
    {
      const opsBase = '/api/servers/' + id
      const af = join(auditDir(), 'audit.jsonl')
      const snap = existsSync(af) ? readFileSync(af, 'utf-8') : null
      // A key scoped to exactly one group, to prove the scopes are real rather
      // than "any authenticated caller can do anything".
      const modKey = apikeys.createKey({ label: 'smoke_mod', scopes: ['view', 'players'], servers: [id] })
      const worldKey = apikeys.createKey({ label: 'smoke_world', scopes: ['view', 'worlds'], servers: [id] })
      const bkKey = apikeys.createKey({ label: 'smoke_bk', scopes: ['view', 'backups'], servers: [id] })
      const kpost = (p: string, body: unknown, k: string): Promise<Response> =>
        fetch(base + p, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': k },
          body: JSON.stringify(body)
        })
      const kdel = (p: string, k: string): Promise<Response> =>
        fetch(base + p, { method: 'DELETE', headers: { 'X-API-Key': k } })

      let seededHere = false
      try {
        rmSync(af, { force: true })
        auditMod._reset()

        // ---- pure validators first ----
        for (const good of ['Steve', 'Notch_1', 'abc']) {
          if (!isValidMcName(good)) return fail('a legitimate player name was refused: ' + good)
        }
        for (const bad of ['ab', 'a'.repeat(17), 'Steve Smith', 'Steve\nstop', 'Steve;stop', '', 42]) {
          if (isValidMcName(bad as string)) return fail('an unsafe player name was accepted: ' + String(bad))
        }
        // The reason is free text and reaches a console command, so what matters
        // is that nothing in it can end the command or start another.
        const nasty = sanitizeCommandArg('grief\nstop\r\nop Mallory say hi')
        if (new RegExp('[\\r\\n\\u2028\\u2029]').test(nasty)) return fail('sanitizeCommandArg left a line break: ' + JSON.stringify(nasty))
        if (sanitizeCommandArg('x'.repeat(500)).length !== 120) return fail('reason not capped')
        for (const bad of [
          '..',
          '.',
          'a/b',
          'a\\b',
          'C:',
          'con',
          'CON.txt',
          // Windows drops a trailing dot or space, so each of these would
          // silently address an existing world while looking like a new one.
          'world.',
          'world ',
          ' world',
          'world\t',
          'x'.repeat(65),
          ''
        ]) {
          if (isValidWorldName(bad)) return fail('an unsafe world name was accepted: ' + JSON.stringify(bad))
        }
        for (const good of ['world', 'my_world-2', 'Dünya']) {
          if (!isValidWorldName(good)) return fail('a legitimate world name was refused: ' + good)
        }

        // ---- scope enforcement ----
        // friend_t holds view+console on this server, so every group refuses it.
        r = await post(opsBase + '/players/op', { player: 'Steve' }, ft)
        if (r.status !== 403) return fail('moderation without players expected 403, got ' + r.status)
        r = await post(opsBase + '/worlds/activate', { name: 'world' }, ft)
        if (r.status !== 403) return fail('world change without worlds expected 403, got ' + r.status)
        r = await post(opsBase + '/backups', {}, ft)
        if (r.status !== 403) return fail('backup create without backups expected 403, got ' + r.status)
        // ...and a key scoped to one group cannot reach another.
        r = await kpost(opsBase + '/worlds/activate', { name: 'world' }, modKey.secret)
        if (r.status !== 403) return fail('a players key reached worlds, got ' + r.status)
        r = await kpost(opsBase + '/players/op', { player: 'Steve' }, worldKey.secret)
        if (r.status !== 403) return fail('a worlds key reached moderation, got ' + r.status)

        // ---- moderation: injection is refused before anything runs ----
        r = await kpost(opsBase + '/players/op', { player: 'Steve\nstop' }, modKey.secret)
        if (r.status !== 400) return fail('a newline in a player name expected 400, got ' + r.status)
        if (((await r.json()) as { error: string }).error !== 'invalid-player-name') {
          return fail('a newline name was refused for the wrong reason')
        }
        // The refusal is audited: somebody trying it is worth seeing.
        if (!auditMod.query({ actions: ['player.op'] }).entries.some((e) => e.ok === false)) {
          return fail('a refused moderation call was not audited')
        }
        r = await kpost(opsBase + '/players/gamemode', { player: 'Steve', gamemode: 'god' }, modKey.secret)
        if (r.status !== 400) return fail('an invalid gamemode expected 400, got ' + r.status)
        // An unknown action is not a route.
        r = await kpost(opsBase + '/players/nuke', { player: 'Steve' }, modKey.secret)
        if (r.status !== 404) return fail('an unknown moderation action expected 404, got ' + r.status)

        // A valid call against a stopped server cannot reach ops.json without a
        // uuid, and says so as a conflict rather than a bad request.
        r = await kpost(opsBase + '/players/op', { player: 'NeverJoined' }, modKey.secret)
        if (r.status !== 409) return fail('op on a stopped server expected 409, got ' + r.status)
        const opErr = ((await r.json()) as { error: string }).error
        if (opErr !== 'uuid-unknown' && opErr !== 'requires-running') {
          return fail('unexpected error for offline op: ' + opErr)
        }

        // Whitelist by uuid works offline once the player is in the roster, so
        // seed one the way the server itself would.
        {
          const srv = getConfig().servers.find((s) => s.id === id)
          const wl = join(srv?.path ?? '', 'whitelist.json')
          const cache = join(srv?.path ?? '', 'usercache.json')
          writeFileSync(cache, JSON.stringify([{ uuid: 'aaaa-bbbb', name: 'Rosterd' }]), 'utf-8')
          writeFileSync(wl, '[]', 'utf-8')
          r = await kpost(opsBase + '/players/whitelist-add', { player: 'Rosterd' }, modKey.secret)
          if (r.status !== 200) return fail('offline whitelist-add expected 200, got ' + r.status + ' ' + (await r.text()))
          const after = JSON.parse(readFileSync(wl, 'utf-8')) as { name: string }[]
          if (!after.some((w) => w.name === 'Rosterd')) return fail('whitelist-add did not reach whitelist.json')
          if (!auditMod.query({ actions: ['player.whitelist-add'] }).entries.some((e) => e.ok && e.target === 'Rosterd')) {
            return fail('a successful moderation call was not audited')
          }
          rmSync(wl, { force: true })
          rmSync(cache, { force: true })
        }

        // ---- worlds ----
        // The web gate never starts a server, so the fixture has no world of its
        // own. Seed one: `isWorldFolder` is "contains level.dat", and without it
        // the clone/delete assertions below would quietly skip - a test that
        // silently does nothing is the failure mode this suite keeps hitting.
        const srvPath = getConfig().servers.find((s) => s.id === id)?.path ?? ''
        const seededWorld = join(srvPath, 'world')
        if (!existsSync(join(seededWorld, 'level.dat'))) {
          mkdirSync(seededWorld, { recursive: true })
          writeFileSync(join(seededWorld, 'level.dat'), 'not-real-nbt', 'utf-8')
          seededHere = true
        }
        r = await get(opsBase + '/worlds', ot)
        if (r.status !== 200) return fail('world list expected 200, got ' + r.status)
        const worldNames = ((await r.json()) as { worlds: { name: string }[] }).worlds.map((w) => w.name)
        // A traversal must never reach worlds.ts.
        r = await kpost(opsBase + '/worlds/activate', { name: '../../etc' }, worldKey.secret)
        if (r.status !== 400) return fail('a traversing world name expected 400, got ' + r.status)
        // Destructive ops demand confirm on top of the scope.
        r = await kpost(opsBase + '/worlds/reset', { name: 'world', dimension: 'nether' }, worldKey.secret)
        if (r.status !== 400) return fail('reset without confirm expected 400, got ' + r.status)
        if (((await r.json()) as { error: string }).error !== 'confirm-required') {
          return fail('reset without confirm gave the wrong error')
        }
        r = await kdel(opsBase + '/worlds?name=world', worldKey.secret)
        if (r.status !== 400) return fail('world delete without confirm expected 400, got ' + r.status)
        // ...and a bad dimension is still refused with confirm present.
        r = await kpost(opsBase + '/worlds/reset', { name: 'world', dimension: 'moon', confirm: true }, worldKey.secret)
        if (r.status !== 400) return fail('an invalid dimension expected 400, got ' + r.status)

        if (!worldNames.length) return fail('the world fixture did not register as a world')
        // A real, reversible change: clone then delete the copy.
        {
          const src = worldNames[0]
          r = await kpost(opsBase + '/worlds/clone', { name: src, newName: 'smoke_copy' }, worldKey.secret)
          if (r.status !== 200) return fail('world clone expected 200, got ' + r.status + ' ' + (await r.text()))
          if (!(await worldsMod.listWorlds(id)).some((w) => w.name === 'smoke_copy')) {
            return fail('clone reported success but produced no world')
          }
          if (!auditMod.query({ actions: ['world.clone'] }).entries.some((e) => e.ok)) {
            return fail('world.clone was not audited')
          }
          r = await kdel(opsBase + '/worlds?name=smoke_copy&confirm=true', worldKey.secret)
          if (r.status !== 200) return fail('world delete expected 200, got ' + r.status + ' ' + (await r.text()))
          if ((await worldsMod.listWorlds(id)).some((w) => w.name === 'smoke_copy')) {
            return fail('delete reported success but the world is still there')
          }
        }

        // ---- backups ----
        r = await kpost(opsBase + '/backups', { kind: 'world' }, bkKey.secret)
        if (r.status !== 200) return fail('backup create expected 200, got ' + r.status + ' ' + (await r.text()))
        const made = (await r.json()) as { id: string; fileName: string }
        if (!backupsMod.listBackups(id).some((x) => x.id === made.id)) {
          return fail('backup create returned a record that is not in the list')
        }
        if (!auditMod.query({ actions: ['backup.create'] }).entries.some((e) => e.ok)) {
          return fail('backup.create was not audited')
        }
        // Restore and delete both demand confirm.
        r = await kpost(opsBase + '/backups/restore', { backupId: made.id }, bkKey.secret)
        if (r.status !== 400) return fail('restore without confirm expected 400, got ' + r.status)
        r = await kdel(opsBase + '/backups?backupId=' + made.id, bkKey.secret)
        if (r.status !== 400) return fail('backup delete without confirm expected 400, got ' + r.status)
        // An id that is not this server's is not restorable from this server.
        r = await kpost(opsBase + '/backups/restore', { backupId: 'not-a-real-id', confirm: true }, bkKey.secret)
        if (r.status !== 404) return fail('restoring an unknown backup expected 404, got ' + r.status)
        r = await kdel(opsBase + '/backups?backupId=' + made.id + '&confirm=true', bkKey.secret)
        if (r.status !== 200) return fail('backup delete expected 200, got ' + r.status)
        if (backupsMod.listBackups(id).some((x) => x.id === made.id)) return fail('backup was not deleted')
        if (!auditMod.query({ actions: ['backup.delete'] }).entries.some((e) => e.ok)) {
          return fail('backup.delete was not audited')
        }

        // Every operation entry is attributed to the key, under the api source,
        // and names the server it acted on.
        //
        // Filtered to the operation actions on purpose: the api source ALSO
        // carries the generic `api.post`/`api.delete` entry that #85 writes for
        // every mutating key call, and that one records the path rather than a
        // server. It is the safety net for routes that do not audit themselves,
        // so it stays - but it is not what this assertion is about.
        const opsEntries = auditMod
          .query({ sources: ['api'] })
          .entries.filter((e) => /^(player|world|backup)\./.test(e.action))
        if (!opsEntries.length) return fail('no operation was recorded under the api source')
        if (!opsEntries.every((e) => e.actor.startsWith('key:'))) {
          return fail('an operation audit entry lost its key: ' + opsEntries.map((e) => e.actor).join(','))
        }
        if (!opsEntries.every((e) => e.serverId === id)) {
          return fail('an operation audit entry lost its server')
        }
        // ...and the generic net fired too, so a route that forgets to audit
        // itself still leaves a trace.
        if (!auditMod.query({ sources: ['api'], actions: ['api.post'] }).entries.length) {
          return fail('the generic api mutation entry stopped being written')
        }
        console.log(
          'WEB-SMOKE: operations API OK (scopes per group, injection + traversal refused, confirm gate, all audited)'
        )
      } finally {
        // Purge the fixture even on a failed assertion, or the next run starts
        // with a stale 'smoke_copy' and the clone reports name-taken.
        try {
          const sp = getConfig().servers.find((s) => s.id === id)?.path ?? ''
          rmSync(join(sp, 'smoke_copy'), { recursive: true, force: true })
          // Only remove the world if THIS run created it. A real world here
          // (from the spine gate, which does start a server) must survive.
          if (seededHere) rmSync(join(sp, 'world'), { recursive: true, force: true })
        } catch {
          /* best effort */
        }
        apikeys.deleteKey(modKey.key.id)
        apikeys.deleteKey(worldKey.key.id)
        apikeys.deleteKey(bkKey.key.id)
        if (snap == null) rmSync(af, { force: true })
        else writeFileSync(af, snap, 'utf-8')
      }
    }

    // ---- API keys (#48) + safety rails (#50) ----
    {
      // Pure bucket math first — the HTTP assertions below cannot distinguish
      // "the limiter works" from "the limiter is broken in a way that happens
      // to refuse things".
      const lim = { capacity: 3, refillPerSec: 1 }
      let b = newBucket(lim, 1000)
      for (let i = 0; i < 3; i++) {
        const step = consumeToken(b, lim, 1000)
        if (!step.allowed) return fail('bucket refused within its burst at spend ' + i)
        b = step.bucket
      }
      let over = consumeToken(b, lim, 1000)
      if (over.allowed) return fail('bucket allowed a 4th spend inside one instant')
      if (over.retryAfterSec < 1) return fail('a refusal must ask for at least a 1s wait')
      // one second later, exactly one token is back
      const after = consumeToken(over.bucket, lim, 2000)
      if (!after.allowed) return fail('bucket did not refill after a second')
      if (consumeToken(after.bucket, lim, 2000).allowed) {
        return fail('bucket refilled more than the elapsed time earns')
      }
      // a clock that jumps backwards must not mint tokens
      over = consumeToken(b, lim, 500)
      if (over.allowed) return fail('a backwards clock handed out a free token')
      // ...and it never exceeds capacity however long it idles
      const idle = consumeToken(newBucket(lim, 0), lim, 10_000_000)
      if (idle.bucket.tokens > lim.capacity) return fail('bucket overfilled past capacity')

      if (isOriginAllowed(undefined, ['https://a'])) return fail('a missing Origin was allowed')
      if (isOriginAllowed('https://a', [])) return fail('an empty allowlist allowed an origin')
      if (isOriginAllowed('https://b', ['https://a'])) return fail('an unlisted origin was allowed')
      if (!isOriginAllowed('https://A', [' https://a '])) return fail('origin match is not normalised')
      if (isOriginAllowed('https://evil', ['*'])) return fail('a wildcard entry matched an origin')

      // Purge leftovers first. A failed assertion skips the cleanup below, and
      // a stale key from the previous run would silently change what the
      // "issue a key" assertions are actually testing.
      for (const k of apikeys.listKeys()) {
        if (k.label.startsWith('smoke_')) apikeys.deleteKey(k.id)
      }
      const keyHdr = (k: string): Record<string, string> => ({ 'X-API-Key': k })
      const kget = (p: string, k: string): Promise<Response> =>
        fetch(base + p, { headers: keyHdr(k) })
      const kpost = (p: string, body: unknown, k: string): Promise<Response> =>
        fetch(base + p, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...keyHdr(k) },
          body: JSON.stringify(body)
        })

      // minting is owner-only, and never reachable with a key
      r = await post('/api/keys', { label: 'smoke_nope', scopes: ['view'], servers: 'all' }, ft)
      if (r.status !== 403) return fail('non-owner key create expected 403, got ' + r.status)

      // a view-only key, scoped to this one server
      r = await post('/api/keys', { label: 'smoke_view', scopes: ['view'], servers: [id] }, ot)
      if (r.status !== 200) return fail('owner key create expected 200, got ' + r.status)
      const issued = (await r.json()) as { key: { id: string; scopes: string[] }; secret: string }
      if (!issued.secret.startsWith('msms_')) return fail('issued secret is not prefixed: ' + issued.secret)

      // the raw secret must exist nowhere but that one response
      if (JSON.stringify(apikeys.listKeys()).includes(issued.secret)) {
        return fail('the raw key secret is readable from the key list')
      }

      // scope enforcement, exactly like a user
      r = await kget('/api/servers/' + id + '/console', issued.secret)
      if (r.status !== 200) return fail('view key on console read expected 200, got ' + r.status)
      r = await kpost('/api/servers/' + id + '/power', { action: 'start' }, issued.secret)
      if (r.status !== 403) return fail('view key on power expected 403, got ' + r.status)

      // a key cannot mint or revoke keys, however wide its scopes
      r = await kget('/api/keys', issued.secret)
      if (r.status !== 403) return fail('key listing keys expected 403, got ' + r.status)

      // Authorization: Bearer must work as well as X-API-Key
      r = await get('/api/servers/' + id + '/console', issued.secret)
      if (r.status !== 200) return fail('bearer-form key expected 200, got ' + r.status)

      // per-server allowlist: a key scoped elsewhere sees nothing here
      r = await post(
        '/api/keys',
        { label: 'smoke_elsewhere', scopes: ['view', 'power'], servers: ['some-other-server'] },
        ot
      )
      const elsewhere = (await r.json()) as { key: { id: string }; secret: string }
      r = await kget('/api/servers/' + id + '/console', elsewhere.secret)
      if (r.status !== 403) return fail('key scoped to another server expected 403, got ' + r.status)
      r = await kget('/api/servers', elsewhere.secret)
      const elseList = ((await r.json()) as { servers: { id: string }[] }).servers
      if (elseList.some((s) => s.id === id)) return fail('a key listed a server outside its allowlist')

      // revoked -> 401 (not 403: the credential itself is no longer valid)
      r = await post('/api/keys/revoke', { keyId: elsewhere.key.id }, ot)
      if (r.status !== 200) return fail('revoke expected 200, got ' + r.status)
      r = await kget('/api/servers', elsewhere.secret)
      if (r.status !== 401) return fail('revoked key expected 401, got ' + r.status)

      // expired -> 401. Issued through the store directly so the clock can be
      // moved rather than waiting a day.
      const exp = apikeys.createKey({ label: 'smoke_exp', scopes: ['view'], servers: 'all', expiresInDays: 1 })
      if (!apikeys.resolveKey(exp.secret)) return fail('a fresh key with an expiry did not resolve')
      if (apikeys.resolveKey(exp.secret, Date.now() + 2 * 86400_000)) {
        return fail('an expired key still resolved')
      }
      r = await kget('/api/servers', exp.secret + 'x')
      if (r.status !== 401) return fail('a tampered key expected 401, got ' + r.status)
      apikeys.deleteKey(exp.key.id)

      // key use is audited for mutations, and lands under its own source
      {
        const af = join(auditDir(), 'audit.jsonl')
        const snap = existsSync(af) ? readFileSync(af, 'utf-8') : null
        try {
          rmSync(af, { force: true })
          auditMod._reset()
          await kget('/api/servers/' + id + '/console', issued.secret) // GET: not audited
          await kpost('/api/servers/' + id + '/power', { action: 'start' }, issued.secret) // 403, still audited
          const apiEntries = auditMod.query({ sources: ['api'] }).entries
          if (apiEntries.length !== 1) {
            return fail('expected exactly one api audit entry (mutations only), got ' + apiEntries.length)
          }
          if (!apiEntries[0].actor.startsWith('key:')) {
            return fail('an api audit entry is not attributed to the key: ' + apiEntries[0].actor)
          }
        } finally {
          if (snap == null) rmSync(af, { force: true })
          else writeFileSync(af, snap, 'utf-8')
        }
      }

      // Rate limit: burst past the bucket, expect 429 + Retry-After.
      //
      // Fired concurrently on purpose. Sequentially, each round trip gives the
      // bucket time to refill, and whether the limit is ever reached becomes a
      // race between request latency and the refill rate — a test that passes
      // or fails depending on how busy the machine is. A burst is also what a
      // runaway client actually looks like.
      _resetRateLimits()
      const t0 = Date.now()
      const burst: Response[] = []
      // Batched rather than one giant Promise.all: a few hundred sockets opened
      // at once exhausts the connection pool and surfaces as "fetch failed",
      // which says nothing about the limiter.
      for (let sent = 0; sent < DEFAULT_KEY_LIMIT.capacity * 3 && !burst.some((x) => x.status === 429); sent += 30) {
        burst.push(...(await Promise.all(Array.from({ length: 30 }, () => kget('/api/me', issued.secret)))))
      }
      const elapsedSec = (Date.now() - t0) / 1000
      const limited = burst.filter((x) => x.status === 429)
      if (limited.length === 0) return fail('a runaway key was never rate limited')
      // The budget is the burst plus whatever the wall clock legitimately
      // earned back, computed rather than guessed - a fixed number here would
      // pass or fail depending on how fast the machine answered.
      const budget =
        DEFAULT_KEY_LIMIT.capacity + Math.ceil(elapsedSec * DEFAULT_KEY_LIMIT.refillPerSec) + 2
      const served = burst.filter((x) => x.status === 200).length
      if (served > budget) {
        return fail('the limiter served ' + served + ' with a budget of ' + budget)
      }
      const ra = Number(limited[0].headers.get('Retry-After'))
      if (!Number.isFinite(ra) || ra < 1) return fail('429 without a usable Retry-After: ' + ra)
      _resetRateLimits()
      // ...and the limit is per key, not global: a session must still work.
      r = await get('/api/me', ot)
      if (r.status !== 200) return fail('a rate-limited key blocked a human session, got ' + r.status)

      // CORS: default deny, no wildcard, ever
      const preflight = (origin: string): Promise<Response> =>
        fetch(base + '/api/servers', { method: 'OPTIONS', headers: { Origin: origin } })
      r = await preflight('https://evil.example')
      if (r.status !== 403) return fail('unlisted origin preflight expected 403, got ' + r.status)
      if (r.headers.get('Access-Control-Allow-Origin')) {
        return fail('a refused origin was still handed CORS headers')
      }
      updateConfig((c) => {
        if (c.web) c.web.apiOrigins = ['https://dash.example']
      })
      r = await preflight('https://dash.example')
      if (r.status !== 204) return fail('allowed origin preflight expected 204, got ' + r.status)
      if (r.headers.get('Access-Control-Allow-Origin') !== 'https://dash.example') {
        return fail('allowed origin did not get its own ACAO header')
      }
      r = await preflight('https://evil.example')
      if (r.headers.get('Access-Control-Allow-Origin')) {
        return fail('the allowlist leaked headers to an origin that is not on it')
      }

      // The unauthenticated public API is limited per address (#50).
      _resetRateLimits()
      const pub: Response[] = []
      for (let sent = 0; sent < 1200 && !pub.some((x) => x.status === 429); sent += 30) {
        pub.push(...(await Promise.all(Array.from({ length: 30 }, () => sget('/api/public/site')))))
      }
      if (!pub.some((x) => x.status === 429)) return fail('the public API was never rate limited')
      _resetRateLimits()
      if ((await sget('/api/public/site')).status !== 200) {
        return fail('the public API did not recover after its buckets were cleared')
      }

      // Resolving a key must stay cheap: it happens on every request, on the
      // same thread that runs the UI, and before there is a key id to charge a
      // rate-limit bucket against. A slow KDF here is a self-inflicted DoS, not
      // a hardening measure - the secret is 256 random bits, so there is no
      // guessing surface for one to protect.
      {
        const perf = apikeys.createKey({ label: 'smoke_perf', scopes: ['view'], servers: 'all' })
        const n = 200
        const started = Date.now()
        for (let i = 0; i < n; i++) apikeys.resolveKey(perf.secret)
        const each = (Date.now() - started) / n
        apikeys.deleteKey(perf.key.id)
        if (each > 2) return fail('key resolution costs ' + each.toFixed(1) + ' ms per request')
      }

      apikeys.deleteKey(issued.key.id)
      apikeys.deleteKey(elsewhere.key.id)
      console.log(
        'WEB-SMOKE: API keys OK (scope + server allowlist, revoked/expired/tampered 401, audited, rate limited, CORS default-deny)'
      )
    }
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
