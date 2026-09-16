/** Formatting helpers: unit selection, ratios, and derived throughput. */
import { describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  billedInputTokens,
  cacheHitRatio,
  decodeTokensPerSecond,
  formatDuration,
  formatRatio,
  formatTokens,
  meanTtftMs,
  totalTokens,
} from '../src/client/format.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

describe('formatTokens', () => {
  it('keeps small counts exact and scales larger ones', () => {
    expect(formatTokens(999, t)).toBe('999')
    expect(formatTokens(1500, t)).toBe('1.5 千')
    expect(formatTokens(250_000, t)).toBe('250 千')
    expect(formatTokens(2_500_000, t)).toBe('2.5 百万')
  })
})

describe('formatDuration', () => {
  it('picks the readable unit', () => {
    expect(formatDuration(500, t)).toBe('500 毫秒')
    expect(formatDuration(1500, t)).toBe('1.5 秒')
    expect(formatDuration(65_000, t)).toBe('1 分 5 秒')
    expect(formatDuration(3_700_000, t)).toBe('1 小时 1 分')
    expect(formatDuration(-1, t)).toBe('0 毫秒')
  })
})

describe('formatRatio', () => {
  it('renders one decimal, or the unknown value', () => {
    expect(formatRatio(0.5123, t)).toBe('51.2%')
    expect(formatRatio(null, t)).toBe('—')
  })
})

describe('token aggregates', () => {
  it('sums buckets and reports the cached prompt share', () => {
    const buckets = { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 0 }
    expect(totalTokens(buckets)).toBe(450)
    expect(billedInputTokens(buckets)).toBe(400)
    expect(cacheHitRatio(buckets)).toBe(0.75)
    expect(cacheHitRatio({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull()
    expect(totalTokens(undefined)).toBe(0)
  })
})

describe('derived throughput', () => {
  it('computes decode tokens per second and mean TTFT', () => {
    expect(decodeTokensPerSecond(100, 2000)).toBe(50)
    expect(decodeTokensPerSecond(100, 0)).toBeNull()
    expect(meanTtftMs(300, 3)).toBe(100)
    expect(meanTtftMs(300, 0)).toBeNull()
  })
})
