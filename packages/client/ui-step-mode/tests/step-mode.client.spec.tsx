/** Step-mode browser half: pending settlements, component gestures, and plugin wiring. */
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingStepPause } from '../src/client/contract/slots.ts'
import type {
  StepControlsProps, StepPauseComposerProps, StepRunButtonProps,
} from '../src/client/contract/slots.ts'
import { apply, inject } from '../src/client/index.ts'
import { StepControls } from '../src/client/StepControls.tsx'
import { StepPauseComposer } from '../src/client/StepPauseComposer.tsx'
import { StepRunButton } from '../src/client/StepRunButton.tsx'
import { StepModeClient } from '../src/client/service.ts'
import { apply as nodeApply } from '../src/index.ts'

const SESSION_ID = 'session-step' as SessionId
const SESSION_SCOPE = Symbol('step-mode-session-scope')

/** Translate stub echoing the key and its parameters. */
function translate(key: string, params?: Record<string, unknown>): string {
  const rendered = params === undefined
    ? key
    : Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(',')
  return `${key}(${rendered})`.replace('()', '')
}

type Translate = StepPauseComposerProps['t']

function pause(
  request: Partial<ConstructorParameters<typeof PendingStepPause>[1]> = {},
): PendingStepPause {
  const pending = new PendingStepPause(SESSION_ID, {
    breakpoint: 'context', turn: 1, step: 1, ...request,
  })
  // Delegation rejects by design; tests that assert it read `result` directly.
  pending.result.catch(() => {})
  return pending
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('PendingStepPause', () => {
  it('answers one unit and settles exactly once', async () => {
    const pending = pause()
    pending.advance()

    await expect(pending.result).resolves.toEqual({ action: 'step' })
    expect(() => { pending.resume() }).not.toThrow()
    expect(() => { pending.delegate() }).not.toThrow()
    expect(() => { pending.abort(new Error('late')) }).not.toThrow()
  })

  it('answers the rest of the run', async () => {
    const pending = pause()
    pending.resume()
    await expect(pending.result).resolves.toEqual({ action: 'resume' })
  })

  it('reports delegation to its listener', async () => {
    const pending = pause()
    pending.delegate()
    const reason = await pending.result.catch((error: unknown) => error)
    expect(pending.isDelegation(reason)).toBe(true)
    expect(pending.isDelegation(new Error('other'))).toBe(false)
  })

  it('aborts on an already-aborted Host lifetime', async () => {
    const controller = new AbortController()
    const reason = new Error('turn cancelled')
    controller.abort(reason)

    const pending = pause({ signal: controller.signal })

    await expect(pending.result).rejects.toBe(reason)
  })

  it('uses a stable fallback when the abort carries no reason', async () => {
    // A real aborted signal always carries a reason, so only the reason is replaced.
    const controller = new AbortController()
    controller.abort()
    const signal = controller.signal
    Object.defineProperty(signal, 'reason', { value: undefined })

    const pending = pause({ signal })

    await expect(pending.result).rejects.toThrow('step pause was aborted')
  })

  it('removes its abort listener once answered', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = pause({ signal: controller.signal, breakpoint: 'tool', call: { callId: 'c1', name: 'bash' } })

    pending.advance()

    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(pending.call).toEqual({ callId: 'c1', name: 'bash' })
    expect(pending.breakpoint).toBe('tool')
    expect(pending.turn).toBe(1)
    expect(pending.step).toBe(1)
  })
})

