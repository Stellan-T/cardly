import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ImportFlow, type ImportOutput } from './ImportFlow'
import { mergeWithPrevious, removeDuplicates, rowsFromResult, splitRow, swapSides } from './importRows'
import { parseImport } from '../../lib/parseImport'

function setup() {
  const onOutput = vi.fn<(out: ImportOutput, ready: boolean) => void>()
  render(
    <ImportFlow
      showSamples={false}
      renderActions={(out, ready) => {
        onOutput(out, ready)
        return (
          <button type="button" disabled={!ready}>
            Create {out.cards.length}
          </button>
        )
      }}
    />,
  )
  const paste = (text: string) =>
    act(() => {
      fireEvent.change(screen.getByTestId('import-text'), { target: { value: text } })
    })
  return { onOutput, paste }
}

describe('ImportFlow', () => {
  it('shows a live count and preview as notes are pasted', async () => {
    const { paste, onOutput } = setup()
    await paste('Photosynthesis: making glucose\nOsmosis: diffusion of water\nMitosis - cell division')
    expect(await screen.findByTestId('import-count')).toHaveTextContent('3 cards detected')
    expect(screen.getByLabelText('Term 1')).toHaveValue('Photosynthesis')
    expect(screen.getByLabelText('Definition 3')).toHaveValue('cell division')
    expect(screen.getByText(/Detected:/)).toHaveTextContent('Colon (:)')
    const last = onOutput.mock.calls.at(-1)!
    expect(last[1]).toBe(true)
    expect(last[0].cards.map((c) => c.term)).toEqual(['Photosynthesis', 'Osmosis', 'Mitosis'])
  })

  it('swaps terms and definitions and removes duplicates', async () => {
    const { paste } = setup()
    await paste('a: 1\nb: 2\nA: 3')
    expect(await screen.findByText(/Duplicate of card 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Remove duplicates/ }))
    expect(screen.getByTestId('import-count')).toHaveTextContent('2 cards detected')
    fireEvent.click(screen.getByRole('button', { name: /Swap terms and definitions/ }))
    expect(screen.getByLabelText('Term 1')).toHaveValue('1')
  })

  it('filters to rows with problems and lets rows be deleted', async () => {
    const { paste } = setup()
    await paste('cat: gato\nbird: pájaro\ndog:')
    const toggle = await screen.findByRole('button', { name: /Show only rows with problems \(1\)/ })
    fireEvent.click(toggle)
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete card 3' }))
    expect(screen.getByTestId('import-count')).toHaveTextContent('2 cards detected')
  })

  it('switches separators explicitly', async () => {
    const { paste } = setup()
    await paste('a - b: c')
    expect(await screen.findByLabelText('Term 1')).toHaveValue('a - b')
    fireEvent.change(screen.getByLabelText('Between term and definition'), { target: { value: 'dash' } })
    expect(await screen.findByLabelText('Term 1')).toHaveValue('a')
  })
})

describe('import preview row actions', () => {
  it('merges a row into the previous one using its original text', () => {
    const rows = rowsFromResult(parseImport('Formula: see below\nCO2 + H2O - glucose', { termSep: 'colon' }))
    expect(rows).toHaveLength(2)
    const merged = mergeWithPrevious(rows, 1)
    expect(merged).toHaveLength(1)
    expect(merged[0].definition).toBe('see below\nCO2 + H2O - glucose')
  })

  it('splits joined lines back into cards', () => {
    const result = parseImport('Mitosis: division\nMeiosis: gametes', { termSep: 'colon' })
    const rows = mergeWithPrevious(rowsFromResult(result), 1)
    const split = splitRow(rows, 0, result.detected.termSep)
    expect(split.map((r) => [r.term, r.definition])).toEqual([
      ['Mitosis', 'division'],
      ['Meiosis', 'gametes'],
    ])
  })

  it('swaps and dedupes', () => {
    const rows = rowsFromResult(parseImport('a: 1\nA: 2\nb: 3'))
    expect(removeDuplicates(rows).map((r) => r.term)).toEqual(['a', 'b'])
    expect(swapSides(rows)[0]).toMatchObject({ term: '1', definition: 'a' })
  })
})
