/**
 * Host git-worktree Remote owner over the real Workspace registry: every
 * `gitWorktree/*` command forwards to the worktree service and maps its
 * failures onto the Remote failure codes.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { GitWorktreeError, type GitWorktreeFailure } from '@deepseek-ai/dsh-workspace-worktree'
import GitWorktreeController from '../src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

/** Workspace roots created per test, removed after their context settles. */
const tempDirs: string[] = []

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** The worktree service seam the controller forwards to, stubbed per test. */
interface WorktreeStub {
  probe: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  merge: ReturnType<typeof vi.fn>
  remove: ReturnType<typeof vi.fn>
}

async function harness() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-git-worktree-controller-')))
  tempDirs.push(root)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  const gitWorktree: WorktreeStub = {
    probe: vi.fn(),
    create: vi.fn(),
    status: vi.fn(),
    merge: vi.fn(),
    remove: vi.fn(),
  }
  ctx.provide('gitWorktree', gitWorktree as never)
  const controller = new GitWorktreeController(ctx)
  return { controller, ctx, gitWorktree, root }
}

function stageDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

/** Register a parent repository Workspace and one linked-worktree Workspace under it. */
async function registerWorktree(ctx: Context, root: string, name: string) {
  const parent = await ctx.workspaceRegistry.create(stageDir(root, `${name}-parent`))
  const checkout = stageDir(root, `${name}-checkout`)
  const workspace = await ctx.workspaceRegistry.createWorktree({
    path: checkout,
    title: name,
    parentWorkspaceId: parent.id,
    repoPath: parent.path,
    branch: `dsh/${name}`,
    baseBranch: 'main',
    baseRevision: 'base-revision',
  })
  return { parent, checkout, workspace }
}

describe('GitWorktreeController probe', () => {
  it('maps every probe field, including the optional ones present', async () => {
    const { controller, gitWorktree } = await harness()
    gitWorktree.probe.mockResolvedValueOnce({
      gitAvailable: true,
      isRepository: true,
      isMainWorktree: true,
      branch: 'main',
      head: 'a'.repeat(40),
      dirty: true,
      setupCommand: 'pnpm install',
    })

    await expect(controller.probe({ path: '/repo' })).resolves.toEqual({
      gitAvailable: true,
      isRepository: true,
      isMainWorktree: true,
      branch: 'main',
      head: 'a'.repeat(40),
      dirty: true,
      setupCommand: 'pnpm install',
    })
    expect(gitWorktree.probe).toHaveBeenCalledWith('/repo')
  })

  it('omits absent optional probe fields', async () => {
    const { controller, gitWorktree } = await harness()
    gitWorktree.probe.mockResolvedValueOnce({
      gitAvailable: false,
      isRepository: false,
      isMainWorktree: false,
      branch: undefined,
      head: undefined,
      dirty: false,
      setupCommand: undefined,
    })

    const result = await controller.probe({ path: '/plain' })

    expect(result).toEqual({
      gitAvailable: false,
      isRepository: false,
      isMainWorktree: false,
      dirty: false,
    })
    expect('branch' in result).toBe(false)
    expect('head' in result).toBe(false)
    expect('setupCommand' in result).toBe(false)
  })
})

