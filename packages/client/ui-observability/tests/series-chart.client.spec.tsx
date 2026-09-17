// @vitest-environment jsdom
/** The bucketed bar chart: bars over the axis, the empty copy, and the exact table. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SeriesChart } from '../src/client/charts/SeriesChart.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

const BARS = [
  { key: '0', label: '0ms', value: 2 },
  { key: '1', label: '5s', value: 6 },
]

describe('SeriesChart', () => {
  it('plots one bar per bucket and shows the value range', () => {
    const { container } = render(
      <SeriesChart title="Tool calls" valueLabel="Tool calls" bars={BARS} emptyLabel="none" t={t} />,
    )
    expect(container.querySelectorAll('rect')).toHaveLength(2)
    expect(screen.getByText('6')).toBeTruthy()
    expect(screen.getByText('0ms')).toBeTruthy()
    expect(screen.getByText('5s')).toBeTruthy()
  })

  it('shows the empty copy and no chart without buckets', () => {
    const { container } = render(
      <SeriesChart title="Tool calls" valueLabel="Tool calls" bars={[]} emptyLabel="no activity" t={t} />,
    )
    expect(screen.getByText('no activity')).toBeTruthy()
    expect(container.querySelectorAll('rect')).toHaveLength(0)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reveals the exact values in a table and hides them again', () => {
    render(
      <SeriesChart
        title="Tool calls"
        valueLabel="Tool calls"
        bars={BARS}
        emptyLabel="none"
        formatValue={value => `#${value}`}
        t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['table.show'] }))
    const table = screen.getByRole('table')
    // The axis label repeats the maximum, so the exact value is read in the table.
    expect(within(table).getByText('#6')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['table.hide'] }))
    expect(screen.queryByRole('table')).toBeNull()
  })
})
