import { Segmented, Switch } from '../../components/controls'
import { GRADING_LEVEL_INFO } from '../../lib/grade'
import type { AnswerWith, GradingLevel } from '../../types'
import { useGrading, useHasStarred } from './hooks'

export function AnswerWithOption({ value, onChange, allowBoth = true, label = 'Answer with' }: {
  value: AnswerWith
  onChange: (v: AnswerWith) => void
  allowBoth?: boolean
  label?: string
}) {
  return (
    <div className="option-row">
      <span>{label}</span>
      <Segmented
        label={label}
        value={value}
        onChange={onChange}
        options={[
          { value: 'term', label: 'Term' },
          { value: 'definition', label: 'Definition' },
          ...(allowBoth ? [{ value: 'both' as const, label: 'Both' }] : []),
        ]}
      />
    </div>
  )
}

export function StarredOnlyOption({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const hasStarred = useHasStarred()
  return (
    <Switch
      label="Study only starred terms"
      checked={value && hasStarred}
      disabled={!hasStarred}
      onChange={onChange}
      hint={hasStarred ? undefined : 'Star some terms first (☆ on a card or in the terms list).'}
    />
  )
}

/** Grading level + "Require 1 answer only" (shared by Learn and Test for this set). */
export function GradingOptions() {
  const { level, isAuto, autoLevel, setLevel, requireOne, setRequireOne } = useGrading()
  return (
    <>
      <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
        <span>Grading</span>
        <Segmented<GradingLevel | 'auto'>
          label="Grading level"
          value={isAuto ? 'auto' : level}
          onChange={(v) => setLevel(v === 'auto' ? null : v)}
          options={[
            { value: 'auto', label: `Auto (${GRADING_LEVEL_INFO[autoLevel].label})` },
            { value: 'strict', label: 'Strict' },
            { value: 'moderate', label: 'Moderate' },
            { value: 'relaxed', label: 'Relaxed' },
          ]}
        />
        <span className="hint">{GRADING_LEVEL_INFO[level].description}</span>
      </div>
      <Switch
        label="Require 1 answer only"
        checked={requireOne}
        onChange={setRequireOne}
        hint="When an answer lists several options (separated by , / or ;), any one of them counts as correct."
      />
    </>
  )
}
