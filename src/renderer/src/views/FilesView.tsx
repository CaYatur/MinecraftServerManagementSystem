import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { xml } from '@codemirror/lang-xml'
import type { Extension } from '@codemirror/state'
import {
  Folder,
  FolderOpen,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
  Save,
  Trash2,
  Pencil,
  FolderPlus,
  FilePlus,
  RefreshCw,
  X,
  Columns2
} from 'lucide-react'
import { useStore } from '../store'
import type { FileEntry } from '@shared/types'

interface OpenFile {
  path: string
  content: string
  dirty: boolean
  binary: boolean
}
interface PromptState {
  title: string
  value: string
  onOk: (v: string) => void
}

function langFor(path: string): Extension[] {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'json':
      return [json()]
    case 'yml':
    case 'yaml':
      return [yaml()]
    case 'js':
    case 'mjs':
    case 'cjs':
      return [javascript()]
    case 'ts':
      return [javascript({ typescript: true })]
    case 'html':
    case 'htm':
      return [html()]
    case 'css':
      return [css()]
    case 'xml':
      return [xml()]
    default:
      return []
  }
}

export function FilesView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const toast = useStore((s) => s.toast)

  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Record<string, OpenFile>>({})
  const [order, setOrder] = useState<string[]>([])
  const [leftPath, setLeftPath] = useState<string | null>(null)
  const [rightPath, setRightPath] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<PromptState | null>(null)
  const [confirmDel, setConfirmDel] = useState<FileEntry | null>(null)

  const loadDir = useCallback(
    async (rel: string): Promise<void> => {
      const entries = await window.msms.listDir(id, rel)
      setChildren((prev) => ({ ...prev, [rel]: entries }))
    },
    [id]
  )

  useEffect(() => {
    setChildren({})
    setExpanded(new Set())
    setOpen({})
    setOrder([])
    setLeftPath(null)
    setRightPath(null)
    void loadDir('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const toggleDir = async (entry: FileEntry): Promise<void> => {
    const next = new Set(expanded)
    if (next.has(entry.path)) next.delete(entry.path)
    else {
      next.add(entry.path)
      if (!children[entry.path]) await loadDir(entry.path)
    }
    setExpanded(next)
  }

  const openFile = async (path: string, side: 'left' | 'right'): Promise<void> => {
    if (!open[path]) {
      const res = await window.msms.readFile(id, path)
      setOpen((prev) => ({
        ...prev,
        [path]: { path, content: res.content, dirty: false, binary: res.binary }
      }))
      setOrder((prev) => (prev.includes(path) ? prev : [...prev, path]))
    }
    if (side === 'left') setLeftPath(path)
    else setRightPath(path)
  }

  const setContent = (path: string, content: string): void =>
    setOpen((prev) => ({ ...prev, [path]: { ...prev[path], content, dirty: true } }))

  const save = async (path: string): Promise<void> => {
    const f = open[path]
    if (!f) return
    await window.msms.writeFile(id, path, f.content)
    setOpen((prev) => ({ ...prev, [path]: { ...prev[path], dirty: false } }))
    toast('success', 'common.saved')
  }

  const closeTab = (path: string): void => {
    setOrder((prev) => prev.filter((p) => p !== path))
    setOpen((prev) => {
      const n = { ...prev }
      delete n[path]
      return n
    })
    setLeftPath((p) => (p === path ? order.filter((x) => x !== path)[0] ?? null : p))
    setRightPath((p) => (p === path ? null : p))
  }

  const parentOf = (rel: string): string => {
    const i = rel.lastIndexOf('/')
    return i < 0 ? '' : rel.slice(0, i)
  }
  const refreshParent = async (rel: string): Promise<void> => {
    await loadDir(parentOf(rel))
    await loadDir('')
  }

  const doNew = (isFolder: boolean): void => {
    const baseDir = leftPath ? parentOf(leftPath) : ''
    setPrompt({
      title: isFolder ? t('files.promptFolder') : t('files.promptFile'),
      value: '',
      onOk: async (name) => {
        if (!name.trim()) return
        if (isFolder) await window.msms.createFolder(id, baseDir, name.trim())
        else await window.msms.writeFile(id, (baseDir ? baseDir + '/' : '') + name.trim(), '')
        await loadDir(baseDir)
        if (baseDir) setExpanded((e) => new Set(e).add(baseDir))
      }
    })
  }

  const doRename = (entry: FileEntry): void => {
    setPrompt({
      title: t('files.promptRename'),
      value: entry.name,
      onOk: async (name) => {
        await window.msms.renameEntry(id, entry.path, name.trim())
        await refreshParent(entry.path)
      }
    })
  }

  const doDelete = async (): Promise<void> => {
    if (!confirmDel) return
    await window.msms.deleteEntry(id, confirmDel.path)
    await refreshParent(confirmDel.path)
    closeTab(confirmDel.path)
    setConfirmDel(null)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      if (leftPath) void save(leftPath)
    }
  }

  const TreeNode = ({ entry, depth }: { entry: FileEntry; depth: number }): JSX.Element => {
    const isOpen = expanded.has(entry.path)
    const isSel = leftPath === entry.path || rightPath === entry.path
    return (
      <>
        <div
          className={`tree-row ${isSel ? 'sel' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (entry.isDir ? toggleDir(entry) : openFile(entry.path, 'left'))}
        >
          {entry.isDir ? (
            <>
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}
            </>
          ) : (
            <>
              <span style={{ width: 13 }} />
              <FileIcon size={14} />
            </>
          )}
          <span className="tree-name">{entry.name}</span>
          <span className="tree-actions">
            <Pencil
              size={12}
              onClick={(e) => {
                e.stopPropagation()
                doRename(entry)
              }}
            />
            <Trash2
              size={12}
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDel(entry)
              }}
            />
          </span>
        </div>
        {entry.isDir &&
          isOpen &&
          (children[entry.path] ?? []).map((c) => (
            <TreeNode key={c.path} entry={c} depth={depth + 1} />
          ))}
      </>
    )
  }

  const Pane = ({ path, side }: { path: string; side: 'left' | 'right' }): JSX.Element => {
    const f = open[path]
    if (!f) return <div className="center-fill" />
    if (f.binary)
      return (
        <div className="center-fill">
          <p className="dim">{t('files.binary')}</p>
        </div>
      )
    return (
      <div className="cm-wrap" onKeyDown={onKeyDown}>
        <CodeMirror
          value={f.content}
          height="100%"
          theme="dark"
          extensions={langFor(path)}
          onChange={(v) => setContent(path, v)}
          basicSetup={{ lineNumbers: true, highlightActiveLine: true }}
        />
        <div className="pane-tag">{side}</div>
      </div>
    )
  }

  return (
    <div className="files-layout">
      <div className="files-tree">
        <div className="files-toolbar">
          <button className="btn ghost sm" title={t('files.reload')} onClick={() => loadDir('')}>
            <RefreshCw size={13} />
          </button>
          <button className="btn ghost sm" title={t('files.newFolder')} onClick={() => doNew(true)}>
            <FolderPlus size={13} />
          </button>
          <button className="btn ghost sm" title={t('files.newFile')} onClick={() => doNew(false)}>
            <FilePlus size={13} />
          </button>
        </div>
        <div className="tree-scroll">
          {(children[''] ?? []).map((e) => (
            <TreeNode key={e.path} entry={e} depth={0} />
          ))}
        </div>
      </div>

      <div className="files-editor">
        {order.length === 0 ? (
          <div className="center-fill">
            <p className="dim">{t('files.empty')}</p>
          </div>
        ) : (
          <>
            <div className="editor-tabs">
              {order.map((p) => {
                const name = p.split('/').pop()
                const active = p === leftPath
                return (
                  <div
                    key={p}
                    className={`editor-tab ${active ? 'active' : ''}`}
                    onClick={() => setLeftPath(p)}
                    title={p}
                  >
                    <span>
                      {name}
                      {open[p]?.dirty ? ' •' : ''}
                    </span>
                    <Columns2
                      size={12}
                      className="tab-split"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openFile(p, 'right')
                      }}
                    />
                    <X
                      size={13}
                      className="tab-close"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeTab(p)
                      }}
                    />
                  </div>
                )
              })}
              <div style={{ flex: 1 }} />
              {leftPath && !open[leftPath]?.binary && (
                <button
                  className="btn primary sm"
                  style={{ margin: 4 }}
                  disabled={!open[leftPath]?.dirty}
                  onClick={() => leftPath && save(leftPath)}
                >
                  <Save size={13} /> {t('files.save')}
                </button>
              )}
            </div>
            <div className={`editor-panes ${rightPath ? 'split' : ''}`}>
              {leftPath && <Pane path={leftPath} side="left" />}
              {rightPath && (
                <div className="right-pane">
                  <div className="right-pane-bar">
                    <span className="mono">{rightPath.split('/').pop()}</span>
                    <button
                      className="btn primary sm"
                      disabled={!open[rightPath]?.dirty}
                      onClick={() => rightPath && save(rightPath)}
                    >
                      <Save size={12} />
                    </button>
                    <button className="btn ghost sm" onClick={() => setRightPath(null)}>
                      <X size={13} />
                    </button>
                  </div>
                  <Pane path={rightPath} side="right" />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {prompt && (
        <div className="modal-backdrop" onClick={() => setPrompt(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{prompt.title}</h3>
            <input
              className="input"
              autoFocus
              value={prompt.value}
              onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  prompt.onOk(prompt.value)
                  setPrompt(null)
                }
              }}
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setPrompt(null)}>
                {t('common.cancel')}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  prompt.onOk(prompt.value)
                  setPrompt(null)
                }}
              >
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDel && (
        <div className="modal-backdrop" onClick={() => setConfirmDel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('files.confirmDelete', { name: confirmDel.name })}</h3>
            <p>{t('files.deleteBody')}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmDel(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn danger" onClick={doDelete}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
