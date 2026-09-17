/**
 * Web step-mode plugin, browser half: the pause takeover that replaces the
 * composer, the composer Step button, and the Observability panel's pause
 * controls. All three present the same `PendingStepPause`, so a pause is
 * answered identically wherever the user reaches it.
 *
 * One carrier, one owner: the Remote Event listener owns the pending value and
 * publishes it as a Session pending interaction; the composer chain renders it
 * while the panel strip reads the same interaction through the standard hook.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the Observability tab's controls declaration.
import type {} from '@deepseek-ai/dsh-client-ui-observability/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PendingInteractionPublisher } from '@deepseek-ai/dsh-client-ui-session/client'
import type { TypertClientEventListener } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { PendingStepPause } from './contract/slots.ts'
import { en, zh } from './locales.ts'
import { StepControls } from './StepControls.tsx'
import { StepPauseComposer } from './StepPauseComposer.tsx'
import { StepRunButton } from './StepRunButton.tsx'
import { StepModeClient } from './service.ts'

export type {
  PendingStepPause, StepControlsProps, StepPauseComposerProps, StepPausePresentationRequest,
  StepRunButtonProps,
} from './contract/slots.ts'
export type { StepModeKey } from './locales.ts'

/** Required services: Agent scopes, Remote Events, Session UI, Slot registry, and copy. */
export const inject = ['sessions', 'remote', 'uiSession', 'slots', 'locale']

/** Dictionary namespace owned by this plugin. */
const NS = 'stepMode'

type StepListener = TypertClientEventListener<'step-mode/advance'>
type ClientStepRequest = Parameters<StepListener>[0]
type ClientStepNext = Parameters<StepListener>[1]
type ClientStepDecision = Awaited<ReturnType<StepListener>>

/** Present one pause until the user advances, resumes, or its lifetime ends. */
async function answerStepPause(
  sessions: ISessions,
  owner: ClientContext,
  request: ClientStepRequest,
  next: ClientStepNext,
  registerPendingInteraction: PendingInteractionPublisher<PendingStepPause>,
): Promise<ClientStepDecision> {
  const sessionId = sessions.scopeOf(owner)
  if (sessionId === undefined) return next()
  const pending = new PendingStepPause(sessionId, {
    breakpoint: request.breakpoint,
    turn: request.turn,
    step: request.step,
    ...request.call === undefined ? {} : { call: request.call },
    ...request.signal === undefined ? {} : { signal: request.signal },
  })
  const completed = Promise.withResolvers<void>()
  const remove = registerPendingInteraction(pending, async () => {
    pending.delegate()
    await completed.promise
  })
  try {
    try {
      return await pending.result
    } catch (error) {
      if (pending.isDelegation(error)) return await next()
      throw error
    }
  } finally {
    remove()
    completed.resolve()
  }
}

/**
 * Client plugin body: mount the arm service, register the pause dictionaries,
 * and install the three presentations of a pending pause.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-step-mode: dictionaries')
  ctx.plugin(StepModeClient)
  // A pause outranks every other pending interaction: it is the outermost hold
  // on the agent, and an approval or question inside it cannot exist yet.
  const registerPendingInteraction = ctx.uiSession.registerPendingInteraction<PendingStepPause>(() => 3)
  const sessions = ctx.get('sessions') as ISessions | undefined
  const stopRun = (sessionId: SessionId): void => {
    void sessions?.binding(sessionId)?.session.cancel()
  }

  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    select: ({ pendingInteraction }: ComposerChainProps): PendingStepPause | null =>
      pendingInteraction instanceof PendingStepPause ? pendingInteraction : null,
    locale: NS,
    inject: (sessionId: SessionId) => ({ stop: () => { stopRun(sessionId) } }),
  }, StepPauseComposer))

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'step-run',
    order: 0,
    locale: NS,
    inject: (sessionId: SessionId) => ({
      arm: async () => {
        // Read at call time: the service mounts with this plugin's own child fiber.
        const client = ctx.get('stepMode')
        return client === undefined ? false : await client.armNextRun(sessionId)
      },
    }),
  }, StepRunButton))

  ctx.slots.inject('sidebar.right.pane.tab.controls', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.controls',
    locale: NS,
    inject: (sessionId: SessionId) => ({ stop: () => { stopRun(sessionId) } }),
  }, StepControls))

  ctx.remote.$on('step-mode/advance', function (request, next) {
    if (sessions === undefined) return next()
    return answerStepPause(sessions, this, request, next, registerPendingInteraction)
  })
}
