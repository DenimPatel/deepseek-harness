/**
 * Dashboard formatting helpers. Every unit-bearing string routes through the
 * `observability` dictionary so no product text is hardcoded; callers pass the
 * namespace-bound translate seat.
 */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservabilityKey } from './locales.ts'

/** The dashboard's bound translate seat. */
export type ObservabilityTranslate = TranslateNS<'observability'>

export type { ObservabilityKey }

/** Provider-reported token buckets the dashboard reads (a structural subset of the projection). */
export interface TokenUsageBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/**
 * Sum the four disjoint durable token buckets.
 * @param usage - provider-reported buckets, or `undefined` before any usage lands.
 * @returns the total token count.
 */
export function totalTokens(usage: TokenUsageBuckets | undefined): number {
  return usage === undefined
    ? 0
    : usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Prompt-side tokens that could be served from cache.
 * @param usage - provider-reported buckets.
 * @returns uncached input plus cache reads.
 */
export function billedInputTokens(usage: TokenUsageBuckets): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens
}

/**
 * Cached fraction of prompt-side traffic.
 * @param usage - provider-reported buckets.
 * @returns the ratio in `[0, 1]`, or `null` when the prompt billed nothing.
 */
export function cacheHitRatio(usage: TokenUsageBuckets): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0 ? null : usage.cacheReadTokens / denominator
}

/**
 * Compact token count with a localized scale suffix.
 * @param value - token count.
 * @param t - the dashboard's bound translate seat.
 * @returns the formatted count.
 */
export function formatTokens(value: number, t: ObservabilityTranslate): string {
  if (value < 1000) return String(Math.round(value))
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000_000) return t('tokens.thousand', { value: scaled(value / 1000) })
  return t('tokens.million', { value: scaled(value / 1_000_000) })
}

/**
 * Wall time as the smallest localized unit that keeps the value readable.
 * @param milliseconds - elapsed wall time.
 * @param t - the dashboard's bound translate seat.
 * @returns the formatted duration.
 */
export function formatDuration(milliseconds: number, t: ObservabilityTranslate): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return t('duration.milliseconds', { value: '0' })
  if (milliseconds < 1000) return t('duration.milliseconds', { value: String(Math.round(milliseconds)) })
  if (milliseconds < 60_000) return t('duration.seconds', { value: (milliseconds / 1000).toFixed(1) })
  if (milliseconds < 3_600_000) {
    const minutes = Math.floor(milliseconds / 60_000)
    const seconds = Math.round((milliseconds % 60_000) / 1000)
    return t('duration.minutes', { minutes: String(minutes), seconds: String(seconds) })
  }
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  return t('duration.hours', { hours: String(hours), minutes: String(minutes) })
}

/**
 * One-decimal percentage of a non-negative ratio.
 * @param ratio - the ratio, or `null` when it is unknown.
 * @param t - the dashboard's bound translate seat.
 * @returns the formatted percentage or the unknown value.
 */
export function formatRatio(ratio: number | null, t: ObservabilityTranslate): string {
  return ratio === null ? t('value.none') : t('value.percent', { value: (ratio * 100).toFixed(1) })
}

/**
 * Decode throughput in tokens per second.
 * @param decodeTokens - provider output tokens over the timed decode window.
 * @param decodeMs - summed decode wall time.
 * @returns tokens per second, or `null` without timed decode samples.
 */
export function decodeTokensPerSecond(decodeTokens: number, decodeMs: number): number | null {
  return decodeMs <= 0 ? null : decodeTokens / (decodeMs / 1000)
}

/**
 * Mean first-token latency across steps that recorded one.
 * @param ttftMs - summed first-token latency.
 * @param ttftSteps - steps carrying a recorded first token.
 * @returns the mean latency, or `null` with no timed steps.
 */
export function meanTtftMs(ttftMs: number, ttftSteps: number): number | null {
  return ttftSteps <= 0 ? null : ttftMs / ttftSteps
}
