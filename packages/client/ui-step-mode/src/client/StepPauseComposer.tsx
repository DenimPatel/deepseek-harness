/** Composer takeover for one pending step pause. */
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingStepPause, StepPauseComposerProps } from './contract/slots.ts'
import { useStepAnswer } from './use-step-answer.ts'
import css from './StepPauseComposer.module.css'

/**
 * Render the pause that replaced the composer: what is about to run, one way to
 * run only it, one way to run the rest, and the run's own Stop.
 * @param props - selector-matched pause, injected cancellation, and standard Slot props.
 * @returns The step-pause composer takeover.
 */
export function StepPauseComposer(props: StepPauseComposerProps) {
  const pause = props.matched
  return <StepPauseCard key={pause.key} pause={pause} stop={props.stop} t={props.t} />
}

function StepPauseCard({ pause, stop, t }: {
  pause: PendingStepPause
  stop: () => void
  t: StepPauseComposerProps['t']
}) {
  const { answered, advance, resume, stopRun } = useStepAnswer(pause, stop)
  const call = pause.call
  return (
    <div className={css.root} data-step-pause-key={pause.key}>
      <div className={css.card} role="status" aria-live="polite" aria-label={t('controls.aria')}>
        <div className={css.strip}>
          <span className={css.dot} />
          {t('paused')}
          <span className={css.position}>{t('position', { turn: pause.turn, step: pause.step })}</span>
        </div>
        <div className={css.body}>
          <div className={css.headline}>
            {pause.breakpoint === 'tool' && call !== undefined
              ? t('breakpoint.tool', { toolName: call.name })
              : t('breakpoint.context')}
          </div>
        </div>
        <div className={css.actionRow}>
          <Button variant="outline" className={css.stop} disabled={answered} onClick={stopRun}>
            {t('stop')}
          </Button>
          <Button variant="outline" disabled={answered} onClick={resume}>
            {t('resume')}
          </Button>
          <Button variant="primary" autoFocus disabled={answered} onClick={advance}>
            {t('step')} · {t('step.hint')}
          </Button>
        </div>
      </div>
    </div>
  )
}
