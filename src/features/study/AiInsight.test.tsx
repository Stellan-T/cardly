import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatTurn, InsightRequest } from '../../lib/insight'

const askFollowUp = vi.fn()
const explainWrongAnswer = vi.fn()

vi.mock('../../firebase/config', () => ({ isAiConfigured: true }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ uid: 'u1' }) }))
vi.mock('../sets/StudySetContext', () => ({
  useStudySet: () => ({ setId: 's1', meta: { title: 'Spanish', termLang: 'es', defLang: 'en' } }),
}))
vi.mock('../../data/insights', () => ({
  askFollowUp: (...args: unknown[]) => askFollowUp(...args),
  explainWrongAnswer: (...args: unknown[]) => explainWrongAnswer(...args),
  hintForCard: vi.fn(),
  InsightError: class extends Error {},
}))

const { AiInsight } = await import('./AiInsight')

const question = {
  cardId: 'c1',
  questionType: 'written',
  promptSide: 'term' as const,
  prompt: 'embarazada',
  answerSide: 'definition' as const,
  correctAnswer: 'pregnant',
  userAnswer: 'embarrassed',
}

const ask = (text: string) => {
  fireEvent.change(screen.getByTestId('ai-ask-input'), { target: { value: text } })
  fireEvent.keyDown(screen.getByTestId('ai-ask-input'), { key: 'Enter' })
}

describe('AiInsight: Ask AI', () => {
  beforeEach(() => {
    askFollowUp.mockReset()
    explainWrongAnswer.mockReset()
  })

  it('offers AI Insight and Ask AI side by side', () => {
    render(<AiInsight question={question} />)
    expect(screen.getByTestId('ai-insight')).toHaveTextContent('AI Insight')
    expect(screen.getByTestId('ai-ask')).toHaveTextContent('Ask AI')
  })

  it('chats about the answer: questions and streamed replies form a thread', async () => {
    askFollowUp.mockImplementation(async (_req: InsightRequest, _insight: string | null, turns: ChatTurn[], onText: (t: string) => void) => {
      onText('Partly')
      return `Reply to: ${turns.at(-1)!.text}`
    })
    render(<AiInsight question={question} />)
    fireEvent.click(screen.getByTestId('ai-ask'))
    ask('So if it is a false friend, then embarrassed is wrong?')

    const thread = await screen.findByTestId('ai-thread')
    await waitFor(() => expect(thread).toHaveTextContent('Reply to: So if it is a false friend, then embarrassed is wrong?'))
    expect(askFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ setId: 's1', promptLang: 'es', answerLang: 'en', userAnswer: 'embarrassed' }),
      null,
      [{ role: 'user', text: 'So if it is a false friend, then embarrassed is wrong?' }],
      expect.any(Function),
      expect.any(AbortSignal),
    )

    ask('And avergonzada?')
    await waitFor(() => expect(within(thread).getAllByRole('listitem')).toHaveLength(4))
    expect(askFollowUp.mock.calls[1][2]).toHaveLength(3)
    expect(screen.getByTestId('ai-ask-input')).toHaveValue('')
  })

  it('opens the chat after an AI Insight and sends the Insight along', async () => {
    explainWrongAnswer.mockResolvedValue('Embarazada means pregnant, not embarrassed.')
    askFollowUp.mockResolvedValue('Yes.')
    render(<AiInsight question={question} />)
    fireEvent.click(screen.getByTestId('ai-insight'))
    expect(await screen.findByText('Embarazada means pregnant, not embarrassed.')).toBeInTheDocument()
    ask('So it is a false friend?')
    await waitFor(() => expect(askFollowUp).toHaveBeenCalled())
    expect(askFollowUp.mock.calls[0][1]).toBe('Embarazada means pregnant, not embarrassed.')
  })

  it('ignores empty questions', () => {
    render(<AiInsight question={question} />)
    fireEvent.click(screen.getByTestId('ai-ask'))
    ask('   ')
    expect(askFollowUp).not.toHaveBeenCalled()
  })
})

describe('AiInsight: after a correct answer', () => {
  it('offers only Ask AI', () => {
    render(<AiInsight question={question} askOnly />)
    expect(screen.queryByTestId('ai-insight')).toBeNull()
    expect(screen.getByTestId('ai-ask')).toBeInTheDocument()
  })

  it('can open straight into the chat, focused', () => {
    render(<AiInsight question={question} askOnly startInChat />)
    expect(screen.getByTestId('ai-ask-input')).toHaveFocus()
    expect(screen.queryByText('Explain my mistake')).toBeNull()
  })
})
