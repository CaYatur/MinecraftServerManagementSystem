export interface ModEntry {
  name: string
  fileName: string
  path: string // relative to server root
  enabled: boolean
  size: number
  folder: 'plugins' | 'mods'
}

export interface ModrinthHit {
  projectId: string
  slug: string
  title: string
  description: string
  downloads: number
  iconUrl?: string
}

/**
 * Modrinth loaders that all run the same Bukkit-family plugin jar. Lives here
 * (not in core) because both the update check and the pure folder decision
 * need it, and they must not drift apart.
 */
export const PLUGIN_LOADERS = ['paper', 'purpur', 'folia', 'spigot', 'bukkit']

// ---- project detail (#47) ----

/** A Modrinth version enriched with the fields the compatibility check reads. */
export interface MrVersionInfo extends MrVersion {
  name?: string
  game_versions?: string[]
  loaders?: string[]
  version_type?: string
  date_published?: string
  downloads?: number
}

/** One version reduced to what the detail UI shows. */
export interface ModVersionSummary {
  id: string
  versionNumber: string
  name?: string
  versionType?: string
  gameVersions: string[]
  loaders: string[]
  datePublished?: string
  filename?: string
}

export interface ModrinthDetail {
  projectId: string
  slug: string
  title: string
  description: string
  /** Long description (markdown source), truncated main-side. */
  body?: string
  author?: string
  downloads: number
  followers?: number
  license?: string
  categories: string[]
  iconUrl?: string
  links: {
    project: string
    source?: string
    issues?: string
    wiki?: string
    discord?: string
  }
  /** The server this compatibility verdict was computed against. */
  mcVersion?: string
  loaders: string[]
  /** Best version matching this server's MC version + loaders, when one exists. */
  compatible?: ModVersionSummary
  /** Newest version for these loaders regardless of MC version — context when nothing matches. */
  latestForLoader?: ModVersionSummary
  /** Total versions the project publishes (all loaders). */
  versionCount: number
}

function matchesLoaders(v: MrVersionInfo, loaders: string[]): boolean {
  // No filter requested (unknown server type), or a version that declares no
  // loaders at all: do not exclude it — claiming "incompatible" on missing
  // metadata is worse than showing it and letting the install decide.
  if (!loaders.length) return true
  if (!v.loaders || v.loaders.length === 0) return true
  return v.loaders.some((l) => loaders.includes(l))
}

function matchesGameVersion(v: MrVersionInfo, mcVersion?: string): boolean {
  if (!mcVersion || mcVersion === 'unknown') return true
  if (!v.game_versions || v.game_versions.length === 0) return true
  return v.game_versions.includes(mcVersion)
}

/** Newest first; a version with no date keeps its incoming (API) order. */
function byNewest(a: MrVersionInfo, b: MrVersionInfo): number {
  const ta = a.date_published ? Date.parse(a.date_published) : NaN
  const tb = b.date_published ? Date.parse(b.date_published) : NaN
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0
  if (Number.isNaN(ta)) return 1
  if (Number.isNaN(tb)) return -1
  return tb - ta
}

/**
 * Pure: pick the best version of a project for a given server.
 *
 * Same doctrine as `diffUpdates` — a `version_number` is arbitrary text and is
 * NEVER compared as if it sorted. Recency comes from `date_published`, and a
 * stable `release` is preferred over `beta`/`alpha` even when the pre-release
 * is newer, because that is what an operator installing on a live server wants.
 *
 * Passing `loaders: []` means "do not filter by loader".
 */
export function pickCompatibleVersion(
  versions: MrVersionInfo[],
  opts: { mcVersion?: string; loaders?: string[] }
): MrVersionInfo | undefined {
  const loaders = opts.loaders ?? []
  const usable = versions.filter(
    (v) => matchesLoaders(v, loaders) && matchesGameVersion(v, opts.mcVersion)
  )
  if (!usable.length) return undefined
  const sorted = [...usable].sort(byNewest)
  return sorted.find((v) => v.version_type === 'release') ?? sorted[0]
}

/**
 * Pure: which folder a version's jar belongs in. A hybrid server (mohist,
 * arclight) runs BOTH Bukkit plugins and Forge mods, so the server type alone
 * cannot decide — the version's own loaders do. `fallback` covers a version
 * that declares no loaders.
 */
export function folderForLoaders(
  loaders: string[] | undefined,
  fallback: 'plugins' | 'mods'
): 'plugins' | 'mods' {
  if (!loaders || loaders.length === 0) return fallback
  return loaders.some((l) => PLUGIN_LOADERS.includes(l)) ? 'plugins' : 'mods'
}

// ---- update file-swap (#29) ----

export interface ModSwapPlan {
  folder: 'plugins' | 'mods'
  /** What the downloaded jar must be called on disk. */
  newName: string
  /**
   * The old jar to delete afterwards, relative to the server root, or `null`
   * when the download already replaced it in place.
   */
  removeRel: string | null
}

