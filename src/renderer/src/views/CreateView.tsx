import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Sparkles, Download, Loader2, ExternalLink, ChevronRight, Check } from 'lucide-react'
import { useStore } from '../store'
import { CREATABLE_TYPES, HAS_BUILDS, createErrorKey } from '@shared/versions'
import type { McVersion, BuildInfo, CreateProgress } from '@shared/versions'
import type { JavaPreset, ServerType } from '@shared/types'

const PROXY_TYPES: ServerType[] = ['velocity', 'waterfall', 'bungeecord']
const PRESETS: JavaPreset[] = ['aikars', 'aikars-large', 'basic']

/**
 * Display grouping for the type picker (in order). Only types that are also in
 * CREATABLE_TYPES render; any creatable type not listed here falls into an
 * "other" bucket at render time, so nothing silently disappears if the set grows.
 */
const TYPE_CATEGORIES: { key: string; types: ServerType[] }[] = [
  { key: 'vanilla', types: ['vanilla'] },
  { key: 'plugin', types: ['paper', 'purpur', 'folia'] },
  { key: 'modded', types: ['forge', 'neoforge', 'fabric'] },
  { key: 'hybrid', types: ['mohist'] },
  { key: 'proxy', types: ['velocity'] }
]
/** Sensible defaults for newcomers, badged in the picker. */
const RECOMMENDED: ServerType[] = ['vanilla', 'paper', 'fabric']

/**
 * Turn a raw createServer error code into a human message. The backend surfaces
 * short codes (e.g. `no-mohist-build` when the upstream API lists a version but
 * has no build for it, or `empty-download` when a mirror serves a 0-byte body);
 * shown verbatim these read as gibberish to a non-technical user. The code→key
 * table lives in @shared/versions (createErrorKey) so it is testable; unmapped
 * codes fall through unchanged.
 */
function friendlyCreateError(error: string | undefined, t: TFunction): string {
  const e = error ?? '?'
  const key = createErrorKey(e)
  return key ? t(key) : e
}

