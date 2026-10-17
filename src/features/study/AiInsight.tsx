/**
 * Gemini helpers in the study modes: "AI Insight" explains a wrong answer,
 * "AI Hint" nudges towards an answer without giving it away.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Lightbulb, RefreshCw, Sparkles } from '../../components/icons'
import { explainWrongAnswer, hintForCard, InsightError, type InsightErrorKind } from '../../data/insights'
import { isAiConfigured } from '../../firebase/config'
import type { HintRequest, InsightRequest } from '../../lib/insight'
import type { Side } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet, type SetMeta } from '../sets/StudySetContext'
import styles from './AiInsight.module.css'

/** Everything about the question; the set and languages are filled in here. */
export type InsightQuestion = Omit<InsightRequest, 'setId' | 'setTitle' | 'promptLang' | 'answerLang'>
export type HintQuestion = Omit<HintRequest, 'setId' | 'setTitle' | 'promptLang' | 'answerLang'>

type Request<T> = T & { setId: string; setTitle: string; promptLang: string; answerLang: string }
type Run = (uid: string, onText: (text: string) => void, signal: AbortSignal) => Promise<string>

const ERROR_TEXT: Record<InsightErrorKind, string> = {
  offline: 'You’re offline. Connect to the internet to use AI help.',
  quota: 'The AI is busy right now. Try again in a minute.',
  blocked: 'The AI couldn’t verify this app. Reload the page and try again.',
  failed: 'Something went wrong while asking the AI. Try again.',
}

type State =
  | { status: 'idle' }
  | { status: 'loading'; text: string }
  | { status: 'done'; text: string }
  | { status: 'error'; kind: InsightErrorKind }

/** Adds the set and its languages to a question. */
function withSet<T extends { promptSide: Side; answerSide: Side }>(q: T, setId: string, meta: SetMeta): Request<T> {
  const lang = (side: Side) => (side === 'term' ? meta.termLang : meta.defLang)
  return { ...q, setId, setTitle: meta.title, promptLang: lang(q.promptSide), answerLang: lang(q.answerSide) }
}

/** A button that, once pressed, becomes a panel streaming the AI's reply. */
function AiPanel({
  label,
  icon,
  run,
  hideButton = false,
  note,
  onStart,
  centered = false,
  testId,
}: {
  label: string
  icon: ReactNode
  run: Run
  /** Hide the button (e.g. once the question is answered); a reply already shown stays. */
  hideButton?: boolean
  note?: string
  onStart?: () => void
  /** Center the button (Flashcards) instead of aligning it to the start. */
  centered?: boolean
  testId: string
}) {
  const { uid } = useAuth()
  const [state, setState] = useState<State>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  if (!isAiConfigured || !uid) return null

  const ask = () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    onStart?.()
    setState({ status: 'loading', text: '' })
    run(uid, (text) => !controller.signal.aborted && setState({ status: 'loading', text }), controller.signal)
      .then((text) => !controller.signal.aborted && setState({ status: 'done', text }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', kind: err instanceof InsightError ? err.kind : 'failed' })
      })
  }

  if (state.status === 'idle') {
    if (hideButton) return null
    return (
      <button type="button" className={`btn btn-soft btn-sm ${centered ? styles.triggerCentered : styles.trigger}`} onClick={ask} data-testid={testId}>
        {icon}
        {label}
      </button>
    )
  }

  return (
    <section className={styles.panel} aria-label={label} aria-live="polite" aria-busy={state.status === 'loading'}>
      <div className={styles.head}>
        {icon}
        {label}
        {state.status === 'loading' && <span className={`spinner ${styles.spinner}`} aria-label="Thinking" />}
      </div>
      {state.status === 'error' ? (
        <div className="row">
          <p className={styles.error}>{ERROR_TEXT[state.kind]}</p>
          <button type="button" className="btn btn-sm" onClick={ask}>
            <RefreshCw size={14} aria-hidden />
            Try again
          </button>
        </div>
      ) : (
        state.text && <p className={`${styles.text} pre-wrap`}>{state.text}</p>
      )}
      {state.status === 'done' && note && <p className={styles.note}>{note}</p>}
    </section>
  )
}

/** After a wrong answer: why it was wrong, why the right one is right, and how they differ. */
export function AiInsight({ question }: { question: InsightQuestion }) {
  const { setId, meta } = useStudySet()
  return (
    <AiPanel
      label="AI Insight"
      icon={<Sparkles size={16} aria-hidden />}
      run={(uid, onText, signal) => explainWrongAnswer(uid, withSet(question, setId, meta), onText, signal)}
      note="AI-generated, so it can be wrong. Check it against your notes."
      testId="ai-insight"
    />
  )
}

/** Before answering: a hint (an example, a context, a memory hook) that doesn't reveal the answer. */
export function AiHint({
  question,
  hideButton,
  onUse,
  centered,
}: {
  question: HintQuestion
  hideButton?: boolean
  onUse?: () => void
  centered?: boolean
}) {
  const { setId, meta } = useStudySet()
  return (
    <AiPanel
      label="AI Hint"
      icon={<Lightbulb size={16} aria-hidden />}
      run={(uid, onText, signal) => hintForCard(uid, withSet(question, setId, meta), onText, signal)}
      hideButton={hideButton}
      onStart={onUse}
      centered={centered}
      testId="ai-hint"
    />
  )
}
