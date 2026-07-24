import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Terminal, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Wand2, Download } from 'lucide-react'
import { useStore } from '../store'
import { checkJava, javaRequirement, javaVerdict } from '@shared/javaCompat'
import { provisionPlan, type JavaInstallPhase, type JavaInstallProgress } from '@shared/javaProvision'
import type { JavaArgsConfig, JavaInfo, JavaInstall, JavaPreset, ServerConfig } from '@shared/types'

const PHASE_KEY: Record<JavaInstallPhase, string> = {
  resolve: 'args.javaPhaseResolve',
  download: 'args.javaPhaseDownload',
  extract: 'args.javaPhaseExtract',
  done: 'args.javaPhaseDone'
}

const PRESETS: JavaPreset[] = ['basic', 'aikars', 'aikars-large', 'proxy', 'custom']

export function ArgsEditor({ server }: { server: ServerConfig }): JSX.Element {
  const { t } = useTranslation()
  const updateServer = useStore((s) => s.updateServer)
  const toast = useStore((s) => s.toast)
  const [java, setJava] = useState<JavaArgsConfig>(server.java)
  const [preview, setPreview] = useState('')
  const [installs, setInstalls] = useState<JavaInstall[]>([])
  const [scanning, setScanning] = useState(false)
  /** What "auto" resolves to — only the main process knows (JAVA_HOME/PATH). */
  const [autoJava, setAutoJava] = useState<JavaInfo | null>(null)
  /** Non-null while a JRE download/extract is in flight. */
  const [installing, setInstalling] = useState<JavaInstallProgress | null>(null)

  // Re-sync when switching servers.
  useEffect(() => setJava(server.java), [server.id, server.java])

  const loadInstalls = useCallback(async (refresh = false): Promise<void> => {
    setScanning(true)
    try {
      setInstalls(await window.msms.listJava(refresh))
    } catch {
      /* a machine with no Java is a normal state; the warning below covers it */
    }
    setScanning(false)
  }, [])

  useEffect(() => {
    void loadInstalls()
  }, [loadInstalls])

  // Live progress from the main process while a JRE downloads/extracts.
  useEffect(
    () => window.msms.onJavaInstallProgress((p) => setInstalling(p.phase === 'done' ? null : p)),
    []
  )

  // Ask the main process what "auto" (or a hand-typed path) actually resolves
  // to, so the default configuration - which nobody picks from the dropdown -
  // still gets a verdict. Debounced against typing.
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      window.msms
        .resolveJava(java.javaPath)
        .then((info) => alive && setAutoJava(info))
        .catch(() => alive && setAutoJava(null))
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [java.javaPath])

  /**
   * Judge the Java that will actually launch. A path chosen from the dropdown
   * is judged directly; for anything else - "auto", or a hand-typed path - we
   * judge whatever the main process resolves it to, so the default setup is
   * covered too, not only manual picks.
   */
  const compat = useMemo(() => {
    const chosen = installs.find((i) => i.path === java.javaPath) ?? autoJava
    if (!chosen) return null
    const { requirement, verdict } = checkJava(server.mcVersion, chosen.major)
    if (verdict === 'unknown') return null
    const auto = chosen === autoJava && java.javaPath !== chosen.path
    const data = {
      java: chosen.major,
      mc: server.mcVersion,
      min: requirement.min,
      max: requirement.maxKnownGood ?? 0,
      context: auto ? t('args.javaAutoContext', { version: chosen.version }) : ''
    }
    const key =
      verdict === 'too-old' ? 'args.javaTooOld' : verdict === 'risky-new' ? 'args.javaRisky' : 'args.javaOk'
    const cls = verdict === 'too-old' ? 'bad' : verdict === 'risky-new' ? 'warn' : 'ok'
    const icon =
      verdict === 'too-old' ? <XCircle size={12} /> : verdict === 'risky-new' ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />
    return { cls, icon, text: t(key, data) + (data.context ? ` ${data.context}` : '') }
  }, [installs, autoJava, java.javaPath, server.mcVersion, t])

  /**
   * Beyond judging the current pick, offer the fix. If the Java that would
   * actually launch is not compatible but a compatible one is already
   * installed, one click switches the per-server path to it — writing an
   * explicit path, never leaving it on the "auto" that ignores the requirement.
   * When nothing installed fits we only flag it here; installing the missing
   * Java lands in a later slice.
   */
  const provision = useMemo(() => {
    const req = javaRequirement(server.mcVersion)
    if (!req.known) return null
    const plan = provisionPlan(req, installs)
    const effective = installs.find((i) => i.path === java.javaPath) ?? autoJava
    if (effective && javaVerdict(effective.major, req) === 'ok') return null
    if (plan.state === 'ok' && plan.chosen && plan.chosen.path !== java.javaPath) {
      return { kind: 'switch' as const, major: plan.chosen.major, path: plan.chosen.path }
    }
    if (plan.state === 'needs-install' && plan.suggestedMajor != null) {
      return { kind: 'install' as const, major: plan.suggestedMajor }
    }
    return null
  }, [installs, autoJava, java.javaPath, server.mcVersion])

  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      window.msms
        .previewArgs(java, server.type)
        .then((args) => alive && setPreview('java ' + args.join(' ')))
        .catch(() => {})
    }, 150)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [java, server.type])

  const set = <K extends keyof JavaArgsConfig>(k: K, v: JavaArgsConfig[K]): void =>
    setJava((prev) => ({ ...prev, [k]: v }))

  const save = async (): Promise<void> => {
    await updateServer(server.id, { java })
    toast('success', 'common.saved')
  }

  /** Download a compatible JRE, then pin it as this server's Java. */
  const installJava = async (major: number): Promise<void> => {
    setInstalling({ major, phase: 'resolve' })
    try {
      const info = await window.msms.installJava(major)
      await loadInstalls(true)
      set('javaPath', info.path)
      toast('success', 'args.javaInstalled', { major: info.major })
    } catch {
      toast('error', 'args.javaInstallFailed')
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="panel" style={{ maxWidth: '100%' }}>
      <div className="section-title" style={{ marginTop: 0 }}>
        <Terminal size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('args.title')}
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field" style={{ minWidth: 170, marginBottom: 8 }}>
          <label>{t('args.preset')}</label>
          <select
            className="select"
            value={java.preset}
            onChange={(e) => set('preset', e.target.value as JavaPreset)}
          >
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        {java.preset !== 'custom' && (
          <>
            <div className="field" style={{ width: 150, marginBottom: 8 }}>
              <label>{t('args.maxMemory')}</label>
              <input
                className="input"
                type="number"
                value={java.maxMemoryMB}
                onChange={(e) => set('maxMemoryMB', Number(e.target.value))}
              />
            </div>
            <div className="field" style={{ width: 150, marginBottom: 8 }}>
              <label>{t('args.minMemory')}</label>
              <input
                className="input"
                type="number"
                value={java.minMemoryMB}
                onChange={(e) => set('minMemoryMB', Number(e.target.value))}
              />
            </div>
          </>
        )}
      </div>

      {java.preset !== 'custom' ? (
        <div className="row wrap" style={{ gap: 10 }}>
          {!java.argsFile && (
            <div className="field" style={{ minWidth: 180, marginBottom: 8 }}>
              <label>{t('args.jarFile')}</label>
              <input
                className="input"
                value={java.jarFile}
                onChange={(e) => set('jarFile', e.target.value)}
              />
            </div>
          )}
          <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 8 }}>
            <label>{t('args.extraFlags')}</label>
            <input
              className="input mono"
              value={java.extraFlags}
              onChange={(e) => set('extraFlags', e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="field" style={{ marginBottom: 8 }}>
          <label>{t('args.customArgs')}</label>
          <textarea
            className="input"
            style={{ minHeight: 90 }}
            value={java.customArgs}
            onChange={(e) => set('customArgs', e.target.value)}
          />
        </div>
      )}

      <div className="row wrap" style={{ gap: 10 }}>
        <div className="field" style={{ flex: 1, minWidth: 220, marginBottom: 8 }}>
          <label>{t('args.javaPath')}</label>
          <div className="row">
            <select
              className="select"
              style={{ maxWidth: 260 }}
              value={installs.some((i) => i.path === java.javaPath) ? java.javaPath : ''}
              onChange={(e) => set('javaPath', e.target.value)}
            >
              <option value="">{t('settings.javaAuto')}</option>
              {installs.map((i) => (
                <option key={i.path} value={i.path}>
                  Java {i.major} · {i.version} {i.source !== 'installed' ? `(${i.source})` : ''}
                </option>
              ))}
            </select>
            <button
              className="btn ghost sm"
              title={t('args.rescanJava')}
              disabled={scanning}
              onClick={() => void loadInstalls(true)}
            >
              <RefreshCw size={13} className={scanning ? 'spin' : ''} />
            </button>
          </div>
          <input
            className="input"
            style={{ marginTop: 6 }}
            value={java.javaPath}
            placeholder={t('settings.javaAuto')}
            onChange={(e) => set('javaPath', e.target.value)}
          />
          {compat && (
            <div className={`java-compat ${compat.cls}`}>
              {compat.icon} {compat.text}
            </div>
          )}
          {provision?.kind === 'switch' && (
            <div className="java-provision">
              <span>{t('args.javaSwitchHint', { major: provision.major })}</span>
              <button className="btn sm" onClick={() => set('javaPath', provision.path)}>
                <Wand2 size={13} /> {t('args.javaUse', { major: provision.major })}
              </button>
            </div>
          )}
          {provision?.kind === 'install' &&
            (installing ? (
              <div className="java-provision">
                <RefreshCw size={13} className="spin" />
                <span className="mono">
                  {t(PHASE_KEY[installing.phase])}
                  {installing.percent != null ? ` ${installing.percent}%` : ''}
                </span>
              </div>
            ) : (
              <div className="java-provision">
                <span>{t('args.javaNeedInstall', { major: provision.major, mc: server.mcVersion })}</span>
                <button className="btn sm" onClick={() => void installJava(provision.major)}>
                  <Download size={13} /> {t('args.javaInstall', { major: provision.major })}
                </button>
              </div>
            ))}
        </div>
        <label className="switch" style={{ marginTop: 24 }}>
          <input
            type="checkbox"
            checked={java.nogui}
            onChange={(e) => set('nogui', e.target.checked)}
          />
          {t('args.nogui')}
        </label>
      </div>

      <label style={{ fontSize: 12.5, color: 'var(--text-dim)', fontWeight: 550 }}>
        {t('args.preview')}
      </label>
      <pre className="log-tail" style={{ maxHeight: 140, marginTop: 6 }}>
        {preview}
      </pre>

      <button className="btn primary" onClick={save}>
        <Check size={14} /> {t('common.save')}
      </button>
    </div>
  )
}
