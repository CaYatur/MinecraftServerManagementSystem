import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Send, Eraser, ArrowDownToLine } from 'lucide-react'
import { useStore } from '../store'
import type { LogLine } from '@shared/types'

const EMPTY_LOGS: LogLine[] = []

/** Strip Minecraft §-colour codes for clean display. */
function clean(s: string): string {
  return s.replace(/§[0-9a-fk-or]/gi, '')
}

function lineClass(line: LogLine): string {
  if (line.stream === 'stderr') return 'log-line stderr'
  if (line.stream === 'system') return 'log-line system'
  if (/\bWARN\b/.test(line.line)) return 'log-line warn'
  if (/\bERROR\b|\bSEVERE\b/.test(line.line)) return 'log-line stderr'
  return 'log-line'
}

export function ConsoleView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const logs = useStore((s) => s.logs[s.activeServerId ?? ''] ?? EMPTY_LOGS)
  const status = useStore((s) => s.activeStatus().status)
  const sendCommand = useStore((s) => s.sendCommand)
  const clearLogs = useStore((s) => s.clearLogs)

  const [cmd, setCmd] = useState('')
  const [autoscroll, setAutoscroll] = useState(true)
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const outRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoscroll && outRef.current) {
      outRef.current.scrollTop = outRef.current.scrollHeight
    }
  }, [logs, autoscroll])

  const running = status === 'running' || status === 'starting' || status === 'stopping'

  const submit = (): void => {
    const c = cmd.trim()
    if (!c) return
    sendCommand(id, c)
    setHistory((h) => [...h.slice(-49), c])
    setHistIdx(-1)
    setCmd('')
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') submit()
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1)
      if (history[idx] !== undefined) {
        setHistIdx(idx)
        setCmd(history[idx])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const idx = histIdx < 0 ? -1 : histIdx + 1
      if (idx >= history.length) {
        setHistIdx(-1)
        setCmd('')
      } else {
        setHistIdx(idx)
        setCmd(history[idx])
      }
    }
  }

  return (
    <div className="console-wrap">
      <div className="console-bar">
        <span className="dim">{t('console.title')}</span>
        <span className="badge">{logs.length}</span>
        <div className="spacer" style={{ flex: 1 }} />
        <label className="switch">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(e) => setAutoscroll(e.target.checked)}
          />
          <ArrowDownToLine size={14} /> {t('console.autoscroll')}
        </label>
        <button className="btn ghost sm" onClick={() => clearLogs(id)}>
          <Eraser size={14} /> {t('console.clear')}
        </button>
      </div>

      <div className="console-out" ref={outRef}>
        {logs.length === 0 ? (
          <div className="dim">{t('console.empty')}</div>
        ) : (
          logs.map((line) => (
            <div key={line.id} className={lineClass(line)}>
              <span className="ts">{new Date(line.ts).toLocaleTimeString()}</span>
              <span>{clean(line.line)}</span>
            </div>
          ))
        )}
      </div>

      <div className="console-input">
        <input
          className="input"
          placeholder={t('controls.commandPlaceholder')}
          value={cmd}
          disabled={!running}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="btn primary" disabled={!running} onClick={submit}>
          <Send size={14} /> {t('controls.send')}
        </button>
      </div>
    </div>
  )
}
