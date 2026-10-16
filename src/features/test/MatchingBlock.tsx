/**
 * One matching block: up to 6 prompts and a lettered answer bank. Answers can be
 * assigned with the letter select (keyboard / screen readers), by dragging a
 * chip onto a prompt (pointer events: mouse, touch and pen), or by tapping a
 * chip and then a prompt. Each letter is used once per block.
 */
import { memo, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { GripVertical } from '../../components/icons'
import { otherSide } from '../../lib/questions'
import type { MatchingBlock, MatchingOption, MatchingTestQuestion, TestAnswers } from '../../lib/testGen'
import { useSpeech } from '../study/hooks'
import { cx, langAttr, Prompt, PromptAudio, questionDomId, type AnswerPatch, type CardLookup, type QuestionKeyHandler } from './TestQuestions'
import styles from './TestPage.module.css'

interface DragState {
  letter: string
  text: string
  x: number
  y: number
}

/** Pixels the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD = 6
/** Distance from the viewport edges where dragging scrolls the page (the top one clears the sticky header). */
const SCROLL_EDGE_TOP = 112
const SCROLL_EDGE_BOTTOM = 72

export const MatchingBlockView = memo(function MatchingBlockView({
  block,
  total,
  answers,
  cards,
  onAnswer,
  onKeyDown,
}: {
  block: MatchingBlock
  total: number
  answers: TestAnswers
  cards: CardLookup
  onAnswer: (patch: AnswerPatch) => void
  onKeyDown: QuestionKeyHandler
}) {
  const { langOf } = useSpeech()
  const [picked, setPicked] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const press = useRef<{ option: MatchingOption; pointerId: number; x0: number; y0: number; active: boolean } | null>(null)
  /** The click that follows a drop on the dragged chip must not also "pick" it. */
  const suppressClick = useRef<{ letter: string; until: number } | null>(null)

  const qids = useMemo(() => new Set(block.questions.map((q) => q.id)), [block])
  const usedBy = useMemo(() => {
    const map = new Map<string, number>()
    for (const q of block.questions) {
      const a = answers[q.id]
      if (typeof a === 'string') map.set(a, q.number)
    }
    return map
  }, [block, answers])

  const answerLang = langAttr(langOf(block.answerSide))
  const first = block.questions[0]?.number
  const last = block.questions[block.questions.length - 1]?.number

  /** Assigns a letter to a prompt, taking it away from any other prompt in this block. */
  const assign = (qid: string, letter: string | undefined) => {
    const patch: AnswerPatch = { [qid]: letter }
    if (letter) for (const q of block.questions) if (q.id !== qid && answers[q.id] === letter) patch[q.id] = undefined
    onAnswer(patch)
  }

  const dropTargetAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-qid]')
    const qid = el?.dataset.dropQid
    return qid && qids.has(qid) ? qid : null
  }

  const onPointerDown = (e: PointerEvent<HTMLLIElement>, option: MatchingOption) => {
    if (e.button !== 0) return
    // On touch screens only the handle drags, so the rest of the chip still scrolls the page.
    if (e.pointerType !== 'mouse' && !(e.target as Element).closest('[data-drag-handle]')) return
    press.current = { option, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLLIElement>) => {
    const p = press.current
    if (!p || p.pointerId !== e.pointerId) return
    if (!p.active) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < DRAG_THRESHOLD) return
      p.active = true
      setPicked(null)
    }
    e.preventDefault()
    setDrag({ letter: p.option.letter, text: p.option.text, x: e.clientX, y: e.clientY })
    const target = dropTargetAt(e.clientX, e.clientY)
    setOver((prev) => (prev === target ? prev : target))
    if (e.clientY < SCROLL_EDGE_TOP) window.scrollBy(0, -12)
    else if (e.clientY > window.innerHeight - SCROLL_EDGE_BOTTOM) window.scrollBy(0, 12)
  }

  const endPress = (e: PointerEvent<HTMLLIElement>, drop: boolean) => {
    const p = press.current
    if (!p || p.pointerId !== e.pointerId) return
    press.current = null
    if (!p.active) return
    suppressClick.current = { letter: p.option.letter, until: performance.now() + 400 }
    const target = drop ? dropTargetAt(e.clientX, e.clientY) : null
    if (target) assign(target, p.option.letter)
    setDrag(null)
    setOver(null)
  }

  const onChipClick = (letter: string) => {
    const suppress = suppressClick.current
    suppressClick.current = null
    if (suppress?.letter === letter && performance.now() < suppress.until) return
    setPicked((cur) => (cur === letter ? null : letter))
  }

  const onRowClick = (e: MouseEvent<HTMLElement>, q: MatchingTestQuestion) => {
    if (!picked || (e.target as Element).closest('select, button')) return
    assign(q.id, picked)
    setPicked(null)
  }

  return (
    <div
      className={styles.matchBlock}
      role="group"
      aria-label={first === last ? `Matching question ${first}` : `Matching questions ${first}–${last}`}
    >
      <div className={styles.bankWrap}>
        <h3 className={styles.legend} id={`${block.id}-bank`}>
          Answers
        </h3>
        <ol className={styles.bank} aria-labelledby={`${block.id}-bank`}>
          {block.options.map((o) => {
            const used = usedBy.get(o.letter)
            return (
              <li
                key={o.letter}
                className={cx(
                  styles.chip,
                  picked === o.letter && styles.chipPicked,
                  used !== undefined && styles.chipUsed,
                  drag?.letter === o.letter && styles.chipDragging,
                )}
                onPointerDown={(e) => onPointerDown(e, o)}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endPress(e, true)}
                onPointerCancel={(e) => endPress(e, false)}
                onClick={() => onChipClick(o.letter)}
              >
                <span className={styles.handle} data-drag-handle>
                  <GripVertical size={14} aria-hidden />
                  {o.letter}
                </span>
                <span className={styles.chipText} lang={answerLang}>
                  {o.text}
                </span>
                {used !== undefined && (
                  <span className={styles.usedTag}>
                    <span aria-hidden>→ </span>
                    <span className="sr-only">used for question </span>
                    {used}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </div>

      <div className={styles.matchRows}>
        {block.questions.map((q) => {
          const letter = typeof answers[q.id] === 'string' ? (answers[q.id] as string) : ''
          const chosen = block.options.find((o) => o.letter === letter)
          return (
            <div
              key={q.id}
              id={questionDomId(q.id)}
              data-qid={q.id}
              data-drop-qid={q.id}
              tabIndex={-1}
              className={cx(styles.matchRow, over === q.id && styles.dropOver, picked && styles.dropReady)}
              onKeyDown={(e) => onKeyDown(e, q)}
              onClick={(e) => onRowClick(e, q)}
            >
              <div className={styles.matchHead}>
                <span className={styles.qNum} id={`${q.id}-title`}>
                  <span className="sr-only">Question </span>
                  {q.number}
                  <span className="sr-only"> of {total}</span>
                </span>
                <div className={styles.matchPrompt} id={`${q.id}-prompt`}>
                  <Prompt q={q} card={cards.get(q.cardId)} className={styles.matchPromptText} />
                </div>
                <PromptAudio text={q.prompt} side={otherSide(q.answerSide)} />
              </div>
              <div className={styles.slotRow}>
                <select
                  className={cx('select', styles.letterSelect)}
                  value={letter}
                  aria-labelledby={`${q.id}-title ${q.id}-prompt`}
                  aria-describedby={`${q.id}-slot`}
                  onChange={(e) => assign(q.id, e.target.value || undefined)}
                >
                  <option value="">–</option>
                  {block.options.map((o) => (
                    <option key={o.letter} value={o.letter}>
                      {o.letter}
                    </option>
                  ))}
                </select>
                <div id={`${q.id}-slot`} className={cx(styles.slot, chosen && styles.slotFilled)} lang={chosen ? answerLang : undefined}>
                  {chosen ? (
                    chosen.text
                  ) : (
                    <>
                      <span aria-hidden>{picked ? `Tap to place ${picked} here` : 'Drop an answer here'}</span>
                      <span className="sr-only">No answer yet</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {drag && (
        <div className={styles.ghost} style={{ left: drag.x, top: drag.y }} aria-hidden>
          <span className={styles.handle}>{drag.letter}</span>
          <span className={styles.chipText}>{drag.text}</span>
        </div>
      )}
    </div>
  )
})
