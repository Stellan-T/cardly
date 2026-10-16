import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { getDoc } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Dialog } from '../../components/Dialog'
import { PageLoading } from '../../components/controls'
import { FileText, Globe, Lock, Plus } from '../../components/icons'
import { K, useShortcutHelp } from '../../components/Shortcuts'
import { toast } from '../../components/toast'
import { useHotkeys } from '../../components/hotkeys'
import { toStudySet } from '../../data/mappers'
import { newId, setRef } from '../../data/paths'
import { createSet, loadCards, publishSet, saveCards, unpublishSet, updateSet } from '../../data/sets'
import { useSync } from '../../data/sync'
import { guessLanguage, LANGUAGES, userLanguage } from '../../lib/languages'
import { MAX_DEFINITION_LENGTH, MAX_TERM_LENGTH } from '../../lib/parseImport'
import type { Card, StudySet, Visibility } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { ImportFlow } from '../import/ImportFlow'
import { EditorRow, type EditorCard } from './EditorRow'
import styles from './SetEditor.module.css'

interface Meta {
  title: string
  description: string
  termLang: string
  defLang: string
  visibility: Visibility
}

const AUTOSAVE_MS = 2500
const blankCard = (): EditorCard => ({ id: newId(), term: '', definition: '', starred: false })
const isBlank = (c: EditorCard) => !c.term.trim() && !c.definition.trim() && !c.imageId && !c.imageUrl
const cardKey = (c: EditorCard, order: number) =>
  JSON.stringify([c.term, c.definition, c.imageId ?? null, c.imageUrl ?? null, c.tags ?? [], order, c.starred])

