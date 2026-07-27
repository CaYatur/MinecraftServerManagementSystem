import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from '../paths'
import { log } from '../logger'
import { BUILTIN_ROLES, normalizeRoleDef } from '@shared/rbac'
import type { RoleDef } from '@shared/rbac'

/**
 * Custom role definitions (#28). The built-ins are code, not data - they are
 * never written to disk, so an upgrade that improves one takes effect instead
 * of being shadowed by a stale copy in a config file.
 */
let custom: RoleDef[] = []
let loaded = false

function rolesPath(): string {
  return join(dataDir(), 'roles.json')
}

function load(): void {
  if (loaded) return
  loaded = true
  try {
    if (!existsSync(rolesPath())) return
    const raw = JSON.parse(readFileSync(rolesPath(), 'utf-8')) as unknown
    if (!Array.isArray(raw)) return
    custom = raw
      .filter((r): r is RoleDef => !!r && typeof (r as RoleDef).id === 'string')
      // A file that claims a built-in id must not be able to redefine it.
      .filter((r) => !BUILTIN_ROLES.some((b) => b.id === r.id))
      .map((r) => normalizeRoleDef(r))
  } catch (e) {
    log.warn('roles: could not read roles.json:', e)
    custom = []
  }
}

function save(): void {
  const p = rolesPath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(custom, null, 2), 'utf-8')
  renameSync(tmp, p)
}

/** Built-ins first, then custom. */
export function listRoles(): RoleDef[] {
  load()
  return [...BUILTIN_ROLES, ...custom]
}

export function upsertRole(input: Partial<RoleDef> & { id?: string }): RoleDef {
  load()
  if (input.id && BUILTIN_ROLES.some((b) => b.id === input.id)) {
    throw new Error('builtin-role-readonly')
  }
  const role = normalizeRoleDef({ ...input, id: input.id || randomUUID() })
  const i = custom.findIndex((r) => r.id === role.id)
  if (i >= 0) custom[i] = role
  else custom.push(role)
  save()
  return role
}

export function deleteRole(id: string): void {
  load()
  if (BUILTIN_ROLES.some((b) => b.id === id)) throw new Error('builtin-role-readonly')
  custom = custom.filter((r) => r.id !== id)
  save()
}

/** Test seam. */
export function _reset(): void {
  custom = []
  loaded = false
}