describe('GitWorktreeController create', () => {
  it('creates the checkout, registers the Workspace, and defaults the base branch to HEAD', async () => {
    const { controller, ctx, gitWorktree, root } = await harness()
    const parent = await ctx.workspaceRegistry.create(stageDir(root, 'project'))
    const checkout = stageDir(root, 'feature-one')
    gitWorktree.create.mockResolvedValueOnce({
      path: checkout,
      branch: 'dsh/Feature-One',
      baseRevision: 'revision-one',
    })

    const created = await controller.create({ workspaceId: parent.id, name: 'Feature One' })

    expect(gitWorktree.create).toHaveBeenCalledWith({ repoPath: parent.path, name: 'Feature One' })
    expect(typeof created.workspaceId).toBe('string')
    expect(created.workspaceId.length).toBeGreaterThan(0)
    expect(created).toMatchObject({
      path: checkout,
      branch: 'dsh/Feature-One',
    })
    expect(ctx.workspaceRegistry.get(created.workspaceId)).toMatchObject({
      path: checkout,
      title: 'Feature One',
      worktree: {
        parentWorkspaceId: parent.id,
        repoPath: parent.path,
        branch: 'dsh/Feature-One',
        baseBranch: 'HEAD',
        baseRevision: 'revision-one',
      },
    })
  })

  it('forwards an explicit base ref and setup opt-out', async () => {
    const { controller, ctx, gitWorktree, root } = await harness()
    const parent = await ctx.workspaceRegistry.create(stageDir(root, 'project'))
    const checkout = stageDir(root, 'older')
    gitWorktree.create.mockResolvedValueOnce({
      path: checkout,
      branch: 'dsh/older',
      baseRevision: 'revision-two',
    })

    const created = await controller.create({
      workspaceId: parent.id,
      name: 'older',
      baseRef: 'HEAD~1',
      runSetup: false,
    })

    expect(gitWorktree.create).toHaveBeenCalledWith({
      repoPath: parent.path,
      name: 'older',
      baseRef: 'HEAD~1',
      runSetup: false,
    })
    expect(ctx.workspaceRegistry.get(created.workspaceId)).toMatchObject({
      worktree: { baseBranch: 'HEAD~1', baseRevision: 'revision-two' },
    })
  })

  it.each([
    ['git-unavailable', 'git-worktree/git-unavailable'],
    ['not-a-repository', 'git-worktree/not-a-repository'],
    ['invalid-name', 'git-worktree/invalid-name'],
    ['path-exists', 'git-worktree/path-exists'],
    ['branch-exists', 'git-worktree/branch-exists'],
    ['unsupported-parent', 'git-worktree/unsupported-parent'],
    ['create-failed', 'git-worktree/create-failed'],
    ['setup-failed', 'git-worktree/setup-failed'],
  ] as ReadonlyArray<readonly [GitWorktreeFailure, string]>)(
    'maps create %s to %s',
    async (code, remoteCode) => {
      const { controller, ctx, gitWorktree, root } = await harness()
      const parent = await ctx.workspaceRegistry.create(stageDir(root, 'project'))
      gitWorktree.create.mockRejectedValueOnce(new GitWorktreeError(code, `${code} failure`))

      const failure = await controller
        .create({ workspaceId: parent.id, name: 'feature' })
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(RemoteError)
      expect(failure).toMatchObject({ code: remoteCode, message: `${code} failure` })
    },
  )

  it('passes an already-mapped RemoteError through unchanged', async () => {
    const { controller, ctx, gitWorktree, root } = await harness()
    const parent = await ctx.workspaceRegistry.create(stageDir(root, 'project'))
    const mapped = new RemoteError('gateway/internal', 'already mapped', {})
    gitWorktree.create.mockRejectedValueOnce(mapped)

    await expect(controller.create({ workspaceId: parent.id, name: 'feature' })).rejects.toBe(mapped)
  })
})

describe('GitWorktreeController status', () => {
  it('projects the working-tree state and reports a vanished checkout as missing', async () => {
    const { controller, ctx, gitWorktree, root } = await harness()
    const { workspace } = await registerWorktree(ctx, root, 'status')
    gitWorktree.status.mockResolvedValueOnce({
      dirty: true,
      changedFiles: ['tracked.txt'],
      commitsAhead: 2,
      commitsBehind: 1,
      conflicts: [],
    })

    await expect(controller.status({ workspaceId: workspace.id })).resolves.toEqual({
      missing: false,
      dirty: true,
      changedFiles: ['tracked.txt'],
      commitsAhead: 2,
      commitsBehind: 1,
      conflicts: [],
    })
    expect(gitWorktree.status).toHaveBeenCalledWith({ path: workspace.path, baseRef: 'main' })

    gitWorktree.status.mockRejectedValueOnce(new GitWorktreeError('not-found', 'checkout is gone'))
    await expect(controller.status({ workspaceId: workspace.id })).resolves.toEqual({
      missing: true,
      dirty: false,
      changedFiles: [],
      commitsAhead: 0,
      commitsBehind: 0,
      conflicts: [],
    })
  })

  it('maps a non-missing status failure and preserves an unexpected error', async () => {
    const { controller, ctx, gitWorktree, root } = await harness()
    const { workspace } = await registerWorktree(ctx, root, 'status-failure')
    gitWorktree.status.mockRejectedValueOnce(new GitWorktreeError('remove-failed', 'status exploded'))

    await expect(controller.status({ workspaceId: workspace.id }))
      .rejects.toMatchObject({ code: 'git-worktree/remove-failed' })

    const plain = new Error('storage exploded')
    gitWorktree.status.mockRejectedValueOnce(plain)
    await expect(controller.status({ workspaceId: workspace.id })).rejects.toBe(plain)

    gitWorktree.status.mockRejectedValueOnce('string failure')
    await expect(controller.status({ workspaceId: workspace.id })).rejects.toThrow('string failure')
  })
})

