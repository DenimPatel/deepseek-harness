// @vitest-environment jsdom
/**
 * The Flow view: the unavailable state without the Trajectory seat, the empty
 * state, turn ledgers with their chips and expandable detail, and the
 * older-history control that stops at the start of the log.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { UseTrajectory } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { FlowPanel } from '../src/client/FlowPanel.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)
const LONG_TEXT = 'y'.repeat(200)

afterEach(cleanup)

const SNAPSHOT = {
  systemPrompts: [{ seq: 50, time: 100, turn: 1, step: 1, text: LONG_TEXT }],
  eventNodes: [
    { kind: 'user', seq: 1, time: 1_000, source: null, content: [{ type: 'text', text: 'hello harness' }] },
    {
      kind: 'assistant', seq: 2, time: 2_000, turn: 1, step: 2,
      blocks: [{ kind: 'reasoning', text: 'weighing options' }, { kind: 'text', text: 'working on it' }],
    },
    {
      kind: 'tool-result', seq: 4, time: 2_050, turn: 1, step: 2, callId: 'c0', callTime: 2_010,
      isError: true, subCalls: [], call: null,
      content: [{ type: 'text', text: 'permission denied' }],
    },
  ],
  eventLocations: new Map(),
  requests: [{
    purpose: 'assistant', startSeq: 3, startedAt: 2_100, completedAt: 2_200, status: 'complete',
    turn: 1, step: 2,
    providerMetadata: { provider: 'deepseek', model: 'v4' },
    requestConfig: { provider: 'deepseek', model: 'v4' },
    prompt: { config: { provider: 'deepseek', model: 'v4' }, system: 'sys', tools: [{}, {}] },
    promptChange: { seq: 3, time: 2_100, kind: 'tools' },
  }],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [{ callId: 'c1', name: 'read', argsRaw: '{"path":"x"}', turn: 1, step: 2, time: 2_300, subCalls: [] }],
} as unknown as TrajectorySnapshot

const seat = (snapshot: TrajectorySnapshot): UseTrajectory => selector => selector(snapshot)

/** A snapshot with no records at all. */
function emptySnapshot(): TrajectorySnapshot {
  return {
    eventNodes: [], eventLocations: new Map(), requests: [],
    callSchemas: new Map(), partial: null, runningCalls: [],
  }
}

describe('FlowPanel', () => {
  it('says the data is unavailable when no plugin provides the Trajectory seat', () => {
    render(<FlowPanel useTrajectory={undefined} loadOlder={undefined} t={t} />)
    expect(screen.getByText(zh['flow.unavailable'])).toBeTruthy()
  })

  it('says the session has no flow yet when the snapshot is empty', () => {
    render(<FlowPanel useTrajectory={seat(emptySnapshot())} loadOlder={undefined} t={t} />)
    expect(screen.getByText(zh['flow.empty'])).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders one ledger per turn with roles, chips, counts, and previews', () => {
    render(<FlowPanel useTrajectory={seat(SNAPSHOT)} loadOlder={undefined} t={t} />)
    expect(screen.getByRole('heading', { name: zh['flow.turn'].replace('{value}', '1') })).toBeTruthy()
    expect(screen.getAllByText(zh['flow.counts'].replace('{calls}', '1').replace('{messages}', '1')).length)
      .toBeGreaterThan(0)
    expect(screen.getByText(zh['flow.role.user'])).toBeTruthy()
    expect(screen.getByText('hello harness')).toBeTruthy()
    expect(screen.getByText('working on it')).toBeTruthy()
    expect(screen.getByText('deepseek')).toBeTruthy()
    // The step chip, the tool-catalog chip, the prompt-change chip, and both states.
    expect(screen.getAllByText(zh['flow.step'].replace('{value}', '2')).length).toBeGreaterThan(0)
    expect(screen.getByText(zh['flow.tools'].replace('{value}', '2'))).toBeTruthy()
    expect(screen.getByText(zh['flow.state.running'])).toBeTruthy()
    expect(screen.getByText(zh['flow.state.error'])).toBeTruthy()
    expect(screen.getByText(zh['flow.change.tools'])).toBeTruthy()
  })

  it('expands a row to its exact text and reasoning', () => {
    render(<FlowPanel useTrajectory={seat(SNAPSHOT)} loadOlder={undefined} t={t} />)
    // The system prompt preview was cut, so its row keeps the exact text.
    const promptRow = screen.getByText(zh['flow.role.system']).closest('li')
    if (promptRow === null) throw new Error('expected a system prompt row')
    fireEvent.click(within(promptRow).getByRole('button', { name: zh['flow.detail.show'] }))
    expect(within(promptRow).getByText(LONG_TEXT)).toBeTruthy()
    fireEvent.click(within(promptRow).getByRole('button', { name: zh['flow.detail.hide'] }))
    expect(within(promptRow).queryByText(LONG_TEXT)).toBeNull()
    // The assistant row keeps its reasoning beside the preview.
    const assistantRow = screen.getByText('working on it').closest('li')
    if (assistantRow === null) throw new Error('expected an assistant row')
    fireEvent.click(within(assistantRow).getByRole('button', { name: zh['flow.detail.show'] }))
    expect(within(assistantRow).getByText('weighing options')).toBeTruthy()
  })

  it('keeps paging history until a page moves nothing', async () => {
    const loadOlder = vi.fn(() => Promise.resolve(true))
    render(<FlowPanel useTrajectory={seat(SNAPSHOT)} loadOlder={loadOlder} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['flow.loadOlder'] }))
    await waitFor(() => { expect(loadOlder).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('button', { name: zh['flow.loadOlder'] })).toBeTruthy()
  })

  it('hides the control and shows pending copy while a page loads', async () => {
    let settle: (moved: boolean) => void = () => {}
    const loadOlder = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve }))
    render(<FlowPanel useTrajectory={seat(SNAPSHOT)} loadOlder={loadOlder} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['flow.loadOlder'] }))
    const pending = screen.getByRole('button', { name: zh['flow.loading'] })
    expect(pending).toBeTruthy()
    expect(pending.hasAttribute('disabled')).toBe(true)
    settle(false)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: zh['flow.loading'] })).toBeNull()
      expect(screen.queryByRole('button', { name: zh['flow.loadOlder'] })).toBeNull()
    })
  })
})
