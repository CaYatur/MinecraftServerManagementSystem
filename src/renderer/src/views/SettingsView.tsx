import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Coffee, Folder, Check } from 'lucide-react'
import { useStore } from '../store'
import type { JavaPreset, Language, ThemeMode } from '@shared/types'

const PRESETS: JavaPreset[] = ['basic', 'aikars', 'aikars-large', 'proxy']

export function SettingsView(): JSX.Element {
  const { t } = useTranslation()
  const config = useStore((s) => s.config)
  const java = useStore((s) => s.javaDetected)
  const baseDir = useStore((s) => s.baseDir)
  const appVersion = useStore((s) => s.appVersion)
  const setLanguage = useStore((s) => s.setLanguage)
  const setTheme = useStore((s) => s.setTheme)
  const updateDefaults = useStore((s) => s.updateDefaults)

  const d = config.defaults
  const [javaPath, setJavaPath] = useState(d.javaPath)
  const [maxMem, setMaxMem] = useState(d.maxMemoryMB)
  const [minMem, setMinMem] = useState(d.minMemoryMB)
  const [preset, setPreset] = useState<JavaPreset>(d.javaPreset)
  const [countdown, setCountdown] = useState(d.stopCountdownSeconds)
  const [rcon, setRcon] = useState(d.autoEnableRcon)

  const browseJava = async (): Promise<void> => {
    const p = await window.msms.pickFile([{ name: 'Java', extensions: ['exe', ''] }])
    if (p) setJavaPath(p)
  }

  const saveJava = (): void => void updateDefaults({ javaPath })
  const saveDefaults = (): void =>
    void updateDefaults({
      maxMemoryMB: Number(maxMem),
      minMemoryMB: Number(minMem),
      javaPreset: preset,
      stopCountdownSeconds: Number(countdown),
      autoEnableRcon: rcon
    })

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="section-title">{t('settings.appearance')}</div>
      <div className="panel">
        <div className="field">
          <label>{t('settings.language')}</label>
          <select
            className="select"
            value={config.language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            <option value="auto">{t('settings.languageAuto')}</option>
            <option value="en">English</option>
            <option value="tr">Türkçe</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>{t('settings.theme')}</label>
          <select
            className="select"
            value={config.theme}
            onChange={(e) => setTheme(e.target.value as ThemeMode)}
          >
            <option value="dark">{t('settings.themeDark')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="system">{t('settings.themeSystem')}</option>
          </select>
        </div>
      </div>

      <div className="section-title">{t('settings.java')}</div>
      <div className="panel">
        <div className="field">
          <label>{t('settings.detectedJava')}</label>
          <div className="badge">
            <Coffee size={13} />
            {java ? `Java ${java.version} (${java.path})` : t('settings.notDetected')}
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>{t('settings.javaPath')}</label>
          <div className="row">
            <input
              className="input"
              value={javaPath}
              placeholder={t('settings.javaAuto')}
              onChange={(e) => setJavaPath(e.target.value)}
            />
            <button className="btn" onClick={browseJava}>
              {t('common.browse')}
            </button>
            <button className="btn primary" onClick={saveJava}>
              <Check size={14} /> {t('common.save')}
            </button>
          </div>
        </div>
      </div>

      <div className="section-title">{t('settings.defaults')}</div>
      <div className="panel">
        <div className="row wrap">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>{t('settings.maxMemory')}</label>
            <input
              className="input"
              type="number"
              value={maxMem}
              onChange={(e) => setMaxMem(Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>{t('settings.minMemory')}</label>
            <input
              className="input"
              type="number"
              value={minMem}
              onChange={(e) => setMinMem(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="row wrap">
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>{t('settings.preset')}</label>
            <select
              className="select"
              value={preset}
              onChange={(e) => setPreset(e.target.value as JavaPreset)}
            >
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>{t('settings.stopCountdown')}</label>
            <input
              className="input"
              type="number"
              value={countdown}
              onChange={(e) => setCountdown(Number(e.target.value))}
            />
          </div>
        </div>
        <label className="switch" style={{ marginBottom: 14 }}>
          <input type="checkbox" checked={rcon} onChange={(e) => setRcon(e.target.checked)} />
          {t('settings.autoEnableRcon')}
        </label>
        <div>
          <button className="btn primary" onClick={saveDefaults}>
            <Check size={14} /> {t('common.save')}
          </button>
        </div>
      </div>

      <div className="section-title">{t('settings.baseDir')}</div>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="mono">{baseDir}</span>
          <button className="btn sm" onClick={() => window.msms.openPath(baseDir)}>
            <Folder size={14} /> {t('sidebar.openFolder')}
          </button>
        </div>
      </div>

      <div className="section-title">{t('settings.about')}</div>
      <div className="panel">
        <p className="dim" style={{ margin: '0 0 8px' }}>
          {t('settings.aboutBody')}
        </p>
        <span className="badge">
          {t('settings.version')} {appVersion}
        </span>
      </div>
    </div>
  )
}
