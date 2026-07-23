/**
 * Which Java a given Minecraft version needs.
 *
 * "The server won't start" is most often this: 1.21 on Java 17, or a 1.12
 * modpack on Java 21. The rules are stable and well documented, so they live
 * in one pure table that both the launcher warning and the crash hints can
 * read - and that a test can pin version by version.
 *
 * Deliberately conservative: an unparseable version (a snapshot like `24w14a`,
 * or an empty string) yields `known: false` and the UI says nothing rather
 * than guessing.
 */

export interface JavaRequirement {
  /** Below this the server will not run at all. */
  min: number
  /** What the version was built and tested against. */
  recommended: number
  /**
   * Above this, server software of that era commonly fails to start - old
   * Spigot and Forge builds break on modern JVMs. Undefined when there is no
   * known ceiling.
   */
  maxKnownGood?: number
  /** false when the Minecraft version could not be read. */
  known: boolean
}

export type JavaVerdict = 'ok' | 'too-old' | 'risky-new' | 'unknown'

const UNKNOWN: JavaRequirement = { min: 0, recommended: 0, known: false }

/** `1.20.4` -> [1, 20, 4]. Returns null for snapshots and anything odd. */
export function parseMcVersion(v: string): [number, number, number] | null {
  const m = String(v ?? '')
    .trim()
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?$/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0]
}

export function javaRequirement(mcVersion: string): JavaRequirement {
  const parsed = parseMcVersion(mcVersion)
  if (!parsed) return UNKNOWN
  const [major, minor, patch] = parsed
  if (major !== 1) return UNKNOWN

  // 1.20.5 was the cutover to Java 21; everything from 1.21 on follows it.
  if (minor >= 21 || (minor === 20 && patch >= 5)) {
    return { min: 21, recommended: 21, known: true }
  }
  if (minor >= 18) return { min: 17, recommended: 17, known: true }
  if (minor === 17) return { min: 16, recommended: 17, known: true }
  // Everything up to 1.16.5 shipped against Java 8. It runs on 11, but 17+
  // breaks a lot of software of that generation.
  return { min: 8, recommended: 8, maxKnownGood: 11, known: true }
}

export function javaVerdict(major: number, req: JavaRequirement): JavaVerdict {
  if (!req.known || !Number.isFinite(major) || major <= 0) return 'unknown'
  if (major < req.min) return 'too-old'
  if (req.maxKnownGood != null && major > req.maxKnownGood) return 'risky-new'
  return 'ok'
}

/** Convenience for callers that only have the two strings. */
export function checkJava(mcVersion: string, javaMajor: number): {
  requirement: JavaRequirement
  verdict: JavaVerdict
} {
  const requirement = javaRequirement(mcVersion)
  return { requirement, verdict: javaVerdict(javaMajor, requirement) }
}
