/**
 * Registered sidebar-right tab body: reads per-session projections and the
 * session list through the framework's standard seats, folds them into the
 * dashboard view model, and switches between the single-session and
 * cross-session views.
 */

import { useState } from 'react'
import clsx from 'clsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merge the projection keys this body reads into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { buildAgentTree, buildHistoryRows, hasSessionFigures } from './observability-model.ts'
import { HistoryPanel } from './HistoryPanel.tsx'
import { SessionDashboard } from './SessionDashboard.tsx'
import type { NS } from './locales.ts'
import css from './ObservabilityPanel.module.css'

export type ObservabilityPanelProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>

type DashboardView = 'session' | 'history'

/**
 * Render the observability dashboard body.
 * @param props - session standard seats, the session list, and the translate seat.
 * @returns the panel.
 */
export function ObservabilityPanel({ sessionId, useProjection, useSessions, t }: ObservabilityPanelProps): React.JSX.Element {
  const [view, setView] = useState<DashboardView>('session')
  const usage = useProjection('tokenUsage')
  const stats = useProjection('sessionStats')
  const context = useProjection('contextPressure')
  const selection = useProjection('modelSelection')
  const byId = useSessions(state => state.byId)
  const tree = buildAgentTree(sessionId, byId, Date.now())
  const rows = buildHistoryRows(byId)
  const isSession = view === 'session'

  let content: React.JSX.Element
  if (!isSession) {
    content = <HistoryPanel rows={rows} t={t} />
  } else if (hasSessionFigures(usage, stats)) {
    content = (
      <SessionDashboard
        model={selection?.lastUsed ?? undefined}
        usage={usage}
        stats={stats}
        context={context}
        tree={tree}
        t={t}
      />
    )
  } else {
    content = <p className={css.empty}>{t('empty.session')}</p>
  }

  return (
    <div className={css.root}>
      <header className={css.header}>
        <h2 className={css.heading}>{t('title')}</h2>
        <div className={css.tabs} role="tablist" aria-label={t('view.aria')}>
          <button
            type="button"
            role="tab"
            aria-selected={isSession}
            className={clsx(css.tab, isSession && css.tabActive)}
            onClick={() => { setView('session') }}
          >
            {t('view.session')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={!isSession}
            className={clsx(css.tab, !isSession && css.tabActive)}
            onClick={() => { setView('history') }}
          >
            {t('view.history')}
          </button>
        </div>
      </header>
      <div className={css.body}>{content}</div>
    </div>
  )
}
