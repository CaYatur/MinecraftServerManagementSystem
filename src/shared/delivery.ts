/**
 * When it is safe to hand a purchased reward to a player (#106).
 *
 * The old rule was "run the commands if the name is in the online list, else
 * queue; on the join line, wait 1500ms and run". Both halves are unsafe:
 *
 * - The join line comes from the console parser, which sees it the instant the
 *   player connects — which on a server running a login plugin (AuthMe and
 *   relatives) is the worst possible moment. Before `/login` the player is in a
 *   holding state: `give` can drop the item on the floor, and the plugin often
 *   restores a saved inventory afterwards, overwriting whatever arrived. 1500ms
 *   is a guess, and it was the only thing standing between the purchase and
 *   losing it.
 * - "Online" is read from a name list the console builds. It says a session
 *   exists, not that a player is in the world holding an inventory.
 *
 * So the decision is made here, from evidence, and the safe answer is always to
 * keep the reward: a late item is recoverable, a deleted one is not.
 */

export type HoldReason =
  /** The server is down, or nothing can carry a command to it. */
  | 'server-down'
  /** The player is not connected. */
  | 'player-offline'
  /** Connected, but nothing proves they are in the world with an inventory. */
  | 'needs-approval'
  /**
   * Inside the grace after a join: a retry is already scheduled.
   *
   * A `wait` is still a reason to be in the queue. The obvious implementation
   * keeps a waiting reward in a `setTimeout` closure and nowhere else, which
   * means quitting the app during the grace loses a reward that was paid for
   * seconds earlier — the failure this module exists to prevent, moved from the
   * delivery path into the retry path.
   */
  | 'just-joined'

export type DeliveryDecision =
  | { action: 'deliver' }
  /** Online and trusted, but too soon after joining. Try again in `ms`. */
  | { action: 'wait'; ms: number }
  | { action: 'hold'; reason: HoldReason }

export interface DeliveryInputs {
  serverRunning: boolean
  /** RCON is connected, or the process is up and stdin can carry a command. */
  canSend: boolean
  /** The console's online list contains this player. */
  playerOnline: boolean
  /**
   * The bridge is reporting this player with a real position.
   *
   * The strongest signal available without a plugin-specific integration: a
   * player the server can locate in a world is a player who exists in it. A
   * login plugin's holding area still has coordinates, so this is not proof of
   * having authenticated — which is why it does not override `graceMs`, only
   * the cracked-server hold.
   */
  bridgeInWorld: boolean
  /** `online-mode` from server.properties. */
  onlineMode: boolean
  /** Time since this player's join was seen, or undefined if it was not. */
  joinedAgoMs?: number
  /** How long after a join to wait before delivering. */
  graceMs: number
  /**
   * Hold rather than guess when nothing proves the player is really in-world.
   * Operator setting; on by default, because the cost of holding is a delay and
   * the cost of guessing wrong is a paid-for item that no longer exists.
   */
  holdWhenUnverified: boolean
}

export const DEFAULT_GRACE_MS = 20_000
/** Nothing sensible is below this; a login plugin needs seconds, not one. */
export const MIN_GRACE_MS = 1_000
export const MAX_GRACE_MS = 10 * 60_000

export function clampGrace(ms: unknown): number {
  const n = typeof ms === 'number' && Number.isFinite(ms) ? ms : DEFAULT_GRACE_MS
  return Math.min(MAX_GRACE_MS, Math.max(MIN_GRACE_MS, Math.round(n)))
}

/**
 * The whole rule, in order. Every branch either delivers on evidence or keeps
 * the reward; none of them drops it.
 */
export function deliveryDecision(i: DeliveryInputs): DeliveryDecision {
  // Nothing can carry the command. The old code ran `runCommands` here anyway,
  // which quietly did nothing — and the caller had already removed the entry
  // from the queue, so the reward was gone.
  if (!i.serverRunning || !i.canSend) return { action: 'hold', reason: 'server-down' }
  if (!i.playerOnline) return { action: 'hold', reason: 'player-offline' }

  const joined = i.joinedAgoMs
  const withinGrace = typeof joined === 'number' && joined < i.graceMs

  // The bridge can see them in a world. Still respect the grace: being locatable
  // is not the same as having finished logging in.
  if (i.bridgeInWorld) {
    return withinGrace ? { action: 'wait', ms: i.graceMs - joined! } : { action: 'deliver' }
  }

  // Online mode means Mojang authenticated the session, so "this name is
  // connected" is trustworthy on its own.
  if (i.onlineMode) {
    return withinGrace ? { action: 'wait', ms: i.graceMs - joined! } : { action: 'deliver' }
  }

  // Cracked, and nothing else to go on. Anyone can be connected as this name,
  // and a login plugin is probably holding them somewhere an item would be lost.
  if (i.holdWhenUnverified) return { action: 'hold', reason: 'needs-approval' }

  return withinGrace ? { action: 'wait', ms: i.graceMs - joined! } : { action: 'deliver' }
}

/**
 * The queue reason a decision implies, or null when the reward is being handed
 * over right now.
 *
 * This exists so "anything that is not a delivery stays in the queue" is a rule
 * one function states, rather than a habit each branch of the caller has to
 * remember. `wait` is the branch that gets forgotten: it looks like progress,
 * so the obvious code leaves the entry in a `setTimeout` closure and nowhere
 * durable — and the app quitting during the grace then loses a reward that was
 * paid for seconds earlier.
 */
export function queueReason(d: DeliveryDecision): HoldReason | null {
  if (d.action === 'deliver') return null
  return d.action === 'wait' ? 'just-joined' : d.reason
}

/** Copy for the panel's pending list. Keys, not sentences — the UI translates. */
export const HOLD_REASONS: HoldReason[] = [
  'server-down',
  'player-offline',
  'needs-approval',
  'just-joined'
]
