import AdmZip from 'adm-zip'
import { mkdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/**
 * Reject an archive whose entries would write outside the target folder
 * (zip-slip). Every entry is checked before a single file is written.
 */
function assertNoZipSlip(zip: AdmZip, target: string): void {
  const root = resolve(target)
  for (const entry of zip.getEntries()) {
    const p = resolve(join(root, entry.entryName))
    if (p !== root && !p.startsWith(root + sep)) throw new Error('unsafe-archive')
  }
}

/**
 * Extract a .zip into `destDir`, but only after proving every entry stays
 * inside it. Mirrors the guard the world importer uses; kept as its own module
 * so the Java installer can be reverted without touching worlds.ts.
 */
export function extractZipSafe(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath)
  assertNoZipSlip(zip, destDir)
  mkdirSync(destDir, { recursive: true })
  zip.extractAllTo(destDir, true)
}
