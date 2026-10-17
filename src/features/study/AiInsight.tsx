/**
 * Gemini helpers in the study modes: "AI Insight" explains a wrong answer,
 * "Ask AI" takes follow-up questions about it, and "AI Hint" nudges towards
 * an answer without giving it away.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Lightbulb, MessagesSquare, RefreshCw, SendHorizontal, Sparkles } from '../../components/icons'
import { askFollowUp, explainWrongAnswer, hintForCard, InsightError, type InsightErrorKind } from '../../data/insights'
import { isAiConfigured } from '../../firebase/config'
import { MAX_CHAT_QUESTION, MAX_CHAT_QUESTIONS, type ChatTurn, type HintRequest, type InsightRequest } from '../../lib/insight'
import type { Side } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { useStudySet, type SetMeta } from '../sets/StudySetContext'
import styles from './AiInsight.module.css'

/** Everything about the question; the set and languages are filled in here. */
export type InsightQuestion = Omit<InsightRequest, 'setId' | 'setTitle' | 'promptLang' | 'answerLang'>
export type HintQuestion = Omit<HintRequest, 'setId' | 'setTitle' | 'promptLang' | 'answerLang'>

type Request<T> = T & { setId: string; setTitle: string; promptLang: string; answerLang: string }
type Stream = (onText: (text: string) => void, signal: AbortSignal) => Promise<string>

const ERROR_TEXT: Record<InsightErrorKind, string> = {
  offline: 'You’re offline. Connect to the internet to use AI help.',
  quota: 'The AI is busy right now. Try again in a minute.',
  blocked: 'The AI couldn’t verify this app. Reload the page and try again.',
  failed: 'Something went wrong while asking the AI. Try again.',
}

const AI_NOTE = 'AI-generated, so it can be wrong. Check it against your notes.'

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

/**
 * Runs one streaming AI request at a time (a new one cancels the previous)
 * and reports its progress to a state setter. Resolves with the full text, or
 * null when it failed or was cancelled.
 */
function useStreamer() {
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  return (set: (s: State) => void, stream: Stream): Promise<string | null> => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    set({ status: 'loading', text: '' })
    return stream((text) => !controller.signal.aborted && set({ status: 'loading', text }), controller.signal)
      .then((text) => {
        if (controller.signal.aborted) return null
        set({ status: 'done', text })
        return text
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) set({ status: 'error', kind: err instanceof InsightError ? err.kind : 'failed' })
        return null
      })
  }
}

function Spinner() {
  return <span className={`spinner ${styles.spinner}`} aria-label="Thinking" />
}

function ErrorRow({ kind, onRetry }: { kind: InsightErrorKind; onRetry: () => void }) {
  return (
    <div className="row">
      <p className={styles.error}>{ERROR_TEXT[kind]}</p>
      <button type="button" className="btn btn-sm" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden />
        Try again
      </button>
    </div>
  )
}

/**
 * After a wrong (or nearly right) answer: "AI Insight" explains it, "Ask AI"
 * opens a short chat about it. The chat also follows an Insight.
 */
