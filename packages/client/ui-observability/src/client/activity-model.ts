/**
 * Pure view-model folds for the Timeline view: the metric descriptor table plus
 * the bucketing and coarsening arithmetic the chart and its exact table share.
 * Everything here is a function over an already-projected `activitySeries`
 * value; no I/O, no transport, no session access.
 */

import type { ActivityMetricId, ActivitySeriesProjection } from '@deepseek-ai/dsh-session-stats/client'
import { formatDuration, formatTokens } from './format.ts'
import type { ObservabilityTranslate } from './format.ts'
import type { ObservabilityKey } from './locales.ts'

/** How one metric's samples read: a discrete count, a token sum, or a gauge. */
export type ActivityMetricUnit = 'count' | 'tokens'

/** One Timeline metric: its column id, copy key, and unit. */
export interface ActivityMetric {
  readonly id: ActivityMetricId
  readonly label: ObservabilityKey
  readonly unit: ActivityMetricUnit
}

/**
 * Every metric the Timeline offers, in display order. Adding a metric is one
 * host column plus one row here.
 */
export const ACTIVITY_METRICS: readonly ActivityMetric[] = [
  { id: 'apiRequests', label: 'activity.apiRequests', unit: 'count' },
  { id: 'apiErrors', label: 'activity.apiErrors', unit: 'count' },
  { id: 'retries', label: 'activity.retries', unit: 'count' },
  { id: 'toolCalls', label: 'activity.toolCalls', unit: 'count' },
  { id: 'toolErrors', label: 'activity.toolErrors', unit: 'count' },
  { id: 'subagentSpawns', label: 'activity.subagentSpawns', unit: 'count' },
  { id: 'turnsStarted', label: 'activity.turnsStarted', unit: 'count' },
  { id: 'stepsClosed', label: 'activity.stepsClosed', unit: 'count' },
  { id: 'tokensUncachedInput', label: 'activity.tokensUncachedInput', unit: 'tokens' },
  { id: 'tokensCacheRead', label: 'activity.tokensCacheRead', unit: 'tokens' },
  { id: 'tokensCacheWrite', label: 'activity.tokensCacheWrite', unit: 'tokens' },
  { id: 'tokensOutput', label: 'activity.tokensOutput', unit: 'tokens' },
  { id: 'contextTokens', label: 'activity.contextTokens', unit: 'tokens' },
]

/**
 * Display aggregation factors the Timeline offers over the host buckets. The
 * host already coarsens the stored grid, so these only merge rendered buckets
 * further.
 */
export const ACTIVITY_AGGREGATE_FACTORS: readonly number[] = [1, 2, 4, 8]

/** The metric the Timeline opens on. */
export const DEFAULT_ACTIVITY_METRIC: ActivityMetricId = 'toolCalls'

/**
 * Metric descriptor lookup by column id, exhaustive over the rendered set, so a
 * selected id always resolves without a defensive fallback.
 */
export const ACTIVITY_METRIC_BY_ID: Readonly<Record<ActivityMetricId, ActivityMetric>> =
  Object.fromEntries(ACTIVITY_METRICS.map(metric => [metric.id, metric])) as
    Record<ActivityMetricId, ActivityMetric>

/**
 * Whether one metric holds a latest-reading gauge rather than an additive sum.
 * The host merges gauges by keeping the later non-zero reading (see its
 * `activitySeries` unit); the display merges them the same way so a coarsened
 * chart shows one pressure reading per merged bucket instead of a meaningless
 * total.
 * @param id - the metric column id.
 * @returns `true` for gauge metrics.
 */
export function isGaugeMetric(id: ActivityMetricId): boolean {
  return id === 'contextTokens'
}

/**
 * Whether the series carries any reading at all.
 * @param series - the projected histogram, or `undefined` when the capability is absent.
 * @returns `true` when the grid is anchored and holds a non-zero sample.
 */
export function hasActivity(series: ActivitySeriesProjection | undefined): boolean {
  if (series === undefined || series.originMs === null) return false
  return Object.values(series.series).some(column => column.some(value => value !== 0))
}

