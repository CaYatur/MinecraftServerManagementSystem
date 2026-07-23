import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Globe2,
  Check,
  Plus,
  Trash2,
  Image as ImageIcon,
  ExternalLink,
  X,
  Palette,
  Languages,
  Newspaper,
  Server as ServerIcon
} from 'lucide-react'
import { useStore } from '../store'
import type { SiteConfig, SitePost, WebStatus, SiteLayout, HeroStyle } from '@shared/web'

type Tab = 'general' | 'design' | 'servers' | 'langs' | 'posts'
const LAYOUTS: SiteLayout[] = ['modern', 'classic', 'compact']
const HEROES: HeroStyle[] = ['gradient', 'image', 'minimal']

export function SiteView(): JSX.Element {
  const { t } = useTranslation()
  const servers = useStore((s) => s.servers)
  const toast = useStore((s) => s.toast)
  const [cfg, setCfg] = useState<SiteConfig | null>(null)
  const [web, setWeb] = useState<WebStatus | null>(null)
  const [tab, setTab] = useState<Tab>('general')
  const [post, setPost] = useState<SitePost | null>(null)
  const [langCode, setLangCode] = useState('en')
  const [newLang, setNewLang] = useState('')
  const [filter, setFilter] = useState('')

  const refresh = async (): Promise<void> => {
    setCfg(await window.msms.getSiteConfig())
    setWeb(await window.msms.getWebStatus())
  }
  useEffect(() => {
    void refresh()
  }, [])

  if (!cfg) return <div className="center-fill" />

  const siteBase = (): string =>
    web?.site.urls?.[0] ?? web?.panel.urls?.[0] ?? `http://127.0.0.1:${web?.site.port ?? 8723}`
  const imgUrl = (name: string): string => `${siteBase()}/uploads/${encodeURIComponent(name)}`
  const patch = (p: Partial<SiteConfig>): void => setCfg({ ...cfg, ...p })
  const patchTheme = (p: Partial<SiteConfig['theme']>): void =>
    setCfg({ ...cfg, theme: { ...cfg.theme, ...p } })

  const save = async (): Promise<void> => {
    const next = await window.msms.setSiteConfig({
      serverIds: cfg.serverIds,
      storeServerId: cfg.storeServerId,
      siteName: cfg.siteName,
      tagline: cfg.tagline,
      description: cfg.description,
      discordUrl: cfg.discordUrl,
      showStore: cfg.showStore,
      theme: cfg.theme,
      i18n: cfg.i18n
    })
    setCfg(next)
    toast('success', 'site.saved')
  }

  const pick = async (): Promise<string | null> => window.msms.uploadSiteImage()

  const savePost = async (): Promise<void> => {
    if (!post) return
    await window.msms.upsertSitePost(post)
    setPost(null)
    toast('success', 'site.saved')
    void refresh()
  }

  const TABS: { id: Tab; icon: JSX.Element; label: string }[] = [
    { id: 'general', icon: <Globe2 size={14} />, label: t('site.tabGeneral') },
    { id: 'design', icon: <Palette size={14} />, label: t('site.tabDesign') },
    { id: 'servers', icon: <ServerIcon size={14} />, label: t('site.tabServers') },
    { id: 'langs', icon: <Languages size={14} />, label: t('site.tabLangs') },
    { id: 'posts', icon: <Newspaper size={14} />, label: t('site.posts') }
  ]

  const strings = cfg.i18n.langs[langCode] ?? {}
  const keys = Object.keys(cfg.i18n.langs.en ?? {}).filter(
    (k) => !filter || k.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="section-title" style={{ margin: 0 }}>
          <Globe2 size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
          {t('site.title')}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => window.msms.openExternal(siteBase())}>
            <ExternalLink size={13} /> {t('site.open')}
          </button>
          <button className="btn primary sm" onClick={save}>
            <Check size={13} /> {t('common.save')}
          </button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>{t('site.desc')}</p>

      <div className="tabs" style={{ border: 'none', padding: 0, marginBottom: 14 }}>
        {TABS.map((tb) => (
          <button key={tb.id} className={`tab ${tab === tb.id ? 'active' : ''}`} onClick={() => setTab(tb.id)}>
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="panel">
          <div className="field">
            <label>{t('site.siteName')}</label>
            <input className="input" value={cfg.siteName} onChange={(e) => patch({ siteName: e.target.value })} />
          </div>
          <div className="field">
            <label>{t('site.tagline')}</label>
            <input className="input" value={cfg.tagline} onChange={(e) => patch({ tagline: e.target.value })} />
          </div>
          <div className="field">
            <label>{t('site.description')}</label>
            <textarea className="input" style={{ minHeight: 80 }} value={cfg.description} onChange={(e) => patch({ description: e.target.value })} />
          </div>
          <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <label>{t('site.discord')}</label>
              <input className="input" value={cfg.discordUrl} onChange={(e) => patch({ discordUrl: e.target.value })} placeholder="https://discord.gg/…" />
            </div>
            <div className="field" style={{ minWidth: 190, marginBottom: 0 }}>
              <label>{t('site.storeServer')}</label>
              <select className="select" value={cfg.storeServerId} onChange={(e) => patch({ storeServerId: e.target.value })}>
                <option value="">{t('site.none')}</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <label className="switch" style={{ paddingBottom: 8 }}>
              <input type="checkbox" checked={cfg.showStore} onChange={(e) => patch({ showStore: e.target.checked })} />
              {t('site.showStore')}
            </label>
          </div>
        </div>
      )}

      {tab === 'design' && (
        <div className="panel">
          <div className="field">
            <label>{t('site.logo')}</label>
            <div className="row" style={{ gap: 8 }}>
              {cfg.theme.logo && <img src={imgUrl(cfg.theme.logo)} width={44} height={44} style={{ borderRadius: 10, objectFit: 'cover' }} alt="" />}
              <button className="btn sm" onClick={async () => { const n = await pick(); if (n) patchTheme({ logo: n }) }}>
                <ImageIcon size={13} /> {t('site.pickImage')}
              </button>
              {cfg.theme.logo && (
                <button className="btn ghost sm" onClick={() => patchTheme({ logo: undefined })}><X size={13} /></button>
              )}
            </div>
          </div>

          <div className="field-label" style={{ marginTop: 8 }}>{t('site.colors')}</div>
          <div className="row wrap" style={{ gap: 12 }}>
            {([['accent', t('site.accent')], ['bg', t('site.bgColor')], ['card', t('site.cardColor')], ['text', t('site.textColor')]] as const).map(([k, label]) => (
              <div className="field" key={k} style={{ width: 118 }}>
                <label>{label}</label>
                <input type="color" className="input" style={{ height: 38, padding: 4 }}
                  value={(cfg.theme as unknown as Record<string, string>)[k]}
                  onChange={(e) => patchTheme({ [k]: e.target.value } as Partial<SiteConfig['theme']>)} />
              </div>
            ))}
          </div>

          <div className="row wrap" style={{ gap: 12 }}>
            <div className="field" style={{ minWidth: 160 }}>
              <label>{t('site.layout')}</label>
              <select className="select" value={cfg.theme.layout} onChange={(e) => patchTheme({ layout: e.target.value as SiteLayout })}>
                {LAYOUTS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label>{t('site.heroStyle')}</label>
              <select className="select" value={cfg.theme.heroStyle} onChange={(e) => patchTheme({ heroStyle: e.target.value as HeroStyle })}>
                {HEROES.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div className="field" style={{ width: 150 }}>
              <label>{t('site.radius')}</label>
              <input className="input" type="number" value={cfg.theme.radius} onChange={(e) => patchTheme({ radius: Number(e.target.value) })} />
            </div>
          </div>

          {cfg.theme.heroStyle === 'image' && (
            <div className="field">
              <label>{t('site.heroImage')}</label>
              <div className="row" style={{ gap: 8 }}>
                {cfg.theme.heroImage && <img src={imgUrl(cfg.theme.heroImage)} width={90} height={44} style={{ borderRadius: 8, objectFit: 'cover' }} alt="" />}
                <button className="btn sm" onClick={async () => { const n = await pick(); if (n) patchTheme({ heroImage: n }) }}>
                  <ImageIcon size={13} /> {t('site.pickImage')}
                </button>
                {cfg.theme.heroImage && <button className="btn ghost sm" onClick={() => patchTheme({ heroImage: undefined })}><X size={13} /></button>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'servers' && (
        <div className="panel">
          <p className="hint" style={{ marginTop: 0 }}>{t('site.serversHint')}</p>
          {servers.length === 0 ? (
            <p className="dim">{t('sidebar.noServers')}</p>
          ) : (
            servers.map((s) => {
              const on = cfg.serverIds.includes(s.id)
              return (
                <div key={s.id} className="mod-row">
                  <label className="switch" style={{ flex: 1 }}>
                    <input type="checkbox" checked={on} onChange={(e) =>
                      patch({ serverIds: e.target.checked ? [...cfg.serverIds, s.id] : cfg.serverIds.filter((x) => x !== s.id) })} />
                    <span className="mod-name">{s.name}</span>
                  </label>
                  <span className="badge">{s.type} · {s.mcVersion}</span>
                  {cfg.storeServerId === s.id && <span className="badge op-badge">{t('site.storeServer')}</span>}
                </div>
              )
            })
          )}
        </div>
      )}

      {tab === 'langs' && (
        <div className="panel">
          <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 150, marginBottom: 0 }}>
              <label>{t('site.editLang')}</label>
              <select className="select" value={langCode} onChange={(e) => setLangCode(e.target.value)}>
                {Object.keys(cfg.i18n.langs).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field" style={{ minWidth: 150, marginBottom: 0 }}>
              <label>{t('site.defaultLang')}</label>
              <select className="select" value={cfg.i18n.defaultLang}
                onChange={(e) => patch({ i18n: { ...cfg.i18n, defaultLang: e.target.value } })}>
                {Object.keys(cfg.i18n.langs).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="hint" style={{ flexBasis: '100%', marginTop: 2 }}>{t('site.langAuto')}</div>
            <div className="field" style={{ width: 130, marginBottom: 0 }}>
              <label>{t('site.newLang')}</label>
              <input className="input" value={newLang} onChange={(e) => setNewLang(e.target.value)} placeholder="de" />
            </div>
            <button className="btn" onClick={async () => {
              if (!newLang.trim()) return
              try {
                const next = await window.msms.addSiteLanguage(newLang.trim().toLowerCase(), langCode)
                setCfg(next); setLangCode(newLang.trim().toLowerCase()); setNewLang('')
              } catch (e) { toast('error', String((e as Error)?.message ?? e)) }
            }}>
              <Plus size={13} /> {t('site.addLang')}
            </button>
            {langCode !== 'en' && langCode !== 'tr' && (
              <button className="btn danger" onClick={async () => {
                const next = await window.msms.removeSiteLanguage(langCode)
                setCfg(next); setLangCode('en')
              }}>
                <Trash2 size={13} />
              </button>
            )}
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <input className="input" placeholder={t('props.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div style={{ maxHeight: 420, overflow: 'auto' }}>
            {keys.map((k) => (
              <div key={k} className="prop-row">
                <div className="prop-info"><code>{k}</code>
                  <span className="prop-desc">{cfg.i18n.langs.en?.[k]}</span>
                </div>
                <div className="prop-control">
                  <input className="input" value={strings[k] ?? ''}
                    onChange={(e) => patch({ i18n: { ...cfg.i18n, langs: { ...cfg.i18n.langs, [langCode]: { ...strings, [k]: e.target.value } } } })} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'posts' && (
        <>
          <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
            <button className="btn sm" onClick={() => setPost({ id: '', title: '', body: '', images: [], at: Date.now() })}>
              <Plus size={13} /> {t('site.addPost')}
            </button>
          </div>
          {cfg.posts.length === 0 ? (
            <div className="panel"><p className="dim" style={{ margin: 0 }}>{t('site.noPosts')}</p></div>
          ) : (
            <div className="panel" style={{ padding: 0 }}>
              {cfg.posts.map((p) => (
                <div key={p.id} className="mod-row">
                  {p.cover ? (
                    <img src={imgUrl(p.cover)} width={48} height={32} style={{ borderRadius: 6, objectFit: 'cover' }} alt="" />
                  ) : (
                    <ImageIcon size={16} className="dim" />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mod-name">{p.title}</div>
                    <div className="dim" style={{ fontSize: 11 }}>
                      {new Date(p.at).toLocaleString()}
                      {p.updatedAt ? ` · ${t('site.updated')} ${new Date(p.updatedAt).toLocaleString()}` : ''}
                      {p.author ? ` · ${t('news.by') || 'by'} ${p.author}` : ''}
                      {p.images.length ? ` · ${p.images.length} 🖼` : ''}
                    </div>
                  </div>
                  <button className="btn ghost sm" onClick={() => setPost(JSON.parse(JSON.stringify(p)))}>{t('common.edit')}</button>
                  <button className="btn ghost sm danger" onClick={async () => { await window.msms.deleteSitePost(p.id); void refresh() }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {post && (
        <div className="modal-backdrop" onClick={() => setPost(null)}>
          <div className="modal" style={{ width: 'min(720px,95vw)' }} onClick={(e) => e.stopPropagation()}>
            <h3>{post.id ? t('site.editPost') : t('site.addPost')}</h3>
            <div style={{ maxHeight: '66vh', overflow: 'auto' }}>
              <div className="field">
                <label>{t('site.postTitle')}</label>
                <input className="input" value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} />
              </div>
              <div className="field">
                <label>{t('site.excerpt')}</label>
                <input className="input" value={post.excerpt ?? ''} onChange={(e) => setPost({ ...post, excerpt: e.target.value })} />
              </div>
              <div className="field">
                <label>{t('site.postBody')}</label>
                <textarea className="input" style={{ minHeight: 200 }} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} />
              </div>
              <div className="field">
                <label>{t('site.cover')}</label>
                <div className="row" style={{ gap: 8 }}>
                  {post.cover && <img src={imgUrl(post.cover)} width={84} height={48} style={{ borderRadius: 8, objectFit: 'cover' }} alt="" />}
                  <button className="btn sm" onClick={async () => { const n = await pick(); if (n) setPost({ ...post, cover: n }) }}>
                    <ImageIcon size={13} /> {t('site.pickImage')}
                  </button>
                  {post.cover && <button className="btn ghost sm" onClick={() => setPost({ ...post, cover: undefined })}><X size={13} /></button>}
                </div>
              </div>
              <div className="field">
                <label>{t('site.gallery')}</label>
                <div className="row wrap" style={{ gap: 8 }}>
                  {post.images.map((im, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={imgUrl(im)} width={70} height={70} style={{ borderRadius: 8, objectFit: 'cover' }} alt="" />
                      <button className="btn ghost sm" style={{ position: 'absolute', top: -6, right: -6, padding: 2 }}
                        onClick={() => setPost({ ...post, images: post.images.filter((_, x) => x !== i) })}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button className="btn sm" onClick={async () => { const n = await pick(); if (n) setPost({ ...post, images: [...post.images, n] }) }}>
                    <Plus size={13} /> {t('site.addImage')}
                  </button>
                </div>
              </div>
              {!(web?.site.running || web?.panel.running) && (
                <p className="hint">{t('site.enableForPreview')}</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setPost(null)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={savePost}><Check size={14} /> {t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
