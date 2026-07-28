/**
 * Install the Bridge plugin, from GitHub Releases or the copy shipped with the
 * app (#103).
 *
 * The security shape is the Modrinth installer's, for the Modrinth installer's
 * reasons: the caller names nothing. No URL, no path and no version string
 * reaches the downloader — a caller asks for "the bridge, on this server" and
 * this module resolves what that means. Anything less makes an authenticated
 * `files` request into "write a file of my choosing into your server folder".
 */
import { app } from 'electron'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getServer } from './serverRegistry'
import { httpJson, downloadFile } from './net'
import * as audit from './audit'
import { log } from '../logger'
import type { AuditSource } from '@shared/audit'
import {
  BRIDGE_JAR_RE,
  BRIDGE_REPO,
  bridgeNeed,
  bridgeSupported,
  bridgeVersionOf,
  compareBridgeVersions,
  isGithubAssetUrl,
  pickBridgeAsset,
  type BridgeAsset,
  type BridgeInstallResult,
  type BridgeStatus,
  type GhRelease
} from '@shared/bridgeRelease'

// ---- what is installed ----

function pluginsDir(serverId: string): string {
  const s = getServer(serverId)
  if (!s) throw new Error('server-not-found')
  return join(s.path, 'plugins')
}

/**
 * Every bridge jar in `plugins/`, newest first.
 *
 * A list rather than a single answer because finding two is the case that
 * matters: Bukkit loads both, the second one fails on a duplicate plugin name,
 * and the operator sees "MSMS-Bridge could not be enabled" with no hint that
 * the cause is the jar they installed sitting next to the one they already had.
 */
function installedJars(serverId: string): { name: string; version: string }[] {
  const dir = pluginsDir(serverId)
  if (!existsSync(dir)) return []
  const out: { name: string; version: string }[] = []
  for (const name of readdirSync(dir)) {
    const version = bridgeVersionOf(name)
    if (version) out.push({ name, version })
  }
  return out.sort((a, b) => compareBridgeVersions(b.version, a.version))
}

export function installedBridgeVersion(serverId: string): string | null {
  return installedJars(serverId)[0]?.version ?? null
}

// ---- the copy that ships with the app ----

/**
 * `resources/` in the repo during development; `resources/bridge/` next to the
 * executable once packaged (see `extraResources` in electron-builder.yml).
 *
 * Kept OUT of the asar deliberately. It is a file an operator may reasonably
 * want to find and copy by hand — that was the only way to install it before
 * this change — and burying it inside an archive to save nothing would remove
 * the escape hatch this whole feature is a convenience for.
 */
function bundledDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'bridge') : join(process.cwd(), 'resources')
}

export function bundledBridge(): { version: string; path: string; name: string } | null {
  const dir = bundledDir()
  if (!existsSync(dir)) return null
  const found = readdirSync(dir)
    .map((name) => ({ name, version: bridgeVersionOf(name) }))
    .filter((x): x is { name: string; version: string } => !!x.version)
    .sort((a, b) => compareBridgeVersions(b.version, a.version))[0]
  return found ? { ...found, path: join(dir, found.name) } : null
}

// ---- the newest published one ----

const RELEASES_URL = `https://api.github.com/repos/${BRIDGE_REPO}/releases?per_page=30`
let releaseCache: { at: number; asset: BridgeAsset | null } | null = null
const RELEASE_TTL_MS = 30 * 60_000

/**
 * The newest published jar, or null.
 *
 * Cached for half an hour including the null: a box with no internet is exactly
 * where a server manager runs, and asking GitHub again on every panel render
 * would spend a request per page load to learn the same thing.
 */
export async function latestBridge(force = false): Promise<BridgeAsset | null> {
  if (!force && releaseCache && Date.now() - releaseCache.at < RELEASE_TTL_MS) {
    return releaseCache.asset
  }
  let asset: BridgeAsset | null = null
  try {
    asset = pickBridgeAsset(await httpJson<GhRelease[]>(RELEASES_URL))
  } catch (e) {
    log.info('Bridge: release check failed (' + String(e) + '); the bundled jar still works')
    asset = null
  }
  releaseCache = { at: Date.now(), asset }
  return asset
}

export function _resetBridgeCache(): void {
  releaseCache = null
}

// ---- status ----

/**
 * What to say about one server.
 *
 * The published version and the bundled one are compared, and the newer wins:
 * an app that has been open for a month should not offer its own stale copy
 * when a newer one exists, and a fresh build should not report an "update" to a
 * jar older than the one it ships.
 */
