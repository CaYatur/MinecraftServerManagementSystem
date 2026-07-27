/**
 * Crate opening animations (#16).
 *
 * The animation is per-server store config, not a global app preference: the
 * people who see it are the players buying from that server's panel, not the
 * operator sitting at the desktop app.
 */

export type CrateAnimation = 'reel' | 'spin' | 'flip' | 'burst' | 'instant'

export interface CrateAnimationMeta {
  id: CrateAnimation
  /** How long the animation runs before the reward is announced, in ms. */
  durationMs: number
}

/**
 * Order is the order shown in the picker. `reel` stays first and is the
 * default: it is what every existing store already plays, so an operator who
 * never touches this setting sees no change.
 */
export const CRATE_ANIMATIONS: CrateAnimationMeta[] = [
  { id: 'reel', durationMs: 4000 },
  { id: 'spin', durationMs: 3200 },
  { id: 'flip', durationMs: 2800 },
  { id: 'burst', durationMs: 1600 },
  { id: 'instant', durationMs: 0 }
]

export const DEFAULT_CRATE_ANIMATION: CrateAnimation = 'reel'

const IDS = CRATE_ANIMATIONS.map((a) => a.id)

/**
 * Pure: coerce anything (an old config, a hand-edited json, a renderer that
 * sent nonsense) to a real animation. Never throws - a bad value must not stop
 * a player from receiving what they paid for, so it degrades to the default.
 */
export function normalizeCrateAnimation(value: unknown): CrateAnimation {
  return typeof value === 'string' && (IDS as string[]).includes(value)
    ? (value as CrateAnimation)
    : DEFAULT_CRATE_ANIMATION
}

/** Pure: how long the panel should wait before announcing the reward. */
export function crateDuration(animation: unknown): number {
  const id = normalizeCrateAnimation(animation)
  return CRATE_ANIMATIONS.find((a) => a.id === id)?.durationMs ?? 4000
}
