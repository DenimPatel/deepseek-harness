/**
 * Client-side arm verb over the Host `/step` command. The composer Step button
 * and the composer's `Alt+Enter` gesture arm a run through this service, so
 * neither the gesture owner (`ui-conversation`) nor this package imports the
 * other's runtime values: the composer reads the service by key.
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The Host command that arms one run for stepping. */
export const STEP_COMMAND = '/step'

declare module '@deepseek-ai/cordis' {
  interface Context {
    stepMode: StepModeClient
  }
}

/** `ctx.stepMode`: arm the addressed Session's next run for stepping. */
export class StepModeClient extends Service {
  static inject = ['sessions']

  /**
   * @param ctx - owning Client root context.
   */
  constructor(ctx: Context) {
    super(ctx, 'stepMode')
  }

  /**
   * Arm the addressed Session's next run. The command is the arm's only owner:
   * a profile that composes this browser half without `@deepseek-ai/dsh-step-mode`
   * reports `false` instead of pretending the run will pause.
   * @param sessionId - Session whose Agent receives the arm command.
   * @returns Whether the Host accepted the command.
   */
  async armNextRun(sessionId: SessionId): Promise<boolean> {
    const sessions = this.ctx.get('sessions') as ISessions | undefined
    const session = sessions?.binding(sessionId)?.session
    if (session === undefined) return false
    const result = await session.command(STEP_COMMAND)
    return result.ok && result.value.matched
  }
}
