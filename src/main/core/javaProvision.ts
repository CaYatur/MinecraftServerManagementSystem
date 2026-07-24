/**
 * Install a Temurin (Adoptium) JRE into the app's own directory, so a server
 * can run even when the machine has no suitable Java. Opt-in only — the UI asks
 * first; nothing here runs on its own.
 *
 * The download is checksum-verified against the vendor's published SHA256 as it
 * streams (net.downloadFile deletes the file and throws on mismatch), extracted
 * through the zip-slip guard, and moved into place with an atomic rename inside
 * the destination filesystem — an interrupted install can never leave a
 * half-tree for the scanner to find and offer.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  adoptiumAssetsUrl,
  adoptiumTarget,
  isZipPackage,
  pickAdoptiumPackage,
  type AdoptiumAsset,
  type JavaInstallProgress
} from '@shared/javaProvision'
import type { JavaInfo } from '@shared/types'
import { downloadFile, httpJson } from './net'
import { extractZipSafe } from './archive'
import { javaExecutable, probeJava } from './java'
import { _resetJavaCache } from './javaScan'
import { resolveBaseDir } from '../paths'
import { log } from '../logger'

const ADOPTIUM_TIMEOUT = 20000

export type ProgressFn = (p: JavaInstallProgress) => void

/** Where provisioned runtimes live — already on javaScan's search path. */
function javaRoot(): string {
  return join(resolveBaseDir(), 'java')
}
function runtimeHome(major: number): string {
  return join(javaRoot(), `temurin-${major}`)
}

/** The single JRE folder a Temurin zip unpacks to (the one with bin/java). */
function findJavaHome(dir: string): string | null {
  if (existsSync(javaExecutable(dir))) return dir
  for (const name of readdirSync(dir)) {
    const home = join(dir, name)
    if (existsSync(javaExecutable(home))) return home
  }
  return null
}

/**
 * Fetch, verify, and adopt a Temurin JRE for `major`; returns the runnable
 * java. Throws a stable reason on any failure and leaves nothing behind.
 */
export async function installJava(major: number, onProgress?: ProgressFn): Promise<JavaInfo> {
  const target = adoptiumTarget(process.platform, process.arch)
  if (!target) throw new Error('unsupported-platform')
  onProgress?.({ major, phase: 'resolve' })

  const assets = await httpJson<AdoptiumAsset[]>(adoptiumAssetsUrl(major, target), ADOPTIUM_TIMEOUT)
  const pkg = pickAdoptiumPackage(assets)
  // tar.gz (mac/linux) is not handled in this slice — decline rather than half-do it.
  if (!isZipPackage(pkg.name)) throw new Error('unsupported-package')

  // Stage inside the destination filesystem so the final move is a real atomic
  // rename (a cross-device rename would throw EXDEV).
  mkdirSync(javaRoot(), { recursive: true })
  const staging = mkdtempSync(join(javaRoot(), '.msms-java-'))
  try {
    onProgress?.({ major, phase: 'download', percent: 0 })
    // A fixed name — never the API-supplied pkg.name — so an external string is
    // never used as a path component. adm-zip reads by content, not filename.
    const archivePath = join(staging, 'jre.zip')
    // No timeout: a JRE is tens of MB and a slow link must not abort mid-stream.
    await downloadFile(pkg.link, archivePath, {
      sha256: pkg.checksum,
      onProgress: (recv, total) =>
        onProgress?.({
          major,
          phase: 'download',
          percent: total ? Math.round((recv / total) * 100) : undefined
        })
    })

    onProgress?.({ major, phase: 'extract' })
    const unpack = join(staging, 'unpack')
    extractZipSafe(archivePath, unpack)
    const home = findJavaHome(unpack)
    if (!home) throw new Error('no-java-in-archive')

    // Confirm it actually runs before adopting it — a corrupt tree is useless.
    const probed = await probeJava(javaExecutable(home))
    if (!probed) throw new Error('provisioned-java-unprobeable')

    const dest = runtimeHome(major)
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
    renameSync(home, dest)

    _resetJavaCache()
    onProgress?.({ major, phase: 'done' })
    const info = (await probeJava(javaExecutable(dest))) ?? {
      path: javaExecutable(dest),
      version: probed.version,
      major: probed.major
    }
    log.info(`Installed Temurin JRE ${info.version} (Java ${info.major}) at ${dest}`)
    return info
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}
