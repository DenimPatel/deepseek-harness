/**
 * Step-mode pause points over the real AgentLoop, tool registry, and command
 * registry: arming, both breakpoints, every fail-open path, and cancellation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import * as StepMode from '@deepseek-ai/dsh-step-mode'
import type { StepAdvanceDecision, StepAdvanceRequestEvent, StepBreakpoint } from '@deepseek-ai/dsh-step-mode'
import {
  mountAgentLoopTestDependencies, mountAgentLoopTestHarness,
} from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

/** One controllable answerer: a held request waits until the test answers it. */
interface Answerer {
  /** Every dispatch this answerer received, in order. */
  readonly seen: StepAdvanceRequestEvent[]
  /** Answer every dispatch with one fixed decision, including later ones. */
  settle(action: StepAdvanceDecision['action']): void
  /** Answer the oldest held dispatch. */
  answer(action: StepAdvanceDecision['action']): void
  /** Leave every dispatch held until the turn aborts. */
  hang(): void
  /** Reject every dispatch. */
  fail(): void
}

function answerer(ctx: Context): Answerer {
  const seen: StepAdvanceRequestEvent[] = []
  const held: Array<(decision: StepAdvanceDecision) => void> = []
  let mode: 'held' | 'step' | 'resume' | 'hang' | 'fail' = 'held'
  ctx.on('step-mode/advance', (request) => {
    seen.push(request)
    if (mode === 'fail') return Promise.reject(new Error('answerer refused'))
    if (mode === 'hang') return new Promise<StepAdvanceDecision>(() => {})
    if (mode === 'step' || mode === 'resume') return Promise.resolve({ action: mode })
    return new Promise<StepAdvanceDecision>((resolve) => { held.push(resolve) })
  })
  return {
    seen,
    settle(action) { mode = action },
    answer(action) {
      const resolve = held.shift()
      if (resolve === undefined) throw new Error('no held step pause to answer')
      resolve({ action })
    },
    hang() { mode = 'hang' },
    fail() { mode = 'fail' },
  }
}

const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

/** Mount the prerequisite services, the command registry, the plugin, and one adapter. */
async function mount(
  script: Script,
  options: { breakpoints?: StepBreakpoint[]; commands?: boolean } = {},
): Promise<{ ctx: Context; adapter: MockAdapter; create: (id: string) => Promise<Agent> }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  if (options.commands !== false) await ctx.plugin(CommandRuntime)
  await ctx.plugin(StepMode, options.breakpoints === undefined ? {} : { breakpoints: options.breakpoints })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const harness = await mountAgentLoopTestHarness(ctx)
  return {
    ctx,
    adapter,
    create: id => harness.create(SessionId(id), { provider: 'mock', model: 'mock' }),
  }
}

/** Register the probe tool every tool-pause case scripts. */
function registerProbe(ctx: Context): void {
  ctx.tools.register(defineContentToolFixture({
    name: 'probe',
    description: 'Return the probe value.',
    parameters: {},
    execute: async () => [{ type: 'text' as const, text: 'probed' }],
  }))
}

/** Arm one agent's next run through the shipped command path. */
async function arm(ctx: Context, agent: Agent): Promise<void> {
  await ctx.commands.execute(agent, '/step', [], new AbortController().signal)
}

