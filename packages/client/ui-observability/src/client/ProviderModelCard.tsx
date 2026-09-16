/** Metric strip: provider/model identity plus the readings an LLM engineer watches. */

import { StatTile } from './charts/StatTile.tsx'
import {
  cacheHitRatio,
  decodeTokensPerSecond,
  formatDuration,
  formatRatio,
  formatTokens,
  meanTtftMs,
  totalTokens,
} from './format.ts'
import type { ObservabilityTranslate } from './format.ts'
import type { ContextFigures, ModelFigures, SessionStatsFigures, TokenBuckets } from './observability-model.ts'
import css from './ProviderModelCard.module.css'

export interface ProviderModelCardProps {
  readonly model?: ModelFigures | undefined
  readonly usage?: TokenBuckets | undefined
  readonly stats?: SessionStatsFigures | undefined
  readonly context?: ContextFigures | undefined
  readonly t: ObservabilityTranslate
}

/**
 * Render the dashboard metric strip.
 * @param props - model identity, token, timing, and context figures plus the translate seat.
 * @returns the strip.
 */
export function ProviderModelCard({ model, usage, stats, context, t }: ProviderModelCardProps): React.JSX.Element {
  const ttft = stats === undefined ? null : meanTtftMs(stats.ttftMs, stats.ttftSteps)
  const tps = stats === undefined ? null : decodeTokensPerSecond(stats.decodeTokens, stats.decodeMs)
  const cacheHit = usage === undefined ? null : cacheHitRatio(usage)
  const contextRatio = context?.projectedTokens !== undefined && context.contextWindow !== undefined
    && context.contextWindow > 0
    ? context.projectedTokens / context.contextWindow
    : null
  return (
    <div className={css.root}>
      <StatTile label={t('provider.label')} value={model?.provider ?? t('value.none')} />
      <StatTile label={t('model.label')} value={model?.model ?? t('value.none')} />
      <StatTile label={t('metric.ttft')} value={ttft === null ? t('value.none') : formatDuration(ttft, t)} />
      <StatTile label={t('metric.tps')} value={tps === null ? t('value.none') : t('value.tps', { value: tps.toFixed(1) })} />
      <StatTile label={t('metric.context')} value={formatRatio(contextRatio, t)} hint={contextHint(context, t)} />
      <StatTile label={t('metric.cacheHit')} value={formatRatio(cacheHit, t)} />
      <StatTile label={t('metric.turns')} value={String(stats?.turns ?? 0)} />
      <StatTile label={t('metric.steps')} value={String(stats?.steps ?? 0)} />
      <StatTile label={t('metric.tokens')} value={formatTokens(totalTokens(usage), t)} />
      <StatTile label={t('metric.llmMs')} value={formatDuration(stats?.llmMs ?? 0, t)} />
      <StatTile label={t('metric.toolMs')} value={formatDuration(stats?.toolMs ?? 0, t)} />
    </div>
  )
}

function contextHint(context: ContextFigures | undefined, t: ObservabilityTranslate): string | undefined {
  if (context?.projectedTokens === undefined || context.contextWindow === undefined) return undefined
  return `${formatTokens(context.projectedTokens, t)} / ${formatTokens(context.contextWindow, t)}`
}
