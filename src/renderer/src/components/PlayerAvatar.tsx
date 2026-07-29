import { useEffect, useState } from 'react'
import { avatarUrl } from '@shared/profile'

/**
 * A player's head.
 *
 * Three things were making these flash empty and re-fetch on every render
 * (#137):
 *
 * - the requested size was baked into the URL, so the 46px list avatar and the
 *   72px detail avatar were two different images of the same player, fetched
 *   separately and cached separately;
 * - the uuid was preferred over the name, and on an offline-mode server that
 *   uuid is the derived one no skin service has ever seen — the same trap as
 *   the map heads in #116;
 * - a failure was remembered only in component state, so every remount asked
 *   for the same missing image again and showed a gap while it failed.
 *
 * One size is requested and CSS scales it, the name decides, and the outcome is
 * remembered for the session.
 */

/** Requested once at this size; anything larger is upscaled by CSS. */
const FETCH_PX = 64

/**
 * Module-level, deliberately: a head that failed once will fail again, and the
 * point is not to ask a second time. Keyed by name, which is what the URL is
 * keyed by.
 */
const outcome = new Map<string, 'ok' | 'fail'>()

export function PlayerAvatar({
  uuid,
  name,
  size = 44
}: {
  uuid?: string
  name: string
  size?: number
}): JSX.Element {
  // `uuid` is still accepted so callers do not have to change, and deliberately
  // unused: see the note above.
  void uuid
  const url = avatarUrl(name, FETCH_PX)
  const [state, setState] = useState<'ok' | 'fail' | 'loading'>(() => outcome.get(name) ?? 'loading')

  useEffect(() => setState(outcome.get(name) ?? 'loading'), [name])

  // A placeholder while it comes and if it never does, rather than a hole. The
  // initial when there is a name to take one from, a question mark when there
  // is not.
  const placeholder = (
    <div
      className="pavatar-fallback"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-label={name}
    >
      {(name[0] || '?').toUpperCase()}
    </div>
  )
  if (!name || state === 'fail') return placeholder

  return (
    <>
      {state === 'loading' && placeholder}
      <img
        className="pavatar"
        src={url}
        width={size}
        height={size}
        alt={name}
        onLoad={() => {
          outcome.set(name, 'ok')
          setState('ok')
        }}
        onError={() => {
          outcome.set(name, 'fail')
          setState('fail')
        }}
        style={{
          imageRendering: 'pixelated',
          // Kept in the tree while loading so the browser starts the request,
          // but out of the layout so it does not sit next to its own
          // placeholder.
          display: state === 'ok' ? undefined : 'none'
        }}
      />
    </>
  )
}
