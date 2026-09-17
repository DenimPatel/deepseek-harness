/**
 * The plugin's registrations and their removal, plus the injected paging
 * callback: the tab type, its dictionaries, the body seat under the type's id,
 * and the loadOlder result that drives the flow ledger's history control.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { OBSERVABILITY_TAB_ID, apply, inject } from '../src/client/index.ts'
import type { ObservabilityInjected } from '../src/client/face.ts'
import { apply as hostApply } from '../src/index.ts'
import { ObservabilityPanel } from '../src/client/ObservabilityPanel.tsx'
import { en, zh } from '../src/client/locales.ts'

const SESSION = 'session' as SessionId

interface Recorded {
  name: string
  key: string
  locale: string
  inject?: (sessionId: SessionId) => ObservabilityInjected
  component: unknown
}

async function boot(options: {
  readonly bound?: boolean
  readonly moves?: boolean
} = {}) {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const loadOlder = vi.fn(() => {
    // A page that finds older history republishes the snapshot; the last page does not.
    if (options.moves !== false) snapshots.current = { marks: ['moved'] }
    return Promise.resolve()
  })
  const snapshots = { current: { marks: ['a'] } as unknown }
  const target = { getSnapshot: () => snapshots.current, subscribe: () => () => {} }
  const sessions = { binding: vi.fn(() => options.bound === false ? undefined : { session: { loadOlder } }) }
  const uiConversation = { binding: vi.fn(() => ({ target: () => target })) }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('uiConversation', uiConversation as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, loadOlder, snapshots }
}

describe('ui-observability apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body seat under the type\'s id', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get('observability')
    expect(definition?.id).toBe(OBSERVABILITY_TAB_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.title('sidebar://observability')).toBe('title')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
      .toEqual([[30, 'title', 'guide.description']])
    expect(dictionaries.get('observability')).toEqual({ zh, en })
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', OBSERVABILITY_TAB_ID, 'observability', ObservabilityPanel],
    ])
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get('observability')).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })

  it('ages the window and reports whether the Trajectory snapshot moved', async () => {
    const moving = await boot({ moves: true })
    const first = moving.registered[0]?.inject?.(SESSION)
    expect(first).toBeDefined()
    await expect(first?.loadOlder()).resolves.toBe(true)
    expect(moving.loadOlder).toHaveBeenCalledTimes(1)

    // A page that leaves the snapshot identity alone reports the log's start.
    const still = await boot({ moves: false })
    await expect(still.registered[0]?.inject?.(SESSION)?.loadOlder()).resolves.toBe(false)
    expect(still.loadOlder).toHaveBeenCalledTimes(1)
  })

  it('reports no movement when the Session is not bound', async () => {
    const { registered, loadOlder } = await boot({ bound: false })
    await expect(registered[0]?.inject?.(SESSION)?.loadOlder()).resolves.toBe(false)
    expect(loadOlder).not.toHaveBeenCalled()
  })
})
