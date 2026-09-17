/** The three gestures one pending pause accepts, shared by both presentations. */
import { useCallback, useEffect, useState } from 'react'
import type { PendingStepPause } from './contract/slots.ts'

/** Live gesture handlers and their one-shot settlement state. */
export interface StepAnswer {
  /** Whether a gesture already settled the pause this render holds. */
  readonly answered: boolean
  /** Run exactly this unit and pause again at the next pause point. */
  readonly advance: () => void
  /** Run the rest of the run without pausing again. */
  readonly resume: () => void
  /** Cancel the held run. */
  readonly stopRun: () => void
}

/**
 * Answer one pending pause from any of its gestures. `Shift+Enter` is read
 * from the document because no draft editor is mounted while a pause holds the
 * composer; the same hook serves the composer takeover and the Observability
 * controls so one pause is never answered two different ways.
 * @param pause - the pending pause this render presents.
 * @param stop - cancellation of the held run, injected by the plugin.
 * @returns the gesture handlers and their settlement state.
 */
export function useStepAnswer(pause: PendingStepPause, stop: () => void): StepAnswer {
  const [answered, setAnswered] = useState(false)
  const advance = useCallback(() => {
    setAnswered(true)
    pause.advance()
  }, [pause])
  const resume = useCallback(() => {
    setAnswered(true)
    pause.resume()
  }, [pause])
  const stopRun = useCallback(() => {
    setAnswered(true)
    stop()
  }, [stop])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || !event.shiftKey || event.isComposing) return
      event.preventDefault()
      advance()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [advance])
  return { answered, advance, resume, stopRun }
}
