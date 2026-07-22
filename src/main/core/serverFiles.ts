import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  renameSync
} from 'node:fs'
import { join, resolve, relative, dirname, sep } from 'node:path'
import { getServer } from './serverRegistry'
import type { FileEntry, PropsData } from '@shared/types'

function serverRoot(id: string): string {
  const s = getServer(id)
  if (!s) throw new Error('server-not-found')
  return resolve(s.path)
}

/** Resolve a relative path and guarantee it stays inside the server root. */
function safe(root: string, rel: string): string {
  const p = resolve(join(root, rel || '.'))
  if (p !== root && !p.startsWith(root + sep)) throw new Error('path-escape')
  return p
}

export function listDir(id: string, rel = ''): FileEntry[] {
  const root = serverRoot(id)
  const dir = safe(root, rel)
  return readdirSync(dir, { withFileTypes: true })
    .map((d) => {
      const full = join(dir, d.name)
      let size = 0
      let mtime = 0
      try {
        const st = statSync(full)
        size = st.size
        mtime = st.mtimeMs
      } catch {
        /* dangling */
      }
      return {
        name: d.name,
        path: relative(root, full).replace(/\\/g, '/'),
        isDir: d.isDirectory(),
        size,
        mtime
      }
    })
    .sort((a, b) => (a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)))
}

const MAX_TEXT = 3 * 1024 * 1024

export function readTextFile(id: string, rel: string): { content: string; binary: boolean } {
  const p = safe(serverRoot(id), rel)
  const st = statSync(p)
  if (st.size > MAX_TEXT) return { content: '', binary: true }
  const buf = readFileSync(p)
  if (buf.subarray(0, 8000).includes(0)) return { content: '', binary: true }
  return { content: buf.toString('utf-8'), binary: false }
}

export function writeTextFile(id: string, rel: string, content: string): void {
  writeFileSync(safe(serverRoot(id), rel), content, 'utf-8')
}

export function deleteEntry(id: string, rel: string): void {
  const p = safe(serverRoot(id), rel)
  if (p === serverRoot(id)) throw new Error('cannot-delete-root')
  rmSync(p, { recursive: true, force: true })
}

export function renameEntry(id: string, rel: string, newName: string): void {
  const p = safe(serverRoot(id), rel)
  if (/[\\/]/.test(newName)) throw new Error('invalid-name')
  renameSync(p, join(dirname(p), newName))
}

export function createFolder(id: string, rel: string, name: string): void {
  if (/[\\/]/.test(name)) throw new Error('invalid-name')
  mkdirSync(join(safe(serverRoot(id), rel), name), { recursive: true })
}

// ---- server.properties ----
export function readProperties(id: string): PropsData {
  const p = join(serverRoot(id), 'server.properties')
  if (!existsSync(p)) return { entries: [], raw: '' }
  const raw = readFileSync(p, 'utf-8')
  const entries = raw
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return { key: l.slice(0, i).trim(), value: l.slice(i + 1) }
    })
  return { entries, raw }
}

/** Update given keys, preserving comments, order and untouched keys. */
export function writeProperties(id: string, updates: Record<string, string>): void {
  const p = join(serverRoot(id), 'server.properties')
  let lines = existsSync(p) ? readFileSync(p, 'utf-8').split(/\r?\n/) : []
  const seen = new Set<string>()
  lines = lines.map((line) => {
    if (!line || line.startsWith('#') || !line.includes('=')) return line
    const key = line.slice(0, line.indexOf('=')).trim()
    if (Object.prototype.hasOwnProperty.call(updates, key)) {
      seen.add(key)
      return `${key}=${updates[key]}`
    }
    return line
  })
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) lines.push(`${k}=${v}`)
  }
  writeFileSync(p, lines.join('\n'), 'utf-8')
}

export function writeRawProperties(id: string, raw: string): void {
  writeFileSync(join(serverRoot(id), 'server.properties'), raw, 'utf-8')
}
