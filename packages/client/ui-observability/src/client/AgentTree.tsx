/** Full-panel sub-agent tree: provider/model, token totals, and duration per node. */

import { formatDuration, formatTokens } from './format.ts'
import type { ObservabilityTranslate } from './format.ts'
import type { AgentTreeNode } from './observability-model.ts'
import css from './AgentTree.module.css'

export interface AgentTreeProps {
  /** The root session node with nested sub-agent children. */
  readonly root: AgentTreeNode
  readonly t: ObservabilityTranslate
}

/**
 * Render the session's sub-agent tree.
 * @param props - root node and the bound translate seat.
 * @returns the tree section.
 */
export function AgentTree({ root, t }: AgentTreeProps): React.JSX.Element {
  return (
    <section className={css.root} aria-label={t('tree.title')}>
      <h3 className={css.title}>{t('tree.title')}</h3>
      {root.children.length === 0
        ? <p className={css.empty}>{t('tree.empty')}</p>
        : <ul className={css.tree} role="tree" aria-label={t('tree.title')}><Node node={root} depth={0} t={t} /></ul>}
    </section>
  )
}

function Node({
  node,
  depth,
  t,
}: {
  readonly node: AgentTreeNode
  readonly depth: number
  readonly t: ObservabilityTranslate
}): React.JSX.Element {
  const metrics = [
    node.tokenTotal === undefined ? null : formatTokens(node.tokenTotal, t),
    node.durationMs === undefined ? null : formatDuration(node.durationMs, t),
  ].filter((value): value is string => value !== null).join(' · ')
  return (
    <li className={css.node} role="treeitem" aria-level={depth + 1} data-running={node.running || undefined}>
      <div className={css.row}>
        <span className={css.state} aria-hidden="true" />
        <span className={css.label}>{node.label}</span>
        {node.mode !== 'root' && (
          <span className={css.mode}>{node.mode === 'continuable' ? t('mode.continuable') : t('mode.oneShot')}</span>
        )}
        {node.provider !== undefined && node.model !== undefined && (
          <span className={css.model}>{node.provider}/{node.model}</span>
        )}
        <span className={css.stateText}>{node.running ? t('tree.running') : t('tree.settled')}</span>
        {metrics !== '' && <span className={css.metrics}>{metrics}</span>}
      </div>
      {node.children.length > 0 && (
        <ul className={css.children} role="group">
          {node.children.map(child => <Node key={child.id} node={child} depth={depth + 1} t={t} />)}
        </ul>
      )}
    </li>
  )
}
