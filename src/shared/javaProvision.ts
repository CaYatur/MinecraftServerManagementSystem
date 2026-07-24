/**
 * Turn "what this server needs" + "what Java is installed" into one decision
 * the UI can act on — with no I/O, so the ranking can be pinned in a test.
 *
 * `javaCompat.ts` says which Java a Minecraft version needs; the scan (main
 * process) says which Javas exist. This module joins the two: it picks the best
 * *compatible* install, or reports that none fits and one must be provisioned.
 * The pick is easy to get subtly wrong — handing a 1.12 server Java 21 "because
 * it's newest" is the exact failure this replaces — so it lives here, pure.
 */
import { javaVerdict, type JavaRequirement } from './javaCompat'

export type ProvisionState =
  | 'unknown' // the Minecraft version could not be read; say nothing
  | 'ok' // a compatible Java is installed
  | 'needs-install' // nothing installed fits; offer to install one

export interface ProvisionPlan<T> {
  state: ProvisionState
  /** The compatible install to use, when one exists. */
  chosen: T | null
  /** Which major to offer to install, when none fits. null when unknown. */
  suggestedMajor: number | null
}

/**
 * The best *compatible* install for a requirement, or null if none fits.
 *
 * "Compatible" is exactly `javaVerdict === 'ok'`: at least `min`, and no newer
 * than `maxKnownGood` when the era has a ceiling — so old server software is
 * never handed a JVM that breaks it. Among the compatible ones the pick is the
 * major closest to `recommended` (the version the build was tested against),
 * with the higher major breaking ties.
 *
 * Generic over `{ major }` so both `JavaInfo` and `JavaInstall` callers keep
 * their concrete element type (the caller still needs `.path`).
 */
export function pickJavaFor<T extends { major: number }>(
  req: JavaRequirement,
  installs: T[]
): T | null {
  if (!req.known) return null
  const ok = installs.filter((i) => javaVerdict(i.major, req) === 'ok')
  if (ok.length === 0) return null
  return ok.slice().sort((a, b) => {
    const da = Math.abs(a.major - req.recommended)
    const db = Math.abs(b.major - req.recommended)
    return da - db || b.major - a.major
  })[0]
}

/**
 * The whole decision: use an installed Java, install one, or say nothing.
 */
export function provisionPlan<T extends { major: number }>(
  req: JavaRequirement,
  installs: T[]
): ProvisionPlan<T> {
  if (!req.known) return { state: 'unknown', chosen: null, suggestedMajor: null }
  const chosen = pickJavaFor(req, installs)
  if (chosen) return { state: 'ok', chosen, suggestedMajor: null }
  return { state: 'needs-install', chosen: null, suggestedMajor: req.recommended }
}

// ---------------------------------------------------------------------------
// Installing a missing Java from Eclipse Temurin (Adoptium). The URL shaping
// and package selection are pure so a wrong segment is a one-line, testable
// fix; the download/extract itself lives in the main process (core/).
// ---------------------------------------------------------------------------

/** Adoptium os/arch segment names for one platform. */
export interface AdoptiumTarget {
  os: string
  arch: string
}

/**
 * Map Node's `platform`/`arch` to Adoptium's segment names, or null when there
 * is no build we know how to name — the UI then declines to auto-install rather
 * than fetch a guess.
 */
export function adoptiumTarget(platform: NodeJS.Platform, arch: string): AdoptiumTarget | null {
  const os =
    platform === 'win32'
      ? 'windows'
      : platform === 'darwin'
        ? 'mac'
        : platform === 'linux'
          ? 'linux'
          : null
  const a = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'aarch64' : null
  return os && a ? { os, arch: a } : null
}

/**
 * The Adoptium v3 "latest assets" endpoint for one JRE. It answers with the
 * direct download link *and* its published SHA256, so the installer verifies
 * against the vendor's own checksum rather than trusting the bytes.
 */
export function adoptiumAssetsUrl(major: number, target: AdoptiumTarget, imageType = 'jre'): string {
  const q = new URLSearchParams({
    architecture: target.arch,
    image_type: imageType,
    os: target.os,
    vendor: 'eclipse'
  })
  return `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?${q.toString()}`
}

/** The download details we sign against, pulled from an assets response. */
export interface AdoptiumPackage {
  link: string
  checksum: string
  name: string
}

/** The assets response, trimmed to the fields we read. */
export interface AdoptiumAsset {
  release_name?: string
  binary?: { package?: Partial<AdoptiumPackage> }
}

/**
 * Pull the download package out of an assets response, throwing a stable reason
 * when it is empty or missing the link/checksum/name — the installer must never
 * proceed on a half-answer (an unverifiable download is worse than none).
 */
export function pickAdoptiumPackage(assets: AdoptiumAsset[]): AdoptiumPackage {
  const pkg = assets?.[0]?.binary?.package
  if (!pkg?.link || !pkg.checksum || !pkg.name) throw new Error('no-adoptium-package')
  return { link: pkg.link, checksum: pkg.checksum, name: pkg.name }
}

/** This slice only extracts .zip (Windows). tar.gz packages are declined. */
export function isZipPackage(name: string): boolean {
  return /\.zip$/i.test(name)
}

/** Phases surfaced to the UI while a JRE is being provisioned. */
export type JavaInstallPhase = 'resolve' | 'download' | 'extract' | 'done'

export interface JavaInstallProgress {
  major: number
  phase: JavaInstallPhase
  /** 0..100 during download; omitted otherwise or when length is unknown. */
  percent?: number
}
