import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PageLoading } from '../../components/controls'
import { CalendarCheck, FileText, Flame, Plus, Sparkles, Trophy } from '../../components/icons'
import { toast } from '../../components/toast'
import { createSet } from '../../data/sets'
import { isStudyable, useMySets } from '../../data/setsHooks'
import { displayStreak } from '../../data/user'
import { endOfToday } from '../../lib/format'
import { parseImport } from '../../lib/parseImport'
import { countDueBy } from '../../lib/srs'
import { useAuth } from '../auth/AuthProvider'
import { SAMPLES } from '../import/samples'
import { ACTIVITIES } from '../study/activities'
import { SetTile } from '../library/SetTile'
import styles from './HomePage.module.css'

export default function HomePage() {
  const { uid, displayName, profile } = useAuth()
  const sets = useMySets(uid)
  const navigate = useNavigate()
  const [creatingSample, setCreatingSample] = useState(false)

  const studyable = useMemo(() => sets.data.filter(isStudyable), [sets.data])
  const recent = useMemo(
    () =>
      [...studyable]
        .filter((s) => s.lastStudiedAt)
        .sort((a, b) => (b.lastStudiedAt ?? 0) - (a.lastStudiedAt ?? 0))
        .slice(0, 6),
    [studyable],
  )
  const due = useMemo(() => {
    const until = endOfToday()
    return studyable
      .map((s) => ({ set: s, count: countDueBy(s.srsDue, until) }))
      .filter((d) => d.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [studyable])
  const totalDue = due.reduce((n, d) => n + d.count, 0)
  const streak = displayStreak(profile.streak)

  const trySample = (id: string) => {
    const sample = SAMPLES.find((s) => s.id === id)
    if (!sample || !uid) return
    setCreatingSample(true)
    const cards = parseImport(sample.text).cards.map((c) => ({ term: c.term, definition: c.definition }))
    const setId = createSet(uid, displayName, { title: sample.title, termLang: sample.termLang, defLang: sample.defLang }, cards)
    toast(`Added “${sample.title}” to your library`, { kind: 'success' })
    navigate(`/sets/${setId}`)
  }

  if (sets.loading) return <PageLoading />

  const firstName = displayName.split(' ')[0]

  return (
    <div className="container page">
      <div className={styles.hello}>
        <h1>{studyable.length ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`}</h1>
        <div className={styles.streak} title={`Longest streak: ${profile.streak.longest} days`}>
          <Flame size={22} />
          <div>
            <strong>
              {streak} day{streak === 1 ? '' : 's'}
            </strong>
            <span className="subtle">
              <Trophy size={12} /> best {profile.streak.longest}
            </span>
          </div>
        </div>
      </div>

      {studyable.length === 0 && sets.data.length === 0 ? (
        <section className={styles.onboarding}>
          <div className="panel">
            <Sparkles size={28} color="var(--primary)" />
            <h2>Make your first set</h2>
            <p className="muted">Paste your notes — lines like “Photosynthesis: how plants make glucose” — and get flashcards instantly.</p>
            <div className="row">
              <Link className="btn btn-primary btn-lg" to="/import" data-testid="cta-import">
                <FileText size={20} /> Import from notes
              </Link>
              <Link className="btn btn-lg" to="/create">
                <Plus size={20} /> Create manually
              </Link>
            </div>
          </div>
          <div className="panel">
            <h2 style={{ fontSize: '1.1rem' }}>Or try a sample</h2>
            <div className="stack">
              {SAMPLES.map((s) => (
                <button key={s.id} type="button" className="btn btn-block" style={{ justifyContent: 'space-between' }} disabled={creatingSample} onClick={() => trySample(s.id)}>
                  <span className="truncate">{s.title}</span>
                  <span className="subtle hide-mobile">{s.description}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <>
          {due.length > 0 && (
            <section className="section" aria-labelledby="due-title">
              <div className="section-title">
                <CalendarCheck size={22} color="var(--primary)" />
                <h2 id="due-title">Due for review today</h2>
                <span className="badge badge-primary">{totalDue} cards</span>
              </div>
              <div className={styles.dueList}>
                {due.map(({ set, count }) => (
                  <Link key={set.id} to={`/sets/${set.id}/flashcards?method=srs`} className="panel panel-link row" style={{ justifyContent: 'space-between' }}>
                    <span className="truncate" style={{ fontWeight: 600 }}>
                      {set.title}
                    </span>
                    <span className="badge badge-primary">{count} due</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="section" aria-labelledby="recent-title">
            <div className="section-title">
              <h2 id="recent-title">Continue where you left off</h2>
            </div>
            {recent.length === 0 ? (
              <p className="muted">Sets you study will show up here.</p>
            ) : (
              <div className="grid-cards">
                {recent.map((s) => (
                  <div key={s.id} className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
                    <SetTile set={s} />
                    {s.lastActivity && (
                      <Link className="btn btn-sm btn-soft" to={`/sets/${s.id}/${s.lastActivity}`}>
                        {ACTIVITIES[s.lastActivity].icon} Resume {ACTIVITIES[s.lastActivity].label}
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="section" aria-labelledby="all-title">
            <div className="section-title">
              <h2 id="all-title">Your sets</h2>
              <span className="spacer" />
              <Link to="/library" className="btn btn-sm btn-ghost">
                View all
              </Link>
            </div>
            <div className="grid-cards">
              {sets.data.slice(0, 6).map((s) => (
                <SetTile key={s.id} set={s} />
              ))}
              <Link to="/import" className="panel panel-link set-tile" style={{ justifyContent: 'center', alignItems: 'center', borderStyle: 'dashed' }}>
                <FileText size={26} color="var(--primary)" />
                <strong>Import from notes</strong>
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
