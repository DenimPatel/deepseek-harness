/** Observability panel strip: what a pause is holding, and its three gestures. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { PendingStepPause, type StepControlsProps } from './contract/slots.ts'
import { useStepAnswer } from './use-step-answer.ts'
import css from './StepControls.module.css'

/**
 * Show the addressed Session's pending pause beside the Flow ledger, so the
 * run can be advanced while the ledger is on screen. Renders nothing when the
 * Session is not paused, leaving the panel unchanged in ordinary use.
 * @param props - standard panel props, the injected cancellation, and copy.
 * @returns The pause strip, or null.
 */
export function StepControls(props: StepControlsProps) {
  const pending = props.useSessionStatus(statuses => statuses.get(props.sessionId)?.pendingInteraction)
  return pending instanceof PendingStepPause
    ? <StepControlsStrip key={pending.key} pause={pending} stop={props.stop} t={props.t} />
    : null
}

function StepControlsStrip({ pause, stop, t }: {
  pause: PendingStepPause
  stop: () => void
  t: StepControlsProps['t']
}) {
  const { answered, advance, resume, stopRun } = useStepAnswer(pause, stop)
  const call = pause.call
  return (
    <div className={css.root} role="status" aria-live="polite" aria-label={t('controls.aria')}>
      <div className={css.strip}>
        <span className={css.dot} />
        {t('paused')}
        <span className={css.position}>{t('position', { turn: pause.turn, step: pause.step })}</span>
      </div>
      <div className={css.headline}>
        {pause.breakpoint === 'tool' && call !== undefined
          ? t('breakpoint.tool', { toolName: call.name })
          : t('breakpoint.context')}
      </div>
      <div className={css.actionRow}>
        <Button variant="outline" size="sm" className={css.stop} disabled={answered} onClick={stopRun}>
          {t('stop')}
        </Button>
        <Button variant="outline" size="sm" disabled={answered} onClick={resume}>
          {t('resume')}
        </Button>
        <Button variant="primary" size="sm" disabled={answered} onClick={advance}>
          {t('step')} · {t('step.hint')}
        </Button>
      </div>
    </div>
  )
}
