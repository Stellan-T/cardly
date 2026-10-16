import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Star } from '../../components/icons'
import { Menu } from '../../components/Menu'
import { BUCKET_LABELS, bucketOf, type Bucket } from '../../lib/progress'
import { useProgressState } from '../../data/studyStores'
import { ACTIVITIES, ACTIVITY_ORDER } from '../study/activities'
import { useStudySet } from './StudySetContext'

const BUCKETS: Bucket[] = ['notStudied', 'learning', 'mastered']

/** Not studied / Still learning / Mastered counts, with the terms in each. */
export function ProgressSection() {
  const { cards, progress, setStarred, basePath } = useStudySet()
  const state = useProgressState(progress)
  const [open, setOpen] = useState<Bucket | null>(null)

  const groups = useMemo(() => {
    const g: Record<Bucket, typeof cards> = { notStudied: [], learning: [], mastered: [] }
    for (const c of cards) g[bucketOf(state.cards[c.id])].push(c)
    return g
  }, [cards, state.cards])

  const total = cards.length || 1
  const list = open ? groups[open] : []
  const termsParam = list.map((c) => c.id).join(',')

  return (
    <section className="section" aria-labelledby="progress-title">
      <div className="section-title">
        <h2 id="progress-title">Your progress</h2>
      </div>
      <div className="stackbar" aria-hidden style={{ marginBottom: 12 }}>
        <span className="s-mastered" style={{ width: `${(groups.mastered.length / total) * 100}%` }} />
        <span className="s-learning" style={{ width: `${(groups.learning.length / total) * 100}%` }} />
      </div>
      <div className="buckets">
        {BUCKETS.map((b) => (
          <button
            key={b}
            type="button"
            className={`bucket ${b}`}
            aria-pressed={open === b}
            onClick={() => setOpen((o) => (o === b ? null : b))}
          >
            <div className="count">{groups[b].length}</div>
            <div className="label">{BUCKET_LABELS[b]}</div>
          </button>
        ))}
      </div>
      {open && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <strong>
              {BUCKET_LABELS[open]} · {list.length} {list.length === 1 ? 'term' : 'terms'}
            </strong>
            {list.length > 0 && (
              <div className="row">
                <button type="button" className="btn btn-sm" onClick={() => setStarred(list.map((c) => c.id), true)}>
                  <Star size={16} /> Star all in this group
                </button>
                <Menu
                  label="Study these with…"
                  triggerClassName="btn btn-sm btn-primary"
                  trigger={<>Study these with…</>}
                  items={ACTIVITY_ORDER.map((a) => ({
                    label: ACTIVITIES[a].label,
                    icon: ACTIVITIES[a].icon,
                    to: `${basePath}/${a}?terms=${termsParam}`,
                    disabled: list.length < ACTIVITIES[a].minCards,
                  }))}
                />
              </div>
            )}
          </div>
          {list.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No terms here yet.{' '}
              {open === 'mastered' && (
                <Link to={`${basePath}/learn`}>Start Learn to master terms.</Link>
              )}
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, columns: '2 260px' }}>
              {list.map((c) => (
                <li key={c.id} style={{ breakInside: 'avoid', marginBottom: 4 }}>
                  <strong>{c.term}</strong> <span className="muted">— {c.definition.split('\n')[0]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