/**
 * Merge adjacent buckets by an integer factor.
 * @param column - one metric column at the stored width.
 * @param factor - how many stored buckets each rendered bucket merges.
 * @param gauge - whether the column is a latest-reading gauge.
 * @returns the merged column.
 */
export function coarsenColumn(column: readonly number[], factor: number, gauge: boolean): number[] {
  if (factor <= 1) return [...column]
  const length = Math.ceil(column.length / factor)
  const merged = new Array<number>(length)
  for (let index = 0; index < length; index += 1) {
    const slice = column.slice(index * factor, index * factor + factor)
    merged[index] = gauge
      ? slice.reduce((latest, value) => value === 0 ? latest : value, 0)
      : slice.reduce((total, value) => total + value, 0)
  }
  return merged
}

/** One plotted bucket of the selected metric. */
export interface ActivityBucket {
  readonly key: string
  readonly start: number
  readonly label: string
  readonly value: number
}

/** Number of stored buckets the longest column holds; the grid's extent. */
function gridLength(series: ActivitySeriesProjection): number {
  return Math.max(...Object.values(series.series).map(column => column.length), 0)
}

/**
 * Bucket count the rendered grid covers at one aggregation factor.
 * @param series - the projected histogram.
 * @param factor - the display aggregation factor.
 * @returns the bucket count the chart plots.
 */
export function activityBucketCount(series: ActivitySeriesProjection, factor: number): number {
  return Math.ceil(gridLength(series) / factor)
}

/**
 * Plot one metric over its buckets, labeled by offset from the session's first
 * counted event so the axis stays locale-formatted and clock-independent. A
 * column shorter than the grid is padded with zeroes, so every rendered bucket
 * keeps its own time span.
 * @param series - the projected histogram.
 * @param id - the metric column to plot.
 * @param factor - the display aggregation factor.
 * @param t - the dashboard's bound translate seat.
 * @returns one point per rendered bucket, oldest first.
 */
export function activityBuckets(
  series: ActivitySeriesProjection,
  id: ActivityMetricId,
  factor: number,
  t: ObservabilityTranslate,
): ActivityBucket[] {
  const originMs = series.originMs
  if (originMs === null) return []
  const count = activityBucketCount(series, factor)
  const column = coarsenColumn(series.series[id], factor, isGaugeMetric(id))
  const padded = column.length >= count
    ? column
    : [...column, ...new Array<number>(count - column.length).fill(0)]
  const width = series.bucketMs * factor
  return padded.map((value, index) => ({
    key: String(index),
    start: originMs + index * width,
    label: formatDuration(index * width, t),
    value,
  }))
}

/**
 * One metric's headline figure: the summed samples, or the latest non-zero
 * reading for a gauge.
 * @param series - the projected histogram.
 * @param id - the metric column.
 * @param factor - the display aggregation factor.
 * @returns the figure, or `0` before the grid is anchored (no bucket can hold a reading).
 */
export function activityTotal(
  series: ActivitySeriesProjection,
  id: ActivityMetricId,
  factor: number,
): number {
  if (series.originMs === null) return 0
  const column = coarsenColumn(series.series[id], factor, isGaugeMetric(id))
  return isGaugeMetric(id)
    ? column.reduce((latest, value) => value === 0 ? latest : value, 0)
    : column.reduce((total, value) => total + value, 0)
}

/**
 * Format one metric figure in its own unit.
 * @param value - the figure.
 * @param unit - the metric's unit.
 * @param t - the dashboard's bound translate seat.
 * @returns the formatted figure.
 */
export function formatActivityValue(
  value: number,
  unit: ActivityMetricUnit,
  t: ObservabilityTranslate,
): string {
  return unit === 'tokens' ? formatTokens(value, t) : String(Math.round(value))
}

/**
 * The wall-clock span the rendered buckets cover.
 * @param series - the projected histogram.
 * @param factor - the display aggregation factor.
 * @returns the span in milliseconds.
 */
export function activitySpanMs(series: ActivitySeriesProjection, factor: number): number {
  return activityBucketCount(series, factor) * series.bucketMs * factor
}
