/**
 * Test: a practice exam. Setup → one page with every question (True/False,
 * Multiple choice, Matching, Written) → results with a full review. A new
 * randomised test is generated each time; an unsubmitted test is not saved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { confirmDialog } from '../../components/confirm'
import { saveTestResult } from '../../data/tests'
import type { GradeOptions } from '../../lib/grade'
import { randomSeed } from '../../lib/random'
import { playSound } from '../../lib/sound'
import {
  generateTest,
  gradeWith,
  isAnswered,
  scoreTest,
  type GeneratedTest,
  type TestAnswers,
  type TestQuestion,
} from '../../lib/testGen'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from '../sets/StudySetContext'
import { useGrading, useHasStarred, useModeOptions, useStudyActivity, useStudyCards } from '../study/hooks'
import { StudyLayout } from '../study/StudyLayout'
import { focusQuestion, type AnswerPatch } from './TestQuestions'
import { TestResults } from './TestResults'
import { TestRunner } from './TestRunner'
import { clampCount, normalizeOptions, TEST_DEFAULTS, TestSettingsForm, type TestModeOptions } from './TestSettings'
import { confirmLeaveTest, useLeaveGuard } from './useLeaveGuard'
import styles from './TestPage.module.css'

/** Class on <html> while the Test page is open; scopes the print rules (e.g. hiding the study header). */
const PAGE_CLASS = 'test-page-open'

type Phase =
  | { kind: 'setup' }
  | { kind: 'taking'; test: GeneratedTest; startedAt: number; settings: Record<string, unknown> }
  | {
      kind: 'results'
      test: GeneratedTest
      answers: TestAnswers
      grading: GradeOptions
      overrides: ReadonlySet<string>
      durationMs: number
      takenAt: number
      firstScorePct: number
    }

