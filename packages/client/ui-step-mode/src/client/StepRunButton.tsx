/** Composer Step button: arm the next run, then submit the draft. */
import { useCallback, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StepRunButtonProps } from './contract/slots.ts'
import css from './StepRunButton.module.css'

/**
 * Send the current draft with the next run stepped. The button and the
 * composer's `Alt+Enter` gesture are the same action; this one is what makes
 * the mode discoverable without knowing the chord.
 * @param props - standard composer-row props, the injected arm verb, and copy.
 * @returns The composer tool-row button, or its local failure text.
 */
export function StepRunButton(props: StepRunButtonProps) {
  const { arm, inputActions, t } = props
  const draft = props.useInput(state => state.draft)
  const attachments = props.useInput(state => state.attachmentIds)
  const phase = props.useInput(state => state.phase)
  const [failed, setFailed] = useState(false)
  const empty = draft.trim() === '' && attachments.length === 0
  const onStepRun = useCallback(() => {
    void (async () => {
      const armed = await arm()
      if (!armed) {
        setFailed(true)
        return
      }
      setFailed(false)
      inputActions.submit()
    })()
  }, [arm, inputActions])
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={css.button}
        aria-label={t('arm.aria')}
        disabled={empty || phase !== 'plain'}
        onClick={onStepRun}
      >
        {t('arm')}
      </Button>
      {failed && <span className={css.error} role="alert">{t('arm.failed')}</span>}
    </>
  )
}
