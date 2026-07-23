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
