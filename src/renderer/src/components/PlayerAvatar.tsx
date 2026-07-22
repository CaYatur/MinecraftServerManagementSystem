import { useState, useEffect } from 'react'

/**
 * Minecraft head avatar from an online, always-updatable source (minotar.net).
 * Works with a UUID (premium/online-mode) or a username (offline). Falls back to
 * a coloured initial box if the network image can't load.
 */
export function PlayerAvatar({
  uuid,
  name,
  size = 44
}: {
  uuid?: string
  name: string
  size?: number
}): JSX.Element {
  const key = uuid && uuid.replace(/-/g, '').length >= 32 ? uuid : name
  const url = `https://minotar.net/helm/${encodeURIComponent(key)}/${size * 2}`
  const [err, setErr] = useState(false)
  useEffect(() => setErr(false), [key])

  if (err || !key) {
    return (
      <div
        className="pavatar-fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      >
        {(name[0] || '?').toUpperCase()}
      </div>
    )
  }
  return (
    <img
      className="pavatar"
      src={url}
      width={size}
      height={size}
      alt={name}
      loading="lazy"
      onError={() => setErr(true)}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