/** Deliver one ordinary prompt and let the turn run. */
function prompt(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

describe('step-mode pause points', () => {
  it('holds the step before its model request when the run is armed', async () => {
    const { ctx, adapter, create } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    const agent = await create('armed-context')
    await arm(ctx, agent)

    prompt(agent, 'hello')
    await vi.waitFor(() => { expect(stop.seen).toHaveLength(1) })

    // The pause sits after inbox claim and assembly, before the request.
    expect(adapter.requests).toHaveLength(0)
    expect(stop.seen[0]).toMatchObject({ breakpoint: 'context', turn: 1, step: 1 })
    expect(stop.seen[0]?.agent).toBe(agent)

    stop.answer('step')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.snapshotEvents().at(-1)?.type).toBe('turn/end')
  })

  it('holds before a tool dispatch and names the call', async () => {
    const { ctx, create } = await mount([
      toolCallResponse('call-1', 'probe', { value: 'x' }),
      textResponse('done'),
    ])
    const stop = answerer(ctx)
    const agent = await create('armed-tool')
    registerProbe(ctx)
    await arm(ctx, agent)

    prompt(agent, 'probe then answer')
    await vi.waitFor(() => { expect(stop.seen).toHaveLength(1) })
    stop.answer('step')
    await vi.waitFor(() => { expect(stop.seen).toHaveLength(2) })

    expect(stop.seen[1]).toMatchObject({
      breakpoint: 'tool',
      turn: 1,
      step: 1,
      call: { name: 'probe' },
    })

    // Advancing the held call keeps the run stepped: the next model request pauses too.
    stop.answer('step')
    await vi.waitFor(() => { expect(stop.seen).toHaveLength(3) })
    expect(stop.seen[2]).toMatchObject({ breakpoint: 'context', turn: 1, step: 2 })

    stop.answer('resume')
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  })

  it('resumes a held call without pausing again and releases an already-aborted lifetime', async () => {
    const { ctx, create } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    const agent = await create('aborted-lifetime')
    await arm(ctx, agent)
    const aborted = new AbortController()
    aborted.abort(new Error('already cancelled'))
    const message = createUserMessage({ content: [{ type: 'text', text: 'held' }], source: { kind: 'user' } })

    const decision = await ctx.waterfall(
      scopeTarget(agent, agent),
      'agent/pre-step',
      { agent, messages: [message], turn: 1, step: 1, signal: aborted.signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [message] }),
    )

    // An aborted lifetime releases the pause instead of waiting on an answer
    // that can never arrive: the wait would otherwise never settle.
    expect(decision.kind).toBe('enter')
    expect(stop.seen).toHaveLength(1)
  })

  it('never pauses a first step the waterfall rewrote to no messages', async () => {
    const { ctx, create } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    const agent = await create('emptied-first-step')
    // Registered after the plugin, so it runs downstream of the plugin's `next()`.
    ctx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      return decision.kind === 'enter' ? { ...decision, messages: [] } : decision
    })
    await arm(ctx, agent)

    prompt(agent, 'hello')
    await agent.whenIdle()
    expect(stop.seen).toEqual([])
  })

  it('stops pausing after a resume answer', async () => {
    const { ctx, create } = await mount([
      toolCallResponse('call-1', 'probe', { value: 'x' }),
      textResponse('done'),
    ])
    const stop = answerer(ctx)
    const agent = await create('resume-disarms')
    registerProbe(ctx)
    await arm(ctx, agent)
    stop.settle('resume')

    prompt(agent, 'probe then answer')
    await agent.whenIdle()
    expect(stop.seen.map(entry => entry.breakpoint)).toEqual(['context'])
  })

  it('resumes from a held call and stops pausing for the rest of the run', async () => {
    const { ctx, adapter, create } = await mount([
      toolCallResponse('call-1', 'probe', { value: 'x' }),
      textResponse('done'),
    ])
    const stop = answerer(ctx)
    const agent = await create('tool-resume')
    registerProbe(ctx)
    await arm(ctx, agent)

    prompt(agent, 'probe then answer')
    await vi.waitFor(() => { expect(stop.seen).toHaveLength(1) })
    stop.answer('step')
    await vi.waitFor(() => { expect(stop.seen).toHaveLength(2) })
    stop.answer('resume')

    await agent.whenIdle()
    expect(stop.seen).toHaveLength(2)
    expect(adapter.requests).toHaveLength(2)
    expect(agent.session.snapshotEvents().filter(event => event.type === 'tool/result')).toHaveLength(1)
  })

  it('never pauses a run that was not armed', async () => {
    const { ctx, adapter, create } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    const agent = await create('unarmed')

    prompt(agent, 'hello')
    await agent.whenIdle()
    expect(stop.seen).toEqual([])
    expect(adapter.requests).toHaveLength(1)
  })

  it('never pauses without an answering human', async () => {
    const { ctx, adapter, create } = await mount([textResponse('done')])
    const agent = await create('unanswered')
    await arm(ctx, agent)

    prompt(agent, 'hello')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
  })

  it('resumes when the answerer rejects', async () => {
    const { ctx, adapter, create } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    stop.fail()
    const agent = await create('rejecting-answerer')
    await arm(ctx, agent)

    prompt(agent, 'hello')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)
  })

  it('releases the pause when the turn is cancelled', async () => {
    const { ctx, create } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    stop.hang()
    const agent = await create('cancelled-pause')
    await arm(ctx, agent)

    prompt(agent, 'hello')
    await vi.waitFor(() => { expect(stop.seen).toHaveLength(1) })
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    expect(agent.session.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted' } },
    })
  })

  it('never pauses a step the waterfall rejects', async () => {
    const { ctx, adapter, create } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    const agent = await create('rejected-step')
    // Registered after the plugin, so it runs downstream of the plugin's `next()`.
    ctx.on('agent/pre-step', () => Promise.resolve({ kind: 'reject' as const }))
    await arm(ctx, agent)

    prompt(agent, 'hello')
    await agent.whenIdle()
    expect(stop.seen).toEqual([])
    expect(adapter.requests).toHaveLength(0)
  })

  it('leaves a tool call that belongs to no agent alone', async () => {
    const { ctx } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    registerProbe(ctx)

    const result = await ctx.tools.execute({
      callId: ToolCallId('unowned-call'),
      name: 'probe',
      arguments: {},
      signal: new AbortController().signal,
    })

    expect(result.isError).toBe(false)
    expect(stop.seen).toEqual([])
  })

  it('never pauses an agent owned by another agent', async () => {
    const { ctx, adapter, create } = await mount([textResponse('done')])
    const stop = answerer(ctx)
    const parent = await create('delegating-parent')
    const child = (await ctx.agents.create({
      sessionId: SessionId('delegated-child'),
      parentAgent: parent,
      agentOptions: { provider: 'mock', model: 'mock' },
    })).agent
    // The registry owns the runtime relation the plugin reads.
    expect(ctx.agents.roots().includes(parent)).toBe(true)
    expect(ctx.agents.roots().includes(child)).toBe(false)

    await arm(ctx, child)
    prompt(child, 'hello')
    await child.whenIdle()
    expect(stop.seen).toEqual([])
    expect(adapter.requests).toHaveLength(1)
  })

  it('pauses nowhere when the deployment configures no breakpoints', async () => {
    const { ctx, adapter, create } = await mount([textResponse('done')], { breakpoints: [] })
    const stop = answerer(ctx)
    const agent = await create('no-breakpoints')
    await arm(ctx, agent)

    prompt(agent, 'hello')
    await agent.whenIdle()
    expect(stop.seen).toEqual([])
    expect(adapter.requests).toHaveLength(1)
  })
})

