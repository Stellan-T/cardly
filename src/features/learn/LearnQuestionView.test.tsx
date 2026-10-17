import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LearnQuestion } from '../../lib/learn'
import type { Card } from '../../types'
import { LearnQuestionView } from './LearnQuestionView'

// The AI helpers need auth and the study-set context; they're covered on their own.
vi.mock('../study/AiInsight', () => ({ AiHint: () => null, AiInsight: () => null }))
vi.mock('../../components/StudyButtons', () => ({ AudioButton: () => null, CardImage: () => null, StarButton: () => null }))

const card = (id: string, term: string, definition: string): Card => ({ id, term, definition, order: 0, starred: false })
const asked = card('c1', 'Digital-physical tensions', 'Combining digital and physical parts creates tensions')
const other = card('c2', 'Socio-technical perspective', 'Technology and society shape each other')

function setup(isTrue: boolean) {
  const question: LearnQuestion = {
    qid: 1,
    cardId: asked.id,
    type: 'tf',
    answerSide: 'term',
    shown: isTrue ? { cardId: asked.id, text: asked.term } : { cardId: other.id, text: other.term },
    isTrue,
  }
  const onDone = vi.fn()
  render(
    <LearnQuestionView
      question={question}
      card={asked}
      pool={[asked, other]}
      grading={{ level: 'moderate', requireOne: false }}
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
    const { onDone } = setup(false)
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
    setup(false)
    fireEvent.click(screen.getByRole('button', { name: /True/ }))
    const box = screen.getByRole('alert')
    expect(box).toHaveTextContent('Not quite — these don’t match.')
    expect(box).not.toHaveTextContent('Your answer')
    expect(within(box).getByText('The term for this definition').nextSibling).toHaveTextContent('Digital-physical tensions')
    expect(within(box).getByTestId('learn-meaning')).toHaveTextContent('Technology and society shape each other')
  })

  it('names the right term after a wrong "False" on a true pairing', () => {
    setup(true)
    fireEvent.click(screen.getByRole('button', { name: /False/ }))
    const box = screen.getByRole('alert')
    expect(box).toHaveTextContent('Not quite — these do match.')
    expect(box).toHaveTextContent('The right term')
    expect(box).toHaveTextContent('Digital-physical tensions')
  })
})
