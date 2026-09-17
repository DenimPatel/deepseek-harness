// @vitest-environment jsdom
/** The registered dashboard body: its view tabs over stub standard seats. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ActivityMetricId, ActivitySeriesProjection } from '@deepseek-ai/dsh-session-stats/client'
import type { TrajectorySnapshot, UseTrajectory } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { ObservabilityPanel } from '../src/client/ObservabilityPanel.tsx'
import type { ObservabilityPanelProps } from '../src/client/ObservabilityPanel.tsx'
import { ACTIVITY_METRICS } from '../src/client/activity-model.ts'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const SESSION = 'session' as SessionId

afterEach(cleanup)

/** One projected histogram with every column present. */
function histogram(columns: Partial<Record<ActivityMetricId, readonly number[]>>): ActivitySeriesProjection {
  return {
    originMs: 0,
    bucketMs: 5_000,
    series: Object.fromEntries(
      ACTIVITY_METRICS.map(metric => [metric.id, [...(columns[metric.id] ?? [])]]),
    ) as unknown as ActivitySeriesProjection['series'],
  }
}

function props(over: {
  readonly projections?: Record<string, unknown>
  readonly byId?: Record<string, unknown>
  readonly snapshot?: TrajectorySnapshot
} = {}): ObservabilityPanelProps {
  const projections = over.projections ?? {}
  const byId = over.byId ?? {}
  const snapshot: TrajectorySnapshot = over.snapshot ?? {
    eventNodes: [], eventLocations: new Map(), requests: [],
    callSchemas: new Map(), partial: null, runningCalls: [],
  }
  const useTrajectory: UseTrajectory = selector => selector(snapshot)
  return {
    sessionId: SESSION,
    useProjection: (key: string) => projections[key],
    useSessions: (selector: (state: unknown) => unknown) => selector({ byId }),
    useTrajectory,
    loadOlder: () => Promise.resolve(false),
    t,
  } as unknown as ObservabilityPanelProps
}

const FIGURES = {
  tokenUsage: { uncachedInputTokens: 100, outputTokens: 50, cacheReadTokens: 300, cacheWriteTokens: 0 },
  sessionStats: {
    turns: 2, steps: 3, llmMs: 4000, toolMs: 1000,
    ttftMs: 600, ttftSteps: 3, decodeMs: 2000, decodeTokens: 100,
  },
  contextPressure: { projectedTokens: 500, contextWindow: 1000 },
  modelSelection: { lastUsed: { provider: 'deepseek', model: 'v4' }, pending: null },
  activitySeries: histogram({ toolCalls: [1, 2], toolErrors: [0, 1] }),
}

describe('ObservabilityPanel', () => {
  it('renders the session view with the metric strip and both donuts', () => {
    render(<ObservabilityPanel {...props({ projections: FIGURES })} />)
    expect(screen.getByText(zh['title'])).toBeTruthy()
    expect(screen.getByText('deepseek')).toBeTruthy()
    expect(screen.getByText('v4')).toBeTruthy()
    expect(screen.getByText(zh['token.title'])).toBeTruthy()
    expect(screen.getByText(zh['time.title'])).toBeTruthy()
    expect(screen.getByText(zh['tree.title'])).toBeTruthy()
  })

  it('shows the empty copy when no figures have arrived', () => {
    render(<ObservabilityPanel {...props()} />)
    expect(screen.getByText(zh['empty.session'])).toBeTruthy()
  })

  it('renders the session view without a recorded model selection', () => {
    const { modelSelection: _absent, ...withoutSelection } = FIGURES
    render(<ObservabilityPanel {...props({ projections: withoutSelection })} />)
    expect(screen.getByText(zh['token.title'])).toBeTruthy()
    expect(screen.queryByText('deepseek')).toBeNull()
  })

  it('switches to the activity timeline', () => {
    render(<ObservabilityPanel {...props({ projections: FIGURES })} />)
    fireEvent.click(screen.getByRole('tab', { name: zh['view.timeline'] }))
    expect(screen.getByLabelText(zh['timeline.metric'])).toBeTruthy()
    expect(screen.getByText(zh['timeline.totals'])).toBeTruthy()
  })

  it('shows the timeline empty copy without an activity projection', () => {
    const { activitySeries: _absent, ...withoutActivity } = FIGURES
    render(<ObservabilityPanel {...props({ projections: withoutActivity })} />)
    fireEvent.click(screen.getByRole('tab', { name: zh['view.timeline'] }))
    expect(screen.getByText(zh['timeline.empty'])).toBeTruthy()
  })

  it('switches to the harness flow', () => {
    render(<ObservabilityPanel {...props({
      snapshot: {
        eventNodes: [{ kind: 'user', seq: 1, time: 10, source: null, content: [{ type: 'text', text: 'hello' }] }],
        eventLocations: new Map(),
        requests: [],
        callSchemas: new Map(),
        partial: null,
        runningCalls: [],
      } as unknown as TrajectorySnapshot,
    })} />)
    fireEvent.click(screen.getByRole('tab', { name: zh['view.flow'] }))
    expect(screen.getByText(zh['flow.betweenTurns'])).toBeTruthy()
    expect(screen.getByText('hello')).toBeTruthy()
  })

  it('switches to the cross-session history view', () => {
    render(<ObservabilityPanel {...props({
      projections: FIGURES,
      byId: {
        [SESSION]: { id: SESSION, updatedAt: 1, running: false, blank: false, displayTitle: 'Session' },
      },
    })} />)
    fireEvent.click(screen.getByRole('tab', { name: zh['view.history'] }))
    expect(screen.getByText(zh['history.table.title'])).toBeTruthy()
    expect(screen.getByText(zh['history.trend.tokens'])).toBeTruthy()
  })
})