export default function TestPage() {
  const { setId, meta, basePath, progress, cards: allCards } = useStudySet()
  const { uid } = useAuth()
  const navigate = useNavigate()
  const [savedOptions, updateOptions] = useModeOptions<TestModeOptions>('test', TEST_DEFAULTS)
  const options = useMemo(() => normalizeOptions(savedOptions), [savedOptions])
  const hasStarred = useHasStarred()
  const starredOnly = options.starredOnly && hasStarred
  const cards = useStudyCards(starredOnly)
  const grading = useGrading()
  const { markStudied } = useStudyActivity('test')

  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })
  const [answers, setAnswers] = useState<TestAnswers>({})
  const answersRef = useRef(answers)
  answersRef.current = answers
  const scopeRef = useRef<HTMLDivElement>(null)

  const cardsById = useMemo(() => new Map(allCards.map((c) => [c.id, c])), [allCards])
  const answered = useMemo(
    () => (phase.kind === 'taking' ? phase.test.questions.filter((q) => isAnswered(q, answers[q.id])).length : 0),
    [phase, answers],
  )

  useLeaveGuard(phase.kind === 'taking' && answered > 0, scopeRef)

  useEffect(() => {
    document.documentElement.classList.add(PAGE_CLASS)
    return () => document.documentElement.classList.remove(PAGE_CLASS)
  }, [])

  const onAnswer = useCallback((patch: AnswerPatch) => setAnswers((prev) => ({ ...prev, ...patch })), [])

  const start = () => {
    const settings = {
      count: clampCount(options.count, cards.length),
      answerWith: options.answerWith,
      types: options.types,
    }
    const next = generateTest(cards, settings, randomSeed(), allCards)
    setAnswers({})
    setPhase({
      kind: 'taking',
      test: next,
      startedAt: Date.now(),
      settings: { ...next.settings, types: [...next.settings.types], starredOnly },
    })
  }

  const submit = async () => {
    if (phase.kind !== 'taking') return
    const missing = phase.test.questions.filter((q) => !isAnswered(q, answersRef.current[q.id]))
    if (missing.length) {
      const ok = await confirmDialog({
        title: 'Submit your test?',
        message:
          missing.length === 1
            ? '1 question is still unanswered. It will be marked incorrect.'
            : `${missing.length} questions are still unanswered. They will be marked incorrect.`,
        confirmLabel: 'Submit test',
        cancelLabel: 'Keep answering',
      })
      if (!ok) {
        // After the dialog has closed and returned focus.
        setTimeout(() => focusQuestion(missing[0].id), 0)
        return
      }
    }
    const finalAnswers = answersRef.current
    const gradingUsed: GradeOptions = { level: grading.level, requireOne: grading.requireOne }
    const score = scoreTest(phase.test.questions, finalAnswers, gradeWith(gradingUsed))
    const takenAt = Date.now()
    const durationMs = takenAt - phase.startedAt
    markStudied()
    for (const r of score.results) progress?.record(r.cardId, r.correct ? 'correct' : 'incorrect')
    if (uid)
      saveTestResult(uid, {
        setId,
        scorePct: score.scorePct,
        correct: score.correct,
        total: score.total,
        durationMs,
        settings: { ...phase.settings, gradingLevel: gradingUsed.level, requireOne: !!gradingUsed.requireOne },
        takenAt,
      })
    playSound('complete')
    setPhase({
      kind: 'results',
      test: phase.test,
      answers: finalAnswers,
      grading: gradingUsed,
      overrides: new Set(),
      durationMs,
      takenAt,
      firstScorePct: score.scorePct,
    })
  }

  const results = phase.kind === 'results' ? phase : null
  const score = useMemo(
    () => (results ? scoreTest(results.test.questions, results.answers, gradeWith(results.grading), results.overrides) : null),
    [results],
  )

  /** "I was correct": counts the written answer as correct and records the term as known. */
  const override = (q: TestQuestion) => {
    if (!results || results.overrides.has(q.id)) return
    progress?.record(q.cardId, 'correct')
    setPhase({ ...results, overrides: new Set(results.overrides).add(q.id) })
  }

  const newTest = () => {
    setAnswers({})
    setPhase({ kind: 'setup' })
    window.scrollTo(0, 0)
  }

  const optionsPanel = (
    <TestSettingsForm
      options={options}
      onChange={updateOptions}
      available={cards.length}
      note={phase.kind === 'setup' ? undefined : 'Changes apply to your next test.'}
    />
  )

  let body
  if (phase.kind === 'taking')
    body = (
      <TestRunner
        title={meta.title}
        test={phase.test}
        answers={answers}
        answered={answered}
        cards={cardsById}
        onAnswer={onAnswer}
        onSubmit={() => void submit()}
        scopeRef={scopeRef}
      />
    )
  else if (results && score)
    body = (
      <TestResults
        title={meta.title}
        test={results.test}
        score={score}
        durationMs={results.durationMs}
        takenAt={results.takenAt}
        celebrate={results.firstScorePct >= 90}
        onOverride={override}
        onNewTest={newTest}
        onStudyMissed={() => navigate(`${basePath}/learn?terms=${score.missedCardIds.join(',')}`)}
      />
    )
  else
    body = (
      <div className={styles.setup}>
        <div className={`panel ${styles.setupPanel}`}>
          <p className="subtle">{meta.title}</p>
          <h1>Set up your test</h1>
          <p className="muted">
            {cards.length} {cards.length === 1 ? 'term' : 'terms'} available. Each test is new: questions are drawn at random
            and checked when you submit.
          </p>
          <TestSettingsForm options={options} onChange={updateOptions} available={cards.length} />
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={start}>
            Start test
          </button>
        </div>
      </div>
    )

  return (
    <StudyLayout
      mode="test"
      confirmExit={phase.kind === 'taking' && answered > 0 ? confirmLeaveTest : undefined}
      options={optionsPanel}
      minCards={2}
      availableCards={phase.kind === 'setup' ? cards.length : undefined}
      headerExtra={
        phase.kind === 'taking' ? (
          <span className={styles.headerCount} title="Questions answered" aria-hidden>
            {answered}/{phase.test.questions.length}
          </span>
        ) : undefined
      }
    >
      {body}
    </StudyLayout>
  )
}
