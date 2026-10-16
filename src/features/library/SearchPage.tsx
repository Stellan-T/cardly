import { getDocsFromCache, getDocs } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Search } from '../../components/icons'
import { toCard } from '../../data/mappers'
import { cardsCol } from '../../data/paths'
import { useMySets } from '../../data/setsHooks'
import type { Card } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { SetTile } from './SetTile'

/** Searches the user's own sets: titles, descriptions and every term/definition. */
export default function SearchPage() {
  const { uid } = useAuth()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [input, setInput] = useState(q)
  const sets = useMySets(uid)
  const [cardsBySet, setCardsBySet] = useState<Record<string, Card[]>>({})
  const [loadingCards, setLoadingCards] = useState(false)

  useEffect(() => {
    setInput(q)
  }, [q])

  // Load cards for term search (local cache first, then the server).
  useEffect(() => {
    if (!uid || !q.trim() || sets.loading) return
    let cancelled = false
    const missing = sets.data.filter((s) => !cardsBySet[s.id] && s.cardCount > 0)
    if (!missing.length) return
    setLoadingCards(true)
    ;(async () => {
      const found: Record<string, Card[]> = {}
      for (const s of missing) {
        try {
          let snap = await getDocsFromCache(cardsCol(uid, s.id))
          if (snap.empty) snap = await getDocs(cardsCol(uid, s.id))
          found[s.id] = snap.docs.map((d) => toCard(d.data(), d.id))
        } catch {
          found[s.id] = []
        }
        if (cancelled) return
      }
      setCardsBySet((prev) => ({ ...prev, ...found }))
      setLoadingCards(false)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, q, sets.loading, sets.data])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    return sets.data
      .map((s) => {
        const titleHit = s.title.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle)
        const terms = (cardsBySet[s.id] ?? []).filter(
          (c) => c.term.toLowerCase().includes(needle) || c.definition.toLowerCase().includes(needle),
        )
        return { set: s, titleHit, terms }
      })
      .filter((r) => r.titleHit || r.terms.length)
      .sort((a, b) => Number(b.titleHit) - Number(a.titleHit) || b.terms.length - a.terms.length)
  }, [q, sets.data, cardsBySet])

  return (
    <div className="container page">
      <h1>Search your sets</h1>
      <form
        role="search"
        className="row-nowrap"
        style={{ maxWidth: 560, marginBottom: 20 }}
        onSubmit={(e) => {
          e.preventDefault()
          setParams(input.trim() ? { q: input.trim() } : {})
        }}
      >
        <input
          className="input input-lg"
          type="search"
          autoFocus
          placeholder="Titles, terms or definitions"
          aria-label="Search your sets"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-lg" aria-label="Search">
          <Search size={20} />
        </button>
      </form>
      {q && (
        <p className="subtle" aria-live="polite">
          {results.length} {results.length === 1 ? 'set matches' : 'sets match'} “{q}”{loadingCards ? ' (searching terms…)' : ''}
        </p>
      )}
      <div className="stack" style={{ '--gap': '14px' } as React.CSSProperties}>
        {results.map(({ set, terms }) => (
          <div key={set.id} className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
            <SetTile set={set} />
            {terms.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
                {terms.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <Link to={`/sets/${set.id}`}>
                      <strong>{c.term}</strong>
                    </Link>{' '}
                    <span className="muted">— {c.definition.split('\n')[0].slice(0, 120)}</span>
                  </li>
                ))}
                {terms.length > 5 && <li className="muted">and {terms.length - 5} more</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
