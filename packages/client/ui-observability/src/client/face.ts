/**
 * Injected values the observability body and its flow ledger consume, produced
 * by the plugin's apply closure. Plain data and callbacks only.
 */

export interface ObservabilityInjected {
  /**
   * Page the Session window older and report whether it moved, so the flow
   * ledger stops offering history paging at the start of the log.
   * @returns `true` when the Trajectory snapshot changed after paging.
   */
  readonly loadOlder: () => Promise<boolean>
}
