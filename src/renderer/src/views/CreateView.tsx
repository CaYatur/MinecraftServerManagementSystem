import { useTranslation } from 'react-i18next'
import { FolderPlus, Sparkles } from 'lucide-react'
import { useStore } from '../store'

export function CreateView(): JSX.Element {
  const { t } = useTranslation()
  const addExisting = useStore((s) => s.addExisting)

  return (
    <div className="content">
      <div className="section-title">{t('create.title')}</div>
      <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
        <Sparkles size={30} strokeWidth={1.4} />
        <h3 style={{ margin: '14px 0 6px' }}>{t('create.title')}</h3>
        <p className="dim" style={{ maxWidth: 460, margin: '0 auto 18px' }}>
          {t('create.comingSoon')}
        </p>
        <button className="btn primary" onClick={addExisting}>
          <FolderPlus size={15} /> {t('sidebar.addExisting')}
        </button>
      </div>
    </div>
  )
}
