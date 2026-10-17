/**
 * AI Insight explanations and AI Hints: cached per user in
 * users/{uid}/insights/{key} and generated with Gemini (Firebase AI Logic) on
 * a cache miss. Ask AI follow-up questions are a live chat and not stored.
 */
import { getDoc, setDoc } from 'firebase/firestore'
import { AI_MODEL } from '../config/app'
import type { AiTask } from '../firebase/ai'
import {
  buildChatTurns,
  buildHintPrompt,
  buildInsightPrompt,
  hintKey,
  insightKey,
  maskAnswer,
  type ChatTurn,
  type HintRequest,
  type InsightRequest,
} from '../lib/insight'
import { insightRef } from './paths'

/** Longest text stored (firestore.rules allows a little more). */
const MAX_TEXT = 4000

export type InsightErrorKind = 'offline' | 'quota' | 'blocked' | 'failed'

export class InsightError extends Error {
  readonly kind: InsightErrorKind
  constructor(kind: InsightErrorKind, cause?: unknown) {
    super(kind, { cause })
    this.kind = kind
  }
}

function classify(err: unknown): InsightErrorKind {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline'
  const e = err as { code?: string; message?: string; customErrorData?: { status?: number } }
  const status = e.customErrorData?.status
  const text = `${e.code ?? ''} ${e.message ?? ''}`.toLowerCase()
  if (status === 429 || text.includes('quota') || text.includes('resource_exhausted')) return 'quota'
  if (status === 401 || status === 403 || text.includes('app-check') || text.includes('appcheck')) return 'blocked'
  return 'failed'
}

interface Job {
  uid: string
  task: AiTask
  key: string
  prompt: string
  setId: string
  cardId: string
  /** Cleans up the text before it's shown or stored (e.g. hides the answer in a hint). */
  clean?: (text: string) => string
}

/** Serves the cached reply, or streams a new one from Gemini and caches it. */
async function cachedOrStreamed(job: Job, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const clean = job.clean ?? ((t: string) => t)
  const ref = insightRef(job.uid, job.key)
  const cached = await getDoc(ref).catch(() => null)
  const cachedText = cached?.data()?.text
  if (typeof cachedText === 'string' && cachedText) {
    onText(cachedText)
    return cachedText
  }

  let text = ''
  try {
    const { geminiModel } = await import('../firebase/ai')
    const { stream } = await geminiModel(job.task).generateContentStream(job.prompt, { signal })
    for await (const chunk of stream) {
      text += chunk.text()
      onText(clean(text))
    }
  } catch (err) {
    if (signal?.aborted) throw err
    console.error(`AI ${job.task} failed`, err)
    throw new InsightError(classify(err), err)
  }
  text = clean(text.trim()).slice(0, MAX_TEXT)
  if (!text) throw new InsightError('failed')

  setDoc(ref, {
    kind: job.task,
    setId: job.setId,
    cardId: job.cardId,
    text,
    model: AI_MODEL,
    createdAt: Date.now(),
  }).catch((err: unknown) => console.warn(`Could not cache AI ${job.task}`, err))
  return text
}

/**
 * Explains a wrong answer. Calls `onText` with the explanation so far (a cached
 * one at once, a new one as it streams in) and resolves with the full text.
 */
export async function explainWrongAnswer(
  uid: string,
  req: InsightRequest,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const job: Job = { uid, task: 'insight', key: await insightKey(req), prompt: buildInsightPrompt(req), setId: req.setId, cardId: req.cardId }
  return cachedOrStreamed(job, onText, signal)
}

/** A hint towards a card's answer that doesn't give it away. Same streaming and caching as above. */
export async function hintForCard(uid: string, req: HintRequest, onText: (text: string) => void, signal?: AbortSignal): Promise<string> {
  const job: Job = {
    uid,
    task: 'hint',
    key: await hintKey(req),
    prompt: buildHintPrompt(req),
    setId: req.setId,
    cardId: req.cardId,
    clean: (text) => maskAnswer(text, req.answer),
  }
  return cachedOrStreamed(job, onText, signal)
}

/**
 * Answers a follow-up question about a wrong answer. `turns` holds the
 * conversation so far and ends with the new question; `insight` is the AI
 * Insight shown before it, if any. Streams like the functions above.
 */
export async function askFollowUp(
  req: InsightRequest,
  insight: string | null,
  turns: readonly ChatTurn[],
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const contents = buildChatTurns(req, insight, turns).map((t) => ({ role: t.role, parts: [{ type: 'text' as const, text: t.text }] }))
  let text = ''
  try {
    const { geminiModel } = await import('../firebase/ai')
    const { stream } = await geminiModel('chat').generateContentStream({ contents }, { signal })
    for await (const chunk of stream) {
      text += chunk.text()
      onText(text)
    }
  } catch (err) {
    if (signal?.aborted) throw err
    console.error('AI chat failed', err)
    throw new InsightError(classify(err), err)
  }
  text = text.trim()
  if (!text) throw new InsightError('failed')
  return text
}
