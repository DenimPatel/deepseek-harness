/** Single-session dashboard: metric strip, token and time donuts, sub-agent tree. */

import { AgentTree } from './AgentTree.tsx'
import { ProviderModelCard } from './ProviderModelCard.tsx'
import { TimeUsagePie } from './TimeUsagePie.tsx'
import { TokenUsagePie } from './TokenUsagePie.tsx'
import type { ObservabilityTranslate } from './format.ts'
import type {
  AgentTreeNode,
  ContextFigures,
  ModelFigures,
  SessionStatsFigures,
  TokenBuckets,
} from './observability-model.ts'
import css from './SessionDashboard.module.css'

export interface SessionDashboardProps {
  readonly model?: ModelFigures | undefined
  readonly usage?: TokenBuckets | undefined
  readonly stats?: SessionStatsFigures | undefined
  readonly context?: ContextFigures | undefined
  readonly tree: AgentTreeNode
  readonly t: ObservabilityTranslate
}

/**
 * Render the single-session dashboard.
 * @param props - session projections, agent tree, and the bound translate seat.
 * @returns the dashboard content.
 */
export function SessionDashboard({ model, usage, stats, context, tree, t }: SessionDashboardProps): React.JSX.Element {
  return (
    <div className={css.root}>
      <ProviderModelCard model={model} usage={usage} stats={stats} context={context} t={t} />
      <div className={css.charts}>
        <TokenUsagePie usage={usage} t={t} />
        <TimeUsagePie stats={stats} t={t} />
      </div>
      <AgentTree root={tree} t={t} />
    </div>
  )
}
