import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe2, Check, Plus, Trash2, Image as ImageIcon, ExternalLink, X } from 'lucide-react'
import { useStore } from '../store'
import type { SiteConfig, SitePost, WebStatus } from '@shared/web'

export function SiteView(): JSX.Element {
  const { t } = useTranslation()
  const servers = useStore((s) => s.servers)
  const toast = useStore((s) => s.toast)
  const [cfg, setCfg] = useState<SiteConfig | null>(null)
  const [web, setWeb] = useState<WebStatus | null>(null)
  const [post, setPost] = useState<SitePost | null>(null)

  const refresh = async (): Promise<void> => {
    setCfg(await window.msms.getSiteConfig())
    setWeb(await window.msms.getWebStatus())
  }
  useEffect(() => {
    void refresh()
  }, [])

  if (!cfg) return <div className="center-fill" />

  const patch = (p: Partial<SiteConfig>): void => setCfg({ ...cfg, ...p })
  const saveSettings = async (): Promise<void> => {
    const next = await window.msms.setSiteConfig({
      serverId: cfg.serverId,
      siteName: cfg.siteName,
      tagline: cfg.tagline,
      description: cfg.description,
      accent: cfg.accent,
      discordUrl: cfg.discordUrl,
      showStore: cfg.showStore
    })
    setCfg(next)
    toast('success', 'site.saved')
  }
  const openSite = (): void => {
    const url = web?.urls?.[0] ?? `http://127.0.0.1:${web?.port ?? 8722}`
    void window.msms.openExternal(url)
  }
  const savePost = async (): Promise<void> => {
    if (!post) return
    await window.msms.upsertSitePost(post)
    setPost(null)
    toast('success', 'site.saved')
    void refresh()
  }
  const pickImage = async (): Promise<void> => {
    const name = await window.msms.uploadSiteImage()
    if (name && post) setPost({ ...post, image: name })
  }
  const imgUrl = (name: string): string =>
    `${web?.urls?.[0] ?? `http://127.0.0.1:${web?.port ?? 8722}`}/uploads/${encodeURIComponent(name)}`

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="section-title" style={{ margin: 0 }}>
          <Globe2 size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
          {t('site.title')}
        </div>
        <button className="btn sm" onClick={openSite}>
          <ExternalLink size={13} /> {t('site.open')}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>{t('site.desc')}</p>

      <div className="panel">
        <div className="row wrap" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>{t('site.server')}</label>
            <select className="select" value={cfg.serverId} onChange={(e) => patch({ serverId: e.target.value })}>
              <option value="">{t('site.none')}</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200 }}>
            <label>{t('site.siteName')}</label>
            <input className="input" value={cfg.siteName} onChange={(e) => patch({ siteName: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>{t('site.tagline')}</label>
          <input className="input" value={cfg.tagline} onChange={(e) => patch({ tagline: e.target.value })} />
        </div>
        <div className="field">
          <label>{t('site.description')}</label>
          <textarea className="input" style={{ minHeight: 70 }} value={cfg.description} onChange={(e) => patch({ description: e.target.value })} />
        </div>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ width: 120, marginBottom: 0 }}>
            <label>{t('site.accent')}</label>
            <input type="color" className="input" style={{ height: 38, padding: 4 }} value={cfg.accent} onChange={(e) => patch({ accent: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
            <label>{t('site.discord')}</label>
            <input className="input" value={cfg.discordUrl} onChange={(e) => patch({ discordUrl: e.target.value })} placeholder="https://discord.gg/…" />
          </div>
          <label className="switch" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={cfg.showStore} onChange={(e) => patch({ showStore: e.target.checked })} />
            {t('site.showStore')}
          </label>
        </div>
        <button className="btn primary" onClick={saveSettings}><Check size={14} /> {t('common.save')}</button>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 22 }}>
        <div className="section-title" style={{ margin: 0 }}>{t('site.posts')}</div>
        <button className="btn sm" onClick={() => setPost({ id: '', title: '', body: '', at: Date.now() })}>
          <Plus size={13} /> {t('site.addPost')}
        </button>
      </div>
      {cfg.posts.length === 0 ? (
        <div className="panel"><p className="dim" style={{ margin: 0 }}>{t('site.noPosts')}</p></div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {cfg.posts.map((p) => (
            <div key={p.id} className="mod-row">
              {p.image ? <img src={imgUrl(p.image)} width={36} height={36} style={{ borderRadius: 6, objectFit: 'cover' }} alt="" /> : <ImageIcon size={16} className="dim" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mod-name">{p.title}</div>
                <div className="dim" style={{ fontSize: 11 }}>{new Date(p.at).toLocaleString()}</div>
              </div>
              <button className="btn ghost sm" onClick={() => setPost(JSON.parse(JSON.stringify(p)))}>{t('common.edit')}</button>
              <button className="btn ghost sm danger" onClick={async () => { await window.msms.deleteSitePost(p.id); void refresh() }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {post && (
        <div className="modal-backdrop" onClick={() => setPost(null)}>
          <div className="modal" style={{ width: 'min(620px,94vw)' }} onClick={(e) => e.stopPropagation()}>
            <h3>{post.id ? t('site.editPost') : t('site.addPost')}</h3>
            <div className="field">
              <label>{t('site.postTitle')}</label>
              <input className="input" value={post.title} onChange={(e) => setPost({ ...post, title: e.target.value })} />
            </div>
            <div className="field">
              <label>{t('site.postBody')}</label>
              <textarea className="input" style={{ minHeight: 120 }} value={post.body} onChange={(e) => setPost({ ...post, body: e.target.value })} />
            </div>
            <div className="field">
              <label>{t('site.image')}</label>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn sm" onClick={pickImage}><ImageIcon size={13} /> {t('site.pickImage')}</button>
                {post.image && (
                  <>
                    <img src={imgUrl(post.image)} width={40} height={40} style={{ borderRadius: 6, objectFit: 'cover' }} alt="" />
                    <button className="btn ghost sm" onClick={() => setPost({ ...post, image: undefined })}><X size={13} /></button>
                  </>
                )}
              </div>
              {!web?.running && <p className="hint" style={{ marginTop: 4 }}>Enable the web panel to preview images.</p>}
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
