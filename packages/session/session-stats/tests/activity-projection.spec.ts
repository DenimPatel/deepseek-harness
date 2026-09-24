/**
 * The `activitySeries` projection unit: mounting the plugin beside the
 * projection registry serves bounded time buckets of counted session activity,
 * the fold counts exactly the events it declares, and both the persisted state
 * and the served value survive JSON and their schemas.
 *
 * Bucket math runs against the exported factory directly, where event times and
 * the bucket policy are controlled; the registry drive covers mounting, the
 * config default, and HMR removal.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as SessionStatsPlugin from '@deepseek-ai/dsh-session-stats'
import { ACTIVITY_METRIC_IDS } from '@deepseek-ai/dsh-session-stats/src/activity-metrics.ts'
import {
  ACTIVITY_SERIES_DEFAULTS,
  createActivitySeriesProjectionDefinition,
} from '@deepseek-ai/dsh-session-stats/src/activity-projection.ts'
import type { ActivitySeriesConfig } from '@deepseek-ai/dsh-session-stats/src/activity-projection.ts'

/** Build one definition from the exported factory, overriding the policy per case. */
function definition(policy: Partial<ActivitySeriesConfig> = {}) {
  return createActivitySeriesProjectionDefinition({ ...ACTIVITY_SERIES_DEFAULTS, ...policy })
}

/** The fold state type of that definition. */
type State = Parameters<ReturnType<typeof definition>['apply']>[0]

/** The registry's seeding arguments; this unit reads neither of them. */
const SEED_ARGS = [{ id: 'activity' } as SessionHeader, SessionLogOffset(0)] as const

/** Build one synthetic committed event with a controlled timestamp. */
function at(time: number, type: string, data: unknown): SessionEvent {
  return { type, seq: time, time, data } as SessionEvent
}

/** One settled assistant message carrying the supplied usage record. */
function messageAt(time: number, usage?: unknown): SessionEvent {
  return at(time, 'assistant/message', {
    turn: 1,
    step: 1,
    stream: [],
    message: { role: 'assistant', content: [] },
    ...usage === undefined ? {} : { usage },
  })
}

/** One tool result carrying the error marker when requested. */
function toolResultAt(time: number, failed: boolean): SessionEvent {
  return at(time, 'tool/result', {
    turn: 1,
    step: 1,
    message: { role: 'tool', callId: 'c', content: [], isError: failed },
  })
}

/** One tool call with fixed synthetic arguments. */
function toolCallAt(time: number, callId: string): SessionEvent {
  return at(time, 'tool/call', { turn: 1, step: 1, callId, name: 'read', arguments: '{}' })
}

/** Fold a synthetic event list through the definition and view the result. */
function foldValue(events: readonly SessionEvent[], policy: Partial<ActivitySeriesConfig> = {}) {
  const { apply, init, wire } = definition(policy)
  const state = events.reduce<State>((folded, event) => apply(folded, event), init(...SEED_ARGS))
  return wire.view(state)
}