describe('step-mode /step command', () => {
  it('arms the next run and disarms on request', async () => {
    const { ctx, create } = await mount([textResponse('done')], { commands: true })
    const agent = await create('command-forms')
    const signal = new AbortController().signal

    const armed = await ctx.commands.execute(agent, '/step', [], signal)
    expect(armed?.result).toMatchObject({ kind: 'success' })

    const off = await ctx.commands.execute(agent, '/step off', [], signal)
    expect(off?.result).toMatchObject({ kind: 'success', text: 'Step mode off.' })

    const again = await ctx.commands.execute(agent, '/step off', [], signal)
    expect(again?.result).toMatchObject({ kind: 'success', text: 'Step mode is not armed.' })

    const bad = await ctx.commands.execute(agent, '/step sideways', [], signal)
    expect(bad?.result.kind).toBe('error')
  })

  it('releases an armed run once it has started and finished', async () => {
    const { ctx, adapter, create } = await mount([textResponse('one'), textResponse('two')])
    const stop = answerer(ctx)
    const agent = await create('disarm-after-run')
    await arm(ctx, agent)

    prompt(agent, 'first')
    await vi.waitFor(() => { expect(stop.seen).toHaveLength(1) })
    stop.answer('step')
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(1)

    prompt(agent, 'second')
    await agent.whenIdle()
    expect(stop.seen).toHaveLength(1)
    expect(adapter.requests).toHaveLength(2)
  })
})
