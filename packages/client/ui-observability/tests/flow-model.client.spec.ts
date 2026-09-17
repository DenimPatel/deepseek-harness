/**
 * The Flow view-model fold: every record family the Trajectory snapshot can
 * carry lands in its turn ledger with the role, verbatim name, preview, exact
 * detail, and state a reader needs to follow what the harness did.
 */
import { describe, expect, it } from 'vitest'
import type {
  ConversationNode,
  ConversationLocation,
  ModelRetryNode,
  RequestView,
  StepLocation,
  TurnLocation,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationPromptSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { buildFlow } from '../src/client/flow-model.ts'

/** Build one synthetic node; the fixture's records are read structurally by the fold. */
function node(value: unknown): ConversationNode {
  return value as ConversationNode
}

const noData = { get: () => undefined, source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) }

/** One synthetic location entry. */
function at(turn: number, step?: number): ConversationLocation {
  const turnLocation = {
    turn, start: undefined, end: undefined, status: 'closed', steps: [], data: noData,
  } as unknown as TurnLocation
  if (step === undefined) return { kind: 'turn', turn: turnLocation }
  return {
    kind: 'step',
    turn: turnLocation,
    step: { turn, step, start: undefined, end: undefined, status: 'closed', data: noData } as unknown as StepLocation,
  }
}

const LONG_TEXT = 'x'.repeat(200)

const NODES: readonly ConversationNode[] = [
  node({
    kind: 'user', seq: 1, time: 1_000, source: null,
    content: [{ type: 'text', text: 'describe how does this repo work.' }],
  }),
  node({
    kind: 'context', seq: 2, time: 1_100, source: null, form: null,
    producer: { role: 'instructions', label: null },
    content: [
      { type: 'text', text: 'workspace instructions' },
      { type: 'tool-call', name: 'recall', arguments: '{}' },
      { type: 'tool-result', toolCallId: 'c9', content: [{ type: 'text', text: 'recalled' }] },
      { type: 'image', attachment: { id: 'a1' } },
    ],
  }),
  node({
    kind: 'assistant', seq: 3, time: 1_200, turn: 1, step: 1,
    blocks: [
      { kind: 'reasoning', text: 'thinking hard' },
      { kind: 'text', text: 'Exploring the repo' },
      { kind: 'tool-call', callId: 'c1', name: 'bash', argsRaw: '{}' },
      { kind: 'image', attachment: { id: 'a2' } },
      { kind: 'other', block: null },
    ],
  }),
  node({
    kind: 'tool-result', seq: 4, time: 1_300, callId: 'c1', callTime: 1_250, isError: false, subCalls: [],
    call: { name: 'bash', argsRaw: '{"cmd":"ls"}' },
    content: [{ type: 'text', text: 'a\nb' }],
  }),
  node({ kind: 'assistant', seq: 15, time: 1_350, turn: 1, step: 1, blocks: [], interrupted: true }),
  node({
    kind: 'tool-result', seq: 5, time: 1_400, callId: 'c2', call: null, callTime: null, isError: true, subCalls: [],
    content: [{ type: 'tool-result', toolCallId: 'c3', content: [{ type: 'text', text: 'nested' }] }],
  }),
  node({ kind: 'command', seq: 6, time: 1_500, commandId: 'cmd1', name: null, args: '--flag', outcome: null }),
  node({
    kind: 'command', seq: 7, time: 1_600, commandId: 'cmd2', name: 'plan', args: '',
    outcome: { kind: 'error', text: 'nope' },
  }),
  node({ kind: 'command', seq: 17, time: 1_650, commandId: 'cmd3', name: 'status', args: null, outcome: null }),
  node({
    kind: 'command', seq: 18, time: 1_660, commandId: 'cmd4', name: 'status', args: '',
    outcome: { kind: 'success', text: 'ok' },
  }),
  node({
    kind: 'model-retry', seq: 8, time: 1_700, turn: 1, step: 1, retryState: 'started',
    retryId: 'r1', provider: 'deepseek', mode: 'normal', policyKey: 'default',
    retry: 1, maxRetries: 3, delayMs: 100,
    failure: { message: 'rate limited', code: 'RATE' } as ModelRetryNode['failure'],
  }),
  node({
    kind: 'model-retry', seq: 9, time: 1_800, turn: 1, step: 1, retryState: 'cancelled',
    retryId: 'r2', provider: 'deepseek', mode: 'normal', policyKey: 'default',
    retry: 2, maxRetries: 3, delayMs: 200,
    failure: { message: 'again', code: 'RATE' } as ModelRetryNode['failure'],
  }),
  node({ kind: 'turn-error', seq: 10, time: 1_900, turn: 1, step: 1, message: 'failed', code: 'E' }),
  node({ kind: 'turn-error', seq: 16, time: 1_910, turn: 1, step: 1, message: 'no code' }),
  node({ kind: 'turn-max-tokens', seq: 11, time: 2_000, turn: 1, step: 1 }),
  node({
    kind: 'compaction', seq: 12, time: 2_100,
    summary: null, summaryEventSeq: null, shadowedItemCount: null, shadowedTokenCount: null,
  }),
  node({
    kind: 'steering', seq: 13, time: 2_200, messageId: 'm2', source: null,
    content: [{ type: 'text', text: 'steer left' }],
  }),
  node({ kind: 'unknown', seq: 14, time: 2_300, type: 'future/thing', data: null }),
]

