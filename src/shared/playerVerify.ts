/**
 * Who is allowed to prove they own a Minecraft name, and how (#105).
 *
 * Registration and password reset are the same question asked twice: "is the
 * person typing this the person who owns that name?" MSMS answers it by
 * whispering a code to whoever is standing in the server under that name — and
 * that proof is worth exactly as much as the server's own authentication.
 *
 * - `online-mode=true`: Mojang authenticated the session. The whisper reaches
 *   the account holder and nobody else.
 * - `online-mode=false`: anyone can join as anyone. The whisper reaches whoever
 *   typed the name into their launcher, which is not a proof of anything. A
 *   reset built on it is a takeover mechanism — a stranger joins as the player,
 *   reads the code, and owns the website account, its balance and its purchases.
 *
 * So on a cracked server the code alone is not accepted and a human decides.
 * Slow, and the honest answer when nothing in the chain can be trusted.
 *
 * Delegating to the server's login plugin (AuthMe and relatives) would be
 * better — a player who has just run `/login` has proved something to a system
 * that knows their password. It is not implementable today: the bridge reports
 * TPS, positions and deaths over stdout and has no hook into a third-party
 * plugin's session state. When it does, it replaces the approval branch here
 * and nothing else changes.
 */

export type VerifyPurpose = 'register' | 'reset'

export type VerifyRefusal =
  | 'invalid-name'
  | 'rate-limited'
  | 'server-offline'
  | 'not-online'
  /** Reset asked for a name with no account. Never told to the caller. */
  | 'no-account'

export type VerifyDecision =
  /** Whisper a single-use code in game. */
  | { action: 'issue' }
  /** Queue it for an operator. The code is whispered once a human agrees. */
  | { action: 'approve' }
  | {
      action: 'refuse'
      reason: VerifyRefusal
      /**
       * What this request WOULD have been, when the refusal must not be
       * visible. Only `no-account` carries it: the caller has to be told the
       * same thing a real account would have produced, and "the same thing"
       * depends on the server's online mode.
       */
      pretend?: 'issue' | 'approve'
    }

export interface VerifyInputs {
  purpose: VerifyPurpose
  validName: boolean
  /** `online-mode` from server.properties. */
  onlineMode: boolean
  /** Running, with RCON up — the whisper needs a channel. */
  serverUp: boolean
  playerOnline: boolean
  accountExists: boolean
  rateLimited: boolean
}

/**
 * The whole rule, in order.
 *
 * Rate limiting comes before every check that reads state, so probing cannot be
 * used to enumerate anything faster than the limit allows. `no-account` is
 * decided here because the audit trail needs to record what actually happened;
 * the HTTP layer must not repeat it back, or the endpoint becomes a way to ask
 * "does this player have a website account?" one name at a time.
 */
export function verifyDecision(i: VerifyInputs): VerifyDecision {
  if (!i.validName) return { action: 'refuse', reason: 'invalid-name' }
  if (i.rateLimited) return { action: 'refuse', reason: 'rate-limited' }
  if (!i.serverUp) return { action: 'refuse', reason: 'server-offline' }
  if (!i.playerOnline) return { action: 'refuse', reason: 'not-online' }
  // The whole point. Everything above is true on both kinds of server; this is
  // the line where the in-game code stops meaning anything.
  const real = i.onlineMode ? 'issue' : 'approve'
  // Checked LAST, and carrying what would have happened.
  //
  // Checking it earlier is the obvious order and it opens the hole this
  // function exists to close: on a cracked server a real account answers
  // "waiting for approval" and an absent one answers "code sent", and the
  // difference between those two strings is an account-enumeration oracle —
  // on exactly the kind of server where taking an account over is easiest.
  if (i.purpose === 'reset' && !i.accountExists) {
    return { action: 'refuse', reason: 'no-account', pretend: real }
  }
  return { action: real }
}

/**
 * What the caller is told.
 *
 * `issue` and `approve` both answer "started", and so does `no-account`: a
 * different answer for a name that has no account turns the reset endpoint into
 * an account-enumeration oracle, one name per request. The player who really
 * owns the name learns nothing from the difference anyway — they are waiting on
 * a whisper either way — while an attacker learns exactly what they came for.
 *
 * `invalid-name` is safe to state: it is a fact about the string, not about
 * whether anybody has that name.
 */
export function publicVerifyReply(d: VerifyDecision): {
  status: number
  body: { ok: boolean; pending?: 'code' | 'approval'; error?: string }
} {
  const started = (a: 'issue' | 'approve'): ReturnType<typeof publicVerifyReply> => ({
    status: 200,
    body: { ok: true, pending: a === 'approve' ? 'approval' : 'code' }
  })
  if (d.action !== 'refuse') return started(d.action)
  // Byte-identical to what a real account would have produced on THIS server,
  // which is why the decision carries it rather than this function guessing.
  if (d.reason === 'no-account') return started(d.pretend ?? 'issue')
  const status = d.reason === 'rate-limited' ? 429 : 400
  return { status, body: { ok: false, error: d.reason } }
}

/** A request waiting for an operator, as the panel and the API present it. */
export interface ApprovalRequest {
  id: string
  mcName: string
  purpose: VerifyPurpose
  serverId: string
  /** Where it came from. The operator's only evidence beyond the name. */
  ip: string
  at: number
  /** Whether this name already has an account — a reset is riskier than a new one. */
  hasAccount: boolean
}

export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_APPROVALS = 200