describe('StepPauseComposer', () => {
  function renderComposer(pending: PendingStepPause, stop = vi.fn()): void {
    render(<StepPauseComposer {...({
      matched: pending, stop, t: translate as Translate,
    } as StepPauseComposerProps)} />)
  }

  it('names a held model request and advances on the button', async () => {
    const pending = pause()
    renderComposer(pending)

    expect(screen.getByText(/breakpoint\.context/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /step/ }))

    await expect(pending.result).resolves.toEqual({ action: 'step' })
  })

  it('names the held tool call', () => {
    renderComposer(pause({ breakpoint: 'tool', call: { callId: 'c1', name: 'bash' } }))
    expect(screen.getByText('breakpoint.tool(toolName=bash)')).toBeDefined()
  })

  it('falls back to the context description for a tool pause without a call', () => {
    renderComposer(pause({ breakpoint: 'tool' }))
    expect(screen.getByText(/breakpoint\.context/)).toBeDefined()
  })

  it('advances on Shift+Enter while it holds the composer', async () => {
    const pending = pause()
    renderComposer(pending)

    fireEvent.keyDown(document, { key: 'Enter', shiftKey: true })

    await expect(pending.result).resolves.toEqual({ action: 'step' })
  })

  it('ignores Enter without Shift and composing Shift+Enter', () => {
    const pending = pause()
    renderComposer(pending)

    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'Enter', shiftKey: true, isComposing: true })

    expect(screen.getByRole('button', { name: /step/ })).toBeDefined()
    pending.delegate()
  })

  it('resumes and stops through their own buttons', async () => {
    const resumePending = pause()
    const stop = vi.fn()
    render(<StepPauseComposer {...({
      matched: resumePending, stop, t: translate as Translate,
    } as StepPauseComposerProps)} />)
    fireEvent.click(screen.getByRole('button', { name: /resume/ }))
    await expect(resumePending.result).resolves.toEqual({ action: 'resume' })

    cleanup()
    const stopPending = pause()
    render(<StepPauseComposer {...({
      matched: stopPending, stop, t: translate as Translate,
    } as StepPauseComposerProps)} />)
    fireEvent.click(screen.getByRole('button', { name: /stop/ }))
    expect(stop).toHaveBeenCalledOnce()
    stopPending.delegate()
  })

  it('drops its document listener when it unmounts', () => {
    const pending = pause()
    const remove = vi.spyOn(document, 'removeEventListener')
    renderComposer(pending)
    cleanup()

    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function))
    pending.delegate()
  })
})

describe('StepRunButton', () => {
  function renderButton(overrides: {
    arm?: StepRunButtonProps['arm']
    submit?: () => void
    draft?: string
    attachmentIds?: readonly string[]
    phase?: 'plain' | 'submitting'
  } = {}): { submit: ReturnType<typeof vi.fn> } {
    const submit = vi.fn()
    const state = {
      draft: overrides.draft ?? 'hello',
      attachmentIds: overrides.attachmentIds ?? [],
      phase: overrides.phase ?? 'plain',
    }
    render(<StepRunButton {...({
      arm: overrides.arm ?? (() => Promise.resolve(true)),
      inputActions: { submit },
      useInput: (selector: (value: typeof state) => unknown) => selector(state),
      t: translate as Translate,
    } as StepRunButtonProps)} />)
    return { submit }
  }

  it('arms the next run before submitting the draft', async () => {
    const order: string[] = []
    const { submit } = renderButton({
      arm: () => { order.push('arm'); return Promise.resolve(true) },
    })
    submit.mockImplementation(() => { order.push('submit') })

    fireEvent.click(screen.getByRole('button', { name: /arm\.aria/ }))

    await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
    expect(order).toEqual(['arm', 'submit'])
  })

  it('refuses to submit when the arm is refused, and reports it', async () => {
    const { submit } = renderButton({ arm: () => Promise.resolve(false) })

    fireEvent.click(screen.getByRole('button', { name: /arm\.aria/ }))

    expect(await screen.findByRole('alert')).toBeDefined()
    expect(submit).not.toHaveBeenCalled()
  })

  it('clears a reported failure after a later successful arm', async () => {
    let armed = false
    const { submit } = renderButton({ arm: () => Promise.resolve(armed) })

    fireEvent.click(screen.getByRole('button', { name: /arm\.aria/ }))
    expect(await screen.findByRole('alert')).toBeDefined()

    armed = true
    fireEvent.click(screen.getByRole('button', { name: /arm\.aria/ }))

    await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('refuses an empty draft and a busy machine', () => {
    renderButton({ draft: '   ' })
    expect(screen.getByRole('button', { name: /arm\.aria/ }).hasAttribute('disabled')).toBe(true)

    cleanup()
    renderButton({ phase: 'submitting' })
    expect(screen.getByRole('button', { name: /arm\.aria/ }).hasAttribute('disabled')).toBe(true)
  })

  it('accepts an attachment-only draft', async () => {
    const { submit } = renderButton({ draft: '', attachmentIds: ['a1'] })

    fireEvent.click(screen.getByRole('button', { name: /arm\.aria/ }))

    await waitFor(() => { expect(submit).toHaveBeenCalledOnce() })
  })
})

describe('StepControls', () => {
  function renderControls(pending: PendingStepPause | undefined, stop = vi.fn()): void {
    render(<StepControls {...({
      sessionId: SESSION_ID,
      stop,
      t: translate as Translate,
      useSessionStatus: (selector: (value: Map<SessionId, unknown>) => unknown) =>
        selector(new Map<SessionId, unknown>(pending === undefined ? [] : [[SESSION_ID, { pendingInteraction: pending }]])),
    } as StepControlsProps)} />)
  }

  it('renders nothing while the Session is not paused', () => {
    renderControls(undefined)
    expect(screen.queryByText(/paused/)).toBeNull()
  })

  it('renders nothing for another interaction kind', () => {
    render(<StepControls {...({
      sessionId: SESSION_ID,
      stop: vi.fn(),
      t: translate as Translate,
      useSessionStatus: (selector: (value: Map<SessionId, unknown>) => unknown) =>
        selector(new Map([[SESSION_ID, { pendingInteraction: { kind: 'approval', key: 'a', sessionId: SESSION_ID } }]])),
    } as StepControlsProps)} />)
    expect(screen.queryByText(/paused/)).toBeNull()
  })

  it('steps, resumes, and stops the held run', async () => {
    const stop = vi.fn()
    const pending = pause({ breakpoint: 'tool', call: { callId: 'c1', name: 'bash' } })
    renderControls(pending, stop)

    expect(screen.getByText('breakpoint.tool(toolName=bash)')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /step/ }))
    await expect(pending.result).resolves.toEqual({ action: 'step' })

    cleanup()
    const resumePending = pause()
    renderControls(resumePending, stop)
    fireEvent.click(screen.getByRole('button', { name: /resume/ }))
    await expect(resumePending.result).resolves.toEqual({ action: 'resume' })

    cleanup()
    const stopPending = pause({ breakpoint: 'tool' })
    renderControls(stopPending, stop)
    fireEvent.click(screen.getByRole('button', { name: /stop/ }))
    expect(stop).toHaveBeenCalledOnce()
    stopPending.delegate()
  })
})

