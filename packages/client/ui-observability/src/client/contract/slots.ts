/**
 * The Observability tab's extension seats.
 *
 * `sidebar.right.pane.tab.controls` is the strip the panel renders above its
 * views. The dashboard itself is a read side and owns no control over a run;
 * the browser plugin that does (`ui-step-mode`) fills this seat so its Step,
 * Resume, and Stop sit beside the Flow ledger the user is reading.
 */

/** Owner share of the panel's control strip (the panel supplies nothing). */
export interface ObservabilityControlsOwnerProps {
  /** Marker field: the strip receives no owner-specific values. */
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One control strip above the dashboard's views, bound to the current
     * Session. An unoccupied seat renders nothing.
     */
    'sidebar.right.pane.tab.controls': {
      kind: 'single'
      scope: 'session'
      owner: ObservabilityControlsOwnerProps
    }
  }
}
