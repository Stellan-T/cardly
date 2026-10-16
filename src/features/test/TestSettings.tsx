/** Test options: persisted per set, shown on the setup screen and in the Options sheet. */
import { useEffect, useId, useState } from 'react'
import { Switch } from '../../components/controls'
import { QUESTION_TYPE_LABELS } from '../../lib/questions'
import { TEST_QUESTION_TYPES, type TestQuestionType } from '../../lib/testGen'
import type { AnswerWith } from '../../types'
import { AnswerWithOption, GradingOptions, StarredOnlyOption } from '../study/CommonOptions'
import { OptionGroup } from '../study/StudyLayout'
import styles from './TestPage.module.css'

export interface TestModeOptions {
  /** Requested number of questions; clamped to the available terms when used. */
  count: number
  answerWith: AnswerWith
  types: TestQuestionType[]
  starredOnly: boolean
}

export const TEST_DEFAULTS: TestModeOptions = {
  count: 20,
  answerWith: 'term',
  types: [...TEST_QUESTION_TYPES],
  starredOnly: false,
}

const ANSWER_WITH: readonly AnswerWith[] = ['term', 'definition', 'both']

/** Repairs options read from the session doc (older shapes, bad values). */
export function normalizeOptions(o: TestModeOptions): TestModeOptions {
  const types = Array.isArray(o.types) ? TEST_QUESTION_TYPES.filter((t) => o.types.includes(t)) : []
  return {
    count: typeof o.count === 'number' && Number.isFinite(o.count) && o.count >= 1 ? Math.floor(o.count) : TEST_DEFAULTS.count,
    answerWith: ANSWER_WITH.includes(o.answerWith) ? o.answerWith : TEST_DEFAULTS.answerWith,
    types: types.length ? types : [...TEST_QUESTION_TYPES],
    starredOnly: o.starredOnly === true,
  }
}

export const clampCount = (count: number, available: number) => Math.max(1, Math.min(count, Math.max(1, available)))

export function TestSettingsForm({
  options,
  onChange,
  available,
  note,
}: {
  options: TestModeOptions
  onChange: (patch: Partial<TestModeOptions>) => void
  /** Terms available with the current filters. */
  available: number
  note?: string
}) {
  const toggleType = (type: TestQuestionType, on: boolean) => {
    const next = TEST_QUESTION_TYPES.filter((t) => (t === type ? on : options.types.includes(t)))
    if (next.length) onChange({ types: next })
  }
  const onlyOne = options.types.length === 1
  return (
    <>
      {note && <div className="alert alert-info">{note}</div>}
      <OptionGroup title="Questions">
        <CountField value={clampCount(options.count, available)} max={Math.max(1, available)} onChange={(count) => onChange({ count })} />
      </OptionGroup>
      <OptionGroup title="Question types">
        {TEST_QUESTION_TYPES.map((t) => {
          const on = options.types.includes(t)
          return (
            <Switch
              key={t}
              label={QUESTION_TYPE_LABELS[t]}
              checked={on}
              disabled={on && onlyOne}
              onChange={(v) => toggleType(t, v)}
            />
          )
        })}
        {onlyOne && <span className="hint">At least one question type has to stay on.</span>}
      </OptionGroup>
      <OptionGroup title="Terms">
        <AnswerWithOption value={options.answerWith} onChange={(answerWith) => onChange({ answerWith })} />
        <StarredOnlyOption value={options.starredOnly} onChange={(starredOnly) => onChange({ starredOnly })} />
      </OptionGroup>
      <OptionGroup title="Written answers">
        <GradingOptions />
      </OptionGroup>
    </>
  )
}

/** Slider + number input, 1 → max. */
function CountField({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const id = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])
  const commit = (raw: string) => {
    const n = Math.floor(Number(raw))
    if (Number.isFinite(n) && raw.trim() !== '') onChange(Math.max(1, Math.min(max, n)))
    else setDraft(String(value))
  }
  return (
    <div className="stack" style={{ '--gap': '6px' } as React.CSSProperties}>
      <label htmlFor={`${id}-n`}>
        Number of questions <span className="subtle">(max {max})</span>
      </label>
      <div className={styles.countRow}>
        <input
          type="range"
          min={1}
          max={max}
          step={1}
          value={value}
          disabled={max <= 1}
          aria-label="Number of questions"
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          id={`${id}-n`}
          className={`input ${styles.countInput}`}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= max) onChange(n)
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit(e.currentTarget.value)
          }}
        />
      </div>
    </div>
  )
}
