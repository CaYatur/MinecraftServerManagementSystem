import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Globe,
  Check,
  Trash2,
  Plus,
  KeyRound,
  ShieldCheck,
  ExternalLink,
  X,
  Ban,
  Copy,
  Terminal,
  BookOpen,
  Pause,
  Play
} from 'lucide-react'
import { useStore } from '../store'
import { SCOPES } from '@shared/web'
import { effectiveScopes } from '@shared/rbac'
import { isKeyUsable } from '@shared/apikeys'
import { MAP_PAGE_DEFAULTS } from '@shared/mapPage'
import type { MapPageConfig, MapPageAccess } from '@shared/mapPage'
import { usageSamples, USAGE_NOTES, REPO_URL } from '@shared/apiUsage'
import type { RoleDef } from '@shared/rbac'
import type { ApiKeyView, KeyServers } from '@shared/apikeys'
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
  const [siteEnabled, setSiteEnabled] = useState(false)
  const [sitePort, setSitePort] = useState(8723)
  // The map page (#146). Held as the whole config rather than a field each: it
  // has eleven settings, and eleven useStates is eleven chances to forget one
  // in the save.
  const [mapPage, setMapPage] = useState<MapPageConfig>(MAP_PAGE_DEFAULTS)
  // Separate, and never populated from the config. Blank means "leave it as it
  // is" — a form that round-trips a doorcode through the renderer to save an
  // unrelated toggle is a form that can lose it.
  const [mapPass, setMapPass] = useState('')

  const [newUser, setNewUser] = useState('')
  const [newPass, setNewPass] = useState('')
  const [newMc, setNewMc] = useState('')
  const [newRole, setNewRole] = useState<WebRole>('user')
  const [permUser, setPermUser] = useState<WebUserView | null>(null)
  const [permDraft, setPermDraft] = useState<Record<string, Scope[]>>({})
  const [auditDraft, setAuditDraft] = useState(false)
  const [roleDraft, setRoleDraft] = useState<Record<string, string[]>>({})
  const [roles, setRoles] = useState<RoleDef[]>([])
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleScopes, setNewRoleScopes] = useState<Scope[]>(['view'])
  const [pwUser, setPwUser] = useState<WebUserView | null>(null)
  const [pwVal, setPwVal] = useState('')

  // ---- API keys (#48) ----
  const [keys, setKeys] = useState<ApiKeyView[]>([])
  const [usageFor, setUsageFor] = useState<string | null>(null)
  const [keyLabel, setKeyLabel] = useState('')
  const [keyScopes, setKeyScopes] = useState<Scope[]>(['view'])
  const [keyAllServers, setKeyAllServers] = useState(true)
  const [keyServers, setKeyServers] = useState<string[]>([])
  const [keyDays, setKeyDays] = useState(0)
  const [keyAudit, setKeyAudit] = useState(false)
  // Held only until the operator dismisses it — this is the one and only time
  // the raw secret exists outside the caller.
  const [newSecret, setNewSecret] = useState<{ label: string; secret: string } | null>(null)
  const [originsText, setOriginsText] = useState('')

  /**
   * Four independent things, loaded independently.
   *
   * This used to be one sequential chain with the API keys awaited LAST, and
   * every caller invoked it as `void refresh()` — so anything that threw before
   * the last line left the key list empty and said nothing at all. "I created a
   * key and it is not listed" was that: not a problem with keys, a problem with
   * being fourth in a queue that could stop.
   *
   * `allSettled`, so one failure cannot blank the other three, and a failure is
   * reported rather than swallowed.
   */
  const refresh = async (): Promise<void> => {
    const [st, us, rs, ks] = await Promise.allSettled([
      window.msms.getWebStatus(),
      window.msms.listWebUsers(),
      window.msms.listRoles(),
      window.msms.listApiKeys()
    ])
    if (st.status === 'fulfilled') {
      setStatus(st.value)
      setEnabled(st.value.panel.enabled)
      setPort(st.value.panel.port)
      setSiteEnabled(st.value.site.enabled)
      setSitePort(st.value.site.port)
      setBindLan(st.value.bindLan)
      setMapPage(st.value.mapPage ?? MAP_PAGE_DEFAULTS)
      setOriginsText((st.value.apiOrigins ?? []).join('\n'))
    }
    if (us.status === 'fulfilled') setUsers(us.value)
    if (rs.status === 'fulfilled') setRoles(rs.value)
    if (ks.status === 'fulfilled') setKeys(ks.value)
    const failed = [st, us, rs, ks].find((r) => r.status === 'rejected')
    if (failed && failed.status === 'rejected') toast('error', String(failed.reason))
  }

  const createKey = async (): Promise<void> => {
    const label = keyLabel.trim()
    if (!label) return
    try {
      const servers: KeyServers = keyAllServers ? 'all' : keyServers
      const r = await window.msms.createApiKey({
        label,
        scopes: keyScopes,
        servers,
        expiresInDays: Number(keyDays) || 0,
        canAudit: keyAudit
      })
      setNewSecret({ label: r.key.label, secret: r.secret })
      setKeyLabel('')
      void refresh()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }

  const addRole = async (): Promise<void> => {
    const name = newRoleName.trim()
    if (!name) return
    try {
      await window.msms.upsertRole({ name, scopes: newRoleScopes })
      setNewRoleName('')
      setNewRoleScopes(['view'])
      toast('success', 'web.saved')
      void refresh()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }
  const removeRole = async (roleId: string): Promise<void> => {
    try {
      await window.msms.deleteRole(roleId)
      toast('success', 'web.saved')
      void refresh()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }

  useEffect(() => {
    void refresh()
    // Keep status/URLs live (they change when the server binds/rebinds).
    const iv = setInterval(() => {
      window.msms.getWebStatus().then(setStatus).catch(() => {})
    }, 3000)
    return () => clearInterval(iv)
  }, [])

  const saveConfig = async (): Promise<void> => {
    const st = await window.msms.setWebConfig({
      enabled,
      port: Number(port),
      bindLan,
      siteEnabled,
      sitePort: Number(sitePort),
      apiOrigins: originsText.split('\n').map((s) => s.trim()).filter(Boolean),
      mapPage,
      // Blank leaves the stored one alone. The main process treats it that way
      // too; sending '' from here on every save would otherwise clear the
      // doorcode each time an unrelated toggle moved.
      mapPagePass: mapPass
    })
    setStatus(st)
    setOriginsText((st.apiOrigins ?? []).join('\n'))
    setMapPass('')
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
    setRoleDraft(JSON.parse(JSON.stringify(u.roles || {})))
    setAuditDraft(!!u.canAudit)
  }
  const toggleRole = (serverId: string, roleId: string): void => {
    setRoleDraft((prev) => {
      const cur = new Set(prev[serverId] ?? [])
      if (cur.has(roleId)) cur.delete(roleId)
      else cur.add(roleId)
      return { ...prev, [serverId]: [...cur] }
    })
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
    const cleanRoles: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(roleDraft)) if (v.length) cleanRoles[k] = v
    await window.msms.setWebUserRoles(permUser.id, cleanRoles)
    if (auditDraft !== !!permUser.canAudit) await window.msms.setWebUserAudit(permUser.id, auditDraft)
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
        <div className="listener-grid">
          <div className="listener">
            <div className="mod-name" style={{ marginBottom: 8 }}>
              {t('web.panelSection')}
              <span className={`badge ${status?.panel.running ? 'op-badge' : ''}`}>
                <span className={`dot ${status?.panel.running ? 'running' : 'stopped'}`} />
                {status?.panel.running ? t('web.running') : t('web.stopped')}
              </span>
            </div>
            <label className="switch" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              {t('web.enable')}
            </label>
            <div className="field" style={{ width: 140 }}>
              <label>{t('web.port')}</label>
              <input className="input" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </div>
            {status?.panel.running && (
              <div className="row wrap" style={{ gap: 6 }}>
                {status.panel.urls.map((u) => (
                  <button key={u} className="btn sm" onClick={() => window.msms.openExternal(u)}>
                    <ExternalLink size={12} /> {u}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="listener">
            <div className="mod-name" style={{ marginBottom: 8 }}>
              {t('web.siteSection')}
              <span className={`badge ${status?.site.running ? 'op-badge' : ''}`}>
                <span className={`dot ${status?.site.running ? 'running' : 'stopped'}`} />
                {status?.site.running ? t('web.running') : t('web.stopped')}
              </span>
            </div>
            <label className="switch" style={{ marginBottom: 10 }}>
              <input type="checkbox" checked={siteEnabled} onChange={(e) => setSiteEnabled(e.target.checked)} />
              {t('web.siteEnable')}
            </label>
            <div className="field" style={{ width: 140 }}>
              <label>{t('web.sitePort')}</label>
              <input className="input" type="number" value={sitePort} onChange={(e) => setSitePort(Number(e.target.value))} />
            </div>
            {status?.site.running && (
              <div className="row wrap" style={{ gap: 6 }}>
                {status.site.urls.map((u) => (
                  <button key={u} className="btn sm" onClick={() => window.msms.openExternal(u)}>
                    <ExternalLink size={12} /> {u}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* The map page (#146): its own listener, so the map can be handed out
              without the shop or the panel going with it. */}
          <div className="listener">
            <div className="mod-name" style={{ marginBottom: 8 }}>
              {t('web.mapSection')}
              <span className={`badge ${status?.map.running ? 'op-badge' : ''}`}>
                <span className={`dot ${status?.map.running ? 'running' : 'stopped'}`} />
                {status?.map.running ? t('web.running') : t('web.stopped')}
              </span>
            </div>
            <label className="switch" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={mapPage.enabled}
                onChange={(e) => setMapPage({ ...mapPage, enabled: e.target.checked })}
              />
              {t('web.mapEnable')}
            </label>
            <div className="row wrap" style={{ gap: 8 }}>
              <div className="field" style={{ width: 120 }}>
                <label>{t('web.mapPort')}</label>
                <input
                  className="input"
                  type="number"
                  value={mapPage.port}
                  onChange={(e) => setMapPage({ ...mapPage, port: Number(e.target.value) })}
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>{t('web.mapServer')}</label>
                <select
                  className="select"
                  value={mapPage.serverId}
                  onChange={(e) => setMapPage({ ...mapPage, serverId: e.target.value })}
                >
                  <option value="">{t('web.mapNoServer')}</option>
                  {servers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>{t('web.mapTitle')}</label>
              <input
                className="input"
                value={mapPage.title}
                onChange={(e) => setMapPage({ ...mapPage, title: e.target.value })}
              />
            </div>
            <div className="field">
              <label>{t('web.mapAccess')}</label>
              <select
                className="select"
                value={mapPage.access}
                onChange={(e) => setMapPage({ ...mapPage, access: e.target.value as MapPageAccess })}
              >
                <option value="open">{t('web.mapAccessOpen')}</option>
                <option value="password">{t('web.mapAccessPassword')}</option>
                <option value="players">{t('web.mapAccessPlayers')}</option>
              </select>
            </div>
            {mapPage.access === 'password' && (
              <div className="field">
                <label>{t('web.mapPass')}</label>
                <input
                  className="input"
                  value={mapPass}
                  placeholder={t('web.mapPassKeep')}
                  onChange={(e) => setMapPass(e.target.value)}
                />
                {/* A shared doorcode, not a personal credential: the operator has
                    to be able to read it back and tell people. Saying so beats
                    letting them assume otherwise. */}
                <p className="hint" style={{ margin: '4px 0 0' }}>{t('web.mapPassHint')}</p>
              </div>
            )}
            <div className="field">
              <label>{t('web.mapShows')}</label>
              <div className="row wrap" style={{ gap: 10 }}>
                {([
                  ['world', 'web.mapWorld'],
                  ['players', 'web.mapPlayers'],
                  ['names', 'web.mapNames'],
                  ['heads', 'web.mapHeads'],
                  ['areas', 'web.mapAreas'],
                  ['structures', 'web.mapStructures'],
                  ['heatmap', 'web.mapHeat']
                ] as const).map(([k, label]) => (
                  <label key={k} className="switch" style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={mapPage[k]}
                      onChange={(e) => setMapPage({ ...mapPage, [k]: e.target.checked })}
                    />
                    {t(label)}
                  </label>
                ))}
              </div>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <div className="field" style={{ width: 130 }}>
                <label>{t('web.mapRound')}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={512}
                  value={mapPage.round}
                  onChange={(e) => setMapPage({ ...mapPage, round: Number(e.target.value) })}
                />
                <p className="hint" style={{ marginTop: 4 }}>{t('web.mapRoundHint')}</p>
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>{t('web.mapPin')}</label>
                <input
                  className="input"
                  placeholder={t('web.mapPinAny')}
                  value={mapPage.fixedDim}
                  onChange={(e) => setMapPage({ ...mapPage, fixedDim: e.target.value })}
                />
              </div>
            </div>
            {/* Otherwise the listener fails with EADDRINUSE in the log and the
                card just says "stopped" with no reason on screen. */}
            {(mapPage.port === port || mapPage.port === sitePort) && (
              <p className="hint" style={{ color: 'var(--warning)' }}>⚠ {t('web.mapPortClash')}</p>
            )}
            {mapPage.enabled && !mapPage.serverId && (
              <p className="hint">{t('web.mapNeedsServer')}</p>
            )}
            {status?.map.running && (
              <div className="row wrap" style={{ gap: 6 }}>
                {status.map.urls.map((u) => (
                  <button key={u} className="btn sm" onClick={() => window.msms.openExternal(u)}>
                    <ExternalLink size={12} /> {u}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="row wrap" style={{ gap: 12, alignItems: 'center', marginTop: 12 }}>
          <label className="switch">
            <input type="checkbox" checked={bindLan} onChange={(e) => setBindLan(e.target.checked)} />
            {t('web.lan')}
          </label>
          <button className="btn primary" onClick={saveConfig}>
            <Check size={14} /> {t('common.save')}
          </button>
        </div>
        {bindLan && <p className="hint" style={{ color: 'var(--warning)' }}>⚠ {t('web.lanWarn')}</p>}
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

      {/* Role definitions (#28). Desktop-only, like per-user permissions: a web
          route would let a settings-scoped user widen their own access. */}
      <div className="section-title">
        <ShieldCheck size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('web.roles')}
      </div>
      <div className="panel">
        <p className="hint" style={{ marginTop: 0 }}>{t('web.rolesHint')}</p>
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          {roles.map((rd) => (
            <span key={rd.id} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {rd.name}
              <span className="dim">{rd.scopes.length}</span>
              {!rd.builtin && (
                <button
                  className="btn ghost sm"
                  style={{ padding: 0, lineHeight: 1 }}
                  title={t('common.delete')}
                  onClick={() => void removeRole(rd.id)}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 140 }}
            placeholder={t('web.newRole')}
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
          />
          <button className="btn primary sm" onClick={() => void addRole()} disabled={!newRoleName.trim()}>
            <Plus size={13} /> {t('common.add')}
          </button>
        </div>
        <div className="row wrap" style={{ gap: 10, marginTop: 8 }}>
          {SCOPES.map((sc) => (
            <label key={sc} className="switch" style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={newRoleScopes.includes(sc)}
                onChange={() =>
                  setNewRoleScopes((prev) =>
                    prev.includes(sc) ? prev.filter((x) => x !== sc) : [...prev, sc]
                  )
                }
              />
              {t(`web.scope.${sc}`)}
            </label>
          ))}
        </div>
      </div>

      {/* API keys (#48). Machine credentials: scoped, revocable, tied to no
          person. Desktop-only issuing, like roles — a web route would let a
          settings-scoped user mint themselves something wider. */}
      <div className="section-title">
        <Terminal size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('web.apiKeys')}
      </div>
      <div className="panel">
        <p className="hint" style={{ marginTop: 0 }}>{t('web.apiKeysHint')}</p>

        <div className="row wrap" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
          <div className="field" style={{ flex: 1, minWidth: 150, marginBottom: 0 }}>
            <label>{t('web.keyLabel')}</label>
            <input
              className="input"
              value={keyLabel}
              onChange={(e) => setKeyLabel(e.target.value)}
              placeholder={t('web.keyLabelPlaceholder')}
            />
          </div>
          <div className="field" style={{ width: 150, marginBottom: 0 }}>
            <label>{t('web.keyExpiry')}</label>
            <input
              className="input"
              type="number"
              min={0}
              value={keyDays}
              onChange={(e) => setKeyDays(Number(e.target.value))}
            />
          </div>
          <button className="btn primary" onClick={() => void createKey()} disabled={!keyLabel.trim()}>
            <Plus size={14} /> {t('web.keyCreate')}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>{t('web.keyExpiryHint')}</p>

        <div className="field-label">{t('web.keyScopes')}</div>
        <div className="row wrap" style={{ gap: 10, marginBottom: 10 }}>
          {SCOPES.map((sc) => (
            <label key={sc} className="switch" style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={keyScopes.includes(sc)}
                onChange={() =>
                  setKeyScopes((prev) =>
                    prev.includes(sc) ? prev.filter((x) => x !== sc) : [...prev, sc]
                  )
                }
              />
              {t(`web.scope.${sc}`)}
            </label>
          ))}
          <label className="switch" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={keyAudit} onChange={() => setKeyAudit((v) => !v)} />
            {t('web.keyAudit')}
          </label>
        </div>

        <div className="field-label">{t('web.keyServers')}</div>
        <label className="switch" style={{ fontSize: 12, marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={keyAllServers}
            onChange={() => setKeyAllServers((v) => !v)}
          />
          {t('web.keyAllServers')}
        </label>
        {!keyAllServers && (
          <div className="row wrap" style={{ gap: 10, marginBottom: 8 }}>
            {servers.length === 0 ? (
              <span className="dim" style={{ fontSize: 12 }}>{t('web.noServers')}</span>
            ) : (
              servers.map((s) => (
                <label key={s.id} className="switch" style={{ fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={keyServers.includes(s.id)}
                    onChange={() =>
                      setKeyServers((prev) =>
                        prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]
                      )
                    }
                  />
                  {s.name}
                </label>
              ))
            )}
          </div>
        )}

        {keys.length === 0 ? (
          <p className="dim" style={{ margin: '10px 0 0' }}>{t('web.noKeys')}</p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {keys.map((k) => {
              const usable = isKeyUsable(k, Date.now())
              return (
                <div key={k.id} className="mod-row">
                  <KeyRound size={16} className={usable ? '' : 'dim'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mod-name">
                      {k.label}{' '}
                      <span className={`badge ${usable ? 'op-badge' : 'error-badge'}`}>
                        {k.revoked
                          ? t('web.keyRevoked')
                          : k.disabled
                            ? t('web.keyDisabled')
                            : usable
                              ? t('web.keyActive')
                              : t('web.keyExpired')}
                      </span>
                    </div>
                    <div className="dim" style={{ fontSize: 11 }}>
                      {k.scopes.length ? k.scopes.join(', ') : t('web.keyNoScopes')}
                      {' · '}
                      {k.servers === 'all'
                        ? t('web.keyAllServers')
                        : k.servers
                            .map((sid) => servers.find((x) => x.id === sid)?.name ?? sid)
                            .join(', ') || t('web.keyNoServers')}
                      {k.expiresAt ? ` · ${t('web.keyExpiresAt')} ${new Date(k.expiresAt).toLocaleDateString()}` : ''}
                      {k.lastUsedAt
                        ? ` · ${t('web.keyLastUsed')} ${new Date(k.lastUsedAt).toLocaleString()}`
                        : ` · ${t('web.keyNeverUsed')}`}
                    </div>
                  </div>
                  {/* A key nobody can work out how to send is a key that does
                      nothing — the route list says which scope each call needs
                      and never how to make one. */}
                  <button
                    className="btn ghost sm"
                    title={t('web.keyHowTo')}
                    onClick={() => setUsageFor(usageFor === k.id ? null : k.id)}
                  >
                    <BookOpen size={14} />
                  </button>
                  {/* Reversible. Revoke, below, is not — pausing an integration
                      and destroying a leaked credential are different acts. */}
                  {!k.revoked && (
                    <button
                      className="btn ghost sm"
                      title={k.disabled ? t('web.keyEnable') : t('web.keyDisable')}
                      onClick={async () => {
                        await window.msms.setApiKeyDisabled(k.id, !k.disabled)
                        void refresh()
                      }}
                    >
                      {k.disabled ? <Play size={14} /> : <Pause size={14} />}
                    </button>
                  )}
                  {!k.revoked && (
                    <button
                      className="btn ghost sm"
                      title={t('web.keyRevoke')}
                      onClick={async () => {
                        await window.msms.revokeApiKey(k.id)
                        void refresh()
                      }}
                    >
                      <Ban size={14} />
                    </button>
                  )}
                  <button
                    className="btn ghost sm danger"
                    title={t('common.delete')}
                    onClick={async () => {
                      await window.msms.deleteApiKey(k.id)
                      void refresh()
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
            {usageFor && (
              <div className="panel" style={{ marginTop: 8 }}>
                {USAGE_NOTES.map((n) => (
                  <p className="hint" key={n} style={{ marginTop: 0 }}>
                    {n}
                  </p>
                ))}
                {/* The real secret exists only in the moment after creation, so
                    these carry a marked placeholder rather than something that
                    looks like a key and is not. */}
                {/* The panel listener is the one that serves the API. */}
                {usageSamples({
                  baseUrl: status?.panel.urls[0] ?? `http://127.0.0.1:${status?.panel.port ?? 8080}`
                }).map((s) => (
                  <div key={s.lang} style={{ marginTop: 10 }}>
                    <b style={{ fontSize: 12 }}>{s.lang}</b>
                    <pre className="code-block" style={{ whiteSpace: 'pre-wrap', fontSize: 11.5 }}>
                      {s.code}
                    </pre>
                  </div>
                ))}
                {/* Where to go next. The reference at /docs is served by this
                    install so it always matches the running version; the repo
                    is where the written documentation and the source are. */}
                <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
                  <button
                    className="btn sm"
                    onClick={() =>
                      window.msms.openExternal(
                        (status?.panel.urls[0] ?? `http://127.0.0.1:${status?.panel.port ?? 8080}`) +
                          '/api/v1/docs'
                      )
                    }
                  >
                    <BookOpen size={13} /> {t('web.apiDocs')}
                  </button>
                  <button className="btn sm" onClick={() => window.msms.openExternal(REPO_URL)}>
                    <ExternalLink size={13} /> {t('web.apiRepo')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CORS allowlist (#50). Lives next to the keys because it only matters
            for a key used from a browser. */}
        <div className="field" style={{ marginTop: 14, marginBottom: 0, maxWidth: 460 }}>
          <label>{t('web.apiOrigins')}</label>
          <textarea
            className="input"
            style={{ minHeight: 64, fontFamily: 'var(--mono, monospace)', fontSize: 12 }}
            value={originsText}
            onChange={(e) => setOriginsText(e.target.value)}
            placeholder="https://dash.example.com"
          />
          <p className="hint" style={{ marginBottom: 0 }}>{t('web.apiOriginsHint')}</p>
          <button className="btn primary sm" style={{ marginTop: 8 }} onClick={saveConfig}>
            <Check size={13} /> {t('common.save')}
          </button>
        </div>
      </div>

      {newSecret && (
        <div className="modal-backdrop" onClick={() => setNewSecret(null)}>
          <div className="modal" style={{ width: 'min(560px,94vw)' }} onClick={(e) => e.stopPropagation()}>
            <h3>{t('web.keyCreated', { name: newSecret.label })}</h3>
            <p className="hint" style={{ color: 'var(--warning)', marginTop: 0 }}>
              ⚠ {t('web.keySecretWarn')}
            </p>
            <div
              className="panel"
              style={{
                padding: 12,
                wordBreak: 'break-all',
                fontFamily: 'var(--mono, monospace)',
                fontSize: 12
              }}
            >
              {newSecret.secret}
            </div>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard.writeText(newSecret.secret)
                  toast('success', 'web.keyCopied')
                }}
              >
                <Copy size={14} /> {t('web.keyCopy')}
              </button>
              <button className="btn primary" onClick={() => setNewSecret(null)}>
                <Check size={14} /> {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {permUser && (
        <div className="modal-backdrop" onClick={() => setPermUser(null)}>
          <div className="modal" style={{ width: 'min(680px,94vw)' }} onClick={(e) => e.stopPropagation()}>
            <h3>{t('web.permsFor', { name: permUser.username })}</h3>
            <div className="panel" style={{ padding: 12, marginBottom: 8 }}>
              <label className="switch" style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={auditDraft}
                  onChange={() => setAuditDraft((v) => !v)}
                />
                {t('web.canAudit')}
              </label>
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{t('web.canAuditHint')}</div>
            </div>
            <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {servers.map((s) => (
                <div key={s.id} className="panel" style={{ padding: 12, marginBottom: 8 }}>
                  <div className="mod-name" style={{ marginBottom: 8 }}>{s.name}</div>
                  {roles.length > 0 && (
                    <>
                      <div className="field-label" style={{ fontSize: 11 }}>{t('web.roles')}</div>
                      <div className="row wrap" style={{ gap: 10, marginBottom: 8 }}>
                        {roles.map((rd) => (
                          <label key={rd.id} className="switch" style={{ fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={(roleDraft[s.id] ?? []).includes(rd.id)}
                              onChange={() => toggleRole(s.id, rd.id)}
                            />
                            {rd.name}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="field-label" style={{ fontSize: 11 }}>{t('web.directScopes')}</div>
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
                  {/* What the two actually add up to - a role's contribution is
                      invisible otherwise, and that is where mistakes hide. */}
                  <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
                    {t('web.effective')}:{' '}
                    {effectiveScopes(permDraft[s.id], roleDraft[s.id], roles)
                      .map((sc) => t(`web.scope.${sc}`))
                      .join(', ') || '—'}
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
