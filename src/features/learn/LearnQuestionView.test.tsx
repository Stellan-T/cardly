import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LearnQuestion } from '../../lib/learn'
import type { Card } from '../../types'
import { LearnQuestionView } from './LearnQuestionView'

// The AI helpers need auth and the study-set context; they're covered on their own.
vi.mock('../study/AiInsight', () => ({ AiHint: () => null, AiInsight: () => null }))
vi.mock('../../components/StudyButtons', () => ({ AudioButton: () => null, CardImage: () => null, StarButton: () => null }))

const card = (id: string, term: string, definition: string): Card => ({ id, term, definition, order: 0, starred: false })
const asked = card('c1', 'Digital-physical tensions', 'Combining digital and physical parts creates tensions')
const other = card('c2', 'Socio-technical perspective', 'Technology and society shape each other')

function setupTf(isTrue: boolean) {
  const question: LearnQuestion = {
    qid: 1,
    cardId: asked.id,
    type: 'tf',
    answerSide: 'term',
    shown: isTrue ? { cardId: asked.id, text: asked.term } : { cardId: other.id, text: other.term },
    isTrue,
  }
  return renderView(question, asked)
}

function renderView(question: LearnQuestion, asked: Card, level: 'strict' | 'moderate' | 'relaxed' = 'moderate') {
  const onDone = vi.fn()
  render(
    <LearnQuestionView
      question={question}
      card={asked}
      pool={[asked, other]}
      grading={{ level, requireOne: false }}
      retype={false}
      imageSource={{ ownerUid: 'u1' }}
      langOf={() => 'en'}
      voiceOf={() => undefined}
      say={() => {}}
      autoAudio={false}
      onToggleStar={() => {}}
      onDone={onDone}
      onFeedback={() => {}}
    />,
  )
  return { onDone }
}

describe('LearnQuestionView true/false feedback', () => {
  it('explains a false pairing both ways after a correct "False"', () => {
    const { onDone } = setupTf(false)
    fireEvent.click(screen.getByRole('button', { name: /False/ }))
    const box = screen.getByRole('status')
    expect(box).toHaveTextContent('Correct! These don’t match.')
    expect(within(box).getByText('The term for this definition').nextSibling).toHaveTextContent('Digital-physical tensions')
    expect(within(box).getByTestId('learn-meaning')).toHaveTextContent('“Socio-technical perspective” means')
    expect(within(box).getByTestId('learn-meaning')).toHaveTextContent('Technology and society shape each other')
    fireEvent.click(within(box).getByTestId('learn-continue'))
    expect(onDone).toHaveBeenCalledWith({ correct: true, firstTry: true })
  })

  it('shows the same explanation, without "Your answer: True", after a wrong "True"', () => {
    setupTf(false)
    fireEvent.click(screen.getByRole('button', { name: /True/ }))
    const box = screen.getByRole('alert')
    expect(box).toHaveTextContent('Not quite — these don’t match.')
    expect(box).not.toHaveTextContent('Your answer')
    expect(within(box).getByText('The term for this definition').nextSibling).toHaveTextContent('Digital-physical tensions')
    expect(within(box).getByTestId('learn-meaning')).toHaveTextContent('Technology and society shape each other')
  })

  it('names the right term after a wrong "False" on a true pairing', () => {
    setupTf(true)
    fireEvent.click(screen.getByRole('button', { name: /False/ }))
    const box = screen.getByRole('alert')
    expect(box).toHaveTextContent('Not quite — these do match.')
    expect(box).toHaveTextContent('The right term')
    expect(box).toHaveTextContent('Digital-physical tensions')
  })
})

describe('LearnQuestionView near-miss written answers', () => {
  afterEach(() => vi.useRealTimers())

  const written = (answer: string, level: 'moderate' | 'relaxed' = 'moderate') => {
    vi.useFakeTimers()
    const card = { ...asked, term: answer }
    const view = renderView({ qid: 2, cardId: card.id, type: 'written', answerSide: 'term' }, card, level)
    return { ...view, type: (text: string) => {
      fireEvent.change(screen.getByTestId('learn-input'), { target: { value: text } })
      fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
    } }
  }

  it('counts a typo as correct but waits, showing the exact wording', () => {
    const { type, onDone } = written('photosynthesis')
    type('fotosynthesis')
    const box = screen.getByTestId('learn-near-miss')
    expect(box).toHaveTextContent('Mind the spelling')
    expect(within(box).getByText('Exact wording').nextSibling).toHaveTextContent('photosynthesis')
    act(() => vi.advanceTimersByTime(5000))
    expect(onDone).not.toHaveBeenCalled()
    fireEvent.click(within(box).getByTestId('learn-continue'))
    expect(onDone).toHaveBeenCalledWith({ correct: true, firstTry: true })
  })

  it('also waits when only the accents differ', () => {
    written('café').type('cafe')
    expect(screen.getByTestId('learn-near-miss')).toHaveTextContent('Mind the accents')
  })

  it('also waits when the key words are right but rearranged (relaxed grading)', () => {
    written('the making of glucose', 'relaxed').type('glucose making')
    const box = screen.getByTestId('learn-near-miss')
    expect(box).toHaveTextContent('The exact wording is a little different.')
    expect(within(box).getByText('Your answer').nextSibling).toHaveTextContent('glucose making')
  })

  it('still moves on by itself after an exact answer', () => {
    const { type, onDone } = written('photosynthesis')
    type('Photosynthesis')
    expect(screen.queryByTestId('learn-near-miss')).toBeNull()
    act(() => vi.advanceTimersByTime(1000))
    expect(onDone).toHaveBeenCalledWith({ correct: true, firstTry: true })
  })
})
