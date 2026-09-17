/**
 * Pure types of the `activitySeries` domain: the ONE home of the projection
 * key declaration, free of this package's host-side value imports.
 *
 * @module @deepseek-ai/dsh-session-stats/activity-types
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionProjectionStateMap } from '@deepseek-ai/dsh-session-projection/types'
import type { ActivityMetricId } from './activity-metrics.ts'

export type { ActivityMetricId } from './activity-metrics.ts'

/**
 * Durable per-session activity histogram: bounded, oldest-first buckets on a
 * fixed grid whose width doubles as a long session outgrows its bucket cap.
 *
 * Column index `i` covers `[originMs + i * bucketMs, originMs + (i + 1) * bucketMs)`
 * in every metric, so a coarsened history is read exactly like a fine one; the
 * current width always travels with the samples. `originMs` is `null` until a
 * counted event anchors the grid, and no column carries a reading before that.
 */
export interface ActivitySeriesProjection {
  /** Grid anchor — the first counted event's time — or `null` before one. */
  originMs: number | null
  /** Current bucket width, ms; doubles on each roll-up. */
  bucketMs: number
  /** One column per metric id, each with one sample per bucket, oldest first. */
  series: Readonly<Record<ActivityMetricId, readonly number[]>>
}

/**
 * Fold state of the `activitySeries` unit. The state carries no unserved
 * boundary field, so one schema validates both the persisted row and the
 * served value.
 */
export interface ActivitySeriesState {
  originMs: number | null
  bucketMs: number
  series: Record<ActivityMetricId, number[]>
}

/**
 * A projection definition with its wire payload present, which is what
 * `SessionProjectionRegistry.register` accepts. `ProjectionDefinition` leaves
 * `wire` optional because host-only units exist; this unit always serves one.
 */
export type WiredProjectionDefinition<
  K extends keyof SessionProjectionStateMap,
  S extends SessionProjectionStateMap[K],
> = Omit<ProjectionDefinition<K, S>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<K, S>['wire']>
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Durable activity histogram; see {@link ActivitySeriesProjection}. */
    activitySeries: ActivitySeriesProjection
  }
  interface SessionProjectionStateMap {
    activitySeries: ActivitySeriesState
  }
}