describe('activitySeries projection unit (fold)', () => {
  it('serves an empty histogram before any counted event, with the configured width', () => {
    const value = foldValue([])
    expect(value.originMs).toBeNull()
    expect(value.bucketMs).toBe(ACTIVITY_SERIES_DEFAULTS.bucketMs)
    for (const id of ACTIVITY_METRIC_IDS) expect(value.series[id]).toEqual([])
  })

  it('carries exactly the declared metric columns', () => {
    expect(Object.keys(definition().init(...SEED_ARGS).series).sort()).toEqual([...ACTIVITY_METRIC_IDS].sort())
  })

  it('anchors the grid at the first counted event and places later samples by time', () => {
    const value = foldValue([
      at(1_000, 'turn/start', { turn: 1 }),
      at(1_100, 'step/end', { turn: 1, step: 1 }),
      toolCallAt(2_600, 'a'),
      toolResultAt(2_700, false),
      at(4_100, 'assistant/attempt', { turn: 1, step: 1, stream: [] }),
      at(4_100, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } } }),
    ], { bucketMs: 1_000, maxBuckets: 8 })
    expect(value.originMs).toBe(1_000)
    expect(value.bucketMs).toBe(1_000)
    expect(value.series.turnsStarted).toEqual([1, 0, 0, 0])
    expect(value.series.stepsClosed).toEqual([1, 0, 0, 0])
    expect(value.series.toolCalls).toEqual([0, 1, 0, 0])
    expect(value.series.apiRequests).toEqual([0, 0, 0, 1])
    expect(value.series.apiErrors).toEqual([0, 0, 0, 1])
  })

  it('counts every core and contributed event type into its own column', () => {
    const value = foldValue([
      at(0, 'turn/start', { turn: 1 }),
      at(0, 'step/end', { turn: 1, step: 1 }),
      at(0, 'assistant/attempt', { turn: 1, step: 1, stream: [] }),
      toolCallAt(0, 'a'),
      toolResultAt(0, true),
      at(0, 'llm/retry', { turn: 1, step: 1 }),
      at(0, 'llm/retry-started', { turn: 1, step: 1, retryId: 'r' }),
      at(0, 'subagent/catalog', { version: 1, childId: 'c' }),
      at(0, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ], { bucketMs: 1_000, maxBuckets: 8 })
    expect(value.series).toMatchObject({
      turnsStarted: [1],
      stepsClosed: [1],
      apiRequests: [1],
      toolCalls: [1],
      toolErrors: [1],
      apiErrors: [1],
      retries: [1],
      subagentSpawns: [1],
    })
  })

  it('leaves uncounted events on the same state reference', () => {
    const { apply, init } = definition({ bucketMs: 1_000, maxBuckets: 8 })
    let state = init(...SEED_ARGS)
    const counted = at(1_000, 'turn/start', { turn: 1 })
    state = apply(state, counted)
    for (const event of [
      at(1_100, 'step/start', { turn: 1, step: 1 }),
      at(1_200, 'user/message', { role: 'user', content: [] }),
      // A completed turn is not a request failure.
      at(1_300, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      toolResultAt(1_400, false),
      // No usage report, a malformed one, and an unusable one all contribute nothing.
      messageAt(1_500),
      messageAt(1_600, { inputTokens: -5, outputTokens: Number.NaN }),
      messageAt(1_700, { inputTokens: Number.POSITIVE_INFINITY, outputTokens: 'x' }),
    ]) {
      const next = apply(state, event)
      expect(next).toBe(state)
      state = next
    }
    expect(state.series.turnsStarted).toEqual([1])
  })

  it('does not mutate the state it folds from', () => {
    const { apply, init } = definition({ bucketMs: 1_000, maxBuckets: 8 })
    const opened = apply(init(...SEED_ARGS), at(0, 'turn/start', { turn: 1 }))
    const before = opened.series.turnsStarted
    apply(opened, toolCallAt(500, 'a'))
    expect(opened.series.turnsStarted).toBe(before)
    expect(before).toEqual([1])
  })

  it('keeps a reading before the anchor in the first bucket instead of a negative index', () => {
    const value = foldValue([
      at(5_000, 'turn/start', { turn: 1 }),
      toolCallAt(1_000, 'a'),
    ], { bucketMs: 1_000, maxBuckets: 8 })
    expect(value.originMs).toBe(5_000)
    expect(value.series.turnsStarted).toEqual([1])
    expect(value.series.toolCalls).toEqual([1])
  })

  it('sums the four disjoint token columns and sets the prompt-side gauge', () => {
    const value = foldValue([
      messageAt(0, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 }),
    ], { bucketMs: 1_000, maxBuckets: 8 })
    expect(value.series.tokensUncachedInput).toEqual([10])
    expect(value.series.tokensOutput).toEqual([5])
    expect(value.series.tokensCacheRead).toEqual([2])
    expect(value.series.tokensCacheWrite).toEqual([1])
    expect(value.series.contextTokens).toEqual([13])
  })

  it('reads a report without an output figure as no output tokens', () => {
    const value = foldValue([
      messageAt(0, { inputTokens: 4, cacheReadTokens: 6 }),
    ], { bucketMs: 1_000, maxBuckets: 8 })
    expect(value.series.tokensUncachedInput).toEqual([4])
    expect(value.series.tokensOutput).toEqual([0])
    expect(value.series.contextTokens).toEqual([10])
  })
})

