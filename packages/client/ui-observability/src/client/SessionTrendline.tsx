/** Cross-session token trend over session completion time. */

import { Trendline } from './charts/Trendline.tsx'
import { formatTokens } from './format.ts'
import type { ObservabilityTranslate } from './format.ts'
import type { HistoryRow } from './observability-model.ts'

export interface SessionTrendlineProps {
  readonly rows: readonly HistoryRow[]
  readonly t: ObservabilityTranslate
}

/**
 * Render the per-session token trendline.
 * @param props - history rows and the bound translate seat.
 * @returns the chart.
 */
export function SessionTrendline({ rows, t }: SessionTrendlineProps): React.JSX.Element {
  const points = [...rows]
    .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
    .map(row => ({ key: row.id, label: row.label, x: row.updatedAt, y: row.tokens }))
  return (
    <Trendline
      title={t('history.trend.tokens')}
      valueLabel={t('metric.tokens')}
      points={points}
      emptyLabel={t('empty.history')}
      t={t}
      formatValue={value => formatTokens(value, t)}
    />
  )
}