export function CreateView(): JSX.Element {
  const { t } = useTranslation()
  const config = useStore((s) => s.config)
  const refreshServers = useStore((s) => s.refreshServers)
  const selectServer = useStore((s) => s.selectServer)
  const setView = useStore((s) => s.setView)
  const toast = useStore((s) => s.toast)

  const [type, setType] = useState<ServerType | null>(null)
  const [includeUnstable, setIncludeUnstable] = useState(false)
  const [versions, setVersions] = useState<McVersion[] | null>(null)
  const [mcVersion, setMcVersion] = useState('')
  const [builds, setBuilds] = useState<BuildInfo[] | null>(null)
  const [build, setBuild] = useState('')

  const [name, setName] = useState('')
  const [folder, setFolder] = useState('')
  const [folderEdited, setFolderEdited] = useState(false)
  const [memory, setMemory] = useState(config.defaults.maxMemoryMB)
  const [preset, setPreset] = useState<JavaPreset>(
    config.defaults.javaPreset === 'custom' ? 'aikars' : config.defaults.javaPreset
  )
  const [port, setPort] = useState(25565)
  const [onlineMode, setOnlineMode] = useState(true)
  const [eula, setEula] = useState(false)

  const [creating, setCreating] = useState(false)
  const [progress, setProgress] = useState<CreateProgress | null>(null)

  const isProxy = type ? PROXY_TYPES.includes(type) : false
  const hasBuilds = type ? HAS_BUILDS.includes(type) : false

  // Fetch versions when type / unstable changes.
  useEffect(() => {
    if (!type) return
    setVersions(null)
    setMcVersion('')
    setBuilds(null)
    setBuild('')
    window.msms
      .listVersions(type, includeUnstable)
      .then((v) => setVersions(v))
      .catch(() => setVersions([]))
  }, [type, includeUnstable])

  // Fetch builds when version changes.
  useEffect(() => {
    if (!type || !mcVersion || !hasBuilds) {
      setBuilds(null)
      return
    }
    setBuilds(null)
    setBuild('')
    window.msms
      .listBuilds(type, mcVersion, includeUnstable)
      .then((b) => setBuilds(b))
      .catch(() => setBuilds([]))
  }, [type, mcVersion, hasBuilds, includeUnstable])

  // Default name/folder from selection.
  useEffect(() => {
    if (type && mcVersion) {
      const label = t(`types.${type}`)
      const n = `${label} ${mcVersion}`
      setName(n)
      if (!folderEdited) setFolder(n.replace(/[<>:"/\\|?* ]/g, '_'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, mcVersion])

  // Subscribe to creation progress.
  useEffect(() => {
    const off = window.msms.onCreateProgress((p) => setProgress(p))
    return off
  }, [])

  const canCreate =
    !!type && !!mcVersion && !!name.trim() && (isProxy || eula) && !creating

  const doCreate = async (): Promise<void> => {
    if (!type || !canCreate) return
    setCreating(true)
    setProgress({ stage: 'resolving' })
    const res = await window.msms.createServer({
      name: name.trim(),
      folderName: folder.trim() || undefined,
      type,
      mcVersion,
      build: build || undefined,
      memoryMB: Number(memory),
      preset,
      acceptEula: eula,
      onlineMode,
      port: Number(port)
    })
    setCreating(false)
    if (res.ok && res.server) {
      toast('success', 'wizard.createdOk', { name: res.server.name })
      await refreshServers()
      await selectServer(res.server.id)
      setView('console')
    } else {
      toast('error', 'wizard.createFailed', { error: friendlyCreateError(res.error, t) })
      setProgress({ stage: 'error', message: res.error })
    }
  }

  // Type picker grouped into explained categories; any creatable type not
  // placed in TYPE_CATEGORIES lands in a trailing "other" group.
  const categorized = useMemo(() => {
    const seen = new Set<ServerType>()
    const cats = TYPE_CATEGORIES.map((c) => {
      const types = c.types.filter((tp) => CREATABLE_TYPES.includes(tp))
      types.forEach((tp) => seen.add(tp))
      return { key: c.key, types }
    }).filter((c) => c.types.length > 0)
    const other = CREATABLE_TYPES.filter((tp) => !seen.has(tp))
    if (other.length) cats.push({ key: 'other', types: other })
    return cats
  }, [])

  const progressLabel = useMemo(() => {
    if (!progress) return ''
    switch (progress.stage) {
      case 'resolving':
        return t('wizard.progressResolving')
      case 'downloading':
        return `${t('wizard.progressDownloading')} ${progress.percent ?? 0}%`
      case 'installing':
        return t('wizard.progressInstalling')
      case 'configuring':
        return t('wizard.progressConfiguring')
      case 'done':
        return t('wizard.progressDone')
      case 'error':
        return t('wizard.createFailed', { error: friendlyCreateError(progress.message, t) })
    }
  }, [progress, t])

  return (
    <div className="content">
      <div className="section-title">
        <Sparkles size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('create.title')}
      </div>

      {/* Step 1: type */}
      <div className="panel" style={{ maxWidth: 900 }}>
        <div className="field-label">{t('wizard.chooseType')}</div>
        {categorized.map((cat) => (
          <div key={cat.key} className="type-cat">
            <h4>{t(`wizard.cat.${cat.key}`)}</h4>
            <p className="cat-desc">{t(`wizard.cat.${cat.key}Desc`)}</p>
            <div className="type-grid">
              {cat.types.map((tp) => (
                <button
                  key={tp}
                  className={`type-card ${type === tp ? 'active' : ''}`}
                  onClick={() => setType(tp)}
                >
                  <span className="tc-head">
                    <span className="tc-name">{t(`types.${tp}`)}</span>
                    {RECOMMENDED.includes(tp) && (
                      <span className="tc-rec">{t('wizard.recommended')}</span>
                    )}
                  </span>
                  <span className="tc-blurb">{t(`wizard.typeBlurb.${tp}`)}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {type && (
          <>
            {isProxy && <p className="hint">{t('wizard.proxyNote')}</p>}
            {(type === 'forge' || type === 'neoforge') && (
              <p className="hint">{t('wizard.installerNote')}</p>
            )}

            {/* Step 2: version */}
            <div className="row" style={{ marginTop: 16, gap: 16, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>{t('wizard.chooseVersion')}</label>
                {versions === null ? (
                  <div className="badge">
                    <Loader2 size={13} className="spin" /> {t('wizard.loadingVersions')}
                  </div>
                ) : versions.length === 0 ? (
                  <div className="badge">{t('wizard.noVersions')}</div>
                ) : (
                  <select
                    className="select"
                    value={mcVersion}
                    onChange={(e) => setMcVersion(e.target.value)}
                  >
                    <option value="">—</option>
                    {versions.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.id}
                        {v.stable ? '' : ' ⚠'}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <label className="switch" style={{ paddingBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={includeUnstable}
                  onChange={(e) => setIncludeUnstable(e.target.checked)}
                />
                {t('wizard.includeUnstable')}
              </label>
            </div>

            {/* Step 3: build */}
            {hasBuilds && mcVersion && (
              <div className="field" style={{ marginTop: 14, marginBottom: 0, maxWidth: 360 }}>
                <label>{t('wizard.chooseBuild')}</label>
                {builds === null ? (
                  <div className="badge">
                    <Loader2 size={13} className="spin" /> {t('common.loading')}
                  </div>
                ) : (
                  <select className="select" value={build} onChange={(e) => setBuild(e.target.value)}>
                    <option value="">{t('wizard.latest')}</option>
                    {builds.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id}
                        {b.note ? ` (${b.note})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Step 4: configure */}
      {type && mcVersion && (
        <>
          <div className="section-title">{t('wizard.stepConfigure')}</div>
          <div className="panel" style={{ maxWidth: 900 }}>
            <div className="row wrap">
              <div className="field" style={{ flex: 2, minWidth: 220 }}>
                <label>{t('wizard.name')}</label>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 2, minWidth: 220 }}>
                <label>{t('wizard.folder')}</label>
                <input
                  className="input"
                  value={folder}
                  onChange={(e) => {
                    setFolder(e.target.value)
                    setFolderEdited(true)
                  }}
                />
              </div>
            </div>
            <div className="row wrap">
              <div className="field" style={{ flex: 1, minWidth: 150 }}>
                <label>{t('wizard.memory')}</label>
                <input
                  className="input"
                  type="number"
                  value={memory}
                  onChange={(e) => setMemory(Number(e.target.value))}
                />
              </div>
              {!isProxy && (
                <div className="field" style={{ flex: 1, minWidth: 150 }}>
                  <label>{t('wizard.preset')}</label>
                  <select
                    className="select"
                    value={preset}
                    onChange={(e) => setPreset(e.target.value as JavaPreset)}
                  >
                    {PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field" style={{ flex: 1, minWidth: 130 }}>
                <label>{t('wizard.port')}</label>
                <input
                  className="input"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                />
              </div>
            </div>

            {!isProxy && (
              <>
                <label className="switch" style={{ marginBottom: 6 }}>
                  <input
                    type="checkbox"
                    checked={onlineMode}
                    onChange={(e) => setOnlineMode(e.target.checked)}
                  />
                  {t('wizard.onlineMode')}
                </label>
                <p className="hint" style={{ marginTop: 0 }}>
                  {t('wizard.onlineModeHint')}
                </p>

                <label className="switch" style={{ marginTop: 8 }}>
                  <input type="checkbox" checked={eula} onChange={(e) => setEula(e.target.checked)} />
                  {t('wizard.eula')}
                </label>{' '}
                <a
                  className="link"
                  onClick={() => window.msms.openExternal('https://aka.ms/MinecraftEULA')}
                >
                  <ExternalLink size={12} /> {t('wizard.eulaLink')}
                </a>
                {!eula && <p className="hint">{t('wizard.eulaRequired')}</p>}
              </>
            )}

            <div className="row" style={{ marginTop: 18, gap: 12 }}>
              <button className="btn primary" disabled={!canCreate} onClick={doCreate}>
                {creating ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
                {creating ? t('wizard.creating') : t('wizard.create')}
              </button>
              {progress && (
                <span className={`badge ${progress.stage === 'error' ? 'error-badge' : ''}`}>
                  {progress.stage === 'done' ? <Check size={13} /> : <ChevronRight size={13} />}
                  {progressLabel}
                </span>
              )}
            </div>
            {progress && progress.stage === 'downloading' && (
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.percent ?? 0}%` }} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
