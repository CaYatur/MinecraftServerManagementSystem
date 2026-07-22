export function Logo({ size = 30 }: { size?: number }): JSX.Element {
  const id = 'lg' // gradient ids are fine to reuse within one document render
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1c1622" />
          <stop offset="0.55" stopColor="#131219" />
          <stop offset="1" stopColor="#0b0b10" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="0.32" cy="0.26" r="0.85">
          <stop offset="0" stopColor="#dc2727" stopOpacity="0.5" />
          <stop offset="0.45" stopColor="#dc2727" stopOpacity="0.1" />
          <stop offset="1" stopColor="#dc2727" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}c`} x1="0.15" y1="0.05" x2="0.85" y2="0.95">
          <stop offset="0" stopColor="#f04444" />
          <stop offset="1" stopColor="#a81d1d" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="116" fill={`url(#${id}bg)`} />
      <rect x="16" y="16" width="480" height="480" rx="116" fill={`url(#${id}glow)`} />
      <rect
        x="17"
        y="17"
        width="478"
        height="478"
        rx="115"
        fill="none"
        stroke="#dc2727"
        strokeOpacity="0.35"
        strokeWidth="2"
      />
      <path
        fill={`url(#${id}c)`}
        d="M 330 106 L 150 106 L 106 150 L 106 362 L 150 406 L 330 406 L 330 332 L 180 332 L 180 180 L 330 180 Z"
      />
      <rect
        x="356"
        y="232"
        width="48"
        height="48"
        rx="9"
        fill={`url(#${id}c)`}
        transform="rotate(45 380 256)"
      />
    </svg>
  )
}
