// @vitest-environment jsdom
/**
 * Keymap routing at the DOM boundary: synthetic keydowns on the
 * contenteditable reach the registered composer commands (the jsdom lane's
 * gesture entry, below the full component bench).
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { createEditor } from 'lexical'
import { registerPlainText } from '@lexical/plain-text'
import { registerComposerKeymap } from '../src/client/input/editor/keymap.ts'
import { installDraftKeymap } from '../src/client/input/editor/view-binding.ts'

describe('keymap keydown routing', () => {
  it('clears composition presentation on root swaps and unregisters pending callbacks', async () => {
    const editor = createEditor({ namespace: 'composition-root', onError: (e) => { throw e } })
    const first = document.createElement('div')
    const second = document.createElement('div')
    document.body.append(first, second)
    onTestFinished(() => {
      editor.setRootElement(null)
      first.remove()
      second.remove()
    })
    editor.setRootElement(first)
    const unregister = registerComposerKeymap(editor, {
      arbitrate: () => 'pass', space: () => false, dismissPopup: () => {},
      canSubmit: () => false, submit: () => {}, intakeFiles: () => {}, pasteText: () => {},
    })
    onTestFinished(unregister)
    fireEvent.compositionStart(first)
    expect(first.hasAttribute('data-composer-composing')).toBe(true)
    editor.setRootElement(second)
    expect(first.hasAttribute('data-composer-composing')).toBe(false)
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(first)
    expect(first.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(second)
    expect(second.hasAttribute('data-composer-composing')).toBe(true)
    fireEvent.compositionEnd(second, { data: '' })
    unregister()
    await Promise.resolve()
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
    fireEvent.compositionStart(second)
    expect(second.hasAttribute('data-composer-composing')).toBe(false)
  })

  it('routes Enter to the keymap submit handler', () => {
    const editor = createEditor({ namespace: 'keymap-routing', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const submit = vi.fn()
    registerComposerKeymap(editor, {
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit,
      intakeFiles: () => {},
      pasteText: () => {},
    })
    fireEvent.keyDown(root, { key: 'Enter' })
    expect(submit).toHaveBeenLastCalledWith('enter')
    fireEvent.keyDown(root, { key: 'Enter', metaKey: true })
    expect(submit).toHaveBeenLastCalledWith('accelerated')
    fireEvent.keyDown(root, { key: 'Enter', altKey: true })
    expect(submit).toHaveBeenLastCalledWith('step')
  })

  it('keeps Shift+Enter as a line break rather than a submit gesture', () => {
    const editor = createEditor({ namespace: 'keymap-shift-enter', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const submit = vi.fn()
    registerComposerKeymap(editor, {
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit,
      intakeFiles: () => {},
      pasteText: () => {},
    })

    fireEvent.keyDown(root, { key: 'Enter', shiftKey: true })

    expect(submit).not.toHaveBeenCalled()
  })

  it('routes Tab through arbitration and passes when unconsumed', () => {
    const editor = createEditor({ namespace: 'keymap-routing', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const arbitrate = vi.fn<(key: string, composing: boolean) => 'consumed' | 'pick-highlighted' | 'pass'>()
      .mockReturnValueOnce('consumed')
      .mockReturnValueOnce('pick-highlighted')
      .mockReturnValue('pass')
    registerComposerKeymap(editor, {
      arbitrate,
      space: () => false,
      dismissPopup: () => {},
      canSubmit: () => true,
      submit: () => {},
      intakeFiles: () => {},
      pasteText: () => {},
    })
    const consumed = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(arbitrate).toHaveBeenCalledWith('tab', false)
    expect(consumed).toBe(false) // consumed: preventDefault fired
    const picked = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(picked).toBe(false) // picked: the completion replaces native traversal
    const passed = fireEvent.keyDown(root, { key: 'Tab', keyCode: 9 })
    expect(passed).toBe(true) // pass: the browser keeps native focus traversal

    // Shift+Tab is the menu's exit key, never its settle key.
    fireEvent.keyDown(root, { key: 'Tab', keyCode: 9, shiftKey: true })
    expect(arbitrate).toHaveBeenLastCalledWith('tabBack', false)
  })
})

describe('step gesture routing', () => {
  /** One keymap-bearing editor plus the live gate the step gesture reads. */
  function bench(over: Partial<{
    stepRun: (() => Promise<string | null>) | undefined
    uploadsPending: boolean
    canSteerQueue: boolean
  }> = {}) {
    const editor = createEditor({ namespace: 'keymap-step', onError: (e) => { throw e } })
    const root = document.createElement('div')
    root.contentEditable = 'true'
    document.body.appendChild(root)
    editor.setRootElement(root)
    registerPlainText(editor)
    const submit = vi.fn()
    const steerQueue = vi.fn()
    const showToast = vi.fn()
    const gate = {
      current: {
        locked: false,
        machineBusy: false,
        canSteerQueue: over.canSteerQueue ?? false,
        running: false,
        steeringAvailable: true,
        busyEnter: 'queue',
        intakeFiles: () => {},
        uploadsPending: over.uploadsPending ?? false,
        showToast,
        t: ((key: string) => key) as CallableFunction,
        canAcceptDrop: false,
        ...(over.stepRun === undefined ? {} : { stepRun: over.stepRun }),
      },
    }
    installDraftKeymap(editor, {
      arbitrate: () => 'pass',
      space: () => false,
      dismissPopup: () => {},
      steerQueue,
      submit,
      paste: () => {},
    }, gate as never)
    return { root, submit, steerQueue, showToast }
  }

  it('arms the next run before submitting the draft', async () => {
    const order: string[] = []
    const stepRun = vi.fn(() => { order.push('arm'); return Promise.resolve(null) })
    const { root, submit } = bench({ stepRun })
    submit.mockImplementation(() => { order.push('submit') })

    fireEvent.keyDown(root, { key: 'Enter', altKey: true })

    await vi.waitFor(() => { expect(submit).toHaveBeenCalledWith('queue') })
    expect(order).toEqual(['arm', 'submit'])
  })

  it('shows the provider refusal instead of submitting', async () => {
    const { root, submit, showToast } = bench({ stepRun: () => Promise.resolve('step mode is unavailable') })

    fireEvent.keyDown(root, { key: 'Enter', altKey: true })

    await vi.waitFor(() => { expect(showToast).toHaveBeenCalledWith('step mode is unavailable') })
    expect(submit).not.toHaveBeenCalled()
  })

  it('submits like plain Enter when no step-mode provider is composed', async () => {
    const { root, submit } = bench()

    fireEvent.keyDown(root, { key: 'Enter', altKey: true })

    await vi.waitFor(() => { expect(submit).toHaveBeenCalledWith('queue') })
  })

  it('refuses a step submission while uploads are pending', async () => {
    const stepRun = vi.fn(() => Promise.resolve(null))
    const { root, submit, showToast } = bench({ stepRun, uploadsPending: true })

    fireEvent.keyDown(root, { key: 'Enter', altKey: true })

    expect(showToast).toHaveBeenCalledWith('file.stillUploading')
    expect(stepRun).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('keeps the accelerated queue gesture separate from the step gesture', async () => {
    const stepRun = vi.fn(() => Promise.resolve(null))
    const { root, submit, steerQueue } = bench({ stepRun, canSteerQueue: true })

    fireEvent.keyDown(root, { key: 'Enter', metaKey: true })

    expect(steerQueue).toHaveBeenCalledOnce()
    expect(stepRun).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()  })
})
