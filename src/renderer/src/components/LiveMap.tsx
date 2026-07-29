import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Map as MapIcon, Flame, Gauge } from 'lucide-react'
import { useStore } from '../store'
import { normalizeMapPerf } from '@shared/tileCache'
import type { MapPerfConfig } from '@shared/tileCache'
import { fitView, heatmap, mapBounds, panBy, screenToWorld, worldToScreen, zoomAt } from '@shared/livemap'
import type { LivePlayer, MapView, Viewport } from '@shared/livemap'
import { avatarUrl } from '@shared/profile'
import type { StructureMark } from '@shared/regionFormat'
import { iconFor, ICON_BOX } from '@shared/mapIcons'
import type { BridgeStatus } from '@shared/bridgeRelease'
import { BridgeNotice } from './BridgeNotice'

/**
 * The live world map (#26), desktop side.
 *
 * The maths — which entries are plottable, where the view is centred, how the
 * heatmap buckets — is `@shared/livemap`, the same module the web panel and the
 * `/map` endpoint use, so the three cannot disagree about where a player is.
 * Only the drawing is written twice: once in vanilla canvas for the panel, once
 * here.
 *
 * Canvas rather than DOM markers: a busy server is hundreds of positions
 * redrawn every couple of seconds, and that many absolutely positioned elements
 * re-laid-out at that rate is how a tab starts dropping frames.
 */

const CELL_CHOICES = [16, 32, 64, 128]

/**
 * `Path2D` per structure kind, built once.
 *
 * Rebuilding one from its path string for every marker on every frame is
 * parsing the same string hundreds of times a second.
 */
const ICON_PATHS = new Map<string, Path2D>()
function iconPath(kind: string): Path2D | null {
  const hit = ICON_PATHS.get(kind)
  if (hit) return hit
  try {
    const p = new Path2D(iconFor(kind).path)
    ICON_PATHS.set(kind, p)
    return p
  } catch {
    return null
  }
}

/**
 * A chunk tile baked into a 16x16 offscreen canvas, shaded by the step to the
 * column north of it. Baking once per chunk rather than per frame is the
 * difference between a map that pans and one that stutters.
 */
function bakeTile(t: { c: number[]; h: number[] }): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = 16
  cv.height = 16
  const g = cv.getContext('2d') as CanvasRenderingContext2D
  const img = g.createImageData(16, 16)
  for (let i = 0; i < 256; i++) {
    const c = t.c[i]
    const o = i * 4
    if (c < 0) {
      img.data[o + 3] = 0
      continue
    }
    const north = i >= 16 ? t.h[i - 16] : t.h[i]
    const f = t.h[i] > north ? 1.12 : t.h[i] < north ? 0.86 : 1
    img.data[o] = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)))
    img.data[o + 1] = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)))
    img.data[o + 2] = Math.max(0, Math.min(255, Math.round((c & 255) * f)))
    img.data[o + 3] = 255
  }
  g.putImageData(img, 0, 0)
  return cv
}

/**
 * A player's head, cached. `false` means the fetch failed and the caller falls
 * back to a dot — an avatar service is a third party and an offline LAN server
 * is a normal place to run this.
 */
function headFor(
  name: string,
  cache: Map<string, HTMLImageElement | false>,
  onLoad: () => void
): HTMLImageElement | null {
  const hit = cache.get(name)
  if (hit !== undefined) return hit || null
  // Marked before the load starts, not after: setting it afterwards would
  // overwrite a handler that had already resolved.
  cache.set(name, false)
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    cache.set(name, img)
    onLoad()
  }
  img.onerror = () => cache.set(name, false)
  img.src = avatarUrl(name, 32)
  return null
}

/**
 * Panning a big world would otherwise hold every chunk ever looked at.
 *
 * Each tile is small, but "small times unbounded" is still unbounded, and this
 * runs for as long as the app is open. Dropping the ones no longer near the
 * view costs a re-fetch that is already cached in the main process.
 */
