import { useMemo, useRef, useState } from 'react'

/**
 * Small dependency-free time chart.
 *
 * Written by hand rather than pulled from a library: the packaged renderer runs
 * under a strict CSP, the bundle is already large, and all this needs to do is
 * draw a few thousand points with a hover readout.
 *
 * Gaps matter here — a server that was off has no samples, and joining across
 * that hole would draw a line through time the server did not exist. Any
 * spacing wider than `gapMs` starts a new path.
 */
export interface ChartPoint {
  ts: number
  v: number | null
  /** Optional band drawn behind the line (e.g. peak within the bucket). */
  hi?: number | null
}

export interface ChartMarker {
  ts: number
  color: string
  label: string
}

interface Props {
  points: ChartPoint[]
  from: number
  to: number
  color: string
  /** Fixed upper bound; otherwise the max of the data (with headroom). */
  max?: number
  min?: number
  height?: number
  gapMs?: number
  markers?: ChartMarker[]
  format?: (v: number) => string
  formatTime?: (ts: number) => string
  emptyLabel?: string
}

const PAD_L = 44
const PAD_R = 10
const PAD_T = 10
const PAD_B = 20
const VIEW_W = 1000

export function Chart({
  points,
  from,
  to,
  color,
  max,
  min = 0,
  height = 150,
  gapMs = 0,
  markers = [],
  format = (v) => String(Math.round(v * 10) / 10),
  formatTime,
  emptyLabel
}: Props): JSX.Element {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; p: ChartPoint } | null>(null)

  const valid = useMemo(() => points.filter((p) => p.v != null), [points])
  const span = Math.max(1, to - from)
  const hiMax = useMemo(
    () => valid.reduce((m, p) => Math.max(m, p.v as number, p.hi ?? 0), 0),
    [valid]
  )
  const top = max ?? Math.max(1, hiMax * 1.15)
  const range = Math.max(1e-6, top - min)

  const x = (ts: number): number => PAD_L + ((ts - from) / span) * (VIEW_W - PAD_L - PAD_R)
  const y = (v: number): number =>
    PAD_T + (1 - (Math.min(top, Math.max(min, v)) - min) / range) * (height - PAD_T - PAD_B)

  // One path per unbroken run of samples.
  const paths = useMemo(() => {
    const gap = gapMs || inferGap(points)
    const out: { line: string; area: string }[] = []
    let line = ''
    let area = ''
    let prevTs = 0
    let firstX = 0
    const flush = (lastX: number): void => {
      if (line) out.push({ line, area: `${area} L ${lastX} ${y(min)} L ${firstX} ${y(min)} Z` })
      line = ''
      area = ''
    }
    for (const p of points) {
      if (p.v == null) {
        flush(x(prevTs))
        continue
      }
      const px = x(p.ts)
      const py = y(p.v)
      if (!line || (gap && prevTs && p.ts - prevTs > gap)) {
        flush(x(prevTs))
        firstX = px
        line = `M ${px} ${py}`
        area = `M ${px} ${py}`
      } else {
        line += ` L ${px} ${py}`
        area += ` L ${px} ${py}`
      }
      prevTs = p.ts
    }
    flush(x(prevTs))
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, from, to, top, min, height, gapMs])

  const ticks = [min, min + range / 2, top]

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const el = wrapRef.current
    if (!el || !valid.length) return
    const rect = el.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const ts = from + frac * span
    let best = valid[0]
    for (const p of valid) if (Math.abs(p.ts - ts) < Math.abs(best.ts - ts)) best = p
    setHover({ x: ((x(best.ts) / VIEW_W) * 100), p: best })
  }

  return (
    <div
      className="chart"
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      style={{ position: 'relative' }}
    >
      <svg viewBox={`0 0 ${VIEW_W} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
        {ticks.map((tv, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={y(tv)} y2={y(tv)} className="chart-grid" />
            <text x={PAD_L - 6} y={y(tv) + 3.5} className="chart-axis" textAnchor="end">
              {format(tv)}
            </text>
          </g>
        ))}
        {markers.map((m, i) => (
          <line
            key={i}
            x1={x(m.ts)}
            x2={x(m.ts)}
            y1={PAD_T}
            y2={height - PAD_B}
            stroke={m.color}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            opacity={0.75}
          >
            <title>{m.label}</title>
          </line>
        ))}
        {paths.map((p, i) => (
          <g key={i}>
            <path d={p.area} fill={color} opacity={0.13} />
            <path d={p.line} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {hover && (
          <line
            x1={x(hover.p.ts)}
            x2={x(hover.p.ts)}
            y1={PAD_T}
            y2={height - PAD_B}
            className="chart-cursor"
          />
        )}
        {!valid.length && (
          <text x={VIEW_W / 2} y={height / 2} className="chart-axis" textAnchor="middle">
            {emptyLabel ?? '—'}
          </text>
        )}
      </svg>
      {hover && (
        <div
          className="chart-tip"
          style={{ left: `${Math.min(88, Math.max(2, hover.x))}%` }}
        >
          <b>{format(hover.p.v as number)}</b>
          <span className="dim">
            {formatTime ? formatTime(hover.p.ts) : new Date(hover.p.ts).toLocaleTimeString()}
          </span>
        </div>
      )}
    </div>
  )
}

/** Median spacing × 3 — anything wider is a real hole, not jitter. */
function inferGap(points: ChartPoint[]): number {
  if (points.length < 3) return 0
  const deltas: number[] = []
  for (let i = 1; i < points.length; i++) deltas.push(points[i].ts - points[i - 1].ts)
  deltas.sort((a, b) => a - b)
  return deltas[Math.floor(deltas.length / 2)] * 3
}
