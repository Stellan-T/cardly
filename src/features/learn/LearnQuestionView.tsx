import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useHotkeys } from '../../components/hotkeys'
import { Check, Volume2, X } from '../../components/icons'
import { AudioButton, CardImage, StarButton } from '../../components/StudyButtons'
import { grade, GRADE_REASON_TEXT, letterDiff, type GradeResult } from '../../lib/grade'
import type { LearnQuestion } from '../../lib/learn'
import { cardForAnswer, meaningLabel, otherCard, otherSide, sideText } from '../../lib/questions'
import { ttsSupported } from '../../lib/tts'
import type { Card, GradingLevel, Side } from '../../types'
import type { ImageSource } from '../../data/images'
import styles from './Learn.module.css'

export interface Verdict {
  correct: boolean
  firstTry: boolean
}

interface Props {
  question: LearnQuestion
  card: Card
  /** Every card in the set: what a wrong answer means is looked up here. */
  pool: readonly Card[]
  grading: { level: GradingLevel; requireOne: boolean }
  retype: boolean
  imageSource: ImageSource
  langOf: (side: Side) => string
  voiceOf: (side: Side) => string | undefined
  say: (text: string, side: Side, onEnd?: () => void) => void
  autoAudio: boolean
  onToggleStar: () => void
  /** Called when the answer is final (after Continue on a wrong answer). */
  onDone: (v: Verdict) => void
  /** Immediate feedback hook (sound). */
  onFeedback: (correct: boolean) => void
}

type Feedback =
  | { kind: 'correct'; text?: string }
  | { kind: 'wrong'; response?: string; written: boolean; result?: GradeResult }

const AUTO_ADVANCE_MS = 900

