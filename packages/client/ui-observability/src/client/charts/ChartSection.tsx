/**
 * Shared chart shell: the titled section, the empty copy, and the exact-value
 * "view as table" fallback every hand-built chart in this dashboard uses. Each
 * chart supplies its own SVG body and its own table rows.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ObservabilityTranslate } from '../format.ts'
import css from './ChartSection.module.css'

/** One exact-value table row: the plotted name and its unrounded rendering. */
export interface ChartSectionRow {
  readonly key: string
  /** Row header — a bucket label, a session title, or a slice name. */
  readonly label: string
  /** The already-formatted exact value. */
  readonly value: string
}

export interface ChartSectionProps {
  /** Section heading, also the chart's accessible name. */
  readonly title: string
  /** Shown in place of the body when the chart has nothing to plot. */
  readonly emptyLabel: string
  /** Whether the chart has nothing to plot; an empty chart offers no table. */
  readonly empty: boolean
  readonly rows: readonly ChartSectionRow[]
  /** Prefix of the table element's id, unique per chart kind. */
  readonly idPrefix: string
  readonly t: ObservabilityTranslate
  /** The chart body, rendered above the table control. */
  readonly children: ReactNode
}

/**
 * Render one chart with its section chrome and exact-value fallback.
 * @param props - title, empty copy, rows, id prefix, translate, and the chart body.
 * @returns the chart section.
 */
export function ChartSection({
  title,
  emptyLabel,
  empty,
  rows,
  idPrefix,
  t,
  children,
}: ChartSectionProps): React.JSX.Element {
  const [showTable, setShowTable] = useState(false)
  const tableId = `${idPrefix}-${title.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <section className={css.root} aria-label={t('chart.aria', { title })}>
      <h3 className={css.title}>{title}</h3>
      {empty
        ? <p className={css.empty}>{emptyLabel}</p>
        : (
          <>
            {children}
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
                  {rows.map(row => (
                    <tr key={row.key}>
                      <th scope="row">{row.label}</th>
                      <td>{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
    </section>
  )
}
