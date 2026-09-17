/** Step-mode presentation contract: one pending pause and the entries' props. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StepAdvanceDecision, StepBreakpoint, StepCallIdentity } from '@deepseek-ai/dsh-step-mode'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// The client modules declare the conversation composer, the composer tool row,
// and the Observability controls seats these props resolve against.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-observability/client'
import type { StepModeKey } from '../locales.ts'

declare module '@deepseek-ai/dsh-client-ui-session/client' {
  interface SessionPendingInteractionMap {
    /** Pending step pause awaiting the human's advance decision. */
    stepPause: PendingStepPause
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Step-mode pause and control copy. */
    stepMode: StepModeKey
  }
}

/** Client-visible fields of one pause projected through Remote Events. */
export interface StepPausePresentationRequest {
  /** Pause point holding the agent. */
  readonly breakpoint: StepBreakpoint
  /** Open turn whose unit is held. */
  readonly turn: number
  /** Step position of the held unit. */
  readonly step: number
  /** The held tool call, present exactly for the `tool` breakpoint. */
  readonly call?: StepCallIdentity
  /** Cancellation projected from the Host pause. */
  readonly signal?: AbortSignal
}

let nextStepPauseKey = 0

/** One answerable Client presentation of a pending Host step pause. */
export class PendingStepPause {
  /** Domain discriminator used by Session pending-interaction consumers. */
  readonly kind: 'step-pause'
  /** Opaque render identity; a replacement pause uses a new key. */
  readonly key: string
  /** Pause point holding the agent. */
  readonly breakpoint: StepBreakpoint
  /** Open turn whose unit is held. */
  readonly turn: number
  /** Step position of the held unit. */
  readonly step: number
  /** The held tool call, present exactly for the `tool` breakpoint. */
  readonly call: StepCallIdentity | undefined
  /** Result returned by the Remote Event listener to the Host waterfall. */
  readonly result: Promise<StepAdvanceDecision>

  readonly #resolve: (decision: StepAdvanceDecision) => void
  readonly #reject: (reason: unknown) => void
  readonly #signal: AbortSignal | undefined
  readonly #onAbort: (() => void) | undefined
  readonly #delegated = Symbol('pending step pause delegated')
  #settled = false

  /**
   * @param sessionId - Agent/Session identity owning the scoped pause.
   * @param request - Host pause projected through the Remote Event.
   */
  constructor(readonly sessionId: SessionId, request: StepPausePresentationRequest) {
    this.kind = 'step-pause'
    nextStepPauseKey += 1
    this.key = `step-pause:${String(nextStepPauseKey)}`
    this.breakpoint = request.breakpoint
    this.turn = request.turn
    this.step = request.step
    this.call = request.call
    const completion = Promise.withResolvers<StepAdvanceDecision>()
    this.result = completion.promise
    this.#resolve = completion.resolve
    this.#reject = completion.reject
    this.#signal = request.signal
    if (request.signal === undefined) {
      this.#onAbort = undefined
      return
    }
    const onAbort = (): void => { this.abort(request.signal?.reason ?? new Error('step pause was aborted')) }
    this.#onAbort = onAbort
    request.signal.addEventListener('abort', onAbort, { once: true })
    if (request.signal.aborted) onAbort()
  }

  /** Let the agent run exactly this unit, then pause again at the next pause point. */
  advance(): void {
    this.finish(() => { this.#resolve({ action: 'step' }) })
  }

  /** Let the agent run the rest of the run without pausing again. */
  resume(): void {
    this.finish(() => { this.#resolve({ action: 'resume' }) })
  }

  /** Delegate an unanswered pause to the next waterfall listener. */
  delegate(): void {
    this.finish(() => { this.#reject(this.#delegated) })
  }

  /**
   * Test whether a rejection requests waterfall delegation.
   * @param reason - rejection received from {@link PendingStepPause.result}.
   * @returns whether {@link PendingStepPause.delegate} produced it.
   */
  isDelegation(reason: unknown): boolean {
    return reason === this.#delegated
  }

  /**
   * End an unanswered pause when its transport, scope, or plugin lifetime ends.
   * @param reason - rejection exposed to the waiting Remote Event listener.
   */
  abort(reason: unknown): void {
    this.finish(() => { this.#reject(reason) })
  }

  /** Settle once; every later gesture on an answered pause is a no-op. */
  private finish(settle: () => void): void {
    if (this.#settled) return
    this.#settled = true
    if (this.#signal !== undefined && this.#onAbort !== undefined) {
      this.#signal.removeEventListener('abort', this.#onAbort)
    }
    settle()
  }
}

/** Values the composer takeover receives from the plugin's apply closure. */
export interface StepPauseComposerInjected {
  /** Cancel the held run through the Session's own cancellation. */
  readonly stop: () => void
}

/** Full props of the step-pause composer takeover. */
export type StepPauseComposerProps =
  PropsRuntime<'conversation.composer'>
  & InjectFace<StepPauseComposerInjected>
  & { matched: PendingStepPause }
  & PropsLocale<'stepMode'>

/** Values the composer Step button receives from the plugin's apply closure. */
export interface StepRunButtonInjected {
  /**
   * Arm the addressed Session's next run for stepping.
   * @returns Whether the Host accepted the arm command.
   */
  readonly arm: () => Promise<boolean>
}

/** Full props of the composer Step button. */
export type StepRunButtonProps =
  PropsRuntime<'conversation.input.right'>
  & InjectFace<StepRunButtonInjected>
  & PropsLocale<'stepMode'>

/** Values the Observability pause controls receive from the plugin's apply closure. */
export interface StepControlsInjected {
  /** Cancel the held run through the Session's own cancellation. */
  readonly stop: () => void
}

/** Full props of the Observability panel's pause controls. */
export type StepControlsProps =
  PropsRuntime<'sidebar.right.pane.tab.controls'>
  & InjectFace<StepControlsInjected>
  & PropsLocale<'stepMode'>
