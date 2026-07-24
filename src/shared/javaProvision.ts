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
