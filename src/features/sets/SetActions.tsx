import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router'
import { confirmDialog, promptDialog } from '../../components/confirm'
import { Dialog } from '../../components/Dialog'
import {
  Combine,
  Copy,
  Download,
  Ellipsis,
  Folder,
  FolderPlus,
  Link as LinkIcon,
  Pencil,
  Printer,
  RotateCcw,
  Share2,
  Trash,
} from '../../components/icons'
import { Menu } from '../../components/Menu'
import { toast } from '../../components/toast'
import { createFolder } from '../../data/folders'
import {
  addSetToFolder,
  createSet,
  deleteSet,
  duplicateSet,
  loadCards,
  publishSet,
  removeSetFromFolder,
  unpublishSet,
  updateSet,
} from '../../data/sets'
import { isStudyable, useMyFolders, useMySets } from '../../data/setsHooks'
import { downloadText, exportCards, safeFilename, type ExportCardSep, type ExportTermSep } from '../../lib/exportSet'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from './StudySetContext'

type DialogKind = 'export' | 'print' | 'share' | 'folders' | 'combine' | null

export function shareUrl(setId: string) {
  return `${location.origin}${location.pathname}#/p/${setId}`
}

/** The "…" menu on the set page with its dialogs. */
export function SetActions() {
  const { set, cards, basePath, progress, session, meta } = useStudySet()
  const { uid, displayName } = useAuth()
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [printMode, setPrintMode] = useState<'list' | 'cards' | null>(null)

  if (!set || !uid) return null

  const reset = async () => {
    const ok = await confirmDialog({
      title: 'Reset progress?',
      message: 'This clears Not studied / Still learning / Mastered, your Learn session and spaced-repetition schedule for this set. Test history and best scores are kept.',
      confirmLabel: 'Reset progress',
      danger: true,
    })
    if (!ok) return
    progress?.reset()
    session?.patch('learn', null)
    session?.patch('flashcards', null)
    toast('Progress reset')
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete this set?',
      message: `“${set.title}” and all its progress will be deleted on every device. This can’t be undone.`,
      confirmLabel: 'Delete set',
      danger: true,
    })
    if (!ok) return
    void deleteSet(uid, set)
    toast('Set deleted')
    navigate('/library')
  }

  const duplicate = async () => {
    const id = await duplicateSet(uid, displayName, set, cards)
    toast('Set duplicated', { kind: 'success' })
    navigate(`/sets/${id}`)
  }

  const print = (mode: 'list' | 'cards') => {
    setDialog(null)
    setPrintMode(mode)
    document.body.classList.add('printing-set')
    setTimeout(() => {
      window.print()
      document.body.classList.remove('printing-set')
      setPrintMode(null)
    }, 100)
  }

  return (
    <>
      <Menu
        label="More actions"
        trigger={<Ellipsis size={20} />}
        triggerClassName="btn btn-icon"
        items={[
          { label: 'Edit', icon: <Pencil size={18} />, to: `${basePath}/edit` },
          { label: 'Add to folder', icon: <Folder size={18} />, onSelect: () => setDialog('folders') },
          { label: 'Duplicate', icon: <Copy size={18} />, onSelect: () => void duplicate() },
          { label: 'Combine with another set', icon: <Combine size={18} />, onSelect: () => setDialog('combine') },
          'separator',
          { label: 'Share link', icon: <Share2 size={18} />, onSelect: () => setDialog('share') },
          { label: 'Export', icon: <Download size={18} />, onSelect: () => setDialog('export') },
          { label: 'Print', icon: <Printer size={18} />, onSelect: () => setDialog('print') },
          'separator',
          { label: 'Reset progress', icon: <RotateCcw size={18} />, onSelect: () => void reset() },
          { label: 'Delete', icon: <Trash size={18} />, danger: true, onSelect: () => void remove() },
        ]}
      />

      <ExportDialog open={dialog === 'export'} onClose={() => setDialog(null)} title={meta.title} cards={cards} />

      <Dialog
        open={dialog === 'print'}
        onClose={() => setDialog(null)}
        title="Print"
        footer={
          <>
            <button type="button" className="btn" onClick={() => print('list')}>
              Print as list
            </button>
            <button type="button" className="btn btn-primary" onClick={() => print('cards')}>
              Print 2-up flashcards
            </button>
          </>
        }
      >
        <p className="muted">
          Print a list of every term and definition, or flashcards with the term and definition side by side — cut along the
          outer lines and fold down the middle.
        </p>
      </Dialog>

      <ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} />
      <FolderDialog open={dialog === 'folders'} onClose={() => setDialog(null)} />
      <CombineDialog open={dialog === 'combine'} onClose={() => setDialog(null)} />

      {printMode &&
        createPortal(
          <div className="print-root">
            <h1>{meta.title}</h1>
            {printMode === 'list' ? (
              <table className="table">
                <tbody>
                  {cards.map((c, i) => (
                    <tr key={c.id}>
                      <td style={{ width: 32 }}>{i + 1}</td>
                      <td style={{ width: '35%', fontWeight: 600 }} className="pre-wrap">
                        {c.term}
                      </td>
                      <td className="pre-wrap">{c.definition}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="print-cards">
                {cards.map((c) => (
                  <div key={c.id} className="print-card">
                    <div className="pre-wrap">{c.term}</div>
                    <div className="pre-wrap">{c.definition}</div>
                  </div>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

function ExportDialog({ open, onClose, title, cards }: { open: boolean; onClose: () => void; title: string; cards: { term: string; definition: string }[] }) {
  const [termSep, setTermSep] = useState<ExportTermSep>('tab')
  const [cardSep, setCardSep] = useState<ExportCardSep>('newline')
  const [customTerm, setCustomTerm] = useState('')
  const [customCard, setCustomCard] = useState('')
  const text = useMemo(
    () => exportCards(cards, { termSep, cardSep, customTermSep: customTerm, customCardSep: customCard }),
    [cards, termSep, cardSep, customTerm, customCard],
  )
  const csv = termSep === 'comma'
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export"
      wide
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => downloadText(`${safeFilename(title)}.${csv ? 'csv' : 'txt'}`, text, csv ? 'text/csv' : 'text/plain')}
          >
            <Download size={18} /> Download .{csv ? 'csv' : 'txt'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              navigator.clipboard
                .writeText(text)
                .then(() => toast('Copied to clipboard', { kind: 'success' }))
                .catch(() => toast('Couldn’t copy. Select the text and copy it manually.', { kind: 'error' }))
            }
          >
            <Copy size={18} /> Copy text
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="exp-term">Between term and definition</label>
            <select id="exp-term" className="select" value={termSep} onChange={(e) => setTermSep(e.target.value as ExportTermSep)}>
              <option value="tab">Tab</option>
              <option value="comma">Comma (CSV)</option>
              <option value="colon">Colon (:)</option>
              <option value="dash">Dash ( - )</option>
              <option value="equals">Equals (=)</option>
              <option value="custom">Custom…</option>
            </select>
            {termSep === 'custom' && (
              <input className="input" aria-label="Custom separator between term and definition" value={customTerm} onChange={(e) => setCustomTerm(e.target.value)} placeholder="e.g. ##" />
            )}
          </div>
          <div className="field" style={{ flex: '1 1 200px' }}>
            <label htmlFor="exp-card">Between cards</label>
            <select id="exp-card" className="select" value={cardSep} onChange={(e) => setCardSep(e.target.value as ExportCardSep)}>
              <option value="newline">New line</option>
              <option value="semicolon">Semicolon</option>
              <option value="custom">Custom…</option>
            </select>
            {cardSep === 'custom' && (
              <input className="input" aria-label="Custom separator between cards" value={customCard} onChange={(e) => setCustomCard(e.target.value)} placeholder="e.g. ####" />
            )}
          </div>
        </div>
        <textarea className="textarea" readOnly value={text} rows={10} aria-label="Exported text" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }} />
      </div>
    </Dialog>
  )
}

function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { set, cards, setId } = useStudySet()
  const { uid } = useAuth()
  const [busy, setBusy] = useState(false)
  if (!set || !uid) return null
  const isShared = set.visibility === 'link'
  const url = shareUrl(setId)

  const enable = async () => {
    setBusy(true)
    try {
      await publishSet(uid, { ...set, visibility: 'link' }, cards)
      updateSet(uid, setId, { visibility: 'link' })
      toast('Anyone with the link can now study this set', { kind: 'success' })
    } catch (err) {
      toast((err as Error).message, { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const disable = () => {
    unpublishSet(setId)
    updateSet(uid, setId, { visibility: 'private' })
    toast('Link sharing turned off')
  }

  return (
    <Dialog open={open} onClose={onClose} title="Share this set">
      {isShared ? (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            Anyone with this link can study the set and copy it into their own library after signing in. They can’t change your set.
          </p>
          <div className="row-nowrap">
            <input className="input" readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                navigator.clipboard.writeText(url).then(() => toast('Link copied', { kind: 'success' }), () => toast('Couldn’t copy', { kind: 'error' }))
              }
            >
              <LinkIcon size={16} /> Copy
            </button>
          </div>
          {'share' in navigator && (
            <button type="button" className="btn" onClick={() => void navigator.share({ title: set.title, url }).catch(() => {})}>
              <Share2 size={16} /> Share…
            </button>
          )}
          <button type="button" className="link-btn small" onClick={disable}>
            Stop sharing (make private)
          </button>
        </div>
      ) : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            This set is private. Turn on link sharing to let others study it (read-only).
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void enable()} disabled={busy}>
            <Share2 size={16} /> Anyone with the link can view
          </button>
        </div>
      )}
    </Dialog>
  )
}

function FolderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { set, setId } = useStudySet()
  const { uid } = useAuth()
  const folders = useMyFolders(open ? uid : null)
  if (!set || !uid) return null
  const newFolder = async () => {
    const name = await promptDialog({ title: 'New folder', placeholder: 'Folder name', confirmLabel: 'Create', maxLength: 255 })
    if (!name) return
    const id = createFolder(uid, name, [setId])
    updateSet(uid, setId, { folderIds: [...set.folderIds, id] })
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add to folder"
      footer={
        <>
          <button type="button" className="btn" onClick={() => void newFolder()}>
            <FolderPlus size={16} /> New folder
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      {folders.data.length === 0 ? (
        <p className="muted">No folders yet. Create one to group sets (a set can be in several folders).</p>
      ) : (
        <div className="stack">
          {folders.data.map((f) => {
            const inFolder = f.setIds.includes(setId)
            return (
              <label key={f.id} className="check">
                <input
                  type="checkbox"
                  checked={inFolder}
                  onChange={(e) => (e.target.checked ? addSetToFolder(uid, setId, f.id) : removeSetFromFolder(uid, setId, f.id))}
                />
                <Folder size={16} /> {f.name} <span className="subtle">({f.setIds.length})</span>
              </label>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}

function CombineDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { set, cards, setId } = useStudySet()
  const { uid, displayName } = useAuth()
  const sets = useMySets(open ? uid : null)
  const navigate = useNavigate()
  if (!set || !uid) return null
  const combine = async (otherId: string) => {
    const other = sets.data.find((s) => s.id === otherId)
    if (!other) return
    const otherCards = await loadCards(uid, otherId)
    const id = createSet(
      uid,
      displayName,
      {
        title: `${set.title} + ${other.title}`.slice(0, 255),
        description: '',
        termLang: set.termLang,
        defLang: set.defLang === other.defLang ? set.defLang : set.defLang,
      },
      [...cards, ...otherCards].map((c) => ({ term: c.term, definition: c.definition, imageUrl: c.imageUrl, tags: c.tags })),
    )
    onClose()
    toast('Combined into a new set', { kind: 'success' })
    navigate(`/sets/${id}`)
  }
  const candidates = sets.data.filter((s) => s.id !== setId && isStudyable(s))
  return (
    <Dialog open={open} onClose={onClose} title="Combine with another set">
      <p className="muted">Creates a new set with the cards of both sets. The originals stay as they are.</p>
      {candidates.length === 0 ? (
        <p className="muted">You don’t have another set to combine with.</p>
      ) : (
        <div className="stack">
          {candidates.map((s) => (
            <button key={s.id} type="button" className="btn btn-block" style={{ justifyContent: 'space-between' }} onClick={() => void combine(s.id)}>
              <span className="truncate">{s.title}</span>
              <span className="badge">{s.cardCount} terms</span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  )
}
