/**
 * Hand-built donut chart: one `<circle>` per segment using stroke arithmetic,
 * plus a legend and a "view as table" fallback. Pure props in, SVG and DOM out.
 */

import { useState } from 'react'
import clsx from 'clsx'
import { formatTokens } from '../format.ts'
import type { ObservabilityTranslate } from '../format.ts'
import css from './Pie.module.css'

/** Series tone selecting a semantic palette entry; colors live in the module CSS. */
export type PieTone = 'input' | 'cached' | 'output' | 'llm' | 'tool' | 'muted'

/** One named, non-negative slice of the whole. */
export interface PieSlice {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly tone: PieTone
}

export interface PieProps {
  /** Section heading, also the chart's accessible name. */
  readonly title: string
  readonly slices: readonly PieSlice[]
  /** Shown in place of the chart when every slice is zero. */
  readonly emptyLabel: string
  readonly t: ObservabilityTranslate
}

const RADIUS = 40
const STROKE = 14
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Render a donut with legend and exact-value table.
 * @param props - title, slices, empty copy, and the bound translate seat.
 * @returns the chart section.
 */
export function Pie({ title, slices, emptyLabel, t }: PieProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false)
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0)
  const tableId = `pie-table-${title.replace(/\s+/g, '-').toLowerCase()}`

  if (total <= 0) {
    return (
      <section className={css.root} aria-label={t('chart.aria', { title })}>
        <h3 className={css.title}>{title}</h3>
        <p className={css.empty}>{emptyLabel}</p>
      </section>
    )
  }

  let offset = 0
  return (
    <section className={css.root} aria-label={t('chart.aria', { title })}>
      <h3 className={css.title}>{title}</h3>
      <div className={css.body}>
        <svg className={css.chart} viewBox="0 0 100 100" role="img" aria-label={t('chart.aria', { title })}>
          <g transform="rotate(-90 50 50)">
            <circle className={css.track} cx="50" cy="50" r={RADIUS} fill="none" strokeWidth={STROKE} />
            {slices.map((slice) => {
              const fraction = Math.max(0, slice.value) / total
              const dash = fraction * CIRCUMFERENCE
              const element = (
                <circle
                  key={slice.key}
                  className={clsx(css.slice)}
                  data-tone={slice.tone}
                  cx="50"
                  cy="50"
                  r={RADIUS}
                  fill="none"
                  strokeWidth={STROKE}
                  strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                  strokeDashoffset={-offset}
                />
              )
              offset += dash
              return element
            })}
          </g>
        </svg>
        <ul className={css.legend}>
          {slices.map(slice => (
            <li key={slice.key} className={css.legendItem}>
              <span className={css.swatch} data-tone={slice.tone} aria-hidden="true" />
              <span className={css.legendLabel}>{slice.label}</span>
              <span className={css.legendValue}>{formatTokens(slice.value, t)}</span>
              <span className={css.legendShare}>
                {t('value.percent', { value: ((Math.max(0, slice.value) / total) * 100).toFixed(1) })}
              </span>
            </li>
          ))}
        </ul>
      </div>
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
            {slices.map(slice => (
              <tr key={slice.key}>
                <th scope="row">{slice.label}</th>
                <td>{String(Math.round(slice.value))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
