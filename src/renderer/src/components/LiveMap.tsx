import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Map as MapIcon, Flame, Gauge, Shapes, Plus, Trash2, Check, X } from 'lucide-react'
import { useStore } from '../store'
import { normalizeMapPerf } from '@shared/tileCache'
import type { MapPerfConfig } from '@shared/tileCache'
import {
  fitView,
  heatmap,
  mapBounds,
  panBy,
  screenToWorld,
  chunkBoxToRegions,
  tilesToDrop,
  worldToScreen,
  zoomAt,
  MAX_TILES_PER_REQUEST,
  MAX_VIEWPORT_CHUNKS,
  REGION_CHUNKS,
  REGION_SPAN
} from '@shared/livemap'
import type { ChunkBox, LivePlayer, MapView, Viewport } from '@shared/livemap'
import { avatarUrl } from '@shared/profile'
import type { StructureMark } from '@shared/regionFormat'
import { iconFor, ICON_BOX } from '@shared/mapIcons'
import {
  areaAt,
  areasFor,
  chunkOf,
  normalizeRects,
  subtractChunk,
  parseChunkInput,
  checkArea,
  areaChunkCount,
  AREA_COLOURS
} from '@shared/chunkAreas'
import type { ChunkArea, ChunkRect } from '@shared/chunkAreas'
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
 * The terrain held for one region: a 512x512 canvas with chunks stamped into it
 * as they arrive, plus what is known about each of its 1024 chunks (#164).
 *
 * One canvas per REGION rather than per chunk. A viewport is up to 4096 chunks,
 * so per-chunk canvases meant thousands of DOM objects, which forced a cache
 * limit low enough that panning away and back lost the ground — and cost up to
 * 4096 `drawImage` calls a frame. The pixels are the same bytes either way.
 *
 * `st` and `mk` live in here rather than beside it so that dropping a region
 * drops the canvas AND the claim to have drawn its chunks in one statement.
 */
interface RegionTile {
  /**
   * Null until something is actually drawn into it.
   *
   * The canvas is a megabyte and allocating it with the entry meant a region of
   * nothing but ungenerated chunks — an ocean, the edge of the explored world —
   * took one anyway, and a slot in the cache, evicting terrain that had really
   * been read.
   */
  cv: HTMLCanvasElement | null
  g: CanvasRenderingContext2D | null
  /** Chunk key -> 1 drawn, 0 read and empty. Absent means never read. */
  st: Map<string, 0 | 1>
  mk: Map<string, StructureMark[]>
}

const regionOfChunk = (c: number): number => Math.floor(c / REGION_CHUNKS)
const regionKey = (cx: number, cz: number): string =>
  regionOfChunk(cx) + ',' + regionOfChunk(cz)

function regionFor(store: Map<string, RegionTile>, cx: number, cz: number): RegionTile {
  const k = regionKey(cx, cz)
  const hit = store.get(k)
  if (hit) return hit
  const made: RegionTile = { cv: null, g: null, st: new Map(), mk: new Map() }
  store.set(k, made)
  return made
}

/** The canvas, made on the first chunk that needs one. */
function regionCanvas(r: RegionTile): CanvasRenderingContext2D {
  if (!r.g) {
    const cv = document.createElement('canvas')
    cv.width = REGION_SPAN
    cv.height = REGION_SPAN
    r.cv = cv
    r.g = cv.getContext('2d') as CanvasRenderingContext2D
  }
  return r.g
}

/**
 * One chunk, painted into its region canvas at the chunk's own offset, shaded
 * by the step to the column north of it.
 *
 * Incremental on purpose: a region arrives a few hundred chunks at a time, so
 * baking it once when its first chunk landed would leave it permanently mostly
 * transparent.
 */
function stampTile(
  store: Map<string, RegionTile>,
  cx: number,
  cz: number,
  t: { c: number[]; h: number[]; m?: StructureMark[] }
): void {
  const r = regionFor(store, cx, cz)
  const g = regionCanvas(r)
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
  // Local chunk within the region. A remainder is negative west of zero, so it
  // is wrapped — chunk -1 is local 31, and a raw modulo would paint outside the
  // canvas and silently draw nothing.
  const lx = ((cx % REGION_CHUNKS) + REGION_CHUNKS) % REGION_CHUNKS
  const lz = ((cz % REGION_CHUNKS) + REGION_CHUNKS) % REGION_CHUNKS
  g.putImageData(img, lx * 16, lz * 16)
  const k = cx + ',' + cz
  r.st.set(k, 1)
  if (t.m) r.mk.set(k, t.m)
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
 * runs for as long as the app is open. WHICH ones to give up is
 * `tilesToDrop` — shared with the web map, and farthest-from-the-view first,
 * because the old rule here kept the current viewport and deleted everything
 * else the moment the cache passed its limit (#159).
 */
function trimTiles(
  store: Map<string, RegionTile>,
  waiting: Map<string, number>,
  box: ChunkBox | null
): void {
  if (!box) return
  // In REGION coordinates, because that is the unit being dropped.
  const rbox = chunkBoxToRegions(box)
  for (const k of tilesToDrop(store.keys(), rbox)) {
    const gone = store.get(k)
    // The backoff entries for that region's chunks go with it, or they outlive
    // every tile they were about and the map accumulates one entry per chunk
    // ever looked at.
    if (gone) for (const ck of gone.st.keys()) waiting.delete(ck)
    store.delete(k)
  }
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
  // Where the button went down, so a click can be told from the end of a pan.
  const downAt = useRef<{ x: number; y: number } | null>(null)

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
  // Marks live inside each region entry, so they are dropped by the same
  // eviction and can never outlive the terrain they annotate (#164).

  // Per-server map tuning (#133), read from the server's own config so it
  // survives a restart and applies to every surface, not just this one.
  const servers = useStore((s) => s.servers)
  const updateServer = useStore((s) => s.updateServer)
  const perf = useMemo(
    () => normalizeMapPerf(servers.find((s) => s.id === serverId)?.map),
    [servers, serverId]
  )
  // Named chunk areas (#144). ON by default, unlike structures: an area is a
  // label the operator wrote for people to read, so hiding it defeats the point.
  const [areas, setAreas] = useState<ChunkArea[]>([])
  const [showAreas, setShowAreas] = useState(true)
  // Drawing them is on; the editor is not. Two separate decisions.
  const [showAreaCard, setShowAreaCard] = useState(false)
  const [pinned, setPinned] = useState<ChunkArea | null>(null)
  // Where to draw the tooltip, in CANVAS pixels. `cursor` is world coordinates
  // and cannot place anything on screen.
  const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<ChunkArea | 'new' | null>(null)
  // Chunks picked by clicking, while the picker is open. A mode rather than a
  // held modifier: this has to work on a trackpad and the same UI ships to a
  // phone-sized panel, where there is no shift key to hold.
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<ChunkRect[]>([])

  const reloadAreas = useCallback((): void => {
    void window.msms.listChunkAreas(serverId).then(setAreas)
  }, [serverId])
  useEffect(() => {
    reloadAreas()
    setPinned(null)
    setPicking(false)
    setPicked([])
  }, [reloadAreas])

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
    waiting.current.clear()
    setTick2((n) => n + 1)
  }
  const headCache = useRef(new Map<string, HTMLImageElement | false>())
  const tiles = useRef(new Map<string, RegionTile>())
  const tilesPending = useRef(false)
  /** Chunk -> when it is worth asking for again, while its region is read. */
  const waiting = useRef(new Map<string, number>())
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
    if ((b.x1 - b.x0 + 1) * (b.z1 - b.z0 + 1) > MAX_VIEWPORT_CHUNKS) return []
    const out: { cx: number; cz: number }[] = []
    for (let z = b.z0; z <= b.z1; z++) for (let x = b.x0; x <= b.x1; x++) out.push({ cx: x, cz: z })
    return out
  }, [chunkBox])

  /**
   * What to DRAW: every held REGION that falls in view. A different question
   * from what to request — conflating them is why the terrain vanished when
   * zoomed out (#135). Iterating what is held rather than what is visible costs
   * the size of the cache, which is now dozens of regions rather than thousands
   * of chunks (#164).
   */
  const drawableRegions = useCallback((): { rx: number; rz: number; r: RegionTile }[] => {
    const b = chunkBox()
    if (!b) return []
    const rb = chunkBoxToRegions(b)
    const out: { rx: number; rz: number; r: RegionTile }[] = []
    for (const [k, r] of tiles.current) {
      const [rx, rz] = k.split(',').map(Number)
      if (rx < rb.x0 || rx > rb.x1 || rz < rb.z0 || rz > rb.z1) continue
      // A region that only ever answered "nothing there" has no canvas.
      if (!r.cv) continue
      out.push({ rx, rz, r })
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
    // A chunk whose region is still being parsed is not asked for again
    // straight away. Without this the next request rebuilds the same list —
    // the viewport is walked in order, so the unresolved chunks are always at
    // the front — and the map spins on one band while the rest stays blank.
    const now = Date.now()
    let soonest = Infinity
    const want = visibleChunks()
      .filter((c: { cx: number; cz: number }) => {
        const k = c.cx + ',' + c.cz
        if (tiles.current.get(regionKey(c.cx, c.cz))?.st.has(k)) return false
        const until = waiting.current.get(k) ?? 0
        if (until > now) {
          soonest = Math.min(soonest, until)
          return false
        }
        return true
      })
      .slice(0, MAX_TILES_PER_REQUEST)
    if (!want.length) {
      // Everything left on screen is waiting on a region parse, so there is
      // nothing to ask for THIS instant — but the retry below only fires after
      // a response, and there is no response coming. Without a wake-up here the
      // view stops filling until the operator moves it.
      if (soonest !== Infinity) {
        const timer = window.setTimeout(() => setTick2((n) => n + 1), Math.max(50, soonest - now))
        return () => window.clearTimeout(timer)
      }
      return
    }
    trimTiles(tiles.current, waiting.current, chunkBox())
    tilesPending.current = true
    window.msms
      .mapTiles(serverId, dim, want, marks)
      .then((r) => {
        tilesPending.current = false
        // The empty list is "read, and nothing there" — as opposed to "not read
        // yet". Marking null only when the whole response had nothing pending
        // meant a genuinely empty chunk was re-requested on every draw (#136).
        //
        // `!r.pending` is NOT a second way to know that: it says nothing about
        // chunks the server never looked at, and once a request can carry more
        // than the server reads that inference blanks them permanently (#159).
        // Every requested chunk comes back in `tiles`, in `empty`, or pending.
        const known = new Set(r.empty ?? [])
        for (const w of want) {
          const k = w.cx + ',' + w.cz
          const t = r.tiles[k]
          if (t) {
            // Stamped into the region canvas where it belongs rather than baked
            // into a canvas of its own — a region arrives a few hundred chunks
            // at a time, so this has to be incremental (#164).
            stampTile(tiles.current, w.cx, w.cz, t)
            waiting.current.delete(k)
          } else if (known.has(k)) {
            regionFor(tiles.current, w.cx, w.cz).st.set(k, 0)
            waiting.current.delete(k)
          } else {
            // Still being read. Come back to it, but let the rest of the view
            // be asked for first.
            waiting.current.set(k, Date.now() + 400)
          }
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
    waiting.current.clear()
    setView(null)
    fitFor.current = ''
  }, [serverId, dim])

  // Tiles already held were fetched without markers, so they carry none.
  useEffect(() => {
    if (!marks) return
    tiles.current.clear()
    waiting.current.clear()
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
      // One call per REGION. This loop used to run once per visible chunk, up
      // to 4096 times a frame; a viewport spans at most nine regions (#164).
      for (const c of drawableRegions()) {
        if (!c.r.cv) continue
        const p = worldToScreen({ x: c.rx * REGION_SPAN, z: c.rz * REGION_SPAN }, v, size)
        const side = REGION_SPAN * v.scale
        g.drawImage(c.r.cv, p.x * sx, p.y * sy, side * sx + 1, side * sy + 1)
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

    // Named chunk areas (#144). Unlike the two web pages, this can import the
    // rules rather than reimplement them — `areaIndex` is hoisted out of the
    // draw so the sort and the size measurement happen once, not per rectangle.
    if (showAreas) {
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      for (const a of areasFor(areas, dim)) {
        const n = parseInt(a.colour.slice(1), 16)
        const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
        const lit = pinned?.id === a.id
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const r of a.rects) {
          const p0 = worldToScreen({ x: r.x1 * 16, z: r.z1 * 16 }, v, size)
          const p1 = worldToScreen({ x: (r.x2 + 1) * 16, z: (r.z2 + 1) * 16 }, v, size)
          const x = p0.x * sx
          const y = p0.y * sy
          const ww = (p1.x - p0.x) * sx
          const hh = (p1.y - p0.y) * sy
          g.fillStyle = `rgba(${rgb},${lit ? 0.42 : 0.24})`
          g.fillRect(x, y, ww, hh)
          g.strokeStyle = `rgba(${rgb},.95)`
          g.lineWidth = (lit ? 2.5 : 1.5) * dpr
          g.strokeRect(x, y, ww, hh)
          minX = Math.min(minX, x)
          minY = Math.min(minY, y)
          maxX = Math.max(maxX, x + ww)
          maxY = Math.max(maxY, y + hh)
        }
        // The name only where the shape can hold it: drawn at every zoom it
        // turns a world view into a wall of overlapping text.
        if (maxX - minX > 46 * dpr && maxY - minY > 16 * dpr) {
          g.font = `600 ${11 * dpr}px Inter,system-ui,sans-serif`
          g.lineWidth = 3 * dpr
          g.strokeStyle = 'rgba(0,0,0,.65)'
          g.strokeText(a.name, (minX + maxX) / 2, (minY + maxY) / 2)
          g.fillStyle = 'rgba(255,255,255,.96)'
          g.fillText(a.name, (minX + maxX) / 2, (minY + maxY) / 2)
        }
      }
      g.textAlign = 'center'
      g.textBaseline = 'bottom'
    }

    // The selection in progress, drawn in the app's accent so it cannot be
    // mistaken for a saved area in one of the palette colours.
    if (picking) {
      for (const r of picked) {
        const p0 = worldToScreen({ x: r.x1 * 16, z: r.z1 * 16 }, v, size)
        const p1 = worldToScreen({ x: (r.x2 + 1) * 16, z: (r.z2 + 1) * 16 }, v, size)
        g.fillStyle = 'rgba(255,255,255,.22)'
        g.fillRect(p0.x * sx, p0.y * sy, (p1.x - p0.x) * sx, (p1.y - p0.y) * sy)
        g.strokeStyle = 'rgba(255,255,255,.9)'
        g.lineWidth = 1.5 * dpr
        g.setLineDash([4 * dpr, 3 * dpr])
        g.strokeRect(p0.x * sx, p0.y * sy, (p1.x - p0.x) * sx, (p1.y - p0.y) * sy)
        g.setLineDash([])
      }
    }

    // After the grid and the heatmap, before the players.
    if (marks) {
      // Markers live in the region entry beside the pixels, so the same
      // eviction drops both and one can never outlive the other.
      for (const c of drawableRegions()) {
        for (const mk of [...c.r.mk.values()].flat()) {
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
  }, [shown, bounds, heat, cell, showHeat, view, vp, dim, heads, world, marks, markKind, tick2, drawableRegions,
    areas, showAreas, pinned, picking, picked])

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
  // Bound once, so the handlers read the current values through refs rather
  // than closing over a render's copy.
  const pickingRef = useRef(false)
  pickingRef.current = picking
  const areasOnRef = useRef(true)
  areasOnRef.current = showAreas
  const pickChunkRef = useRef<((cx: number, cz: number) => void) | null>(null)
  const pickChunk = useCallback(
    (cx: number, cz: number): void => {
      setPicked((cur) => {
        const has = cur.some((r) => cx >= r.x1 && cx <= r.x2 && cz >= r.z1 && cz <= r.z2)
        // Splits the rectangle around the chunk rather than dropping it: rects
        // are merged on the way in, so the one under the pointer usually covers
        // dozens of others.
        return has
          ? subtractChunk(cur, cx, cz)
          : normalizeRects([...cur, { x1: cx, z1: cz, x2: cx, z2: cz }])
      })
    },
    []
  )
  pickChunkRef.current = pickChunk
  const areaAtRef = useRef<(cx: number, cz: number) => ChunkArea | undefined>(() => undefined)
  areaAtRef.current = (cx, cz) => areaAt(areas, cx, cz, dim)
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

    // ---- touch ----
    //
    // Same reason these are bound by hand: React's touch listeners are passive
    // too, so `preventDefault` in an `onTouchMove` prop does nothing and the
    // page scrolls instead of the map panning. The CSS `touchAction: none` on
    // the canvas is the other half — without it the browser claims the gesture
    // before any listener runs.
    //
    // One finger pans; two pinch, which is the only zoom a touch screen has.
    let pan: { x: number; y: number } | null = null
    let pinch: number | null = null
    const dist = (t: TouchList): number =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const mid = (t: TouchList): { x: number; y: number } => {
      const r = cv.getBoundingClientRect()
      return {
        x: (t[0].clientX + t[1].clientX) / 2 - r.left,
        y: (t[0].clientY + t[1].clientY) / 2 - r.top
      }
    }
    const onStart = (e: TouchEvent): void => {
      if (!viewRef.current) return
      if (e.touches.length === 1) {
        pan = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        pinch = null
        downAt.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      } else if (e.touches.length === 2) {
        pan = null
        pinch = dist(e.touches)
      }
      e.preventDefault()
    }
    const onMove = (e: TouchEvent): void => {
      const v = viewRef.current
      if (!v) return
      if (e.touches.length === 1 && pan) {
        setView(panBy(v, e.touches[0].clientX - pan.x, e.touches[0].clientY - pan.y))
        pan = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      } else if (e.touches.length === 2 && pinch) {
        const d = dist(e.touches)
        if (pinch > 0) {
          setView(zoomAt(v, vpRef.current, mid(e.touches), d / pinch))
          pinch = d
        }
      }
      e.preventDefault()
    }
    const onEnd = (e: TouchEvent): void => {
      // A finger that lifted without travelling is a tap, and a tap is the only
      // way to read an area's note on a phone — there is no hover.
      const v = viewRef.current
      const t = e.changedTouches[0]
      const d0 = downAt.current
      if (!e.touches.length && pan && v && t && d0 &&
          Math.abs(t.clientX - d0.x) <= 6 && Math.abs(t.clientY - d0.y) <= 6) {
        const r = cv.getBoundingClientRect()
        const local = { x: t.clientX - r.left, y: t.clientY - r.top }
        const w = screenToWorld(local, v, vpRef.current)
        const c = chunkOf(w.x, w.z)
        setTipAt(local)
        if (pickingRef.current) pickChunkRef.current?.(c.cx, c.cz)
        else if (areasOnRef.current) setPinned(areaAtRef.current(c.cx, c.cz) ?? null)
      }
      if (!e.touches.length) {
        pan = null
        pinch = null
      }
    }
    cv.addEventListener('touchstart', onStart, { passive: false })
    cv.addEventListener('touchmove', onMove, { passive: false })
    cv.addEventListener('touchend', onEnd, { passive: false })
    return () => {
      cv.removeEventListener('wheel', onWheel)
      cv.removeEventListener('touchstart', onStart)
      cv.removeEventListener('touchmove', onMove)
      cv.removeEventListener('touchend', onEnd)
    }
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
        <button className={`btn sm ${showAreas ? 'primary' : ''}`} onClick={() => setShowAreas((v) => !v)}>
          <Shapes size={13} /> {t('map.areas')}
        </button>
        <button
          className={`btn sm ${showAreaCard ? 'primary' : ''}`}
          onClick={() => {
            const next = !showAreaCard
            setShowAreaCard(next)
            // Editing implies looking. Opening the editor over a map that is not
            // drawing areas would be picking chunks against an invisible shape.
            if (next) setShowAreas(true)
            else {
              setEditing(null)
              setPicking(false)
              setPicked([])
            }
          }}
        >
          {t('map.areaEdit')}
        </button>
        <button className={`btn sm ${showPerf ? 'primary' : ''}`} onClick={() => setShowPerf((v) => !v)}>
          <Gauge size={13} /> {t('map.performance')}
        </button>
      </div>

      {/* Open only when asked for: the map is for looking at, and a permanently
          visible editing panel takes a third of it. Drawing areas and EDITING
          them are two decisions — the web panel keeps them apart the same way. */}
      {showAreaCard && (
        <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 13 }}>{t('map.areas')}</b>
            <span className="dim" style={{ fontSize: 12 }}>
              {t('map.areasCount', { n: areasFor(areas, dim).length, dim })}
            </span>
            <div style={{ flex: 1 }} />
            <button
              className="btn sm"
              onClick={() => {
                setEditing('new')
                setPicked([])
                setPicking(true)
              }}
            >
              <Plus size={13} /> {t('map.areaNew')}
            </button>
          </div>

          {areasFor(areas, dim).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {areasFor(areas, dim).map((a) => (
                <button
                  key={a.id}
                  className="btn sm"
                  style={{ borderColor: a.colour, opacity: a.hidden ? 0.55 : 1 }}
                  title={a.note || undefined}
                  onClick={() => {
                    setEditing(a)
                    setPicked(a.rects)
                    setPicking(false)
                    // Jump to it. An area listed but off-screen is a name with
                    // nowhere to look, and its chunks are the only clue where.
                    if (view && a.rects.length) {
                      const r = a.rects[0]
                      setView({ cx: (r.x1 + r.x2 + 1) * 8, cz: (r.z1 + r.z2 + 1) * 8, scale: view.scale })
                    }
                  }}
                >
                  <span
                    style={{
                      width: 9, height: 9, borderRadius: 3, background: a.colour,
                      display: 'inline-block', marginRight: 6
                    }}
                  />
                  {a.name}
                  {a.hidden ? ' ·' : ''}
                </button>
              ))}
            </div>
          )}

          {editing && (
            <AreaEditor
              key={editing === 'new' ? 'new' : editing.id}
              area={editing === 'new' ? null : editing}
              dim={dim}
              picking={picking}
              picked={picked}
              onPickingChange={setPicking}
              onPickedChange={setPicked}
              onClose={() => {
                setEditing(null)
                setPicking(false)
                setPicked([])
              }}
              onSave={async (input) => {
                await window.msms.saveChunkArea(serverId, {
                  ...input,
                  ...(editing === 'new' ? {} : { areaId: editing.id })
                })
                reloadAreas()
                setEditing(null)
                setPicking(false)
                setPicked([])
              }}
              onDelete={
                editing === 'new'
                  ? undefined
                  : async () => {
                      await window.msms.deleteChunkArea(serverId, editing.id)
                      reloadAreas()
                      setEditing(null)
                      setPicking(false)
                      setPicked([])
                    }
              }
            />
          )}
        </div>
      )}

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
          // Without this the browser takes a drag as a page scroll before the
          // touch listeners run, and preventDefault has nothing left to stop.
          style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
          onMouseDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY }
            downAt.current = { x: e.clientX, y: e.clientY }
            e.preventDefault()
          }}
          onMouseUp={() => (drag.current = null)}
          onClick={(e) => {
            if (!view) return
            // Distance, not a flag: every click carries a mousedown, and a pan
            // that happens to end inside an area must not select or pin it.
            const d0 = downAt.current
            if (d0 && (Math.abs(e.clientX - d0.x) > 4 || Math.abs(e.clientY - d0.y) > 4)) return
            const w = screenToWorld(localPoint(e), view, vp)
            const c = chunkOf(w.x, w.z)
            setTipAt(localPoint(e))
            if (picking) {
              // Click a chunk to add it, click it again to take it back — the
              // only way to undo a misclick without starting the selection over.
              pickChunk(c.cx, c.cz)
              return
            }
            if (showAreas) setPinned(areaAt(areas, c.cx, c.cz, dim) ?? null)
          }}
          onMouseLeave={() => {
            drag.current = null
            setCursor(null)
            setTipAt(null)
          }}
          onMouseMove={(e) => {
            if (!view) return
            if (drag.current) {
              setView(panBy(view, e.clientX - drag.current.x, e.clientY - drag.current.y))
              drag.current = { x: e.clientX, y: e.clientY }
              return
            }
            setCursor(screenToWorld(localPoint(e), view, vp))
            setTipAt(localPoint(e))
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
            {picking && (
              <>
                {' · '}
                {t('map.chunkAt', { cx: chunkOf(cursor.x, cursor.z).cx, cz: chunkOf(cursor.x, cursor.z).cz })}
              </>
            )}
          </div>
        )}
        {/* Hovering names the area; clicking keeps the name up. Both, because a
            tooltip that only follows the pointer cannot be read on a touchpad
            while reaching for a button. */}
        {showAreas &&
          (() => {
            const hover =
              pinned ?? (cursor ? areaAt(areas, chunkOf(cursor.x, cursor.z).cx, chunkOf(cursor.x, cursor.z).cz, dim) : undefined)
            if (!hover) return null
            return (
              <div
                style={{
                  position: 'absolute',
                  // At the pointer rather than in a corner: a note pinned to the
                  // bottom-right is nowhere near the area it describes, and on a
                  // touch screen it sat under the thumb that opened it. Clamped,
                  // because anchored near an edge it would hang off the side.
                  ...(tipAt
                    ? {
                        left: Math.max(6, Math.min(tipAt.x + 14, vp.width - 256)),
                        top: tipAt.y - 84 < 6 ? tipAt.y + 16 : tipAt.y - 84
                      }
                    : { right: 10, bottom: 10 }),
                  maxWidth: 250,
                  padding: '8px 11px', borderRadius: 10, fontSize: 12.5, lineHeight: 1.4,
                  background: 'rgba(0,0,0,.78)', color: '#fff',
                  border: '1px solid rgba(255,255,255,.16)',
                  pointerEvents: pinned ? 'auto' : 'none'
                }}
              >
                <b style={{ display: 'block', fontSize: 13, color: hover.colour }}>{hover.name}</b>
                {hover.note && <div style={{ opacity: 0.85 }}>{hover.note}</div>}
                {pinned && (
                  <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setPinned(null)}>
                    <X size={11} /> {t('common.close')}
                  </button>
                )}
              </div>
            )
          })()}
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

/**
 * Create or edit one area.
 *
 * Two ways in, because they suit different jobs: clicking chunks on the map is
 * how you draw the shape of a town you can see, and typing coordinates is how
 * you enter the four hundred chunks somebody sent you in a message. They edit
 * the same selection, so switching between them mid-edit loses nothing.
 *
 * Validation is `checkArea`, the same function the HTTP route calls. A form that
 * decides for itself what is acceptable is a form that eventually disagrees with
 * the server, and the operator is the one who finds out.
 */
function AreaEditor({
  area,
  dim,
  picking,
  picked,
  onPickingChange,
  onPickedChange,
  onClose,
  onSave,
  onDelete
}: {
  area: ChunkArea | null
  dim: string
  picking: boolean
  picked: ChunkRect[]
  onPickingChange: (v: boolean) => void
  onPickedChange: (r: ChunkRect[]) => void
  onClose: () => void
  onSave: (input: {
    name: string
    note: string
    colour: string
    dim: string
    rects: ChunkRect[]
    hidden: boolean
  }) => Promise<void>
  onDelete?: () => Promise<void>
}): JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState(area?.name ?? '')
  const [note, setNote] = useState(area?.note ?? '')
  const [colour, setColour] = useState(area?.colour ?? AREA_COLOURS[0])
  const [hidden, setHidden] = useState(!!area?.hidden)
  const [typed, setTyped] = useState('')
  const [bad, setBad] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The area belongs to the dimension being viewed. Editing one from a different
  // dimension keeps its own, so opening the nether does not silently move a town.
  const targetDim = area?.dim ?? dim
  const check = checkArea({ name, note, colour, dim: targetDim, rects: picked, hidden })

  const applyTyped = (): void => {
    const parsed = parseChunkInput(typed)
    setBad(parsed.bad)
    // Added to the selection rather than replacing it: typing is often how you
    // finish a shape you started by clicking.
    onPickedChange(normalizeRects([...picked, ...parsed.rects]))
    setTyped('')
  }

  return (
    <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          style={{ flex: '1 1 160px' }}
          placeholder={t('map.areaName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {AREA_COLOURS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => setColour(c)}
              style={{
                width: 22, height: 22, borderRadius: 6, background: c, cursor: 'pointer',
                border: colour === c ? '2px solid #fff' : '1px solid rgba(0,0,0,.35)'
              }}
            />
          ))}
        </div>
      </div>
      <input
        className="input"
        placeholder={t('map.areaNote')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          className={`btn sm ${picking ? 'primary' : ''}`}
          onClick={() => onPickingChange(!picking)}
        >
          {picking ? t('map.areaPickingOn') : t('map.areaPick')}
        </button>
        <span className="dim" style={{ fontSize: 12 }}>
          {t('map.areaChunks', { n: areaChunkCount({ rects: picked }), r: picked.length })}
        </span>
        {picked.length > 0 && (
          <button className="btn sm" onClick={() => onPickedChange([])}>
            {t('map.areaClear')}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          {t('map.areaHidden')}
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: '1 1 220px', fontFamily: 'ui-monospace,monospace', fontSize: 12 }}
          placeholder={t('map.areaTypePlaceholder')}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyTyped()
          }}
        />
        <button className="btn sm" onClick={applyTyped} disabled={!typed.trim()}>
          {t('map.areaTypeAdd')}
        </button>
      </div>
      {bad.length > 0 && (
        <p className="hint" style={{ margin: 0, color: 'var(--warn,#f0b429)' }}>
          {t('map.areaBadLines', { lines: bad.join(', ') })}
        </p>
      )}
      {/* The refusal the server would give, shown before the request rather than
          after it — `checkArea` is the same function on both sides. */}
      {!check.ok && (name || picked.length > 0) && (
        <p className="hint" style={{ margin: 0 }}>{t('map.areaErr_' + check.error)}</p>
      )}
      {error && <p className="hint" style={{ margin: 0, color: 'var(--danger,#e5484d)' }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn sm primary"
          disabled={!check.ok || busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void onSave({ name, note, colour, dim: targetDim, rects: picked, hidden })
              .catch((e: unknown) => setError(String(e)))
              .finally(() => setBusy(false))
          }}
        >
          <Check size={13} /> {area ? t('common.save') : t('map.areaCreate')}
        </button>
        <button className="btn sm" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <div style={{ flex: 1 }} />
        {onDelete && (
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void onDelete().catch((e: unknown) => setError(String(e))).finally(() => setBusy(false))
            }}
          >
            <Trash2 size={13} /> {t('common.delete')}
          </button>
        )}
      </div>
    </div>
  )
}
