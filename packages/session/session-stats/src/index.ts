/**
 * Function plugin registering this package's projection units on the
 * session-projection seam: `sessionStats` (whole-log turn/step counts and
 * LLM/tool/first-token/decode wall times) and `activitySeries` (bounded,
 * oldest-first time buckets of counted session activity). The plugin owns only
 * the folds; delivery is the seam's.
 *
 * @module @deepseek-ai/dsh-session-stats
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  ACTIVITY_SERIES_DEFAULTS,
  createActivitySeriesProjectionDefinition,
} from './activity-projection.ts'
import { sessionStatsProjectionDefinition } from './projection.ts'

export type * from './types.ts'
export type * from './activity-types.ts'
export type * from './activity-metrics.ts'

/** Cordis plugin name. */
export const name = 'session-stats'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/** Config: the activity histogram's bucket policy. */
export interface Config {
  /** Width of the finest activity bucket, ms. */
  bucketMs: number
  /** Bucket count above which the activity grid doubles its width. */
  maxBuckets: number
}

/** Runtime validation for {@link Config}. */
export const Config: z<Config> = z.object({
  bucketMs: z.natural().min(1).default(ACTIVITY_SERIES_DEFAULTS.bucketMs),
  maxBuckets: z.natural().min(2).default(ACTIVITY_SERIES_DEFAULTS.maxBuckets),
})

/**
 * Register this package's units; each registration is an effect on this
 * plugin's fiber, so unloading removes its keys.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - resolved bucket policy for the activity histogram.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.sessionProjections.register(sessionStatsProjectionDefinition)
  ctx.sessionProjections.register(createActivitySeriesProjectionDefinition(config))
}
