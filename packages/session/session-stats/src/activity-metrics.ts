/**
 * Closed metric vocabulary of the `activitySeries` projection unit: the column
 * ids of its columnar buckets and the kind each roll-up merge applies.
 *
 * A new metric is additive: append its id here, add its column to the fold's
 * schema and counter, and add one descriptor row in the consuming UI.
 *
 * @module @deepseek-ai/dsh-session-stats/activity-metrics
 */

/**
 * Every column the series carries, in schema order. Each column holds one
 * sample per bucket, oldest first, so column index `i` covers the same time
 * span in every metric.
 */
export const ACTIVITY_METRIC_IDS = [
  'apiRequests',
  'apiErrors',
  'retries',
  'toolCalls',
  'toolErrors',
  'subagentSpawns',
  'turnsStarted',
  'stepsClosed',
  'tokensUncachedInput',
  'tokensCacheRead',
  'tokensCacheWrite',
  'tokensOutput',
  'contextTokens',
] as const

/** One column id of {@link ACTIVITY_METRIC_IDS}. */
export type ActivityMetricId = typeof ACTIVITY_METRIC_IDS[number]

/**
 * Columns holding a latest-sample gauge. Every other column accumulates, so a
 * roll-up adds the merged pair. A gauge keeps the later bucket's sample, and
 * treats that sample's `0` as "no reading in this bucket" so a captured
 * reading is never overwritten by an empty neighbor.
 */
export const ACTIVITY_GAUGE_METRIC_IDS = ['contextTokens'] as const satisfies
  readonly ActivityMetricId[]
