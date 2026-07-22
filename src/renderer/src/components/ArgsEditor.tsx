import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Terminal } from 'lucide-react'
import { useStore } from '../store'
import type { JavaArgsConfig, JavaPreset, ServerConfig } from '@shared/types'

const PRESETS: JavaPreset[] = ['basic', 'aikars', 'aikars-large', 'proxy', 'custom']

export function ArgsEditor({ server }: { server: ServerConfig }): JSX.Element {
  const { t } = useTranslation()
  const updateServer = useStore((s) => s.updateServer)
  const toast = useStore((s) => s.toast)
  const [java, setJava] = useState<JavaArgsConfig>(server.java)
  const [preview, setPreview] = useState('')

  // Re-sync when switching servers.
  useEffect(() => setJava(server.java), [server.id, server.java])

  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      window.msms
        .previewArgs(java, server.type)
        .then((args) => alive && setPreview('java ' + args.join(' ')))
        .catch(() => {})
    }, 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [java, server.type])

  const set = <K extends keyof JavaArgsConfig>(k: K, v: JavaArgsConfig[K]): void =>
    setJava((prev) => ({ ...prev, [k]: v }))

  const save = async (): Promise<void> => {
    await updateServer(server.id, { java })
    toast('success', 'common.saved')
  }

  return (
    <div className="panel" style={{ maxWidth: '100%' }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        <Terminal size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('args.title')}
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field" style={{ minWidth: 170, marginBottom: 8 }}>
          <label>{t('args.preset')}</label>
          <select
            className="select"
            value={java.preset}
            onChange={(e) => set('preset', e.target.value as JavaPreset)}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        {java.preset !== 'custom' && (
          <>
            <div className="field" style={{ width: 150, marginBottom: 8 }}>
              <label>{t('args.maxMemory')}</label>
              <input
                className="input"
                type="number"
                value={java.maxMemoryMB}
                onChange={(e) => set('maxMemoryMB', Number(e.target.value))}
              />
            </div>
            <div className="field" style={{ width: 150, marginBottom: 8 }}>
              <label>{t('args.minMemory')}</label>
              <input
                className="input"
                type="number"
                value={java.minMemoryMB}
                onChange={(e) => set('minMemoryMB', Number(e.target.value))}
              />
            </div>
          </>
        )}
      </div>

      {java.preset !== 'custom' ? (
        <div className="row wrap" style={{ gap: 10 }}>
          {!java.argsFile && (
            <div className="field" style={{ minWidth: 180, marginBottom: 8 }}>
              <label>{t('args.jarFile')}</label>
              <input
                className="input"
                value={java.jarFile}
                onChange={(e) => set('jarFile', e.target.value)}
              />
            </div>
          )}
          <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 8 }}>
            <label>{t('args.extraFlags')}</label>
            <input
              className="input mono"
              value={java.extraFlags}
              onChange={(e) => set('extraFlags', e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="field" style={{ marginBottom: 8 }}>
          <label>{t('args.customArgs')}</label>
          <textarea
            className="input"
            style={{ minHeight: 90 }}
            value={java.customArgs}
            onChange={(e) => set('customArgs', e.target.value)}
          />
        </div>
      )}

      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 8 }}>
          <label>{t('args.javaPath')}</label>
          <input
            className="input"
            value={java.javaPath}
            placeholder={t('settings.javaAuto')}
            onChange={(e) => set('javaPath', e.target.value)}
          />
        </div>
        <label className="switch" style={{ marginTop: 24 }}>
          <input
            type="checkbox"
            checked={java.nogui}
            onChange={(e) => set('nogui', e.target.checked)}
          />
          {t('args.nogui')}
        </label>
      </div>

      <label style={{ fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 550 }}>
        {t('args.preview')}
      </label>
      <pre className="log-tail" style={{ maxHeight: 140, marginTop: 6 }}>
        {preview}
      </pre>

      <button className="btn primary" onClick={save}>
        <Check size={14} /> {t('common.save')}
      </button>
    </div>
  )
}
