import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import { cacheDir } from '../paths'
import { log } from '../logger'
import { httpJson, downloadFile } from './net'
import { textureCandidates, wantsTexture, textureKey, assetVersion } from '@shared/textures'
import type { AssetStatus } from '@shared/textures'

/**
 * Item and block textures, taken from Mojang's own client jar (#127).
 *
 * The app used to hot-link `assets.mcasset.cloud` for every item icon. That is a
 * third party in the middle of a private server's inventory, it tells them which
 * items an operator is looking at, and on an air-gapped LAN — a normal place to
 * run this — it renders a grid of broken images.
 *
 * Mojang publishes the client jar for every version and MSMS already downloads
 * and sha1-verifies jars from that same manifest, so this needs no new trust and
 * no new dependency. One download per Minecraft version, shared by every server
 * on it.
 *
 * Nothing here is required for the app to work: with no assets downloaded, the
 * lookup answers null and the caller draws what it drew before.
 */

const MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'

interface Manifest {
  versions: { id: string; type: string; url: string }[]
}
interface VersionDetail {
  downloads?: { client?: { url: string; sha1: string; size?: number } }
}

/** `msms-data/cache/assets/<version>/`. Beside the other per-version data. */
function versionDir(version: string): string {
  return join(cacheDir(), 'assets', version)
}

function indexPath(version: string): string {
  return join(versionDir(version), 'index.json')
}

/**
 * In-flight downloads, keyed by version.
 *
 * Two servers on the same version opening a profile at once must not start two
 * 28 MB downloads. The promise is shared, so the second caller waits for the
 * first rather than racing it into the same directory.
 */
const inFlight = new Map<string, Promise<AssetStatus>>()

function readIndex(version: string): string[] {
  try {
    const p = indexPath(version)
    if (!existsSync(p)) return []
    const j = JSON.parse(readFileSync(p, 'utf-8')) as { keys?: string[] }
    return Array.isArray(j.keys) ? j.keys : []
  } catch {
    return []
  }
}

function dirSizeMB(dir: string): number {
  let n = 0
  try {
    for (const f of readdirSync(dir)) {
      try {
        n += statSync(join(dir, f)).size
      } catch {
        // A file that vanished between listing and stat is not worth failing a
        // size report over.
      }
    }
  } catch {
    return 0
  }
  return Math.round((n / 1048576) * 10) / 10
}

export function assetStatus(mcVersion: string): AssetStatus {
  const version = assetVersion(mcVersion)
  if (!version) return { version: '', ready: false, count: 0, busy: false, sizeMB: 0 }
  const keys = readIndex(version)
  return {
    version,
    ready: keys.length > 0,
    count: keys.length,
    busy: inFlight.has(version),
    sizeMB: keys.length ? dirSizeMB(versionDir(version)) : 0
  }
}

/**
 * One texture's PNG bytes, or null.
 *
 * Never downloads. A lookup that could start a 28 MB fetch would make drawing an
 * inventory unpredictably slow, and this is called once per slot; fetching is
 * something the operator asks for, once, in the UI.
 */
export function itemTexture(mcVersion: string, id: string): Buffer | null {
  const version = assetVersion(mcVersion)
  if (!version) return null
  const dir = versionDir(version)
  for (const cand of textureCandidates(id)) {
    // `textureCandidates` only ever returns `item/x` or `block/x` with `x`
    // matched against [a-z0-9_], so this cannot leave the directory.
    const p = join(dir, cand.replace('/', '__') + '.png')
    try {
      if (existsSync(p)) return readFileSync(p)
    } catch {
      // Unreadable file: try the next candidate rather than failing the row.
    }
  }
  return null
}

/** Many at once, so drawing an inventory is one call rather than forty. */
export function itemTextures(mcVersion: string, ids: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const id of ids.slice(0, 256)) {
    if (out[id] !== undefined) continue
    const png = itemTexture(mcVersion, id)
    if (png) out[id] = 'data:image/png;base64,' + png.toString('base64')
  }
  return out
}

async function resolveClientJar(version: string): Promise<{ url: string; sha1: string }> {
  const m = await httpJson<Manifest>(MANIFEST)
  const entry = m.versions.find((v) => v.id === version)
  if (!entry) throw new Error('unknown-version')
  const detail = await httpJson<VersionDetail>(entry.url)
  const dl = detail.downloads?.client
  // `downloads.client`, not `.server` — the same object carries both, and the
  // server jar has no assets in it at all.
  if (!dl?.url || !dl.sha1) throw new Error('no-client-jar-for-version')
  return { url: dl.url, sha1: dl.sha1 }
}

/**
 * Download the client jar for this version and extract the two texture folders.
 *
 * Idempotent: with the textures already on disk it returns immediately without
 * touching the network, which is what makes it safe to call from a button an
 * operator may press twice.
 */
export async function ensureClientAssets(
  mcVersion: string,
  onProgress?: (pct: number, note: string) => void
): Promise<AssetStatus> {
  const version = assetVersion(mcVersion)
  if (!version) throw new Error('unknown-version')
  const have = assetStatus(version)
  if (have.ready) return have
  const running = inFlight.get(version)
  if (running) return running

  const task = (async (): Promise<AssetStatus> => {
    const dir = versionDir(version)
    mkdirSync(dir, { recursive: true })
    // Staged outside the cache: a jar half-written into the assets directory
    // would be indistinguishable from a finished one on the next start.
    const jar = join(tmpdir(), `msms-client-${version}-${Date.now()}.jar`)
    try {
      onProgress?.(0, 'resolving')
      const { url, sha1 } = await resolveClientJar(version)
      onProgress?.(2, 'downloading')
      await downloadFile(url, jar, {
        sha1,
        timeoutMs: 120_000,
        // 0-95% is the download; extraction is the rest. A bar that sits at 100
        // while a jar is still being unpacked is a bar that looks stuck.
        onProgress: (got, total) =>
          onProgress?.(total ? 2 + Math.round((got / total) * 93) : 50, 'downloading')
      })
      onProgress?.(96, 'extracting')
      const zip = new AdmZip(jar)
      const keys: string[] = []
      for (const e of zip.getEntries()) {
        if (e.isDirectory) continue
        const name = e.entryName.replace(/\\/g, '/')
        if (!wantsTexture(name)) continue
        const key = textureKey(name)
        if (!key) continue
        // Flattened with a separator that cannot occur in a texture name, so the
        // directory stays one level deep and no entry name from the archive is
        // ever used as a path.
        writeFileSync(join(dir, key.replace('/', '__') + '.png'), e.getData())
        keys.push(key)
      }
      if (!keys.length) throw new Error('no-textures-in-jar')
      writeFileSync(indexPath(version), JSON.stringify({ version, keys, at: Date.now() }), 'utf-8')
      log.info(`Client assets: extracted ${keys.length} textures for ${version}`)
      onProgress?.(100, 'done')
      return assetStatus(version)
    } catch (e) {
      // A failed extraction must not leave a directory that looks half-ready.
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Best effort; the missing index is what makes it not-ready anyway.
      }
      throw e
    } finally {
      try {
        rmSync(jar, { force: true })
      } catch {
        // A leftover temp jar is untidy, not broken.
      }
      inFlight.delete(version)
    }
  })()

  inFlight.set(version, task)
  return task
}

/** Drop one version's textures. Returns how many files went. */
export function clearClientAssets(mcVersion: string): number {
  const version = assetVersion(mcVersion)
  if (!version) return 0
  const dir = versionDir(version)
  const n = readIndex(version).length
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    return 0
  }
  return n
}
