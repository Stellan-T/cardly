import { useId, useState, type RefObject } from 'react'
import { Check, RefreshCw, X } from '../../components/icons'
import { AudioButton, CardImage } from '../../components/StudyButtons'
import type { ImageSource } from '../../data/images'
import { GRADE_REASON_TEXT, type GradeReason } from '../../lib/grade'
import { otherSide, sideText } from '../../lib/questions'
import type { Side } from '../../types'
import { useSpeech } from '../study/hooks'
import { exactish, type BlocksQuestion } from './questions'
import styles from './BlocksPage.module.css'

export interface Answered {
  correct: boolean
  /** Multiple choice: index picked. */
  choice?: number
  /** True/false: the button picked. */
  tf?: boolean
  /** Written: what was typed and how it was graded. */
  text?: string
  reason?: GradeReason
}

const SIDE_NAME: Record<Side, string> = { term: 'term', definition: 'definition' }

interface Props {
  question: BlocksQuestion
  answered: Answered | null
  imageSource: ImageSource
  panelRef: RefObject<HTMLElement | null>
  inputRef: RefObject<HTMLInputElement | null>
  onChoice: (index: number) => void
  onTrueFalse: (value: boolean) => void
  onWritten: (text: string) => void
  onRefresh: () => void
  onNext: () => void
}

/** The question between trays. Remount it (key) for every new question. */
export function QuestionPanel({ question: q, answered, imageSource, panelRef, inputRef, onChoice, onTrueFalse, onWritten, onRefresh, onNext }: Props) {
  const { langOf, voiceOf } = useSpeech()
  const [text, setText] = useState('')
  const headingId = useId()
  const inputId = useId()
  const promptSide = otherSide(q.answerSide)
  const promptLang = langOf(promptSide)
  const answerLang = langOf(q.answerSide)
  const langAttr = (l: string) => (l && l !== 'und' ? l : undefined)
  const sideName = SIDE_NAME[q.answerSide]
  const correctText = sideText(q.card, q.answerSide)

  let body
  if (q.kind === 'mc') {
    body = (
      <div className={styles.choices} role="group" aria-label={`Choose the ${sideName}`}>
        {q.choices.map((c, i) => {
          const state = !answered ? '' : i === q.correctIndex ? 'is-correct' : i === answered.choice ? 'is-incorrect' : ''
          return (
            <button
              key={c.cardId}
              type="button"
              className={`btn ${styles.choice} ${state}`}
              aria-disabled={!!answered}
              onClick={() => !answered && onChoice(i)}
              lang={langAttr(answerLang)}
            >
              <kbd className="hide-mobile" aria-hidden>
                {i + 1}
              </kbd>
              <span>{c.text}</span>
            </button>
          )
        })}
      </div>
    )
  } else if (q.kind === 'tf') {
    const state = (v: boolean) => (!answered ? '' : v === q.isTrue ? 'is-correct' : v === answered.tf ? 'is-incorrect' : '')
    body = (
      <>
        <div className={styles.tfShown}>
          <span className="subtle">Is this the matching {sideName}?</span>
          <p className={styles.tfText} lang={langAttr(answerLang)}>
            {q.shown.text}
          </p>
        </div>
        <div className={styles.tfButtons} role="group" aria-label="True or false">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              type="button"
              className={`btn btn-lg ${styles.choice} ${state(v)}`}
              aria-disabled={!!answered}
              onClick={() => !answered && onTrueFalse(v)}
            >
              {v ? <Check size={18} /> : <X size={18} />}
              <span>{v ? 'True' : 'False'}</span>
              <kbd className="hide-mobile" aria-hidden>
                {v ? 'T' : 'F'}
              </kbd>
            </button>
          ))}
        </div>
      </>
    )
  } else {
    body = (
      <form
        className="stack"
        style={{ '--gap': '8px' } as React.CSSProperties}
        onSubmit={(e) => {
          e.preventDefault()
          if (!answered) onWritten(text)
        }}
      >
        <label htmlFor={inputId} className="label">
          Type the {sideName}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className={`input input-lg ${answered ? (answered.correct ? 'is-correct' : 'is-incorrect') : ''}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!!answered}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          lang={langAttr(answerLang)}
          enterKeyHint="done"
        />
        {!answered && (
          <div className="row">
            <button type="submit" className="btn btn-primary">
              Check
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onWritten('')}>
              Don’t know
            </button>
          </div>
        )}
      </form>
    )
  }

  return (
    <section ref={panelRef} tabIndex={-1} className={`panel ${styles.question}`} aria-labelledby={headingId}>
      <div className={styles.qHead}>
        <h2 id={headingId} className={styles.qTitle}>
          Answer to earn 3 new pieces
        </h2>
        <AudioButton
          text={q.prompt}
          lang={promptLang}
          voiceURI={voiceOf(promptSide)}
          className="btn btn-ghost btn-icon btn-sm"
          size={18}
          label={`Play the ${SIDE_NAME[promptSide]}`}
        />
      </div>
      <CardImage card={q.card} source={imageSource} className={`card-image ${styles.qImage}`} />
      <p className={styles.prompt} lang={langAttr(promptLang)}>
        {q.prompt}
      </p>
      {body}
      {answered?.correct && (
        <div className="alert alert-success">
          <Check size={18} aria-hidden />
          <div>
            <strong>{exactish(answered.reason) ? 'Correct!' : `${GRADE_REASON_TEXT[answered.reason!]}.`}</strong> Here come 3
            new pieces.
            {!exactish(answered.reason) && (
              <div>
                Answer: <span lang={langAttr(answerLang)}>{correctText}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {answered && !answered.correct && (
        <>
          <div className="alert alert-danger">
            <X size={18} aria-hidden />
            <div>
              {answered.reason === 'empty' ? 'No problem.' : 'Not quite.'} The {sideName} is{' '}
              <strong lang={langAttr(answerLang)}>{correctText}</strong>.
              {q.kind === 'written' && answered.text?.trim() && (
                <div>
                  You wrote: <span lang={langAttr(answerLang)}>{answered.text}</span>
                </div>
              )}
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={onNext} autoFocus>
              Next question
            </button>
          </div>
        </>
      )}
      {!answered && (
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRefresh} title="Refresh question (R)">
            <RefreshCw size={16} aria-hidden /> Refresh question
          </button>
        </div>
      )}
    </section>
  )
}
