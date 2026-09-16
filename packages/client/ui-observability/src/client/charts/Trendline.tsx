/**
 * Hand-built trend line: an SVG polyline over a numeric series, with a
 * "view as table" fallback for exact values. Pure props in, SVG and DOM out.
 */

import { useState } from 'react'
import type { ObservabilityTranslate } from '../format.ts'
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
  const [showTable, setShowTable] = useState(false)
  const tableId = `trend-table-${title.replace(/\s+/g, '-').toLowerCase()}`
  const format = formatValue ?? ((value: number) => String(Math.round(value)))

  if (points.length === 0) {
    return (
      <section className={css.root} aria-label={t('chart.aria', { title })}>
        <h3 className={css.title}>{title}</h3>
        <p className={css.empty}>{emptyLabel}</p>
      </section>
    )
  }

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
    <section className={css.root} aria-label={t('chart.aria', { title })}>
      <h3 className={css.title}>{title}</h3>
      <svg className={css.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('chart.aria', { title })}>
        <line className={css.axis} x1={PAD_X} y1={HEIGHT - PAD_BOTTOM} x2={WIDTH - PAD_X} y2={HEIGHT - PAD_BOTTOM} />
        <polyline className={css.line} points={path} fill="none" />
        {points.map(point => (
          <circle key={point.key} className={css.dot} cx={scaleX(point.x)} cy={scaleY(point.y)} r="2.5" />
        ))}
        <text className={css.axisLabel} x={PAD_X} y={PAD_TOP - 6}>{format(yMax)}</text>
        <text className={css.axisLabel} x={WIDTH - PAD_X} y={HEIGHT - PAD_BOTTOM + 14} textAnchor="end">{valueLabel}</text>
      </svg>
      <button
        type="button"
        className={css.tableToggle}
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => { setShowTable(current => !current) }}
      >
        {showTable ? t('table.hide') : t('table.show')}
      </button>
      {showTable && (
        <table className={css.table} id={tableId}>
          <thead>
            <tr>
              <th scope="col">{t('table.metric')}</th>
              <th scope="col">{t('table.value')}</th>
            </tr>
          </thead>
          <tbody>
            {points.map(point => (
              <tr key={point.key}>
                <th scope="row">{point.label}</th>
                <td>{format(point.y)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