const REQUESTS: readonly RequestView[] = [
  {
    purpose: 'assistant', startSeq: 20, startedAt: 2_400, completedAt: 2_500, status: 'complete',
    turn: 1, step: 1,
    providerMetadata: { provider: 'deepseek', model: 'v4' },
    prompt: {
      config: { provider: 'deepseek', model: 'v4' }, system: 'sys',
      tools: [{}, {}] as unknown as ConversationPromptSnapshot['tools'],
    },
    promptChange: { seq: 20, time: 2_400, kind: 'system' },
  },
  {
    purpose: 'assistant', startSeq: 40, startedAt: 4_000, completedAt: 4_100, status: 'error',
    error: 'boom', turn: 2, step: 1,
    requestConfig: { provider: 'deepseek', model: 'v5' },
  },
  {
    purpose: 'compaction', startSeq: 30, startedAt: 3_000, completedAt: null, status: 'running',
    turn: null, step: 0,
  },
]

const SNAPSHOT: TrajectorySnapshot = {
  systemPrompts: [
    { seq: 50, time: 100, turn: 0, step: 0, text: 'Initial system prompt', update: false },
    { seq: 51, time: 500, turn: 1, step: 1, text: LONG_TEXT, update: true },
  ],
  eventNodes: NODES,
  eventLocations: new Map<number, ConversationLocation>([
    [1, { kind: 'session' }],
    [2, at(1)],
    [4, at(1, 2)],
    [5, { kind: 'unresolved' }],
    [6, at(2, 1)],
  ]),
  requests: REQUESTS,
  callSchemas: new Map(),
  partial: { turn: 2, step: 1, blocks: [{ kind: 'text', text: 'streaming now' }] },
  runningCalls: [
    { callId: 'c3', name: 'read', argsRaw: '{"path":"x"}', turn: 2, step: 1, time: 4_200, subCalls: [] },
  ],
}

