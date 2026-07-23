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
import { diffUpdates } from '@shared/mods'
import type { ServerType } from '@shared/types'
import type { InstalledMod, ModEntry, ModrinthHit, ModUpdateReport, MrVersion } from '@shared/mods'

type ModFolder = 'plugins' | 'mods'

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
  const loader = MR_LOADER[server.type]
  const facets: string[][] = []
  if (loader) facets.push([`categories:${loader}`])
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

  const loader = MR_LOADER[server.type]
  try {
    const byHash = await httpJsonPost<Record<string, MrVersion>>(`${MR}/version_files/update`, {
      hashes: installed.map((i) => i.sha1),
      algorithm: 'sha1',
      ...(loader ? { loaders: [loader] } : {}),
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
  const oldFull = join(server.path, oldRel)
  const wasDisabled = /\.disabled$/i.test(oldRel)
  const folder: ModFolder = oldRel.startsWith('mods/') ? 'mods' : 'plugins'

  const v = await httpJson<MrVersion>(`${MR}/version/${encodeURIComponent(versionId)}`)
  const file = v.files.find((f) => f.primary) ?? v.files[0]
  if (!file?.url) throw new Error('no-file-in-version')

  const dir = join(server.path, folder)
  mkdirSync(dir, { recursive: true })
  const newName = wasDisabled ? file.filename + '.disabled' : file.filename
  const dest = join(dir, newName)
  await downloadFile(file.url, dest, { sha1: file.hashes?.sha1 })

  // Remove the old jar when the filename changed, or the server would load
  // both the old and the new copy. A same-name update just overwrote it.
  if (join(dir, basename(oldFull)) !== dest && existsSync(oldFull)) {
    rmSync(oldFull, { force: true })
  }
  events.record(id, 'mod.updated', {
    text: file.filename,
    data: { version: v.version_number, folder }
  })
  log.info(`Mod updated: ${oldRel} -> ${newName} (${v.version_number}) for ${id}`)
  return newName
}

export async function installModrinth(id: string, projectId: string): Promise<string> {
  const server = getServer(id)
  if (!server) throw new Error('server-not-found')
  const loader = MR_LOADER[server.type]
  const q =
    `${MR}/project/${projectId}/version` +
    (loader ? `?loaders=%5B%22${loader}%22%5D` : '') +
    (server.mcVersion && server.mcVersion !== 'unknown'
      ? `${loader ? '&' : '?'}game_versions=%5B%22${server.mcVersion}%22%5D`
      : '')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const versions = await httpJson<any[]>(q)
  const v = versions[0]
  if (!v) throw new Error('no-compatible-version')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = v.files.find((f: any) => f.primary) ?? v.files[0]
  const folder: ModFolder = MODDED_TYPES.includes(server.type) ? 'mods' : 'plugins'
  const dir = join(server.path, folder)
  mkdirSync(dir, { recursive: true })
  await downloadFile(file.url, join(dir, file.filename), { sha1: file.hashes?.sha1 })
  return file.filename
}
