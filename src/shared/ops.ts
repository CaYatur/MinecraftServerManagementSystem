/**
 * Pure rules for the operations API (#53).
 *
 * The desktop app and the web panel drive moderation from a roster they already
 * fetched, so the names they pass through are names the server itself reported.
 * An HTTP caller passes whatever it likes, and those values end up in a console
 * command: `processManager.sendCommand` writes the string plus a newline to the
 * server's stdin. A name or a ban reason carrying a newline is therefore a
 * second console command, run as the server operator.
 *
 * So every value that can reach a command is validated here, once, rather than
 * at each route.
 */

/**
 * A Minecraft username: 3-16 of `[A-Za-z0-9_]`.
 *
 * Deliberately an allowlist. A denylist of "characters that break a command"
 * has to be right about every one of them - newline, carriage return, NUL, the
 * Unicode line separators - and only has to be wrong once.
 */
const MC_NAME_RE = /^[A-Za-z0-9_]{3,16}$/

export function isValidMcName(name: unknown): name is string {
  return typeof name === 'string' && MC_NAME_RE.test(name)
}

/**
 * Make a free-text argument safe to append to a console command.
 *
 * Reasons are genuinely free text - "griefing spawn, 3rd warning" is a
 * legitimate ban reason - so this cannot be an allowlist of characters. What it
 * must guarantee is that the result cannot terminate the command or start
 * another one: every control character goes, including the Unicode line and
 * paragraph separators, which are line breaks to some consumers and not to
 * others.
 *
 * Capped because a console line is not a document, and an unbounded reason is a
 * way to push other output out of the log buffer.
 */
