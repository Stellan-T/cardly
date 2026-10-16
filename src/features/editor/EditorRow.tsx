import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLayoutEffect, useRef, useState } from 'react'
import { Dialog } from '../../components/Dialog'
import { GripVertical, Image as ImageIcon, Plus, Trash, X } from '../../components/icons'
import { CardImage } from '../../components/StudyButtons'
import { saveImage } from '../../data/images'
import { MAX_DEFINITION_LENGTH, MAX_TERM_LENGTH } from '../../lib/parseImport'
import { languageName } from '../../lib/languages'
import type { Card } from '../../types'
import styles from './SetEditor.module.css'

export type EditorCard = Omit<Card, 'order'>

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [props.value])
  return <textarea ref={ref} rows={1} {...props} />
}

interface Props {
  card: EditorCard
  index: number
  uid: string
  termLang: string
  defLang: string
  onChange: (patch: Partial<EditorCard>) => void
  onDelete: () => void
  onInsertAfter: () => void
  /** Returns true when it handled the Tab key. */
  onTab: (field: 'term' | 'definition', back: boolean) => boolean
  onBlur: () => void
}

// Esc lets the next Tab keypress follow normal focus order (to reach buttons).
let tabReleased = false

export function EditorRow({ card, index, uid, termLang, defLang, onChange, onDelete, onInsertAfter, onTab, onBlur }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  const [imageOpen, setImageOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [imageError, setImageError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const onKeyDown = (field: 'term' | 'definition') => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      tabReleased = true
      return
    }
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return
    if (tabReleased) {
      tabReleased = false
      return
    }
    if (onTab(field, e.shiftKey)) e.preventDefault()
  }

  const upload = async (file: File) => {
    setImageError(null)
    setUploading(true)
    try {
      const imageId = await saveImage(uid, file)
      onChange({ imageId, imageUrl: null })
      setImageOpen(false)
    } catch (err) {
      setImageError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const hasImage = !!(card.imageId || card.imageUrl)
  const termTooLong = card.term.length > MAX_TERM_LENGTH
  const defTooLong = card.definition.length > MAX_DEFINITION_LENGTH

  return (
    <li
      ref={setNodeRef}
      className={`panel ${styles.row} ${isDragging ? styles.dragging : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className={styles.rowHead}>
        <span className={styles.rowNum}>{index + 1}</span>
        <span className="spacer" />
        <button
          type="button"
          className={`btn btn-ghost btn-icon btn-sm ${styles.handle}`}
          aria-label={`Reorder card ${index + 1} (drag, or press Space then use arrow keys)`}
          title="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={18} />
        </button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Delete card ${index + 1}`} title="Delete card" onClick={onDelete}>
          <Trash size={17} />
        </button>
      </div>
      <div className={styles.rowFields}>
        <div className="field">
          <AutoTextarea
            className="textarea"
            data-card={card.id}
            data-field="term"
            aria-label={`Term ${index + 1}`}
            aria-invalid={termTooLong || undefined}
            value={card.term}
            placeholder="Term"
            lang={termLang !== 'und' ? termLang : undefined}
            onChange={(e) => onChange({ term: e.target.value })}
            onKeyDown={onKeyDown('term')}
            onBlur={onBlur}
          />
          <span className={styles.fieldLabel}>
            Term{termLang !== 'und' ? ` · ${languageName(termLang)}` : ''}
            {termTooLong && <span className="badge badge-danger"> Too long</span>}
          </span>
        </div>
        <div className="field">
          <AutoTextarea
            className="textarea"
            data-card={card.id}
            data-field="definition"
            aria-label={`Definition ${index + 1}`}
            aria-invalid={defTooLong || undefined}
            value={card.definition}
            placeholder="Definition"
            lang={defLang !== 'und' ? defLang : undefined}
            onChange={(e) => onChange({ definition: e.target.value })}
            onKeyDown={onKeyDown('definition')}
            onBlur={onBlur}
          />
          <span className={styles.fieldLabel}>
            Definition{defLang !== 'und' ? ` · ${languageName(defLang)}` : ''}
            {defTooLong && <span className="badge badge-danger"> Too long</span>}
          </span>
        </div>
        <div className={styles.imageCell}>
          {hasImage ? (
            <div className={styles.thumb}>
              <CardImage card={card} source={{ ownerUid: uid }} className={styles.thumbImg} alt={`Image for ${card.term}`} />
              <button
                type="button"
                className="btn btn-icon btn-sm"
                aria-label="Remove image"
                onClick={() => onChange({ imageId: null, imageUrl: null })}
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <button type="button" className={styles.imageBtn} onClick={() => setImageOpen(true)} aria-label={`Add image to card ${index + 1}`}>
              <ImageIcon size={20} />
              <span>Image</span>
            </button>
          )}
        </div>
      </div>
      {card.tags && card.tags.length > 0 && (
        <div className="row" style={{ marginTop: 6 }}>
          {card.tags.map((t) => (
            <span key={t} className="badge">
              #{t}
            </span>
          ))}
        </div>
      )}
      <button type="button" className={styles.insert} onClick={onInsertAfter} aria-label={`Insert a card after card ${index + 1}`} title="Insert card here">
        <Plus size={16} />
      </button>

      <Dialog open={imageOpen} onClose={() => setImageOpen(false)} title="Add an image">
        <div className="stack">
          <form
            className="field"
            onSubmit={(e) => {
              e.preventDefault()
              if (!/^https?:\/\//i.test(url.trim())) {
                setImageError('Enter a full image URL starting with https://')
                return
              }
              if (url.trim().length > 2048) {
                setImageError('That image URL is too long (2,048 characters at most). Try uploading the image instead.')
                return
              }
              onChange({ imageUrl: url.trim(), imageId: null })
              setUrl('')
              setImageOpen(false)
            }}
          >
            <label htmlFor={`img-url-${card.id}`}>Paste an image URL</label>
            <div className="row-nowrap">
              <input
                id={`img-url-${card.id}`}
                className="input"
                type="url"
                maxLength={2048}
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">
                Add
              </button>
            </div>
          </form>
          <div className="center muted small">or</div>
          <label className="btn btn-block">
            <ImageIcon size={18} /> {uploading ? 'Compressing…' : 'Upload an image'}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
                e.target.value = ''
              }}
            />
          </label>
          <p className="hint">Uploads are resized to 800 px and compressed to 150 KB or less so they sync quickly.</p>
          {imageError && (
            <div className="alert alert-danger" role="alert">
              {imageError}
            </div>
          )}
        </div>
      </Dialog>
    </li>
  )
}
