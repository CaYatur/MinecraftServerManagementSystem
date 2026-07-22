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

/** Keys the user can override in Settings. */
export const MESSAGE_KEYS = Object.keys(dict.en)

/** The built-in defaults in the current panel language (for UI placeholders). */
export function defaultMessages(): Record<string, string> {
  const lang = resolveLanguage()
  const out: Record<string, string> = {}
  for (const k of MESSAGE_KEYS) out[k] = dict[lang][k] ?? dict.en[k]
  return out
}

/** Translate a main-side (server-facing) message, honouring user overrides. */
export function mt(key: string, params?: Record<string, string | number>): string {
  const override = getConfig().serverMessages?.[key]
  const lang = resolveLanguage()
  let s = (override && override.trim()) || dict[lang][key] || dict.en[key] || key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v))
    }
  }
  return s
}
