import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en'
import tr from './locales/tr'
import type { ResolvedLanguage } from '@shared/types'

export async function initI18n(lang: ResolvedLanguage): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      tr: { translation: tr }
    },
    lng: lang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnNull: false
  })
}

export function setI18nLanguage(lang: ResolvedLanguage): void {
  void i18n.changeLanguage(lang)
}

export default i18n
