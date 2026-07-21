import { app } from 'electron'
import { getConfig } from './config'
import type { ResolvedLanguage } from '@shared/types'

// Only the strings the *server* emits to players need translating in main;
// the rest of the UI is translated in the renderer.
const dict: Record<ResolvedLanguage, Record<string, string>> = {
  en: {
    'broadcast.stopping': '§eServer stopping in §c{sec}§e seconds…',
    'broadcast.restarting': '§eServer restarting in §c{sec}§e seconds…',
    'broadcast.stopping.now': '§cServer is stopping now. See you soon!',
    'broadcast.restarting.now': '§aServer is restarting — reconnect in a moment!',
    'broadcast.saving': '§7Saving the world…',
    'kick.shutdown': 'Server is shutting down.',
    'kick.restart': 'Server is restarting — please reconnect shortly.'
  },
  tr: {
    'broadcast.stopping': '§eSunucu §c{sec}§e saniye içinde kapanıyor…',
    'broadcast.restarting': '§eSunucu §c{sec}§e saniye içinde yeniden başlatılıyor…',
    'broadcast.stopping.now': '§cSunucu şimdi kapanıyor. Görüşmek üzere!',
    'broadcast.restarting.now': '§aSunucu yeniden başlatılıyor — birazdan tekrar bağlanın!',
    'broadcast.saving': '§7Dünya kaydediliyor…',
    'kick.shutdown': 'Sunucu kapatılıyor.',
    'kick.restart': 'Sunucu yeniden başlatılıyor — lütfen birazdan tekrar bağlanın.'
  }
}

export function resolveLanguage(): ResolvedLanguage {
  const l = getConfig().language
  if (l === 'en' || l === 'tr') return l
  const loc = app.getLocale?.().toLowerCase() ?? 'en'
  return loc.startsWith('tr') ? 'tr' : 'en'
}

/** Translate a main-side (server-facing) message. */
export function mt(key: string, params?: Record<string, string | number>): string {
  const lang = resolveLanguage()
  let s = dict[lang][key] ?? dict.en[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v))
    }
  }
  return s
}
