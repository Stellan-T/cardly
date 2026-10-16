import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Dialog } from '../../components/Dialog'
import { toast } from '../../components/toast'
import { appendCards, createSet, loadCards } from '../../data/sets'
import { isStudyable, useMySets } from '../../data/setsHooks'
import { guessLanguage, userLanguage } from '../../lib/languages'
import { MAX_DEFINITION_LENGTH, MAX_TERM_LENGTH } from '../../lib/parseImport'
import type { CardInput } from '../../data/sets'
import { useAuth } from '../auth/AuthProvider'
import { ImportFlow, clearImportDraft, type ImportOutput } from './ImportFlow'

export function guessLangs(cards: CardInput[]) {
  const termLang = guessLanguage(cards.map((c) => c.term))
  const defLang = guessLanguage(cards.map((c) => c.definition))
  const user = userLanguage()
  return {
    termLang: termLang === 'und' ? (defLang === 'und' ? user : defLang) : termLang,
    defLang: defLang === 'und' ? (termLang === 'und' ? user : termLang) : defLang,
  }
}

export default function ImportPage() {
  const { uid, displayName } = useAuth()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [pending, setPending] = useState<ImportOutput | null>(null)
  const sets = useMySets(uid)

  const create = (out: ImportOutput) => {
    if (!uid) return
    const langs = out.langs ?? guessLangs(out.cards)
    const id = createSet(uid, displayName, { title: (titleTouched ? title : out.title) || 'Imported set', ...langs }, out.cards)
    clearImportDraft()
    toast(`Created a set with ${out.cards.length} cards`, { kind: 'success' })
    navigate(`/sets/${id}`)
  }

  const addTo = async (setId: string) => {
    if (!uid || !pending) return
    const set = sets.data.find((s) => s.id === setId)
    if (!set) return
    const existing = await loadCards(uid, setId).catch(() => [])
    appendCards(uid, set, existing, pending.cards)
    clearImportDraft()
    setPickOpen(false)
    toast(`Added ${pending.cards.length} cards to “${set.title}”`, { kind: 'success' })
    navigate(`/sets/${setId}`)
  }

  return (
    <div className="container page">
      <h1>Import from notes</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Paste notes written as <code>term: definition</code>, a list, a spreadsheet export or a document. Cards are
        detected as you type — check the preview, fix anything odd, and create your set.
      </p>
      <ImportFlow
        persistDraft
        renderActions={(out, hasCards) => {
          const tooLong = out.cards.some((c) => c.term.length > MAX_TERM_LENGTH || c.definition.length > MAX_DEFINITION_LENGTH)
          const ready = hasCards && !tooLong
          return (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {tooLong && (
              <div className="alert alert-danger" style={{ flexBasis: '100%' }}>
                Some cards are too long (terms up to {MAX_TERM_LENGTH.toLocaleString()} characters, definitions up to{' '}
                {MAX_DEFINITION_LENGTH.toLocaleString()}). Shorten or split them first.
              </div>
            )}
            <div className="field" style={{ flex: '1 1 260px', maxWidth: 420 }}>
              <label htmlFor="import-title" className="sr-only">
                Set title
              </label>
              <input
                id="import-title"
                className="input"
                placeholder="Set title"
                value={titleTouched ? title : out.title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setTitleTouched(true)
                }}
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn"
                disabled={!ready}
                onClick={() => {
                  setPending(out)
                  setPickOpen(true)
                }}
              >
                Add to existing set
              </button>
              <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => create(out)}>
                Create set{ready ? ` (${out.cards.length})` : ''}
              </button>
            </div>
          </div>
          )
        }}
      />
      <Dialog open={pickOpen} onClose={() => setPickOpen(false)} title="Add to which set?">
        {sets.data.filter(isStudyable).length === 0 ? (
          <p className="muted">You don’t have any sets yet. Create a new one instead.</p>
        ) : (
          <div className="stack">
            {sets.data.filter(isStudyable).map((s) => (
              <button key={s.id} type="button" className="btn btn-block" style={{ justifyContent: 'space-between' }} onClick={() => void addTo(s.id)}>
                <span className="truncate">{s.title}</span>
                <span className="badge">{s.cardCount} terms</span>
              </button>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  )
}
