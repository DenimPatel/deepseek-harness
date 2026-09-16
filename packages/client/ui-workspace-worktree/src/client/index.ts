/**
 * Parallel-edits worktree plugin, browser half. Occupies three slots declared
 * elsewhere: the Project row's extra actions (the New-worktree entry and its
 * dialog), one worktree row's status and actions, and the Session header's
 * worktree control. Each surface reads live state through framework hooks and
 * reaches the Host through injected callbacks.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-git-worktree-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorktreeInjected } from './WorktreeActions.ts'
import { SessionHeaderWorktree, WorktreeCreateAction, WorktreeRowActions } from './WorktreeActions.tsx'
import { en, NS, zh } from './locales.ts'

export type { WorktreeInjected } from './WorktreeActions.ts'

/** Required Client services. */
export const inject = ['slots', 'locale', 'gitWorktrees', 'workspaces', 'uiWorkspace']

/**
 * Register the dictionaries and every worktree surface.
 * @param ctx - Client root Context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace-worktree: dictionaries')

  const injected = (): WorktreeInjected => ({
    probe: path => ctx.gitWorktrees.probe(path),
    create: (workspaceId, name, runSetup) => ctx.gitWorktrees.create(
      workspaceId as never, name, runSetup),
    status: workspaceId => ctx.gitWorktrees.status(workspaceId as never),
    merge: workspaceId => ctx.gitWorktrees.merge(workspaceId as never),
    discard: (workspaceId, force) => ctx.gitWorktrees.discard(workspaceId as never, force),
    startSessionInWorktree: (workspaceId) => { ctx.uiWorkspace.startSessionInWorktree(workspaceId as never) },
    forgetWorkspace: workspaceId => ctx.workspaces.delete(workspaceId as never),
  })

  ctx.slots.inject('sidebar.workspaces.projectActions', () => ctx.slots.register({
    name: 'sidebar.workspaces.projectActions',
    id: 'worktree-create',
    locale: NS,
    inject: injected,
  }, WorktreeCreateAction))
  ctx.slots.inject('sidebar.workspaces.worktreeRow', () => ctx.slots.register({
    name: 'sidebar.workspaces.worktreeRow',
    locale: NS,
    inject: injected,
  }, WorktreeRowActions))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'worktree-session',
    // After the static Session identity control and before background jobs.
    order: 5,
    locale: NS,
    inject: injected,
  }, SessionHeaderWorktree))
}
