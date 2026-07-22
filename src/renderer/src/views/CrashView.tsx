import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bug, AlertTriangle, AlertCircle, Info, Loader2, Lightbulb } from 'lucide-react'
import { useStore } from '../store'
import type { CrashReport, CrashFinding } from '@shared/types'

function icon(sev: CrashFinding['severity']): JSX.Element {
  if (sev === 'error') return <AlertCircle size={16} style={{ color: 'var(--danger)' }} />
  if (sev === 'warning') return <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />
  return <Info size={16} style={{ color: 'var(--info)' }} />
}

export function CrashView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const [report, setReport] = useState<CrashReport | null>(null)
  const [loading, setLoading] = useState(false)

  const analyze = async (): Promise<void> => {
    setLoading(true)
    try {
      setReport(await window.msms.analyzeCrash(id))
    } catch {
      setReport(null)
    }
    setLoading(false)
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="row" style={{ marginBottom: 16, gap: 10 }}>
        <button className="btn primary" onClick={analyze} disabled={loading}>
          {loading ? <Loader2 size={15} className="spin" /> : <Bug size={15} />}
          {loading ? t('crash.analyzing') : t('crash.analyze')}
        </button>
        {report && <span className="badge mono">{t('crash.source')}: {report.source}</span>}
      </div>

      {report && (
        <>
          {report.findings.length === 0 ? (
            <div className="panel" style={{ marginBottom: 16 }}>
              <p className="dim" style={{ margin: 0 }}>{t('crash.noIssues')}</p>
            </div>
          ) : (
            report.findings.map((f, i) => (
              <div key={i} className="panel" style={{ marginBottom: 12, padding: 14 }}>
                <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                  {icon(f.severity)}
                  <strong>{f.title}</strong>
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
                  {f.detail}
                </div>
                <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                  <Lightbulb size={14} style={{ color: 'var(--accent)', marginTop: 2 }} />
                  <span style={{ fontSize: 13 }}>{f.suggestion}</span>
                </div>
              </div>
            ))
          )}

          <div className="section-title">{t('crash.logTail')}</div>
          <pre className="log-tail">{report.logTail || '—'}</pre>
        </>
      )}
    </div>
  )
}
