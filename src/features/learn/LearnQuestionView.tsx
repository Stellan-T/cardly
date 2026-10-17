import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useHotkeys } from '../../components/hotkeys'
import { Check, MessagesSquare, Volume2, X } from '../../components/icons'
import { AudioButton, CardImage, StarButton } from '../../components/StudyButtons'
import { grade, GRADE_REASON_TEXT, letterDiff, NEAR_MISS_REASONS, type GradeReason, type GradeResult } from '../../lib/grade'
import type { LearnQuestion } from '../../lib/learn'
import { cardForAnswer, meaningLabel, otherCard, otherSide, sideText } from '../../lib/questions'
import { ttsSupported } from '../../lib/tts'
import type { Card, GradingLevel, Side } from '../../types'
import type { ImageSource } from '../../data/images'
import { AiHint, AiInsight, useAiAvailable, type InsightQuestion } from '../study/AiInsight'
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
  | { kind: 'correct'; text?: string; nearMiss?: { response: string; reason: GradeReason } }
  | { kind: 'wrong'; response?: string; written: boolean; result?: GradeResult }

const AUTO_ADVANCE_MS = 900
/** With AI help available, long enough to press "Ask AI" before moving on. */
const AUTO_ADVANCE_WITH_AI_MS = 5000

const NEAR_MISS_HEAD: Partial<Record<GradeReason, string>> = {
  accent: 'Correct! Mind the accents, though.',
  typo: 'Correct! Mind the spelling, though.',
  meaning: 'Correct! The exact wording is a little different.',
}

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

  // The card a wrong answer actually belongs to, so the feedback can say what it means.
  // A false true/false pairing always gets one, right or wrong: the shown side is another card's.
  const wrongCard = !feedback
    ? undefined
    : q.type === 'tf'
      ? q.isTrue
        ? undefined
        : otherCard(pool, q.shown?.cardId, card.id)
      : feedback.kind !== 'wrong'
        ? undefined
        : q.type === 'mc'
          ? otherCard(pool, q.choices?.[picked ?? -1]?.cardId, card.id)
          : feedback.response
            ? cardForAnswer(feedback.response, q.answerSide, pool, card.id)
            : undefined
  // A correct answer that comes with something to read (a meaning, or the exact
  // wording of a near miss) waits for Continue.
  const nearMiss = feedback?.kind === 'correct' ? feedback.nearMiss : undefined
  const aiAvailable = useAiAvailable()
  // "Ask AI" pressed on a correct answer: stay on it and chat.
  const [asking, setAsking] = useState(false)
  const holdCorrect = feedback?.kind === 'correct' && (!!wrongCard || !!nearMiss || asking)
  const advanceMs = aiAvailable ? AUTO_ADVANCE_WITH_AI_MS : AUTO_ADVANCE_MS
  const countingDown = aiAvailable && feedback?.kind === 'correct' && !holdCorrect

  useEffect(() => {
    if (feedback?.kind === 'wrong' || holdCorrect) continueRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback])

  // Correct answers move on by themselves.
  useEffect(() => {
    if (feedback?.kind !== 'correct' || holdCorrect) return
    const t = setTimeout(() => onDone({ correct: true, firstTry: !peeked }), advanceMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback, holdCorrect])

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
        ? {
            kind: 'correct',
            text: GRADE_REASON_TEXT[result.reason],
            nearMiss: !isSpell && NEAR_MISS_REASONS.has(result.reason) ? { response, reason: result.reason } : undefined,
          }
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
      // Tab opens Ask AI while a correct answer counts down; otherwise Tab keeps moving focus.
      ...(countingDown ? { tab: () => setAsking(true) } : {}),
    },
    { force: ['space'] },
  )

  // A false true/false pairing, explained both ways: the right answer for this
  // prompt, and what the shown answer belongs to instead.
  const shownText = q.shown?.text ?? ''
  const tfPairs = q.type === 'tf' && wrongCard && (
    <dl className={styles.pairs}>
      <div className={styles.pair}>
        <dt className={styles.pairLabel}>
          {q.answerSide === 'term' ? 'The term for this definition' : 'The definition of this term'}
        </dt>
        <dd className={`${styles.right} pre-wrap`} lang={langOf(q.answerSide)}>
          {answer}
        </dd>
      </div>
      <div className={styles.pair} data-testid="learn-meaning">
        <dt className={styles.pairLabel}>
          {q.answerSide === 'term' ? (
            shownText.length <= 60 ? (
              <>
                <span lang={langOf(q.answerSide)}>“{shownText}”</span> means
              </>
            ) : (
              'The shown term means'
            )
          ) : (
            'The shown definition belongs to'
          )}
        </dt>
        <dd className="pre-wrap" lang={langOf(promptSide)}>
          {sideText(wrongCard, promptSide)}
        </dd>
      </div>
    </dl>
  )

  /** What Ask AI is told about this question; `given` is what the student answered. */
  const askQuestion = (given: string, extra: Partial<InsightQuestion> = {}): InsightQuestion => ({
    cardId: card.id,
    questionType: q.type,
    promptSide,
    prompt,
    answerSide: q.answerSide,
    correctAnswer: answer,
    userAnswer: given,
    shown: q.type === 'tf' ? q.shown?.text : undefined,
    ...extra,
  })
  const givenAnswer =
    q.type === 'mc' ? (q.choices?.[picked ?? -1]?.text ?? '') : q.type === 'tf' ? (tfPicked ? 'True' : 'False') : response
  const continueCorrect = (
    <div className="row">
      <span className="spacer" />
      <button
        ref={continueRef}
        type="button"
        className="btn btn-primary"
        onClick={() => onDone({ correct: true, firstTry: !peeked })}
        data-testid="learn-continue"
      >
        Continue <kbd>Enter</kbd>
      </button>
    </div>
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

      {!isSpell && (
        <AiHint
          question={{ cardId: card.id, promptSide, prompt, answerSide: q.answerSide, answer }}
          hideButton={!!feedback || revealed}
          // A hinted answer isn't a first-try answer, just like peeking.
          onUse={() => setPeeked(true)}
        />
      )}

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
              <AiInsight question={askQuestion('')} askOnly />
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

      {feedback?.kind === 'correct' && !holdCorrect && (
        <div className={`${styles.feedback} ${styles.good}`} role="status">
          <Check size={20} /> {feedback.text ?? 'Correct!'}
          {aiAvailable && (
            <>
              <span className="spacer" />
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setAsking(true)} data-testid="learn-ask-ai">
                <MessagesSquare size={16} aria-hidden />
                Ask AI <kbd className="hide-mobile">Tab</kbd>
              </button>
              <span className={styles.countdown} style={{ animationDuration: `${advanceMs}ms` }} aria-hidden />
            </>
          )}
        </div>
      )}
      {asking && !wrongCard && !nearMiss && feedback?.kind === 'correct' && (
        <div className={`${styles.feedback} ${styles.goodDetail}`} role="status" data-testid="learn-correct-chat">
          <div className={`${styles.feedbackHead} ${styles.feedbackHeadGood}`}>
            <Check size={20} /> {feedback.text ?? 'Correct!'}
          </div>
          <AiInsight question={askQuestion(givenAnswer, { correct: true })} askOnly startInChat />
          {continueCorrect}
        </div>
      )}
      {holdCorrect && wrongCard && (
        <div className={`${styles.feedback} ${styles.goodDetail}`} role="status">
          <div className={`${styles.feedbackHead} ${styles.feedbackHeadGood}`}>
            <Check size={20} /> {feedback.text ?? 'Correct! These don’t match.'}
          </div>
          {tfPairs}
          <AiInsight
            question={askQuestion(givenAnswer, { correct: true, userAnswerMeaning: sideText(wrongCard, promptSide) })}
            askOnly
            startInChat={asking}
          />
          {continueCorrect}
        </div>
      )}
      {nearMiss && (
        <div className={`${styles.feedback} ${styles.goodDetail}`} role="status" data-testid="learn-near-miss">
          <div className={`${styles.feedbackHead} ${styles.feedbackHeadGood}`}>
            <Check size={20} /> {NEAR_MISS_HEAD[nearMiss.reason]}
          </div>
          <dl className={styles.pairs}>
            <div className={styles.pair}>
              <dt className={styles.pairLabel}>Your answer</dt>
              <dd className="pre-wrap" lang={langOf(q.answerSide)}>
                {nearMiss.response}
              </dd>
            </div>
            <div className={styles.pair}>
              <dt className={styles.pairLabel}>Exact wording</dt>
              <dd className={`${styles.right} pre-wrap`} lang={langOf(q.answerSide)}>
                {answer}
              </dd>
            </div>
          </dl>
          <AiInsight
            question={{
              cardId: card.id,
              questionType: q.type,
              promptSide,
              prompt,
              answerSide: q.answerSide,
              correctAnswer: answer,
              userAnswer: nearMiss.response,
              accepted: nearMiss.reason,
            }}
          />
          <div className="row">
            <span className="spacer" />
            <button
              ref={continueRef}
              type="button"
              className="btn btn-primary"
              onClick={() => onDone({ correct: true, firstTry: !peeked })}
              data-testid="learn-continue"
            >
              Continue <kbd>Enter</kbd>
            </button>
          </div>
        </div>
      )}
      {feedback?.kind === 'wrong' && (
        <div className={`${styles.feedback} ${styles.bad}`} role="alert">
          <div className={styles.feedbackHead}>
            <X size={20} />{' '}
            {feedback.response === undefined
              ? 'Here’s the answer — you’ll see it again soon.'
              : q.type === 'tf'
                ? q.isTrue
                  ? 'Not quite — these do match.'
                  : 'Not quite — these don’t match.'
                : 'Not quite — you’re still learning this one.'}
          </div>
          {feedback.response !== undefined && q.type !== 'tf' && (
            <div className={styles.compare}>
              <span className={styles.sideLabel}>Your answer</span>
              <span className={styles.yours}>
                {isSpell ? <SpellDiff response={feedback.response} answer={answer} /> : feedback.response}
              </span>
            </div>
          )}
          {q.type === 'tf' && wrongCard ? (
            tfPairs
          ) : (
            <>
              {wrongCard && (
                <div className={styles.compare} data-testid="learn-meaning">
                  <span className={styles.sideLabel}>{meaningLabel(q.answerSide)}</span>
                  <span className="pre-wrap" lang={langOf(promptSide)}>
                    {sideText(wrongCard, promptSide)}
                  </span>
                </div>
              )}
              <div className={styles.compare}>
                <span className={styles.sideLabel}>{q.type === 'tf' ? `The right ${q.answerSide}` : 'Correct answer'}</span>
                <span className={`${styles.right} pre-wrap`} lang={langOf(q.answerSide)}>
                  {answer}
                </span>
              </div>
            </>
          )}
          {/* "Don't know?" leaves no answer to explain, but Ask AI is still there. */}
          <AiInsight
            question={askQuestion(feedback.response ?? '', {
              userAnswerMeaning: wrongCard ? sideText(wrongCard, promptSide) : undefined,
            })}
            askOnly={feedback.response === undefined}
          />
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
