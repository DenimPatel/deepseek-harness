/**
 * Hand-built trend line: an SVG polyline over a numeric series, inside the
 * shared chart shell whose table exposes exact values. Pure props in, SVG and
 * DOM out.
 */

import type { ObservabilityTranslate } from '../format.ts'
import { ChartSection } from './ChartSection.tsx'
import type { ChartSectionRow } from './ChartSection.tsx'
import css from './Trendline.module.css'

/** One measured point; `x` is a comparable ordinal (index or timestamp). */
export interface TrendPoint {
  readonly key: string
  readonly label: string
  readonly x: number
  readonly y: number
}

export interface TrendlineProps {
  /** Section heading, also the chart's accessible name. */
  readonly title: string
  /** Legend text for the measured series. */
  readonly valueLabel: string
  readonly points: readonly TrendPoint[]
  /** Shown in place of the chart when there is nothing to plot. */
  readonly emptyLabel: string
  readonly t: ObservabilityTranslate
  /** Formats the y value for the top axis label and the table; raw numbers otherwise. */
  readonly formatValue?: ((value: number) => string) | undefined
}

const WIDTH = 320
const HEIGHT = 120
const PAD_X = 8
const PAD_TOP = 16
const PAD_BOTTOM = 20

/**
 * Render a line over the point series.
 * @param props - title, series legend, points, empty copy, translate, and optional value formatter.
 * @returns the chart section.
 */
export function Trendline({ title, valueLabel, points, emptyLabel, t, formatValue }: TrendlineProps): React.JSX.Element {
  const format = formatValue ?? ((value: number) => String(Math.round(value)))
  const rows: readonly ChartSectionRow[] = points.map(point => ({
    key: point.key,
    label: point.label,
    value: format(point.y),
  }))

  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMax = Math.max(...ys, 0)
  const scaleX = (x: number): number => xMax === xMin
    ? WIDTH / 2
    : PAD_X + ((x - xMin) / (xMax - xMin)) * (WIDTH - PAD_X * 2)
  const scaleY = (y: number): number => yMax <= 0
    ? HEIGHT - PAD_BOTTOM
    : HEIGHT - PAD_BOTTOM - (y / yMax) * (HEIGHT - PAD_TOP - PAD_BOTTOM)
  const path = points.map(point => `${scaleX(point.x)},${scaleY(point.y)}`).join(' ')

  return (
    <ChartSection
      title={title}
      emptyLabel={emptyLabel}
      empty={points.length === 0}
      rows={rows}
      idPrefix="trend-table"
      t={t}
    >
      <svg className={css.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('chart.aria', { title })}>
        <line className={css.axis} x1={PAD_X} y1={HEIGHT - PAD_BOTTOM} x2={WIDTH - PAD_X} y2={HEIGHT - PAD_BOTTOM} />
        <polyline className={css.line} points={path} fill="none" />
        {points.map(point => (
          <circle key={point.key} className={css.dot} cx={scaleX(point.x)} cy={scaleY(point.y)} r="2.5" />
        ))}
        <text className={css.axisLabel} x={PAD_X} y={PAD_TOP - 6}>{format(yMax)}</text>
        <text className={css.axisLabel} x={WIDTH - PAD_X} y={HEIGHT - PAD_BOTTOM + 14} textAnchor="end">{valueLabel}</text>
      </svg>
    </ChartSection>
  )
}
