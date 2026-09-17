/**
 * Client-safe step-advance vocabulary and the Cordis waterfall a human-facing
 * answerer claims. Free of service and runtime imports so browser type chains
 * can consume it without loading this package's plugin body.
 * @module @deepseek-ai/dsh-step-mode/types
 */

import type { Scoped } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent/types'

/**
 * One configured pause point. `context` holds the agent after its step claimed
 * input and assembled the request, before the model request is prepared;
 * `tool` holds it before each tool dispatch, including `run_code` sub-calls.
 */
export type StepBreakpoint = 'context' | 'tool'

/**
 * How one pause resolves: `step` runs exactly this unit and pauses again at
 * the next pause point; `resume` runs the rest of the run without pausing.
 */
export type StepAdvanceAction = 'step' | 'resume'

/** Identity of the tool call a `tool` pause is holding, as far as the wire needs it. */
export interface StepCallIdentity {
  /** The model-issued call identity. */
  readonly callId: string
  /** Registered tool name, e.g. `bash`. */
  readonly name: string
}

/**
 * Client-safe payload of one pending pause. A UI reads it to name what is about
 * to run; the request itself never reaches a model.
 */
export interface StepAdvanceRequestEvent {
  /** Agent identity projected to the corresponding Client Context in transit. */
  readonly agent: Agent
  /** Cancellation lifetime of the pending pause. */
  readonly signal?: AbortSignal
  /** Which pause point is holding the agent. */
  readonly breakpoint: StepBreakpoint
  /** Open turn whose unit is held. */
  readonly turn: number
  /** Step position of the held unit. */
  readonly step: number
  /** The held tool call, present exactly for the `tool` breakpoint. */
  readonly call?: StepCallIdentity
}

/** The human's answer to one pending pause. */
export interface StepAdvanceDecision {
  /** Whether to run only this unit or the rest of the run. */
  readonly action: StepAdvanceAction
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Ask composed answerers how to advance one paused agent. Return a decision
     * to claim the pause or call `next()` to delegate. With no claiming
     * answerer the dispatch default resumes, so an unattended run never hangs.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
     * receive only that agent.
     * @param request - the held unit and its cancellation lifetime.
     * @param next - delegates to the remaining answerers.
     * @mode waterfall
     */
    'step-mode/advance'(
      this: Scoped<Agent>,
      request: StepAdvanceRequestEvent,
      next: () => Promise<StepAdvanceDecision>,
    ): Promise<StepAdvanceDecision>
  }
}
