import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { playerAccountsPath } from '../paths'
import { processManager } from '../core/processManager'
import * as rcon from '../core/rcon'
import * as files from '../core/serverFiles'
import * as audit from '../core/audit'
import { log } from '../logger'
import {
  publicVerifyReply,
  verifyDecision,
  APPROVAL_TTL_MS,
  MAX_APPROVALS,
  type ApprovalRequest,
  type VerifyDecision,
  type VerifyPurpose
} from '@shared/playerVerify'

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

/**
 * `online-mode` from server.properties, cached for a minute.
 *
 * Absent means the server has not written its properties yet. Vanilla defaults
 * to true, and true is the PERMISSIVE branch here — so an unknown is read as
 * true only because reading it as false would queue every registration on a
 * server that is simply new. The cache is short for the same reason: an
 * operator who turns online-mode off should not have a minute of the old rule.
 */
const onlineModeCache = new Map<string, { value: boolean; at: number }>()

export function serverOnlineMode(serverId: string): boolean {
  const hit = onlineModeCache.get(serverId)
  if (hit && Date.now() - hit.at < 60_000) return hit.value
  let value = true
  try {
    const entry = files.readProperties(serverId).entries.find((e) => e.key === 'online-mode')
    value = entry ? entry.value.trim().toLowerCase() !== 'false' : true
  } catch {
    value = true
  }
  onlineModeCache.set(serverId, { value, at: Date.now() })
  return value
}

export function _resetVerifyState(): void {
  onlineModeCache.clear()
  startLimit.clear()
  pending.clear()
  approvals.length = 0
}

/** Requests waiting for a human, oldest last. In memory: they expire in a day. */
const approvals: ApprovalRequest[] = []

function pruneApprovals(): void {
  const cut = Date.now() - APPROVAL_TTL_MS
  for (let i = approvals.length - 1; i >= 0; i--) {
    if (approvals[i].at < cut) approvals.splice(i, 1)
  }
  if (approvals.length > MAX_APPROVALS) approvals.length = MAX_APPROVALS
}

export function pendingApprovals(serverId?: string): ApprovalRequest[] {
  pruneApprovals()
  return serverId ? approvals.filter((a) => a.serverId === serverId) : [...approvals]
}

export type StartResult = { status: number; body: { ok: boolean; pending?: string; error?: string } }

/**
 * Begin a registration or a password reset.
 *
 * Both go through one decision (`@shared/playerVerify`) because they are the
 * same claim — "I own this name" — and hardening one while the other stays open
 * would leave the easier door unlocked. Registration could already overwrite the
 * password of an existing account, so it WAS a password reset, with none of the
 * checks a reset deserves.
 *
 * The code is never in the response. It goes to the game and nowhere else.
 */
export async function verifyStart(
  serverId: string,
  mcName: string,
  ip: string,
  purpose: VerifyPurpose
): Promise<StartResult> {
  const decision = verifyDecision({
    purpose,
    validName: MC_NAME.test(mcName),
    onlineMode: serverOnlineMode(serverId),
    serverUp: processManager.isRunning(serverId) && rcon.isConnected(serverId),
    playerOnline: !!onlineName(serverId, mcName),
    accountExists: isRegistered(mcName),
    // Both buckets are spent, not short-circuited: `a || b` would leave the IP
    // budget untouched whenever the name budget refused first, so one name could
    // be probed from unlimited addresses at no cost to any of them.
    rateLimited: [rateLimited('n:' + mcName.toLowerCase()), rateLimited('ip:' + ip)].some(Boolean)
  })

  audit.record({
    source: 'public',
    action: 'player.' + purpose + '.start',
    actor: mcName,
    ok: decision.action !== 'refuse',
    ip,
    serverId,
    detail: decision.action === 'refuse' ? decision.reason : decision.action
  })

  if (decision.action === 'issue') await issueCode(serverId, mcName, purpose)
  if (decision.action === 'approve') queueApproval(serverId, mcName, ip, purpose)
  return publicVerifyReply(decision)
}

/** Kept so existing callers and the smoke keep working. */
export async function registerStart(serverId: string, mcName: string, ip: string): Promise<StartResult> {
  return verifyStart(serverId, mcName, ip, 'register')
}

