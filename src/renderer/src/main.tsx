import { createRoot } from 'react-dom/client'
import { initI18n } from './i18n'
import { useStore } from './store'
import App from './App'
import './styles.css'
import type { Language, ResolvedLanguage } from '@shared/types'

function resolveLang(lang: Language, systemLocale: string): ResolvedLanguage {
  if (lang === 'en' || lang === 'tr') return lang
  return systemLocale.toLowerCase().startsWith('tr') ? 'tr' : 'en'
}

async function bootstrap(): Promise<void> {
  const boot = await window.msms.bootstrap()
  await initI18n(resolveLang(boot.config.language, boot.systemLocale))
  await useStore.getState().init(boot)
  createRoot(document.getElementById('root') as HTMLElement).render(<App />)
}

bootstrap().catch((err) => {
  const root = document.getElementById('root')
  if (root) {
    root.innerHTML = `<div style="padding:40px;font-family:sans-serif;color:#f87171">
      <h2>Failed to start</h2><pre>${String(err?.stack ?? err)}</pre></div>`
  }
})
