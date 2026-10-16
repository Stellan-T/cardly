/** Question cards for the test page: True/False, Multiple choice and Written (Matching lives in MatchingBlock). */
import { memo, type KeyboardEvent, type ReactNode } from 'react'
import { AudioButton, CardImage } from '../../components/StudyButtons'
import { otherSide } from '../../lib/questions'
import type { McTestQuestion, TestAnswer, TestQuestion, TfTestQuestion, WrittenTestQuestion } from '../../lib/testGen'
import { ttsSupported } from '../../lib/tts'
import type { Card, Side } from '../../types'
import { useStudySet } from '../sets/StudySetContext'
import { useSpeech } from '../study/hooks'
import styles from './TestPage.module.css'

export type AnswerPatch = Record<string, TestAnswer | undefined>
export type QuestionKeyHandler = (e: KeyboardEvent<HTMLElement>, q: TestQuestion) => void
export type CardLookup = ReadonlyMap<string, Card>

export const SIDE_LABEL: Record<Side, string> = { term: 'Term', definition: 'Definition' }

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ')

/** `lang` attribute for a set language ("und" = unknown). */
export const langAttr = (lang: string) => (lang && lang !== 'und' ? lang : undefined)

export const questionDomId = (qid: string) => `test-${qid}`

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reducedMotion === 'true'

/** Scrolls a question into the middle of the screen and focuses its answer control. */
export function focusQuestion(qid: string) {
  const el = document.getElementById(questionDomId(qid))
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  const control = el.querySelector<HTMLElement>('input:checked') ?? el.querySelector<HTMLElement>('input, select') ?? el
  control.focus({ preventScroll: true })
}

export function PromptAudio({ text, side }: { text: string; side: Side }) {
  const { langOf, voiceOf } = useSpeech()
  if (!text.trim() || !ttsSupported()) return null
  return (
    <AudioButton
      shortcut="A"
      text={text}
      lang={langOf(side)}
      voiceURI={voiceOf(side)}
      size={18}
      className="btn btn-ghost btn-icon btn-sm no-print"
      label="Read aloud"
    />
  )
}

/** The prompt text plus the card image (images belong to the definition side). */
export function Prompt({ q, card, className = styles.prompt }: { q: TestQuestion; card?: Card; className?: string }) {
  const { imageSource } = useStudySet()
  const { langOf } = useSpeech()
  const side = otherSide(q.answerSide)
  return (
    <>
      <p className={className} lang={langAttr(langOf(side))}>
        {q.prompt}
      </p>
      {side === 'definition' && card && <CardImage card={card} source={imageSource} className={`card-image ${styles.image}`} />}
    </>
  )
}

function QuestionCard({
  q,
  total,
  onKeyDown,
  children,
}: {
  q: TestQuestion
  total: number
  onKeyDown: QuestionKeyHandler
  children: ReactNode
}) {
  const side = otherSide(q.answerSide)
  return (
    <article
      id={questionDomId(q.id)}
      data-qid={q.id}
      className={styles.question}
      tabIndex={-1}
      aria-labelledby={`${q.id}-title`}
      onKeyDown={(e) => onKeyDown(e, q)}
    >
      <div className={styles.qHead}>
        <h3 id={`${q.id}-title`} className={styles.qTitle}>
          <span className={styles.qNum}>
            <span className="sr-only">Question </span>
            {q.number}
          </span>{' '}
          <span className="subtle">of {total}</span>
        </h3>
        <span className={styles.sideLabel}>{SIDE_LABEL[side]}</span>
        <span className="spacer" />
        <PromptAudio text={q.prompt} side={side} />
      </div>
      {children}
    </article>
  )
}

function ChoiceOption({
  name,
  value,
  checked,
  hint,
  lang,
  onSelect,
  children,
}: {
  name: string
  value: string
  checked: boolean
  hint?: string
  lang?: string
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <label className={styles.option}>
      <input type="radio" className={styles.radio} name={name} value={value} checked={checked} onChange={onSelect} />
      <span className={styles.tile}>
        {hint && (
          <span className={styles.key} aria-hidden>
            {hint}
          </span>
        )}
        <span className={styles.choiceText} lang={lang}>
          {children}
        </span>
      </span>
    </label>
  )
}

