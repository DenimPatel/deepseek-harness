/**
 * The plugin's registrations, and their removal when the plugin goes: the tab
 * type, its dictionaries, and the body seat under the type's id.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { OBSERVABILITY_TAB_ID, apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { ObservabilityPanel } from '../src/client/ObservabilityPanel.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key: string
  locale: string
  component: unknown
}

async function boot() {
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
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber }
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
})
