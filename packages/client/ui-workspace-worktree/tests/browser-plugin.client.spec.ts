/**
 * ui-workspace-worktree browser half: the dictionary and the three slot
 * registrations against the real SlotRegistry (fiber teardown proves removal —
 * HMR safety), the inject face routing every verb to its Host service, and the
 * inert node entry.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, type WorktreeInjected } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

const Empty = () => null

/** Every root Context this suite boots, disposed after each test. */
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

const SLOTS = [
  'sidebar.workspaces.projectActions',
  'sidebar.workspaces.worktreeRow',
  'conversation.session.header.actions',
] as const

/** Declare the three owner slots this plugin registers into ('root' is single). */
function declareOwners(ctx: Context): () => void {
  return ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.workspaces.projectActions': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.worktreeRow': { kind: 'single', scope: 'root' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    },
  } as never, Empty)
}

/** Boot the browser half over the real slot tree and stubbed Host services. */
async function bench(): Promise<{
  ctx: Context
  probe: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  merge: ReturnType<typeof vi.fn>
  discard: ReturnType<typeof vi.fn>
  startSessionInWorktree: ReturnType<typeof vi.fn>
  forget: ReturnType<typeof vi.fn>
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const probe = vi.fn(async (path: string) => ({ path }))
  const create = vi.fn(async (workspaceId: string, name: string, runSetup: boolean) => ({
    workspaceId, name, runSetup,
  }))
  const status = vi.fn(async (workspaceId: string) => ({ workspaceId }))
  const merge = vi.fn(async (workspaceId: string) => ({ workspaceId, merged: true }))
  const discard = vi.fn(async (workspaceId: string, force: boolean) => ({ workspaceId, force }))
  const startSessionInWorktree = vi.fn((_workspaceId: string) => undefined)
  const forget = vi.fn(async (workspaceId: string) => ({ workspaceId }))
  ctx.provide('gitWorktrees', { probe, create, status, merge, discard } as never)
  ctx.provide('workspaces', { delete: forget } as never)
  ctx.provide('uiWorkspace', { startSessionInWorktree } as never)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  // These specs assert the shipped Chinese copy; there is no jsdom `window`
  // in this lane, so state the asserted locale explicitly.
  ctx.locale.setLocale('zh')
  declareOwners(ctx)
  return { ctx, probe, create, status, merge, discard, startSessionInWorktree, forget }
}

/** The first registered entry's inject factory result; the registry erases the factory's type. */
function injected(ctx: Context, slot: (typeof SLOTS)[number]): WorktreeInjected {
  const entry = ctx.slots.entries(slot)[0]
  if (entry === undefined) throw new Error(`no registration on ${slot}`)
  return (entry.inject as unknown as () => WorktreeInjected)()
}

describe('ui-workspace-worktree browser half', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['slots', 'locale', 'gitWorktrees', 'workspaces', 'uiWorkspace'])
  })

  it('registers all three surfaces with their options, and fiber teardown removes them', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const project = b.ctx.slots.entries('sidebar.workspaces.projectActions')[0]
    expect(project?.options).toMatchObject({ id: 'worktree-create' })
    expect(project?.locale).toBe(NS)
    const row = b.ctx.slots.entries('sidebar.workspaces.worktreeRow')[0]
    expect(row?.locale).toBe(NS)
    const header = b.ctx.slots.entries('conversation.session.header.actions')[0]
    expect(header?.options).toMatchObject({ id: 'worktree-session', order: 5 })
    expect(header?.locale).toBe(NS)

    // Registry-contribution disposal: the fiber going down empties every hole.
    await fiber.dispose()
    for (const slot of SLOTS) expect(b.ctx.slots.entries(slot)).toHaveLength(0)
  })

  it('waits for owner declarations that arrive after apply', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('gitWorktrees', {} as never)
    ctx.provide('workspaces', {} as never)
    ctx.provide('uiWorkspace', {} as never)
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    await ctx.plugin({ inject: [...inject], apply }).await()
    for (const slot of SLOTS) expect(ctx.slots.entries(slot)).toHaveLength(0)

    declareOwners(ctx)
    await Promise.resolve()
    for (const slot of SLOTS) expect(ctx.slots.entries(slot)).toHaveLength(1)
  })

  it('routes every injected verb to its Host service', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const project = injected(b.ctx, 'sidebar.workspaces.projectActions')
    await project.probe('/repo')
    expect(b.probe).toHaveBeenCalledWith('/repo')
    await project.create('ws-1', 'fix-login', true)
    expect(b.create).toHaveBeenCalledWith('ws-1', 'fix-login', true)
    project.startSessionInWorktree('ws-new')
    expect(b.startSessionInWorktree).toHaveBeenCalledWith('ws-new')

    const row = injected(b.ctx, 'sidebar.workspaces.worktreeRow')
    await row.status('ws-1')
    expect(b.status).toHaveBeenCalledWith('ws-1')
    await row.merge('ws-1')
    expect(b.merge).toHaveBeenCalledWith('ws-1')
    await row.discard('ws-1', true)
    expect(b.discard).toHaveBeenCalledWith('ws-1', true)
    await row.forgetWorkspace('ws-1')
    expect(b.forget).toHaveBeenCalledWith('ws-1')

    const header = injected(b.ctx, 'conversation.session.header.actions')
    await header.status('ws-1')
    expect(b.status).toHaveBeenCalledTimes(2)
    await header.discard('ws-1', false)
    expect(b.discard).toHaveBeenLastCalledWith('ws-1', false)
    header.startSessionInWorktree('ws-2')
    expect(b.startSessionInWorktree).toHaveBeenLastCalledWith('ws-2')
    await header.forgetWorkspace('ws-2')
    expect(b.forget).toHaveBeenLastCalledWith('ws-2')
  })

  it('registers both dictionaries under its namespace and releases them with the fiber', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const translate = b.ctx.locale.bind(NS)
    expect(translate('action.new')).toBe(zh['action.new'])
    b.ctx.locale.setLocale('en')
    expect(translate('action.new')).toBe(en['action.new'])

    // Withdrawn dictionaries leave the key unresolved rather than translated.
    await fiber.dispose()
    expect(translate('action.new')).not.toBe(en['action.new'])
  })

  it('keeps the English dictionary key-identical to the Chinese source of truth', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('ui-workspace-worktree node half', () => {
  it('contributes no host behavior', () => {
    // The node half exists only so the plugin appears in the Loader tree.
    expect(applyNode).not.toThrow()
  })
})
