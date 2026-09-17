/**
 * Step execution mode: holds an agent at each configured pause point until a
 * human-facing answerer says how to advance. Pause points are the documented
 * loop and tool waterfalls, so the agent loop and the tool registry stay
 * unchanged: `agent/pre-step` fires after the step claimed its input and
 * assembled the request, and `tools/pre-execute` fires before each dispatch.
 *
 * Arming is one-shot per run and lives on the host, so an unarmed run pays no
 * round trip. A pause fails open — no answerer, a rejected dispatch, or an
 * aborted turn all resume — while arming fails closed, so `Alt+Enter` never
 * silently starts an ordinary run.
 *
 * Agent Note:
 * - .agents/notes/implemented/feature/2026-09-16-step-execution-mode.md
 *
 * @module @deepseek-ai/dsh-step-mode
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { StepAdvanceDecision, StepAdvanceRequestEvent, StepBreakpoint } from './types.ts'

export type * from './types.ts'

export const name = 'step-mode'

/** Required service: the runtime-root test decides whether a human can be asked at all. */
export const inject = ['agents']

/**
 * Plugin config. `breakpoints` selects which pause points this deployment
 * offers; an empty list disables stepping without unloading the plugin, and
 * the `/step` command still arms and reports.
 */
export interface Config {
  /** Pause points to hold at (default `['context', 'tool']`). */
  breakpoints?: StepBreakpoint[]
}

export const Config: z<Config> = z.object({
  breakpoints: z.array(z.union(['context', 'tool'])).default(['context', 'tool']),
})

/** The answer that continues a run without pausing again. */
const RESUME: StepAdvanceDecision = Object.freeze({ action: 'resume' })

/** One agent's step-mode state; dropped with the agent. */
interface AgentStepState {
  /** The next run this agent starts pauses at each configured pause point. */
  armed: boolean
  /** The armed run has been observed running, so its end releases the arm. */
  seenRunning: boolean
  /** Turn and step of the agent's most recent proposed step, reported by a tool pause. */
  position?: { turn: number; step: number }
}

/**
 * Resolve immediately when the caller's signal is already or becomes aborted,
 * so `Stop` releases a pause and the loop's own `throwIfAborted` cancels.
 * @param signal - the held unit's cancellation lifetime.
 * @returns the resuming decision, or a promise that settles with it on abort.
 */
function settledOnAbort(signal: AbortSignal): Promise<StepAdvanceDecision> {
  if (signal.aborted) return Promise.resolve(RESUME)
  const aborted = Promise.withResolvers<StepAdvanceDecision>()
  signal.addEventListener('abort', () => { aborted.resolve(RESUME) }, { once: true })
  return aborted.promise
}

/**
 * Hold the addressed agent at each configured pause point until a human-facing
 * answerer decides how to advance.
 * @param ctx - context carrying the agent registry and, when composed, the command registry.
 * @param config - validated pause-point selection.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery's .default() guarantees the field is set after validation.
  const breakpoints = new Set<StepBreakpoint>(config.breakpoints as StepBreakpoint[])
  const states = new WeakMap<Agent, AgentStepState>()

  /** One agent's state, created on first use so the command can arm an idle agent. */
  function stateOf(agent: Agent): AgentStepState {
    let state = states.get(agent)
    if (state === undefined) {
      state = { armed: false, seenRunning: false }
      states.set(agent, state)
    }
    return state
  }

  /**
   * Dispatch one pending pause and wait for its answer. Human interaction is
   * valid only for a runtime root: an owned child has no human answerer and
   * would otherwise hold a delegated run open with nothing able to release it.
   * Every other outcome resumes — a missing answerer, a throwing listener, a
   * dispatch rejected because the browser disconnected, and an aborted turn.
   * @param agent - the held agent.
   * @param held - the pause payload without its projected agent and signal.
   * @param signal - the held unit's cancellation lifetime.
   * @returns how to advance.
   */
  async function advance(
    agent: Agent,
    held: Omit<StepAdvanceRequestEvent, 'agent' | 'signal'>,
    signal: AbortSignal,
  ): Promise<StepAdvanceDecision> {
    if (!ctx.agents.roots().includes(agent)) return RESUME
    const answered = Promise.resolve()
      .then(() => ctx.waterfall(
        scopeTarget(agent, agent),
        'step-mode/advance',
        { ...held, agent, signal },
        () => Promise.resolve(RESUME),
      ))
      .catch(() => RESUME)
    return await Promise.race([answered, settledOnAbort(signal)])
  }

  // The waterfall runs after the step claimed its input and assembled the
  // request, and before `step/start`; `next()` runs first so a rejected or
  // rewritten step is never held. A first proposed step carrying no messages
  // closes the turn without a model call, so there is nothing to pause before —
  // later empty steps still issue a request over the log's tool results.
  ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    const state = stateOf(agent)
    state.position = { turn, step }
    if (!state.armed || !breakpoints.has('context')) return decision
    if (decision.kind === 'reject') return decision
    if (step === 1 && decision.messages.length === 0) return decision
    const answer = await advance(agent, { breakpoint: 'context', turn, step }, signal)
    if (answer.action === 'resume') state.armed = false
    return decision
  })

  // `tools/pre-execute` ordered policy runs before any approval ask, so a held
  // call is decided before the human sees a permission request for it. A call
  // with no recorded step position is not part of a stepped run.
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    const agent = exec.agent
    const state = agent === undefined ? undefined : states.get(agent)
    const position = state?.position
    if (agent === undefined || state === undefined || position === undefined
      || !state.armed || !breakpoints.has('tool')) {
      return next()
    }
    const answer = await advance(agent, {
      breakpoint: 'tool',
      turn: position.turn,
      step: position.step,
      call: { callId: exec.callId, name: exec.name },
    }, exec.signal)
    if (answer.action === 'resume') state.armed = false
    return next()
  })

  // An armed run that has started and reaches `idle` is over; a later run must
  // not inherit its arm.
  ctx.on('agent/status', ({ agent, status }) => {
    const state = states.get(agent)
    if (state === undefined) return
    if (status === 'running') {
      state.seenRunning = true
      return
    }
    if (!state.seenRunning) return
    state.armed = false
    state.seenRunning = false
  })

  // The command child activates only when a command registry is composed.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-step-mode'),
      name: 'step',
      description: 'Step through the next run',
      input: { hint: '[off]' },
      handler: ({ agent, rawInput }) => {
        const argument = rawInput.trim()
        const state = stateOf(agent)
        if (argument === 'off') {
          if (!state.armed) return { kind: 'success', text: 'Step mode is not armed.' }
          state.armed = false
          return { kind: 'success', text: 'Step mode off.' }
        }
        if (argument !== '') {
          return { kind: 'error', text: `Unknown argument ${JSON.stringify(argument)} — use /step or /step off.` }
        }
        state.armed = true
        return {
          kind: 'success',
          text: breakpoints.size === 0
            ? 'Step mode armed, but this deployment configures no pause points.'
            : 'Step mode armed for the next run.',
        }
      },
    })
  })
}
