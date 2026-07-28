import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Map as MapIcon, Flame } from 'lucide-react'
import { heatmap, mapBounds } from '@shared/livemap'
import type { LivePlayer } from '@shared/livemap'
import type { BridgeStatus } from '@shared/bridgeRelease'

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

export function LiveMap({ serverId }: { serverId: string }): JSX.Element {
  const { t } = useTranslation()
  const [players, setPlayers] = useState<LivePlayer[]>([])
  const [bridge, setBridge] = useState(false)
  const [dim, setDim] = useState('overworld')
  const [cell, setCell] = useState(16)
  const [showHeat, setShowHeat] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Bridge install (#103). Checked once rather than on the 2s position poll:
  // the answer changes when someone installs a jar, not twice a second, and the
  // check reaches GitHub.
  const [bridgeState, setBridgeState] = useState<BridgeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [installMsg, setInstallMsg] = useState('')

  const refreshBridge = async (): Promise<void> => {
    try {
      setBridgeState(await window.msms.bridgeStatus(serverId))
    } catch {
      setBridgeState(null)
    }
  }
  useEffect(() => {
    void refreshBridge()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  const install = async (): Promise<void> => {
    setBusy(true)
    setInstallMsg('')
    try {
      const r = await window.msms.installBridge(serverId)
      // "Installed" is not "working": Bukkit loads plugins at startup, so the
      // jar does nothing until the server is restarted. Saying so here saves the
      // operator watching a map that is still empty and concluding it failed.
      setInstallMsg(
        r.ok ? t('map.bridgeInstalled', { version: r.version ?? '' }) : t('map.bridgeFailed', { error: r.error ?? '' })
      )
      await refreshBridge()
    } catch (e) {
      setInstallMsg(t('map.bridgeFailed', { error: String(e) }))
    } finally {
      setBusy(false)
    }
  }

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
    const g = cv.getContext('2d')
    if (!g) return
    g.clearRect(0, 0, w, h)

    const spanX = bounds.maxX - bounds.minX || 1
    const spanZ = bounds.maxZ - bounds.minZ || 1
    const px = (x: number): number => ((x - bounds.minX) / spanX) * w
    const pz = (z: number): number => ((z - bounds.minZ) / spanZ) * h

    g.strokeStyle = 'rgba(255,255,255,.06)'
    g.lineWidth = dpr
    for (let gx = Math.ceil(bounds.minX / 64) * 64; gx <= bounds.maxX; gx += 64) {
      g.beginPath()
      g.moveTo(px(gx), 0)
      g.lineTo(px(gx), h)
      g.stroke()
    }
    for (let gz = Math.ceil(bounds.minZ / 64) * 64; gz <= bounds.maxZ; gz += 64) {
      g.beginPath()
      g.moveTo(0, pz(gz))
      g.lineTo(w, pz(gz))
      g.stroke()
    }
    // The origin, when it is in view — the one landmark every player shares.
    if (bounds.minX <= 0 && bounds.maxX >= 0 && bounds.minZ <= 0 && bounds.maxZ >= 0) {
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
      const cw = (cell / spanX) * w
      const ch = (cell / spanZ) * h
      for (const c of heat) {
        g.fillStyle = `rgba(220,39,39,${(0.12 + 0.55 * (c.count / max)).toFixed(3)})`
        g.fillRect(px(c.x), pz(c.z), Math.max(2 * dpr, cw), Math.max(2 * dpr, ch))
      }
    }

    g.font = `${11 * dpr}px Inter, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'bottom'
    for (const p of shown) {
      const x = px(p.x)
      const y = pz(p.z)
      g.beginPath()
      g.arc(x, y, 4.5 * dpr, 0, Math.PI * 2)
      g.fillStyle = '#4ade80'
      g.fill()
      g.lineWidth = 1.5 * dpr
      g.strokeStyle = 'rgba(0,0,0,.55)'
      g.stroke()
      g.fillStyle = 'rgba(255,255,255,.92)'
      g.fillText(p.name, x, y - 7 * dpr)
    }
  }, [shown, bounds, heat, cell, showHeat])

  return (
    <div>
      <div className="row wrap" style={{ gap: 10, alignItems: 'center', marginBottom: 10 }}>
        <span className="badge">
          <span className={`dot ${bridge ? 'running' : 'stopped'}`} />
          {bridge ? t('map.live') : t('map.noBridge')}
        </span>
        {/* An update is offered where the plugin is running, not in the empty
            state — an outdated bridge still reports positions, so the map is
            not empty and the operator would never see the message there. */}
        {bridgeState?.state === 'outdated' && (
          <button className="btn sm" disabled={busy} onClick={() => void install()}>
            {busy
              ? t('map.installing')
              : t('map.bridgeOutdated', {
                  installed: bridgeState.installed ?? '',
                  latest: bridgeState.latest ?? ''
                })}
          </button>
        )}
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
      </div>

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
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        {shown.length === 0 && (
          <div
            className="center-fill"
            style={{ position: 'absolute', inset: 0, textAlign: 'center', padding: 20 }}
          >
            <MapIcon size={26} className="dim" />
            <p className="hint" style={{ maxWidth: 380 }}>
              {bridge ? t('map.emptyDimension') : t('map.needsBridge')}
            </p>
            {/* The warning sits here, next to the feature it disables, rather
                than in a global banner — this is where someone finds out the
                map is empty, and it is the only place the answer helps. */}
            {!bridge && bridgeState?.state === 'missing' && bridgeState.actionable && (
              <button className="btn primary" disabled={busy} onClick={() => void install()}>
                {busy
                  ? t('map.installing')
                  : t('map.installBridge', { version: bridgeState.latest ?? '' })}
              </button>
            )}
            {!bridge && bridgeState?.state === 'unsupported' && (
              <p className="hint dim" style={{ maxWidth: 380 }}>
                {t('map.bridgeUnsupported')}
              </p>
            )}
            {installMsg && (
              <p className="hint" style={{ maxWidth: 380 }}>
                {installMsg}
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
          {shown.map((p) => (
            <span key={p.name} className="badge">
              {p.name}{' '}
              <span className="dim">
                {p.x}, {p.y}, {p.z}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
