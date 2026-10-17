/**
 * AI Insight explanations: cached per user in users/{uid}/insights/{key} and
 * generated with Gemini (Firebase AI Logic) on a cache miss.
 */
import { getDoc, setDoc } from 'firebase/firestore'
import { AI_INSIGHT_MODEL } from '../config/app'
import { buildInsightPrompt, insightKey, type InsightRequest } from '../lib/insight'
import { insightRef } from './paths'

/** Longest explanation stored (firestore.rules allows a little more). */
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
  const ref = insightRef(uid, await insightKey(req))
  const cached = await getDoc(ref).catch(() => null)
  const cachedText = cached?.data()?.text
  if (typeof cachedText === 'string' && cachedText) {
    onText(cachedText)
    return cachedText
  }

  let text = ''
  try {
    const { insightModel } = await import('../firebase/ai')
    const { stream } = await insightModel().generateContentStream(buildInsightPrompt(req), { signal })
    for await (const chunk of stream) {
      text += chunk.text()
      onText(text)
    }
  } catch (err) {
    if (signal?.aborted) throw err
    console.error('AI Insight failed', err)
    throw new InsightError(classify(err), err)
  }
  text = text.trim().slice(0, MAX_TEXT)
  if (!text) throw new InsightError('failed')

  setDoc(ref, {
    setId: req.setId,
    cardId: req.cardId,
    text,
    model: AI_INSIGHT_MODEL,
    createdAt: Date.now(),
  }).catch((err: unknown) => console.warn('Could not cache AI Insight', err))
  return text
}
