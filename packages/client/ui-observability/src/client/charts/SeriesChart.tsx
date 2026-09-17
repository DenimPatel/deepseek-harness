/**
 * Hand-built bucketed bar chart: one SVG rect per bucket, inside the shared
 * chart shell whose table exposes exact values. Pure props in, SVG and DOM out.
 */

import type { ObservabilityTranslate } from '../format.ts'
import { ChartSection } from './ChartSection.tsx'
import type { ChartSectionRow } from './ChartSection.tsx'
import css from './SeriesChart.module.css'

/** One plotted bucket; `label` is its locale-formatted axis text. */
export interface SeriesBar {
  readonly key: string
  readonly label: string
  readonly value: number
}

export interface SeriesChartProps {
  /** Section heading, also the chart's accessible name. */
  readonly title: string
  /** Legend text for the plotted metric. */
  readonly valueLabel: string
  readonly bars: readonly SeriesBar[]
  /** Shown in place of the chart when there is nothing to plot. */
  readonly emptyLabel: string
  readonly t: ObservabilityTranslate
  /** Formats a value for the top axis label and the table; raw numbers otherwise. */
  readonly formatValue?: ((value: number) => string) | undefined
}

const WIDTH = 320
const HEIGHT = 120
const PAD_X = 8
const PAD_TOP = 16
const PAD_BOTTOM = 20

/**
 * Render one bar per bucket.
 * @param props - title, metric legend, bars, empty copy, translate, and optional value formatter.
 * @returns the chart section.
 */
export function SeriesChart({ title, valueLabel, bars, emptyLabel, t, formatValue }: SeriesChartProps): React.JSX.Element {
  const format = formatValue ?? ((value: number) => String(Math.round(value)))
  const rows: readonly ChartSectionRow[] = bars.map(bar => ({
    key: bar.key,
    label: bar.label,
    value: format(bar.value),
  }))

  const yMax = Math.max(...bars.map(bar => bar.value), 0)
  const laneWidth = (WIDTH - PAD_X * 2) / bars.length
  const barWidth = Math.max(1, laneWidth - 1)
  const heightOf = (value: number): number => yMax <= 0
    ? 0
    : (value / yMax) * (HEIGHT - PAD_TOP - PAD_BOTTOM)

  return (
    <ChartSection
      title={title}
      emptyLabel={emptyLabel}
      empty={bars.length === 0}
      rows={rows}
      idPrefix="series-table"
      t={t}
    >
      <svg className={css.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('chart.aria', { title })}>
        <line className={css.axis} x1={PAD_X} y1={HEIGHT - PAD_BOTTOM} x2={WIDTH - PAD_X} y2={HEIGHT - PAD_BOTTOM} />
        {bars.map((bar, index) => {
          const height = heightOf(bar.value)
          return (
            <rect
              key={bar.key}
              className={css.bar}
              x={PAD_X + index * laneWidth}
              y={HEIGHT - PAD_BOTTOM - height}
              width={barWidth}
              height={height}
            />
          )
        })}
        <text className={css.axisLabel} x={PAD_X} y={PAD_TOP - 6}>{format(yMax)}</text>
        <text className={css.axisLabel} x={PAD_X} y={HEIGHT - PAD_BOTTOM + 14}>{bars[0]?.label}</text>
        <text className={css.axisLabel} x={WIDTH - PAD_X} y={HEIGHT - PAD_BOTTOM + 14} textAnchor="end">
          {bars.at(-1)?.label}
        </text>
        <text className={css.axisLabel} x={WIDTH - PAD_X} y={PAD_TOP - 6} textAnchor="end">{valueLabel}</text>
      </svg>
    </ChartSection>
  )
}