describe('StepModeClient', () => {
  it('arms through the Host command and reports acceptance', async () => {
    const ctx = new Context()
    const command = vi.fn(() => Promise.resolve({ ok: true, value: { matched: true } }))
    ctx.provide('sessions', {
      binding: () => ({ session: { command } }),
    } as never)
    const client = new StepModeClient(ctx)

    await expect(client.armNextRun(SESSION_ID)).resolves.toBe(true)
    expect(command).toHaveBeenCalledWith('/step')
    await ctx.fiber.dispose()
  })

  it('reports refusal when the Host has no arm command', async () => {
    const ctx = new Context()
    ctx.provide('sessions', {
      binding: () => ({ session: { command: () => Promise.resolve({ ok: true, value: { matched: false } }) } }),
    } as never)
    const client = new StepModeClient(ctx)

    await expect(client.armNextRun(SESSION_ID)).resolves.toBe(false)
    await ctx.fiber.dispose()
  })

  it('reports refusal for a Session that is not bound', async () => {
    const ctx = new Context()
    ctx.provide('sessions', { binding: () => undefined } as never)
    const client = new StepModeClient(ctx)

    await expect(client.armNextRun(SESSION_ID)).resolves.toBe(false)
    await ctx.fiber.dispose()
  })

  it('reports refusal when the transport rejects the command', async () => {
    const ctx = new Context()
    ctx.provide('sessions', {
      binding: () => ({ session: { command: () => Promise.resolve({ ok: false, error: { code: 'x', message: 'x' } }) } }),
    } as never)
    const client = new StepModeClient(ctx)

    await expect(client.armNextRun(SESSION_ID)).resolves.toBe(false)
    await ctx.fiber.dispose()
  })
})

type StepListener = (
  this: Context,
  request: {
    breakpoint: 'context' | 'tool'
    turn: number
    step: number
    call?: { callId: string; name: string }
    signal?: AbortSignal
  },
  next: () => Promise<{ action: 'resume' }>,
) => Promise<{ action: 'step' | 'resume' }>

