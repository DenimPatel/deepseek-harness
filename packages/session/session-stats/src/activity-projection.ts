/**
 * The `activitySeries` projection unit: a pure fold of counted session events
 * into bounded, oldest-first time buckets carrying per-metric columns.
 *
 * The fold answers "how much happened, when" over a whole session, which a
 * client cannot derive from its resident window: every counted event type is a
 * durable log fact and the fold retains only aggregates.
 *
 * Bucket policy:
 * - The grid is anchored once, at the first counted event's time, and never
 *   moves, so `originMs` plus `bucketMs` reconstructs the time span of every
 *   column.
 * - A sample lands at `floor((time - originMs) / bucketMs)`. A sample at or
 *   past the bucket cap coarsens the grid first: `bucketMs` doubles and
 *   adjacent pairs merge, which also bounds the padding an idle gap allocates.
 * - Counts and token sums add when pairs merge; a gauge keeps the later
 *   non-zero sample (see {@link ACTIVITY_GAUGE_METRIC_IDS}).
 *
 * Every uncounted event returns the same state reference, so the change feed
 * stays quiet between counted events and stream deltas never publish.
 *
 * @module @deepseek-ai/dsh-session-stats/activity-projection
 */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ACTIVITY_GAUGE_METRIC_IDS, ACTIVITY_METRIC_IDS } from './activity-metrics.ts'
import type { ActivityMetricId } from './activity-metrics.ts'
import type { ActivitySeriesState, WiredProjectionDefinition } from './activity-types.ts'

/** Resolved bucket policy for one registration. */
export interface ActivitySeriesConfig {
  /** Width of the finest bucket, ms. */
  bucketMs: number
  /** Column count above which the grid doubles its width. */
  maxBuckets: number
}

/** The bucket policy applied when a composition sets none. */
export const ACTIVITY_SERIES_DEFAULTS: ActivitySeriesConfig = {
  bucketMs: 5_000,
  maxBuckets: 240,
}

/**
 * Fold state: the histogram itself. It carries no unserved boundary fields, so
 * one schema validates both the persisted row and the served value.
 */
const activitySeriesSchema: z.ZodType<ActivitySeriesState> = z.object({
  originMs: z.number().int().nonnegative().nullable(),
  bucketMs: z.number().int().positive(),
  series: z.object({
    apiRequests: z.array(z.number().nonnegative()),
    apiErrors: z.array(z.number().nonnegative()),
    retries: z.array(z.number().nonnegative()),
    toolCalls: z.array(z.number().nonnegative()),
    toolErrors: z.array(z.number().nonnegative()),
    subagentSpawns: z.array(z.number().nonnegative()),
    turnsStarted: z.array(z.number().nonnegative()),
    stepsClosed: z.array(z.number().nonnegative()),
    tokensUncachedInput: z.array(z.number().nonnegative()),
    tokensCacheRead: z.array(z.number().nonnegative()),
    tokensCacheWrite: z.array(z.number().nonnegative()),
    tokensOutput: z.array(z.number().nonnegative()),
    contextTokens: z.array(z.number().nonnegative()),
  }).strict(),
}).strict()

/** One counted reading: column deltas plus an optional gauge replacement. */
interface ActivitySample {
  /** Column deltas to add to the sample's bucket. */
  readonly additions: Partial<Record<ActivityMetricId, number>>
  /**
   * Prompt-side token reading recorded as this bucket's gauge. Absent when the
   * settlement reported no prompt-side figure, so an empty report never
   * overwrites an earlier reading.
   */
  readonly gauge?: number
}

/** One finite non-negative number, or null when the report is unusable. */
function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Token columns and the prompt-side gauge one settled message reports.
 * @param usage - the `assistant/message` event's optional usage record.
 * @returns the sample, or null when no usable figure was reported.
 */
function messageSample(usage: unknown): ActivitySample | null {
  if (typeof usage !== 'object' || usage === null) return null
  const record = usage as Record<string, unknown>
  const input = nonNegative(record.inputTokens)
  const output = nonNegative(record.outputTokens)
  if (input === null && output === null) return null
  const cacheRead = nonNegative(record.cacheReadTokens) ?? 0
  const cacheWrite = nonNegative(record.cacheWriteTokens) ?? 0
  const uncachedInput = input ?? 0
  return {
    additions: {
      tokensUncachedInput: uncachedInput,
      tokensCacheRead: cacheRead,
      tokensCacheWrite: cacheWrite,
      tokensOutput: output ?? 0,
    },
    // Only a reported prompt-side figure is a reading: an output-only report
    // must not present the request as having consumed no context.
    ...input === null ? {} : { gauge: uncachedInput + cacheRead + cacheWrite },
  }
}

/**
 * Column deltas for counted event types contributed by another package's event
 * map. Naming them in the switch would require a host type dependency on the
 * contributing package (`llm-retry`, `subagent`), so they are read by name from
 * one table; the unit spec pins every entry.
 */
const CONTRIBUTED_EVENT_ADDITIONS: Readonly<Record<string, Partial<Record<ActivityMetricId, number>>>> = {
  'llm/retry': { apiErrors: 1 },
  'llm/retry-started': { retries: 1 },
  'subagent/catalog': { subagentSpawns: 1 },
}

