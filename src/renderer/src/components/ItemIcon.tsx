import { useState, useEffect } from 'react'

/**
 * Minecraft item/block icon from an online, always-updatable source
 * (assets.mcasset.cloud, which mirrors Mojang textures by version).
 * Tries item/ then block/, then falls back to a text chip.
 */
export function ItemIcon({
  id,
  version,
  size = 32
}: {
  id: string
  version?: string
  size?: number
}): JSX.Element {
  const ver = version && /^1\.\d+(\.\d+)?$/.test(version) ? version : '1.21.4'
  const [stage, setStage] = useState(0) // 0=item, 1=block, 2=text
  useEffect(() => setStage(0), [id, ver])

  if (stage >= 2) {
    return (
      <div className="item-fallback" style={{ width: size, height: size }} title={id}>
        {id.slice(0, 3)}
      </div>
    )
  }
  const folder = stage === 0 ? 'item' : 'block'
  const url = `https://assets.mcasset.cloud/${ver}/assets/minecraft/textures/${folder}/${id}.png`
  return (
    <img
      className="item-icon"
      src={url}
      width={size}
      height={size}
      alt={id}
      title={id}
      loading="lazy"
      style={{ imageRendering: 'pixelated' }}
      onError={() => setStage((s) => s + 1)}
    />
  )
}
