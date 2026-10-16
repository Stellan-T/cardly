import { useDeferredValue, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Funnel,
  Split,
  Trash,
  TriangleAlert,
  Upload,
} from '../../components/icons'
import { STORAGE_PREFIX } from '../../config/app'
import {
  CARD_SEP_LABELS,
  PROBLEM_KINDS,
  TERM_SEP_LABELS,
  parseImport,
  type CardSepOption,
  type ParseOptions,
  type TermSepOption,
} from '../../lib/parseImport'
import type { CardInput } from '../../data/sets'
import { ACCEPT_ATTR, ImportFileError, readImportFile } from './readFile'
import {
  mergeWithNext,
  mergeWithPrevious,
  removeDuplicates,
  rowWarnings,
  rowsFromResult,
  splitRow,
  swapSides,
  type ImportRow,
} from './importRows'
import { SAMPLES } from './samples'
import styles from './ImportFlow.module.css'

const TERM_OPTIONS: { value: TermSepOption; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'tab', label: 'Tab' },
  { value: 'comma', label: 'Comma' },
  { value: 'colon', label: 'Colon (:)' },
  { value: 'dash', label: 'Dash ( - / – / — )' },
  { value: 'equals', label: 'Equals (=)' },
  { value: 'custom', label: 'Custom…' },
]

const CARD_OPTIONS: { value: CardSepOption; label: string }[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'newline', label: 'New line' },
  { value: 'semicolon', label: 'Semicolon' },
  { value: 'custom', label: 'Custom…' },
]

const PLACEHOLDER = `Paste your notes here, for example:

Photosynthesis: process by which plants make glucose using light
Mitochondria: organelle where cellular respiration happens
Osmosis - diffusion of water across a membrane

Bullets, numbered lists, tabs (spreadsheet or export format) and CSV all work.`

const PAGE = 150
const DRAFT_KEY = `${STORAGE_PREFIX}.importDraft`

export interface ImportOutput {
  cards: CardInput[]
  /** Suggested title: file name or first heading. */
  title: string
  /** Sample languages, if a sample was used. */
  langs?: { termLang: string; defLang: string }
}

interface Props {
  /** Footer actions rendered with the current result (create / add buttons). */
  renderActions: (output: ImportOutput, ready: boolean) => React.ReactNode
  /** Keep the pasted text across reloads (standalone page only). */
  persistDraft?: boolean
  showSamples?: boolean
}

