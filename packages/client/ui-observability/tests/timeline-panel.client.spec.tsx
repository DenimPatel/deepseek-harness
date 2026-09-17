// @vitest-environment jsdom
/** The Timeline view: metric and aggregation controls over the durable histogram. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ActivityMetricId, ActivitySeriesProjection } from '@deepseek-ai/dsh-session-stats/client'
import { TimelinePanel } from '../src/client/TimelinePanel.tsx'
import { ACTIVITY_METRICS } from '../src/client/activity-model.ts'
import { formatDuration } from '../src/client/format.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

/** One projected histogram with every column present. */
function histogram(
  columns: Partial<Record<ActivityMetricId, readonly number[]>>,
  options: { readonly originMs?: number | null; readonly bucketMs?: number } = {},
): ActivitySeriesProjection {
  return {
    originMs: options.originMs === undefined ? 0 : options.originMs,
    bucketMs: options.bucketMs ?? 5_000,
    series: Object.fromEntries(
      ACTIVITY_METRICS.map(metric => [metric.id, [...(columns[metric.id] ?? [])]]),
    ) as unknown as ActivitySeriesProjection['series'],
  }
}

describe('TimelinePanel', () => {
  it('shows the empty copy when no unit is mounted', () => {
    render(<TimelinePanel series={undefined} t={t} />)
    expect(screen.getByText(zh['timeline.empty'])).toBeTruthy()
  })

  it('shows the empty copy when the session recorded no activity', () => {
    render(<TimelinePanel series={histogram({ toolCalls: [0, 0] })} t={t} />)
    expect(screen.getByText(zh['timeline.empty'])).toBeTruthy()
  })

  it('plots the default metric with every metric offered and their totals', () => {
    render(<TimelinePanel series={histogram({
      toolCalls: [1, 2],
      toolErrors: [0, 1],
      contextTokens: [300, 700],
    })} t={t} />)
    // Both selects offer the whole metric set and the aggregation factors.
    expect(screen.getAllByRole('option')).toHaveLength(ACTIVITY_METRICS.length + 4)
    const totals = screen.getByRole('table')
    expect(within(totals).getByText(zh['activity.toolCalls'])).toBeTruthy()
    expect(within(totals).getByText('3')).toBeTruthy()
    expect(within(totals).getByText(zh['activity.contextTokens'])).toBeTruthy()
  })

  it('switches the plotted metric and the display aggregation', () => {
    const { container } = render(<TimelinePanel series={histogram({ toolCalls: [1, 1, 1, 1] })} t={t} />)
    expect(container.querySelectorAll('rect')).toHaveLength(4)
    fireEvent.change(screen.getByLabelText(zh['timeline.aggregate']), { target: { value: '2' } })
    expect(container.querySelectorAll('rect')).toHaveLength(2)
    fireEvent.change(screen.getByLabelText(zh['timeline.metric']), { target: { value: 'contextTokens' } })
    // The metric title follows the selection; the summary keeps the new width.
    expect(screen.getAllByText(zh['activity.contextTokens']).length).toBeGreaterThan(1)
    expect(screen.getByText(t('timeline.summary', {
      bucket: formatDuration(10_000, t),
      count: '2',
      span: formatDuration(20_000, t),
    }))).toBeTruthy()
  })
})
