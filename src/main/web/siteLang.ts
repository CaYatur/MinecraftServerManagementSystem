/**
 * Picks the language a website visitor sees.
 *
 * Order: their own explicit choice -> their browser language (exact match like
 * 'pt-br' first, then the base subtag 'pt') -> English.
 *
 * This runs in two places: the main process (so the smoke suite can unit-test
 * it) and the public site, where it is inlined via `.toString()`. It must stay
 * self-contained ES5 - no module scope, no arrow functions, no optional chaining.
 */
export function pickSiteLang(
  available: string[],
  saved: string | null,
  browser: string[],
  fallback?: string
): string {
  if (saved && available.indexOf(saved) >= 0) return saved
  for (let i = 0; i < browser.length; i++) {
    const code = String(browser[i] || '')
      .toLowerCase()
      .replace('_', '-')
    if (available.indexOf(code) >= 0) return code
    const base = code.split('-')[0]
    if (base && available.indexOf(base) >= 0) return base
  }
  if (fallback && available.indexOf(fallback) >= 0) return fallback
  return available.indexOf('en') >= 0 ? 'en' : available[0] || 'en'
}
