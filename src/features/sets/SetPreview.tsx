import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from '../../components/icons'
import { AudioButton, CardImage, StarButton } from '../../components/StudyButtons'
import { useAuth } from '../auth/AuthProvider'
import { Face, FlipCard } from '../flashcards/FlipCard'
import { useStudySet } from './StudySetContext'

/** Inline flashcard carousel at the top of the set page. */
export function SetPreview() {
  const { cards, meta, imageSource, toggleStar } = useStudySet()
  const { settings } = useAuth()
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [enter, setEnter] = useState<'left' | 'right' | null>(null)

  useEffect(() => {
    if (index >= cards.length) setIndex(Math.max(0, cards.length - 1))
  }, [cards.length, index])

  if (!cards.length) return null
  const card = cards[Math.min(index, cards.length - 1)]
  const go = (delta: number) => {
    const next = Math.min(cards.length - 1, Math.max(0, index + delta))
    if (next === index) return
    setEnter(delta > 0 ? 'right' : 'left')
    setFlipped(false)
    setIndex(next)
  }

  return (
    <section aria-label="Flashcard preview" className="stack">
      <FlipCard
        key={card.id}
        compact
        enter={enter}
        flipped={flipped}
        onFlip={() => setFlipped((f) => !f)}
        actions={
          <>
            <AudioButton
              text={flipped ? card.definition : card.term}
              lang={flipped ? meta.defLang : meta.termLang}
              voiceURI={settings.voices[flipped ? meta.defLang : meta.termLang]}
              size={18}
            />
            <StarButton starred={card.starred} onToggle={() => toggleStar(card.id)} size={18} />
          </>
        }
        front={<Face label="Term" text={card.term} lang={meta.termLang} />}
        back={
          <Face
            label="Definition"
            text={card.definition}
            lang={meta.defLang}
            image={<CardImage card={card} source={imageSource} alt="" />}
          />
        }
      />
      <div className="row" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn-icon" aria-label="Previous card" onClick={() => go(-1)} disabled={index === 0}>
          <ChevronLeft size={20} />
        </button>
        <span className="subtle" aria-live="polite" style={{ minWidth: 70, textAlign: 'center' }}>
          {index + 1} / {cards.length}
        </span>
        <button
          type="button"
          className="btn btn-icon"
          aria-label="Next card"
          onClick={() => go(1)}
          disabled={index >= cards.length - 1}
        >
          <ChevronRight size={20} />
        </button>
      </div>
    </section>
  )
}
