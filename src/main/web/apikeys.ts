import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../paths'
import { log } from '../logger'
import { isKeyUsable, keyCoversServer, KEY_PREFIX } from '@shared/apikeys'
import type { ApiKeyView, KeyServers } from '@shared/apikeys'
import type { Scope } from '@shared/web'

/**
 * API keys: salted SHA-256, only the hash on disk. The raw key is returned once
 * at creation and cannot be recovered afterwards - a store that can show you
 * the key again is a store that leaks every integration credential when the
 * file does.
 *
 * Deliberately NOT scrypt, which is what `auth.ts` uses for passwords.
 *
 * A slow KDF exists to make guessing a *low-entropy human secret* expensive. A
 * key here is 32 bytes from `randomBytes` - 256 bits - so there is no guessing
 * surface for a KDF to protect, and nothing to gain. What it would cost is
 * severe: unlike a password, a key is verified on *every request*. Measured on
 * this machine, `scryptSync` is ~32 ms a call, so a single integration doing a
 * 120-request burst would block the event loop for nearly four seconds - the
 * whole app, including the desktop UI, the console feed and metrics, because
 * Node is single-threaded. The rate limiter cannot help: the hash happens while
 * deciding *who is calling*, before there is a key id to charge a bucket
 * against. That is a self-inflicted denial of service bought for no security.
 *
 * The salt stays because it is free, and it stops one precomputed table from
 * covering two installs. `timingSafeEqual` stays because comparing digests with
 * `===` leaks their prefix through timing.
 */
interface StoredKey extends ApiKeyView {
  salt: string
  hash: string
}

let keys: StoredKey[] = []
let loaded = false

function keysPath(): string {
  return join(dataDir(), 'apikeys.json')
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    keys = existsSync(keysPath()) ? (JSON.parse(readFileSync(keysPath(), 'utf-8')) as StoredKey[]) : []
  } catch (e) {
    log.warn('apikeys: could not read apikeys.json:', e)
    keys = []
  }
}

function save(): void {
  const p = keysPath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(keys, null, 2), 'utf-8')
  renameSync(tmp, p)
}

function hash(secret: string, salt: string): string {
  return createHash('sha256').update(salt).update('.').update(secret).digest('hex')
}

const view = (k: StoredKey): ApiKeyView => ({
  id: k.id,
  label: k.label,
  scopes: k.scopes,
  servers: k.servers,
  createdAt: k.createdAt,
  lastUsedAt: k.lastUsedAt,
  expiresAt: k.expiresAt,
  revoked: k.revoked,
  canAudit: k.canAudit
})

export function listKeys(): ApiKeyView[] {
  load()
  return keys.map(view)
}

export interface NewKeyInput {
  label: string
  scopes: Scope[]
  servers: KeyServers
  /** Days from now; omitted or <= 0 means no expiry. */
  expiresInDays?: number
  canAudit?: boolean
}

/**
 * Create a key. The returned `secret` is the ONLY time the raw value exists
 * outside the caller - it is not stored and cannot be shown again.
 *
 * The id travels in the key itself so verification is a single hash of the
 * presented secret against one record, rather than a hash against every key on
 * file (which would make request cost grow with the number of integrations).
 */
export function createKey(input: NewKeyInput): { key: ApiKeyView; secret: string } {
  load()
  const id = randomUUID()
  const raw = randomBytes(32).toString('base64url')
  const salt = randomBytes(16).toString('hex')
  const now = Date.now()
  const days = input.expiresInDays ?? 0
  const k: StoredKey = {
    id,
    label: (input.label || '').trim().slice(0, 60) || 'API key',
    scopes: input.scopes ?? [],
    servers: input.servers ?? [],
    createdAt: now,
    ...(days > 0 ? { expiresAt: now + days * 86400_000 } : {}),
    ...(input.canAudit ? { canAudit: true } : {}),
    salt,
    hash: hash(raw, salt)
  }
  keys.push(k)
  save()
  return { key: view(k), secret: `${KEY_PREFIX}${id}.${raw}` }
}

export function revokeKey(id: string): ApiKeyView {
  load()
  const k = keys.find((x) => x.id === id)
  if (!k) throw new Error('key-not-found')
  // Revoked, not deleted: the audit trail references this id, and a deleted key
  // would leave those entries pointing at nothing.
  k.revoked = true
  save()
  return view(k)
}

export function deleteKey(id: string): void {
  load()
  keys = keys.filter((x) => x.id !== id)
  save()
}

/** Is this string shaped like an API key at all? Cheap, before any hashing. */
export function looksLikeKey(token: string | undefined): boolean {
  return !!token && token.startsWith(KEY_PREFIX) && token.includes('.')
}

/**
 * Resolve a presented key. Returns null for anything wrong - unknown, revoked,
 * expired, or a bad secret - without distinguishing them to the caller, so the
 * response cannot be used to enumerate valid key ids.
 */
export function resolveKey(token: string, now: number = Date.now()): ApiKeyView | null {
  load()
  if (!looksLikeKey(token)) return null
  const body = token.slice(KEY_PREFIX.length)
  const dot = body.indexOf('.')
  const id = body.slice(0, dot)
  const secret = body.slice(dot + 1)
  const k = keys.find((x) => x.id === id)
  if (!k || !isKeyUsable(k, now)) return null
  const a = Buffer.from(hash(secret, k.salt), 'hex')
  const b = Buffer.from(k.hash, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return view(k)
}

/**
 * Record use. Throttled to once a minute per key: an integration polling every
 * second would otherwise rewrite the whole key file 60 times a minute for a
 * field nobody reads that often.
 */
export function touchKey(id: string, now: number = Date.now()): void {
  load()
  const k = keys.find((x) => x.id === id)
  if (!k) return
  if (k.lastUsedAt && now - k.lastUsedAt < 60_000) return
  k.lastUsedAt = now
  save()
}

export function keyCan(key: ApiKeyView, serverId: string, scope: Scope): boolean {
  return keyCoversServer(key.servers, serverId) && key.scopes.includes(scope)
}

/** Test seam. */
export function _reset(): void {
  keys = []
  loaded = false
}
