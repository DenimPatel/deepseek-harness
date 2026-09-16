/** Cross-session history: a token trendline over a sortable exact-figure table. */

import { useMemo, useState } from 'react'
import { formatDuration, formatTokens } from './format.ts'
import type { ObservabilityTranslate } from './format.ts'
import type { HistoryRow } from './observability-model.ts'
import { SessionTrendline } from './SessionTrendline.tsx'
import css from './HistoryPanel.module.css'

/** Columns a history row can be ordered by; rows default to newest-first. */
export type HistorySortKey = 'tokens' | 'durationMs' | 'subagentCount'

export interface HistoryPanelProps {
  readonly rows: readonly HistoryRow[]
  readonly t: ObservabilityTranslate
}

interface Column {
  readonly key: HistorySortKey
  readonly label: 'history.col.tokens' | 'history.col.duration' | 'history.col.subagents'
}

const COLUMNS: readonly Column[] = [
  { key: 'tokens', label: 'history.col.tokens' },
  { key: 'durationMs', label: 'history.col.duration' },
  { key: 'subagentCount', label: 'history.col.subagents' },
]

/**
 * Render the cross-session history view.
 * @param props - history rows and the bound translate seat.
 * @returns the history panel.
 */
export function HistoryPanel({ rows, t }: HistoryPanelProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<HistorySortKey | null>(null)
  const [ascending, setAscending] = useState(false)
  const ordered = useMemo(() => {
    if (sortKey === null) return [...rows].sort((left, right) =>
      right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    const direction = ascending ? 1 : -1
    return [...rows].sort((left, right) =>
      (valueOf(left, sortKey) - valueOf(right, sortKey)) * direction || left.id.localeCompare(right.id))
  }, [rows, sortKey, ascending])

  if (rows.length === 0) {
    return (
      <section className={css.root} aria-label={t('history.title')}>
        <h3 className={css.title}>{t('history.title')}</h3>
        <p className={css.empty}>{t('empty.history')}</p>
      </section>
    )
  }

  const toggle = (key: HistorySortKey): void => {
    if (key === sortKey) { setAscending(current => !current); return }
    setSortKey(key)
    setAscending(false)
  }
  const ariaSort = (key: HistorySortKey): 'ascending' | 'descending' | 'none' =>
    key === sortKey ? (ascending ? 'ascending' : 'descending') : 'none'

  return (
    <section className={css.root} aria-label={t('history.title')}>
      <SessionTrendline rows={rows} t={t} />
      <h3 className={css.title}>{t('history.table.title')}</h3>
      <table className={css.table}>
        <thead>
          <tr>
            <th scope="col">{t('history.col.session')}</th>
            {COLUMNS.map(column => (
              <th key={column.key} scope="col" aria-sort={ariaSort(column.key)}>
                <button type="button" className={css.sortButton} onClick={() => { toggle(column.key) }}>
                  {t(column.label)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.map(row => (
            <tr key={row.id}>
              <th scope="row" className={css.sessionCell}>{row.label}</th>
              <td>{formatTokens(row.tokens, t)}</td>
              <td>{row.durationMs === undefined ? t('value.none') : formatDuration(row.durationMs, t)}</td>
              <td>{String(row.subagentCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function valueOf(row: HistoryRow, key: HistorySortKey): number {
  return key === 'tokens' ? row.tokens : key === 'durationMs' ? row.durationMs ?? 0 : row.subagentCount
}
