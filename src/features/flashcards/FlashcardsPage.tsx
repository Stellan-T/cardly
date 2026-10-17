import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ProgressBar, Segmented, Switch } from '../../components/controls'
import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Pause,
  Play,
  RotateCcw,
  Shuffle,
  Undo2,
  X,
} from '../../components/icons'
import { K, useShortcutHelp } from '../../components/Shortcuts'
import { useHotkeys } from '../../components/hotkeys'
import { AudioButton, CardImage, StarButton } from '../../components/StudyButtons'
import { Confetti } from '../../components/Confetti'
import { emptyProgress, type Outcome } from '../../lib/progress'
import { localDateKey } from '../../lib/format'
import {
  currentId,
  go,
  isDeckDone,
  keepReviewing,
  markCurrent,
  reconcileDeck,
  setShuffle,
  startDeck,
  type DeckState,
} from '../../lib/flashcards'
import { randomSeed } from '../../lib/random'
import { buildSrsQueue, formatInterval, LEARN_AHEAD_MS, previewIntervals, rateCard, SRS_RATINGS, type SrsRating } from '../../lib/srs'
import { stopSpeaking } from '../../lib/tts'
import type { Card, FlashcardMethod, Side, TermProgress } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from '../sets/StudySetContext'
import { AiHint } from '../study/AiInsight'
import { StarredOnlyOption } from '../study/CommonOptions'
import { useFullscreen, useModeOptions, useProgress, useSessionState, useSpeech, useStudyActivity, useStudyCards } from '../study/hooks'
import { OptionGroup, StudyLayout } from '../study/StudyLayout'
import { Face, FlipCard } from './FlipCard'
import styles from './Flashcards.module.css'

export interface FlashcardOptions {
  method: FlashcardMethod | 'auto'
  /** The side the learner answers with; the other side is shown first. */
  answerWith: 'term' | 'definition'
  shuffle: boolean
  starredOnly: boolean
  /** Speak each side automatically when it appears. */
  audio: boolean
  speed: 'slow' | 'normal' | 'fast'
}

const DEFAULTS: FlashcardOptions = {
  method: 'auto',
  answerWith: 'definition',
  shuffle: false,
  starredOnly: false,
  audio: false,
  speed: 'normal',
}

const SPEED_MS = { slow: 4500, normal: 2800, fast: 1600 }

interface SavedFlashcards {
  method: FlashcardMethod
  deck: DeckState | null
  deckKey: string
  srsNew?: { date: string; count: number }
}

const METHOD_LABELS: Record<FlashcardMethod, string> = {
  browse: 'Browse cards',
  sort: 'Basic sorting',
  srs: 'Spaced repetition',
}

/** Short stable fingerprint of the card list a deck was built from. */
function hashIds(ids: string[]): string {
  let h = 5381
  for (const id of ids) for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0
  return `${ids.length}:${(h >>> 0).toString(36)}`
}

type HistoryEntry = { cardId: string; prev: TermProgress | undefined; deck?: DeckState; newCount?: number }

