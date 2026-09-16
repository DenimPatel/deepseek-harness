/**
 * Parallel-edits worktree surfaces: the Project row's New-worktree entry and
 * its create dialog, one worktree row's status and actions, and the Session
 * header's branch control. Every surface reads live state through the
 * framework's hooks and reaches the Host only through injected callbacks.
 */

import { useCallback, useMemo, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  GitWorktreeCreateValue, GitWorktreeProbeValue, GitWorktreeStatusValue,
} from '@deepseek-ai/dsh-api-git-worktree-controller/client'
import type {
  WorkspaceProjectActionsOwnerProps, WorkspaceWorktreeRowOwnerProps,
} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from './locales.ts'
import css from './WorktreeActions.module.css'

/** Injected Host capabilities every worktree surface reads. */
export interface WorktreeInjected {
  /** Read a directory's git facts, including the configured setup command. */
  probe: (path: string) => Promise<GitWorktreeProbeValue>
  /** Create one linked worktree and resolve once its Workspace row is published. */
  create: (workspaceId: string, name: string, runSetup: boolean) => Promise<GitWorktreeCreateValue>
  /** Read one worktree Workspace's working-tree state. */
  status: (workspaceId: string) => Promise<GitWorktreeStatusValue>
  /** Merge one worktree branch into its parent repository. */
  merge: (workspaceId: string) => Promise<{ merged: boolean; targetRef: string; conflicts: readonly string[] }>
  /** Remove one worktree checkout, its branch, and its Workspace registration. */
  discard: (workspaceId: string, force: boolean) => Promise<void>
  /** Open the Session a worktree Workspace backs, creating its blank Session when needed. */
  startSessionInWorktree: (workspaceId: string) => void
  /** Forget a Workspace registration whose directory is gone. */
  forgetWorkspace: (workspaceId: string) => Promise<void>
}

/** Project-row trigger and its create dialog. */
export type WorktreeCreateActionProps =
  WorkspaceProjectActionsOwnerProps & PropsLocale<typeof NS> & WorktreeInjected

/** One worktree row's status chip and action menu. */
export type WorktreeRowActionsProps =
  WorkspaceWorktreeRowOwnerProps & PropsLocale<typeof NS> & WorktreeInjected

/** Session-header worktree control. */
export type SessionHeaderWorktreeProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS> & WorktreeInjected

/** Why the create entry is unavailable, already localized; absent means it is available. */
function unavailableReason(
  probe: GitWorktreeProbeValue | undefined,
  t: WorktreeCreateActionProps['t'],
): string | undefined {
  if (probe === undefined) return undefined
  if (!probe.gitAvailable) return t('unavailable.git')
  if (!probe.isRepository) return t('unavailable.notRepo')
  if (!probe.isMainWorktree) return t('unavailable.linked')
  return undefined
}

/**
 * The Project row's New-worktree trigger and its create dialog.
 * @param props - owner share, locale seat, and injected Host capabilities.
 * @returns the trigger button plus the dialog while it is open.
 */
export function WorktreeCreateAction({
  workspaceId, title, cwd, t, probe, create, startSessionInWorktree,
}: WorktreeCreateActionProps) {
  const [facts, setFacts] = useState<GitWorktreeProbeValue | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [runSetup, setRunSetup] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const reason = unavailableReason(facts, t)

  const openDialog = useCallback(() => {
    setError(undefined)
    void probe(cwd).then((value) => {
      setFacts(value)
      const blocked = unavailableReason(value, t)
      if (blocked === undefined) setOpen(true)
      else setError(blocked)
    }, (failure: unknown) => { setError(String(failure)) })
  }, [cwd, probe, t])

  const submit = useCallback(() => {
    setBusy(true)
    setError(undefined)
    void create(workspaceId, name, runSetup).then(
      (created) => {
        setBusy(false)
        setOpen(false)
        startSessionInWorktree(created.workspaceId)
      },
      (failure: unknown) => { setBusy(false); setError(String(failure)) },
    )
  }, [create, name, runSetup, startSessionInWorktree, workspaceId])

  const setupCommand = facts?.setupCommand
  return (
    <>
      <button
        type="button"
        className={css.iconButton}
        aria-label={t('action.new.aria', { name: title })}
        title={reason ?? t('action.new')}
        disabled={reason !== undefined}
        onClick={(e) => { e.stopPropagation(); openDialog() }}
      >
        {t('action.new')}
      </button>
      {error !== undefined && !open && <span className={css.inlineError}>{error}</span>}
      <Modal
        open={open}
        onClose={() => { setOpen(false) }}
        title={t('dialog.title')}
        closeLabel={t('dialog.cancel')}
      >
        <label className={css.field}>
          <span>{t('dialog.name')}</span>
          <input
            value={name}
            placeholder={t('dialog.name.placeholder')}
            onChange={(e) => { setName(e.target.value) }}
          />
        </label>
        <div className={css.readonly}>{t('dialog.branch')}: {name.trim() === '' ? '—' : name.trim()}</div>
        <div className={css.readonly}>{t('dialog.base')}: {facts?.branch ?? facts?.head ?? t('dialog.fallbackBase')}</div>
        {setupCommand !== undefined && (
          <label className={css.checkbox}>
            <input
              type="checkbox"
              checked={runSetup}
              onChange={(e) => { setRunSetup(e.target.checked) }}
            />
            <span>{t('dialog.setup', { command: setupCommand })}</span>
          </label>
        )}
        {error !== undefined && <p className={css.error}>{error}</p>}
        <div className={css.actions}>
          <button type="button" onClick={() => { setOpen(false) }}>{t('dialog.cancel')}</button>
          <button
            type="button"
            disabled={busy || name.trim() === ''}
            onClick={submit}
          >
            {busy ? t('dialog.busy') : t('dialog.create')}
          </button>
        </div>
      </Modal>
    </>
  )
}

