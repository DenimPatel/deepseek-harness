/** Token-composition donut: uncached input, cached input, cache write, and output. */

import { Pie } from './charts/Pie.tsx'
import type { ObservabilityTranslate } from './format.ts'
import type { TokenBuckets } from './observability-model.ts'

export interface TokenUsagePieProps {
  /** Cumulative provider-reported buckets, or `undefined` before any usage lands. */
  readonly usage?: TokenBuckets | undefined
  readonly t: ObservabilityTranslate
}

/**
 * Render the token breakdown donut.
 * @param props - cumulative buckets and the bound translate seat.
 * @returns the chart.
 */
export function TokenUsagePie({ usage, t }: TokenUsagePieProps): React.JSX.Element {
  const buckets: TokenBuckets = usage ?? {
    uncachedInputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  return (
    <Pie
      title={t('token.title')}
      emptyLabel={t('empty.session')}
      t={t}
      slices={[
        { key: 'uncached', label: t('token.uncachedInput'), value: buckets.uncachedInputTokens, tone: 'input' },
        { key: 'cached', label: t('token.cachedInput'), value: buckets.cacheReadTokens, tone: 'cached' },
        { key: 'cacheWrite', label: t('token.cacheWrite'), value: buckets.cacheWriteTokens, tone: 'muted' },
        { key: 'output', label: t('token.output'), value: buckets.outputTokens, tone: 'output' },
      ]}
    />
  )
}
