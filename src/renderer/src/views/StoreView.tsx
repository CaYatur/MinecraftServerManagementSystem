import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Trash2, Plus, Minus, Package, Gift, Coins, X } from 'lucide-react'
import { useStore } from '../store'
import type { Product, CrateReward, StoreConfig, LedgerEntry } from '@shared/web'

type StoreData = StoreConfig & { balances: Record<string, number> }
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
  const [edit, setEdit] = useState<Product | null>(null)
  const [cmdText, setCmdText] = useState('')

  const load = async (): Promise<void> => {
    const d = await window.msms.getStore(id)
    setData(d)
    setCurrency(d.currency)
    setLedger(await window.msms.getStoreLedger(id))
  }
  useEffect(() => {
    void load()
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
      if (mode === 'set') await window.msms.setStoreBalance(id, name, amount, balReason)
      else await window.msms.addStoreBalance(id, name, mode === 'remove' ? -amount : amount, balReason)
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
    await window.msms.upsertStoreProduct(id, product)
    setEdit(null)
    toast('success', 'store.saved')
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

      <div className="panel">
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label>{t('store.currency')}</label>
            <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </div>
          <button className="btn primary" onClick={saveCurrency}>
            <Check size={14} /> {t('common.save')}
          </button>
        </div>
      </div>

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

      <div className="section-title">{t('store.ledger')}</div>
      <div className="panel" style={{ padding: 0 }}>
        {ledger.length === 0 ? (
          <p className="dim" style={{ margin: 0, padding: 14 }}>{t('store.noLedger')}</p>
        ) : (
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {ledger.map((e) => (
              <div key={e.id} className="mod-row">
                <span className={`badge ${e.delta >= 0 ? 'op-badge' : 'error-badge'}`}>
                  {e.delta >= 0 ? '+' : ''}{e.delta}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mod-name">{e.mcName} <span className="dim" style={{ fontWeight: 400 }}>→ {e.balanceAfter} {currency}</span></div>
                  <div className="dim" style={{ fontSize: 11 }}>
                    {e.kind} · {t('store.by')} {e.by}{e.reason ? ` · ${e.reason}` : ''} · {new Date(e.at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
            <div key={p.id} className="mod-row">
              {p.type === 'crate' ? <Gift size={16} /> : <Package size={16} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mod-name">{p.name} <span className="badge">{t(`store.${p.type}`)}</span></div>
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
              <div className="field">
                <label>{t('store.icon')}</label>
                <input className="input" value={edit.icon} onChange={(e) => setEdit({ ...edit, icon: e.target.value })} />
              </div>

              {edit.type === 'item' ? (
                <div className="field">
                  <label>{t('store.commands')}</label>
                  <textarea className="input" style={{ minHeight: 90 }} value={cmdText} onChange={(e) => setCmdText(e.target.value)} />
                  <p className="hint" style={{ marginTop: 4 }}>{t('store.commandsHint')}</p>
                </div>
              ) : (
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
                        <input className="input" style={{ marginTop: 6 }} placeholder={t('store.icon')} value={r.icon ?? ''} onChange={(e) => updReward(i, { icon: e.target.value })} />
                        <textarea className="input" style={{ minHeight: 48, marginTop: 6 }} placeholder="give {player} minecraft:diamond 3" value={r.commands.join('\n')} onChange={(e) => updReward(i, { commands: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })} />
                      </div>
                    ))
                  })()}
                  <button className="btn sm" onClick={() => setEdit({ ...edit, rewards: [...edit.rewards, { name: '', weight: 10, commands: [] }] })}>
                    <Plus size={13} /> {t('store.addReward')}
                  </button>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
              <button className="btn primary" onClick={saveProduct}><Check size={14} /> {t('common.save')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