export function AiInsight({ question }: { question: InsightQuestion }) {
  const { uid } = useAuth()
  const { setId, meta } = useStudySet()
  const run = useStreamer()
  const [insight, setInsight] = useState<State>({ status: 'idle' })
  const [chatOpen, setChatOpen] = useState(false)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [reply, setReply] = useState<State>({ status: 'idle' })
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  if (!isAiConfigured || !uid) return null
  const req = withSet(question, setId, meta)

  const explain = () => {
    void run(setInsight, (onText, signal) => explainWrongAnswer(uid, req, onText, signal)).then((text) => {
      if (text) setChatOpen(true)
    })
  }

  const openChat = () => {
    setChatOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const send = (history: ChatTurn[]) => {
    const shown = insight.status === 'done' ? insight.text : null
    void run(setReply, (onText, signal) => askFollowUp(req, shown, history, onText, signal)).then((text) => {
      if (text) setTurns([...history, { role: 'model', text }])
    })
  }

  const asked = turns.filter((t) => t.role === 'user').length
  const busy = insight.status === 'loading' || reply.status === 'loading'
  const canSend = !busy && reply.status !== 'error' && asked < MAX_CHAT_QUESTIONS

  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    const text = draft.trim().slice(0, MAX_CHAT_QUESTION)
    if (!text || !canSend) return
    const next: ChatTurn[] = [...turns, { role: 'user', text }]
    setTurns(next)
    setDraft('')
    send(next)
  }

  if (insight.status === 'idle' && !chatOpen) {
    return (
      <div className={styles.triggers}>
        <button type="button" className="btn btn-soft btn-sm" onClick={explain} data-testid="ai-insight">
          <Sparkles size={16} aria-hidden />
          AI Insight
        </button>
        <button type="button" className="btn btn-soft btn-sm" onClick={openChat} data-testid="ai-ask">
          <MessagesSquare size={16} aria-hidden />
          Ask AI
        </button>
      </div>
    )
  }

  const showNote = !busy && (insight.status === 'done' || turns.some((t) => t.role === 'model'))

  return (
    <section className={styles.panel} aria-label="AI help" aria-busy={busy}>
      {insight.status !== 'idle' && (
        <div className={styles.block} aria-live="polite">
          <div className={styles.head}>
            <Sparkles size={16} aria-hidden />
            AI Insight
            {insight.status === 'loading' && <Spinner />}
          </div>
          {insight.status === 'error' ? (
            <ErrorRow kind={insight.kind} onRetry={explain} />
          ) : (
            insight.text && <p className={`${styles.text} pre-wrap`}>{insight.text}</p>
          )}
        </div>
      )}

      {chatOpen && (
        <div className={styles.block}>
          <div className={styles.head}>
            <MessagesSquare size={16} aria-hidden />
            {insight.status === 'idle' ? 'Ask AI' : 'Ask a follow-up'}
          </div>
          {(turns.length > 0 || reply.status === 'loading') && (
            <ol className={styles.thread} aria-live="polite" data-testid="ai-thread">
              {turns.map((t, i) => (
                <li key={i} className={`pre-wrap ${t.role === 'user' ? styles.mine : styles.theirs}`}>
                  <span className="sr-only">{t.role === 'user' ? 'You: ' : 'AI: '}</span>
                  {t.text}
                </li>
              ))}
              {reply.status === 'loading' && <li className={`pre-wrap ${styles.theirs}`}>{reply.text || <Spinner />}</li>}
            </ol>
          )}
          {reply.status === 'error' && <ErrorRow kind={reply.kind} onRetry={() => send(turns)} />}
          {asked < MAX_CHAT_QUESTIONS ? (
            <form className={styles.ask} onSubmit={submit}>
              <label htmlFor={`ask-${question.cardId}`} className="sr-only">
                Ask a question about this answer
              </label>
              <textarea
                id={`ask-${question.cardId}`}
                ref={inputRef}
                className={`input ${styles.askInput}`}
                rows={2}
                maxLength={MAX_CHAT_QUESTION}
                placeholder={turns.length ? 'Ask another question…' : 'E.g. “So if …, then …? Or am I getting it wrong?”'}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter adds a line.
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
                }}
                data-testid="ai-ask-input"
              />
              <button type="submit" className="btn btn-primary btn-icon" aria-label="Send" title="Send (Enter)" disabled={!draft.trim() || !canSend}>
                <SendHorizontal size={18} aria-hidden />
              </button>
            </form>
          ) : (
            <p className={styles.note}>That’s the limit of questions for this answer.</p>
          )}
        </div>
      )}

      {showNote && <p className={styles.note}>{AI_NOTE}</p>}
      {insight.status === 'idle' && (
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={explain} disabled={busy}>
            <Sparkles size={14} aria-hidden />
            Explain my mistake
          </button>
        </div>
      )}
    </section>
  )
}

/** Before answering: a hint (an example, a context, a memory hook) that doesn't reveal the answer. */
export function AiHint({
  question,
  hideButton = false,
  onUse,
  centered = false,
}: {
  question: HintQuestion
  /** Hide the button (e.g. once the question is answered); a hint already shown stays. */
  hideButton?: boolean
  onUse?: () => void
  /** Center the button (Flashcards) instead of aligning it to the start. */
  centered?: boolean
}) {
  const { uid } = useAuth()
  const { setId, meta } = useStudySet()
  const run = useStreamer()
  const [state, setState] = useState<State>({ status: 'idle' })

  if (!isAiConfigured || !uid) return null

  const ask = () => {
    onUse?.()
    void run(setState, (onText, signal) => hintForCard(uid, withSet(question, setId, meta), onText, signal))
  }

  if (state.status === 'idle') {
    if (hideButton) return null
    return (
      <button type="button" className={`btn btn-soft btn-sm ${centered ? styles.triggerCentered : styles.trigger}`} onClick={ask} data-testid="ai-hint">
        <Lightbulb size={16} aria-hidden />
        AI Hint
      </button>
    )
  }

  return (
    <section className={styles.panel} aria-label="AI Hint" aria-live="polite" aria-busy={state.status === 'loading'}>
      <div className={styles.head}>
        <Lightbulb size={16} aria-hidden />
        AI Hint
        {state.status === 'loading' && <Spinner />}
      </div>
      {state.status === 'error' ? (
        <ErrorRow kind={state.kind} onRetry={ask} />
      ) : (
        state.text && <p className={`${styles.text} pre-wrap`}>{state.text}</p>
      )}
    </section>
  )
}
