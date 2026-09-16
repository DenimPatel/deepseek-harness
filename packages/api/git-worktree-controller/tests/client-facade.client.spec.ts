/**
 * Client git-worktree facade over a stubbed Remote namespace and Workspace
 * source: Remote results are unwrapped, and `create` waits for the
 * authoritative Workspace row before it resolves.
 */

import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { apply, GitWorktreeCommandError, type IGitWorktrees } from '../src/client/index.ts'
import type { WorkspaceId, WorkspaceView } from '../src/types.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

const wid = (value: string): WorkspaceId => value as WorkspaceId

const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const err = (error: RemoteFailure): RemoteResult<never> => ({ ok: false, error })

/** The five generated Remote methods, each stubbed per test. */
type RemoteMethod = 'probe' | 'create' | 'status' | 'merge' | 'discard'

function remoteFace(): Record<RemoteMethod, Mock> {
  return {
    probe: vi.fn(),
    create: vi.fn(),
    status: vi.fn(),
    merge: vi.fn(),
    discard: vi.fn(),
  }
}

function view(id: string): WorkspaceView {
  return {
    workspaceId: wid(id),
    path: `/work/${id}`,
    title: id,
    sessionIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Observable Workspace row source the facade waits on after `create`. */
function workspaceSource(initial: readonly WorkspaceView[] = []) {
  let snapshot: { readonly items: readonly WorkspaceView[] } = { items: initial }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    publish: (workspace: WorkspaceView) => {
      snapshot = { items: [...snapshot.items, workspace] }
      for (const listener of listeners) listener()
    },
    listenerCount: () => listeners.size,
  }
}

function harness(initial: readonly WorkspaceView[] = []) {
  const ctx = new Context()
  roots.push(ctx)
  const remote = remoteFace()
  const source = workspaceSource(initial)
  ctx.provide('remote', { gitWorktree: remote } as never)
  ctx.provide('workspaces', { list: source } as never)
  apply(ctx)
  return { client: ctx.gitWorktrees, remote, source }
}

describe('GitWorktreeClient commands', () => {
  it('unwraps successful probe, status, merge, and discard results', async () => {
    const { client, remote } = harness()
    remote.probe.mockResolvedValueOnce(ok({
      gitAvailable: true,
      isRepository: true,
      isMainWorktree: true,
      dirty: false,
    }))
    remote.status.mockResolvedValueOnce(ok({
      missing: false,
      dirty: true,
      changedFiles: ['tracked.txt'],
      commitsAhead: 1,
      commitsBehind: 0,
      conflicts: [],
    }))
    remote.merge.mockResolvedValueOnce(ok({ merged: true, targetRef: 'main', conflicts: [] }))
    remote.discard.mockResolvedValueOnce(ok({ discarded: true }))

    await expect(client.probe('/repo')).resolves.toEqual({
      gitAvailable: true,
      isRepository: true,
      isMainWorktree: true,
      dirty: false,
    })
    await expect(client.status(wid('worktree'))).resolves.toEqual({
      missing: false,
      dirty: true,
      changedFiles: ['tracked.txt'],
      commitsAhead: 1,
      commitsBehind: 0,
      conflicts: [],
    })
    await expect(client.merge(wid('worktree'))).resolves.toEqual({
      merged: true,
      targetRef: 'main',
      conflicts: [],
    })
    await expect(client.discard(wid('worktree'), true)).resolves.toBeUndefined()

    expect(remote.probe).toHaveBeenCalledWith({ path: '/repo' })
    expect(remote.status).toHaveBeenCalledWith({ workspaceId: 'worktree' })
    expect(remote.merge).toHaveBeenCalledWith({ workspaceId: 'worktree' })
    expect(remote.discard).toHaveBeenCalledWith({ workspaceId: 'worktree', force: true })
  })
})

describe('GitWorktreeClient create', () => {
  it('resolves immediately when the Workspace row is already published', async () => {
    const { client, remote, source } = harness([view('worktree')])
    remote.create.mockResolvedValueOnce(ok({
      workspaceId: wid('worktree'),
      path: '/work/checkout',
      branch: 'dsh/feature',
    }))

    await expect(client.create(wid('parent'), 'feature', false)).resolves.toEqual({
      workspaceId: 'worktree',
      path: '/work/checkout',
      branch: 'dsh/feature',
    })

    expect(remote.create).toHaveBeenCalledWith({ workspaceId: 'parent', name: 'feature', runSetup: false })
    expect(source.listenerCount()).toBe(0)
  })

  it('waits for the Workspace row that lands after the call before resolving create', async () => {
    const { client, remote, source } = harness()
    remote.create.mockResolvedValueOnce(ok({
      workspaceId: wid('worktree'),
      path: '/work/checkout',
      branch: 'dsh/feature',
    }))
    let settled = false
    const pending = client.create(wid('parent'), 'feature').then((value) => {
      settled = true
      return value
    })

    await delay(0)
    expect(settled).toBe(false)
    expect(source.listenerCount()).toBe(1)
    expect(remote.create).toHaveBeenCalledWith({ workspaceId: 'parent', name: 'feature', runSetup: true })

    source.publish(view('other'))
    await delay(0)
    expect(settled).toBe(false)

    source.publish(view('worktree'))
    await expect(pending).resolves.toEqual({
      workspaceId: 'worktree',
      path: '/work/checkout',
      branch: 'dsh/feature',
    })
    expect(settled).toBe(true)
    expect(source.listenerCount()).toBe(0)
  })
})

describe('GitWorktreeClient failures', () => {
  const calls: ReadonlyArray<readonly [RemoteMethod, (client: IGitWorktrees) => Promise<unknown>]> = [
    ['probe', client => client.probe('/repo')],
    ['create', client => client.create(wid('parent'), 'feature')],
    ['status', client => client.status(wid('worktree'))],
    ['merge', client => client.merge(wid('worktree'))],
    ['discard', client => client.discard(wid('worktree'), false)],
  ]

  it.each(calls)('throws a GitWorktreeCommandError for a failed %s result', async (method, call) => {
    const { client, remote } = harness()
    const failure = new RemoteError('git-worktree/missing', 'checkout is gone', {
      workspaceId: wid('worktree'),
    })
    remote[method].mockResolvedValueOnce(err(failure))

    const error = await call(client).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(GitWorktreeCommandError)
    expect((error as GitWorktreeCommandError).rpcError).toBe(failure)
    expect((error as GitWorktreeCommandError).rpcError.code).toBe('git-worktree/missing')
    expect((error as Error).message).toBe('git worktree failed: git-worktree/missing: checkout is gone')
  })
})
