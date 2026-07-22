import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  randomUUID
} from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { usersPath } from '../paths'
import { log } from '../logger'
import type { Scope, WebRole, WebUserView } from '@shared/web'

interface StoredUser {
  id: string
  username: string
  salt: string
  hash: string
  role: WebRole
  perms: Record<string, Scope[]>
  createdAt: number
}

interface Session {
  userId: string
  expires: number
}

const SESSION_TTL = 12 * 60 * 60 * 1000 // 12h
let users: StoredUser[] = []
const sessions = new Map<string, Session>()

// ---- persistence ----
function load(): void {
  try {
    users = existsSync(usersPath()) ? (JSON.parse(readFileSync(usersPath(), 'utf-8')) as StoredUser[]) : []
  } catch {
    users = []
  }
}
function save(): void {
  const p = usersPath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf-8')
  renameSync(tmp, p)
}

export function initAuth(): void {
  load()
}

// ---- password hashing (scrypt) ----
function hashPw(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}
function verifyPw(password: string, user: StoredUser): boolean {
  const attempt = Buffer.from(hashPw(password, user.salt), 'hex')
  const stored = Buffer.from(user.hash, 'hex')
  return attempt.length === stored.length && timingSafeEqual(attempt, stored)
}

const view = (u: StoredUser): WebUserView => ({
  id: u.id,
  username: u.username,
  role: u.role,
  perms: u.perms,
  createdAt: u.createdAt
})

// ---- user management (called from the trusted desktop side) ----
export function listUsers(): WebUserView[] {
  return users.map(view)
}

export function createUser(
  username: string,
  password: string,
  role: WebRole,
  perms: Record<string, Scope[]> = {}
): WebUserView {
  const name = username.trim()
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(name)) throw new Error('invalid-username')
  if (password.length < 4) throw new Error('password-too-short')
  if (users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
    throw new Error('username-taken')
  }
  const salt = randomBytes(16).toString('hex')
  const u: StoredUser = {
    id: randomUUID(),
    username: name,
    salt,
    hash: hashPw(password, salt),
    role,
    perms,
    createdAt: Date.now()
  }
  users.push(u)
  save()
  log.info(`Web user created: ${name} (${role})`)
  return view(u)
}

export function deleteUser(id: string): void {
  users = users.filter((u) => u.id !== id)
  for (const [tok, s] of sessions) if (s.userId === id) sessions.delete(tok)
  save()
}

export function setUserPerms(id: string, perms: Record<string, Scope[]>): void {
  const u = users.find((x) => x.id === id)
  if (!u) throw new Error('user-not-found')
  u.perms = perms
  save()
}

export function setUserPassword(id: string, password: string): void {
  const u = users.find((x) => x.id === id)
  if (!u) throw new Error('user-not-found')
  if (password.length < 4) throw new Error('password-too-short')
  u.salt = randomBytes(16).toString('hex')
  u.hash = hashPw(password, u.salt)
  save()
}

// ---- sessions ----
export interface AuthUser {
  id: string
  username: string
  role: WebRole
  perms: Record<string, Scope[]>
}

export function login(username: string, password: string): { token: string; user: AuthUser } | null {
  const u = users.find((x) => x.username.toLowerCase() === username.trim().toLowerCase())
  if (!u || !verifyPw(password, u)) return null
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { userId: u.id, expires: Date.now() + SESSION_TTL })
  return { token, user: { id: u.id, username: u.username, role: u.role, perms: u.perms } }
}

export function logout(token: string): void {
  sessions.delete(token)
}

export function resolveSession(token: string | undefined): AuthUser | null {
  if (!token) return null
  const s = sessions.get(token)
  if (!s) return null
  if (s.expires < Date.now()) {
    sessions.delete(token)
    return null
  }
  const u = users.find((x) => x.id === s.userId)
  if (!u) return null
  return { id: u.id, username: u.username, role: u.role, perms: u.perms }
}

/** The core authorization check — every HTTP route calls this. */
export function can(user: AuthUser, serverId: string, scope: Scope): boolean {
  if (user.role === 'owner') return true
  const scopes = user.perms[serverId]
  return !!scopes && scopes.includes(scope)
}

/** Server ids the user can at least view. */
export function visibleServerIds(user: AuthUser): string[] | 'all' {
  if (user.role === 'owner') return 'all'
  return Object.entries(user.perms)
    .filter(([, scopes]) => scopes.length > 0)
    .map(([id]) => id)
}

export function clearSessions(): void {
  sessions.clear()
}
