/**
 * Finding, comparing and deciding about the Bridge plugin jar (#103).
 *
 * Pure on purpose: every rule here is one that only ever runs when someone is
 * about to write a jar into a live server's `plugins/` folder, which is the
 * worst place to find out a rule was wrong.
 *
 * Half of what MSMS can show — true TPS, MSPT, live player positions, the world
 * map — needs this plugin, and until now installing it meant reading a README,
 * running a build script and copying a jar by hand. Most people who install a
 * server manager will never do that, so the features that depend on it looked
 * broken rather than optional.
 */

import type { ServerType } from './types'

/** The repository whose releases are the only accepted source. */
export const BRIDGE_REPO = 'CaYatur/MinecraftServerManagementSystem'

/**
 * The asset name the installer will accept, and nothing else.
 *
 * Anchored at both ends. A release can carry anything its author uploaded —
 * installers, checksums, a screenshot someone dragged in — and "contains
 * MSMS-Bridge" would let `MSMS-Bridge-notes.txt.jar` through. The version group
 * is what the update check compares, so it is part of the match rather than
 * parsed out of a looser one afterwards.
 */
export const BRIDGE_JAR_RE = /^MSMS-Bridge-(\d+(?:\.\d+)*)\.jar$/i

/**
 * Server types that can run it.
 *
 * Deliberately not `TPS_TYPES`, which answers a different question: that list is
 * about the console `tps` command, this one is about the Bukkit plugin API. The
 * plugin calls `getTPS()` and `getAverageTickTime()`, both of which are Spigot
 * API — so Spigot belongs here and does not belong in `TPS_TYPES`.
 *
 * `bukkit` is excluded: the type means legacy CraftBukkit, which predates
 * `getAverageTickTime()`. A plugin that fails to load is a worse answer than a
 * feature that says it is unavailable.
 */
export const BRIDGE_TYPES: ServerType[] = ['paper', 'folia', 'purpur', 'spigot', 'mohist', 'arclight']

export function bridgeSupported(type: ServerType): boolean {
  return BRIDGE_TYPES.includes(type)
}

/** The version in a jar name, or null when the name is not one of ours. */
export function bridgeVersionOf(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? ''
  return BRIDGE_JAR_RE.exec(base)?.[1] ?? null
}

/**
 * Compare two of OUR version strings. > 0 when `a` is newer.
 *
 * The mod updater deliberately never compares version strings — a Modrinth
 * `version_number` is arbitrary text and sorting it is a guess. This one is
 * different in kind: the string comes out of a filename this project publishes,
 * in a format this file defines, so comparing it numerically is reading our own
 * data rather than guessing at someone else's.
 */
export function compareBridgeVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** One asset on a GitHub release, in the shape the API returns. */
export interface GhAsset {
  name: string
  browser_download_url: string
  size?: number
  /** `sha256:<hex>`, published by GitHub for newer assets. */
  digest?: string | null
}

export interface GhRelease {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  published_at?: string
  assets?: GhAsset[]
}

export interface BridgeAsset {
  version: string
  name: string
  url: string
  /** Lowercase hex sha256, when the release publishes one. */
  sha256?: string
  tag: string
}

/**
 * The newest published Bridge jar across a list of releases.
 *
 * Tag-agnostic: the app's release and the plugin's release do not have to be
 * the same one, and requiring that would mean re-uploading an unchanged 6 KB
 * jar with every app version.
 *
 * Ordered by the jar's own version rather than by `published_at`, because that
 * is the number the update check compares against what is installed. Sorting by
 * date and comparing by version would let a re-published older jar look like an
 * upgrade. Drafts and pre-releases are skipped: an operator clicking "install"
 * on a warning is not opting into a test build.
 */
export function pickBridgeAsset(releases: GhRelease[]): BridgeAsset | null {
  const found: BridgeAsset[] = []
  for (const rel of releases ?? []) {
    if (rel.draft || rel.prerelease) continue
    for (const a of rel.assets ?? []) {
      const version = bridgeVersionOf(a.name)
      if (!version || !a.browser_download_url) continue
      // Only over https, and only from GitHub's own asset host. The URL comes
      // from a response body; nothing else in this flow re-checks it before it
      // is handed to the downloader.
      if (!isGithubAssetUrl(a.browser_download_url)) continue
      found.push({
        version,
        name: a.name,
        url: a.browser_download_url,
        tag: rel.tag_name ?? '',
        ...(sha256Of(a.digest) ? { sha256: sha256Of(a.digest) as string } : {})
      })
    }
  }
  if (!found.length) return null
  found.sort((x, y) => compareBridgeVersions(y.version, x.version))
  return found[0]
}

/** `sha256:abc…` -> `abc…`. Anything else, including sha1, is not accepted. */
export function sha256Of(digest: string | null | undefined): string | null {
  const m = /^sha256:([0-9a-f]{64})$/i.exec((digest ?? '').trim())
  return m ? m[1].toLowerCase() : null
}

export function isGithubAssetUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return (
      u.hostname === 'github.com' ||
      u.hostname === 'api.github.com' ||
      u.hostname === 'objects.githubusercontent.com'
    )
  } catch {
    return false
  }
}

export type BridgeState =
  /** This server type cannot run it. Say nothing. */
  | 'unsupported'
  /** Supported, nothing installed. This is the case worth warning about. */
  | 'missing'
  /** Installed, but older than what is published. */
  | 'outdated'
  | 'ok'

export interface BridgeNeed {
  state: BridgeState
  installed?: string
  latest?: string
  /** Whether an install/update action should be offered. */
  actionable: boolean
}

/**
 * What to tell the operator about one server.
 *
 * `latest` being absent is not a problem to report: with no network and no
 * bundled jar there is nothing to offer, and a warning whose button does
 * nothing is worse than silence. An installed jar with no known latest is
 * simply `ok` — it is working, and this function has no evidence otherwise.
 */
export function bridgeNeed(input: {
  type: ServerType
  installed?: string | null
  latest?: string | null
}): BridgeNeed {
  if (!bridgeSupported(input.type)) return { state: 'unsupported', actionable: false }
  const installed = input.installed ?? null
  const latest = input.latest ?? null
  if (!installed) {
    return {
      state: 'missing',
      ...(latest ? { latest } : {}),
      actionable: !!latest
    }
  }
  if (latest && compareBridgeVersions(latest, installed) > 0) {
    return { state: 'outdated', installed, latest, actionable: true }
  }
  return { state: 'ok', installed, ...(latest ? { latest } : {}), actionable: false }
}

/** What the panel, the desktop app and the API all receive. */
export interface BridgeStatus extends BridgeNeed {
  serverId: string
  /** Where an install would come from, if one is possible. */
  source: 'github' | 'bundled' | null
  /** The release check failed. The bundled jar still works, so this is a note. */
  offline?: boolean
}

export interface BridgeInstallResult {
  ok: boolean
  version?: string
  source?: 'github' | 'bundled'
  /** Older jars taken out of `plugins/`, which is why the install is safe. */
  removed?: string[]
  error?: string
}
