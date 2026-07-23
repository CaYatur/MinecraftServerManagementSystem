import { useTranslation } from 'react-i18next'
import { AlertTriangle, Info, XCircle, CheckCircle2, Stethoscope } from 'lucide-react'
import type { Finding, FindingCode, FindingSeverity } from '@shared/analysis'

/** i18n keys per code — dots inside a code would be read as nesting. */
const TEXT: Record<FindingCode, string> = {
  'insufficient-data': 'analysis.insufficientData',
  'tps-unavailable': 'analysis.tpsUnavailable',
  'chronic-lag': 'analysis.chronicLag',
  'lag-with-players': 'analysis.lagWithPlayers',
  'cpu-saturated': 'analysis.cpuSaturated',
  'memory-over-allocated': 'analysis.memoryOverAllocated',
  'frequent-crashes': 'analysis.frequentCrashes',
  'no-backups': 'analysis.noBackups',
  'aikars-flags': 'analysis.aikarsFlags',
  healthy: 'analysis.healthy'
}

const ICON: Record<FindingSeverity, JSX.Element> = {
  error: <XCircle size={15} />,
  warn: <AlertTriangle size={15} />,
  info: <Info size={15} />
}

const CLASS: Record<FindingSeverity, string> = {
  error: 'ev-error',
  warn: 'ev-warn',
  info: 'ev-info'
}

export function Analysis({ findings }: { findings: Finding[] }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        <Stethoscope size={14} style={{ verticalAlign: -2 }} /> {t('analysis.title')}
      </div>
      <div className="findings">
        {findings.map((f, i) => (
          <div key={`${f.code}-${i}`} className={`finding ${CLASS[f.severity]}`}>
            <span className="finding-icon">
              {f.code === 'healthy' ? <CheckCircle2 size={15} /> : ICON[f.severity]}
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="finding-text">{t(TEXT[f.code], { ...(f.data ?? {}) })}</div>
              <div className="finding-fix dim">{t(`${TEXT[f.code]}Fix`, { ...(f.data ?? {}) })}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