export function sanitizeCommandArg(text: unknown, max = 120): string {
  if (typeof text !== 'string') return ''
  return (
    text
      // C0 controls, DEL, NEL and U+2028/U+2029: line breaks to some consumers
      // and ordinary characters to others, which is exactly why they go.
      // Written as escapes - a literal control character in source is
      // invisible in review and does not survive every editor.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  )
}

// ---- moderation ----

export type ModerationAction =
  | 'op'
  | 'deop'
  | 'ban'
  | 'pardon'
  | 'kick'
  | 'whitelist-add'
  | 'whitelist-remove'
  | 'gamemode'

export const MODERATION_ACTIONS: ModerationAction[] = [
  'op',
  'deop',
  'ban',
  'pardon',
  'kick',
  'whitelist-add',
  'whitelist-remove',
  'gamemode'
]

export function isModerationAction(a: unknown): a is ModerationAction {
  return typeof a === 'string' && (MODERATION_ACTIONS as string[]).includes(a)
}

/** The four Minecraft gamemodes, by name. Numeric ids are not accepted. */
export const GAMEMODES = ['survival', 'creative', 'adventure', 'spectator']

export function isGamemode(g: unknown): g is string {
  return typeof g === 'string' && GAMEMODES.includes(g)
}

/** Audit action name for a moderation call. Namespaced like the rest. */
export function moderationAuditAction(a: ModerationAction): string {
  return 'player.' + a
}

// ---- destructive operations ----

/**
 * Operations that need `confirm: true` in the body on top of their scope.
 *
 * Not security - a caller holding the scope can always pass the flag. It is
 * there because these are the calls an integration makes by accident: a retry
 * loop, a mis-set variable, a copy-pasted example. Restoring a backup silently
 * replaces a live world; deleting one is unrecoverable. A required flag means
 * the destructive call cannot be reached by getting a URL slightly wrong.
 */
export const CONFIRM_REQUIRED = [
  'backup.restore',
  'backup.delete',
  'world.delete',
  'world.reset'
] as const

export type ConfirmableOp = (typeof CONFIRM_REQUIRED)[number]

export function needsConfirm(op: string): op is ConfirmableOp {
  return (CONFIRM_REQUIRED as readonly string[]).includes(op)
}

// ---- launch configuration ----

/**
 * Java config fields that may NOT be set over HTTP, whatever scope the caller
 * holds (#53).
 *
 * These three decide what program MSMS executes:
 *
 * - `javaPath` is spawned as the process binary. Point it at any executable on
 *   the host and the next server start runs that instead of Java.
 * - `customArgs` IS the whole command line when `preset` is `custom`.
 * - `extraFlags` is appended to the real command line.
 *
 * Over IPC that is fine: the caller is the operator sitting at the machine, who
 * already has full filesystem access, so offering them a text box is not a
 * privilege they did not have. Over HTTP it is a remote scope that an API key
 * can hold, and `settings` means "edit server settings" - not "run arbitrary
 * programs as the MSMS process". Remote code execution is not a settings field.
 *
 * Deliberately a denylist rather than an allowlist of safe fields: the safe set
 * is memory numbers and booleans that grow over time, and a new one being
 * accidentally blocked is an annoyance, while a new dangerous one being
 * accidentally allowed is this bug again.
 */
export const LOCAL_ONLY_JAVA_FIELDS = ['javaPath', 'customArgs', 'extraFlags'] as const

/** Which forbidden fields does this patch try to set? Empty means it is fine. */
export function localOnlyJavaFields(patch: Record<string, unknown> | null | undefined): string[] {
  if (!patch) return []
  return LOCAL_ONLY_JAVA_FIELDS.filter((f) => patch[f] !== undefined)
}

// ---- telemetry retention ----

/**
 * Accepted range for each retention tier: `[min, max]`.
 *
 * `rawHours` is capped at a year and the day tiers at ten, which is far more
 * than anyone keeps — the bound is not a policy, it is there so a number that
 * reaches the config is a number.
 */
export const TELEMETRY_LIMITS: Record<string, [number, number]> = {
  rawHours: [1, 8760],
  minuteDays: [1, 3650],
  hourDays: [1, 3650]
}

export type TelemetryPatch = {
  enabled?: boolean
  rawHours?: number
  minuteDays?: number
  hourDays?: number
}

export type TelemetryPatchResult =
  | { ok: true; patch: TelemetryPatch }
  | { ok: false; error: string; field?: string }

/**
 * Validate a telemetry-config patch before it is merged into the stored config.
 *
 * This one is persisted, which is what makes it worth checking rather than
 * casting: `metrics.retentionMs()` does arithmetic on these numbers on every
 * prune, so `{ rawHours: "abc" }` does not fail the request that set it — it
 * fails every prune afterwards, across restarts, from a config file nobody
 * suspects. `{ enabled: "false" }` is worse: truthy, so it reads as "on" while
 * the operator believes they turned it off.
 *
 * Unknown keys are refused rather than dropped. A caller sending `rawDays`
 * because they misremembered the name should be told, not silently ignored and
 * left believing retention changed.
 */
export function sanitizeTelemetryPatch(body: unknown): TelemetryPatchResult {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid-body' }
  }
  const src = body as Record<string, unknown>
  const patch: TelemetryPatch = {}
  for (const [k, v] of Object.entries(src)) {
    if (k === 'enabled') {
      if (typeof v !== 'boolean') return { ok: false, error: 'not-a-boolean', field: k }
      patch.enabled = v
      continue
    }
    const range = TELEMETRY_LIMITS[k]
    if (!range) return { ok: false, error: 'unknown-field', field: k }
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      return { ok: false, error: 'not-an-integer', field: k }
    }
    if (v < range[0] || v > range[1]) return { ok: false, error: 'out-of-range', field: k }
    ;(patch as Record<string, number>)[k] = v
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'no-fields' }
  return { ok: true, patch }
}

// ---- worlds ----

export type WorldAction = 'activate' | 'rename' | 'clone' | 'reset' | 'delete'

export const WORLD_ACTIONS: WorldAction[] = ['activate', 'rename', 'clone', 'reset', 'delete']

/**
 * A world name that is safe to use as a folder name.
 *
 * Worlds are directories under the server root, so a name is a path component
 * and every path component rule applies: no separators, no dot-segments, no
 * drive letters, no reserved Windows device names. `core/worlds.ts` builds paths
 * from these, and a name of `..` would address the server directory itself.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

export function isValidWorldName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  // Deliberately NOT trimmed. The caller's exact string is what reaches the
  // filesystem, so trimming here would validate one name and use another — and
  // the trailing-space rule below could never fire, because trimming removes
  // the very thing it is looking for.
  if (!name || name.length > 64) return false
  if (name !== name.trim()) return false
  if (name === '.' || name === '..') return false
  if (/[\\/:*?"<>|]/.test(name)) return false
  // A trailing dot is silently dropped by Windows, so `world.` and `world` name
  // the same directory while looking like different worlds.
  if (name.endsWith('.')) return false
  if (WINDOWS_RESERVED.test(name)) return false
  return true
}