/** basename without node:path - this module is shared with the renderer. */
function baseName(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? rel : rel.slice(i + 1)
}

/**
 * Pure: decide what an update writes and what it removes.
 *
 * Extracted from `applyUpdate` so the decision is testable (#29) rather than
 * only reachable by actually downloading a jar.
 *
 * `caseInsensitive` is not a nicety. On Windows and macOS `LuckPerms.jar` and
 * `luckperms.jar` are the SAME file, so a version that only changes the
 * filename's case has already been overwritten by the download - and deleting
 * "the old one" would delete the jar that was just installed, leaving the
 * server with no plugin at all. A plain string comparison gets this wrong in
 * exactly the case where the damage is silent.
 */
export function planModSwap(
  oldRel: string,
  newFilename: string,
  opts: { caseInsensitive: boolean }
): ModSwapPlan {
  const folder: 'plugins' | 'mods' = oldRel.startsWith('mods/') ? 'mods' : 'plugins'
  const wasDisabled = /\.disabled$/i.test(oldRel)
  // A disabled jar stays disabled: an update must never silently switch a
  // plugin the operator turned off back on.
  const newName = wasDisabled ? newFilename + '.disabled' : newFilename
  const oldBase = baseName(oldRel)
  const same = opts.caseInsensitive
    ? oldBase.toLowerCase() === newName.toLowerCase()
    : oldBase === newName
  return { folder, newName, removeRel: same ? null : `${folder}/${oldBase}` }
}

/** Shrink a version to what the renderer needs. */
export function summariseVersion(v: MrVersionInfo): ModVersionSummary {
  const pf = v.files.find((f) => f.primary) ?? v.files[0]
  return {
    id: v.id,
    versionNumber: v.version_number,
    ...(v.name ? { name: v.name } : {}),
    ...(v.version_type ? { versionType: v.version_type } : {}),
    gameVersions: v.game_versions ?? [],
    loaders: v.loaders ?? [],
    ...(v.date_published ? { datePublished: v.date_published } : {}),
    ...(pf?.filename ? { filename: pf.filename } : {})
  }
}

// ---- update checking (Modrinth version_files/update) ----

/**
 * - `update`  : Modrinth has a newer compatible file than the one installed
 * - `current` : the installed file is already the latest compatible one
 * - `unknown` : Modrinth does not recognise this jar (not indexed, or no
 *               compatible version for this loader/MC) - so nothing is claimed
 */
export type ModUpdateState = 'update' | 'current' | 'unknown'

export interface ModUpdate {
  /** Installed jar, relative to the server root. */
  path: string
  name: string
  state: ModUpdateState
  /** Latest compatible version's name, when known (display only). */
  latestVersion?: string
  /** The exact version to install - apply re-fetches this server-side. */
  projectId?: string
  versionId?: string
  filename?: string
}

export interface ModUpdateReport {
  /** false => the check itself could not run (offline / API error). */
  ok: boolean
  updates: ModUpdate[]
}

/** One installed jar reduced to what the diff needs. */
export interface InstalledMod {
  path: string
  name: string
  sha1: string
}

/** A Modrinth version, only the fields the diff reads. */
export interface MrVersion {
  id: string
  project_id: string
  version_number: string
  files: Array<{ primary?: boolean; filename: string; url?: string; hashes?: { sha1?: string } }>
}

function primaryFile(v: MrVersion): MrVersion['files'][number] | undefined {
  return v.files.find((f) => f.primary) ?? v.files[0]
}

/**
 * Pure: decide, per installed jar, whether a newer file exists.
 *
 * `byHash` is Modrinth's `version_files/update` response - keyed by the very
 * hash we sent, valued with the latest compatible version. The ONLY signal is
 * the hash: a version_number is arbitrary text and must never be compared as
 * if it sorted. Update ⇔ the latest compatible file's sha1 differs from what
 * is on disk.
 */
export function diffUpdates(
  installed: InstalledMod[],
  byHash: Record<string, MrVersion>
): ModUpdate[] {
  return installed.map((m) => {
    const v = byHash[m.sha1] ?? byHash[m.sha1.toLowerCase()]
    if (!v) return { path: m.path, name: m.name, state: 'unknown' as const }
    const pf = primaryFile(v)
    const latestSha1 = pf?.hashes?.sha1?.toLowerCase()
    if (latestSha1 && latestSha1 === m.sha1.toLowerCase()) {
      return { path: m.path, name: m.name, state: 'current' as const, latestVersion: v.version_number }
    }
    return {
      path: m.path,
      name: m.name,
      state: 'update' as const,
      latestVersion: v.version_number,
      projectId: v.project_id,
      versionId: v.id,
      ...(pf?.filename ? { filename: pf.filename } : {})
    }
  })
}
