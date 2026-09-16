/** Host git-worktree Remote owner: worktree operations over Typert Remote. */

import { Context } from '@deepseek-ai/cordis'
import type { Workspace, WorkspaceId, WorkspaceWorktree } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace'
import { GitWorktreeError } from '@deepseek-ai/dsh-workspace-worktree'
import type {} from '@deepseek-ai/dsh-workspace-worktree'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  GitWorktreeCreateRequest,
  GitWorktreeCreateValue,
  GitWorktreeDiscardRequest,
  GitWorktreeDiscardValue,
  GitWorktreeMergeRequest,
  GitWorktreeMergeValue,
  GitWorktreeProbeRequest,
  GitWorktreeProbeValue,
  GitWorktreeStatusRequest,
  GitWorktreeStatusValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host git-worktree business API and Remote namespace owner. */
    gitWorktreeController: GitWorktreeController
  }
}

/** Host service backing the generated `ctx.remote.gitWorktree` namespace. */
export class GitWorktreeController extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry', 'gitWorktree']

  /** @param ctx - Host context with the Workspace registry and the worktree service. */
  constructor(ctx: Context) {
    super(ctx, 'gitWorktreeController', { namespace: 'gitWorktree' })
  }

  /**
   * Observe one directory without mutating anything.
   * @param request - absolute directory to observe.
   * @returns whether git is usable, whether the directory is a repository, and its state.
   */
  @Remote('probe')
  async probe(request: GitWorktreeProbeRequest): Promise<GitWorktreeProbeValue> {
    const probe = await this.ctx.gitWorktree.probe(request.path)
    return {
      gitAvailable: probe.gitAvailable,
      isRepository: probe.isRepository,
      isMainWorktree: probe.isMainWorktree,
      dirty: probe.dirty,
      ...probe.branch === undefined ? {} : { branch: probe.branch },
      ...probe.head === undefined ? {} : { head: probe.head },
      ...probe.setupCommand === undefined ? {} : { setupCommand: probe.setupCommand },
    }
  }

  /**
   * Create one linked worktree from a registered Workspace and register the
   * checkout as a Workspace of its own.
   * @param request - parent Workspace, worktree name, and optional base ref.
   * @returns the new Worktree Workspace plus its checkout facts.
   */
  @Remote('create')
  async create(request: GitWorktreeCreateRequest): Promise<GitWorktreeCreateValue> {
    const parent = this.requireWorkspace(request.workspaceId)
    const created = await this.mapFailure(request.workspaceId, parent.path, () => this.ctx.gitWorktree.create({
      repoPath: parent.path,
      name: request.name,
      ...request.baseRef === undefined ? {} : { baseRef: request.baseRef },
      ...request.runSetup === undefined ? {} : { runSetup: request.runSetup },
    }))
    const workspace = await this.ctx.workspaceRegistry.createWorktree({
      path: created.path,
      title: request.name.trim(),
      parentWorkspaceId: request.workspaceId,
      repoPath: parent.path,
      branch: created.branch,
      baseBranch: request.baseRef ?? 'HEAD',
      baseRevision: created.baseRevision,
    })
    return { workspaceId: workspace.id, path: created.path, branch: created.branch }
  }

  /**
   * Read the working-tree state of one worktree Workspace.
   * @param request - the worktree Workspace.
   * @returns changes, ahead/behind counts, and conflicts, or a `missing` report.
   */
  @Remote('status')
  async status(request: GitWorktreeStatusRequest): Promise<GitWorktreeStatusValue> {
    const { workspace, worktree } = this.requireWorktree(request.workspaceId)
    try {
      const status = await this.ctx.gitWorktree.status({
        path: workspace.path,
        baseRef: worktree.baseBranch,
      })
      return { missing: false, ...status }
    } catch (error) {
      // A directory removed outside the harness is a reported fact, not a
      // failure: the durable record survives and the surface offers Forget.
      if (error instanceof GitWorktreeError && error.code === 'not-found') {
        return {
          missing: true,
          dirty: false,
          changedFiles: [],
          commitsAhead: 0,
          commitsBehind: 0,
          conflicts: [],
        }
      }
      throw this.remoteFailure(request.workspaceId, workspace.path, error)
    }
  }

  /**
   * Merge one worktree branch into its parent repository.
   * @param request - the worktree Workspace.
   * @returns whether the merge landed, and the conflicting paths when it did not.
   */
  @Remote('merge')
  async merge(request: GitWorktreeMergeRequest): Promise<GitWorktreeMergeValue> {
    const { workspace, worktree } = this.requireWorktree(request.workspaceId)
    return this.mapFailure(request.workspaceId, workspace.path, async () => {
      const result = await this.ctx.gitWorktree.merge({
        repoPath: worktree.repoPath,
        branch: worktree.branch,
      })
      return result.outcome === 'merged'
        ? { merged: true, targetRef: result.targetRef, conflicts: [] }
        : { merged: false, targetRef: result.targetRef, conflicts: result.conflicts }
    })
  }

  /**
   * Remove one worktree checkout, its branch, and its Workspace registration.
   * Session logs are never touched: removing a registration leaves every
   * session that ran in the directory in place, ungrouped.
   * @param request - the worktree Workspace and whether to discard its changes.
   * @returns discard confirmation.
   */
  @Remote('discard')
  async discard(request: GitWorktreeDiscardRequest): Promise<GitWorktreeDiscardValue> {
    const { workspace, worktree } = this.requireWorktree(request.workspaceId)
    await this.mapFailure(request.workspaceId, workspace.path, () => this.ctx.gitWorktree.remove({
      repoPath: worktree.repoPath,
      path: workspace.path,
      branch: worktree.branch,
      force: request.force,
    }))
    await this.ctx.workspaceRegistry.delete(request.workspaceId)
    return { discarded: true }
  }

  /** Resolve a registered Workspace or report the Remote failure for it. */
  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) {
      throw new RemoteError('workspace/not-found', `Workspace "${workspaceId}" not found`, { workspaceId })
    }
    return workspace
  }

  /** Resolve a registered Workspace that carries a worktree descriptor. */
  private requireWorktree(workspaceId: WorkspaceId): {
    workspace: Workspace
    worktree: WorkspaceWorktree
  } {
    const workspace = this.requireWorkspace(workspaceId)
    const worktree = workspace.worktree
    if (worktree === undefined) {
      throw new RemoteError(
        'git-worktree/not-a-worktree',
        `Workspace "${workspaceId}" is not a linked worktree`,
        { workspaceId },
      )
    }
    return { workspace, worktree }
  }

  /** Run one operation, mapping its failure onto the Remote failure vocabulary. */
  private async mapFailure<T>(
    workspaceId: WorkspaceId,
    path: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw this.remoteFailure(workspaceId, path, error)
    }
  }

  /** Translate one service failure, leaving non-worktree errors untouched. */
  private remoteFailure(workspaceId: WorkspaceId, path: string, error: unknown): Error {
    if (error instanceof RemoteError) return error
    if (!(error instanceof GitWorktreeError)) {
      return error instanceof Error ? error : new Error(String(error))
    }
    const options = { cause: error }
    switch (error.code) {
      case 'git-unavailable':
        return new RemoteError('git-worktree/git-unavailable', error.message, {}, options)
      case 'not-a-repository':
        return new RemoteError('git-worktree/not-a-repository', error.message, { path }, options)
      case 'invalid-name':
        return new RemoteError('git-worktree/invalid-name', error.message, { workspaceId }, options)
      case 'path-exists':
        return new RemoteError('git-worktree/path-exists', error.message, { workspaceId }, options)
      case 'branch-exists':
        return new RemoteError('git-worktree/branch-exists', error.message, { workspaceId }, options)
      case 'unsupported-parent':
        return new RemoteError('git-worktree/unsupported-parent', error.message, { workspaceId }, options)
      case 'create-failed':
        return new RemoteError('git-worktree/create-failed', error.message, { workspaceId }, options)
      case 'setup-failed':
        return new RemoteError('git-worktree/setup-failed', error.message, { workspaceId }, options)
      case 'parent-dirty':
        return new RemoteError('git-worktree/parent-dirty', error.message, { workspaceId }, options)
      case 'parent-busy':
        return new RemoteError('git-worktree/parent-busy', error.message, { workspaceId }, options)
      case 'merge-failed':
        return new RemoteError('git-worktree/merge-failed', error.message, { workspaceId }, options)
      case 'remove-failed':
        return new RemoteError('git-worktree/remove-failed', error.message, { workspaceId }, options)
      case 'not-found':
        return new RemoteError('git-worktree/missing', error.message, { workspaceId }, options)
      /* v8 ignore next 3 -- closed failure-code union; a new code must be mapped here */
      default:
        return assertNever(error.code)
    }
  }
}

/* v8 ignore next 3 -- closed-union backstop */
function assertNever(value: never): never {
  throw new Error(`unmapped git-worktree failure code: ${String(value)}`)
}

export default GitWorktreeController
