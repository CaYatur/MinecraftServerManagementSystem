import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, X, ImageOff } from 'lucide-react'
import { isSafeImageSrc } from '@shared/storefront'

/**
 * A picture chosen either by pasting a URL or by uploading a file, with a live
 * thumbnail of exactly what buyers will see (#76).
 *
 * Uploads land in the same folder the website's CMS uses, and are referred to
 * as `/uploads/<name>` — the form the public site and web panel serve them at.
 * The desktop app cannot load that path (there is no HTTP server involved when
 * the listener is off, and the packaged renderer's CSP would block it anyway),
 * so previews go through the `msms-img://` scheme that already exists for the
 * CMS. One stored value, two ways of reading it, rather than two stored values
 * that can disagree.
 */
export function previewSrc(src: string | undefined): string {
  const v = (src ?? '').trim()
  if (!v) return ''
  if (v.startsWith('/uploads/')) {
    return `msms-img://upload/${encodeURIComponent(v.slice('/uploads/'.length))}`
  }
  return v
}

export function ImageField({
  value,
  onChange,
  label,
  compact
}: {
  value: string | undefined
  onChange: (next: string) => void
  label?: string
  /** Inline variant for a reward row, where a full field would dominate. */
  compact?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const [broken, setBroken] = useState(false)
  const v = (value ?? '').trim()
  // Warn rather than block: the operator is mid-typing, and a field that
  // refuses input while you are halfway through a URL is worse than one that
  // tells you the value will not be kept. The save path drops it either way.
  const unsafe = !!v && !isSafeImageSrc(v)
  const src = previewSrc(v)

  return (
    <div className="field" style={{ marginBottom: compact ? 0 : undefined }}>
      {label && <label>{label}</label>}
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <div
          style={{
            width: compact ? 34 : 48,
            height: compact ? 34 : 48,
            flex: 'none',
            borderRadius: 9,
            border: '1px solid var(--border)',
            background: 'var(--elev)',
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden'
          }}
          title={v || t('store.noImage')}
        >
          {src && !broken ? (
            <img
              src={src}
              alt=""
              onError={() => setBroken(true)}
              style={{ width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated' }}
            />
          ) : (
            <ImageOff size={compact ? 14 : 18} className="dim" />
          )}
        </div>
        <input
          className="input"
          style={{ flex: 1, minWidth: 90 }}
          value={v}
          placeholder="https://… or /uploads/…"
          onChange={(e) => {
            setBroken(false)
            onChange(e.target.value)
          }}
        />
        <button
          className="btn sm"
          title={t('store.uploadImage')}
          onClick={async () => {
            // Same picker the CMS uses; the file lands in the shared uploads
            // folder and is referenced by the path the web serves it at.
            const name = await window.msms.uploadSiteImage()
            if (!name) return
            setBroken(false)
            onChange(`/uploads/${name}`)
          }}
        >
          <Upload size={13} /> {compact ? '' : t('store.uploadImage')}
        </button>
        {v && (
          <button className="btn ghost sm" title={t('common.clear')} onClick={() => onChange('')}>
            <X size={13} />
          </button>
        )}
      </div>
      {unsafe && (
        <p className="hint" style={{ color: 'var(--warning)', marginBottom: 0 }}>
          {t('store.unsafeImage')}
        </p>
      )}
      {broken && !unsafe && (
        <p className="hint" style={{ marginBottom: 0 }}>{t('store.imageBroken')}</p>
      )}
    </div>
  )
}
