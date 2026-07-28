import { SCOPES } from './web'
import type { Scope } from './web'

/**
 * Named, reusable permission sets (#28).
 *
 * The per-server scope arrays underneath are unchanged - this sits on top of
 * them. Assigning eight scopes by hand, per user, per server, is where mistakes
 * happen: someone gets `console` because it was easier than thinking about it,
 * and nobody can answer "who can run commands?" without reading every user.
 * A role makes the intent nameable and reviewable in one place.
 */
export interface RoleDef {
  id: string
  name: string
  scopes: Scope[]
  /** Shipped with the app: assignable and readable, but not editable or deletable. */
  builtin?: boolean
}

/**
 * Deliberately conservative. None of them include `settings`, because settings
 * is what lets a user author alert rules, and an alert rule can carry an
 * action - a built-in role handed out casually should not open that door.
 */
export const BUILTIN_ROLES: RoleDef[] = [
  { id: 'viewer', name: 'Viewer', scopes: ['view'], builtin: true },
  { id: 'moderator', name: 'Moderator', scopes: ['view', 'console', 'players'], builtin: true },
  { id: 'builder', name: 'Builder', scopes: ['view', 'files'], builtin: true },
  {
    id: 'operator',
    name: 'Operator',
    // Worlds included here and nowhere else: this is the "runs the server"
    // role, and world management is destructive enough that a Moderator or a
    // Builder should not pick it up by implication.
    scopes: ['view', 'console', 'power', 'players', 'backups', 'worlds'],
    builtin: true
  },
  { id: 'storekeeper', name: 'Storekeeper', scopes: ['view', 'store'], builtin: true }
]

/** Pure: drop anything that is not a real scope, and de-duplicate. */
export function normalizeScopes(scopes: unknown): Scope[] {
  if (!Array.isArray(scopes)) return []
  const seen = new Set<Scope>()
  for (const s of scopes) {
    if (typeof s === 'string' && (SCOPES as string[]).includes(s)) seen.add(s as Scope)
  }
  return [...seen]
}

/** Pure: coerce arbitrary input into a storable role. */
export function normalizeRoleDef(input: Partial<RoleDef> & { id: string }): RoleDef {
  return {
    id: input.id,
    name: (input.name ?? '').trim().slice(0, 60) || 'Role',
    scopes: normalizeScopes(input.scopes)
  }
}

/**
 * Pure: what a user may actually do on one server.
 *
 * The union of the scopes granted directly and the scopes of every role
 * assigned there. Roles only ever ADD - there is no deny rule - because a
 * subtractive rule makes "why can this person do X?" unanswerable without
 * replaying the whole set in order.
 *
 * An assigned role id that no longer exists contributes NOTHING. Deleting a
 * role must revoke what it granted; silently keeping the old scopes would mean
 * removing a role quietly leaves its permissions behind.
 */
export function effectiveScopes(
  direct: Scope[] | undefined,
  roleIds: string[] | undefined,
  roles: RoleDef[]
): Scope[] {
  const out = new Set<Scope>(normalizeScopes(direct))
  for (const id of roleIds ?? []) {
    const role = roles.find((r) => r.id === id)
    if (!role) continue
    for (const s of role.scopes) out.add(s)
  }
  return [...out]
}

/** Pure: which roles reference a scope - "who can run commands?" in one call. */
export function rolesWithScope(roles: RoleDef[], scope: Scope): RoleDef[] {
  return roles.filter((r) => r.scopes.includes(scope))
}
