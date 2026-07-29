import { useState, useEffect } from 'react'

/**
 * A Minecraft item or block icon.
 *
 * Drawn from the textures MSMS extracted out of Mojang's own client jar (#127),
 * which is why this takes a `src` rather than building a URL: the picture is a
 * `data:` URI the main process produced from a local file, so there is no third
 * party in the middle of a private server's inventory and it works with no
 * internet at all.
 *
 * It used to hot-link `assets.mcasset.cloud`. That host does not have a texture
 * at `item/<id>.png` for most blocks, so a chest, a log or a grass block fell
 * through to the three-letter chip — the "icons aren't loading" this replaces.
 *
 * No `src` means the operator has not downloaded the assets for this version, or
 * the id has no texture at all. The chip is the fallback, and it is not
 * politeness: it is what keeps an inventory readable before anything has been
 * downloaded.
 */
export function ItemIcon({
  id,
  src,
  size = 32
}: {
  id: string
  src?: string
  size?: number
}): JSX.Element {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src, id])

  if (!src || broken) {
    return (
      <div className="item-fallback" style={{ width: size, height: size }} title={id}>
        {id.slice(0, 3)}
      </div>
    )
  }
  return (
    <img
      className="item-icon"
      src={src}
      width={size}
      height={size}
      alt={id}
      title={id}
      loading="lazy"
      style={{ imageRendering: 'pixelated' }}
      onError={() => setBroken(true)}
    />
  )
}
