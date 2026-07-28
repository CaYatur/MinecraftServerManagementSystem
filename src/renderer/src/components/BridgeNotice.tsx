import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Puzzle, Loader2 } from 'lucide-react'
import type { BridgeStatus } from '@shared/bridgeRelease'

/**
 * "This server is missing the Bridge plugin", wherever an operator might look.
 *
 * It used to live only in the live map's empty state (#103), which turned out to
 * be the one place it could not do its job: that state renders only when there
 * are no players to draw, so a server with people on it and no bridge showed an
 * empty-looking map, no explanation and no button. It also required visiting the
 * map at all — an operator who never opened that tab was never told that half
 * the features were switched off for want of a 6 KB jar.
 *
 * So it is a component, and it says what the jar unlocks rather than just naming
 * it. "Install MSMS-Bridge" is not a reason to click anything.
 */
export function BridgeNotice({ serverId }: { serverId: string }): JSX.Element | null {
  const { t } = useTranslation()
  const [status, setStatus] = useState<BridgeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      setStatus(await window.msms.bridgeStatus(serverId))
    } catch {
      setStatus(null)
    }
  }

  useEffect(() => {
    setMsg('')
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId])

  const install = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await window.msms.installBridge(serverId)
      // "Installed" is not "working": Bukkit loads plugins at startup, so the
      // jar does nothing until a restart. An operator watching a still-empty map
      // would otherwise read a successful install as a failed one.
      setMsg(
        r.ok
          ? t('map.bridgeInstalled', { version: r.version ?? '' })
          : t('map.bridgeFailed', { error: r.error ?? '' })
      )
      await refresh()
    } catch (e) {
      setMsg(t('map.bridgeFailed', { error: String(e) }))
    } finally {
      setBusy(false)
    }
  }

  // Nothing to say: the type cannot run it, it is already current, or there is
  // no jar anywhere to offer. A permanent banner nobody can act on is noise.
  if (!status || (status.state !== 'missing' && status.state !== 'outdated')) return null
  if (!status.actionable) return null

  const outdated = status.state === 'outdated'
  return (
    <div className="panel bridge-notice">
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Puzzle size={16} className="dim" />
        <div style={{ flex: 1, minWidth: 200 }}>
          <b>{outdated ? t('map.bridgeOutdatedTitle') : t('bridge.missingTitle')}</b>
          <p className="hint" style={{ margin: '4px 0 0' }}>
            {outdated
              ? t('map.bridgeOutdated', { installed: status.installed ?? '', latest: status.latest ?? '' })
              : t('bridge.missingWhy')}
            {status.offline ? ' ' + t('bridge.offline') : ''}
          </p>
        </div>
        <button className="btn primary sm" disabled={busy} onClick={() => void install()}>
          {busy ? <Loader2 size={13} className="spin" /> : null}
          {busy ? t('map.installing') : t('map.installBridge', { version: status.latest ?? '' })}
        </button>
      </div>
      {msg && (
        <p className="hint" style={{ margin: '8px 0 0' }}>
          {msg}
        </p>
      )}
    </div>
  )
}
