/** "AI Insight" on a wrong answer: Gemini explains the mistake and the right answer. */
import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Sparkles } from '../../components/icons'
import { explainWrongAnswer, InsightError, type InsightErrorKind } from '../../data/insights'
import { isAiConfigured } from '../../firebase/config'
import type { InsightRequest } from '../../lib/insight'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet } from '../sets/StudySetContext'
import styles from './AiInsight.module.css'

/** Everything about the question; the set and languages are filled in here. */
export type InsightQuestion = Omit<InsightRequest, 'setId' | 'setTitle' | 'promptLang' | 'answerLang'>

const ERROR_TEXT: Record<InsightErrorKind, string> = {
  offline: 'You’re offline. Connect to the internet to get an AI Insight.',
  quota: 'AI Insight is busy right now. Try again in a minute.',
  blocked: 'AI Insight couldn’t verify this app. Reload the page and try again.',
  failed: 'Something went wrong while asking the AI. Try again.',
}

type State =
  | { status: 'idle' }
  | { status: 'loading'; text: string }
  | { status: 'done'; text: string }
  | { status: 'error'; kind: InsightErrorKind }

export function AiInsight({ question }: { question: InsightQuestion }) {
  const { uid } = useAuth()
  const { setId, meta } = useStudySet()
  const [state, setState] = useState<State>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => abort.current?.abort(), [])

  if (!isAiConfigured || !uid) return null

  const ask = () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const lang = (side: InsightQuestion['promptSide']) => (side === 'term' ? meta.termLang : meta.defLang)
    setState({ status: 'loading', text: '' })
    explainWrongAnswer(
      uid,
      {
        ...question,
        setId,
        setTitle: meta.title,
        promptLang: lang(question.promptSide),
        answerLang: lang(question.answerSide),
      },
      (text) => !controller.signal.aborted && setState({ status: 'loading', text }),
      controller.signal,
    )
      .then((text) => !controller.signal.aborted && setState({ status: 'done', text }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', kind: err instanceof InsightError ? err.kind : 'failed' })
      })
  }

  if (state.status === 'idle') {
    return (
      <button type="button" className={`btn btn-soft btn-sm ${styles.trigger}`} onClick={ask} data-testid="ai-insight">
        <Sparkles size={16} aria-hidden />
        AI Insight
      </button>
    )
  }

  return (
    <section className={styles.panel} aria-label="AI Insight" aria-live="polite" aria-busy={state.status === 'loading'}>
      <div className={styles.head}>
        <Sparkles size={16} aria-hidden />
        AI Insight
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
      {state.status === 'done' && <p className={styles.note}>AI-generated, so it can be wrong. Check it against your notes.</p>}
    </section>
  )
}
