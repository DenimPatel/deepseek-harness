/** Wall-time composition donut: summed model time against summed tool time. */

import { Pie } from './charts/Pie.tsx'
import type { ObservabilityTranslate } from './format.ts'
import type { SessionStatsFigures } from './observability-model.ts'

export interface TimeUsagePieProps {
  /** Whole-log wall-time figures, or `undefined` before the projection arrives. */
  readonly stats?: SessionStatsFigures | undefined
  readonly t: ObservabilityTranslate
}

/**
 * Render the time breakdown donut.
 * @param props - whole-log figures and the bound translate seat.
 * @returns the chart.
 */
export function TimeUsagePie({ stats, t }: TimeUsagePieProps): React.JSX.Element {
  return (
    <Pie
      title={t('time.title')}
      emptyLabel={t('empty.session')}
      t={t}
      slices={[
        { key: 'llm', label: t('time.llm'), value: stats?.llmMs ?? 0, tone: 'llm' },
        { key: 'tool', label: t('time.tool'), value: stats?.toolMs ?? 0, tone: 'tool' },
      ]}
    />
  )
}