export default function FlashcardsPage() {
  const { cards: allCards, session, progress, imageSource, toggleStar, basePath, status } = useStudySet()
  const { settings } = useAuth()
  const [opts, setOpts, optsLoaded] = useModeOptions<FlashcardOptions>('flashcards', DEFAULTS)
  const cards = useStudyCards(opts.starredOnly)
  const sessionState = useSessionState()
  const saved = sessionState.flashcards as SavedFlashcards | undefined
  const progressState = useProgress()
  const { say, langOf, voiceOf } = useSpeech()
  const { markStudied } = useStudyActivity('flashcards')
  const [params, setParams] = useSearchParams()

  // ?method=srs (from "Due for review" on Home) switches method once.
  useEffect(() => {
    const m = params.get('method') as FlashcardMethod | null
    if (m && optsLoaded && ['browse', 'sort', 'srs'].includes(m)) {
      setOpts({ method: m })
      params.delete('method')
      setParams(params, { replace: true })
    }
  }, [params, optsLoaded, setOpts, setParams])

  const method: FlashcardMethod =
    opts.method !== 'auto'
      ? opts.method
      : settings.defaultFlashcardMethod !== 'auto'
        ? settings.defaultFlashcardMethod
        : allCards.length >= 20
          ? 'srs'
          : 'sort'
  const [browseOverride, setBrowseOverride] = useState(false)
  const effectiveMethod: FlashcardMethod = browseOverride ? 'browse' : method

  const frontSide: Side = opts.answerWith === 'term' ? 'definition' : 'term'
  const backSide: Side = frontSide === 'term' ? 'definition' : 'term'

  const ids = useMemo(() => cards.map((c) => c.id), [cards])
  const deckKey = useMemo(() => hashIds(ids), [ids])
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  const [deck, setDeck] = useState<DeckState | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [enter, setEnter] = useState<'left' | 'right' | null>(null)
  const [playing, setPlaying] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [srsUndoTick, setSrsUndoTick] = useState(0)
  const fullscreen = useFullscreen()
  const ready = status === 'ready' && optsLoaded && !!session?.loaded

  // Start or resume the deck (Browse / Basic sorting).
  useEffect(() => {
    if (!ready || effectiveMethod === 'srs') return
    setDeck((current) => {
      // Keep the live deck unless the card list changed underneath it.
      if (current && deckMatches(current, ids)) return current
      // Resume where this set was left off (possibly on another device).
      if (!current && saved?.deck && saved.deckKey === deckKey && saved.method === effectiveMethod) {
        return reconcileDeck(saved.deck, new Set(ids))
      }
      return startDeck(ids, { shuffle: opts.shuffle, seed: randomSeed() })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, deckKey, effectiveMethod])

  // Persist position, method and piles so another device can resume.
  const srsNew = saved?.srsNew?.date === localDateKey() ? saved.srsNew : { date: localDateKey(), count: 0 }
  const persist = useCallback(
    (patch: Partial<SavedFlashcards>) => {
      session?.patch('flashcards', {
        method,
        deck,
        deckKey,
        srsNew,
        ...patch,
      } satisfies SavedFlashcards)
    },
    [session, method, deck, deckKey, srsNew],
  )
  useEffect(() => {
    if (!ready || !deck || effectiveMethod === 'srs') return
    persist({ deck, method: effectiveMethod })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck])

  // Flip resets when the card changes.
  const cardId = effectiveMethod === 'srs' ? null : deck ? currentId(deck) : undefined
  useEffect(() => {
    setFlipped(false)
  }, [cardId])

  useEffect(() => () => stopSpeaking(), [])

  const record = (id: string, outcome: Outcome, extra?: Partial<TermProgress>) => {
    markStudied()
    progress?.record(id, outcome, extra)
  }

  const flip = () => {
    setFlipped((f) => !f)
    if (effectiveMethod === 'browse') markStudied()
  }

  const move = (delta: number) => {
    if (!deck) return
    setEnter(delta > 0 ? 'right' : 'left')
    setDeck(go(deck, delta))
  }

  const sortCard = (pile: 'know' | 'learning') => {
    if (!deck) return
    const id = currentId(deck)
    if (!id) return
    setHistory((h) => [...h.slice(-49), { cardId: id, prev: progressState.cards[id], deck }])
    record(id, pile === 'know' ? 'correct' : 'incorrect')
    setEnter(pile === 'know' ? 'right' : 'left')
    setDeck(markCurrent(deck, pile))
  }

  const undo = () => {
    const last = history[history.length - 1]
    if (!last) return
    setHistory((h) => h.slice(0, -1))
    progress?.update(last.cardId, () => last.prev ?? emptyProgress(Date.now()))
    if (last.deck) setDeck(last.deck)
    if (last.newCount !== undefined) persist({ srsNew: { date: localDateKey(), count: last.newCount } })
    if (effectiveMethod === 'srs') setSrsUndoTick((t) => t + 1)
  }

  const restart = (shuffleIt = opts.shuffle) => {
    setHistory([])
    setDeck(startDeck(ids, { shuffle: shuffleIt, seed: randomSeed() }))
    if (shuffleIt !== opts.shuffle) setOpts({ shuffle: shuffleIt })
  }

  const toggleShuffle = () => {
    const on = !opts.shuffle
    setOpts({ shuffle: on })
    if (deck) setDeck(setShuffle(deck, on, ids, randomSeed()))
  }

  // Autoplay (Browse): show the front, flip, then move on.
  const current: Card | undefined = cardId ? byId.get(cardId) : undefined
  useEffect(() => {
    if (!playing || effectiveMethod !== 'browse' || !deck) return
    if (isDeckDone(deck)) {
      setPlaying(false)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const advance = () => {
      if (cancelled) return
      if (!flipped) setFlipped(true)
      else {
        setEnter('right')
        setDeck((d) => (d ? go(d, 1) : d))
      }
    }
    const wait = () => {
      timer = setTimeout(advance, SPEED_MS[opts.speed])
    }
    if (opts.audio && current) say(flipped ? sideOf(current, backSide) : sideOf(current, frontSide), flipped ? backSide : frontSide, () => {
      if (!cancelled) timer = setTimeout(advance, 600)
    })
    else wait()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, deck?.index, flipped, effectiveMethod])

  // Audio auto-play outside autoplay.
  useEffect(() => {
    if (!opts.audio || playing || !current) return
    say(sideOf(current, flipped ? backSide : frontSide), flipped ? backSide : frontSide)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, flipped, opts.audio])

  const speakCurrent = () => {
    if (current) say(sideOf(current, flipped ? backSide : frontSide), flipped ? backSide : frontSide)
  }

  useHotkeys(
    effectiveMethod === 'srs'
      ? {}
      : {
          space: flip,
          arrowleft: () => (effectiveMethod === 'sort' ? sortCard('learning') : move(-1)),
          arrowright: () => (effectiveMethod === 'sort' ? sortCard('know') : move(1)),
          s: () => current && toggleStar(current.id),
          a: speakCurrent,
          'mod+z': undo,
          f: fullscreen.toggle,
        },
    { force: ['space'] },
  )
  useShortcutHelp([
    {
      title: 'Flashcards',
      items: [
        [<K key="sp">Space</K>, 'Flip the card'],
        [
          <span key="lr">
            <K>←</K> <K>→</K>
          </span>,
          'Previous / next (Browse) · Still learning / Know (Sorting)',
        ],
        [
          <span key="14">
            <K>1</K>–<K>4</K>
          </span>,
          'Repeat / Hard / Okay / Easy (Spaced repetition)',
        ],
        [<K key="s">S</K>, 'Star the card'],
        [<K key="a">A</K>, 'Play audio'],
        [
          <span key="z">
            <K>Ctrl/⌘</K> + <K>Z</K>
          </span>,
          'Undo last mark',
        ],
        [<K key="f">F</K>, 'Full screen'],
      ],
    },
  ])

  const options = (
    <>
      <OptionGroup title="Study method">
        <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
          {(['browse', 'sort', 'srs'] as FlashcardMethod[]).map((m) => (
            <label key={m} className="check">
              <input
                type="radio"
                name="fc-method"
                checked={method === m}
                onChange={() => {
                  setBrowseOverride(false)
                  setOpts({ method: m })
                  setHistory([])
                }}
              />
              <span>
                <strong>{METHOD_LABELS[m]}</strong>
                <span className="hint" style={{ display: 'block' }}>
                  {m === 'browse'
                    ? 'Flip through the cards, no tracking.'
                    : m === 'sort'
                      ? 'Sort each card into Still learning or Know.'
                      : 'Rate how well you remembered; cards come back right before you’d forget.'}
                </span>
              </span>
            </label>
          ))}
          <span className="hint">
            Default: {allCards.length >= 20 ? 'Spaced repetition for large sets (20+ terms)' : 'Basic sorting for smaller sets'}.
          </span>
        </div>
      </OptionGroup>
      <OptionGroup title="Cards">
        <div className="option-row">
          <span>Answer with</span>
          <Segmented
            label="Answer with"
            value={opts.answerWith}
            onChange={(v) => setOpts({ answerWith: v })}
            options={[
              { value: 'term', label: 'Term' },
              { value: 'definition', label: 'Definition' },
            ]}
          />
        </div>
        <span className="hint">The other side is shown first.</span>
        <Switch label="Shuffle" checked={opts.shuffle} onChange={() => toggleShuffle()} />
        <StarredOnlyOption value={opts.starredOnly} onChange={(v) => setOpts({ starredOnly: v })} />
      </OptionGroup>
      <OptionGroup title="Audio & autoplay">
        <Switch label="Play audio automatically" checked={opts.audio} onChange={(v) => setOpts({ audio: v })} />
        <div className="option-row">
          <span>Autoplay speed</span>
          <Segmented
            label="Autoplay speed"
            value={opts.speed}
            onChange={(v) => setOpts({ speed: v })}
            options={[
              { value: 'slow', label: 'Slow' },
              { value: 'normal', label: 'Normal' },
              { value: 'fast', label: 'Fast' },
            ]}
          />
        </div>
      </OptionGroup>
      <OptionGroup title="Progress">
        <button type="button" className="btn" onClick={() => restart()}>
          <RotateCcw size={16} /> Restart flashcards
        </button>
      </OptionGroup>
    </>
  )

  const total = deck ? deck.order.length : 0
  const position = deck ? Math.min(deck.index + 1, total) : 0
  const headerExtra =
    effectiveMethod !== 'srs' && deck && total > 0 ? (
      <span className="subtle nowrap" aria-live="polite">
        {position} / {total}
      </span>
    ) : null

  const faceFor = (card: Card, side: Side) => (
    <Face
      label={side === 'term' ? 'Term' : 'Definition'}
      text={sideOf(card, side)}
      lang={langOf(side)}
      image={side === 'definition' ? <CardImage card={card} source={imageSource} alt="" /> : undefined}
    />
  )

  const cardActions = (card: Card) => (
    <>
      <AudioButton
        shortcut="A"
        text={sideOf(card, flipped ? backSide : frontSide)}
        lang={langOf(flipped ? backSide : frontSide)}
        voiceURI={voiceOf(flipped ? backSide : frontSide)}
      />
      <StarButton starred={card.starred} onToggle={() => toggleStar(card.id)} />
    </>
  )

  let body: React.ReactNode = null
  if (!ready) body = null
  else if (effectiveMethod === 'srs')
    body = (
      <SrsView
        key={`${deckKey}-${srsUndoTick}`}
        cards={cards}
        progressCards={progressState.cards}
        newAllowance={Math.max(0, settings.newCardsPerDay - srsNew.count)}
        newToday={srsNew.count}
        frontSide={frontSide}
        backSide={backSide}
        faceFor={faceFor}
        cardActions={cardActions}
        flipped={flipped}
        setFlipped={setFlipped}
        onRate={(card, rating, wasNew) => {
          const prev = progressState.cards[card.id]
          const now = Date.now()
          const srs = rateCard(prev?.srs, rating, now)
          const outcome: Outcome = rating === 1 ? 'incorrect' : rating === 2 ? 'hard' : 'correct'
          setHistory((h) => [...h.slice(-49), { cardId: card.id, prev, newCount: srsNew.count }])
          record(card.id, outcome, { srs })
          if (wasNew) persist({ srsNew: { date: localDateKey(), count: srsNew.count + 1 } })
        }}
        onUndo={history.length ? undo : undefined}
        onBrowse={() => {
          setBrowseOverride(true)
          setDeck(startDeck(ids, { shuffle: opts.shuffle, seed: randomSeed() }))
        }}
        basePath={basePath}
        speak={speakCurrent}
        toggleStar={toggleStar}
        audio={opts.audio}
        say={say}
      />
    )
  else if (deck && isDeckDone(deck)) {
    body = (
      <RoundEnd
        method={effectiveMethod}
        deck={deck}
        basePath={basePath}
        onRestart={() => restart()}
        onShuffleRestart={() => restart(true)}
        onKeepReviewing={() => {
          setHistory([])
          setDeck(keepReviewing(deck, randomSeed()))
        }}
        onUndo={history.length ? undo : undefined}
      />
    )
  } else if (deck && current) {
    body = (
      <div className={styles.stage}>
        {effectiveMethod === 'sort' && (
          <div className={styles.piles} aria-live="polite">
            <span className={`${styles.pile} ${styles.pileLearning}`}>
              <strong>{deck.learning.length}</strong> Still learning
            </span>
            <ProgressBar value={deck.index} max={total} label="Round progress" />
            <span className={`${styles.pile} ${styles.pileKnow}`}>
              Know <strong>{deck.know.length}</strong>
            </span>
          </div>
        )}
        {effectiveMethod === 'browse' && <ProgressBar value={deck.index + 1} max={total} label="Progress" />}
        <FlipCard
          key={current.id}
          enter={enter}
          flipped={flipped}
          onFlip={flip}
          actions={cardActions(current)}
          front={faceFor(current, frontSide)}
          back={faceFor(current, backSide)}
        />
        <AiHint
          key={`hint-${current.id}`}
          question={{ cardId: current.id, promptSide: frontSide, prompt: sideOf(current, frontSide), answerSide: backSide, answer: sideOf(current, backSide) }}
          hideButton={flipped}
          centered
        />
        {effectiveMethod === 'sort' ? (
          <div className={styles.sortButtons}>
            <button type="button" className={`btn btn-lg ${styles.learningBtn}`} onClick={() => sortCard('learning')} data-testid="fc-learning">
              <X size={20} /> Still learning
            </button>
            <button type="button" className={`btn btn-lg ${styles.knowBtn}`} onClick={() => sortCard('know')} data-testid="fc-know">
              <Check size={20} /> Know
            </button>
          </div>
        ) : (
          <div className={styles.nav}>
            <button type="button" className="btn btn-icon btn-lg" aria-label="Previous card" onClick={() => move(-1)} disabled={deck.index === 0}>
              <ChevronLeft size={24} />
            </button>
            <button type="button" className="btn btn-icon btn-lg" aria-label="Next card" onClick={() => move(1)} data-testid="fc-next">
              <ChevronRight size={24} />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <StudyLayout mode="flashcards" options={options} minCards={1} availableCards={cards.length} headerExtra={headerExtra}>
      <div className={styles.toolbar}>
        <span className="badge badge-primary">{browseOverride ? `${METHOD_LABELS.browse} (caught up)` : METHOD_LABELS[method]}</span>
        <span className="spacer" />
        {effectiveMethod !== 'srs' && (
          <>
            <button
              type="button"
              className="btn btn-icon btn-ghost"
              aria-pressed={opts.shuffle}
              aria-label="Shuffle"
              title="Shuffle"
              onClick={toggleShuffle}
            >
              <Shuffle size={20} />
            </button>
            <button
              type="button"
              className="btn btn-icon btn-ghost"
              aria-pressed={playing}
              aria-label={playing ? 'Pause autoplay' : 'Autoplay'}
              title={effectiveMethod === 'browse' ? (playing ? 'Pause' : 'Autoplay') : 'Autoplay is available in Browse cards'}
              disabled={effectiveMethod !== 'browse'}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
          </>
        )}
        {effectiveMethod !== 'browse' && (
          <button type="button" className="btn btn-icon btn-ghost" aria-label="Undo" title="Undo (Ctrl/⌘+Z)" disabled={!history.length} onClick={undo}>
            <Undo2 size={20} />
          </button>
        )}
      </div>
      {body}
    </StudyLayout>
  )
}

function deckMatches(deck: DeckState, ids: string[]): boolean {
  const all = new Set(deck.order)
  if (deck.round > 1) return deck.order.every((id) => ids.includes(id))
  return all.size === ids.length && ids.every((id) => all.has(id))
}

const sideOf = (card: Card, side: Side) => (side === 'term' ? card.term : card.definition)

function RoundEnd({
  method,
  deck,
  basePath,
  onRestart,
  onShuffleRestart,
  onKeepReviewing,
  onUndo,
}: {
  method: FlashcardMethod
  deck: DeckState
  basePath: string
  onRestart: () => void
  onShuffleRestart: () => void
  onKeepReviewing: () => void
  onUndo?: () => void
}) {
  const allKnown = method === 'sort' && deck.learning.length === 0 && deck.know.length > 0
  return (
    <div className={`panel ${styles.end}`}>
      {allKnown && <Confetti />}
      {method === 'browse' ? (
        <>
          <h2>You went through all {deck.order.length} cards</h2>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary btn-lg" onClick={onRestart}>
              <RotateCcw size={18} /> Restart
            </button>
            <button type="button" className="btn btn-lg" onClick={onShuffleRestart}>
              <Shuffle size={18} /> Shuffle and restart
            </button>
          </div>
        </>
      ) : allKnown ? (
        <>
          <h2>You know all of them! 🎉</h2>
          <p className="muted">Lock it in with questions, or see how you’d do on a test.</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link className="btn btn-primary btn-lg" to={`${basePath}/learn`}>
              <Brain size={18} /> Study with Learn
            </Link>
            <Link className="btn btn-lg" to={`${basePath}/test`}>
              <ClipboardCheck size={18} /> Take a test
            </Link>
          </div>
          <button type="button" className="link-btn" onClick={onRestart} style={{ marginTop: 12 }}>
            Restart flashcards
          </button>
        </>
      ) : (
        <>
          <h2>Round {deck.round} done</h2>
          <div className={styles.summary}>
            <div className={styles.summaryLearning}>
              <strong>{deck.learning.length}</strong>
              <span>Still learning</span>
            </div>
            <div className={styles.summaryKnow}>
              <strong>{deck.know.length}</strong>
              <span>Know</span>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn-primary btn-lg" onClick={onKeepReviewing} data-testid="fc-keep-reviewing">
              Keep reviewing {deck.learning.length} Still-learning {deck.learning.length === 1 ? 'card' : 'cards'}
            </button>
            <button type="button" className="btn btn-lg" onClick={onRestart}>
              <RotateCcw size={18} /> Restart flashcards
            </button>
          </div>
        </>
      )}
      {onUndo && method !== 'browse' && (
        <button type="button" className="link-btn small" onClick={onUndo} style={{ marginTop: 12 }}>
          Undo last card
        </button>
      )}
    </div>
  )
}

interface SrsViewProps {
  cards: Card[]
  progressCards: Record<string, TermProgress>
  newAllowance: number
  newToday: number
  frontSide: Side
  backSide: Side
  faceFor: (card: Card, side: Side) => React.ReactNode
  cardActions: (card: Card) => React.ReactNode
  flipped: boolean
  setFlipped: (v: boolean | ((f: boolean) => boolean)) => void
  onRate: (card: Card, rating: SrsRating, wasNew: boolean) => void
  onUndo?: () => void
  onBrowse: () => void
  basePath: string
  speak: () => void
  toggleStar: (id: string) => void
  audio: boolean
  say: (text: string, side: Side) => void
}

/** Spaced repetition: rate recall 1–4; cards come back when due. */
function SrsView({
  cards,
  progressCards,
  newAllowance,
  newToday,
  frontSide,
  backSide,
  faceFor,
  cardActions,
  flipped,
  setFlipped,
  onRate,
  onUndo,
  onBrowse,
  basePath,
  speak,
  toggleStar,
  audio,
  say,
}: SrsViewProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [])

  const ids = useMemo(() => cards.map((c) => c.id), [cards])
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const queue = useMemo(() => buildSrsQueue(ids, progressCards, now, newAllowance), [ids, progressCards, now, newAllowance])

  // Pick the next card: due first, then new cards, then learning cards due soon ("learn ahead").
  const [currentId, setCurrentId] = useState<string | null>(null)
  useEffect(() => {
    if (currentId && (queue.due.includes(currentId) || queue.fresh.includes(currentId))) return
    let next = queue.due[0] ?? queue.fresh[0] ?? null
    if (!next) {
      const soon = ids
        .map((id) => ({ id, s: progressCards[id]?.srs }))
        .filter((x) => x.s && (x.s.state === 1 || x.s.state === 3) && x.s.due <= now + LEARN_AHEAD_MS)
        .sort((a, b) => a.s!.due - b.s!.due)[0]
      next = soon?.id ?? null
    }
    setCurrentId(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, now])

  const card = currentId ? byId.get(currentId) : undefined
  const isNew = !!card && (!progressCards[card.id]?.srs || progressCards[card.id]?.srs?.state === 0)
  const intervals = useMemo(() => (card ? previewIntervals(progressCards[card.id]?.srs, Date.now()) : null), [card, progressCards])

  useEffect(() => {
    setFlipped(false)
  }, [currentId, setFlipped])
  useEffect(() => {
    if (audio && card) say(flipped ? sideOf(card, backSide) : sideOf(card, frontSide), flipped ? backSide : frontSide)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, flipped, audio])

  const rate = (rating: SrsRating) => {
    if (!card) return
    if (!flipped) {
      setFlipped(true)
      return
    }
    onRate(card, rating, isNew)
    setCurrentId(null)
    setNow(Date.now())
  }

  useHotkeys(
    {
      space: () => setFlipped((f) => !f),
      '1': () => rate(1),
      '2': () => rate(2),
      '3': () => rate(3),
      '4': () => rate(4),
      s: () => card && toggleStar(card.id),
      a: speak,
      'mod+z': () => onUndo?.(),
    },
    { force: ['space'] },
  )

  if (!card) {
    const nextIn = queue.nextDueAt ? formatInterval(queue.nextDueAt - now) : null
    return (
      <div className={`panel ${styles.end}`}>
        <h2>All caught up!</h2>
        <p className="muted">
          {nextIn ? `Next review in ${nextIn}.` : 'No reviews scheduled.'}{' '}
          {newAllowance === 0 && newToday > 0 ? `You’ve learned ${newToday} new cards today (daily limit reached).` : ''}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary btn-lg" onClick={onBrowse}>
            Continue in Browse mode
          </button>
          <Link className="btn btn-lg" to={`${basePath}/learn`}>
            <Brain size={18} /> Learn
          </Link>
          <Link className="btn btn-lg" to={`${basePath}/test`}>
            <ClipboardCheck size={18} /> Test
          </Link>
        </div>
        {onUndo && (
          <button type="button" className="link-btn small" onClick={onUndo} style={{ marginTop: 12 }}>
            Undo last rating
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={styles.stage}>
      <div className={styles.srsCounts} aria-live="polite">
        <span className="badge badge-warning">Due {queue.due.length}</span>
        <span className="badge badge-primary">New {queue.fresh.length}</span>
        {isNew && <span className="badge badge-accent">New card</span>}
      </div>
      <FlipCard
        key={card.id}
        flipped={flipped}
        onFlip={() => setFlipped((f) => !f)}
        actions={cardActions(card)}
        front={faceFor(card, frontSide)}
        back={faceFor(card, backSide)}
      />
      <AiHint
        key={`hint-${card.id}`}
        question={{ cardId: card.id, promptSide: frontSide, prompt: sideOf(card, frontSide), answerSide: backSide, answer: sideOf(card, backSide) }}
        hideButton={flipped}
        centered
      />
      {flipped && intervals ? (
        <div className={styles.ratings} role="group" aria-label="How well did you remember?">
          {SRS_RATINGS.map((r) => (
            <button key={r.rating} type="button" className={`btn ${styles.rating} ${styles[`r${r.rating}`]}`} onClick={() => rate(r.rating)}>
              <span>{r.label}</span>
              <span className={styles.interval}>{formatInterval(intervals[r.rating])}</span>
              <kbd>{r.key}</kbd>
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.nav}>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => setFlipped(true)}>
            Show answer
          </button>
        </div>
      )}
    </div>
  )
}
