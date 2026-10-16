import type { ReactNode } from 'react'
import { Blocks, Brain, ClipboardCheck, Layers, LayoutGrid, Rocket } from '../../components/icons'
import type { ActivityKind } from '../../types'

export const ACTIVITIES: Record<ActivityKind, { label: string; icon: ReactNode; minCards: number; description: string }> = {
  flashcards: { label: 'Flashcards', icon: <Layers size={20} />, minCards: 1, description: 'Flip, sort and review' },
  learn: { label: 'Learn', icon: <Brain size={20} />, minCards: 2, description: 'Adaptive questions to mastery' },
  test: { label: 'Test', icon: <ClipboardCheck size={20} />, minCards: 2, description: 'Practice exam' },
  match: { label: 'Match', icon: <LayoutGrid size={20} />, minCards: 2, description: 'Race the clock' },
  blocks: { label: 'Blocks', icon: <Blocks size={20} />, minCards: 6, description: 'Puzzle + questions' },
  blast: { label: 'Blast', icon: <Rocket size={20} />, minCards: 6, description: 'Arcade answers' },
}

export const ACTIVITY_ORDER: ActivityKind[] = ['flashcards', 'learn', 'test', 'match', 'blocks', 'blast']
