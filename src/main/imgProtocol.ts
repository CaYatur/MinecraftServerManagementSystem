/**
 * `msms-img://upload/<file>` — serves the site's uploaded images to the desktop
 * UI.
 *
 * The CMS used to preview them through the website's own HTTP port, so previews
 * were blank whenever the site listener was off, and blocked by the packaged
 * renderer's CSP even when it was on. Reading them from disk through our own
 * scheme makes previews work regardless of the web server.
 */
import { protocol } from 'electron'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { uploadsDir } from './paths'
import { log } from './logger'

export const IMG_SCHEME = 'msms-img'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

/** Must run before `app.whenReady()`. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: IMG_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** Must run after the app is ready. */
export function handleImageProtocol(): void {
  protocol.handle(IMG_SCHEME, (req) => {
    try {
      const name = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '')
      const type = MIME[extname(name).toLowerCase()]
      if (!type) return new Response('unsupported-type', { status: 415 })
      const root = resolve(uploadsDir())
      const file = resolve(join(root, name))
      // Never escape the uploads folder, whatever the renderer asks for.
      if (file !== root && !file.startsWith(root + sep)) {
        return new Response('forbidden', { status: 403 })
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        return new Response('not-found', { status: 404 })
      }
      return new Response(readFileSync(file), {
        headers: { 'content-type': type, 'cache-control': 'no-cache' }
      })
    } catch (err) {
      log.warn('image protocol failed:', err)
      return new Response('bad-request', { status: 400 })
    }
  })
}

/** URL for an uploaded file, as used by the renderer. */
export function imageUrl(name: string): string {
  return `${IMG_SCHEME}://upload/${encodeURIComponent(name)}`
}
