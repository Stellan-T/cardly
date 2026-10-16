import { Link } from 'react-router'
import { Globe, Star } from '../../components/icons'
import { formatRelative } from '../../lib/format'
import { masteredPct } from '../../lib/progress'
import type { StudySet } from '../../types'
import { ACTIVITIES } from '../study/activities'

/** A set card for Home, Library, folders and search results. */
export function SetTile({ set }: { set: StudySet }) {
  const pct = masteredPct(set.summary, set.cardCount)
  return (
    <Link to={set.draft ? `/sets/${set.id}/edit` : `/sets/${set.id}`} className="panel panel-link set-tile">
      <h3>{set.title}</h3>
      <div className="meta">
        <span>
          {set.cardCount} {set.cardCount === 1 ? 'term' : 'terms'}
        </span>
        {set.draft && <span className="badge badge-warning">Draft</span>}
        {set.visibility === 'link' && (
          <span className="badge" title="Shared by link">
            <Globe size={11} /> Shared
          </span>
        )}
        {set.starredCount > 0 && (
          <span className="badge" title="Starred terms">
            <Star size={11} /> {set.starredCount}
          </span>
        )}
      </div>
      <span className="spacer" />
      {!set.draft && set.cardCount > 0 && (
        <div className="stack" style={{ '--gap': '4px' } as React.CSSProperties}>
          <div className="stackbar" aria-hidden style={{ height: 6 }}>
            <span className="s-mastered" style={{ width: `${pct}%` }} />
            {set.summary && (
              <span className="s-learning" style={{ width: `${(set.summary.learning / Math.max(1, set.cardCount)) * 100}%` }} />
            )}
          </div>
          <span className="subtle">
            {pct}% mastered
            {set.lastStudiedAt ? ` · ${set.lastActivity ? `${ACTIVITIES[set.lastActivity].label} ` : ''}${formatRelative(set.lastStudiedAt)}` : ''}
          </span>
        </div>
      )}
    </Link>
  )
}