async function issueCode(serverId: string, mcName: string, purpose: VerifyPurpose): Promise<void> {
  const exact = onlineName(serverId, mcName)
  if (!exact) return
  const code = String(randomInt(100000, 1000000))
  pending.set(exact.toLowerCase(), { code, expires: Date.now() + CODE_TTL, attempts: 0, serverId })
  // Private message to the exact player only (exact is validated MC name).
  const json = JSON.stringify([
    { text: '[CaYaDev] ', color: 'red' },
    { text: purpose === 'reset' ? 'Password reset code: ' : 'Web verification code: ', color: 'gray' },
    { text: code, color: 'gold', bold: true },
    { text: ' — enter it on the site.', color: 'gray' }
  ])
  await rcon.tryCommand(serverId, `tellraw ${exact} ${json}`)
  log.info(`Player ${purpose} code sent in-game to ${exact}`)
}

function queueApproval(serverId: string, mcName: string, ip: string, purpose: VerifyPurpose): void {
  pruneApprovals()
  // One request per name per server. Otherwise anyone can fill an operator's
  // queue with the same claim until the real one is off the end of it.
  const existing = approvals.findIndex(
    (a) => a.serverId === serverId && a.mcName.toLowerCase() === mcName.toLowerCase()
  )
  if (existing >= 0) approvals.splice(existing, 1)
  approvals.unshift({
    id: randomUUID(),
    mcName,
    purpose,
    serverId,
    ip,
    at: Date.now(),
    hasAccount: isRegistered(mcName)
  })
  log.info(`Player ${purpose} for ${mcName} needs approval (server is in offline mode)`)
}

/**
 * An operator vouches for a request, and the code is whispered.
 *
 * The operator IS the missing authentication factor: on a cracked server nothing
 * in the chain proves who is holding the keyboard, so a human who can ask on
 * Discord, recognise the address, or simply say "yes, that is them" is the only
 * check left. The whisper afterwards is safe because it goes to the session the
 * operator has just vouched for.
 */
export async function approveRequest(
  id: string,
  by: string
): Promise<{ ok: boolean; error?: string; mcName?: string }> {
  pruneApprovals()
  const i = approvals.findIndex((a) => a.id === id)
  if (i < 0) return { ok: false, error: 'not-found' }
  const req = approvals[i]
  if (!onlineName(req.serverId, req.mcName)) return { ok: false, error: 'not-online' }
  if (!processManager.isRunning(req.serverId) || !rcon.isConnected(req.serverId)) {
    return { ok: false, error: 'server-offline' }
  }
  approvals.splice(i, 1)
  await issueCode(req.serverId, req.mcName, req.purpose)
  audit.record({
    source: 'webpanel',
    action: 'player.' + req.purpose + '.approve',
    actor: by,
    target: req.mcName,
    ok: true,
    serverId: req.serverId,
    detail: 'requested from ' + req.ip
  })
  return { ok: true, mcName: req.mcName }
}

export function denyRequest(id: string, by: string): boolean {
  const i = approvals.findIndex((a) => a.id === id)
  if (i < 0) return false
  const req = approvals[i]
  approvals.splice(i, 1)
  audit.record({
    source: 'webpanel',
    action: 'player.' + req.purpose + '.deny',
    actor: by,
    target: req.mcName,
    ok: true,
    serverId: req.serverId,
    detail: 'requested from ' + req.ip
  })
  return true
}

export function _decisionForTest(i: Parameters<typeof verifyDecision>[0]): VerifyDecision {
  return verifyDecision(i)
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
    // Every other session for this name goes. A password change that leaves the
    // old sessions alive protects nobody: the reason to change it is usually
    // that somebody else has it, and they would keep their token.
    dropSessions(key)
  } else {
    accounts.push({ mcName, salt, hash: hashPw(password, salt), createdAt: Date.now() })
  }
  save()
  audit.record({
    source: 'public',
    action: existing ? 'player.password.reset' : 'player.register',
    actor: mcName,
    ok: true,
    detail: existing ? 'existing sessions invalidated' : 'account created'
  })
  return { ok: true, ...mintSession(mcName) }
}

function dropSessions(nameKey: string): void {
  for (const [token, s] of sessions) {
    if (s.mcName.toLowerCase() === nameKey) sessions.delete(token)
  }
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