/** Paste or upload notes, tune separators, review and fix the detected cards. */
export function ImportFlow({ renderActions, persistDraft = false, showSamples = true }: Props) {
  const [text, setText] = useState(() => {
    if (!persistDraft) return ''
    try {
      return localStorage.getItem(DRAFT_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [termSep, setTermSep] = useState<TermSepOption>('auto')
  const [cardSep, setCardSep] = useState<CardSepOption>('auto')
  const [customTerm, setCustomTerm] = useState('')
  const [customCard, setCustomCard] = useState('')
  const [headingsAsTags, setHeadingsAsTags] = useState(false)
  const [fileTitle, setFileTitle] = useState<string | null>(null)
  const [sampleLangs, setSampleLangs] = useState<ImportOutput['langs']>()
  const [fileError, setFileError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [rows, setRows] = useState<ImportRow[]>([])
  const [edited, setEdited] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!persistDraft) return
    const t = setTimeout(() => {
      try {
        if (text) localStorage.setItem(DRAFT_KEY, text)
        else localStorage.removeItem(DRAFT_KEY)
      } catch {
        // storage unavailable
      }
    }, 400)
    return () => clearTimeout(t)
  }, [text, persistDraft])

  const deferredText = useDeferredValue(text)
  const options: ParseOptions = useMemo(
    () => ({ termSep, cardSep, customTermSep: customTerm, customCardSep: customCard, headingsAsTags }),
    [termSep, cardSep, customTerm, customCard, headingsAsTags],
  )
  const result = useMemo(() => parseImport(deferredText, options), [deferredText, options])

  // Re-derive the preview whenever the input or settings change (row edits are reset).
  const lastResult = useRef(result)
  useEffect(() => {
    if (lastResult.current !== result || rows.length === 0) {
      lastResult.current = result
      setRows(rowsFromResult(result))
      setEdited(false)
      setLimit(PAGE)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const warnings = useMemo(() => rowWarnings(rows, edited ? [] : result.warnings), [rows, result.warnings, edited])
  const problemCount = useMemo(
    () => [...warnings.values()].filter((ws) => ws.some((w) => PROBLEM_KINDS.has(w.kind))).length,
    [warnings],
  )
  const duplicateCount = useMemo(
    () => [...warnings.values()].filter((ws) => ws.some((w) => w.kind === 'duplicate')).length,
    [warnings],
  )

  const visible = useMemo(() => {
    const indexed = rows.map((row, i) => ({ row, i }))
    return onlyProblems ? indexed.filter(({ i }) => warnings.get(i)?.some((w) => PROBLEM_KINDS.has(w.kind))) : indexed
  }, [rows, onlyProblems, warnings])

  const update = (next: ImportRow[]) => {
    setRows(next)
    setEdited(true)
  }

  const loadFile = async (file: File) => {
    setFileError(null)
    setReading(true)
    try {
      const res = await readImportFile(file)
      setText(res.text)
      setFileTitle(res.title)
      setSampleLangs(undefined)
      if (res.termSep) setTermSep(res.termSep)
    } catch (err) {
      setFileError(err instanceof ImportFileError ? err.message : `Couldn’t read that file: ${(err as Error).message}`)
    } finally {
      setReading(false)
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) void loadFile(file)
  }

  const output: ImportOutput = useMemo(
    () => ({
      cards: rows
        .filter((r) => r.term.trim() || r.definition.trim())
        .map((r) => ({ term: r.term.trim(), definition: r.definition.trim(), tags: r.tags })),
      title: fileTitle || result.headings[0] || '',
      langs: sampleLangs,
    }),
    [rows, fileTitle, result.headings, sampleLangs],
  )

  const detected = `${result.detected.termSep === 'custom' ? `Custom “${result.detected.customTermSep ?? ''}”` : TERM_SEP_LABELS[result.detected.termSep]} · ${
    result.detected.cardSep === 'custom' ? `Custom “${result.detected.customCardSep ?? ''}”` : CARD_SEP_LABELS[result.detected.cardSep]
  }`

  return (
    <div className={styles.flow}>
      <section className={`panel ${styles.input}`} aria-labelledby="import-input-title">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 id="import-input-title" style={{ margin: 0 }}>
            1. Paste or upload your notes
          </h2>
          <div className="row">
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT_ATTR}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void loadFile(f)
                e.target.value = ''
              }}
            />
            <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()} disabled={reading}>
              <Upload size={16} /> Upload file
            </button>
            {text && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setText('')
                  setFileTitle(null)
                  setSampleLangs(undefined)
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div
          className={`${styles.drop} ${dragging ? styles.dragging : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <textarea
            className={`textarea ${styles.textarea}`}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setSampleLangs(undefined)
            }}
            placeholder={PLACEHOLDER}
            aria-label="Notes to import"
            spellCheck={false}
            data-testid="import-text"
          />
          {dragging && <div className={styles.dropHint}>Drop the file to import it</div>}
          {reading && <div className={styles.dropHint}>Reading file…</div>}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Files: .txt, .md, .csv, .tsv, .docx and text-based .pdf (drag and drop works too).
        </p>
        {fileError && (
          <div className="alert alert-danger" role="alert">
            {fileError}
          </div>
        )}
        {showSamples && !text && (
          <div className="stack" style={{ marginTop: 12 }}>
            <span className="label">Or try a sample</span>
            <div className="row">
              {SAMPLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="btn btn-sm btn-soft"
                  aria-describedby={`sample-desc-${s.id}`}
                  onClick={() => {
                    setText(s.text)
                    setFileTitle(s.title)
                    setSampleLangs({ termLang: s.termLang, defLang: s.defLang })
                  }}
                >
                  {s.title}
                  <span id={`sample-desc-${s.id}`} hidden>
                    {s.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="import-settings-title">
        <h2 id="import-settings-title">2. Separators</h2>
        <div className={styles.settings}>
          <div className="field">
            <label htmlFor="term-sep">Between term and definition</label>
            <select id="term-sep" className="select" value={termSep} onChange={(e) => setTermSep(e.target.value as TermSepOption)}>
              {TERM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {termSep === 'custom' && (
              <input
                className="input"
                aria-label="Custom separator between term and definition"
                placeholder="e.g. ## or \t"
                value={customTerm}
                onChange={(e) => setCustomTerm(e.target.value)}
              />
            )}
          </div>
          <div className="field">
            <label htmlFor="card-sep">Between cards</label>
            <select id="card-sep" className="select" value={cardSep} onChange={(e) => setCardSep(e.target.value as CardSepOption)}>
              {CARD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {cardSep === 'custom' && (
              <input
                className="input"
                aria-label="Custom separator between cards"
                placeholder="e.g. #### or \n"
                value={customCard}
                onChange={(e) => setCustomCard(e.target.value)}
              />
            )}
          </div>
          <label className="check" style={{ alignSelf: 'end', minHeight: 42 }}>
            <input type="checkbox" checked={headingsAsTags} onChange={(e) => setHeadingsAsTags(e.target.checked)} />
            Use headings as tags
          </label>
        </div>
        {text.trim() && (
          <p className="subtle" style={{ margin: '10px 0 0' }}>
            Detected: <strong>{detected}</strong>
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="import-preview-title">
        <div className={styles.previewHead}>
          <h2 id="import-preview-title" style={{ margin: 0 }} aria-live="polite">
            3. Review{' '}
            <span className={styles.count} data-testid="import-count">
              {rows.length} {rows.length === 1 ? 'card' : 'cards'} detected
            </span>
          </h2>
          <div className="row">
            <button type="button" className="btn btn-sm" disabled={!rows.length} onClick={() => update(swapSides(rows))}>
              <ArrowLeftRight size={16} /> Swap terms and definitions
            </button>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!duplicateCount}
              onClick={() => update(removeDuplicates(rows))}
            >
              Remove duplicates{duplicateCount ? ` (${duplicateCount})` : ''}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              aria-pressed={onlyProblems}
              disabled={!problemCount && !onlyProblems}
              onClick={() => setOnlyProblems((v) => !v)}
            >
              <Funnel size={16} /> Show only rows with problems{problemCount ? ` (${problemCount})` : ''}
            </button>
          </div>
        </div>
        {edited && <p className="hint">Edits here are kept until you change the text or separators above.</p>}

        {rows.length === 0 ? (
          <p className="muted" style={{ margin: '16px 0 4px' }}>
            {text.trim()
              ? 'No cards found yet. Check the separators above.'
              : 'Your cards will appear here as you paste.'}
          </p>
        ) : (
          <ol className={styles.rows}>
            {visible.slice(0, limit).map(({ row, i }) => {
              const ws = warnings.get(i) ?? []
              const problems = ws.filter((w) => PROBLEM_KINDS.has(w.kind))
              const notes = ws.filter((w) => !PROBLEM_KINDS.has(w.kind))
              const multiLine = row.definition.includes('\n')
              return (
                <li key={row.key} className={`${styles.row} ${problems.length ? styles.problem : ''}`}>
                  <span className={styles.num} title={`Line ${row.sourceLine}`}>
                    {i + 1}
                  </span>
                  <div className={styles.fields}>
                    <textarea
                      className={`textarea ${styles.cell}`}
                      aria-label={`Term ${i + 1}`}
                      value={row.term}
                      rows={1}
                      aria-invalid={problems.some((w) => w.kind === 'empty-term' || w.kind === 'duplicate' || w.kind === 'term-too-long')}
                      onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, term: e.target.value, edited: true } : r)))}
                    />
                    <textarea
                      className={`textarea ${styles.cell}`}
                      aria-label={`Definition ${i + 1}`}
                      value={row.definition}
                      rows={Math.min(6, row.definition.split('\n').length)}
                      aria-invalid={problems.some((w) => w.kind === 'empty-definition' || w.kind === 'definition-too-long')}
                      onChange={(e) =>
                        update(rows.map((r, j) => (j === i ? { ...r, definition: e.target.value, edited: true } : r)))
                      }
                    />
                    {(ws.length > 0 || row.tags?.length) && (
                      <div className={styles.notes}>
                        {row.tags?.map((t) => (
                          <span key={t} className="badge">
                            #{t}
                          </span>
                        ))}
                        {problems.map((w, k) => (
                          <span key={k} className="badge badge-danger">
                            <TriangleAlert size={12} /> {w.message}
                          </span>
                        ))}
                        {notes.map((w, k) => (
                          <span key={`n${k}`} className={`badge ${w.kind === 'merged' ? 'badge-primary' : 'badge-warning'}`}>
                            {w.message}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Merge with previous card"
                      aria-label={`Merge card ${i + 1} into the previous card`}
                      disabled={i === 0}
                      onClick={() => update(mergeWithPrevious(rows, i))}
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Merge with next card"
                      aria-label={`Merge the next card into card ${i + 1}`}
                      disabled={i === rows.length - 1}
                      onClick={() => update(mergeWithNext(rows, i))}
                    >
                      <ChevronDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Split joined lines into separate cards"
                      aria-label={`Split card ${i + 1}`}
                      disabled={!multiLine}
                      onClick={() =>
                        update(splitRow(rows, i, result.detected.termSep, result.detected.customTermSep))
                      }
                    >
                      <Split size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      title="Delete card"
                      aria-label={`Delete card ${i + 1}`}
                      onClick={() => update(rows.filter((_, j) => j !== i))}
                    >
                      <Trash size={16} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {visible.length > limit && (
          <div className="center" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show more ({visible.length - limit} more)
            </button>
          </div>
        )}
        {onlyProblems && visible.length === 0 && <p className="muted">No problems left. </p>}
      </section>

      <div className={styles.footer}>{renderActions(output, output.cards.length > 0)}</div>
    </div>
  )
}

export function clearImportDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // ignore
  }
}
