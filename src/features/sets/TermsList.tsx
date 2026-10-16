import { useMemo, useState } from 'react'
import { Check, Pencil, X } from '../../components/icons'
import { Segmented } from '../../components/controls'
import { AudioButton, CardImage, StarButton } from '../../components/StudyButtons'
import { toast } from '../../components/toast'
import { saveCards } from '../../data/sets'
import { MAX_DEFINITION_LENGTH, MAX_TERM_LENGTH } from '../../lib/parseImport'
import type { Card } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from './StudySetContext'
import styles from './SetPage.module.css'

export function TermsList() {
  const { cards, meta, isPublic, setId, imageSource, toggleStar } = useStudySet()
  const { uid, settings } = useAuth()
  const [filter, setFilter] = useState<'all' | 'starred'>('all')
  const [sort, setSort] = useState<'original' | 'alpha'>('original')
  const [tag, setTag] = useState<string>('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ term: '', definition: '' })

  const tags = useMemo(() => [...new Set(cards.flatMap((c) => c.tags ?? []))].sort(), [cards])
  const starredCount = cards.filter((c) => c.starred).length

  const shown = useMemo(() => {
    let list = filter === 'starred' ? cards.filter((c) => c.starred) : cards
    if (tag) list = list.filter((c) => c.tags?.includes(tag))
    if (sort === 'alpha') list = [...list].sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }))
    return list
  }, [cards, filter, sort, tag])

  const startEdit = (c: Card) => {
    setEditing(c.id)
    setDraft({ term: c.term, definition: c.definition })
  }
  const commit = (c: Card) => {
    if (!uid) return
    if (draft.term.length > MAX_TERM_LENGTH || draft.definition.length > MAX_DEFINITION_LENGTH) {
      toast('That text is too long for a card.', { kind: 'error' })
      return
    }
    if (draft.term !== c.term || draft.definition !== c.definition) {
      void saveCards(uid, setId, [{ ...c, term: draft.term, definition: draft.definition }], [], {
        cardCount: cards.length,
        starredCount,
      })
    }
    setEditing(null)
  }

  return (
    <section className="section" aria-labelledby="terms-title">
      <div className="section-title" style={{ flexWrap: 'wrap' }}>
        <h2 id="terms-title">Terms in this set ({cards.length})</h2>
        <span className="spacer" />
        {tags.length > 0 && (
          <select className="select" style={{ width: 'auto', minHeight: 36 }} value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
        )}
        <Segmented
          label="Filter terms"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'starred', label: `Starred (${starredCount})` },
          ]}
        />
        <Segmented
          label="Sort terms"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'original', label: 'Original order' },
            { value: 'alpha', label: 'Alphabetical' },
          ]}
        />
      </div>
      {shown.length === 0 ? (
        <p className="muted">{filter === 'starred' ? 'No starred terms yet. Tap ☆ on a term to star it.' : 'No terms.'}</p>
      ) : (
        <ul className={styles.terms}>
          {shown.map((c) => (
            <li key={c.id} className={`panel ${styles.term}`}>
              {editing === c.id ? (
                <form
                  className={styles.termEdit}
                  onSubmit={(e) => {
                    e.preventDefault()
                    commit(c)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditing(null)
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit(c)
                  }}
                >
                  <textarea
                    className="textarea"
                    aria-label="Term"
                    value={draft.term}
                    autoFocus
                    rows={2}
                    onChange={(e) => setDraft((d) => ({ ...d, term: e.target.value }))}
                  />
                  <textarea
                    className="textarea"
                    aria-label="Definition"
                    value={draft.definition}
                    rows={3}
                    onChange={(e) => setDraft((d) => ({ ...d, definition: e.target.value }))}
                  />
                  <div className="row">
                    <button type="submit" className="btn btn-sm btn-primary">
                      <Check size={16} /> Save
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                      <X size={16} /> Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className={styles.termSide} lang={meta.termLang !== 'und' ? meta.termLang : undefined}>
                    {c.term}
                  </div>
                  <div className={styles.termDef}>
                    <span className="pre-wrap" lang={meta.defLang !== 'und' ? meta.defLang : undefined}>
                      {c.definition}
                    </span>
                    <CardImage card={c} source={imageSource} className={styles.termImg} alt="" />
                    {c.tags?.length ? (
                      <span className="row" style={{ gap: 4 }}>
                        {c.tags.map((t) => (
                          <span key={t} className="badge">
                            #{t}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.termActions}>
                    <StarButton starred={c.starred} onToggle={() => toggleStar(c.id)} size={18} className="btn btn-ghost btn-icon btn-sm" />
                    <AudioButton
                      text={c.term}
                      lang={meta.termLang}
                      voiceURI={settings.voices[meta.termLang]}
                      size={18}
                      className="btn btn-ghost btn-icon btn-sm"
                      label="Play term audio"
                    />
                    <AudioButton
                      text={c.definition}
                      lang={meta.defLang}
                      voiceURI={settings.voices[meta.defLang]}
                      size={18}
                      className="btn btn-ghost btn-icon btn-sm"
                      label="Play definition audio"
                    />
                    {!isPublic && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon btn-sm"
                        aria-label={`Edit ${c.term}`}
                        title="Edit"
                        onClick={() => startEdit(c)}
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