interface Bench {
  readonly ctx: Context
  readonly listener: StepListener
  readonly pending: PendingStepPause[]
  readonly registered: Array<{ name: string; options: Record<string, unknown> }>
  readonly command: ReturnType<typeof vi.fn>
  readonly cancel: ReturnType<typeof vi.fn>
  releasePending(): Promise<void>
}

/** Compose the browser half over real slot and locale services with stubbed transport. */
async function bench(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'conversation.composer': { kind: 'chain', scope: 'session' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
      'sidebar.right.pane.tab.controls': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const command = vi.fn(() => Promise.resolve({ ok: true, value: { matched: true } }))
  const cancel = vi.fn(() => Promise.resolve({ ok: true, value: { accepted: true } }))
  ctx.provide('sessions', {
    scopeOf: (candidate: Context) => (candidate as Context & { [SESSION_SCOPE]?: SessionId })[SESSION_SCOPE],
    binding: () => ({ session: { command, cancel } }),
  } as never)
  const pending = new Map<PendingStepPause, () => Promise<void>>()
  ctx.provide('uiSession', {
    registerPendingInteraction: (precedence: (value: PendingStepPause) => number) =>
      (value: PendingStepPause, delegate: () => Promise<void>) => {
        precedence(value)
        pending.set(value, delegate)
        return () => { pending.delete(value) }
      },
  } as never)
  let listener: StepListener | undefined
  ctx.provide('remote', {
    $on: (event: string, callback: StepListener) => {
      expect(event).toBe('step-mode/advance')
      listener = callback
      return () => {}
    },
  } as never)
  const registered: Bench['registered'] = []
  const register = slots.register.bind(slots)
  vi.spyOn(slots, 'register').mockImplementation(((options: { name: string }, component: unknown) => {
    registered.push({ name: options.name, options })
    return register(options as never, component as never)
  }) as never)

  await ctx.plugin({ inject: [...inject], apply }).await()
  if (listener === undefined) throw new Error('step-mode listener was not registered')
  return {
    ctx,
    listener,
    registered,
    command,
    cancel,
    get pending() { return [...pending.keys()] },
    async releasePending() {
      const delegates = [...pending.values()]
      pending.clear()
      await Promise.allSettled(delegates.map(delegate => delegate()))
    },
  }
}

describe('step-mode browser plugin', () => {
  it('mounts its node half without host behavior', () => {
    const run = (): void => { nodeApply() }
    expect(run).not.toThrow()
  })

  it('registers all three presentations, the dictionaries, and the Event consumer', async () => {
    const composed = await bench()

    expect(composed.registered.map(entry => entry.name)).toEqual([
      'conversation.composer',
      'conversation.input.right',
      'sidebar.right.pane.tab.controls',
    ])
    expect(composed.registered[1]?.options).toMatchObject({ id: 'step-run', order: 0, locale: 'stepMode' })
    await composed.ctx.fiber.dispose()
  })

  it('routes only a step pause through the composer chain selector', async () => {
    const composed = await bench()
    const select = composed.registered[0]?.options.select as (props: { pendingInteraction: unknown }) => unknown
    const held = pause()

    expect(select({ pendingInteraction: undefined })).toBeNull()
    expect(select({ pendingInteraction: { kind: 'approval' } })).toBeNull()
    expect(select({ pendingInteraction: held })).toBe(held)
    await composed.ctx.fiber.dispose()
  })

  it('publishes one pause per scope and returns the decision', async () => {
    const composed = await bench()
    const owner = composed.ctx.extend({ [SESSION_SCOPE]: SESSION_ID })
    const result = composed.listener.call(owner, { breakpoint: 'context', turn: 2, step: 3 }, () => Promise.resolve({ action: 'resume' }))

    await waitFor(() => { expect(composed.pending).toHaveLength(1) })
    expect(composed.pending[0]).toMatchObject({ sessionId: SESSION_ID, breakpoint: 'context', turn: 2, step: 3 })
    composed.pending[0]?.advance()

    await expect(result).resolves.toEqual({ action: 'step' })
    expect(composed.pending).toHaveLength(0)
    await composed.ctx.fiber.dispose()
  })

  it('delegates a request that carries no Session scope', async () => {
    const composed = await bench()
    const next = vi.fn(() => Promise.resolve({ action: 'resume' as const }))

    await expect(composed.listener.call(composed.ctx, { breakpoint: 'tool', turn: 1, step: 1 }, next))
      .resolves.toEqual({ action: 'resume' })
    expect(next).toHaveBeenCalledOnce()
    expect(composed.pending).toHaveLength(0)
    await composed.ctx.fiber.dispose()
  })

  it('delegates to the next answerer when its pause is delegated', async () => {
    const composed = await bench()
    const owner = composed.ctx.extend({ [SESSION_SCOPE]: SESSION_ID })
    const next = vi.fn(() => Promise.resolve({ action: 'resume' as const }))
    const result = composed.listener.call(owner, { breakpoint: 'context', turn: 1, step: 1 }, next)

    await waitFor(() => { expect(composed.pending).toHaveLength(1) })
    composed.pending[0]?.delegate()

    await expect(result).resolves.toEqual({ action: 'resume' })
    expect(next).toHaveBeenCalledOnce()
    await composed.ctx.fiber.dispose()
  })

  it('delegates every unanswered pause when the plugin unloads', async () => {
    const composed = await bench()
    const owner = composed.ctx.extend({ [SESSION_SCOPE]: SESSION_ID })
    const next = vi.fn(() => Promise.resolve({ action: 'resume' as const }))
    const result = composed.listener.call(owner, { breakpoint: 'context', turn: 1, step: 1 }, next)
    await waitFor(() => { expect(composed.pending).toHaveLength(1) })

    await composed.releasePending()

    await expect(result).resolves.toEqual({ action: 'resume' })
    await composed.ctx.fiber.dispose()
  })

  it('carries the held call and a projected Host lifetime to the presentation', async () => {
    const composed = await bench()
    const owner = composed.ctx.extend({ [SESSION_SCOPE]: SESSION_ID })
    const signal = new AbortController().signal
    const result = composed.listener.call(owner, {
      breakpoint: 'tool',
      turn: 2,
      step: 1,
      call: { callId: 'call-9', name: 'bash' },
      signal,
    }, () => Promise.resolve({ action: 'resume' }))

    await waitFor(() => { expect(composed.pending).toHaveLength(1) })
    expect(composed.pending[0]?.call).toEqual({ callId: 'call-9', name: 'bash' })
    composed.pending[0]?.advance()
    await expect(result).resolves.toEqual({ action: 'step' })
    await composed.ctx.fiber.dispose()
  })

  it('rejects the Host dispatch when its pause is cancelled', async () => {
    const composed = await bench()
    const owner = composed.ctx.extend({ [SESSION_SCOPE]: SESSION_ID })
    const controller = new AbortController()
    const result = composed.listener.call(owner, {
      breakpoint: 'context', turn: 1, step: 1, signal: controller.signal,
    }, () => Promise.resolve({ action: 'resume' }))
    await waitFor(() => { expect(composed.pending).toHaveLength(1) })

    controller.abort(new Error('turn cancelled'))

    await expect(result).rejects.toThrow('turn cancelled')
    expect(composed.pending).toHaveLength(0)
    await composed.ctx.fiber.dispose()
  })

  it('stops the addressed Session through every registered control', async () => {
    const composed = await bench()

    const composer = composed.registered[0]?.options.inject as (id: SessionId) => { stop: () => void }
    const controls = composed.registered[2]?.options.inject as (id: SessionId) => { stop: () => void }
    composer(SESSION_ID).stop()
    controls(SESSION_ID).stop()

    expect(composed.cancel).toHaveBeenCalledTimes(2)
    await composed.ctx.fiber.dispose()
  })

  it('arms the addressed Session through the composer button face', async () => {
    const composed = await bench()
    await vi.waitFor(() => { expect(composed.ctx.get('stepMode')).toBeDefined() })

    const button = composed.registered[1]?.options.inject as (id: SessionId) => { arm: () => Promise<boolean> }

    await expect(button(SESSION_ID).arm()).resolves.toBe(true)
    expect(composed.command).toHaveBeenCalledWith('/step')
    await composed.ctx.fiber.dispose()
  })

  it('reports no arm when the service is not composed', async () => {
    const composed = await bench()
    const button = composed.registered[1]?.options.inject as (id: SessionId) => { arm: () => Promise<boolean> }
    vi.spyOn(composed.ctx, 'get').mockReturnValue(undefined)

    await expect(button(SESSION_ID).arm()).resolves.toBe(false)
    await composed.ctx.fiber.dispose()
  })
})
