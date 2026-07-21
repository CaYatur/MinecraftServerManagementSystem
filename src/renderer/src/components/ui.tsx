import { useTranslation } from 'react-i18next'
import type { ServerStatus, ServerType } from '@shared/types'

export function StatusDot({ status }: { status: ServerStatus }): JSX.Element {
  return <span className={`dot ${status}`} title={status} />
}

export function StatusBadge({ status }: { status: ServerStatus }): JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="badge">
      <StatusDot status={status} />
      {t(`status.${status}`)}
    </span>
  )
}

export function TypeBadge({ type }: { type: ServerType }): JSX.Element {
  const { t } = useTranslation()
  return <span className="badge type-badge">{t(`types.${type}`)}</span>
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d) return `${d}d ${h}h ${m}m`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`
}