export async function bridgeStatus(serverId: string): Promise<BridgeStatus> {
  const s = getServer(serverId)
  if (!s) throw new Error('server-not-found')
  if (!bridgeSupported(s.type)) {
    return { serverId, state: 'unsupported', actionable: false, source: null }
  }
  const installed = installedBridgeVersion(serverId)
  const remote = await latestBridge()
  const bundled = bundledBridge()
  const offline = remote === null

  let source: 'github' | 'bundled' | null = null
  let latest: string | null = null
  if (remote && bundled) {
    const useRemote = compareBridgeVersions(remote.version, bundled.version) >= 0
    source = useRemote ? 'github' : 'bundled'
    latest = useRemote ? remote.version : bundled.version
  } else if (remote) {
    source = 'github'
    latest = remote.version
  } else if (bundled) {
    source = 'bundled'
    latest = bundled.version
  }

  const need = bridgeNeed({ type: s.type, installed, latest })
  return { serverId, ...need, source: need.actionable ? source : null, ...(offline ? { offline: true } : {}) }
}

// ---- install ----

/**
 * Put the newest bridge jar into `plugins/`, and take the old ones out.
 *
 * Removing the previous jars is not tidiness. Bukkit reads every jar in the
 * folder and refuses the second plugin with a name it has already loaded, so an
 * update that only added a file would leave the server logging a duplicate-name
 * error and running whichever copy it happened to read first — the exact
 * failure an operator would blame on the new version.
 */
export async function installBridge(
  serverId: string,
  who: { by: string; source: AuditSource }
): Promise<BridgeInstallResult> {
  const s = getServer(serverId)
  if (!s) return { ok: false, error: 'server-not-found' }
  if (!bridgeSupported(s.type)) return refuse(serverId, who, 'unsupported-type')

  const remote = await latestBridge()
  const bundled = bundledBridge()
  const preferRemote =
    !!remote && (!bundled || compareBridgeVersions(remote.version, bundled.version) >= 0)
  if (!remote && !bundled) return refuse(serverId, who, 'no-jar-available')

  const dir = pluginsDir(serverId)
  mkdirSync(dir, { recursive: true })

  let version: string
  let written: string
  let from: 'github' | 'bundled'

  if (preferRemote && remote) {
    // Re-checked here and not only where the asset was picked. This is the last
    // line before a URL from a response body is handed to the downloader, and
    // the two checks are cheap next to what passing a bad one would cost.
    if (!isGithubAssetUrl(remote.url)) return refuse(serverId, who, 'bad-asset-url')
    if (!BRIDGE_JAR_RE.test(remote.name)) return refuse(serverId, who, 'bad-asset-name')
    written = join(dir, remote.name)
    try {
      await downloadFile(remote.url, written, {
        ...(remote.sha256 ? { sha256: remote.sha256 } : {}),
        timeoutMs: 60_000
      })
    } catch (e) {
      rmSync(written, { force: true })
      return refuse(serverId, who, 'download-failed: ' + String(e))
    }
    version = remote.version
    from = 'github'
  } else if (bundled) {
    written = join(dir, bundled.name)
    copyFileSync(bundled.path, written)
    version = bundled.version
    from = 'bundled'
  } else {
    return refuse(serverId, who, 'no-jar-available')
  }

  // Only after the new jar is on disk. Removing first would leave a server with
  // no bridge at all if the download failed halfway.
  const removed: string[] = []
  for (const old of installedJars(serverId)) {
    if (join(dir, old.name) === written) continue
    rmSync(join(dir, old.name), { force: true })
    removed.push(old.name)
  }

  audit.record({
    source: who.source,
    action: 'bridge.install',
    actor: who.by,
    ok: true,
    serverId,
    target: version,
    detail: from + (removed.length ? ' (replaced ' + removed.join(', ') + ')' : '')
  })
  log.info(`Bridge: installed ${version} from ${from} for ${serverId}`)
  return { ok: true, version, source: from, removed }
}

function refuse(
  serverId: string,
  who: { by: string; source: AuditSource },
  error: string
): BridgeInstallResult {
  audit.record({
    source: who.source,
    action: 'bridge.install',
    actor: who.by,
    ok: false,
    serverId,
    detail: error
  })
  return { ok: false, error }
}

/**
 * The sha256 of the bundled jar, for the smoke.
 *
 * Exported rather than computed at the call site so the test hashes the file
 * the installer actually copies, not one it located by repeating the lookup.
 */
export function bundledBridgeSha256(): string | null {
  const b = bundledBridge()
  return b ? createHash('sha256').update(readFileSync(b.path)).digest('hex') : null
}