/**
 * One worktree row's status chip and Merge/Discard/Forget menu.
 * @param props - owner share, locale seat, and injected Host capabilities.
 * @returns the row decoration.
 */
export function WorktreeRowActions({
  workspaceId, branch, t, status, merge, discard, forgetWorkspace,
}: WorktreeRowActionsProps) {
  const [state, setState] = useState<GitWorktreeStatusValue | undefined>(undefined)
  const [confirming, setConfirming] = useState<'merge' | 'discard' | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)

  const refresh = useCallback(() => {
    void status(workspaceId).then(setState, (failure: unknown) => { setMessage(String(failure)) })
  }, [status, workspaceId])

  const chip = state === undefined
    ? undefined
    : state.missing
      ? t('row.missing')
      : state.dirty
        ? t(state.changedFiles.length === 1 ? 'row.changes.one' : 'row.changes.other', { n: state.changedFiles.length })
        : state.commitsAhead > 0
          ? t('row.ahead', { n: state.commitsAhead })
          : state.commitsBehind > 0
            ? t('row.behind', { n: state.commitsBehind })
            : t('row.clean')

  return (
    <span className={css.rowActions}>
      <button type="button" className={css.chip} onClick={(e) => { e.stopPropagation(); refresh() }}>
        {chip ?? branch}
      </button>
      {state?.missing === true
        ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void forgetWorkspace(workspaceId) }}
          >
            {t('menu.forget')}
          </button>
        )
        : (
          <>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirming('merge') }}>
              {t('menu.merge')}
            </button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirming('discard') }}>
              {t('menu.discard')}
            </button>
          </>
        )}
      {message !== undefined && <span className={css.inlineError}>{message}</span>}
      {confirming !== undefined && (
        <Modal
          open
          onClose={() => { setConfirming(undefined) }}
          title={confirming === 'merge' ? t('confirm.merge.title') : t('confirm.discard.title')}
          closeLabel={t('confirm.cancel')}
        >
          <p>
            {confirming === 'merge'
              ? t('confirm.merge.body', { branch, target: t('dialog.base') })
              : t('confirm.discard.body', {
                branch,
                files: state?.changedFiles.length ?? 0,
                commits: state?.commitsAhead ?? 0,
              })}
          </p>
          <div className={css.actions}>
            <button type="button" onClick={() => { setConfirming(undefined) }}>{t('confirm.cancel')}</button>
            <button
              type="button"
              onClick={() => {
                const action = confirming
                setConfirming(undefined)
                if (action === 'merge') {
                  void merge(workspaceId).then(
                    (result) => {
                      setMessage(result.merged
                        ? undefined
                        : t('confirm.conflict', { files: result.conflicts.join(', ') }))
                      refresh()
                    },
                    (failure: unknown) => { setMessage(String(failure)) },
                  )
                } else {
                  void discard(workspaceId, true).then(
                    () => { setMessage(undefined) },
                    (failure: unknown) => { setMessage(String(failure)) },
                  )
                }
              }}
            >
              {confirming === 'merge' ? t('confirm.merge.confirm') : t('confirm.discard.confirm')}
            </button>
          </div>
        </Modal>
      )}
    </span>
  )
}

/**
 * The Session header's worktree control: a branch chip plus Merge and Discard,
 * disabled with a localized reason while the Session is running or the parent
 * repository is dirty.
 * @param props - session-scope runtime share, locale seat, and injected Host capabilities.
 * @returns the control, or nothing when this Session is not in a worktree.
 */
export function SessionHeaderWorktree({
  useWorkspaces, sessionId, useSession, t, status, merge, discard,
}: SessionHeaderWorktreeProps) {
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const running = useSession(snapshot => snapshot.running)
  const worktree = useMemo(
    () => workspaces.find(workspace =>
      workspace.worktree !== undefined && workspace.sessionIds.includes(sessionId)),
    [workspaces, sessionId],
  )
  const [state, setState] = useState<GitWorktreeStatusValue | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const workspaceId = worktree?.workspaceId
  const branch = worktree?.worktree?.branch ?? ''

  const refresh = useCallback((id: string) => {
    void status(id).then(setState, (failure: unknown) => { setMessage(String(failure)) })
  }, [status])

  if (worktree === undefined || workspaceId === undefined) return null
  const reason = running
    ? t('header.disabled.sessionRunning')
    : state?.missing === true
      ? t('header.disabled.missing')
      : undefined
  return (
    <span className={css.headerControl} onPointerEnter={() => { refresh(workspaceId) }}>
      <span className={css.chip} aria-label={t('header.aria', { branch })}>{branch}</span>
      <button
        type="button"
        disabled={reason !== undefined}
        title={reason}
        onClick={() => {
          void merge(workspaceId).then(() => { refresh(workspaceId) }, (failure: unknown) => { setMessage(String(failure)) })
        }}
      >
        {t('menu.merge')}
      </button>
      <button
        type="button"
        disabled={reason !== undefined}
        title={reason}
        onClick={() => {
          void discard(workspaceId, true).then(() => { refresh(workspaceId) }, (failure: unknown) => { setMessage(String(failure)) })
        }}
      >
        {t('menu.discard')}
      </button>
      {message !== undefined && <span className={css.inlineError}>{message}</span>}
    </span>
  )
}