describe('buildFlow', () => {
  const turns = buildFlow(SNAPSHOT)
  const byTurn = new Map(turns.map(turn => [turn.turn, turn]))

  it('places numbered turns in order and the between-turns group last', () => {
    expect(turns.map(turn => turn.turn)).toEqual([0, 1, 2, null])
    expect(byTurn.get(0)?.seq).toBe(50)
  })

  it('counts tool calls and messages per turn', () => {
    expect(byTurn.get(1)).toMatchObject({ toolCalls: 1, messages: 2 })
    expect(byTurn.get(2)).toMatchObject({ toolCalls: 1, messages: 1 })
    expect(byTurn.get(null)?.toolCalls).toBe(1)
  })

  it('keeps the system prompt with its exact text when the preview is cut', () => {
    const rows = byTurn.get(1)?.rows ?? []
    const prompt = rows.find(row => row.role === 'flow.role.system')
    expect(prompt?.summary.endsWith('…')).toBe(true)
    expect(prompt?.detail).toBe(LONG_TEXT)
    expect(byTurn.get(0)?.rows[0]).toMatchObject({ role: 'flow.role.system', summary: 'Initial system prompt' })
  })

  it('reads user, steering, and context rows with their producer and layered text', () => {
    expect(byTurn.get(null)?.rows.find(row => row.role === 'flow.role.user')?.summary)
      .toBe('describe how does this repo work.')
    expect(byTurn.get(null)?.rows.find(row => row.role === 'flow.role.steering')?.summary).toBe('steer left')
    const context = byTurn.get(1)?.rows.find(row => row.role === 'flow.role.context')
    // The producer label is absent, so the role name stands in; the nested
    // tool-result text is part of the record's text.
    expect(context?.name).toBe('instructions')
    expect(context?.summary).toContain('workspace instructions')
    expect(context?.summary).toContain('recalled')
  })

  it('carries assistant reasoning, text, and the interrupted state', () => {
    const rows = byTurn.get(1)?.rows ?? []
    const assistant = rows.find(row => row.summary === 'Exploring the repo')
    expect(assistant).toMatchObject({ role: 'flow.role.assistant', reasoning: 'thinking hard', state: 'ok' })
    expect(rows.filter(row => row.state === 'error')).toHaveLength(3)
  })

  it('pairs tool results with their call and keeps the failure marker', () => {
    const rows = byTurn.get(1)?.rows ?? []
    const paired = rows.find(row => row.name === 'bash')
    expect(paired).toMatchObject({ role: 'flow.role.tool', summary: 'a b', detail: '{"cmd":"ls"}', state: 'ok' })
    const unpaired = byTurn.get(null)?.rows.find(row => row.role === 'flow.role.tool')
    expect(unpaired).toMatchObject({ summary: 'nested', state: 'error' })
    expect(unpaired?.name).toBeUndefined()
  })

  it('reads command lifecycle rows, including a running one without a name', () => {
    const running = byTurn.get(2)?.rows.find(row => row.role === 'flow.role.command')
    expect(running).toMatchObject({ summary: '--flag', state: 'running', step: 1 })
    expect(running?.name).toBeUndefined()
    const commands = byTurn.get(null)?.rows.filter(row => row.role === 'flow.role.command') ?? []
    expect(commands.find(row => row.name === 'plan')).toMatchObject({ summary: 'nope', state: 'error' })
    expect(commands.find(row => row.state === 'ok')).toMatchObject({ name: 'status', summary: 'ok' })
    // A command with neither a settled outcome nor recorded arguments previews empty.
    expect(commands.find(row => row.summary === '' && row.state === 'running')?.name).toBe('status')
  })

  it('reads retry, failure, limit, compaction, and unknown rows', () => {
    const rows = byTurn.get(1)?.rows ?? []
    expect(rows.find(row => row.role === 'flow.role.retry' && row.state === 'running'))
      .toMatchObject({ name: 'deepseek', summary: 'rate limited' })
    expect(rows.find(row => row.role === 'flow.role.retry' && row.state === 'ok')?.summary).toBe('again')
    expect(rows.find(row => row.role === 'flow.role.error')).toMatchObject({ name: 'E', summary: 'failed', state: 'error' })
    expect(rows.find(row => row.summary === 'no code')?.role).toBe('flow.role.error')
    expect(rows.find(row => row.role === 'flow.role.maxTokens')?.summary).toBe('')
    expect(byTurn.get(null)?.rows.find(row => row.role === 'flow.role.compaction')?.summary).toBe('')
    expect(byTurn.get(null)?.rows.find(row => row.role === 'flow.role.unknown')?.name).toBe('future/thing')
  })

  it('reads request rows with provider, tools, prompt change, and failures', () => {
    const rows = byTurn.get(1)?.rows ?? []
    expect(rows.find(row => row.role === 'flow.role.request'))
      .toMatchObject({ name: 'deepseek', summary: 'v4', tools: 2, change: 'system', step: 1, state: 'ok' })
    const failed = byTurn.get(2)?.rows.find(row => row.role === 'flow.role.request')
    expect(failed).toMatchObject({ name: 'deepseek', summary: 'v5', detail: 'boom', state: 'error' })
    const compaction = byTurn.get(null)?.rows.find(row => row.role === 'flow.role.request')
    expect(compaction).toMatchObject({ summary: '', state: 'running' })
    expect(compaction?.change).toBeUndefined()
  })

  it('places the in-flight assistant prefix and the running tool call last in their turn', () => {
    const rows = byTurn.get(2)?.rows ?? []
    // Both in-flight rows carry no log position yet, so they close the turn.
    expect(rows.slice(-2).map(row => row.role)).toEqual(['flow.role.tool', 'flow.role.assistant'])
    expect(rows.at(-1)).toMatchObject({ summary: 'streaming now', state: 'running', time: 0 })
    expect(rows.find(row => row.role === 'flow.role.tool'))
      .toMatchObject({ name: 'read', detail: '{"path":"x"}', state: 'running' })
  })

  it('folds a snapshot without loaded system prompts and without in-flight work', () => {
    const turns = buildFlow({
      eventNodes: [node({ kind: 'user', seq: 1, time: 10, source: null, content: [] })],
      eventLocations: new Map(),
      requests: [],
      callSchemas: new Map(),
      partial: null,
      runningCalls: [],
    })
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ turn: null, toolCalls: 0, messages: 1 })
    expect(turns[0]?.rows[0]?.summary).toBe('')
  })

  it('groups a turn whose only record is a streaming prefix with no logged time', () => {
    const turns = buildFlow({
      eventNodes: [],
      eventLocations: new Map(),
      requests: [],
      callSchemas: new Map(),
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'starting' }] },
      runningCalls: [],
    })
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ turn: 1, time: 0, messages: 1 })
    expect(turns[0]?.rows[0]).toMatchObject({ summary: 'starting', state: 'running' })
  })
})