describe('GitWorktreeController merge', () => {
  it('reports a landed merge and a conflicting merge', async () => {
    const { controller, ctx, gitWorktree, root } = await harness()
    const { workspace } = await registerWorktree(ctx, root, 'merge')
    const worktree = workspace.worktree
    if (worktree === undefined) throw new Error('fixture Workspace lost its worktree descriptor')

    gitWorktree.merge.mockResolvedValueOnce({ outcome: 'merged', targetRef: 'main', revision: 'merged-revision' })
    await expect(controller.merge({ workspaceId: workspace.id })).resolves.toEqual({
      merged: true,
      targetRef: 'main',
      conflicts: [],
    })
    expect(gitWorktree.merge).toHaveBeenCalledWith({ repoPath: worktree.repoPath, branch: worktree.branch })

    gitWorktree.merge.mockResolvedValueOnce({
      outcome: 'conflict',
      targetRef: 'main',
      conflicts: ['tracked.txt'],
    })
    await expect(controller.merge({ workspaceId: workspace.id })).resolves.toEqual({
      merged: false,
      targetRef: 'main',
      conflicts: ['tracked.txt'],
    })
  })

  it.each([
    ['parent-dirty', 'git-worktree/parent-dirty'],
    ['parent-busy', 'git-worktree/parent-busy'],
    ['merge-failed', 'git-worktree/merge-failed'],
    ['not-found', 'git-worktree/missing'],
  ] as ReadonlyArray<readonly [GitWorktreeFailure, string]>)(
    'maps merge %s to %s',
    async (code, remoteCode) => {
      const { controller, ctx, gitWorktree, root } = await harness()
      const { workspace } = await registerWorktree(ctx, root, 'merge-failure')
      gitWorktree.merge.mockRejectedValueOnce(new GitWorktreeError(code, 'merge blocked'))

      await expect(controller.merge({ workspaceId: workspace.id }))
        .rejects.toMatchObject({ code: remoteCode, message: 'merge blocked' })
    },
  )
})

describe('GitWorktreeController discard', () => {
  it('removes the checkout before deleting the Workspace registration', async () => {
    const { controller, ctx, gitWorktree, root } = await harness()
    const { workspace } = await registerWorktree(ctx, root, 'discard')
    const worktree = workspace.worktree
    if (worktree === undefined) throw new Error('fixture Workspace lost its worktree descriptor')
    const order: string[] = []
    gitWorktree.remove.mockImplementationOnce(() => {
      order.push('git-remove')
      return { removed: true }
    })
    const originalDelete = ctx.workspaceRegistry.delete.bind(ctx.workspaceRegistry)
    vi.spyOn(ctx.workspaceRegistry, 'delete').mockImplementation(async (id) => {
      order.push('registry-delete')
      return await originalDelete(id)
    })

    await expect(controller.discard({ workspaceId: workspace.id, force: true })).resolves.toEqual({
      discarded: true,
    })

    expect(order).toEqual(['git-remove', 'registry-delete'])
    expect(gitWorktree.remove).toHaveBeenCalledWith({
      repoPath: worktree.repoPath,
      path: workspace.path,
      branch: worktree.branch,
      force: true,
    })
    expect(ctx.workspaceRegistry.get(workspace.id)).toBeUndefined()
  })

  it('maps a failed removal and keeps the Workspace registration', async () => {
    const { controller, ctx, gitWorktree, root } = await harness()
    const { workspace } = await registerWorktree(ctx, root, 'discard-failure')
    gitWorktree.remove.mockRejectedValueOnce(new GitWorktreeError('remove-failed', 'removal blocked'))

    await expect(controller.discard({ workspaceId: workspace.id, force: false }))
      .rejects.toMatchObject({ code: 'git-worktree/remove-failed' })
    expect(gitWorktree.remove).toHaveBeenCalledWith(expect.objectContaining({ force: false }))
    expect(ctx.workspaceRegistry.get(workspace.id)).toBeDefined()
  })
})

describe('GitWorktreeController resolution', () => {
  it('reports an unknown Workspace', async () => {
    const { controller } = await harness()
    const missing = 'missing' as WorkspaceId

    await expect(controller.status({ workspaceId: missing }))
      .rejects.toMatchObject({ code: 'workspace/not-found', details: { workspaceId: missing } })
    await expect(controller.merge({ workspaceId: missing }))
      .rejects.toMatchObject({ code: 'workspace/not-found' })
    await expect(controller.discard({ workspaceId: missing, force: false }))
      .rejects.toMatchObject({ code: 'workspace/not-found' })
  })

  it('reports a Workspace that is not a linked worktree', async () => {
    const { controller, ctx, root } = await harness()
    const plain = await ctx.workspaceRegistry.create(stageDir(root, 'plain'))

    await expect(controller.status({ workspaceId: plain.id }))
      .rejects.toMatchObject({ code: 'git-worktree/not-a-worktree', details: { workspaceId: plain.id } })
    await expect(controller.merge({ workspaceId: plain.id }))
      .rejects.toMatchObject({ code: 'git-worktree/not-a-worktree' })
    await expect(controller.discard({ workspaceId: plain.id, force: true }))
      .rejects.toMatchObject({ code: 'git-worktree/not-a-worktree' })
  })
})
