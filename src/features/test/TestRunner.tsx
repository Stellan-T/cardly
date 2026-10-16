/** The test itself: every question on one scrollable page, grouped by type, with a sticky progress / submit bar. */
import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import { ProgressBar } from '../../components/controls'
import { useHotkeys } from '../../components/hotkeys'
import { ArrowDown } from '../../components/icons'
import { K, useShortcutHelp } from '../../components/Shortcuts'
import { otherSide, QUESTION_TYPE_LABELS } from '../../lib/questions'
import { isAnswered, type GeneratedTest, type TestAnswer, type TestAnswers, type TestQuestion, type TestQuestionType } from '../../lib/testGen'
import { useSpeech } from '../study/hooks'
import { MatchingBlockView } from './MatchingBlock'
import { focusQuestion, QuestionView, type AnswerPatch, type CardLookup } from './TestQuestions'
import styles from './TestPage.module.css'

const SECTION_HINTS: Record<TestQuestionType, string> = {
  tf: 'Decide whether each pair belongs together.',
  mc: 'Choose the correct answer.',
  matching: 'Drag each answer onto its prompt, tap an answer and then a prompt, or pick its letter.',
  written: 'Type the answer.',
}

const range = (from: number, to: number) => (from === to ? `Question ${from}` : `Questions ${from}–${to}`)

const isTextEntry = (el: HTMLElement) =>
  (el instanceof HTMLInputElement && el.type !== 'radio' && el.type !== 'checkbox') ||
  el instanceof HTMLTextAreaElement ||
  el instanceof HTMLSelectElement

export function TestRunner({
  title,
  test,
  answers,
  answered,
  cards,
  onAnswer,
  onSubmit,
  scopeRef,
}: {
  title: string
  test: GeneratedTest
  answers: TestAnswers
  answered: number
  cards: CardLookup
  onAnswer: (patch: AnswerPatch) => void
  onSubmit: () => void
  /** The page root (used by the leave guard to tell inside clicks from outside ones). */
  scopeRef: RefObject<HTMLDivElement | null>
}) {
  const { say } = useSpeech()
  const heading = useRef<HTMLHeadingElement>(null)
  const submitRef = useRef<HTMLButtonElement>(null)
  const lastQid = useRef<string | null>(null)
  const answersRef = useRef(answers)
  answersRef.current = answers
  const total = test.questions.length

  useEffect(() => {
    window.scrollTo(0, 0)
    heading.current?.focus()
  }, [test])

  const goToNext = useCallback(
    (qid: string) => {
      const next = test.questions[test.questions.findIndex((q) => q.id === qid) + 1]
      if (next) focusQuestion(next.id)
      else submitRef.current?.focus()
    },
    [test],
  )

  /** Next unanswered question after the last one the learner was on, wrapping around. */
  const jumpToUnanswered = useCallback(() => {
    const list = test.questions
    const from = lastQid.current ? list.findIndex((q) => q.id === lastQid.current) + 1 : 0
    for (let k = 0; k < list.length; k++) {
      const q = list[(from + k) % list.length]
      if (!isAnswered(q, answersRef.current[q.id])) {
        focusQuestion(q.id)
        return
      }
    }
  }, [test])

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, q: TestQuestion) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement
      if (e.key === 'Enter') {
        if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return
        e.preventDefault()
        goToNext(q.id)
        return
      }
      if (isTextEntry(target)) return
      const key = e.key.toLowerCase()
      let value: TestAnswer | undefined
      if (q.type === 'mc' && /^[1-4]$/.test(key) && Number(key) <= q.choices.length) value = Number(key) - 1
      else if (q.type === 'tf' && (key === 't' || key === 'f')) value = key === 't'
      else if (key === 'a' || key === 'n') {
        // Handled here too because page hotkeys ignore focused inputs such as radio buttons.
        e.preventDefault()
        if (key === 'a') say(q.prompt, otherSide(q.answerSide))
        else jumpToUnanswered()
        return
      }
      if (value === undefined) return
      e.preventDefault()
      onAnswer({ [q.id]: value })
      e.currentTarget.querySelector<HTMLInputElement>(`input[type="radio"][value="${String(value)}"]`)?.focus()
    },
    [goToNext, jumpToUnanswered, onAnswer, say],
  )

  useHotkeys({ n: jumpToUnanswered })
  useShortcutHelp([
    {
      title: 'Test',
      items: [
        [
          <>
            <K>1</K>–<K>4</K>
          </>,
          'Pick a multiple-choice option',
        ],
        [
          <>
            <K>T</K> / <K>F</K>
          </>,
          'Answer True / False',
        ],
        [<K>Enter</K>, 'Go to the next question'],
        [<K>A</K>, 'Read the question aloud'],
        [<K>N</K>, 'Jump to the next unanswered question'],
      ],
    },
  ])

  const allDone = answered === total
  return (
    <div
      ref={scopeRef}
      className={styles.page}
      onFocusCapture={(e) => {
        const qid = (e.target as Element).closest<HTMLElement>('[data-qid]')?.dataset.qid
        if (qid) lastQid.current = qid
      }}
    >
      <header className={styles.intro}>
        <p className="subtle">{title}</p>
        <h1 ref={heading} tabIndex={-1}>
          Practice test
        </h1>
        <p className="muted">
          {total} {total === 1 ? 'question' : 'questions'} · Answer in any order, then submit. Answers are checked when you
          submit; leaving the page discards them.
        </p>
      </header>

      {test.sections.map((section) => {
        const first = section.questions[0].number
        const last = section.questions[section.questions.length - 1].number
        return (
          <section key={section.type} className={styles.section} aria-labelledby={`section-${section.type}`}>
            <div className={styles.sectionHead}>
              <h2 id={`section-${section.type}`}>{QUESTION_TYPE_LABELS[section.type]}</h2>
              <span className="subtle">{range(first, last)}</span>
            </div>
            <p className={styles.sectionHint}>{SECTION_HINTS[section.type]}</p>
            {section.type === 'matching'
              ? section.blocks.map((block) => (
                  <MatchingBlockView
                    key={block.id}
                    block={block}
                    total={total}
                    answers={answers}
                    cards={cards}
                    onAnswer={onAnswer}
                    onKeyDown={onKeyDown}
                  />
                ))
              : section.questions.map((q) => (
                  <QuestionView
                    key={q.id}
                    q={q}
                    total={total}
                    card={cards.get(q.cardId)}
                    answer={answers[q.id]}
                    onAnswer={onAnswer}
                    onKeyDown={onKeyDown}
                  />
                ))}
          </section>
        )
      })}

      <div className={`${styles.bar} no-print`}>
        <div className={styles.barStatus}>
          <span className={styles.barCount} aria-live="polite">
            {allDone ? `All ${total} answered` : `${answered} of ${total} answered`}
          </span>
          <ProgressBar value={answered} max={total} label="Questions answered" tone={allDone ? 'success' : undefined} />
        </div>
        <div className={styles.barActions}>
          <button
            type="button"
            className="btn"
            onClick={jumpToUnanswered}
            disabled={allDone}
            aria-label="Jump to the next unanswered question"
            title="Next unanswered (N)"
          >
            <ArrowDown size={18} aria-hidden />
            <span className="hide-mobile">Next unanswered</span>
          </button>
          <button ref={submitRef} type="button" className="btn btn-primary" onClick={onSubmit}>
            Submit test
          </button>
        </div>
      </div>
    </div>
  )
}
