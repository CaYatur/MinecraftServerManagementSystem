import { createWriteStream } from 'node:fs'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { cacheDir } from '../paths'
import { log } from '../logger'

const UA = 'MSMS/0.1 (+https://github.com/CaYatur/MinecraftServerManagementSystem)'

export async function httpText(url: string, timeoutMs = 15000): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
  return r.text()
}

export async function httpJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  return JSON.parse(await httpText(url, timeoutMs)) as T
}

export async function httpJsonPost<T>(url: string, body: unknown, timeoutMs = 15000): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
  return JSON.parse(await r.text()) as T
}

// ---- version-list cache (offline resilience) ----
function cacheFile(key: string): string {
  return join(cacheDir(), key.replace(/[^a-z0-9._-]/gi, '_') + '.json')
}
export function readCache<T>(key: string): T | null {
  const p = cacheFile(key)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as T
  } catch {
    return null
  }
}
export function writeCache(key: string, data: unknown): void {
  try {
    writeFileSync(cacheFile(key), JSON.stringify(data))
  } catch {
    /* ignore */
  }
}
/** Run fetcher; on success cache the result; on failure fall back to cache. */
export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const v = await fetcher()
    writeCache(key, v)
    return v
  } catch (e) {
    const c = readCache<T>(key)
    if (c) {
      log.warn(`Using cached "${key}" (fetch failed: ${String(e)})`)
      return c
    }
    throw e
  }
}

export interface DownloadOpts {
  sha256?: string
  sha1?: string
  onProgress?: (received: number, total: number) => void
  timeoutMs?: number
}

export async function downloadFile(url: string, dest: string, opts: DownloadOpts = {}): Promise<void> {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined
  })
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${url}`)
  const total = Number(r.headers.get('content-length') || 0)
  const hash = opts.sha256 ? createHash('sha256') : opts.sha1 ? createHash('sha1') : null
  let received = 0

  const tap = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length
      if (hash) hash.update(chunk)
      opts.onProgress?.(received, total)
      cb(null, chunk)
    }
  })

  const source = Readable.fromWeb(r.body as Parameters<typeof Readable.fromWeb>[0])
  await pipeline(source, tap, createWriteStream(dest))

  // A 0-byte body (dead mirror, 404-that-redirects-to-nothing, changed API shape)
  // would otherwise be hashed to the well-known SHA-256 of empty input
  // (e3b0c442…) and reported as a baffling "checksum mismatch". Fail honestly and
  // early instead — this guards every provider, not just the one that regressed.
  if (received === 0) {
    await rm(dest, { force: true })
    throw new Error(`empty-download: ${url} returned 0 bytes`)
  }

  if (hash) {
    const digest = hash.digest('hex').toLowerCase()
    const expected = (opts.sha256 ?? opts.sha1 ?? '').toLowerCase()
    if (expected && digest !== expected) {
      await rm(dest, { force: true })
      throw new Error(`Checksum mismatch (got ${digest.slice(0, 12)}…, expected ${expected.slice(0, 12)}…)`)
    }
  }
}
