import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Trash2,
  Plus,
  Minus,
  Package,
  Gift,
  Coins,
  X,
  Tag,
  Play,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { useStore } from '../store'
import { categoryName, filterLedger, ledgerSummary } from '@shared/economy'
import { CRATE_ANIMATIONS, DEFAULT_CRATE_ANIMATION, resolveCrateAnimation } from '@shared/crate'
import type { CrateAnimation } from '@shared/crate'
import { CratePreview } from '../components/CratePreview'
import { ImageField, previewSrc } from '../components/ImageField'
import { MAX_PRODUCT_IMAGES, STORE_LAYOUTS, normalizeLayout } from '@shared/storefront'
import type { StoreLayout } from '@shared/storefront'
import type { LedgerKind } from '@shared/economy'
import type {
  Product,
  CrateReward,
  StoreConfig,
  LedgerEntry,
  EconomyCategory
} from '@shared/web'

type StoreData = StoreConfig & { balances: Record<string, number>; categories: EconomyCategory[] }
const uid = (): string => Math.random().toString(36).slice(2)

function emptyProduct(type: 'item' | 'crate'): Product {
  return { id: '', type, name: '', description: '', price: 100, icon: '', commands: [], rewards: [] }
}

export function StoreView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const toast = useStore((s) => s.toast)
  const [data, setData] = useState<StoreData | null>(null)
  const [currency, setCurrency] = useState('Coins')
  const [balPlayer, setBalPlayer] = useState('')
  const [balAmount, setBalAmount] = useState(100)
  const [balReason, setBalReason] = useState('')
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [ledgerQuery, setLedgerQuery] = useState('')
  const [ledgerKind, setLedgerKind] = useState<LedgerKind | 'all'>('all')
  const [ledgerCat, setLedgerCat] = useState<string>('all')
  const [section, setSection] = useState<'economy' | 'store'>('economy')
  const [balCategory, setBalCategory] = useState('')
  const [newCat, setNewCat] = useState('')
  const [crateAnim, setCrateAnim] = useState<CrateAnimation>(DEFAULT_CRATE_ANIMATION)
  const [layout, setLayout] = useState<StoreLayout>('crates-first')
  const [edit, setEdit] = useState<Product | null>(null)
  const [cmdText, setCmdText] = useState('')
  // What the preview modal is playing, and with which rewards. Null = closed.
  const [preview, setPreview] = useState<{
    animation: CrateAnimation
    pool: { name: string; icon?: string }[]
  } | null>(null)

  const summary = useMemo(() => ledgerSummary(ledger), [ledger])
  const shownLedger = useMemo(
    () => filterLedger(ledger, { text: ledgerQuery, kind: ledgerKind, category: ledgerCat }),
    [ledger, ledgerQuery, ledgerKind, ledgerCat]
  )
  const categories = data?.categories ?? []

  const load = async (): Promise<void> => {
    const d = await window.msms.getStore(id)
    setData(d)
    setCurrency(d.currency)
    setCrateAnim(d.crateAnimation ?? DEFAULT_CRATE_ANIMATION)
    setLayout(normalizeLayout(d.layout))
    setLedger(await window.msms.getStoreLedger(id))
  }
  useEffect(() => {
    void load()
    // The filter belongs to the ledger being looked at. Carrying it to another
    // server silently hides that server's entries behind a search the user
    // cannot see, because the section is collapsed again.
    setLedgerQuery('')
    setLedgerKind('all')
    setLedgerCat('all')
    setLedgerOpen(false)
    setBalCategory('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const saveCurrency = async (): Promise<void> => {
    await window.msms.setStoreCurrency(id, currency)
    toast('success', 'store.saved')
    void load()
  }
  const changeBalance = async (mode: 'add' | 'remove' | 'set'): Promise<void> => {
    const name = balPlayer.trim()
    if (!name) return
    const amount = Number(balAmount)
    try {
      const cat = balCategory || undefined
      if (mode === 'set') await window.msms.setStoreBalance(id, name, amount, balReason, cat)
      else
        await window.msms.addStoreBalance(
          id,
          name,
          mode === 'remove' ? -amount : amount,
          balReason,
          cat
        )
      toast('success', 'store.delivered', { player: name, amount })
      setBalReason('')
      void load()
    } catch (e) {
      toast('error', String((e as Error)?.message ?? e))
    }
  }
  const openEdit = (p: Product): void => {
    setEdit(JSON.parse(JSON.stringify(p)))
    setCmdText((p.commands ?? []).join('\n'))
  }
  const saveProduct = async (): Promise<void> => {
    if (!edit) return
    const product: Product = {
      ...edit,
      commands: edit.type === 'item' ? cmdText.split('\n').map((s) => s.trim()).filter(Boolean) : [],
      rewards: edit.type === 'crate' ? edit.rewards : []
    }
    // Dropped rather than sent empty: an absent animation means "inherit the
    // store default", and a crate that stored today's default would silently
    // stop following it the moment the operator changed that default.
    if (product.type !== 'crate' || !product.crateAnimation) delete product.crateAnimation
    await window.msms.upsertStoreProduct(id, product)
    setEdit(null)
    toast('success', 'store.saved')
    void load()
  }
  // The setter that fed the removed store-wide picker went with it. The IPC
  // channel and `setCrateAnimation` stay: the web panel still offers the
  // fallback, and a stored value is still what "inherit" resolves to.
  const saveLayout = async (next: StoreLayout): Promise<void> => {
    const previous = layout
    setLayout(next)
    try {
      setLayout(await window.msms.setStoreLayout(id, next))
      toast('success', 'store.saved')
    } catch (e) {
      setLayout(previous)
      toast('error', String((e as Error)?.message ?? e))
    }
  }
  const addCategory = async (): Promise<void> => {
    const name = newCat.trim()
    if (!name) return
    await window.msms.upsertEconomyCategory(id, { id: '', name })
    setNewCat('')
    void load()
  }
  const removeCategory = async (catId: string): Promise<void> => {
    await window.msms.deleteEconomyCategory(id, catId)
    // A ledger entry keeps the id it was recorded with; only the picker shrinks.
    if (balCategory === catId) setBalCategory('')
    if (ledgerCat === catId) setLedgerCat('all')
    void load()
  }
  const updReward = (i: number, patch: Partial<CrateReward>): void => {
    if (!edit) return
    const rewards = edit.rewards.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    setEdit({ ...edit, rewards })
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        <Coins size={15} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('store.title')}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>{t('store.desc')}</p>

      {/* The economy (balances, categories, ledger) is its own thing - it runs
          on grants, refunds and payouts that have no product behind them (#13). */}
      <div className="tabs" style={{ border: 'none', padding: 0, marginBottom: 14 }}>
        <button
          className={`tab ${section === 'economy' ? 'active' : ''}`}
          onClick={() => setSection('economy')}
        >
          {t('store.sectionEconomy')}
        </button>
        <button
          className={`tab ${section === 'store' ? 'active' : ''}`}
          onClick={() => setSection('store')}
        >
          {t('store.sectionStore')}
        </button>
      </div>

      <div className="panel" style={{ display: section === 'store' ? undefined : 'none' }}>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label>{t('store.currency')}</label>
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </div>
          <button className="btn primary" onClick={saveCurrency}>
            <Check size={14} /> {t('common.save')}
          </button>
        </div>

        {/* The store-wide crate animation used to be set here, under the
            currency. It is gone: every crate carries its own, chosen and
            previewed in the crate editor where the person deciding is already
            looking at that crate. A second control setting the fallback for a
            field nobody leaves unset is a setting to get wrong.
            `crateAnim` survives as the value the per-crate "inherit" option
            resolves to, so existing crates that never chose one still play
            something. */}

        {/* Crates and items are different things to shop for, so the storefront
            can put them in separate sections (#80). */}
        <div className="field" style={{ marginTop: 14, marginBottom: 0, maxWidth: 420 }}>
          <label>{t('store.layout')}</label>
          <select
            className="select"
            value={layout}
            onChange={(e) => void saveLayout(e.target.value as StoreLayout)}
          >
            {STORE_LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {t(`store.layout_${l}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: section === 'economy' ? undefined : 'none' }}>
      <div className="section-title">{t('store.loadBalance')}</div>
      <div className="panel">
        <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <label>{t('store.player')}</label>
            <input className="input" value={balPlayer} onChange={(e) => setBalPlayer(e.target.value)} placeholder="Steve" />
          </div>
          <div className="field" style={{ width: 120, marginBottom: 0 }}>
            <label>{t('store.amount')}</label>
            <input className="input" type="number" value={balAmount} onChange={(e) => setBalAmount(Number(e.target.value))} />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
            <label>{t('store.reason')}</label>
            <input className="input" value={balReason} onChange={(e) => setBalReason(e.target.value)} />
          </div>
          <div className="field" style={{ width: 160, marginBottom: 0 }}>
            <label>{t('store.category')}</label>
            <select
              className="input"
              value={balCategory}
              onChange={(e) => setBalCategory(e.target.value)}
            >
              <option value="">{t('store.noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          <button className="btn primary" onClick={() => changeBalance('add')}>
            <Plus size={14} /> {t('store.give')}
          </button>
          <button className="btn" onClick={() => changeBalance('remove')}>
            <Minus size={14} /> {t('store.remove')}
          </button>
          <button className="btn" onClick={() => changeBalance('set')}>
            <Coins size={14} /> {t('store.set')}
          </button>
        </div>

        {data && Object.keys(data.balances).length > 0 && (
          <>
            <div className="field-label" style={{ marginTop: 16 }}>{t('store.balances')}</div>
            <div className="bal-grid">
              {Object.entries(data.balances).map(([n, b]) => (
                <div key={n} className="bal-row">
                  <span className="mod-name" style={{ flex: 1 }}>{n}</span>
                  <span className="price">{b} {currency}</span>
                  <button className="btn ghost sm" title={t('store.player')} onClick={() => setBalPlayer(n)}>
                    <Coins size={13} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Categories are the economy's own vocabulary, not store products (#13). */}
      <div className="section-title">
        <Tag size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('store.categories')}
      </div>
      <div className="panel">
        <p className="hint" style={{ marginTop: 0 }}>{t('store.categoriesHint')}</p>
        <div className="row wrap" style={{ gap: 6, marginBottom: 10 }}>
          {categories.length === 0 ? (
            <span className="dim" style={{ fontSize: 12 }}>{t('store.noCategories')}</span>
          ) : (
            categories.map((c) => (
              <span
                key={c.id}
                className="badge"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <span style={{ color: c.color }}>{c.name}</span>
                <button
                  className="btn ghost sm"
                  style={{ padding: 0, lineHeight: 1 }}
                  title={t('common.delete')}
                  onClick={() => void removeCategory(c.id)}
                >
                  <X size={11} />
                </button>
              </span>
            ))
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 140 }}
            placeholder={t('store.newCategory')}
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addCategory()}
          />
          <button className="btn primary sm" onClick={() => void addCategory()} disabled={!newCat.trim()}>
            <Plus size={13} /> {t('common.add')}
          </button>
        </div>
      </div>

      {/* Collapsed by default (#14): the ledger is a long audit list, not
          something you need in front of you to run the store. The header still
          carries the totals so it says something useful while closed. */}
      <div className="section-title">
        <button
          className="btn ghost sm"
          onClick={() => setLedgerOpen((v) => !v)}
          style={{ padding: '2px 6px', marginRight: 6 }}
          aria-expanded={ledgerOpen}
        >
          {ledgerOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {t('store.ledger')}
        {summary.count > 0 && (
          <span className="dim" style={{ fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
            {t('store.ledgerSummary', {
              n: summary.count,
              granted: summary.granted,
              removed: summary.removed,
              spent: summary.spent
            })}
          </span>
        )}
      </div>
      {ledgerOpen && (
        <div className="panel" style={{ padding: 0 }}>
          {ledger.length === 0 ? (
            <p className="dim" style={{ margin: 0, padding: 14 }}>{t('store.noLedger')}</p>
          ) : (
            <>
              <div className="row wrap" style={{ gap: 8, padding: 10, alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 160 }}
                  placeholder={t('store.ledgerSearch')}
                  value={ledgerQuery}
                  onChange={(e) => setLedgerQuery(e.target.value)}
                />
                <select
                  className="input"
                  style={{ width: 150 }}
                  value={ledgerKind}
                  onChange={(e) => setLedgerKind(e.target.value as LedgerKind | 'all')}
                >
                  <option value="all">{t('store.kindAll')}</option>
                  <option value="grant">{t('store.kindGrant')}</option>
                  <option value="remove">{t('store.kindRemove')}</option>
                  <option value="set">{t('store.kindSet')}</option>
                  <option value="purchase">{t('store.kindPurchase')}</option>
                </select>
                <select
                  className="input"
                  style={{ width: 160 }}
                  value={ledgerCat}
                  onChange={(e) => setLedgerCat(e.target.value)}
                >
                  <option value="all">{t('store.catAll')}</option>
                  <option value="none">{t('store.catNone')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="dim" style={{ fontSize: 11 }}>
                  {t('store.ledgerShowing', { shown: shownLedger.length, total: ledger.length })}
                </span>
              </div>
              {shownLedger.length === 0 ? (
                <p className="dim" style={{ margin: 0, padding: 14 }}>{t('store.noLedgerMatch')}</p>
              ) : (
                <div style={{ maxHeight: 300, overflow: 'auto' }}>
                  {shownLedger.map((e) => (
                    <div key={e.id} className="mod-row">
                      <span className={`badge ${e.delta >= 0 ? 'op-badge' : 'error-badge'}`}>
                        {e.delta >= 0 ? '+' : ''}{e.delta}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mod-name">{e.mcName} <span className="dim" style={{ fontWeight: 400 }}>→ {e.balanceAfter} {currency}</span></div>
                        <div className="dim" style={{ fontSize: 11 }}>
                          {e.kind} · {t('store.by')} {e.by}
                          {e.category ? ` · ${categoryName(categories, e.category)}` : ''}
                          {e.reason ? ` · ${e.reason}` : ''} · {new Date(e.at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      </div>

      <div style={{ display: section === 'store' ? undefined : 'none' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 22 }}>
        <div className="section-title" style={{ margin: 0 }}>{t('store.products')}</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm" onClick={() => { setEdit(emptyProduct('item')); setCmdText('') }}>
            <Package size={13} /> {t('store.addItem')}
          </button>
          <button className="btn sm" onClick={() => { const p = emptyProduct('crate'); p.rewards = [{ name: 'Common', weight: 70, commands: [] }]; setEdit(p); setCmdText('') }}>
            <Gift size={13} /> {t('store.addCrate')}
          </button>
        </div>
      </div>

      {!data || data.products.length === 0 ? (
        <div className="panel"><p className="dim" style={{ margin: 0 }}>{t('store.noProducts')}</p></div>
      ) : (
        <div className="panel" style={{ padding: 0 }}>
          {data.products.map((p) => (
            <div key={p.id} className="mod-row" style={{ opacity: p.hidden ? 0.55 : 1 }}>
              {p.icon ? (
                <img
                  src={previewSrc(p.icon)}
                  alt=""
                  style={{
                    width: 26,
                    height: 26,
                    objectFit: 'contain',
                    imageRendering: 'pixelated',
                    flex: 'none'
                  }}
                />
              ) : p.type === 'crate' ? (
                <Gift size={16} />
              ) : (
                <Package size={16} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mod-name">
                  {p.name} <span className="badge">{t(`store.${p.type}`)}</span>
                  {p.hidden && <span className="badge">{t('store.hidden')}</span>}
                  {typeof p.stock === 'number' && (
                    <span className={`badge ${p.stock === 0 ? 'error-badge' : ''}`}>
                      {p.stock === 0 ? t('store.outOfStock') : t('store.stockLeft', { n: p.stock })}
                    </span>
                  )}
                </div>
                <div className="dim" style={{ fontSize: 11 }}>{p.price} {currency} · {p.description}</div>
              </div>
              <button className="btn ghost sm" onClick={() => openEdit(p)}>{t('common.edit')}</button>
              <button className="btn ghost sm danger" onClick={async () => { await window.msms.deleteStoreProduct(id, p.id); void load() }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      </div>

      {edit && (
        <div className="modal-backdrop" onClick={() => setEdit(null)}>
          <div className="modal" style={{ width: 'min(640px,94vw)' }} onClick={(e) => e.stopPropagation()}>
            <h3>{edit.type === 'crate' ? t('store.editCrate') : t('store.editItem')}</h3>
            <div style={{ maxHeight: '64vh', overflow: 'auto' }}>
              <div className="row wrap" style={{ gap: 10 }}>
                <div className="field" style={{ flex: 1, minWidth: 160 }}>
                  <label>{t('store.name')}</label>
                  <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                </div>
                <div className="field" style={{ width: 120 }}>
                  <label>{t('store.price')}</label>
                  <input className="input" type="number" value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} />
                </div>
              </div>
              <div className="field">
                <label>{t('store.productDesc')}</label>
                <input className="input" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              </div>
              <ImageField
                label={t('store.icon')}
                value={edit.icon}
                onChange={(icon) => setEdit({ ...edit, icon })}
              />

              {/* A rank or a kit is worth more than one picture (#77). */}
              <div className="field">
                <label>{t('store.gallery')}</label>
                {(edit.images ?? []).map((img, i) => (
                  <ImageField
                    key={i}
                    compact
                    value={img}
                    onChange={(next) =>
                      setEdit({
                        ...edit,
                        // An emptied slot is removed rather than kept as a
                        // blank, so clearing one is how you delete it.
                        images: (edit.images ?? [])
                          .map((x, idx) => (idx === i ? next : x))
                          .filter((x) => x.trim())
                      })
                    }
                  />
                ))}
                {(edit.images?.length ?? 0) < MAX_PRODUCT_IMAGES && (
                  <button
                    className="btn sm"
                    onClick={() => setEdit({ ...edit, images: [...(edit.images ?? []), ''] })}
                  >
                    <Plus size={13} /> {t('store.addImage')}
                  </button>
                )}
              </div>

              {/* Availability (#81). Blank means unlimited; 0 means sold out. */}
              <div className="row wrap" style={{ gap: 10 }}>
                <div className="field" style={{ width: 120 }}>
                  <label>{t('store.stock')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={edit.stock ?? ''}
                    placeholder={t('store.unlimited')}
                    onChange={(e) =>
                      setEdit({ ...edit, stock: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                  />
                </div>
                <div className="field" style={{ width: 140 }}>
                  <label>{t('store.perPlayerLimit')}</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={edit.perPlayerLimit ?? ''}
                    placeholder={t('store.unlimited')}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        perPlayerLimit: e.target.value === '' ? undefined : Number(e.target.value)
                      })
                    }
                  />
                </div>
                <div className="field" style={{ width: 110 }}>
                  <label>{t('store.sortOrder')}</label>
                  <input
                    className="input"
                    type="number"
                    value={edit.sort ?? ''}
                    placeholder="—"
                    onChange={(e) =>
                      setEdit({ ...edit, sort: e.target.value === '' ? undefined : Number(e.target.value) })
                    }
                  />
                </div>
                <label className="switch" style={{ alignSelf: 'center', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={!!edit.hidden}
                    onChange={() => setEdit({ ...edit, hidden: !edit.hidden })}
                  />
                  {t('store.hidden')}
                </label>
              </div>
              <p className="hint" style={{ marginTop: 0 }}>{t('store.availabilityHint')}</p>

              {edit.type === 'item' ? (
                <div className="field">
                  <label>{t('store.commands')}</label>
                  <textarea className="input" style={{ minHeight: 90 }} value={cmdText} onChange={(e) => setCmdText(e.target.value)} />
                  <p className="hint" style={{ marginTop: 4 }}>{t('store.commandsHint')}</p>
                </div>
              ) : (
                <>
                {/* Per crate, falling back to the store default (#75). The
                    daily crate and the once-a-month one should not have to
                    feel the same. */}
                <div className="field">
                  <label>
                    <Gift size={13} style={{ verticalAlign: -2, marginRight: 5 }} />
                    {t('store.crateAnimation')}
                  </label>
                  <div className="row" style={{ gap: 8 }}>
                    <select
                      className="input"
                      style={{ flex: 1 }}
                      value={edit.crateAnimation ?? ''}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          crateAnimation: (e.target.value || undefined) as CrateAnimation | undefined
                        })
                      }
                    >
                      <option value="">
                        {t('store.animInherit', { name: t(`store.anim_${crateAnim}`) })}
                      </option>
                      {CRATE_ANIMATIONS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {t(`store.anim_${a.id}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn sm"
                      onClick={() =>
                        setPreview({
                          animation: resolveCrateAnimation(edit, crateAnim),
                          pool: edit.rewards
                            .filter((r) => r.name.trim())
                            .map((r) => ({ name: r.name, icon: r.icon }))
                        })
                      }
                    >
                      <Play size={13} /> {t('store.preview')}
                    </button>
                  </div>
                  <p className="hint" style={{ marginBottom: 0 }}>
                    {t(`store.animDesc_${resolveCrateAnimation(edit, crateAnim)}`)}
                  </p>
                </div>

                <div className="field">
                  <label>{t('store.rewards')}</label>
                  {(() => {
                    const totalW = edit.rewards.reduce((s, r) => s + Math.max(0, r.weight), 0) || 1
                    return edit.rewards.map((r, i) => (
                      <div key={i} className="panel" style={{ padding: 10, marginBottom: 8 }}>
                        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                          <input className="input" style={{ flex: 1, minWidth: 110 }} placeholder={t('store.rewardName')} value={r.name} onChange={(e) => updReward(i, { name: e.target.value })} />
                          <input className="input" style={{ width: 80 }} type="number" placeholder={t('store.weight')} value={r.weight} onChange={(e) => updReward(i, { weight: Number(e.target.value) })} />
                          <span className="badge" title={t('store.weight')}>{Math.round((Math.max(0, r.weight) / totalW) * 100)}%</span>
                          <button className="btn ghost sm danger" onClick={() => setEdit({ ...edit, rewards: edit.rewards.filter((_, idx) => idx !== i) })}><X size={13} /></button>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <ImageField compact value={r.icon} onChange={(icon) => updReward(i, { icon })} />
                        </div>
                        <textarea className="input" style={{ minHeight: 48, marginTop: 6 }} placeholder="give {player} minecraft:diamond 3" value={r.commands.join('\n')} onChange={(e) => updReward(i, { commands: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                      </div>
                    ))
                  })()}
                  <button className="btn sm" onClick={() => setEdit({ ...edit, rewards: [...edit.rewards, { name: '', weight: 10, commands: [] }] })}>
                    <Plus size={13} /> {t('store.addReward')}
                  </button>
                </div>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={saveProduct}><Check size={14} /> {t('common.save')}</button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <CratePreview
          animation={preview.animation}
          pool={preview.pool}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