/** Renders one Learn question of any type and its feedback. */
export function LearnQuestionView({
  question: q,
  card,
  pool,
  grading,
  retype,
  imageSource,
  langOf,
  voiceOf,
  say,
  autoAudio,
  onToggleStar,
  onDone,
  onFeedback,
}: Props) {
  const promptSide = otherSide(q.answerSide)
  const prompt = sideText(card, promptSide)
  const answer = sideText(card, q.answerSide)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [tfPicked, setTfPicked] = useState<boolean | null>(null)
  const [response, setResponse] = useState('')
  const [retyped, setRetyped] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [peeked, setPeeked] = useState(false)
  const continueRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isSpell = q.type === 'spell' && ttsSupported()
  const isWritten = q.type === 'written' || (q.type === 'spell' && !isSpell)

  // Audio: spell mode always speaks the answer; otherwise the prompt when auto-audio is on.
  useEffect(() => {
    if (isSpell) say(answer, q.answerSide)
    else if (autoAudio) say(prompt, promptSide)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.qid])

  useEffect(() => {
    if (feedback?.kind === 'wrong') continueRef.current?.focus()
  }, [feedback])

  // Correct answers move on by themselves.
  useEffect(() => {
    if (feedback?.kind !== 'correct') return
    const t = setTimeout(() => onDone({ correct: true, firstTry: !peeked }), AUTO_ADVANCE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback])

  const finishWrong = () => onDone({ correct: false, firstTry: false })
  const overrideCorrect = () => onDone({ correct: true, firstTry: true })

  const chooseMc = (i: number) => {
    if (feedback || q.choices === undefined) return
    setPicked(i)
    const ok = i === q.correctIndex
    onFeedback(ok)
    setFeedback(ok ? { kind: 'correct' } : { kind: 'wrong', response: q.choices[i]?.text, written: false })
  }

  const chooseTf = (v: boolean) => {
    if (feedback) return
    setTfPicked(v)
    const ok = v === q.isTrue
    onFeedback(ok)
    setFeedback(ok ? { kind: 'correct' } : { kind: 'wrong', response: v ? 'True' : 'False', written: false })
  }

  const submitWritten = (e?: FormEvent) => {
    e?.preventDefault()
    if (feedback) return
    if (!response.trim()) {
      dontKnow()
      return
    }
    const level = isSpell ? 'strict' : grading.level
    const result = grade(response, answer, { level, requireOne: isSpell ? false : grading.requireOne })
    onFeedback(result.correct)
    setFeedback(
      result.correct
        ? { kind: 'correct', text: GRADE_REASON_TEXT[result.reason] }
        : { kind: 'wrong', response, written: true, result },
    )
  }

  const dontKnow = () => {
    if (feedback) return
    setPeeked(true)
    onFeedback(false)
    setFeedback({ kind: 'wrong', response: undefined, written: isWritten || isSpell })
  }

  const selfGrade = (ok: boolean) => {
    if (!revealed) return
    onFeedback(ok)
    onDone({ correct: ok, firstTry: ok })
  }

  // The card a wrong answer actually belongs to, so the feedback can say what it means.
  const wrongCard =
    feedback?.kind !== 'wrong'
      ? undefined
      : q.type === 'mc'
        ? otherCard(pool, q.choices?.[picked ?? -1]?.cardId, card.id)
        : q.type === 'tf'
          ? !q.isTrue && tfPicked
            ? otherCard(pool, q.shown?.cardId, card.id)
            : undefined
          : feedback.response
            ? cardForAnswer(feedback.response, q.answerSide, pool, card.id)
            : undefined

  const retypeOk = !retype || feedback?.kind !== 'wrong' || !feedback.written || grade(retyped, answer, { level: 'moderate' }).correct

  useHotkeys(
    {
      '1': () => (q.type === 'mc' ? chooseMc(0) : q.type === 'flashcard' ? selfGrade(false) : undefined),
      '2': () => (q.type === 'mc' ? chooseMc(1) : q.type === 'flashcard' ? selfGrade(true) : undefined),
      '3': () => q.type === 'mc' && chooseMc(2),
      '4': () => q.type === 'mc' && chooseMc(3),
      t: () => q.type === 'tf' && chooseTf(true),
      f: () => q.type === 'tf' && chooseTf(false),
      space: () => q.type === 'flashcard' && setRevealed(true),
      arrowleft: () => q.type === 'flashcard' && selfGrade(false),
      arrowright: () => q.type === 'flashcard' && selfGrade(true),
      enter: () => {
        if (feedback?.kind === 'wrong' && retypeOk) finishWrong()
        else if (feedback?.kind === 'correct') onDone({ correct: true, firstTry: !peeked })
      },
    },
    { force: ['space'] },
  )

  const promptBlock = (
    <div className={styles.prompt}>
      <div className={styles.promptHead}>
        <span className={styles.sideLabel}>{promptSide === 'term' ? 'Term' : 'Definition'}</span>
        <span className="spacer" />
        {!isSpell && <AudioButton text={prompt} lang={langOf(promptSide)} voiceURI={voiceOf(promptSide)} size={18} className="btn btn-ghost btn-icon btn-sm" />}
        <StarButton starred={card.starred} onToggle={onToggleStar} size={18} className="btn btn-ghost btn-icon btn-sm" />
      </div>
      {isSpell ? (
        <div className={styles.spellPrompt}>
          <button type="button" className="btn btn-soft btn-lg" onClick={() => say(answer, q.answerSide)}>
            <Volume2 size={22} /> Play again
          </button>
          <span className="muted small">Type what you hear</span>
        </div>
      ) : (
        <>
          <p className={`${styles.promptText} ${prompt.length > 120 ? styles.promptLong : ''}`} lang={langOf(promptSide)}>
            {prompt}
          </p>
          {promptSide === 'definition' && <CardImage card={card} source={imageSource} />}
        </>
      )}
    </div>
  )

  return (
    <div className={styles.question} data-testid={`learn-q-${q.type}`} data-qid={q.qid}>
      {promptBlock}

      {q.type === 'mc' && q.choices && (
        <div className={styles.answers}>
          <span className={styles.instruction}>Choose the matching {q.answerSide}</span>
          <div className={styles.choices}>
            {q.choices.map((c, i) => {
              const state =
                feedback && i === q.correctIndex ? 'is-correct' : feedback && i === picked && i !== q.correctIndex ? 'is-incorrect' : ''
              return (
                <button
                  key={c.cardId + i}
                  type="button"
                  className={`${styles.choice} ${state}`}
                  onClick={() => chooseMc(i)}
                  disabled={!!feedback}
                  lang={langOf(q.answerSide)}
                >
                  <kbd>{i + 1}</kbd>
                  <span>{c.text}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {q.type === 'tf' && q.shown && (
        <div className={styles.answers}>
          <div className={styles.tfShown}>
            <span className={styles.sideLabel}>{q.answerSide === 'term' ? 'Term' : 'Definition'}</span>
            <p lang={langOf(q.answerSide)}>{q.shown.text}</p>
          </div>
          <span className={styles.instruction}>Is this the right match?</span>
          <div className={styles.tf}>
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                className={`${styles.choice} ${feedback && v === q.isTrue ? 'is-correct' : feedback && v === tfPicked ? 'is-incorrect' : ''}`}
                onClick={() => chooseTf(v)}
                disabled={!!feedback}
              >
                <kbd>{v ? 'T' : 'F'}</kbd>
                <span>{v ? 'True' : 'False'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(isWritten || isSpell) && (
        <form className={styles.answers} onSubmit={submitWritten}>
          <label className={styles.instruction} htmlFor={`learn-input-${q.qid}`}>
            {isSpell ? 'Your answer' : `Type the ${q.answerSide}`}
          </label>
          <div className="row-nowrap">
            <input
              id={`learn-input-${q.qid}`}
              ref={inputRef}
              className={`input input-lg ${feedback ? (feedback.kind === 'correct' ? 'is-correct' : 'is-incorrect') : ''}`}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              disabled={!!feedback}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              lang={langOf(q.answerSide)}
              data-testid="learn-input"
            />
            <button type="submit" className="btn btn-primary btn-lg" disabled={!!feedback}>
              Answer
            </button>
          </div>
          {!feedback && (
            <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={dontKnow}>
              Don’t know?
            </button>
          )}
        </form>
      )}

      {q.type === 'flashcard' && (
        <div className={styles.answers}>
          {!revealed ? (
            <button type="button" className="btn btn-lg btn-block" onClick={() => setRevealed(true)}>
              Show {q.answerSide} <kbd>Space</kbd>
            </button>
          ) : (
            <>
              <div className={styles.tfShown}>
                <span className={styles.sideLabel}>{q.answerSide === 'term' ? 'Term' : 'Definition'}</span>
                <p className="pre-wrap" lang={langOf(q.answerSide)}>
                  {answer}
                </p>
              </div>
              <div className={styles.tf}>
                <button type="button" className={`${styles.choice} ${styles.learning}`} onClick={() => selfGrade(false)}>
                  <kbd>1</kbd>
                  <span>Still learning</span>
                </button>
                <button type="button" className={`${styles.choice} ${styles.gotIt}`} onClick={() => selfGrade(true)}>
                  <kbd>2</kbd>
                  <span>Got it</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {feedback?.kind === 'correct' && (
        <div className={`${styles.feedback} ${styles.good}`} role="status">
          <Check size={20} /> {feedback.text ?? 'Correct!'}
        </div>
      )}
      {feedback?.kind === 'wrong' && (
        <div className={`${styles.feedback} ${styles.bad}`} role="alert">
          <div className={styles.feedbackHead}>
            <X size={20} /> {feedback.response === undefined ? 'Here’s the answer — you’ll see it again soon.' : 'Not quite — you’re still learning this one.'}
          </div>
          {feedback.response !== undefined && (
            <div className={styles.compare}>
              <span className={styles.sideLabel}>Your answer</span>
              <span className={styles.yours}>
                {isSpell ? <SpellDiff response={feedback.response} answer={answer} /> : feedback.response}
              </span>
            </div>
          )}
          {wrongCard && (
            <div className={styles.compare} data-testid="learn-meaning">
              <span className={styles.sideLabel}>{meaningLabel(q.answerSide, q.type === 'tf' ? 'That' : undefined)}</span>
              <span className="pre-wrap" lang={langOf(promptSide)}>
                {sideText(wrongCard, promptSide)}
              </span>
            </div>
          )}
          <div className={styles.compare}>
            <span className={styles.sideLabel}>Correct answer</span>
            <span className={`${styles.right} pre-wrap`} lang={langOf(q.answerSide)}>
              {answer}
            </span>
          </div>
          {retype && feedback.written && (
            <div className="field">
              <label htmlFor={`retype-${q.qid}`} className="small">
                Type the correct answer to continue
              </label>
              <input
                id={`retype-${q.qid}`}
                className={`input ${retyped && retypeOk ? 'is-correct' : ''}`}
                value={retyped}
                autoFocus
                autoComplete="off"
                onChange={(e) => setRetyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && retypeOk) {
                    e.preventDefault()
                    finishWrong()
                  }
                }}
              />
            </div>
          )}
          <div className="row">
            {feedback.written && feedback.response !== undefined && (
              <button type="button" className="btn" onClick={overrideCorrect}>
                I was correct
              </button>
            )}
            <span className="spacer" />
            <button ref={continueRef} type="button" className="btn btn-primary" onClick={finishWrong} disabled={!retypeOk} data-testid="learn-continue">
              Continue <kbd>Enter</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SpellDiff({ response, answer }: { response: string; answer: string }) {
  return (
    <span aria-label={`You typed ${response}`}>
      {letterDiff(response, answer).map((p, i) => (
        <span key={i} className={p.status === 'ok' ? 'diff-ok' : p.status === 'missing' ? 'diff-missing' : 'diff-bad'}>
          {p.status === 'missing' ? p.text.replace(/./g, '_') : p.text}
        </span>
      ))}
    </span>
  )
}
