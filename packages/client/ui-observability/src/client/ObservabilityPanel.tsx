/**
 * Registered sidebar-right tab body: reads per-session projections, the
 * session list, and the Trajectory seat through the framework's standard seats,
 * folds them into the dashboard view models, and switches between views.
 *
 * The view switcher is a table: a new view is one id, one tab row, and one
 * body — nothing else in this body changes.
 */

import { useState } from 'react'
import clsx from 'clsx'
import type {
  InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merge the projection keys this body reads into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: merge the Trajectory session-standard seat into SessionStandardProps.
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { buildAgentTree, buildHistoryRows, hasSessionFigures } from './observability-model.ts'
// Type-only: the panel's own controls seat declared in the contract module.
import type {} from './contract/slots.ts'
import type { ObservabilityInjected } from './face.ts'
import { FlowPanel } from './FlowPanel.tsx'
import { HistoryPanel } from './HistoryPanel.tsx'
import { SessionDashboard } from './SessionDashboard.tsx'
import { TimelinePanel } from './TimelinePanel.tsx'
import type { NS, ObservabilityKey } from './locales.ts'
import css from './ObservabilityPanel.module.css'

export type ObservabilityPanelProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsRenderSlots<'sidebar.right.pane.tab.controls'>
  & PropsLocale<typeof NS>
  & InjectFace<ObservabilityInjected>

/** Every view the dashboard offers, in tab order. */
type DashboardView = 'session' | 'timeline' | 'flow' | 'history'

interface ViewTab {
  readonly id: DashboardView
  readonly label: ObservabilityKey
}

/** The tab strip, in order; every id needs one body in the table below. */
const VIEW_TABS: readonly ViewTab[] = [
  { id: 'session', label: 'view.session' },
  { id: 'timeline', label: 'view.timeline' },
  { id: 'flow', label: 'view.flow' },
  { id: 'history', label: 'view.history' },
]

/**
 * Render the observability dashboard body.
 * @param props - session standard seats, the session list, the injected paging callback, and the translate seat.
 * @returns the panel.
 */
export function ObservabilityPanel({
  sessionId,
  useProjection,
  useSessions,
  useTrajectory,
  loadOlder,
  renderSlot,
  t,
}: ObservabilityPanelProps): React.JSX.Element {
  const [view, setView] = useState<DashboardView>('session')
  const usage = useProjection('tokenUsage')
  const stats = useProjection('sessionStats')
  const context = useProjection('contextPressure')
  const selection = useProjection('modelSelection')
  const activity = useProjection('activitySeries')
  const byId = useSessions(state => state.byId)
  const tree = buildAgentTree(sessionId, byId, Date.now())
  const rows = buildHistoryRows(byId)

  const bodies: Readonly<Record<DashboardView, () => React.JSX.Element>> = {
    session: () => hasSessionFigures(usage, stats)
      ? (
        <SessionDashboard
          model={selection?.lastUsed ?? undefined}
          usage={usage}
          stats={stats}
          context={context}
          tree={tree}
          t={t}
        />
      )
      : <p className={css.empty}>{t('empty.session')}</p>,
    timeline: () => <TimelinePanel series={activity} t={t} />,
    flow: () => <FlowPanel useTrajectory={useTrajectory} loadOlder={loadOlder} t={t} />,
    history: () => <HistoryPanel rows={rows} t={t} />,
  }

  return (
    <div className={css.root}>
      <header className={css.header}>
        <h2 className={css.heading}>{t('title')}</h2>
        <div className={css.tabs} role="tablist" aria-label={t('view.aria')}>
          {VIEW_TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              className={clsx(css.tab, view === tab.id && css.tabActive)}
              onClick={() => { setView(tab.id) }}
            >
              {t(tab.label)}
            </button>
          ))}
        </div>
      </header>
      {renderSlot('sidebar.right.pane.tab.controls', {})}
      <div className={css.body}>{bodies[view]()}</div>
    </div>
  )
}
