/** Test results: score, encouragement, follow-up actions and a review of every question (printable). */
import { useEffect, useRef } from 'react'
import { Confetti } from '../../components/Confetti'
import { Brain, Check, Printer, RotateCcw, X } from '../../components/icons'
import { formatDate, formatDuration } from '../../lib/format'
import { GRADE_REASON_TEXT } from '../../lib/grade'
import { cardForAnswer, meaningLabel, otherCard, otherSide, QUESTION_TYPE_LABELS, sideText } from '../../lib/questions'
import type { GeneratedTest, QuestionResult, TestQuestion, TestScore } from '../../lib/testGen'
import type { Card } from '../../types'
import { AiInsight } from '../study/AiInsight'
import { useSpeech } from '../study/hooks'
import { cx, langAttr, SIDE_LABEL } from './TestQuestions'
import styles from './TestPage.module.css'

export function scoreMessage(pct: number): { title: string; body: string } {
  if (pct === 100) return { title: 'Perfect score!', body: 'You know every term in this test. Outstanding work.' }
  if (pct >= 90) return { title: 'Excellent work!', body: 'You’re nearly there — just a detail or two to polish.' }
  if (pct >= 75) return { title: 'Great job!', body: 'You know most of this set. Review the few you missed and you’ll have it.' }
  if (pct >= 50) return { title: 'Good effort!', body: 'You’re getting there. Study the missed terms, then try a new test.' }
  return { title: 'Keep going!', body: 'Every test shows what to focus on. Study the missed terms in Learn, then try again.' }
}

const EXACT_REASONS = new Set(['exact', 'format'])

