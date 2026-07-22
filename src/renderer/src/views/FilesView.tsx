import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
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
  RefreshCw
} from 'lucide-react'
import { useStore } from '../store'
import { formatBytes } from '../components/ui'
import type { FileEntry } from '@shared/types'

interface PromptState {
  title: string
  value: string
  onOk: (v: string) => void
}

export function FilesView(): JSX.Element {
  const { t } = useTranslation()
  const id = useStore((s) => s.activeServerId) as string
  const toast = useStore((s) => s.toast)

  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [content, setContent] = useState('')
  const [binary, setBinary] = useState(false)
  const [dirty, setDirty] = useState(false)
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
    setSelected(null)
    setContent('')
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

  const openFile = async (entry: FileEntry): Promise<void> => {
    setSelected(entry)
    const res = await window.msms.readFile(id, entry.path)
    setBinary(res.binary)
    setContent(res.content)
    setDirty(false)
  }

  const save = async (): Promise<void> => {
    if (!selected) return
    await window.msms.writeFile(id, selected.path, content)
    setDirty(false)
    toast('success', 'common.saved')
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
    const baseDir = selected?.isDir ? selected.path : selected ? parentOf(selected.path) : ''
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

  const doRename = (): void => {
    if (!selected) return
    setPrompt({
      title: t('files.promptRename'),
      value: selected.name,
      onOk: async (name) => {
        await window.msms.renameEntry(id, selected.path, name.trim())
        await refreshParent(selected.path)
        setSelected(null)
      }
    })
  }

  const doDelete = async (): Promise<void> => {
    if (!confirmDel) return
    await window.msms.deleteEntry(id, confirmDel.path)
    await refreshParent(confirmDel.path)
    if (selected?.path === confirmDel.path) {
      setSelected(null)
      setContent('')
    }
    setConfirmDel(null)
  }

  const TreeNode = ({ entry, depth }: { entry: FileEntry; depth: number }): JSX.Element => {
    const isOpen = expanded.has(entry.path)
    const isSel = selected?.path === entry.path
    return (
      <>
        <div
          className={`tree-row ${isSel ? 'sel' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => (entry.isDir ? toggleDir(entry) : openFile(entry))}
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
          {!entry.isDir && <span className="tree-size">{formatBytes(entry.size)}</span>}
        </div>
        {entry.isDir && isOpen && (children[entry.path] ?? []).map((c) => (
          <TreeNode key={c.path} entry={c} depth={depth + 1} />
        ))}
      </>
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
        {!selected ? (
          <div className="center-fill">
            <p className="dim">{t('files.empty')}</p>
          </div>
        ) : (
          <>
            <div className="files-editor-bar">
              <span className="mono" style={{ flex: 1 }}>
                {selected.path}
                {dirty && <span className="badge" style={{ marginLeft: 8 }}>{t('files.unsaved')}</span>}
              </span>
              {!selected.isDir && !binary && (
                <button className="btn primary sm" onClick={save} disabled={!dirty}>
                  <Save size={13} /> {t('files.save')}
                </button>
              )}
              <button className="btn sm" onClick={doRename}>
                <Pencil size={13} /> {t('files.rename')}
              </button>
              <button className="btn danger sm" onClick={() => setConfirmDel(selected)}>
                <Trash2 size={13} /> {t('files.delete')}
              </button>
            </div>
            {selected.isDir ? (
              <div className="center-fill">
                <p className="dim">{selected.name}</p>
              </div>
            ) : binary ? (
              <div className="center-fill">
                <p className="dim">{t('files.binary')}</p>
              </div>
            ) : (
              <textarea
                className="input file-editor-area"
                value={content}
                spellCheck={false}
                onChange={(e) => {
                  setContent(e.target.value)
                  setDirty(true)
                }}
              />
            )}
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
