import { useTranslation } from 'react-i18next'
import { Hammer } from 'lucide-react'

export function Placeholder({ titleKey }: { titleKey: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="center-fill">
      <div>
        <Hammer size={30} strokeWidth={1.4} />
        <h3 style={{ margin: '12px 0 4px' }}>{t(titleKey)}</h3>
        <p className="dim" style={{ margin: 0 }}>
          {t('create.comingSoon')}
        </p>
      </div>
    </div>
  )
}
