import { useTranslation } from 'react-i18next'
import { useStore } from '../store'

export function Toasts(): JSX.Element {
  const { t } = useTranslation()
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)

  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} onClick={() => dismiss(toast.id)}>
          {toast.message.includes('.') ? t(toast.message, toast.params) : toast.message}
        </div>
      ))}
    </div>
  )
}