function trimTiles(
  tiles: Map<string, HTMLCanvasElement | null>,
  keep: { cx: number; cz: number }[]
): void {
  if (tiles.size <= 2048) return
  const wanted = new Set(keep.map((c) => c.cx + ',' + c.cz))
  for (const k of tiles.keys()) if (!wanted.has(k)) tiles.delete(k)
}

export function LiveMap({ serverId }: { serverId: string }): JSX.Element {
  const { t } = useTranslation()
  const [players, setPlayers] = useState<LivePlayer[]>([])
  const [bridge, setBridge] = useState(false)
  const [dim, setDim] = useState('overworld')
  const [cell, setCell] = useState(16)
  // An analysis overlay, not what a map is for: a red block over the one player
  // online was the first thing anyone saw (#131).
  const [showHeat, setShowHeat] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Only to explain an empty canvas. The install itself is `BridgeNotice`,
  // which renders above the map whether or not there is anyone to draw — this
  // state does not, which is why it could never be the offer's only home (#118).
  const [bridgeState, setBridgeState] = useState<BridgeStatus | null>(null)
  useEffect(() => {
    window.msms
      .bridgeStatus(serverId)
      .then(setBridgeState)
      .catch(() => setBridgeState(null))
  }, [serverId])

  useEffect(() => {
    let alive = true
    const tick = async (): Promise<void> => {
      try {
        const r = await window.msms.getLivePlayers(serverId)
        if (!alive) return
        setBridge(r.bridge)
        setPlayers(r.players)
      } catch {
        if (alive) {
          setBridge(false)
          setPlayers([])
        }
      }
    }
    void tick()
    // Matches the bridge's own heartbeat. Polling faster would just resend the
    // same positions; slower and a player appears to teleport.
    const iv = setInterval(() => void tick(), 2000)
    return () => {
      alive = false
      clearInterval(iv)
    }
  }, [serverId])

  const dimensions = useMemo(
    () => [...new Set(players.map((p) => p.dim))].sort(),
    [players]
  )
  const shown = useMemo(() => players.filter((p) => p.dim === dim), [players, dim])
  const bounds = useMemo(() => mapBounds(shown), [shown])
  const heat = useMemo(() => heatmap(shown, cell), [shown, cell])

  // Follow the crowd ONCE: if nobody is in the default dimension but people are
  // online elsewhere, an empty overworld is less useful than showing where they
  // actually are.
  //
  // Only until the operator picks one, though. Without the flag this re-fires
  // every poll, so choosing "nether" while nobody is there snaps straight back
  // to the overworld and the select becomes unusable — the web panel avoids the
  // same trap by keeping the chosen dimension in its list even when empty.
  const [chosen, setChosen] = useState(false)
  useEffect(() => {
    if (chosen) return
    if (!shown.length && dimensions.length && !dimensions.includes(dim)) setDim(dimensions[0])
  }, [chosen, dimensions, shown.length, dim])

  // The view, from @shared/livemap — the same transform the web surfaces use,
  // so panning and zooming behave identically in all three (#128).
  const [view, setView] = useState<MapView | null>(null)
  const [vp, setVp] = useState<Viewport>({ width: 640, height: 400 })
  const [cursor, setCursor] = useState<{ x: number; z: number } | null>(null)
  const fitFor = useRef<string>('')
  const drag = useRef<{ x: number; y: number } | null>(null)

  // Heads ON by default. They are what makes a map read as a map of PEOPLE
  // rather than a scatter plot, and an operator should not have to find a
  // toggle to get the obvious thing.
  const [heads, setHeads] = useState(true)
  const [world, setWorld] = useState(true)
  // Structures, same as the web surfaces have them — off by default, and an
  // operator may switch them on without a setting because they can already read
  // the world folder (#131).
  const [marks, setMarks] = useState(false)
  const [markKind, setMarkKind] = useState('')
  const markStore = useRef(new Map<string, StructureMark[]>())

  // Per-server map tuning (#133), read from the server's own config so it
  // survives a restart and applies to every surface, not just this one.
  const servers = useStore((s) => s.servers)
  const updateServer = useStore((s) => s.updateServer)
  const perf = useMemo(
    () => normalizeMapPerf(servers.find((s) => s.id === serverId)?.map),
    [servers, serverId]
  )
  const [showPerf, setShowPerf] = useState(false)
  const [cleared, setCleared] = useState<number | null>(null)
  // Bumped by "Load this view" so one fetch happens even with loading-on-pan
  // off. A counter rather than a flag: two presses in a row must both count.
  const [loadNow, setLoadNow] = useState(0)

  const savePerf = (patch: Partial<MapPerfConfig>): void => {
    // Normalised before it is stored, not after it is read: a value that only
    // gets clamped on the way out is still a wrong number in the config file.
    void updateServer(serverId, { map: normalizeMapPerf({ ...perf, ...patch }) })
  }
  const clearCache = async (): Promise<void> => {
    setCleared(await window.msms.clearMapCache())
    tiles.current.clear()
    markStore.current.clear()
    setTick2((n) => n + 1)
  }
  const headCache = useRef(new Map<string, HTMLImageElement | false>())
  const tiles = useRef(new Map<string, HTMLCanvasElement | null>())
  const tilesPending = useRef(false)
  const [tick2, setTick2] = useState(0)

  const chunkBox = useCallback((): { x0: number; x1: number; z0: number; z1: number } | null => {
    if (!view) return null
    const tl = screenToWorld({ x: 0, y: 0 }, view, vp)
    const br = screenToWorld({ x: vp.width, y: vp.height }, view, vp)
    return {
      x0: Math.floor(tl.x / 16),
      x1: Math.floor(br.x / 16),
      z0: Math.floor(tl.z / 16),
      z1: Math.floor(br.z / 16)
    }
  }, [view, vp])

  /** What to REQUEST. Capped: zoomed out this is millions of chunks. */
  const visibleChunks = useCallback((): { cx: number; cz: number }[] => {
    const b = chunkBox()
    if (!b) return []
    if ((b.x1 - b.x0 + 1) * (b.z1 - b.z0 + 1) > 4096) return []
    const out: { cx: number; cz: number }[] = []
    for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) out.push({ cx: x, cz: z })
    return out
  }, [chunkBox])

  /**
   * What to DRAW: everything already held that falls in view. A different
   * question from what to request — conflating them is why the terrain vanished
   * when zoomed out (#135).
   */
  const drawableChunks = useCallback((): { cx: number; cz: number }[] => {
    const b = chunkBox()
    if (!b) return []
    const out: { cx: number; cz: number }[] = []
    for (const k of tiles.current.keys()) {
      if (!tiles.current.get(k)) continue
      const [cx, cz] = k.split(',').map(Number)
      if (cx < b.x0 - 1 || cx > b.x1 + 1 || cz < b.z0 - 1 || cz > b.z1 + 1) continue
      out.push({ cx, cz })
    }
    return out
  }, [chunkBox])

  // Ask for what is on screen and not yet held. The main process owns the queue
  // and the parse budget, shared with the web surfaces.
  useEffect(() => {
    if (!world || !view || tilesPending.current) return
    // Off, the map draws what it holds and asks for nothing more until the
    // operator presses to load (#136).
    if (!perf.loadOnPan && !loadNow) return
    const want = visibleChunks()
      .filter((c: { cx: number; cz: number }) => !tiles.current.has(c.cx + ',' + c.cz))
      .slice(0, 64)
    if (!want.length) return
    trimTiles(tiles.current, visibleChunks())
    tilesPending.current = true
    window.msms
      .mapTiles(serverId, dim, want, marks)
      .then((r) => {
        tilesPending.current = false
        // The empty list is "read, and nothing there" — as opposed to "not read
        // yet". Marking null only when the whole response had nothing pending
        // meant a genuinely empty chunk was re-requested on every draw (#136).
        const known = new Set(r.empty ?? [])
        for (const w of want) {
          const k = w.cx + ',' + w.cz
          const t = r.tiles[k]
          if (t) {
            tiles.current.set(k, bakeTile(t))
            if (t.m) markStore.current.set(k, t.m)
          } else if (known.has(k) || !r.pending) tiles.current.set(k, null)
        }
        setTick2((n) => n + 1)
        // Ask again while anything is still coming, rather than waiting for the
        // 2-second position poll — that wait is why a view filled in bands.
        if (r.pending > 0) window.setTimeout(() => setTick2((n) => n + 1), 180)
      })
      .catch(() => {
        tilesPending.current = false
      })
  }, [world, view, vp, dim, serverId, visibleChunks, tick2, marks, perf.loadOnPan, loadNow])

  // A different server or dimension is a different world; nothing carries over.
  // The nether shares the overworld's coordinates, so keeping tiles across a
  // dimension change would draw one world's terrain under another's players.
  useEffect(() => {
    tiles.current.clear()
    markStore.current.clear()
    setView(null)
    fitFor.current = ''
  }, [serverId, dim])

  // Tiles already held were fetched without markers, so they carry none.
  useEffect(() => {
    if (!marks) return
    tiles.current.clear()
    markStore.current.clear()
  }, [marks])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const rect = cv.getBoundingClientRect()
    // Match the backing store to the device pixel ratio, or everything drawn
    // here is blurry on a HiDPI screen.
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (cv.width !== w || cv.height !== h) {
      cv.width = w
      cv.height = h
    }
    const size = { width: rect.width || w, height: rect.height || h }
    if (size.width !== vp.width || size.height !== vp.height) setVp(size)
    // Fitted once per dimension. After that the view is the operator's: a poll
    // two seconds later must not yank it back to wherever the players are.
    let v = view
    if (!v || fitFor.current !== dim) {
      v = fitView(bounds, size)
      fitFor.current = dim
      setView(v)
    }
    const g = cv.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, w, h)

    const sx = w / size.width
    const sy = h / size.height
    const px = (x: number): number => worldToScreen({ x, z: 0 }, v as MapView, size).x * sx
    const pz = (z: number): number => worldToScreen({ x: 0, z }, v as MapView, size).y * sy

    // The world first; everything else sits on top of it.
    if (world) {
      g.imageSmoothingEnabled = false
      for (const c of drawableChunks()) {
        const t = tiles.current.get(c.cx + ',' + c.cz)
        if (!t) continue
        const p = worldToScreen({ x: c.cx * 16, z: c.cz * 16 }, v, size)
        g.drawImage(t, p.x * sx, p.y * sy, 16 * v.scale * sx + 1, 16 * v.scale * sy + 1)
      }
      g.imageSmoothingEnabled = true
    }

    const tl = screenToWorld({ x: 0, y: 0 }, v, size)
    const br = screenToWorld({ x: size.width, y: size.height }, v, size)
    // A grid that adapts to the zoom: a fixed 64 is invisible zoomed out and a
    // solid wall zoomed in.
    let step = 64
    while (step * v.scale < 48) step *= 4
    while (step * v.scale > 220 && step > 1) step /= 4
    g.strokeStyle = 'rgba(255,255,255,.06)'
    g.lineWidth = dpr
    for (let gx = Math.ceil(tl.x / step) * step; gx <= br.x; gx += step) {
      g.beginPath()
      g.moveTo(px(gx), 0)
      g.lineTo(px(gx), h)
      g.stroke()
    }
    for (let gz = Math.ceil(tl.z / step) * step; gz <= br.z; gz += step) {
      g.beginPath()
      g.moveTo(0, pz(gz))
      g.lineTo(w, pz(gz))
      g.stroke()
    }
    // The origin, when it is in view — the one landmark every player shares.
    if (tl.x <= 0 && br.x >= 0 && tl.z <= 0 && br.z >= 0) {
      g.strokeStyle = 'rgba(220,39,39,.5)'
      g.beginPath()
      g.moveTo(px(0), 0)
      g.lineTo(px(0), h)
      g.stroke()
      g.beginPath()
      g.moveTo(0, pz(0))
      g.lineTo(w, pz(0))
      g.stroke()
    }

    if (showHeat && heat.length) {
      const max = heat[0].count || 1
      const cw = cell * v.scale * sx
      const ch = cell * v.scale * sy
      for (const c of heat) {
        g.fillStyle = `rgba(220,39,39,${(0.12 + 0.55 * (c.count / max)).toFixed(3)})`
        g.fillRect(px(c.x), pz(c.z), Math.max(2 * dpr, cw), Math.max(2 * dpr, ch))
      }
    }

    // After the grid and the heatmap, before the players.
    if (marks) {
      for (const c of drawableChunks()) {
        for (const mk of markStore.current.get(c.cx + ',' + c.cz) ?? []) {
          if (markKind && mk.kind !== markKind) continue
          const ic = iconFor(mk.kind)
          const x = px(mk.x)
          const y = pz(mk.z)
          const r = 9 * dpr
          // A disc behind the glyph, so a silhouette does not disappear against
          // terrain its own colour.
          g.beginPath()
          g.arc(x, y, r, 0, Math.PI * 2)
          g.fillStyle = 'rgba(16,16,20,.72)'
          g.fill()
          g.lineWidth = 1.5 * dpr
          g.strokeStyle = ic.colour
          g.stroke()
          const path = iconPath(mk.kind)
          if (path) {
            const s = (r * 1.5) / ICON_BOX
            g.save()
            g.translate(x - r * 0.75, y - r * 0.75)
            g.scale(s, s)
            g.fillStyle = ic.colour
            g.fill(path)
            g.restore()
          }
        }
      }
    }

    g.font = `${11 * dpr}px Inter, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'bottom'
    for (const p of shown) {
      const x = px(p.x)
      const y = pz(p.z)
      const head = heads ? headFor(p.name, headCache.current, () => setTick2((n) => n + 1)) : null
      if (head) {
        const hs = 18 * dpr
        g.drawImage(head, x - hs / 2, y - hs / 2, hs, hs)
        g.lineWidth = 1.5 * dpr
        g.strokeStyle = 'rgba(0,0,0,.55)'
        g.strokeRect(x - hs / 2, y - hs / 2, hs, hs)
      } else {
        g.beginPath()
        g.arc(x, y, 4.5 * dpr, 0, Math.PI * 2)
        g.fillStyle = '#4ade80'
        g.fill()
        g.lineWidth = 1.5 * dpr
        g.strokeStyle = 'rgba(0,0,0,.55)'
        g.stroke()
      }
      g.fillStyle = 'rgba(255,255,255,.92)'
      g.fillText(p.name, x, y - (head ? 12 : 7) * dpr)
    }
  }, [shown, bounds, heat, cell, showHeat, view, vp, dim, heads, world, marks, markKind, tick2, drawableChunks])

  const localPoint = (e: React.MouseEvent): { x: number; y: number } => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  /**
   * Wheel-to-zoom, bound by hand rather than through `onWheel`.
   *
   * React registers wheel listeners as PASSIVE, so `preventDefault` inside an
   * `onWheel` handler does nothing and the page scrolls behind the map (#135).
   * The only way to stop that is a listener registered with `passive: false`.
   */
  const viewRef = useRef<MapView | null>(null)
  viewRef.current = view
  const vpRef = useRef(vp)
  vpRef.current = vp
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const onWheel = (e: WheelEvent): void => {
      const v = viewRef.current
      if (!v) return
      e.preventDefault()
      const r = cv.getBoundingClientRect()
      setView(
        zoomAt(v, vpRef.current, { x: e.clientX - r.left, y: e.clientY - r.top }, e.deltaY < 0 ? 1.15 : 1 / 1.15)
      )
    }
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => cv.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div>
      <BridgeNotice serverId={serverId} />
      <div className="row wrap" style={{ gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <span className="badge">
          <span className={`dot ${bridge ? 'running' : 'stopped'}`} />
          {bridge ? t('map.live') : t('map.noBridge')}
        </span>
        <div className="spacer" style={{ flex: 1 }} />
        <select
          className="select"
          style={{ width: 150 }}
          value={dim}
          onChange={(e) => {
            setChosen(true)
            setDim(e.target.value)
          }}
        >
          {/* The chosen dimension stays listed even when it is empty, or the
              select would drop the option that is currently selected. */}
          {[...new Set([...dimensions, dim])].sort().map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          className="select"
          style={{ width: 130 }}
          value={cell}
          onChange={(e) => setCell(Number(e.target.value))}
        >
          {CELL_CHOICES.map((c) => (
            <option key={c} value={c}>
              {c === 16 ? t('map.cellChunk') : t('map.cellBlocks', { n: c })}
            </option>
          ))}
        </select>
        <button
          className={`btn sm ${showHeat ? 'primary' : ''}`}
          onClick={() => setShowHeat((v) => !v)}
        >
          <Flame size={13} /> {t('map.heatmap')}
        </button>
        {/* The same controls the web surfaces have. The desktop map used to be
            a second implementation with a different set of them, which is why
            the three never looked alike (#128). */}
        <button className={`btn sm ${heads ? 'primary' : ''}`} onClick={() => setHeads((v) => !v)}>
          {t('map.heads')}
        </button>
        <button className={`btn sm ${world ? 'primary' : ''}`} onClick={() => setWorld((v) => !v)}>
          {t('map.world')}
        </button>
        <button className={`btn sm ${marks ? 'primary' : ''}`} onClick={() => setMarks((v) => !v)}>
          {t('map.structures')}
        </button>
        {marks && (
          <select className="select" style={{ width: 150 }} value={markKind} onChange={(e) => setMarkKind(e.target.value)}>
            <option value="">{t('map.allStructures')}</option>
            {(['village', 'dungeon', 'temple', 'fortress', 'mine'] as const).map((k) => (
              <option key={k} value={k}>
                {t('map.structure_' + k)}
              </option>
            ))}
          </select>
        )}
        {!perf.loadOnPan && (
          <button className="btn sm" onClick={() => setLoadNow((n) => n + 1)}>
            {t('map.loadHere')}
          </button>
        )}
        <button className="btn sm" onClick={() => setView(null)}>
          {t('map.resetView')}
        </button>
        <button className={`btn sm ${showPerf ? 'primary' : ''}`} onClick={() => setShowPerf((v) => !v)}>
          <Gauge size={13} /> {t('map.performance')}
        </button>
      </div>

      {/* Per-server, persisted, and applied without a restart — the map is where
          an operator meets the cost, so it is where the dials belong (#133). */}
      {showPerf && (
        <div className="panel" style={{ marginBottom: 10 }}>
          {/* These persist on the server, so they are not a preference of this
              window — say so, or they read as one (#136). */}
          <p className="hint" style={{ marginTop: 0 }}>
            {t('map.perfScope')}
          </p>
          <label className="switch" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={perf.cache}
              onChange={(e) => savePerf({ cache: e.target.checked })}
            />
            {t('map.perfCache')}
          </label>
          <p className="hint" style={{ marginTop: 0 }}>
            {t('map.perfCacheHint')}
          </p>
          <label className="switch" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={perf.loadOnPan}
              onChange={(e) => savePerf({ loadOnPan: e.target.checked })}
            />
            {t('map.perfPan')}
          </label>
          <p className="hint" style={{ marginTop: 0 }}>
            {t('map.perfPanHint')}
          </p>
          <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div style={{ minWidth: 150 }}>
              <div className="dim" style={{ fontSize: 12 }}>
                {t('map.perfMemory')}
              </div>
              <input
                className="input"
                type="number"
                min={2}
                max={64}
                value={perf.memoryRegions}
                onChange={(e) => savePerf({ memoryRegions: Number(e.target.value) })}
              />
            </div>
            <div style={{ minWidth: 150 }}>
              <div className="dim" style={{ fontSize: 12 }}>
                {t('map.perfGap')}
              </div>
              <input
                className="input"
                type="number"
                min={0}
                max={5000}
                step={50}
                value={perf.parseGapMs}
                onChange={(e) => savePerf({ parseGapMs: Number(e.target.value) })}
              />
            </div>
            <div style={{ minWidth: 150 }}>
              <div className="dim" style={{ fontSize: 12 }}>
                {t('map.perfLimit')}
              </div>
              <input
                className="input"
                type="number"
                min={0}
                max={20000}
                step={64}
                value={perf.cacheLimitMB}
                onChange={(e) => savePerf({ cacheLimitMB: Number(e.target.value) })}
              />
            </div>
            <button className="btn sm" onClick={() => void clearCache()}>
              {t('map.perfClear')}
            </button>
          </div>
          <p className="hint">{t('map.perfGapHint')}</p>
          {cleared !== null && <p className="hint">{t('map.perfCleared', { n: cleared })}</p>}
        </div>
      )}

      <div
        style={{
          position: 'relative',
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#0a0a0f',
          aspectRatio: '16 / 10'
        }}
      >
        <canvas
          ref={canvasRef}
          /* `grabbing` via :active in CSS, not from the drag ref — a ref does
             not re-render, so a style bound to it never changes. */
          className="mp-canvas"
          style={{ width: '100%', height: '100%', display: 'block' }}
          onMouseDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY }
            e.preventDefault()
          }}
          onMouseUp={() => (drag.current = null)}
          onMouseLeave={() => {
            drag.current = null
            setCursor(null)
          }}
          onMouseMove={(e) => {
            if (!view) return
            if (drag.current) {
              setView(panBy(view, e.clientX - drag.current.x, e.clientY - drag.current.y))
              drag.current = { x: e.clientX, y: e.clientY }
              return
            }
            setCursor(screenToWorld(localPoint(e), view, vp))
          }}
        />
        {cursor && (
          <div
            style={{
              position: 'absolute',
              left: 10,
              bottom: 10,
              padding: '4px 9px',
              borderRadius: 8,
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
              background: 'rgba(0,0,0,.55)',
              color: '#fff'
            }}
          >
            X {Math.round(cursor.x)}  Z {Math.round(cursor.z)}
          </div>
        )}
        {shown.length === 0 && (
          <div
            className="center-fill"
            style={{ position: 'absolute', inset: 0, textAlign: 'center', padding: 20 }}
          >
            <MapIcon size={26} className="dim" />
            <p className="hint" style={{ maxWidth: 380 }}>
              {bridge ? t('map.emptyDimension') : t('map.needsBridge')}
            </p>
            {/* The offer itself is BridgeNotice above the map, which renders
                whether or not there are players to draw. This state only says
                why the canvas is empty — it cannot be the only home for the
                install, because it does not render when anyone is online. */}
            {!bridge && bridgeState?.state === 'unsupported' && (
              <p className="hint dim" style={{ maxWidth: 380 }}>
                {t('map.bridgeUnsupported')}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="row wrap" style={{ gap: 12, marginTop: 8 }}>
        <span className="dim" style={{ fontSize: 11 }}>
          X {Math.round(bounds.minX)} … {Math.round(bounds.maxX)} · Z {Math.round(bounds.minZ)} …{' '}
          {Math.round(bounds.maxZ)}
        </span>
        <span className="dim" style={{ fontSize: 11 }}>
          {t('map.shown', { n: shown.length })}
        </span>
      </div>
      {shown.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          {/* Click to centre on them, keeping the zoom — with several people
              online, finding one meant panning around reading the coordinate
              readout (#131). */}
          {shown.map((p) => (
            <button
              key={p.name}
              className="badge"
              style={{ cursor: 'pointer', font: 'inherit', color: 'inherit' }}
              title={t('map.goTo')}
              onClick={() => view && setView({ cx: p.x, cz: p.z, scale: view.scale })}
            >
              {p.name}{' '}
              <span className="dim">
                {p.x}, {p.y}, {p.z}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
