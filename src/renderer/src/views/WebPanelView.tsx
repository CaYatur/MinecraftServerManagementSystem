import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check, Trash2, Plus, KeyRound, ShieldCheck, ExternalLink, X } from 'lucide-react'
import { useStore } from '../store'
import { SCOPES } from '@shared/web'
import type { Scope, WebRole, WebStatus, WebUserView } from '@shared/web'

export function WebPanelView(): JSX.Element {
  const { t } = useTranslation()
  const servers = useStore((s) => s.servers)
  const toast = useStore((s) => s.toast)

  const [status, setStatus] = useState<WebStatus | null>(null)
  const [users, setUsers] = useState<WebUserView[]>([])
  const [enabled, setEnabled] = useState(false)
  const [port, setPort] = useState(8722)
  const [bindLan, setBindLan] = useState(false)

  const [newUser, setNewUser] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newMc, setNewMc] = useState('')
  const [newRole, setNewRole] = useState<WebRole>('user')
  const [permUser, setPermUser] = useState<WebUserView | null>(null)
  const [permDraft, setPermDraft] = useState<Record<string, Scope[]>>({})
  const [pwUser, setPwUser] = useState<WebUserView | null>(null)
  const [pwVal, setPwVal] = useState('')

  const refresh = async (): Promise<void> => {
    const st = await window.msms.getWebStatus()
    setStatus(st)
    setEnabled(st.enabled)
    setPort(st.port)
    setBindLan(st.bindLan)
    setUsers(await window.msms.listWebUsers())
  }

  useEffect(() => {
    void refresh()
  }, [])

  const saveConfig = async (): Promise<void> => {
    const st = await window.msms.setWebConfig({ enabled, port: Number(port), bindLan })
    setStatus(st)
    toast('success', 'web.saved')
  }

  const addUser = async (): Promise<void> => {
    if (!newUser.trim() || !newPass) return
    try {
      await window.msms.createWebUser({
        username: newUser.trim(),
        password: newPass,
        role: newRole,
        perms: {},
        mcName: newMc.trim() || undefined
      })
      setNewUser('')
      setNewPass('')
      setNewMc('')
      toast('success', 'web.created')
      void refresh()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }

  const openPerms = (u: WebUserView): void => {
    setPermUser(u)
    setPermDraft(JSON.parse(JSON.stringify(u.perms || {})))
  }
  const toggleScope = (serverId: string, scope: Scope): void => {
    setPermDraft((prev) => {
      const cur = new Set(prev[serverId] ?? [])
      if (cur.has(scope)) cur.delete(scope)
      else cur.add(scope)
      return { ...prev, [serverId]: [...cur] }
    })
  }
  const savePerms = async (): Promise<void> => {
    if (!permUser) return
    const clean: Record<string, Scope[]> = {}
    for (const [k, v] of Object.entries(permDraft)) if (v.length) clean[k] = v
    await window.msms.setWebUserPerms(permUser.id, clean)
    setPermUser(null)
    toast('success', 'web.saved')
    void refresh()
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        <Globe size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('web.title')}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>{t('web.desc')}</p>

      <div className="panel">
        <label className="switch" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t('web.enable')}
        </label>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 140, marginBottom: 0 }}>
            <label>{t('web.port')}</label>
            <input className="input" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </div>
          <label className="switch" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={bindLan} onChange={(e) => setBindLan(e.target.checked)} />
            {t('web.lan')}
          </label>
          <button className="btn primary" onClick={saveConfig}>
            <Check size={14} /> {t('common.save')}
          </button>
        </div>
        {bindLan && <p className="hint" style={{ color: 'var(--warning)' }}>⚠ {t('web.lanWarn')}</p>}

        <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center' }}>
          <span className={`badge ${status?.running ? 'op-badge' : ''}`}>
            <span className={`dot ${status?.running ? 'running' : 'stopped'}`} />
            {status?.running ? t('web.running') : t('web.stopped')}
          </span>
        </div>
        {status?.running && (
          <div style={{ marginTop: 8 }}>
            <label className="dim" style={{ fontSize: 12 }}>{t('web.urls')}</label>
            <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
              {status.urls.map((u) => (
                <button key={u} className="btn sm" onClick={() => window.msms.openExternal(u)}>
                  <ExternalLink size={13} /> {u}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="section-title">{t('web.users')}</div>
      <div className="panel">
        <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 130, marginBottom: 0 }}>
            <label>{t('web.username')}</label>
            <input className="input" value={newUser} onChange={(e) => setNewUser(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
            <label>{t('web.password')}</label>
            <input className="input" type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
            <label>{t('web.mcName')}</label>
            <input className="input" value={newMc} onChange={(e) => setNewMc(e.target.value)} placeholder="Steve" />
          </div>
          <div className="field" style={{ minWidth: 150, marginBottom: 0 }}>
            <label>{t('web.role')}</label>
            <select className="select" value={newRole} onChange={(e) => setNewRole(e.target.value as WebRole)}>
              <option value="user">{t('web.roleUser')}</option>
              <option value="owner">{t('web.roleOwner')}</option>
            </select>
          </div>
          <button className="btn primary" onClick={addUser}>
            <Plus size={14} /> {t('web.create')}
          </button>
        </div>

        {users.length === 0 ? (
          <p className="dim" style={{ margin: 0 }}>{t('web.noUsers')}</p>
        ) : (
          users.map((u) => (
            <div key={u.id} className="mod-row">
              <ShieldCheck size={16} className={u.role === 'owner' ? '' : 'dim'} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mod-name">
                  {u.username}{' '}
                  <span className={`badge ${u.role === 'owner' ? 'op-badge' : ''}`}>{u.role}</span>
                </div>
                <div className="dim" style={{ fontSize: 11 }}>
                  {u.role === 'owner'
                    ? 'full access'
                    : Object.entries(u.perms || {})
                        .filter(([, s]) => s.length)
                        .map(([sid, s]) => `${servers.find((x) => x.id === sid)?.name ?? sid}: ${s.length}`)
                        .join(' · ') || '—'}
                </div>
              </div>
              {u.role !== 'owner' && (
                <button className="btn ghost sm" onClick={() => openPerms(u)}>
                  {t('web.editPerms')}
                </button>
              )}
              <button className="btn ghost sm" title={t('web.resetPw')} onClick={() => { setPwUser(u); setPwVal('') }}>
                <KeyRound size={14} />
              </button>
              <button
                className="btn ghost sm danger"
                onClick={async () => {
                  await window.msms.deleteWebUser(u.id)
                  void refresh()
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      {permUser && (
        <div className="modal-backdrop" onClick={() => setPermUser(null)}>
          <div className="modal" style={{ width: 'min(680px,94vw)' }} onClick={(e) => e.stopPropagation()}>
            <h3>{t('web.permsFor', { name: permUser.username })}</h3>
            <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {servers.map((s) => (
                <div key={s.id} className="panel" style={{ padding: 12, marginBottom: 8 }}>
                  <div className="mod-name" style={{ marginBottom: 8 }}>{s.name}</div>
                  <div className="row wrap" style={{ gap: 10 }}>
                    {SCOPES.map((sc) => (
                      <label key={sc} className="switch" style={{ fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={(permDraft[s.id] ?? []).includes(sc)}
                          onChange={() => toggleScope(s.id, sc)}
                        />
                        {t(`web.scope.${sc}`)}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              {servers.length === 0 && <p className="dim">—</p>}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPermUser(null)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={savePerms}>
                <Check size={14} /> {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pwUser && (
        <div className="modal-backdrop" onClick={() => setPwUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('web.resetPw')} — {pwUser.username}</h3>
            <input className="input" type="password" autoFocus value={pwVal} onChange={(e) => setPwVal(e.target.value)} />
            <div className="modal-actions">
              <button className="btn" onClick={() => setPwUser(null)}>{t('common.cancel')}</button>
              <button
                className="btn primary"
                onClick={async () => {
                  if (pwVal.length >= 4) {
                    await window.msms.setWebUserPassword(pwUser.id, pwVal)
                    toast('success', 'web.saved')
                  }
                  setPwUser(null)
                }}
              >
                <Check size={14} /> {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
