import {
  readdirSync,
  readFileSync,
  statSync,
  renameSync,
  rmSync,
  copyFileSync,
  existsSync,
  mkdirSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { join, basename } from 'node:path'
import { getServer } from './serverRegistry'
import { httpJson, httpJsonPost, downloadFile } from './net'
import * as events from './events'
import { log } from '../logger'
import { MODDED_TYPES, PLUGIN_TYPES } from '@shared/types'
import {
  diffUpdates,
  folderForLoaders,
  pickCompatibleVersion,
  planModSwap,
  safeJarName,
  summariseVersion,
  PLUGIN_LOADERS
} from '@shared/mods'
import type { ServerType } from '@shared/types'
import type {
  InstalledMod,
  ModEntry,
  ModrinthDetail,
  ModrinthHit,
  ModUpdateReport,
  MrVersion,
  MrVersionInfo
} from '@shared/mods'

type ModFolder = 'plugins' | 'mods'

/**
 * Windows and macOS treat `Foo.jar` and `foo.jar` as one file; Linux does not.
 * The update swap has to know, or it deletes what it just downloaded.
 */
const CASE_INSENSITIVE_FS = process.platform === 'win32' || process.platform === 'darwin'

function root(id: string): string {
  const s = getServer(id)
  if (!s) throw new Error('server-not-found')
  return s.path
}

function foldersFor(type: ServerType): ModFolder[] {
  const f: ModFolder[] = []
  if (PLUGIN_TYPES.includes(type)) f.push('plugins')
  if (MODDED_TYPES.includes(type)) f.push('mods')
  if (f.length === 0) f.push('plugins', 'mods')
  return [...new Set(f)]
}

/** Guard a mod path to plugins/ or mods/ inside the server. */
function safeRel(rel: string): string {
  if (rel.includes('..') || (!rel.startsWith('plugins/') && !rel.startsWith('mods/'))) {
    throw new Error('invalid-mod-path')
  }
  return rel
}

export function listMods(id: string): ModEntry[] {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')
  const out: ModEntry[] = []
  for (const folder of foldersFor(server.type)) {
    const dir = join(server.path, folder)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!/\.jar(\.disabled)?$/i.test(f)) continue
      const enabled = !/\.disabled$/i.test(f)
      let size = 0
      try {
        size = statSync(join(dir, f)).size
      } catch {
        /* ignore */
      }
      out.push({
        name: f.replace(/\.jar(\.disabled)?$/i, ''),
        fileName: f,
        path: `${folder}/${f}`,
        enabled,
        size,
        folder
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function toggleMod(id: string, rel: string, enable: boolean): void {
  const full = join(root(id), safeRel(rel))
  const target = enable
    ? full.replace(/\.disabled$/i, '')
    : /\.disabled$/i.test(full)
      ? full
      : full + '.disabled'
  if (full !== target) renameSync(full, target)
}

export function deleteMod(id: string, rel: string): void {
  rmSync(join(root(id), safeRel(rel)), { force: true })
}

export function addMod(id: string, folder: ModFolder, sourcePath: string): void {
  const dir = join(root(id), folder)
  mkdirSync(dir, { recursive: true })
  copyFileSync(sourcePath, join(dir, basename(sourcePath)))
}

// ---- Modrinth ----
const MR = 'https://api.modrinth.com/v2'

const MR_LOADER: Partial<Record<ServerType, string>> = {
  paper: 'paper',
  folia: 'folia',
  purpur: 'purpur',
  spigot: 'spigot',
  bukkit: 'bukkit',
  fabric: 'fabric',
  quilt: 'quilt',
  forge: 'forge',
  neoforge: 'neoforge',
  velocity: 'velocity',
  waterfall: 'waterfall',
  bungeecord: 'bungeecord',
  mohist: 'paper',
  arclight: 'paper'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function searchModrinth(id: string, query: string): Promise<ModrinthHit[]> {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')
  // Filter to the loaders this server can actually run. A single inner array is
  // OR'd by Modrinth, so a plugin server matches the whole Bukkit family (incl.
  // plugins tagged only `spigot`/`bukkit`); disjoint taxonomies then keep mods
  // and plugins from mixing. Plugins are indexed as project_type "mod" on
  // Modrinth, so we deliberately do NOT filter by project_type (it would drop
  // every plugin) — the loader facet is the correct separator.
  const loaders = searchLoaders(server.type)
  const facets: string[][] = []
  if (loaders.length) facets.push(loaders.map((l) => `categories:${l}`))
  if (server.mcVersion && server.mcVersion !== 'unknown') facets.push([`versions:${server.mcVersion}`])
  const url =
    `${MR}/search?limit=20&index=relevance&query=${encodeURIComponent(query)}` +
    (facets.length ? `&facets=${encodeURIComponent(JSON.stringify(facets))}` : '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await httpJson<{ hits: any[] }>(url)
  return r.hits.map((h) => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    downloads: h.downloads,
    iconUrl: h.icon_url || undefined
  }))
}

// ---- update checking ----

/**
 * Loaders to accept when checking updates. A Paper/Purpur/Folia server runs
 * plugins tagged for any member of the Bukkit family, and older plugins are
 * often tagged only `spigot` or `bukkit` - so filtering an update query to the
 * single canonical loader would report those as "unknown" and silently miss a
 * real (possibly security) update. Widening across the mutually-compatible
 * plugin family is safe; modded and proxy loaders do not cross-load and stay
 * single. `[]` means "do not filter by loader" (an unknown server type).
 */
const PLUGIN_LOADER_FAMILY = PLUGIN_LOADERS

export function loadersFor(type: ServerType): string[] {
  if (PLUGIN_TYPES.includes(type) && !MODDED_TYPES.includes(type)) return PLUGIN_LOADER_FAMILY
  const single = MR_LOADER[type]
  return single ? [single] : []
}

/** Mod loaders a hybrid (mohist/arclight) can run alongside Bukkit plugins. */
const HYBRID_MOD_LOADERS = ['forge']

/**
 * Modrinth loaders to *search* for a server type. Unlike loadersFor (which drives
 * the hash-based update check), this decides what browse results a user should
 * see, so a hybrid unions the plugin family with its mod loaders — mohist should
 * show both plugins and Forge mods. Because the loader taxonomies are disjoint
 * (nothing is tagged both `paper` and `fabric`), filtering to these loaders is
 * what keeps a Fabric server from listing plugins and vice-versa. Pure.
 */
export function searchLoaders(type: ServerType): string[] {
  const isPlugin = PLUGIN_TYPES.includes(type)
  const isModded = MODDED_TYPES.includes(type)
  if (isPlugin && isModded) return [...new Set([...PLUGIN_LOADER_FAMILY, ...HYBRID_MOD_LOADERS])]
  if (isPlugin) return PLUGIN_LOADER_FAMILY
  const single = MR_LOADER[type]
  return single ? [single] : []
}

function fileSha1(path: string): string {
  return createHash('sha1').update(readFileSync(path)).digest('hex')
}

/**
 * Ask Modrinth, in one request, whether any installed jar has a newer
 * compatible file. Never throws for a network problem - the mods list must
 * still render - it comes back `{ ok: false }` so the UI can say "couldn't
 * check" instead of losing the plugins.
 */
export async function checkUpdates(id: string): Promise<ModUpdateReport> {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')
  const installed: InstalledMod[] = []
  for (const m of listMods(id)) {
    try {
      installed.push({ path: m.path, name: m.name, sha1: fileSha1(join(server.path, m.path)) })
    } catch {
      /* an unreadable jar simply has no update info */
    }
  }
  if (!installed.length) return { ok: true, updates: [] }

  const loaders = loadersFor(server.type)
  try {
    const byHash = await httpJsonPost<Record<string, MrVersion>>(`${MR}/version_files/update`, {
      hashes: installed.map((i) => i.sha1),
      algorithm: 'sha1',
      ...(loaders.length ? { loaders } : {}),
      ...(server.mcVersion && server.mcVersion !== 'unknown'
        ? { game_versions: [server.mcVersion] }
        : {})
    })
    return { ok: true, updates: diffUpdates(installed, byHash) }
  } catch (e) {
    log.warn('mod update check failed:', e)
    return { ok: false, updates: [] }
  }
}

/**
 * Replace an installed jar with a specific Modrinth version. The versionId
 * comes from `checkUpdates`, but the download URL is fetched here, server-side
 * - never taken from the renderer - so a compromised UI cannot point this at
 * an arbitrary file. The disabled state is preserved.
 */
export async function applyUpdate(id: string, rel: string, versionId: string): Promise<string> {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')
  const oldRel = safeRel(rel)

  const v = await httpJson<MrVersion>(`${MR}/version/${encodeURIComponent(versionId)}`)
  const file = v.files.find((f) => f.primary) ?? v.files[0]
  if (!file?.url) throw new Error('no-file-in-version')

  // The whole decision - target folder, on-disk name, and whether the old jar
  // is a separate file that must be removed - is pure and smoke-covered.
  const plan = planModSwap(oldRel, file.filename, { caseInsensitive: CASE_INSENSITIVE_FS })
  const folder: ModFolder = plan.folder
  const dir = join(server.path, folder)
  mkdirSync(dir, { recursive: true })
  const newName = plan.newName
  await downloadFile(file.url, join(dir, newName), { sha1: file.hashes?.sha1 })

  // Remove the old jar only when it is genuinely a different file, or the
  // server would load both copies. A same-name update already overwrote it.
  if (plan.removeRel) {
    const oldFull = join(server.path, plan.removeRel)
    if (existsSync(oldFull)) rmSync(oldFull, { force: true })
  }
  events.record(id, 'mod.updated', {
    text: file.filename,
    data: { version: v.version_number, folder }
  })
  log.info(`Mod updated: ${oldRel} -> ${newName} (${v.version_number}) for ${id}`)
  return newName
}

/** Where a jar goes when the version itself declares no loaders. */
function fallbackFolder(type: ServerType): ModFolder {
  return MODDED_TYPES.includes(type) ? 'mods' : 'plugins'
}

const MAX_BODY = 4000

/**
 * Full project detail for the browse tab (#47): metadata, links, and a
 * compatibility verdict for THIS server.
 *
 * Versions are fetched unfiltered and matched locally so the UI can tell
 * "nothing for your Minecraft version" apart from "nothing for your loader" —
 * a server-side filtered query collapses both into an empty list. The loader
 * set is `searchLoaders`, the same one browse results were filtered by, so a
 * result that is listed can never claim a compatibility the install then
 * refuses.
 */
export async function modrinthDetail(id: string, projectId: string): Promise<ModrinthDetail> {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')
  const key = encodeURIComponent(projectId)
  const loaders = searchLoaders(server.type)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [project, versions, members] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    httpJson<any>(`${MR}/project/${key}`),
    httpJson<MrVersionInfo[]>(`${MR}/project/${key}/version`),
    // The author is a separate call; losing it must not lose the whole detail.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    httpJson<any[]>(`${MR}/project/${key}/members`).catch(() => [])
  ])

  const mcVersion =
    server.mcVersion && server.mcVersion !== 'unknown' ? server.mcVersion : undefined
  const compatible = pickCompatibleVersion(versions, { mcVersion, loaders })
  // Context when nothing matches: does the project support this loader at all?
  const latestForLoader = pickCompatibleVersion(versions, { loaders })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const owner = members.find((m: any) => m.role === 'Owner') ?? members[0]
  const body = typeof project.body === 'string' ? project.body : undefined

  return {
    projectId: project.id ?? projectId,
    slug: project.slug ?? projectId,
    title: project.title ?? projectId,
    description: project.description ?? '',
    ...(body ? { body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) + '…' : body } : {}),
    ...(owner?.user?.username ? { author: owner.user.username } : {}),
    downloads: project.downloads ?? 0,
    ...(typeof project.followers === 'number' ? { followers: project.followers } : {}),
    ...(project.license?.name || project.license?.id
      ? { license: project.license.name || project.license.id }
      : {}),
    categories: Array.isArray(project.categories) ? project.categories : [],
    ...(project.icon_url ? { iconUrl: project.icon_url } : {}),
    links: {
      project: `https://modrinth.com/project/${project.slug ?? projectId}`,
      ...(project.source_url ? { source: project.source_url } : {}),
      ...(project.issues_url ? { issues: project.issues_url } : {}),
      ...(project.wiki_url ? { wiki: project.wiki_url } : {}),
      ...(project.discord_url ? { discord: project.discord_url } : {})
    },
    ...(mcVersion ? { mcVersion } : {}),
    loaders,
    ...(compatible ? { compatible: summariseVersion(compatible) } : {}),
    ...(latestForLoader ? { latestForLoader: summariseVersion(latestForLoader) } : {}),
    versionCount: versions.length
  }
}

/**
 * Install a project. `versionId` (from the detail view) is validated against
 * that project's own version list before use, so the renderer can pick a
 * version but never point the download at an arbitrary file.
 *
 * The target folder comes from the chosen version's loaders, not the server
 * type: a hybrid (mohist/arclight) runs Bukkit plugins AND Forge mods, and
 * deciding by type alone dropped every plugin into `mods/`.
 */
export async function installModrinth(
  id: string,
  projectId: string,
  versionId?: string
): Promise<string> {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')
  const versions = await httpJson<MrVersionInfo[]>(
    `${MR}/project/${encodeURIComponent(projectId)}/version`
  )
  const v = versionId
    ? versions.find((x) => x.id === versionId)
    : pickCompatibleVersion(versions, {
        mcVersion:
          server.mcVersion && server.mcVersion !== 'unknown' ? server.mcVersion : undefined,
        loaders: searchLoaders(server.type)
      })
  if (!v) throw new Error('no-compatible-version')
  const file = v.files.find((f) => f.primary) ?? v.files[0]
  if (!file?.url) throw new Error('no-file-in-version')
  const folder = folderForLoaders(v.loaders, fallbackFolder(server.type))
  const dir = join(server.path, folder)
  mkdirSync(dir, { recursive: true })
  // The API supplies this name; it must not be able to steer the write out of
  // the server folder.
  const name = safeJarName(file.filename)
  await downloadFile(file.url, join(dir, name), { sha1: file.hashes?.sha1 })
  log.info(`Mod installed: ${name} (${v.version_number}) -> ${folder}/ for ${id}`)
  return name
}