export default function SetEditorPage() {
  const { setId: routeSetId } = useParams()
  const isNew = !routeSetId
  const { uid, displayName } = useAuth()
  const navigate = useNavigate()
  const online = useSync((s) => s.online)

  const [loading, setLoading] = useState(!isNew)
  const [notFound, setNotFound] = useState(false)
  const [setId, setSetId] = useState<string | null>(routeSetId ?? null)
  const [setDoc, setSetDoc] = useState<StudySet | null>(null)
  const [meta, setMeta] = useState<Meta>({ title: '', description: '', termLang: 'und', defLang: 'und', visibility: 'private' })
  const [langAuto, setLangAuto] = useState({ term: isNew, def: isNew })
  const [cards, setCards] = useState<EditorCard[]>(() => (isNew ? [blankCard(), blankCard(), blankCard()] : []))
  const [status, setStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'offline' | 'error'>('idle')
  const [importOpen, setImportOpen] = useState(false)
  const [errors, setErrors] = useState<string | null>(null)
  const [focusTarget, setFocusTarget] = useState<{ id: string; field: 'term' | 'definition' } | null>(null)

  const saved = useRef<{ cards: Map<string, string>; meta: string; draft: boolean }>({ cards: new Map(), meta: '', draft: true })
  const published = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ meta, cards, setId })
  latest.current = { meta, cards, setId }

  // Load an existing set once (not live, so remote changes don't clobber typing).
  useEffect(() => {
    if (isNew || !uid || !routeSetId) return
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(setRef(uid, routeSetId))
        if (!snap.exists()) {
          if (!cancelled) setNotFound(true)
          return
        }
        const set = toStudySet(snap.data(), snap.id)
        const loaded = await loadCards(uid, routeSetId)
        if (cancelled) return
        const m: Meta = {
          title: set.title,
          description: set.description,
          termLang: set.termLang,
          defLang: set.defLang,
          visibility: set.visibility,
        }
        setSetDoc(set)
        published.current = set.visibility === 'link'
        setMeta(m)
        const editorCards = loaded.map((c) => ({ ...c }))
        setCards(editorCards.length ? editorCards : [blankCard(), blankCard()])
        saved.current = {
          cards: new Map(loaded.map((c) => [c.id, cardKey(c, c.order)])),
          meta: JSON.stringify(m),
          draft: set.draft,
        }
        setLangAuto({ term: set.termLang === 'und', def: set.defLang === 'und' })
      } catch (err) {
        console.error(err)
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isNew, uid, routeSetId])

  // Auto-guess languages from content until the user picks one.
  const guessed = useMemo(() => {
    const filled = cards.filter((c) => !isBlank(c)).slice(0, 100)
    if (filled.length < 2) return null
    return { term: guessLanguage(filled.map((c) => c.term)), def: guessLanguage(filled.map((c) => c.definition)) }
  }, [cards])
  useEffect(() => {
    if (!guessed) return
    setMeta((m) => {
      const fallback = userLanguage()
      const termLang = langAuto.term ? (guessed.term !== 'und' ? guessed.term : fallback) : m.termLang
      const defLang = langAuto.def ? (guessed.def !== 'und' ? guessed.def : fallback) : m.defLang
      return termLang === m.termLang && defLang === m.defLang ? m : { ...m, termLang, defLang }
    })
  }, [guessed, langAuto])

  /** Writes whatever changed since the last save. */
  const save = useCallback(
    (opts: { finalize?: boolean } = {}): string | null => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      if (!uid) return null
      const { meta: m, cards: cs } = latest.current
      let id = latest.current.setId
      // Blank rows aren't saved; over-long fields wait until they're fixed (the rules would reject them).
      const kept = cs.filter(
        (c) => !isBlank(c) && c.term.length <= MAX_TERM_LENGTH && c.definition.length <= MAX_DEFINITION_LENGTH,
      )
      const metaKey = JSON.stringify(m)
      const finalize = !!opts.finalize

      if (!id) {
        if (kept.length === 0 && !m.title.trim() && !finalize) return null
        id = createSet(
          uid,
          displayName,
          { ...m, title: m.title.trim() || 'Untitled set', draft: !finalize },
          kept.map((c) => ({ ...c })),
        )
        saved.current = {
          cards: new Map(kept.map((c, i) => [c.id, cardKey(c, i)])),
          meta: metaKey,
          draft: !finalize,
        }
        setSetId(id)
        latest.current.setId = id
        setStatus(online ? 'saved' : 'offline')
        if (finalize && m.visibility === 'link') publish(id, m, kept)
        return id
      }

      const upserts: Card[] = []
      kept.forEach((c, order) => {
        const key = cardKey(c, order)
        if (saved.current.cards.get(c.id) !== key) upserts.push({ ...c, order })
      })
      const keptIds = new Set(kept.map((c) => c.id))
      const deletes = [...saved.current.cards.keys()].filter((cid) => !keptIds.has(cid))
      const metaChanged = metaKey !== saved.current.meta || (finalize && saved.current.draft)

      if (!upserts.length && !deletes.length && !metaChanged) {
        setStatus((s) => (s === 'pending' ? 'saved' : s))
        return id
      }
      setStatus('saving')
      if (metaChanged) {
        updateSet(uid, id, { ...m, title: m.title.trim() || 'Untitled set', ...(finalize ? { draft: false } : {}) })
      }
      const promise =
        upserts.length || deletes.length
          ? saveCards(uid, id, upserts, deletes, {
              cardCount: kept.length,
              starredCount: kept.filter((c) => c.starred).length,
            })
          : Promise.resolve()
      saved.current = {
        cards: new Map(kept.map((c, i) => [c.id, cardKey(c, i)])),
        meta: metaKey,
        draft: finalize ? false : saved.current.draft,
      }
      if (!navigator.onLine) setStatus('offline')
      else {
        // The local cache already has the change; if the server is slow or unreachable, say so.
        let acknowledged = false
        void promise.then(() => {
          acknowledged = true
          setStatus('saved')
        })
        setTimeout(() => !acknowledged && setStatus((st) => (st === 'saving' ? 'offline' : st)), 4000)
      }

      // Keep the shared copy in step.
      if (m.visibility === 'link' && !saved.current.draft) publish(id, m, kept)
      else if (m.visibility === 'private' && published.current) {
        unpublishSet(id)
        published.current = false
      }
      return id
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, displayName, online, setDoc],
  )

  function publish(id: string, m: Meta, kept: EditorCard[]) {
    if (!uid) return
    const set: StudySet = { ...(setDoc ?? ({} as StudySet)), id, ownerUid: uid, ownerName: displayName, ...m }
    published.current = true
    publishSet(uid, set, kept.map((c, i) => ({ ...c, order: i }))).catch((err: Error) => toast(err.message, { kind: 'error' }))
  }

  const scheduleSave = useCallback(() => {
    setStatus('pending')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save(), AUTOSAVE_MS)
  }, [save])

  // Save when leaving the page or hiding the tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && timer.current) save()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      if (timer.current) save()
    }
  }, [save])

  const changeMeta = (patch: Partial<Meta>) => {
    setMeta((m) => ({ ...m, ...patch }))
    scheduleSave()
  }
  const changeCard = (id: string, patch: Partial<EditorCard>) => {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    scheduleSave()
  }
  const insertAfter = (index: number) => {
    const card = blankCard()
    setCards((cs) => [...cs.slice(0, index + 1), card, ...cs.slice(index + 1)])
    setFocusTarget({ id: card.id, field: 'term' })
  }
  const removeCard = (id: string) => {
    setCards((cs) => (cs.length <= 1 ? [blankCard()] : cs.filter((c) => c.id !== id)))
    scheduleSave()
  }

  useEffect(() => {
    if (!focusTarget) return
    const el = document.querySelector<HTMLTextAreaElement>(`[data-card="${focusTarget.id}"][data-field="${focusTarget.field}"]`)
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
    setFocusTarget(null)
  }, [focusTarget, cards])

  /** Tab / Shift+Tab move between term and definition fields; Tab on the last definition adds a card. */
  const onFieldTab = (index: number, field: 'term' | 'definition', back: boolean) => {
    if (!back) {
      if (field === 'term') setFocusTarget({ id: cards[index].id, field: 'definition' })
      else if (index < cards.length - 1) setFocusTarget({ id: cards[index + 1].id, field: 'term' })
      else insertAfter(index)
    } else {
      if (field === 'definition') setFocusTarget({ id: cards[index].id, field: 'term' })
      else if (index > 0) setFocusTarget({ id: cards[index - 1].id, field: 'definition' })
      else return false
    }
    return true
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    setCards((cs) => {
      const from = cs.findIndex((c) => c.id === e.active.id)
      const to = cs.findIndex((c) => c.id === e.over!.id)
      return arrayMove(cs, from, to)
    })
    scheduleSave()
  }

  const filled = cards.filter((c) => !isBlank(c))
  const tooLong = filled.some((c) => c.term.length > MAX_TERM_LENGTH || c.definition.length > MAX_DEFINITION_LENGTH)

  const finish = () => {
    if (filled.length < 2) {
      setErrors('Add at least 2 cards (a term and a definition each) to create a set you can study.')
      return
    }
    if (tooLong) {
      setErrors(`Terms can be up to ${MAX_TERM_LENGTH.toLocaleString()} characters and definitions up to ${MAX_DEFINITION_LENGTH.toLocaleString()}.`)
      return
    }
    setErrors(null)
    const id = save({ finalize: true })
    if (id) {
      toast(isNew || saved.current.draft ? 'Set created' : 'Changes saved', { kind: 'success' })
      navigate(`/sets/${id}`)
    }
  }

  useHotkeys({ 'mod+enter': finish, 'mod+s': () => save() }, { allowInInputs: ['mod+enter', 'mod+s'] })
  useShortcutHelp([
    {
      title: 'Editor',
      items: [
        [<K key="t">Tab</K>, 'Next field (adds a card at the end)'],
        [
          <span key="st">
            <K>Shift</K> + <K>Tab</K>
          </span>,
          'Previous field',
        ],
        [<K key="e">Esc</K>, 'Let the next Tab move to buttons instead'],
        [
          <span key="ce">
            <K>Ctrl/⌘</K> + <K>Enter</K>
          </span>,
          'Save and finish',
        ],
      ],
    },
  ])

  if (loading) return <PageLoading />
  if (notFound)
    return (
      <div className="container page">
        <div className="empty">
          <h1>Set not found</h1>
          <Link to="/library" className="btn btn-primary">
            Go to your library
          </Link>
        </div>
      </div>
    )

  const statusText =
    status === 'pending' || status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : status === 'offline'
          ? 'Saved on this device (will sync)'
          : status === 'error'
            ? 'Couldn’t save'
            : ''

  return (
    <div className="container page">
      <div className={styles.head}>
        <h1 style={{ margin: 0 }}>{isNew && !setDoc ? 'Create a new set' : 'Edit set'}</h1>
        <span className="subtle" role="status" aria-live="polite" data-testid="save-status">
          {statusText}
        </span>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => setImportOpen(true)}>
          <FileText size={18} /> Import
        </button>
        <button type="button" className="btn btn-primary" onClick={finish}>
          {isNew || saved.current.draft ? 'Create' : 'Done'}
        </button>
      </div>

      <div className={`panel ${styles.meta}`}>
        <div className="field">
          <label htmlFor="set-title">Title</label>
          <input
            id="set-title"
            className="input input-lg"
            placeholder='Enter a title, like “Biology – Chapter 22: Evolution”'
            value={meta.title}
            maxLength={255}
            onChange={(e) => changeMeta({ title: e.target.value })}
            onBlur={() => timer.current && save()}
            autoFocus={isNew}
          />
        </div>
        <div className="field">
          <label htmlFor="set-desc">Description</label>
          <textarea
            id="set-desc"
            className="textarea"
            rows={2}
            style={{ minHeight: 60 }}
            placeholder="Add a description…"
            value={meta.description}
            maxLength={2000}
            onChange={(e) => changeMeta({ description: e.target.value })}
            onBlur={() => timer.current && save()}
          />
        </div>
        <div className={styles.metaRow}>
          <div className="field">
            <label htmlFor="term-lang">Term language</label>
            <select
              id="term-lang"
              className="select"
              value={meta.termLang}
              onChange={(e) => {
                setLangAuto((a) => ({ ...a, term: false }))
                changeMeta({ termLang: e.target.value })
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            {langAuto.term && <span className="hint">Guessed from your terms</span>}
          </div>
          <div className="field">
            <label htmlFor="def-lang">Definition language</label>
            <select
              id="def-lang"
              className="select"
              value={meta.defLang}
              onChange={(e) => {
                setLangAuto((a) => ({ ...a, def: false }))
                changeMeta({ defLang: e.target.value })
              }}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            {langAuto.def && <span className="hint">Guessed from your definitions</span>}
          </div>
          <div className="field">
            <label htmlFor="visibility">Visible to</label>
            <select
              id="visibility"
              className="select"
              value={meta.visibility}
              onChange={(e) => changeMeta({ visibility: e.target.value as Visibility })}
            >
              <option value="private">Only me</option>
              <option value="link">Anyone with the link</option>
            </select>
            <span className="hint">
              {meta.visibility === 'link' ? (
                <>
                  <Globe size={12} /> Others can study and copy it (read-only).
                </>
              ) : (
                <>
                  <Lock size={12} /> Private to you.
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      {errors && (
        <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}>
          {errors}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ol className={styles.cards} aria-label="Cards">
            {cards.map((card, i) => (
              <EditorRow
                key={card.id}
                card={card}
                index={i}
                uid={uid!}
                termLang={meta.termLang}
                defLang={meta.defLang}
                onChange={(patch) => changeCard(card.id, patch)}
                onDelete={() => removeCard(card.id)}
                onInsertAfter={() => insertAfter(i)}
                onTab={(field, back) => onFieldTab(i, field, back)}
                onBlur={() => timer.current && save()}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <button type="button" className={`btn btn-block btn-lg ${styles.addCard}`} onClick={() => insertAfter(cards.length - 1)}>
        <Plus size={20} /> Add card
      </button>

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
        <span className="subtle">
          {filled.length} {filled.length === 1 ? 'card' : 'cards'}
        </span>
        <button type="button" className="btn btn-primary btn-lg" onClick={finish}>
          {isNew || saved.current.draft ? 'Create' : 'Done'}
        </button>
      </div>

      <Dialog open={importOpen} onClose={() => setImportOpen(false)} title="Import cards" wide>
        <ImportFlow
          showSamples={false}
          renderActions={(out, ready) => (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setImportOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!ready}
                onClick={() => {
                  setCards((cs) => [
                    ...cs.filter((c) => !isBlank(c)),
                    ...out.cards.map((c) => ({ ...blankCard(), term: c.term, definition: c.definition, tags: c.tags })),
                  ])
                  if (!meta.title && out.title) setMeta((m) => ({ ...m, title: out.title }))
                  setImportOpen(false)
                  scheduleSave()
                  toast(`Added ${out.cards.length} cards`, { kind: 'success' })
                }}
              >
                Add {out.cards.length} cards
              </button>
            </div>
          )}
        />
      </Dialog>
    </div>
  )
}
