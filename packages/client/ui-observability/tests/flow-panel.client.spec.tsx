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
    {
      kind: 'tool-result', seq: 5, time: 2_060, callId: 'c1', callTime: 2_055, isError: false,
      subCalls: [{ name: 'inner', argsRaw: '{"deep":true}' }],
      call: { name: 'read', argsRaw: '{"path":"x"}' },
      content: [{ type: 'text', text: LONG_TEXT }],
    },
  ],
  eventLocations: new Map(),
  requests: [{
    purpose: 'assistant', startSeq: 3, startedAt: 2_100, completedAt: 2_200, status: 'complete',
    turn: 1, step: 2,
    providerMetadata: { provider: 'deepseek', model: 'v4' },
    requestConfig: { provider: 'deepseek', model: 'v4', temperature: 0.2, maxTokens: 2_048 },
    prompt: {
      config: { provider: 'deepseek', model: 'v4', temperature: 0.2, maxTokens: 2_048 },
      system: 'you are a harness',
      tools: [
        { name: 'read', description: 'read a file', parameters: {} },
        { name: 'bash', description: 'run a command', parameters: {} },
      ],
    },
    promptChange: { seq: 3, time: 2_100, kind: 'tools' },
  }, {
    // A running request records no prompt snapshot, so its facts are the
    // configuration, the settlement it reported, and its retry ordinal.
    purpose: 'assistant', startSeq: 60, startedAt: 2_400, completedAt: null, status: 'running',
    turn: 1, step: 3,
    providerMetadata: { provider: 'deepseek', model: 'v5' },
    usage: { inputTokens: 5, outputTokens: 6 },
    retry: 1,
  }],
  callSchemas: new Map(),
  partial: null,
  runningCalls: [{ callId: 'c2', name: 'grep', argsRaw: '{"q":"x"}', turn: 1, step: 2, time: 2_300, subCalls: [] }],
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
    expect(screen.getAllByText(zh['flow.counts'].replace('{calls}', '3').replace('{messages}', '1')).length)
      .toBeGreaterThan(0)
    expect(screen.getByText(zh['flow.role.user'])).toBeTruthy()
    expect(screen.getByText('hello harness')).toBeTruthy()
    expect(screen.getByText('working on it')).toBeTruthy()
    expect(screen.getAllByText('deepseek').length).toBeGreaterThan(0)
    // The step chip, the tool-catalog chip, the prompt-change chip, and both states.
    expect(screen.getAllByText(zh['flow.step'].replace('{value}', '2')).length).toBeGreaterThan(0)
    expect(screen.getByText(zh['flow.tools'].replace('{value}', '2'))).toBeTruthy()
    expect(screen.getAllByText(zh['flow.state.running']).length).toBeGreaterThan(0)
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

  it('expands a request row to the request its record describes', () => {
    render(<FlowPanel useTrajectory={seat(SNAPSHOT)} loadOlder={undefined} t={t} />)
    // The first request row is the settled one carrying a prompt snapshot.
    const requestRow = screen.getAllByText(zh['flow.role.request'])[0]?.closest('li')
    if (requestRow === null || requestRow === undefined) throw new Error('expected a request row')
    fireEvent.click(within(requestRow).getByRole('button', { name: zh['flow.detail.show'] }))
    // Configuration, prompt change, catalog, and the exact system prompt.
    expect(within(requestRow).getByText(zh['flow.request.provider'])).toBeTruthy()
    // The provider also names the row, so the fact repeats its value.
    expect(within(requestRow).getAllByText('deepseek').length).toBeGreaterThan(0)
    expect(within(requestRow).getByText(zh['flow.request.temperature'])).toBeTruthy()
    expect(within(requestRow).getByText('0.2')).toBeTruthy()
    expect(within(requestRow).getByText(zh['flow.request.maxTokens'])).toBeTruthy()
    expect(within(requestRow).getByText('2048')).toBeTruthy()
    expect(within(requestRow).getByText(zh['flow.request.duration'])).toBeTruthy()
    expect(within(requestRow).getByText(zh['flow.request.tools'])).toBeTruthy()
    expect(within(requestRow).getByText('read, bash')).toBeTruthy()
    expect(within(requestRow).getByText(zh['flow.role.system'])).toBeTruthy()
    expect(within(requestRow).getByText('you are a harness')).toBeTruthy()
    // Facts the record does not carry stay out of the table.
    expect(within(requestRow).queryByText(zh['flow.request.retry'])).toBeNull()
    expect(within(requestRow).queryByText(zh['flow.request.tokens'])).toBeNull()
  })

  it('renders only the request facts a running request actually recorded', () => {
    render(<FlowPanel useTrajectory={seat(SNAPSHOT)} loadOlder={undefined} t={t} />)
    const runningRow = screen.getAllByText(zh['flow.role.request'])[1]?.closest('li')
    if (runningRow === null || runningRow === undefined) throw new Error('expected a second request row')
    fireEvent.click(within(runningRow).getByRole('button', { name: zh['flow.detail.show'] }))
    expect(within(runningRow).getByText(zh['flow.request.tokens'])).toBeTruthy()
    expect(within(runningRow).getByText(zh['flow.request.retry'])).toBeTruthy()
    // No prompt snapshot means no catalog, no system prompt, and no duration yet.
    expect(within(runningRow).queryByText(zh['flow.request.temperature'])).toBeNull()
    expect(within(runningRow).queryByText(zh['flow.request.maxTokens'])).toBeNull()
    expect(within(runningRow).queryByText(zh['flow.request.duration'])).toBeNull()
    expect(within(runningRow).queryByText(zh['flow.request.tools'])).toBeNull()
    expect(within(runningRow).queryByText(zh['flow.role.system'])).toBeNull()
  })

  it('expands a tool row to its arguments, cut output, and nested calls', () => {
    render(<FlowPanel useTrajectory={seat(SNAPSHOT)} loadOlder={undefined} t={t} />)
    const toolRow = screen.getByText('read').closest('li')
    if (toolRow === null) throw new Error('expected a tool row')
    fireEvent.click(within(toolRow).getByRole('button', { name: zh['flow.detail.show'] }))
    expect(within(toolRow).getByText(zh['flow.tool.arguments'])).toBeTruthy()
    expect(within(toolRow).getByText('{"path":"x"}')).toBeTruthy()
    expect(within(toolRow).getByText(zh['flow.tool.output'])).toBeTruthy()
    expect(within(toolRow).getByText(LONG_TEXT)).toBeTruthy()
    expect(within(toolRow).getByText(zh['flow.tool.subCalls'])).toBeTruthy()
    expect(within(toolRow).getByText('inner {"deep":true}')).toBeTruthy()
    // A tool row with nothing beyond its preview offers no control.
    const deniedRow = screen.getByText('permission denied').closest('li')
    expect(within(deniedRow as HTMLElement).queryByRole('button')).toBeNull()
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
