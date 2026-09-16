/**
 * Client half of the gitWorktree Remote owner: a React-free facade that
 * unwraps Remote results, and keeps the authoritative Workspace row in view
 * before reporting a creation complete.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-git-worktree-controller/remote'
import type { RemoteFailure, RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type {
  GitWorktreeCreateValue,
  GitWorktreeMergeValue,
  GitWorktreeProbeValue,
  GitWorktreeStatusValue,
} from '../types.ts'

export type {
  GitWorktreeCreateValue, GitWorktreeMergeValue, GitWorktreeProbeValue, GitWorktreeStatusValue,
} from '../types.ts'

/** Structured failure for callers distinguishing Host worktree errors by code. */
export class GitWorktreeCommandError extends Error {
  override readonly name = 'GitWorktreeCommandError'

  /** @param rpcError - Host business or folded carrier failure. */
  constructor(readonly rpcError: RemoteFailure) {
    super(`git worktree failed: ${rpcError.code}: ${rpcError.message}`)
  }
}

/** Client git-worktree operations consumed by Client UI domains. */
export interface IGitWorktrees {
  /**
   * Observe one directory without mutating anything.
   * @param path - absolute host directory.
   * @returns git availability and repository facts.
   */
  probe(path: string): Promise<GitWorktreeProbeValue>
  /**
   * Create a linked worktree for a Workspace and resolve once its Workspace row
   * is published by the authoritative Workspace stream.
   * @param workspaceId - parent Workspace.
   * @param name - worktree name; also the branch suffix.
   * @param runSetup - run the configured setup command in the new checkout.
   * @returns the new Workspace identity and checkout facts.
   */
  create(workspaceId: WorkspaceId, name: string, runSetup?: boolean): Promise<GitWorktreeCreateValue>
  /**
   * Read the working-tree state of one worktree Workspace.
   * @param workspaceId - worktree Workspace.
   * @returns changes, ahead/behind counts, and conflicts.
   */
  status(workspaceId: WorkspaceId): Promise<GitWorktreeStatusValue>
  /**
   * Merge one worktree branch into its parent repository.
   * @param workspaceId - worktree Workspace.
   * @returns whether the merge landed, and the conflicting paths when it did not.
   */
  merge(workspaceId: WorkspaceId): Promise<GitWorktreeMergeValue>
  /**
   * Remove one worktree checkout, its branch, and its Workspace registration.
   * @param workspaceId - worktree Workspace.
   * @param force - discard uncommitted and untracked changes.
   */
  discard(workspaceId: WorkspaceId, force: boolean): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Client git-worktree operations. */
    gitWorktrees: IGitWorktrees
  }
}

/** Required Client services: the Remote namespace, the carrier, and Workspace state. */
export const inject = ['remote', 'remote.gitWorktree', 'workspaces']

/**
 * Install the Client git-worktree facade.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  new GitWorktreeClient(ctx, ctx.remote.gitWorktree, ctx.workspaces)
}

/** Client git-worktree facade over the generated Remote namespace. */
class GitWorktreeClient extends Service implements IGitWorktrees {
  /**
   * @param ctx - Client root Context.
   * @param remote - generated `gitWorktree` Remote namespace.
   * @param workspaces - Client Workspace state, the authoritative Workspace row source.
   */
  constructor(
    ctx: Context,
    private readonly remote: ClientRemote['gitWorktree'],
    private readonly workspaces: IWorkspaces,
  ) {
    super(ctx, 'gitWorktrees')
  }

  probe(path: string): Promise<GitWorktreeProbeValue> {
    return this.unwrap(this.remote.probe({ path }))
  }

  async create(workspaceId: WorkspaceId, name: string, runSetup = true): Promise<GitWorktreeCreateValue> {
    const created = await this.unwrap(this.remote.create({ workspaceId, name, runSetup }))
    await this.awaitWorkspace(created.workspaceId)
    return created
  }

  status(workspaceId: WorkspaceId): Promise<GitWorktreeStatusValue> {
    return this.unwrap(this.remote.status({ workspaceId }))
  }

  merge(workspaceId: WorkspaceId): Promise<GitWorktreeMergeValue> {
    return this.unwrap(this.remote.merge({ workspaceId }))
  }

  async discard(workspaceId: WorkspaceId, force: boolean): Promise<void> {
    await this.unwrap(this.remote.discard({ workspaceId, force }))
  }

  /**
   * Wait until the authoritative Workspace stream publishes the row the Host
   * just committed. The registry write resolves before its stream increment
   * arrives, and a surface that opens the new Workspace needs the row.
   */
  private async awaitWorkspace(workspaceId: WorkspaceId): Promise<void> {
    const source = this.workspaces.list
    if (source.getSnapshot().items.some(item => item.workspaceId === workspaceId)) return
    await new Promise<void>((resolve) => {
      const stop = source.subscribe(() => {
        if (!source.getSnapshot().items.some(item => item.workspaceId === workspaceId)) return
        stop()
        resolve()
      })
    })
  }

  private async unwrap<T>(pending: Promise<RemoteResult<T>>): Promise<T> {
    const result = await pending
    if (!result.ok) throw new GitWorktreeCommandError(result.error)
    return result.value
  }
}
