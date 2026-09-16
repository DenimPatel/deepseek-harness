/** `worktree` namespace dictionaries for the parallel-edits surfaces. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'worktree'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.new': '新建工作树',
  'action.new.aria': '在“{name}”中新建工作树会话',
  'unavailable.git': '此主机上没有可用的 git',
  'unavailable.notRepo': '该项目不是 git 仓库',
  'unavailable.linked': '该项目本身就是一个链接工作树',
  'dialog.title': '新建工作树',
  'dialog.name': '名称',
  'dialog.name.placeholder': 'fix-login',
  'dialog.branch': '分支',
  'dialog.base': '基点',
  'dialog.fallbackBase': 'HEAD',
  'dialog.setup': '运行安装命令：{command}',
  'dialog.create': '创建',
  'dialog.cancel': '取消',
  'dialog.busy': '正在创建…',
  'row.aria': '工作树“{name}”的操作',
  'row.changes.one': '{n} 个改动',
  'row.changes.other': '{n} 个改动',
  'row.ahead': '领先 {n}',
  'row.behind': '落后 {n}',
  'row.clean': '干净',
  'row.missing': '目录已丢失',
  'menu.merge': '合并',
  'menu.discard': '丢弃',
  'menu.copyPath': '复制路径',
  'menu.forget': '忘记',
  'confirm.discard.title': '丢弃工作树',
  'confirm.discard.body': '这将移除签出目录并删除分支 {branch}。{files} 个未提交文件和 {commits} 个未合并提交将丢失。会话历史会保留。',
  'confirm.discard.confirm': '丢弃',
  'confirm.merge.title': '合并工作树',
  'confirm.merge.body': '将 {branch} 合并进 {target}。',
  'confirm.merge.confirm': '合并',
  'confirm.conflict': '合并冲突：{files}。父仓库未做任何改动。',
  'confirm.cancel': '取消',
  'header.aria': '工作树分支 {branch}',
  'header.disabled.sessionRunning': '会话正在运行',
  'header.disabled.parentDirty': '父仓库有未提交的改动',
  'header.disabled.missing': '工作树目录已丢失',
  'error.title': '工作树操作失败',
  'error.close': '关闭',
} satisfies Record<string, string>

/** The worktree namespace key union. */
export type WorktreeKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Parallel-edits worktree surfaces. */
    worktree: WorktreeKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.new': 'New worktree',
  'action.new.aria': 'New worktree session in {name}',
  'unavailable.git': 'git is not available on this host',
  'unavailable.notRepo': 'This project is not a git repository',
  'unavailable.linked': 'This project is itself a linked worktree',
  'dialog.title': 'New worktree',
  'dialog.name': 'Name',
  'dialog.name.placeholder': 'fix-login',
  'dialog.branch': 'Branch',
  'dialog.base': 'Base',
  'dialog.fallbackBase': 'HEAD',
  'dialog.setup': 'Run setup: {command}',
  'dialog.create': 'Create',
  'dialog.cancel': 'Cancel',
  'dialog.busy': 'Creating…',
  'row.aria': 'Worktree actions for {name}',
  'row.changes.one': '{n} changed file',
  'row.changes.other': '{n} changed files',
  'row.ahead': '{n} ahead',
  'row.behind': '{n} behind',
  'row.clean': 'Clean',
  'row.missing': 'Directory missing',
  'menu.merge': 'Merge',
  'menu.discard': 'Discard',
  'menu.copyPath': 'Copy path',
  'menu.forget': 'Forget',
  'confirm.discard.title': 'Discard worktree',
  'confirm.discard.body': 'This removes the checkout and deletes branch {branch}. {files} uncommitted files and {commits} unmerged commits are lost. Session history is kept.',
  'confirm.discard.confirm': 'Discard',
  'confirm.merge.title': 'Merge worktree',
  'confirm.merge.body': 'Merge {branch} into {target}.',
  'confirm.merge.confirm': 'Merge',
  'confirm.conflict': 'Merge conflict on {files}. The parent repository was left untouched.',
  'confirm.cancel': 'Cancel',
  'header.aria': 'Worktree branch {branch}',
  'header.disabled.sessionRunning': 'The session is running',
  'header.disabled.parentDirty': 'The parent repository has uncommitted changes',
  'header.disabled.missing': 'The worktree directory is missing',
  'error.title': 'Worktree action failed',
  'error.close': 'Close',
} satisfies Record<WorktreeKey, string>
