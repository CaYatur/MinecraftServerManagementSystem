import AdmZip from 'adm-zip'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getServer } from './serverRegistry'
import { readProperties } from './serverFiles'
import * as events from './events'
import { backupsDir, backupsMetaPath } from '../paths'
import { log } from '../logger'
import type { BackupOptions, BackupRecord } from '@shared/types'

const sanitize = (s: string): string => s.replace(/[<>:"/\\|?*]/g, '_').trim() || 'server'

function loadMeta(): BackupRecord[] {
  try {
    return JSON.parse(readFileSync(backupsMetaPath(), 'utf-8')) as BackupRecord[]
  } catch {
    return []
  }
}
function saveMeta(list: BackupRecord[]): void {
  writeFileSync(backupsMetaPath(), JSON.stringify(list, null, 2), 'utf-8')
}

function levelName(id: string): string {
  const map = Object.fromEntries(readProperties(id).entries.map((e) => [e.key, e.value]))
  return map['level-name'] || 'world'
}

export function listBackups(serverId?: string): BackupRecord[] {
  const all = loadMeta().filter((r) => existsSync(r.path))
  return (serverId ? all.filter((r) => r.serverId === serverId) : all).sort(
    (a, b) => b.createdAt - a.createdAt
  )
}

export async function createBackup(serverId: string, opts: BackupOptions): Promise<BackupRecord> {
  try {
    return await runBackup(serverId, opts)
  } catch (err) {
    events.record(serverId, 'backup.failed', {
      data: { kind: opts.kind },
      text: String((err as Error)?.message ?? err)
    })
    throw err
  }
}

async function runBackup(serverId: string, opts: BackupOptions): Promise<BackupRecord> {
  const server = getServer(serverId)
  if (!server) throw new Error('server-not-found')
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const destDir = opts.destDir?.trim() || join(backupsDir(), sanitize(server.name))
  mkdirSync(destDir, { recursive: true })
  const fileName = `${sanitize(server.name)}-${opts.kind}-${ts}.zip`
  const dest = join(destDir, fileName)

  const zip = new AdmZip()
  if (opts.kind === 'full') {
    zip.addLocalFolder(server.path)
  } else {
    const level = levelName(serverId)
    let added = 0
    for (const w of [level, level + '_nether', level + '_the_end']) {
      const wd = join(server.path, w)
      if (existsSync(wd)) {
        zip.addLocalFolder(wd, w)
        added++
      }
    }
    if (added === 0) throw new Error('no-world-to-backup')
  }
  // NOTE: adm-zip writes synchronously; large worlds briefly block the app.
  zip.writeZip(dest)

  const rec: BackupRecord = {
    id: randomUUID(),
    serverId,
    serverName: server.name,
    fileName,
    path: dest,
    size: statSync(dest).size,
    createdAt: Date.now(),
    kind: opts.kind
  }
  const meta = loadMeta()
  meta.push(rec)
  saveMeta(meta)
  log.info(`Backup created: ${dest} (${rec.size} bytes)`)
  events.record(serverId, 'backup.created', {
    data: { kind: rec.kind, sizeMB: Math.round(rec.size / (1024 * 1024)), backupId: rec.id },
    text: rec.fileName
  })
  return rec
}

export function deleteBackup(id: string): void {
  const meta = loadMeta()
  const rec = meta.find((r) => r.id === id)
  if (rec && existsSync(rec.path)) {
    try {
      rmSync(rec.path, { force: true })
    } catch (err) {
      log.warn('Failed to delete backup file:', err)
    }
  }
  saveMeta(meta.filter((r) => r.id !== id))
  if (rec) events.record(rec.serverId, 'backup.deleted', { text: rec.fileName })
}

/** Extract a backup back into its server folder (server should be stopped). */
export function restoreBackup(id: string): void {
  const rec = loadMeta().find((r) => r.id === id)
  if (!rec) throw new Error('backup-not-found')
  const server = getServer(rec.serverId)
  if (!server) throw new Error('server-not-found')
  if (!existsSync(rec.path)) throw new Error('backup-file-missing')
  const zip = new AdmZip(rec.path)
  zip.extractAllTo(server.path, true)
  log.info(`Backup restored: ${rec.fileName} -> ${server.path}`)
  events.record(rec.serverId, 'backup.restored', {
    data: { kind: rec.kind, backupId: rec.id },
    text: rec.fileName
  })
}

/** Keep only the newest `keep` backups for a server (used by the scheduler). */
export function pruneBackups(serverId: string, keep: number): void {
  const list = listBackups(serverId)
  for (const rec of list.slice(keep)) deleteBackup(rec.id)
}
