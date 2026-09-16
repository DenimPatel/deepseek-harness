// @vitest-environment jsdom
/** Cross-session history: the trendline plus the sortable exact-figure table. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { HistoryPanel } from '../src/client/HistoryPanel.tsx'
import type { HistoryRow } from '../src/client/observability-model.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

const ROWS: readonly HistoryRow[] = [
  { id: 'a' as HistoryRow['id'], label: 'Alpha', updatedAt: 2, tokens: 10, subagentCount: 0 },
  { id: 'b' as HistoryRow['id'], label: 'Beta', updatedAt: 1, tokens: 30, durationMs: 5000, subagentCount: 2 },
]

function rowOrder(): (string | null)[] {
  return screen.getAllByRole('rowheader').map(cell => cell.textContent)
}

describe('HistoryPanel', () => {
  it('shows the empty copy with no rows', () => {
    render(<HistoryPanel rows={[]} t={t} />)
    expect(screen.getByText(zh['empty.history'])).toBeTruthy()
  })

  it('lists rows newest-first and sorts by tokens on demand', () => {
    render(<HistoryPanel rows={ROWS} t={t} />)
    expect(rowOrder()).toEqual(['Alpha', 'Beta'])
    expect(screen.getByText('5.0 秒')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: zh['history.col.tokens'] }))
    expect(rowOrder()).toEqual(['Beta', 'Alpha'])
    fireEvent.click(screen.getByRole('button', { name: zh['history.col.tokens'] }))
    expect(rowOrder()).toEqual(['Alpha', 'Beta'])
  })

  it('falls back to the unknown value for rows without a duration', () => {
    render(<HistoryPanel rows={ROWS} t={t} />)
    expect(screen.getAllByText(zh['value.none']).length).toBeGreaterThan(0)
  })
})
