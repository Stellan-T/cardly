import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { PageLoading } from '../../components/controls'
import { Copy, Globe, Lock, Pencil } from '../../components/icons'
import { toast } from '../../components/toast'
import { copyPublicSet } from '../../data/sets'
import { formatRelative } from '../../lib/format'
import { languageName } from '../../lib/languages'
import { useAuth } from '../auth/AuthProvider'
import { ACTIVITIES, ACTIVITY_ORDER } from '../study/activities'
import { ProgressSection } from './ProgressSection'
import { SetActions } from './SetActions'
import { SetPreview } from './SetPreview'
import { StatsPanel } from './StatsPanel'
import { useStudySet } from './StudySetContext'
import { TermsList } from './TermsList'
import styles from './SetPage.module.css'

export default function SetPage() {
  const { status, meta, cards, basePath, isPublic, isOwner, setId, set } = useStudySet()
  const { uid, displayName } = useAuth()
  const navigate = useNavigate()
  const [copying, setCopying] = useState(false)

  if (status === 'loading') return <PageLoading />
  if (status !== 'ready')
    return (
      <div className="container page">
        <div className="empty">
          <h1>Set not found</h1>
          <p className="muted">
            {isPublic ? 'This link isn’t shared anymore, or the set was deleted.' : 'It may have been deleted on another device.'}
          </p>
          <Link className="btn btn-primary" to="/library">
            Go to your library
          </Link>
        </div>
      </div>
    )
  // Owners opening their own share link land on their editable set.
  if (isPublic && isOwner) return <Navigate to={`/sets/${setId}`} replace />

  const copy = async () => {
    if (!uid) return
    setCopying(true)
    try {
      const id = await copyPublicSet(
        uid,
        displayName,
        setId,
        { title: meta.title, description: meta.description, termLang: meta.termLang, defLang: meta.defLang },
        cards,
      )
      toast('Copied to your library', { kind: 'success' })
      navigate(`/sets/${id}`)
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="container page">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1>{meta.title}</h1>
          {meta.description && (
            <p className="muted pre-wrap" style={{ marginBottom: 8 }}>
              {meta.description}
            </p>
          )}
          <div className={styles.meta}>
            <span>
              {cards.length} {cards.length === 1 ? 'term' : 'terms'}
            </span>
            <span>by {isPublic ? meta.ownerName || 'someone' : 'you'}</span>
            <span>edited {formatRelative(meta.updatedAt)}</span>
            {meta.termLang !== 'und' && (
              <span>
                {languageName(meta.termLang)}
                {meta.defLang !== meta.termLang && meta.defLang !== 'und' ? ` → ${languageName(meta.defLang)}` : ''}
              </span>
            )}
            {meta.visibility === 'link' ? (
              <span className="badge badge-primary">
                <Globe size={12} /> Anyone with the link
              </span>
            ) : (
              <span className="badge">
                <Lock size={12} /> Only me
              </span>
            )}
            {set?.draft && <span className="badge badge-warning">Draft</span>}
          </div>
        </div>
        <div className="row">
          {isPublic ? (
            <button type="button" className="btn btn-primary" onClick={() => void copy()} disabled={copying}>
              <Copy size={18} /> Copy to my library
            </button>
          ) : (
            <>
              <Link className="btn" to={`${basePath}/edit`}>
                <Pencil size={18} /> Edit
              </Link>
              <SetActions />
            </>
          )}
        </div>
      </header>

      {cards.length === 0 ? (
        <div className="empty">
          <h2>This set has no cards yet</h2>
          {!isPublic && (
            <Link className="btn btn-primary" to={`${basePath}/edit`}>
              Add cards
            </Link>
          )}
        </div>
      ) : (
        <div className={styles.layout}>
          <div>
            <nav className="activities" aria-label="Study activities" style={{ marginBottom: 20 }}>
              {ACTIVITY_ORDER.map((a) => {
                const disabled = cards.length < ACTIVITIES[a].minCards
                return (
                  <Link
                    key={a}
                    to={`${basePath}/${a}`}
                    className="activity"
                    aria-disabled={disabled || undefined}
                    title={disabled ? `Needs at least ${ACTIVITIES[a].minCards} terms` : undefined}
                    data-testid={`activity-${a}`}
                  >
                    <span className="icon" aria-hidden>
                      {ACTIVITIES[a].icon}
                    </span>
                    {ACTIVITIES[a].label}
                  </Link>
                )
              })}
            </nav>
            <SetPreview />
            <ProgressSection />
            <TermsList />
          </div>
          <aside className={styles.side} aria-label="Set stats">
            <StatsPanel />
          </aside>
        </div>
      )}
    </div>
  )
}