interface QuestionProps<Q extends TestQuestion> {
  q: Q
  total: number
  card?: Card
  answer: TestAnswer | undefined
  onAnswer: (patch: AnswerPatch) => void
  onKeyDown: QuestionKeyHandler
}

const TfQuestionView = memo(function TfQuestionView({ q, total, card, answer, onAnswer, onKeyDown }: QuestionProps<TfTestQuestion>) {
  const { langOf } = useSpeech()
  return (
    <QuestionCard q={q} total={total} onKeyDown={onKeyDown}>
      <div className={styles.tfPair}>
        <div className={styles.tfSide}>
          <Prompt q={q} card={card} />
        </div>
        <div className={styles.tfSide}>
          <span className={styles.sideLabel}>{SIDE_LABEL[q.answerSide]}</span>
          <p className={styles.prompt} lang={langAttr(langOf(q.answerSide))}>
            {q.shown.text}
          </p>
        </div>
      </div>
      <fieldset className={styles.choices}>
        <legend className={styles.legend}>Do these belong together?</legend>
        <div className={cx(styles.options, styles.tfOptions)}>
          {[true, false].map((value) => (
            <ChoiceOption
              key={String(value)}
              name={`answer-${q.id}`}
              value={String(value)}
              checked={answer === value}
              hint={value ? 'T' : 'F'}
              onSelect={() => onAnswer({ [q.id]: value })}
            >
              {value ? 'True' : 'False'}
            </ChoiceOption>
          ))}
        </div>
      </fieldset>
    </QuestionCard>
  )
})

const McQuestionView = memo(function McQuestionView({ q, total, card, answer, onAnswer, onKeyDown }: QuestionProps<McTestQuestion>) {
  const { langOf } = useSpeech()
  const lang = langAttr(langOf(q.answerSide))
  return (
    <QuestionCard q={q} total={total} onKeyDown={onKeyDown}>
      <Prompt q={q} card={card} />
      <fieldset className={styles.choices}>
        <legend className={styles.legend}>Choose the matching {SIDE_LABEL[q.answerSide].toLowerCase()}</legend>
        <div className={styles.options}>
          {q.choices.map((c, i) => (
            <ChoiceOption
              key={c.cardId}
              name={`answer-${q.id}`}
              value={String(i)}
              checked={answer === i}
              hint={i < 4 ? String(i + 1) : undefined}
              lang={lang}
              onSelect={() => onAnswer({ [q.id]: i })}
            >
              {c.text}
            </ChoiceOption>
          ))}
        </div>
      </fieldset>
    </QuestionCard>
  )
})

const WrittenQuestionView = memo(function WrittenQuestionView({
  q,
  total,
  card,
  answer,
  onAnswer,
  onKeyDown,
}: QuestionProps<WrittenTestQuestion>) {
  const { langOf } = useSpeech()
  const inputId = `${q.id}-input`
  return (
    <QuestionCard q={q} total={total} onKeyDown={onKeyDown}>
      <Prompt q={q} card={card} />
      <div className="field">
        <label htmlFor={inputId} className={styles.legend}>
          Type the {SIDE_LABEL[q.answerSide].toLowerCase()}
        </label>
        <input
          id={inputId}
          className="input"
          type="text"
          value={typeof answer === 'string' ? answer : ''}
          onChange={(e) => onAnswer({ [q.id]: e.target.value })}
          lang={langAttr(langOf(q.answerSide))}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="Your answer"
        />
      </div>
    </QuestionCard>
  )
})

/** Renders one non-matching question. */
export function QuestionView(props: QuestionProps<TestQuestion>) {
  const { q } = props
  if (q.type === 'tf') return <TfQuestionView {...props} q={q} />
  if (q.type === 'mc') return <McQuestionView {...props} q={q} />
  if (q.type === 'written') return <WrittenQuestionView {...props} q={q} />
  return null
}
