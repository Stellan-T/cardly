/** End of a Match game: the time, personal best and the set's top-10 leaderboard. */
import { useMemo } from 'react'
import { Link } from 'react-router'
import { Confetti } from '../../components/Confetti'
import { Medal, RotateCcw, Trophy } from '../../components/icons'
import { useLeaderboard } from '../../data/leaderboard'
import { formatDate, formatRelative, formatTenths, plural } from '../../lib/format'
import { mergeLeaderboard, PENALTY_MS } from '../../lib/match'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from '../sets/StudySetContext'
import { useProgress } from '../study/hooks'
import styles from './MatchPage.module.css'

export interface MatchResult {
  ms: number
  /** When the game ended (epoch ms); identifies this run in the leaderboard. */
  at: number
  misses: number
  pairs: number
  /** Saved to progress (and the shared leaderboard); the fields below are known from then on. */
  saved: boolean
  prevBest: number | null
  isRecord: boolean
}

const seconds = (ms: number) => `${formatTenths(ms)} s`

export function MatchResults({ result, shared, onPlayAgain }: { result: MatchResult; shared: boolean; onPlayAgain: () => void }) {
  const { setId, basePath } = useStudySet()
  const { uid, displayName } = useAuth()
  const { stats } = useProgress()
  const others = useLeaderboard(shared ? setId : null, shared)
  const rows = useMemo(
    () => mergeLeaderboard(stats.matchRuns, displayName, others.data, uid),
    [stats.matchRuns, displayName, others.data, uid],
  )
  const best = stats.bestMatchMs ?? result.ms
  const { isRecord, prevBest } = result

  return (
    <div className={styles.screen}>
      {isRecord && <Confetti />}
      <section className={`panel ${styles.summary}`} aria-labelledby="match-result-title">
        {isRecord && <Trophy size={32} className={styles.record} aria-hidden />}
        <h1 id="match-result-title" className={styles.heading}>
          {isRecord ? (prevBest === null ? 'Your first time is in!' : 'New personal best!') : 'Board cleared!'}
        </h1>
        <p className={styles.bigTime}>
          {formatTenths(result.ms)}
          <span className={styles.unit}> s</span>
        </p>
        <div className={styles.facts}>
          <span className="badge">{plural(result.pairs, 'pair')}</span>
          <span className={result.misses ? 'badge badge-danger' : 'badge badge-success'}>
            {result.misses
              ? `${plural(result.misses, 'miss', 'misses')} (+${formatTenths(result.misses * PENALTY_MS)} s)`
              : 'No misses'}
          </span>
        </div>
        {result.saved && (
          <p className="muted">
            {isRecord
              ? prevBest === null
                ? 'Play again to beat it.'
                : `Previous best: ${seconds(prevBest)} — ${formatTenths(prevBest - result.ms)} s faster.`
              : `Personal best: ${seconds(best)}`}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary btn-lg" onClick={onPlayAgain} autoFocus>
            <RotateCcw size={18} aria-hidden />
            Play again
          </button>
          <Link className="btn btn-lg" to={basePath}>
            Back to set
          </Link>
        </div>
      </section>

      <section className={`panel ${styles.leaderboard}`} aria-labelledby="match-board-title">
        <h2 id="match-board-title">
          <Medal size={20} aria-hidden />
          {shared ? 'Leaderboard' : 'Your best times'}
        </h2>
        {rows.length === 0 ? (
          <p className="muted">No times yet.</p>
        ) : (
          <table className={`table ${styles.lbTable}`}>
            <colgroup>
              <col className={styles.colRank} />
              <col />
              <col className={styles.colTime} />
              <col className={styles.colWhen} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Rank</span>#
                </th>
                <th scope="col">Name</th>
                <th scope="col" className={styles.lbTime}>
                  Time
                </th>
                <th scope="col" className={styles.lbWhen}>
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const current = row.mine && row.at === result.at && row.ms === result.ms
                return (
                  <tr key={row.key} className={[row.mine && styles.mine, current && styles.current].filter(Boolean).join(' ')}>
                    <td className={styles.rank}>{i + 1}</td>
                    <td>
                      <div className={styles.lbName}>
                        <span title={row.name}>{row.name}</span>
                        {current && <span className="badge badge-primary">This run</span>}
                        {row.mine && !current && <span className="sr-only">(you)</span>}
                      </div>
                    </td>
                    <td className={styles.lbTime}>{seconds(row.ms)}</td>
                    <td className={styles.lbWhen} title={formatDate(row.at)}>
                      {formatRelative(row.at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {shared ? (
          others.error && <p className="subtle">Couldn’t load other players’ times right now.</p>
        ) : (
          <p className="subtle" style={{ margin: '10px 0 0' }}>
            Only you can see these times. Share the set by link to race other people.
          </p>
        )}
      </section>
    </div>
  )
}
