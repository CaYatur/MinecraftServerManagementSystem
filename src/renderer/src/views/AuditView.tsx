import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollText, Search, Check, X, RefreshCw } from 'lucide-react'
import { AUDIT_SOURCES, type AuditPage, type AuditSource } from '@shared/audit'

/** Flat i18n keys for the common actions (dotted action strings would nest in
 *  i18next); anything unknown falls back to the raw action string. */
const ACTION_LABEL: Record<string, string> = {
  login: 'auditAct.login',
  'command.run': 'auditAct.command',
  'server.start': 'auditAct.start',
  'server.stop': 'auditAct.stop',
  'server.restart': 'auditAct.restart',
  'server.kill': 'auditAct.kill',
  'server.create': 'auditAct.create',
  'server.remove': 'auditAct.remove',
  'account.register': 'auditAct.register',
  purchase: 'auditAct.purchase'
}

const SRC_CLASS: Record<AuditSource, string> = {
  console: 'muted',
  panel: 'accent',
  webpanel: 'accent',
  public: 'warn',
  system: 'muted'
}

export function AuditView(): JSX.Element {
  const { t } = useTranslation()
  const [page, setPage] = useState<AuditPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [source, setSource] = useState<AuditSource | 'all'>('all')
  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState<'all' | 'ok' | 'fail'>('all')

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const p = await window.msms.queryAudit({
        ...(source !== 'all' ? { sources: [source] } : {}),
        ...(text.trim() ? { text: text.trim() } : {}),
        ...(outcome !== 'all' ? { ok: outcome === 'ok' } : {}),
        limit: 500
      })
      setPage(p)
    } finally {
      setLoading(false)
    }
  }, [source, text, outcome])

  // Debounce so typing in the search box doesn't fire a query per keystroke.
  useEffect(() => {
    const h = setTimeout(load, 200)
    return () => clearTimeout(h)
  }, [load])

  const fmt = (ts: number): string => new Date(ts).toLocaleString()
  const actionLabel = (a: string): string => (ACTION_LABEL[a] ? t(ACTION_LABEL[a]) : a)
  const srcLabel = (s: string): string => t(`audit.src.${s}`)
  const bySource = page?.bySource ?? {}

  return (
    <div>
      <div className="section-title">
        <ScrollText size={15} /> {t('audit.title')}
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <button
            className={`btn sm ${source === 'all' ? 'primary' : ''}`}
            onClick={() => setSource('all')}
          >
            {t('audit.all')}
          </button>
          {AUDIT_SOURCES.map((s) => (
            <button
              key={s}
              className={`btn sm ${source === s ? 'primary' : ''}`}
              onClick={() => setSource(s)}
            >
              {srcLabel(s)}
              {bySource[s] ? <span className="dim"> · {bySource[s]}</span> : null}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 10, alignItems: 'center' }}>
          <div className="row" style={{ gap: 6, alignItems: 'center', flex: 1, minWidth: 200 }}>
            <Search size={14} className="dim" />
            <input
              className="input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder={t('audit.search')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 4 }}>
            {(['all', 'ok', 'fail'] as const).map((o) => (
              <button
                key={o}
                className={`btn sm ${outcome === o ? 'primary' : ''}`}
                onClick={() => setOutcome(o)}
              >
                {t(`audit.${o === 'all' ? 'all' : o === 'ok' ? 'okOnly' : 'failOnly'}`)}
              </button>
            ))}
          </div>
          <button className="btn sm" onClick={() => void load()} title={t('audit.refresh')}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="dim" style={{ margin: '0 2px 8px', fontSize: 12 }}>
        {loading ? t('common.loading') : t('audit.results', { n: page?.total ?? 0 })}
      </div>

      {page && page.entries.length === 0 && !loading ? (
        <div className="panel" style={{ textAlign: 'center', padding: 26 }}>
          <p className="dim" style={{ margin: 0 }}>
            {t('audit.empty')}
          </p>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="audit-table">
            <thead>
              <tr>
                <th>{t('audit.when')}</th>
                <th>{t('audit.source')}</th>
                <th>{t('audit.action')}</th>
                <th>{t('audit.actor')}</th>
                <th>{t('audit.ip')}</th>
                <th>{t('audit.target')}</th>
                <th style={{ textAlign: 'center' }}>{t('audit.outcome')}</th>
              </tr>
            </thead>
            <tbody>
              {page?.entries.map((e) => (
                <tr key={e.id}>
                  <td className="dim" style={{ whiteSpace: 'nowrap' }}>{fmt(e.ts)}</td>
                  <td>
                    <span className={`audit-badge ${SRC_CLASS[e.source] ?? ''}`}>{srcLabel(e.source)}</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{actionLabel(e.action)}</td>
                  <td>{e.actor}</td>
                  <td className="dim mono">{e.ip ?? '—'}</td>
                  <td className="dim">{e.target ?? e.detail ?? (e.serverId ? e.serverId : '—')}</td>
                  <td style={{ textAlign: 'center' }}>
                    {e.ok ? (
                      <Check size={15} className="audit-ok" />
                    ) : (
                      <X size={15} className="audit-fail" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