/**
 * The reading one event contributes, or null when the event carries none.
 * @param event - one committed session event.
 * @returns the sample, or null when the event is not counted.
 */
function countEvent(event: SessionEvent): ActivitySample | null {
  const contributed = CONTRIBUTED_EVENT_ADDITIONS[event.type]
  if (contributed !== undefined) return { additions: contributed }
  switch (event.type) {
    case 'turn/start':
      return { additions: { turnsStarted: 1 } }
    // A turn closed by a structured failure is a terminal request failure;
    // completed, blocked, aborted, interrupted, and max-tokens closers are not.
    case 'turn/end':
      return event.data.reason.kind === 'error' ? { additions: { apiErrors: 1 } } : null
    case 'step/end':
      return { additions: { stepsClosed: 1 } }
    case 'assistant/attempt':
      return { additions: { apiRequests: 1 } }
    case 'tool/call':
      return { additions: { toolCalls: 1 } }
    case 'tool/result':
      return event.data.message.isError === true ? { additions: { toolErrors: 1 } } : null
    case 'assistant/message':
      return messageSample(event.data.usage)
    default:
      return null
  }
}

/** Bucket index of one time on the grid, clamped to the first bucket. */
function bucketIndexOf(originMs: number, bucketMs: number, time: number): number {
  return Math.max(0, Math.floor((time - originMs) / bucketMs))
}

/**
 * Merge adjacent bucket pairs for one roll-up: counts and sums add, gauges keep
 * the later non-zero sample.
 * @param series - the columns at the current width.
 * @returns the columns at double the width.
 */
function mergeColumns(series: ActivitySeriesState['series']): ActivitySeriesState['series'] {
  const merged = {} as ActivitySeriesState['series']
  for (const id of ACTIVITY_METRIC_IDS) {
    const column = series[id]
    const length = Math.ceil(column.length / 2)
    const next = new Array<number>(length)
    const gauge = ACTIVITY_GAUGE_METRIC_IDS.some(gaugeId => gaugeId === id)
    for (let index = 0; index < length; index += 1) {
      // Every merged bucket owns its even source index: the length is the ceiling of half the column.
      const earlier = column[index * 2] as number
      const later = column[index * 2 + 1]
      next[index] = gauge
        ? later === undefined || later === 0 ? earlier : later
        : earlier + (later ?? 0)
    }
    merged[id] = next
  }
  return merged
}

/**
 * Build the `activitySeries` unit for one resolved bucket policy.
 * @param policy - bucket width and cap for this registration.
 * @returns the projection definition to register.
 */
export function createActivitySeriesProjectionDefinition(
  policy: ActivitySeriesConfig = ACTIVITY_SERIES_DEFAULTS,
): WiredProjectionDefinition<'activitySeries', ActivitySeriesState> {
  return {
    key: 'activitySeries',
    stateVersion: 1,
    stateSchema: activitySeriesSchema,
    init: () => ({
      originMs: null,
      bucketMs: policy.bucketMs,
      series: Object.fromEntries(
        ACTIVITY_METRIC_IDS.map(id => [id, [] as number[]]),
      ) as ActivitySeriesState['series'],
    }),
    apply: (state: ActivitySeriesState, event: SessionEvent) => {
      const sample = countEvent(event)
      if (sample === null) return state

      // A reading before the anchor (clock skew) lands in the first bucket
      // rather than at a negative index.
      const measured = Math.max(0, event.time)
      const originMs = state.originMs ?? measured
      let bucketMs = state.bucketMs
      let columns = state.series
      // An index at or past the cap means the grid must coarsen before the
      // sample lands, which also bounds the padding an idle gap can allocate.
      while (bucketIndexOf(originMs, bucketMs, measured) >= policy.maxBuckets) {
        bucketMs *= 2
        columns = mergeColumns(columns)
      }
      const index = bucketIndexOf(originMs, bucketMs, measured)

      const series: ActivitySeriesState['series'] = { ...columns }
      const length = index + 1
      for (const id of ACTIVITY_METRIC_IDS) {
        const column = series[id]
        if (column.length < length) {
          series[id] = [...column, ...new Array<number>(length - column.length).fill(0)]
        }
      }
      // Writing copies the column first, so an untouched column keeps the
      // previous state's array and the fold stays immutable.
      const at = (id: ActivityMetricId): number[] => {
        const column = series[id]
        if (column === columns[id]) {
          const copy = [...column]
          series[id] = copy
          return copy
        }
        return column
      }
      for (const id of ACTIVITY_METRIC_IDS) {
        const addition = sample.additions[id]
        if (addition === undefined) continue
        const column = at(id)
        // The padding above guarantees this bucket's cell exists.
        column[index] = (column[index] as number) + addition
      }
      if (sample.gauge !== undefined) at('contextTokens')[index] = sample.gauge

      return { originMs, bucketMs, series }
    },
    wire: {
      viewSchema: activitySeriesSchema,
      view: (state: ActivitySeriesState) => ({
        originMs: state.originMs,
        bucketMs: state.bucketMs,
        series: state.series,
      }),
    },
  } satisfies WiredProjectionDefinition<'activitySeries', ActivitySeriesState>
}