describe('activitySeries bucket policy (controlled timestamps)', () => {
  it('places the sample at the cap boundary and coarsens one sample later', () => {
    const policy = { bucketMs: 1_000, maxBuckets: 3 }
    const atCap = foldValue([
      toolCallAt(0, 'a'), toolCallAt(1_000, 'b'), toolCallAt(2_000, 'c'),
    ], policy)
    expect(atCap.bucketMs).toBe(1_000)
    expect(atCap.series.toolCalls).toEqual([1, 1, 1])

    const overCap = foldValue([
      toolCallAt(0, 'a'), toolCallAt(1_000, 'b'), toolCallAt(2_000, 'c'), toolCallAt(3_000, 'd'),
    ], policy)
    expect(overCap.originMs).toBe(0)
    expect(overCap.bucketMs).toBe(2_000)
    // Buckets 0 and 1 merge to 2, then the new sample lands in the second bucket.
    expect(overCap.series.toolCalls).toEqual([2, 2])
  })

  it('coarsens the grid instead of padding through an idle gap', () => {
    const value = foldValue([
      at(0, 'turn/start', { turn: 1 }),
      at(3_600_000, 'turn/start', { turn: 2 }),
    ], { bucketMs: 1_000, maxBuckets: 4 })
    expect(value.bucketMs).toBeGreaterThan(1_000)
    expect(value.series.turnsStarted.length).toBeLessThanOrEqual(4)
    expect(value.series.turnsStarted.reduce((sum, count) => sum + count, 0)).toBe(2)
    expect(value.series.turnsStarted.at(-1)).toBe(1)
  })

  it('adds counts and sums when pairs merge', () => {
    const value = foldValue([
      toolCallAt(0, 'a'),
      messageAt(0, { inputTokens: 3, outputTokens: 2 }),
      toolCallAt(1_000, 'b'),
      toolCallAt(2_000, 'c'),
    ], { bucketMs: 1_000, maxBuckets: 2 })
    expect(value.bucketMs).toBe(2_000)
    expect(value.series.toolCalls).toEqual([2, 1])
    expect(value.series.tokensUncachedInput).toEqual([3, 0])
    expect(value.series.tokensOutput).toEqual([2, 0])
  })

  it('keeps the later non-zero gauge when pairs merge', () => {
    const value = foldValue([
      messageAt(0, { inputTokens: 5, outputTokens: 1 }),
      messageAt(1_000, { inputTokens: 7, outputTokens: 1 }),
      toolCallAt(2_000, 'a'),
      toolCallAt(3_000, 'b'),
    ], { bucketMs: 1_000, maxBuckets: 2 })
    expect(value.series.contextTokens).toEqual([7, 0])
  })

  it('treats an absent prompt-side figure as no reading and keeps the previous gauge', () => {
    const value = foldValue([
      messageAt(0, { inputTokens: 12, outputTokens: 3 }),
      messageAt(1_000, { outputTokens: 9 }),
    ], { bucketMs: 1_000, maxBuckets: 8 })
    expect(value.series.contextTokens).toEqual([12, 0])
    expect(value.series.tokensOutput).toEqual([3, 9])
  })

  it('replays the same log to the same state and round-trips through JSON and both schemas', () => {
    const policy = { bucketMs: 1_000, maxBuckets: 4 }
    const events = [
      at(0, 'turn/start', { turn: 1 }),
      messageAt(400, { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2 }),
      toolCallAt(2_500, 'a'),
      toolResultAt(2_600, true),
      at(6_000, 'turn/end', { turn: 1, reason: { kind: 'error', error: { message: 'x', code: 'UNKNOWN' } } }),
    ]
    const { apply, init, stateSchema, wire } = definition(policy)
    const once = events.reduce<State>((state, event) => apply(state, event), init(...SEED_ARGS))
    const twice = events.reduce<State>((state, event) => apply(state, event), init(...SEED_ARGS))
    expect(twice).toEqual(once)
    expect(stateSchema.parse(JSON.parse(JSON.stringify(once)))).toEqual(once)
    const view = wire.view(once)
    expect(wire.viewSchema.parse(JSON.parse(JSON.stringify(view)))).toEqual(view)
  })
})

describe('activitySeries registration', () => {
  it('serves the default histogram beside sessionStats and drops both keys on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('activity'))
    expect('activitySeries' in ctx.sessionProjections.snapshot(session).values).toBe(false)

    const fiber = await ctx.plugin(SessionStatsPlugin)
    const empty = ctx.sessionProjections.snapshot(session).values.activitySeries
    expect(empty).toMatchObject({ originMs: null, bucketMs: ACTIVITY_SERIES_DEFAULTS.bucketMs })
    expect(ctx.sessionProjections.snapshot(session).values.sessionStats).toMatchObject({ turns: 0, steps: 0 })

    session.append('turn/start', { turn: 1 })
    session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('a'), name: 'read', arguments: '{}' })
    const served = ctx.sessionProjections.snapshot(session).values.activitySeries
    expect(typeof served?.originMs).toBe('number')
    expect(served?.series.turnsStarted.reduce((sum, count) => sum + count, 0)).toBe(1)
    expect(served?.series.toolCalls.reduce((sum, count) => sum + count, 0)).toBe(1)

    await fiber.dispose()
    expect('activitySeries' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
