import { useProgressState } from '../../data/studyStores'
import { useTestHistory } from '../../data/tests'
import { formatDate, formatDuration, formatRelative, formatTenths } from '../../lib/format'
import { masteredPct, summarize } from '../../lib/progress'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from './StudySetContext'
import styles from './SetPage.module.css'

export function StatsPanel() {
  const { cards, progress, setId } = useStudySet()
  const { uid } = useAuth()
  const state = useProgressState(progress)
  const tests = useTestHistory(uid, setId, 8)
  const summary = summarize(
    cards.map((c) => c.id),
    state.cards,
  )
  const s = state.stats
  return (
    <>
      <section className="panel" aria-labelledby="stats-title">
        <h2 id="stats-title" style={{ fontSize: '1.05rem' }}>
          Stats
        </h2>
        <dl className={styles.stats}>
          <div>
            <dt>Mastered</dt>
            <dd>{masteredPct(summary, cards.length)}%</dd>
          </div>
          <div>
            <dt>Study time</dt>
            <dd>{formatDuration(s.studyMs)}</dd>
          </div>
          <div>
            <dt>Sessions</dt>
            <dd>{s.sessions}</dd>
          </div>
          <div>
            <dt>Last studied</dt>
            <dd>{formatRelative(s.lastStudiedAt)}</dd>
          </div>
          <div>
            <dt>Best Match</dt>
            <dd>{s.bestMatchMs ? `${formatTenths(s.bestMatchMs)}s` : '—'}</dd>
          </div>
          <div>
            <dt>Best Blocks</dt>
            <dd>{s.bestBlocks ?? '—'}</dd>
          </div>
          <div>
            <dt>Best Blast</dt>
            <dd>{s.bestBlast ?? '—'}</dd>
          </div>
        </dl>
      </section>
      <section className="panel" aria-labelledby="tests-title">
        <h2 id="tests-title" style={{ fontSize: '1.05rem' }}>
          Test history
        </h2>
        {tests.data.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            No tests taken yet.
          </p>
        ) : (
          <ul className={styles.history}>
            {tests.data.map((t) => (
              <li key={t.id}>
                <span className="muted">{formatDate(t.takenAt)}</span>
                <span>
                  <strong className={t.scorePct >= 80 ? 'diff-ok' : t.scorePct < 50 ? 'diff-bad' : ''} style={{ textDecoration: 'none', background: 'none' }}>
                    {Math.round(t.scorePct)}%
                  </strong>{' '}
                  <span className="subtle">
                    ({t.correct}/{t.total})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
