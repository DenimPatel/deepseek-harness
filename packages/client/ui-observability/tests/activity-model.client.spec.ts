/**
 * Timeline view-model folds: the metric table, bucket plotting, display
 * aggregation, and gauge handling over a projected `activitySeries` value.
 */
import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ActivityMetricId, ActivitySeriesProjection } from '@deepseek-ai/dsh-session-stats/client'
import {
  ACTIVITY_AGGREGATE_FACTORS,
  ACTIVITY_METRICS,
  ACTIVITY_METRIC_BY_ID,
  DEFAULT_ACTIVITY_METRIC,
  activityBuckets,
  activitySpanMs,
  activityTotal,
  coarsenColumn,
  formatActivityValue,
  hasActivity,
  isGaugeMetric,
} from '../src/client/activity-model.ts'
import { formatDuration } from '../src/client/format.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

/** One projected histogram with every column present. */
function histogram(
  columns: Partial<Record<ActivityMetricId, readonly number[]>> = {},
  options: { readonly originMs?: number | null; readonly bucketMs?: number } = {},
): ActivitySeriesProjection {
  return {
    originMs: options.originMs === undefined ? 0 : options.originMs,
    bucketMs: options.bucketMs ?? 1_000,
    series: Object.fromEntries(
      ACTIVITY_METRICS.map(metric => [metric.id, [...(columns[metric.id] ?? [])]]),
    ) as unknown as ActivitySeriesProjection['series'],
  }
}

describe('activity metric table', () => {
  it('resolves every offered metric by id and opens on the default', () => {
    expect(ACTIVITY_METRICS.map(metric => metric.id)).toHaveLength(13)
    for (const metric of ACTIVITY_METRICS) expect(ACTIVITY_METRIC_BY_ID[metric.id]).toBe(metric)
    expect(ACTIVITY_METRIC_BY_ID[DEFAULT_ACTIVITY_METRIC].label).toBe('activity.toolCalls')
    expect(ACTIVITY_AGGREGATE_FACTORS).toEqual([1, 2, 4, 8])
  })

  it('treats only the context reading as a gauge', () => {
    expect(isGaugeMetric('contextTokens')).toBe(true)
    expect(isGaugeMetric('toolCalls')).toBe(false)
  })
})

describe('hasActivity', () => {
  it('reports absence for an unmounted capability, an unanchored grid, and all-zero columns', () => {
    expect(hasActivity(undefined)).toBe(false)
    expect(hasActivity(histogram({ toolCalls: [3] }, { originMs: null }))).toBe(false)
    expect(hasActivity(histogram({ toolCalls: [0, 0] }))).toBe(false)
  })

  it('reports activity once any column holds a reading', () => {
    expect(hasActivity(histogram({ toolCalls: [0, 2] }))).toBe(true)
  })
})

describe('coarsenColumn', () => {
  it('copies the column unchanged at factor one', () => {
    const column = [1, 2, 3]
    const merged = coarsenColumn(column, 1, false)
    expect(merged).toEqual([1, 2, 3])
    expect(merged).not.toBe(column)
  })

  it('adds counts and sums across merged buckets, including a short tail', () => {
    expect(coarsenColumn([1, 2, 3, 4, 5], 2, false)).toEqual([3, 7, 5])
    expect(coarsenColumn([1, 1, 1], 4, false)).toEqual([3])
  })

  it('keeps the later non-zero gauge reading across merged buckets', () => {
    expect(coarsenColumn([5, 7, 0, 0], 2, true)).toEqual([7, 0])
    expect(coarsenColumn([0, 0, 9], 4, true)).toEqual([9])
    expect(coarsenColumn([4, 0], 1, true)).toEqual([4, 0])
  })
})

describe('activityBuckets', () => {
  it('plots nothing before the grid is anchored', () => {
    expect(activityBuckets(histogram({ toolCalls: [1] }, { originMs: null }), 'toolCalls', 1, t)).toEqual([])
  })

  it('labels each bucket by its offset from the first counted event', () => {
    const buckets = activityBuckets(histogram({ toolCalls: [1, 0, 3] }, { bucketMs: 1_000 }), 'toolCalls', 1, t)
    expect(buckets.map(bucket => bucket.value)).toEqual([1, 0, 3])
    expect(buckets.map(bucket => bucket.start)).toEqual([0, 1_000, 2_000])
    expect(buckets[0]?.label).toBe(formatDuration(0, t))
    expect(buckets[2]?.label).toBe(formatDuration(2_000, t))
  })

  it('merges buckets and widens the labeled step by the aggregation factor', () => {
    const buckets = activityBuckets(
      histogram({ toolCalls: [1, 1, 1, 1] }, { bucketMs: 1_000 }),
      'toolCalls',
      2,
      t,
    )
    expect(buckets.map(bucket => bucket.value)).toEqual([2, 2])
    expect(buckets.map(bucket => bucket.start)).toEqual([0, 2_000])
    expect(buckets[1]?.label).toBe(formatDuration(2_000, t))
  })
})

describe('activityTotal', () => {
  it('is zero before the grid is anchored', () => {
    expect(activityTotal(histogram({ toolCalls: [4] }, { originMs: null }), 'toolCalls', 1)).toBe(0)
  })

  it('sums additive columns and reports the latest gauge reading', () => {
    expect(activityTotal(histogram({ toolCalls: [1, 2, 4] }), 'toolCalls', 1)).toBe(7)
    expect(activityTotal(histogram({ toolCalls: [1, 2, 4] }), 'toolCalls', 2)).toBe(7)
    expect(activityTotal(histogram({ contextTokens: [8, 0, 12] }), 'contextTokens', 1)).toBe(12)
  })
})

describe('activitySpanMs', () => {
  it('covers the rendered buckets at the display width, and zero without buckets', () => {
    expect(activitySpanMs(histogram({ toolCalls: [1, 1, 1] }, { bucketMs: 1_000 }), 1)).toBe(3_000)
    expect(activitySpanMs(histogram({ toolCalls: [1, 1, 1] }, { bucketMs: 1_000 }), 2)).toBe(4_000)
    expect(activitySpanMs(histogram(), 1)).toBe(0)
  })
})

describe('formatActivityValue', () => {
  it('scales token figures and rounds counts', () => {
    expect(formatActivityValue(1_500, 'tokens', t)).toBe(t('tokens.thousand', { value: '1.5' }))
    expect(formatActivityValue(3.4, 'count', t)).toBe('3')
  })
})
