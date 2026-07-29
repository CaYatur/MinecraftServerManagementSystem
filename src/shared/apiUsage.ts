/**
 * How to actually use an API key.
 *
 * A key that an operator cannot work out how to send is a key that does
 * nothing. The reference at `/api/v1/docs` lists every route and says nothing
 * about the two things a first request needs: which header carries the key, and
 * what a working call looks like end to end.
 *
 * Pure so the desktop app, the web panel and the docs page all show the same
 * snippets, and so the snippets can be checked rather than trusted.
 */

import { API_PREFIX } from './apiSurface'

export interface UsageSample {
  /** Shown on the tab. */
  lang: string
  /** Ready to paste, with no placeholders left except the key when there is none. */
  code: string
}

/** The header name, in one place, because every sample has to agree on it. */
export const API_KEY_HEADER = 'X-API-Key'

/**
 * `key` is the real secret only in the moment just after creation — it is never
 * recoverable afterwards, so every other caller passes nothing and gets a
 * clearly marked placeholder instead of a plausible-looking fake.
 *
 * Deliberately self-contained: this function is stringified into the served
 * panel with `.toString()`, so a reference to any module-level binding —
 * `API_PREFIX`, `API_KEY_HEADER` — becomes a ReferenceError in the page the
 * moment the bundler renames it. The two literals below are checked against the
 * shared constants by the smoke, which is the trade: duplication that is
 * verified, rather than a reference that is quietly dead.
 */
export function usageSamples(opts: {
  baseUrl: string
  key?: string
  serverId?: string
}): UsageSample[] {
  const prefix = '/api/v1'
  const header = 'X-API-Key'
  const base = (opts.baseUrl || 'http://127.0.0.1:8080').replace(/\/+$/, '')
  const key = opts.key || 'PASTE_YOUR_KEY_HERE'
  const sid = opts.serverId || 'YOUR_SERVER_ID'
  const listUrl = base + prefix + '/servers'
  const oneUrl = base + prefix + '/servers/' + sid

  return [
    {
      lang: 'curl',
      code: [
        '# List the servers this key may see',
        'curl -s "' + listUrl + '" \\',
        '  -H "' + header + ': ' + key + '"',
        '',
        '# Send a console command (needs the `console` scope)',
        'curl -s -X POST "' + oneUrl + '/command" \\',
        '  -H "' + header + ': ' + key + '" \\',
        '  -H "Content-Type: application/json" \\',
        '  -d \'{"command":"say hello from the API"}\''
      ].join('\n')
    },
    {
      lang: 'JavaScript',
      code: [
        "const BASE = '" + base + prefix + "'",
        "const KEY = '" + key + "'",
        '',
        'async function api(path, init = {}) {',
        '  const r = await fetch(BASE + path, {',
        '    ...init,',
        '    headers: {',
        "      '" + header + "': KEY,",
        "      'Content-Type': 'application/json',",
        '      ...(init.headers || {})',
        '    }',
        '  })',
        '  // 401 means the key is wrong, disabled or expired.',
        '  // 403 means it is valid but lacks the scope for this route.',
        '  if (!r.ok) throw new Error(r.status + \' \' + (await r.text()))',
        '  return r.json()',
        '}',
        '',
        "const { servers } = await api('/servers')",
        'console.log(servers.map((s) => s.name))'
      ].join('\n')
    },
    {
      lang: 'Python',
      code: [
        'import requests',
        '',
        'BASE = "' + base + prefix + '"',
        'KEY = "' + key + '"',
        'S = requests.Session()',
        'S.headers["' + header + '"] = KEY',
        '',
        'servers = S.get(f"{BASE}/servers").json()["servers"]',
        'print([s["name"] for s in servers])',
        '',
        '# 401 = wrong, disabled or expired key. 403 = valid but wrong scope.',
        'S.post(f"{BASE}/servers/' + sid + '/command", json={"command": "list"})'
      ].join('\n')
    }
  ]
}

/**
 * The three sentences an operator needs before any of the above makes sense.
 *
 * A plain value, unlike `usageSamples` — it reaches the pages as JSON, so it may
 * refer to the shared constants directly.
 */
export const USAGE_NOTES = [
  'Send the key in the ' + API_KEY_HEADER + ' header. It is never accepted in a query string, where it would end up in server logs and browser history.',
  'A key carries scopes, never a role: 401 means the key is wrong, disabled or expired; 403 means it is a good key without the scope that route needs.',
  'The full route list, with the scope each one requires, is at ' + API_PREFIX + '/docs.'
]
