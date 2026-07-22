import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { playerAccountsPath } from '../paths'
import { processManager } from '../core/processManager'
import * as rcon from '../core/rcon'
import { log } from '../logger'

const MC_NAME = /^[A-Za-z0-9_]{3,16}$/
const CODE_TTL = 5 * 60 * 1000
const SESSION_TTL = 14 * 24 * 60 * 60 * 1000 // 14 days (players)
const MAX_VERIFY_ATTEMPTS = 5

interface Account {
  mcName: string
  salt: string
  hash: string
  createdAt: number
}

interface Pending {
  code: string
  expires: number
  attempts: number
  serverId: string
}

let accounts: Account[] = []
const pending = new Map<string, Pending>() // key: mcName lower
const sessions = new Map<string, { mcName: string; expires: number }>()
const startLimit = new Map<string, { count: number; ts: number }>() // per name|ip

function load(): void {
  try {
    accounts = existsSync(playerAccountsPath())
      ? (JSON.parse(readFileSync(playerAccountsPath(), 'utf-8')) as Account[])
      : []
  } catch {
    accounts = []
  }
}
function save(): void {
  const p = playerAccountsPath()
  writeFileSync(p + '.tmp', JSON.stringify(accounts, null, 2), 'utf-8')
  renameSync(p + '.tmp', p)
}
export function initPlayerAuth(): void {
  load()
}

function hashPw(pw: string, salt: string): string {
  return scryptSync(pw, salt, 64).toString('hex')
}
function verifyPw(pw: string, a: Account): boolean {
  const attempt = Buffer.from(hashPw(pw, a.salt), 'hex')
  const stored = Buffer.from(a.hash, 'hex')
  return attempt.length === stored.length && timingSafeEqual(attempt, stored)
}

function rateLimited(key: string): boolean {
  const now = Date.now()
  const rec = startLimit.get(key)
  if (!rec || now - rec.ts > 10 * 60 * 1000) {
    startLimit.set(key, { count: 1, ts: now })
    return false
  }
  rec.count++
  return rec.count > 5
}

/** Find the exact online player name (case-insensitive) on the given server. */
function onlineName(serverId: string, mcName: string): string | null {
  const names = processManager.getRuntime(serverId)?.players.names ?? []
  return names.find((n) => n.toLowerCase() === mcName.toLowerCase()) ?? null
}

export type StartResult =
  | { ok: true }
  | { ok: false; error: 'invalid-name' | 'server-offline' | 'not-online' | 'rate-limited' }

/**
 * Begin registration/verification: sends a one-time code to the EXACT online
 * player via a private tell — never broadcast. Requires the player online.
 */
export async function registerStart(serverId: string, mcName: string, ip: string): Promise<StartResult> {
  if (!MC_NAME.test(mcName)) return { ok: false, error: 'invalid-name' }
  if (rateLimited('n:' + mcName.toLowerCase()) || rateLimited('ip:' + ip)) {
    return { ok: false, error: 'rate-limited' }
  }
  if (!processManager.isRunning(serverId) || !rcon.isConnected(serverId)) {
    return { ok: false, error: 'server-offline' }
  }
  const exact = onlineName(serverId, mcName)
  if (!exact) return { ok: false, error: 'not-online' }

  const code = String(randomInt(100000, 1000000))
  pending.set(exact.toLowerCase(), { code, expires: Date.now() + CODE_TTL, attempts: 0, serverId })
  // Private message to the exact player only (exact is validated MC name).
  const json = JSON.stringify([
    { text: '[CaYaDev] ', color: 'red' },
    { text: 'Web verification code: ', color: 'gray' },
    { text: code, color: 'gold', bold: true },
    { text: ' — enter it on the site.', color: 'gray' }
  ])
  await rcon.tryCommand(serverId, `tellraw ${exact} ${json}`)
  log.info(`Player verify code sent in-game to ${exact}`)
  return { ok: true }
}

export type VerifyResult =
  | { ok: true; token: string; mcName: string }
  | { ok: false; error: 'invalid' | 'expired' | 'bad-code' | 'weak-password' }

export function verify(mcName: string, code: string, password: string): VerifyResult {
  if (!MC_NAME.test(mcName)) return { ok: false, error: 'invalid' }
  if (password.length < 4) return { ok: false, error: 'weak-password' }
  const key = mcName.toLowerCase()
  const pend = pending.get(key)
  if (!pend) return { ok: false, error: 'invalid' }
  if (pend.expires < Date.now()) {
    pending.delete(key)
    return { ok: false, error: 'expired' }
  }
  pend.attempts++
  if (pend.attempts > MAX_VERIFY_ATTEMPTS) {
    pending.delete(key)
    return { ok: false, error: 'expired' }
  }
  if (code.trim() !== pend.code) return { ok: false, error: 'bad-code' }

  pending.delete(key)
  const salt = randomBytes(16).toString('hex')
  const existing = accounts.find((a) => a.mcName.toLowerCase() === key)
  if (existing) {
    existing.salt = salt
    existing.hash = hashPw(password, salt)
  } else {
    accounts.push({ mcName, salt, hash: hashPw(password, salt), createdAt: Date.now() })
  }
  save()
  return { ok: true, ...mintSession(mcName) }
}

export function login(mcName: string, password: string): { ok: true; token: string; mcName: string } | { ok: false } {
  const a = accounts.find((x) => x.mcName.toLowerCase() === mcName.trim().toLowerCase())
  if (!a || !verifyPw(password, a)) return { ok: false }
  return { ok: true, ...mintSession(a.mcName) }
}

function mintSession(mcName: string): { token: string; mcName: string } {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { mcName, expires: Date.now() + SESSION_TTL })
  return { token, mcName }
}

/** Resolve a PLAYER token only — never satisfies admin auth. */
export function resolvePlayerSession(token: string | undefined): { mcName: string } | null {
  if (!token) return null
  const s = sessions.get(token)
  if (!s) return null
  if (s.expires < Date.now()) {
    sessions.delete(token)
    return null
  }
  return { mcName: s.mcName }
}

export function logoutPlayer(token: string): void {
  sessions.delete(token)
}

export function isRegistered(mcName: string): boolean {
  return accounts.some((a) => a.mcName.toLowerCase() === mcName.trim().toLowerCase())
}

/** TEST-ONLY: create a verified account directly (bypasses the in-game code).
 *  Not wired to any IPC/HTTP route. */
export function _testCreateAccount(mcName: string, password: string): void {
  const salt = randomBytes(16).toString('hex')
  accounts = accounts.filter((a) => a.mcName.toLowerCase() !== mcName.toLowerCase())
  accounts.push({ mcName, salt, hash: hashPw(password, salt), createdAt: Date.now() })
}
