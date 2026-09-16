// @vitest-environment jsdom
/** The registered dashboard body: session and history views over stub seats. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { ObservabilityPanel } from '../src/client/ObservabilityPanel.tsx'
import type { ObservabilityPanelProps } from '../src/client/ObservabilityPanel.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const SESSION = 'session' as SessionId

afterEach(cleanup)

function props(over: {
  readonly projections?: Record<string, unknown>
  readonly byId?: Record<string, unknown>
} = {}): ObservabilityPanelProps {
  const projections = over.projections ?? {}
  const byId = over.byId ?? {}
  return {
    sessionId: SESSION,
    useProjection: (key: string) => projections[key],
    useSessions: (selector: (state: unknown) => unknown) => selector({ byId }),
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
