import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { CRATE_CSS } from '@shared/crateUi'
import { crateDuration, normalizeCrateAnimation } from '@shared/crate'
import type { CrateAnimation } from '@shared/crate'

/**
 * Plays a crate animation with placeholder rewards, without buying anything
 * (#75). Choosing an animation used to mean saving it, buying something on the
 * store, and watching what happened.
 *
 * The **CSS is the shared one** (`@shared/crateUi`), the same string the web
 * panel and the public website paste into their pages, injected here as a style
 * tag. That is what stops the preview from drifting away from the thing it
 * previews: the look lives in one place, and only the ~40 lines of motion
 * sequencing below are written twice — once in vanilla JS for the two HTML
 * pages, once in React here, because a `srcdoc` iframe would need inline script
 * and the packaged renderer runs under `script-src 'self'`.
 */

let styleInjected = false
function useCrateCss(): void {
  useLayoutEffect(() => {
    if (styleInjected) return
    styleInjected = true
    const el = document.createElement('style')
    el.dataset['msms'] = 'crate'
    el.textContent = CRATE_CSS
    document.head.appendChild(el)
  }, [])
}

interface Item {
  name: string
  icon?: string
}

const PLACEHOLDER: Item[] = [
  { name: 'Common' },
  { name: 'Uncommon' },
  { name: 'Rare' },
  { name: 'Legendary' }
]

function pick(pool: Item[], n: number): Item[] {
  return Array.from({ length: n }, () => pool[Math.floor(Math.random() * pool.length)])
}

export function CratePreview({
  animation,
  pool,
  onClose
}: {
  animation: CrateAnimation
  /** The crate's real rewards when it has any, so the preview shows real names. */
  pool?: Item[]
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  useCrateCss()
  const v = normalizeCrateAnimation(animation)
  const ms = crateDuration(v)
  const items = pool && pool.length ? pool : PLACEHOLDER
  const win = items[items.length - 1]

  const reelRef = useRef<HTMLDivElement>(null)
  const maskRef = useRef<HTMLDivElement>(null)
  const [strip, setStrip] = useState<Item[]>([])
  const [flipped, setFlipped] = useState(0)
  const [burst, setBurst] = useState<Item>(items[0])
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDone(false)
    setFlipped(0)
    const timers: ReturnType<typeof setTimeout>[] = []
    let iv: ReturnType<typeof setInterval> | undefined

    if (v === 'instant') {
      setStrip([win])
      setDone(true)
    } else if (v === 'burst') {
      let n = 0
      const shuffles = Math.max(1, Math.floor(ms / 220))
      setBurst(items[0])
      iv = setInterval(() => {
        n++
        if (n >= shuffles) {
          clearInterval(iv)
          setBurst(win)
          return
        }
        setBurst(items[Math.floor(Math.random() * items.length)])
      }, 200)
    } else if (v === 'flip') {
      const cards = [...pick(items, 3), win]
      setStrip(cards)
      cards.forEach((_, i) => timers.push(setTimeout(() => setFlipped(i + 1), (i * ms) / cards.length)))
    } else {
      const count = v === 'spin' ? 30 : 40
      const back = v === 'spin' ? 3 : 4
      const s = pick(items, count)
      s[count - back] = win
      setStrip(s)
    }
    timers.push(setTimeout(() => setDone(true), ms + 100))
    return () => {
      timers.forEach(clearTimeout)
      if (iv) clearInterval(iv)
    }
    // A fresh run per animation/pool change; `win` and `ms` derive from those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, ms, JSON.stringify(items)])

  // The scroll has to start from a laid-out strip, so it is kicked off after
  // paint rather than in the effect above — otherwise the element is measured
  // before it has a width and the reel lands nowhere near the marker.
  useLayoutEffect(() => {
    const reel = reelRef.current
    const mask = maskRef.current
    if (!reel || !mask || strip.length === 0) return
    if (v !== 'reel' && v !== 'spin') return
    const winIdx = strip.length - (v === 'spin' ? 3 : 4)
    const axis = v === 'spin' ? 'Y' : 'X'
    const offset =
      v === 'spin' ? winIdx * 84 - (mask.clientHeight / 2 - 38) : winIdx * 128 - (mask.clientWidth / 2 - 60)
    reel.style.transition = 'none'
    reel.style.transform = `translate${axis}(0)`
    const id = requestAnimationFrame(() => {
      reel.style.transition = `transform ${ms / 1000}s cubic-bezier(.12,.7,.2,1)`
      reel.style.transform = `translate${axis}(-${offset}px)`
    })
    return () => cancelAnimationFrame(id)
  }, [strip, v, ms])

  const cell = (it: Item, i: number, extra = ''): JSX.Element => (
    <div key={i} className={`reel-item ${extra}`.trim()}>
      {it.icon ? <img src={it.icon} alt="" /> : null}
      {it.name}
    </div>
  )

  return (
    <div className="crate-modal" onClick={onClose}>
      <div className="crate-box" onClick={(e) => e.stopPropagation()}>
        <div ref={maskRef} className={`reel-mask anim-${v}`}>
          <div
            ref={reelRef}
            className={`reel ${v === 'spin' ? 'reel-v' : v === 'flip' ? 'reel-flip' : v === 'burst' ? 'reel-burst' : ''}`.trim()}
          >
            {v === 'burst'
              ? cell(burst, 0, `burst-card ${done ? 'burst-win' : ''}`.trim())
              : strip.map((it, i) =>
                  cell(it, i, v === 'flip' ? `flip-card ${i < flipped ? 'flipped' : ''}`.trim() : '')
                )}
          </div>
          <div className="reel-marker" />
        </div>
        <div className={`crate-result ${done ? 'win' : ''}`.trim()}>{done ? win.name : ''}</div>
        <div className="crate-preview-note">{t('store.previewNote')}</div>
        <button className="btn primary" style={{ marginTop: 12 }} onClick={onClose}>
          <X size={14} /> {t('common.close')}
        </button>
      </div>
    </div>
  )
}
