/** One labeled metric cell in the dashboard's metric strip. */

import css from './StatTile.module.css'

export interface StatTileProps {
  readonly label: string
  readonly value: string
  /** Optional secondary reading shown beneath the value. */
  readonly hint?: string | undefined
}

/**
 * Render one metric tile.
 * @param props - label, formatted value, and optional hint.
 * @returns the tile.
 */
export function StatTile({ label, value, hint }: StatTileProps): React.JSX.Element {
  return (
    <div className={css.root}>
      <span className={css.label}>{label}</span>
      <span className={css.value}>{value}</span>
      {hint !== undefined && <span className={css.hint}>{hint}</span>}
    </div>
  )
}
