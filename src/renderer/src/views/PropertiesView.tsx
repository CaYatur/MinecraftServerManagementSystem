import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Save, Search } from 'lucide-react'
import { useStore } from '../store'
import { PROPERTY_META, PROP_CATEGORIES, PROP_META_MAP } from '@shared/serverProperties'
import type { PropCategory } from '@shared/serverProperties'

export function PropertiesView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const toast = useStore((s) => s.toast)

  const [initial, setInitial] = useState<Record<string, string>>({})
  const [values, setValues] = useState<Record<string, string>>({})
  const [otherKeys, setOtherKeys] = useState<string[]>([])
  const [raw, setRaw] = useState('')
  const [tab, setTab] = useState<'form' | 'raw'>('form')
  const [search, setSearch] = useState('')
  const [hasFile, setHasFile] = useState(true)

  const load = async (): Promise<void> => {
    const data = await window.msms.readProperties(id)
    const map: Record<string, string> = {}
    data.entries.forEach((e) => (map[e.key] = e.value))
    setInitial(map)
    setValues(map)
    setOtherKeys(data.entries.map((e) => e.key).filter((k) => !PROP_META_MAP[k]))
    setRaw(data.raw)
    setHasFile(data.raw.length > 0)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const set = (k: string, v: string): void => setValues((prev) => ({ ...prev, [k]: v }))

  const saveForm = async (): Promise<void> => {
    const updates: Record<string, string> = {}
    for (const k of Object.keys(values)) {
      if (values[k] !== (initial[k] ?? '')) updates[k] = values[k]
    }
    if (Object.keys(updates).length === 0) return
    await window.msms.writeProperties(id, updates)
    setInitial({ ...initial, ...updates })
    toast('success', 'toast.saved')
    void load()
  }

  const saveRaw = async (): Promise<void> => {
    await window.msms.writeRawProperties(id, raw)
    toast('success', 'props.savedRaw')
    void load()
  }

  const q = search.toLowerCase()
  const dirty = useMemo(
    () => Object.keys(values).some((k) => values[k] !== (initial[k] ?? '')),
    [values, initial]
  )

  const renderControl = (key: string): JSX.Element => {
    const meta = PROP_META_MAP[key]
    const value = values[key] ?? ''
    if (meta?.type === 'bool') {
      return (
        <label className="switch">
          <input
            type="checkbox"
            checked={value === 'true'}
            onChange={(e) => set(key, e.target.checked ? 'true' : 'false')}
          />
          {value === 'true' ? 'true' : 'false'}
        </label>
      )
    }
    if (meta?.type === 'enum') {
      return (
        <select className="select" value={value} onChange={(e) => set(key, e.target.value)}>
          {!meta.options?.includes(value) && <option value={value}>{value || '—'}</option>}
          {meta.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )
    }
    return (
      <input
        className="input"
        type={meta?.type === 'int' ? 'number' : 'text'}
        value={value}
        onChange={(e) => set(key, e.target.value)}
      />
    )
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="tabs" style={{ border: 'none', padding: 0 }}>
          <button className={`tab ${tab === 'form' ? 'active' : ''}`} onClick={() => setTab('form')}>
            {t('props.form')}
          </button>
          <button className={`tab ${tab === 'raw' ? 'active' : ''}`} onClick={() => setTab('raw')}>
            {t('props.raw')}
          </button>
        </div>
        {tab === 'form' ? (
          <button className="btn primary sm" disabled={!dirty} onClick={saveForm}>
            <Save size={14} /> {t('common.save')}
          </button>
        ) : (
          <button className="btn primary sm" onClick={saveRaw}>
            <Save size={14} /> {t('common.save')}
          </button>
        )}
      </div>

      {!hasFile && <p className="hint">{t('props.noFile')}</p>}
      <p className="hint" style={{ marginTop: 0 }}>
        {t('props.restartHint')}
      </p>

      {tab === 'raw' ? (
        <textarea
          className="input"
          style={{ minHeight: 460, fontSize: 12.5 }}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <>
          <div className="field" style={{ position: 'relative' }}>
            <Search
              size={14}
              style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-faint)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder={t('props.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {PROP_CATEGORIES.map((cat: PropCategory) => {
            const props = PROPERTY_META.filter(
              (m) => m.category === cat && (!q || m.key.includes(q) || m.desc.toLowerCase().includes(q))
            )
            if (props.length === 0) return null
            return (
              <div key={cat}>
                <div className="section-title">{t(`props.cat.${cat}`)}</div>
                <div className="panel" style={{ padding: 12 }}>
                  {props.map((m) => (
                    <div key={m.key} className="prop-row">
                      <div className="prop-info">
                        <code>{m.key}</code>
                        <span className="prop-desc">{m.desc}</span>
                      </div>
                      <div className="prop-control">{renderControl(m.key)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {otherKeys.filter((k) => !q || k.includes(q)).length > 0 && (
            <div>
              <div className="section-title">{t('props.other')}</div>
              <div className="panel" style={{ padding: 12 }}>
                {otherKeys
                  .filter((k) => !q || k.includes(q))
                  .map((k) => (
                    <div key={k} className="prop-row">
                      <div className="prop-info">
                        <code>{k}</code>
                      </div>
                      <div className="prop-control">
                        <input
                          className="input"
                          value={values[k] ?? ''}
                          onChange={(e) => set(k, e.target.value)}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
