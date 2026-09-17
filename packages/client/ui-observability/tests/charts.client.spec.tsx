// @vitest-environment jsdom
/** Chart primitives: legend, table fallback, and empty behavior. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { Pie } from '../src/client/charts/Pie.tsx'
import { Trendline } from '../src/client/charts/Trendline.tsx'
import { StatTile } from '../src/client/charts/StatTile.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

describe('Pie', () => {
  it('renders a legend and an exact-value table on demand', () => {
    const { container } = render(
      <Pie
        title="tokens"
        emptyLabel="none"
        t={t}
        slices={[
          { key: 'in', label: 'Input', value: 30, tone: 'input' },
          { key: 'out', label: 'Output', value: 10, tone: 'output' },
        ]}
      />,
    )
    expect(container.querySelectorAll('circle[data-tone]')).toHaveLength(2)
    expect(screen.getByText('75.0%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['table.show'] }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('Input')).toBeTruthy()
  })

  it('shows the empty copy when every slice is zero', () => {
    render(
      <Pie
        title="tokens"
        emptyLabel="nothing here"
        t={t}
        slices={[{ key: 'in', label: 'Input', value: 0, tone: 'input' }]}
      />,
    )
    expect(screen.getByText('nothing here')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('Trendline', () => {
  it('plots a polyline and exposes the series as a table', () => {
    const { container } = render(
      <Trendline
        title="trend"
        valueLabel="tokens"
        t={t}
        emptyLabel="none"
        points={[
          { key: 'a', label: 'A', x: 1, y: 10 },
          { key: 'b', label: 'B', x: 2, y: 20 },
        ]}
      />,
    )
    expect(container.querySelector('polyline')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: zh['table.show'] }))
    const table = screen.getByRole('table')
    expect(within(table).getByText('A')).toBeTruthy()
    expect(within(table).getByText('20')).toBeTruthy()
  })

  it('shows the empty copy with no points', () => {
    render(
      <Trendline title="trend" valueLabel="tokens" t={t} emptyLabel="nothing here" points={[]} />,
    )
    expect(screen.getByText('nothing here')).toBeTruthy()
  })

  it('places a single point at the horizontal center', () => {
    const { container } = render(
      <Trendline
        title="trend"
        valueLabel="tokens"
        t={t}
        emptyLabel="none"
        points={[{ key: 'a', label: 'A', x: 5, y: 0 }]}
      />,
    )
    expect(container.querySelector('circle')?.getAttribute('cx')).toBe('160')
  })
})

describe('StatTile', () => {
  it('renders the hint only when one is provided', () => {
    const { rerender } = render(<StatTile label="TTFT" value="1.2 s" hint="detail" />)
    expect(screen.getByText('detail')).toBeTruthy()
    rerender(<StatTile label="TTFT" value="1.2 s" />)
    expect(screen.queryByText('detail')).toBeNull()
  })
})