export function TestResults({
  title,
  cards,
  test,
  score,
  durationMs,
  takenAt,
  celebrate,
  onOverride,
  onNewTest,
  onStudyMissed,
}: {
  title: string
  /** Every card in the set: what a wrong answer means is looked up here. */
  cards: readonly Card[]
  test: GeneratedTest
  score: TestScore
  durationMs: number
  takenAt: number
  /** Show confetti (a great first score). */
  celebrate: boolean
  onOverride: (q: TestQuestion) => void
  onNewTest: () => void
  onStudyMissed: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus()
  }, [])
  const message = scoreMessage(score.scorePct)
  const missed = score.missedCardIds.length

  return (
    <div className={styles.page}>
      {celebrate && (
        <div className="no-print">
          <Confetti />
        </div>
      )}
      <section className={cx('panel', styles.summary)} aria-labelledby="test-result-title">
        <div
          className={styles.ring}
          style={{ '--pct': score.scorePct } as React.CSSProperties}
          role="img"
          aria-label={`Score: ${score.scorePct}%`}
        >
          <span className={styles.ringValue}>{score.scorePct}%</span>
        </div>
        <div className={styles.summaryBody}>
          <p className="subtle">
            {title} · Taken {formatDate(takenAt)}
          </p>
          <h1 id="test-result-title" ref={heading} tabIndex={-1}>
            {message.title}
          </h1>
          <p className="muted">{message.body}</p>
          <dl className={styles.stats}>
            <div>
              <dt>Correct</dt>
              <dd className={styles.statOk}>{score.correct}</dd>
            </div>
            <div>
              <dt>Incorrect</dt>
              <dd className={styles.statBad}>{score.incorrect}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{formatDuration(durationMs)}</dd>
            </div>
          </dl>
        </div>
        <div className={cx(styles.summaryActions, 'no-print')}>
          <button type="button" className="btn btn-primary" onClick={onNewTest}>
            <RotateCcw size={18} aria-hidden />
            Take a new test
          </button>
          {missed > 0 && (
            <button type="button" className="btn btn-soft" onClick={onStudyMissed}>
              <Brain size={18} aria-hidden />
              Study {missed} missed {missed === 1 ? 'term' : 'terms'} in Learn
            </button>
          )}
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={18} aria-hidden />
            Print test
          </button>
        </div>
      </section>

      {test.sections.map((section) => (
        <section key={section.type} className={styles.section} aria-labelledby={`review-${section.type}`}>
          <div className={styles.sectionHead}>
            <h2 id={`review-${section.type}`}>{QUESTION_TYPE_LABELS[section.type]}</h2>
            <span className="subtle">
              {section.questions.filter((q) => score.byId[q.id]?.correct).length} of {section.questions.length} correct
            </span>
          </div>
          <ol className={styles.reviewList}>
            {section.questions.map((q) => (
              <ReviewItem key={q.id} q={q} r={score.byId[q.id]} cards={cards} onOverride={onOverride} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function ReviewItem({
  q,
  r,
  cards,
  onOverride,
}: {
  q: TestQuestion
  r: QuestionResult
  cards: readonly Card[]
  onOverride: (q: TestQuestion) => void
}) {
  const { langOf } = useSpeech()
  const promptSide = otherSide(q.answerSide)
  const answerLang = langAttr(langOf(q.answerSide))
  const tf = q.type === 'tf'
  const showExpected = !r.correct || (q.type === 'written' && !EXACT_REASONS.has(r.reason ?? 'exact'))
  const textLang = tf ? undefined : answerLang
  const yours = !r.answered
    ? 'No answer'
    : q.type === 'matching'
      ? `${r.letter}. ${r.response}`
      : r.response
  const expected = q.type === 'matching' ? `${q.correctLetter}. ${r.expected}` : r.expected
  // The card a wrong answer actually belongs to, so the review can say what it means.
  const wrongCard =
    r.correct || !r.answered
      ? undefined
      : q.type === 'mc'
        ? otherCard(cards, q.choices.find((c) => c.text === r.response)?.cardId, q.cardId)
        : q.type === 'matching'
          ? otherCard(cards, q.options.find((o) => o.letter === r.letter)?.cardId, q.cardId)
          : q.type === 'tf'
            ? q.isTrue
              ? undefined
              : otherCard(cards, q.shown.cardId, q.cardId)
            : cardForAnswer(r.response, q.answerSide, cards, q.cardId)

  return (
    <li className={cx(styles.review, r.correct ? styles.reviewOk : styles.reviewBad)}>
      <div className={styles.qHead}>
        <span className={styles.qNum}>
          <span className="sr-only">Question </span>
          {q.number}
        </span>
        <span className={cx('badge', r.correct ? 'badge-success' : 'badge-danger')}>
          {r.correct ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
          {r.correct ? 'Correct' : r.answered ? 'Incorrect' : 'Not answered'}
        </span>
        {r.overridden && <span className="badge">Marked correct by you</span>}
        {q.type === 'written' && r.correct && !r.overridden && r.reason && !EXACT_REASONS.has(r.reason) && (
          <span className="subtle">{GRADE_REASON_TEXT[r.reason]}</span>
        )}
      </div>
      <p className={styles.reviewPrompt}>
        <span className={styles.sideLabel}>{SIDE_LABEL[promptSide]}</span>
        <span lang={langAttr(langOf(promptSide))}>{q.prompt}</span>
      </p>
      {tf && (
        <p className={styles.reviewPrompt}>
          <span className={styles.sideLabel}>{SIDE_LABEL[q.answerSide]}</span>
          <span lang={answerLang}>{q.shown.text}</span>
        </p>
      )}
      <dl className={styles.answerLines}>
        <div className={cx(styles.answerLine, r.correct ? 'is-correct' : 'is-incorrect')}>
          <dt>
            {r.correct ? <Check size={16} aria-hidden /> : <X size={16} aria-hidden />}
            Your answer
          </dt>
          <dd lang={r.answered ? textLang : undefined}>{yours}</dd>
        </div>
        {showExpected && (
          <div className={cx(styles.answerLine, styles.expectedLine)}>
            <dt>
              <Check size={16} aria-hidden />
              Correct answer
            </dt>
            <dd lang={textLang}>{expected}</dd>
          </div>
        )}
        {wrongCard && (
          <div className={styles.answerLine} data-testid="test-meaning">
            <dt>{meaningLabel(q.answerSide, tf ? 'That' : undefined)}</dt>
            <dd lang={langAttr(langOf(promptSide))}>{sideText(wrongCard, promptSide)}</dd>
          </div>
        )}
      </dl>
      {tf && !q.isTrue && (
        <p className="subtle">
          The correct {SIDE_LABEL[q.answerSide].toLowerCase()} is <span lang={answerLang}>“{q.answer}”</span>.
        </p>
      )}
      {r.answered && !r.correct && (
        <div className="no-print">
          <AiInsight
            question={{
              cardId: q.cardId,
              questionType: q.type,
              promptSide,
              prompt: q.prompt,
              answerSide: q.answerSide,
              correctAnswer: q.answer,
              userAnswer: r.response,
              userAnswerMeaning: wrongCard ? sideText(wrongCard, promptSide) : undefined,
              shown: tf ? q.shown.text : undefined,
            }}
          />
        </div>
      )}
      {q.type === 'written' && r.answered && !r.correct && (
        <div className="no-print">
          <button type="button" className="btn btn-sm" onClick={() => onOverride(q)}>
            <Check size={16} aria-hidden />I was correct
          </button>
        </div>
      )}
    </li>
  )
}
