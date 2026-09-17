/**
 * Flow view: the Trajectory snapshot's records as readable per-turn ledgers, so
 * a person can see what the harness did under the hood after pressing submit.
 * A request row expands to the request's recorded configuration, tool catalog,
 * and system prompt; a tool row expands to its arguments, cut output, and
 * nested dispatch calls.
 *
 * The seat is declared by the Trajectory plugin's session-standard
 * contribution, so it is absent in a composition that does not mount that
 * plugin; the unavailable copy is then the whole view.
 */

import { Fragment, useMemo, useState } from 'react'
import type { UseTrajectory } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { ObservabilityTranslate } from './format.ts'
import { formatDuration, formatTokens } from './format.ts'
import { buildFlow } from './flow-model.ts'
import type { FlowPromptChange, FlowRequestDetail, FlowRow, FlowToolDetail } from './flow-model.ts'
import type { ObservabilityKey } from './locales.ts'
import css from './FlowPanel.module.css'

export interface FlowPanelProps {
  /** The Trajectory seat's selector hook, or `undefined` when its plugin is not composed. */
  readonly useTrajectory: UseTrajectory | undefined
  /** Pages the Session window older; resolves the Trajectory seat's own "history moved" flag. */
  readonly loadOlder: (() => Promise<boolean>) | undefined
  readonly t: ObservabilityTranslate
}

/** Copy key for each prompt-change fact a request can log. */
const CHANGE_KEYS: Readonly<Record<FlowPromptChange, ObservabilityKey>> = {
  initial: 'flow.change.initial',
  system: 'flow.change.system',
  tools: 'flow.change.tools',
  'system-and-tools': 'flow.change.system-and-tools',
}

/** One request fact: its copy key and how its recorded value reads, when present. */
const REQUEST_FACTS: readonly {
  readonly key: ObservabilityKey
  readonly value: (detail: FlowRequestDetail, t: ObservabilityTranslate) => string | undefined
}[] = [
  { key: 'flow.request.provider', value: detail => detail.provider },
  { key: 'flow.request.model', value: detail => detail.model },
  {
    key: 'flow.request.temperature',
    value: detail => detail.temperature === undefined ? undefined : String(detail.temperature),
  },
  {
    key: 'flow.request.maxTokens',
    value: detail => detail.maxTokens === undefined ? undefined : String(detail.maxTokens),
  },
  { key: 'flow.request.thinking', value: detail => detail.thinking },
  { key: 'flow.request.effort', value: detail => detail.reasoningEffort },
  {
    key: 'flow.request.duration',
    value: (detail, t) => detail.durationMs === undefined ? undefined : formatDuration(detail.durationMs, t),
  },
  {
    key: 'flow.request.tokens',
    value: (detail, t) => detail.tokens === undefined
      ? undefined
      : t('flow.request.tokens', {
        input: formatTokens(detail.tokens.input, t),
        output: formatTokens(detail.tokens.output, t),
      }),
  },
  { key: 'flow.request.retry', value: detail => detail.retry },
]

/**
 * Render the harness flow for the current session.
 * @param props - the Trajectory seat, the older-history loader, and the bound translate seat.
 * @returns the flow view, or its unavailable copy when no plugin provides the seat.
 */
export function FlowPanel({ useTrajectory, loadOlder, t }: FlowPanelProps): React.JSX.Element {
  if (useTrajectory === undefined) {
    return (
      <section className={css.root} aria-label={t('view.flow')}>
        <p className={css.empty}>{t('flow.unavailable')}</p>
      </section>
    )
  }
  return <FlowLedger useTrajectory={useTrajectory} loadOlder={loadOlder} t={t} />
}

interface FlowLedgerProps {
  readonly useTrajectory: UseTrajectory
  readonly loadOlder: (() => Promise<boolean>) | undefined
  readonly t: ObservabilityTranslate
}

/** The ledger body; mounts only while the seat exists, so its hook call is unconditional. */
function FlowLedger({ useTrajectory, loadOlder, t }: FlowLedgerProps): React.JSX.Element {
  const snapshot = useTrajectory(value => value)
  const turns = useMemo(() => buildFlow(snapshot), [snapshot])
  const [pending, setPending] = useState(false)
  const [exhausted, setExhausted] = useState(false)

  const load = loadOlder === undefined
    ? undefined
    : (): void => {
      setPending(true)
      void loadOlder()
        // A page that moved nothing means the window reached the start of the log.
        .then((moved) => { if (!moved) setExhausted(true) })
        .finally(() => { setPending(false) })
    }

  if (turns.length === 0) {
    return (
      <section className={css.root} aria-label={t('view.flow')}>
        <p className={css.empty}>{t('flow.empty')}</p>
      </section>
    )
  }

  return (
    <section className={css.root} aria-label={t('view.flow')}>
      {load !== undefined && !exhausted && (
        <button type="button" className={css.loadOlder} disabled={pending} onClick={load}>
          {pending ? t('flow.loading') : t('flow.loadOlder')}
        </button>
      )}
      {turns.map(turn => (
        <article key={turn.turn === null ? 'between' : String(turn.turn)} className={css.turn}>
          <header className={css.turnHeader}>
            <h4 className={css.turnTitle}>
              {turn.turn === null ? t('flow.betweenTurns') : t('flow.turn', { value: String(turn.turn) })}
            </h4>
            <span className={css.turnMeta}>
              {t('flow.counts', { calls: String(turn.toolCalls), messages: String(turn.messages) })}
            </span>
          </header>
          <ul className={css.rows}>
            {turn.rows.map(row => <FlowLedgerRow key={row.key} row={row} t={t} />)}
          </ul>
        </article>
      ))}
    </section>
  )
}

/** One ledger row: its role chips and preview, expanding to the exact record. */
function FlowLedgerRow({ row, t }: { readonly row: FlowRow; readonly t: ObservabilityTranslate }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = row.detail !== undefined
    || row.reasoning !== undefined
    || row.request !== undefined
    || row.tool !== undefined
  return (
    <li className={css.row}>
      <div className={css.rowHead}>
        <span className={css.role}>{t(row.role)}</span>
        {row.name !== undefined && <span className={css.name}>{row.name}</span>}
        {row.step !== null && <span className={css.chip}>{t('flow.step', { value: String(row.step) })}</span>}
        {row.tools !== undefined && <span className={css.chip}>{t('flow.tools', { value: String(row.tools) })}</span>}
        {row.change !== undefined && <span className={css.chip}>{t(CHANGE_KEYS[row.change])}</span>}
        {row.state !== 'ok' && (
          <span className={row.state === 'running' ? css.stateRunning : css.stateError}>
            {t(row.state === 'running' ? 'flow.state.running' : 'flow.state.error')}
          </span>
        )}
      </div>
      {row.summary !== '' && <p className={css.summary}>{row.summary}</p>}
      {hasDetail && (
        <button
          type="button"
          className={css.detailToggle}
          aria-expanded={expanded}
          onClick={() => { setExpanded(current => !current) }}
        >
          {expanded ? t('flow.detail.hide') : t('flow.detail.show')}
        </button>
      )}
      {expanded && row.reasoning !== undefined && (
        <>
          <p className={css.detailLabel}>{t('flow.role.thinking')}</p>
          <pre className={css.detail}>{row.reasoning}</pre>
        </>
      )}
      {expanded && row.detail !== undefined && (
        <>
          <p className={css.detailLabel}>{t('flow.detail.label')}</p>
          <pre className={css.detail}>{row.detail}</pre>
        </>
      )}
      {expanded && row.request !== undefined && <RequestFacts detail={row.request} t={t} />}
      {expanded && row.tool !== undefined && <ToolFacts detail={row.tool} t={t} />}
    </li>
  )
}

/** The recorded facts of one provider request: configuration, catalog, system prompt. */
function RequestFacts({ detail, t }: { readonly detail: FlowRequestDetail; readonly t: ObservabilityTranslate }): React.JSX.Element {
  return (
    <>
      <dl className={css.facts}>
        {REQUEST_FACTS.map((fact) => {
          const value = fact.value(detail, t)
          return value === undefined
            ? null
            : (
              <Fragment key={fact.key}>
                <dt>{t(fact.key)}</dt>
                <dd>{value}</dd>
              </Fragment>
            )
        })}
      </dl>
      {detail.tools.length > 0 && (
        <>
          <p className={css.detailLabel}>{t('flow.request.tools')}</p>
          <p className={css.toolNames}>{detail.tools.join(', ')}</p>
        </>
      )}
      {detail.system !== undefined && (
        <>
          <p className={css.detailLabel}>{t('flow.role.system')}</p>
          <pre className={css.detail}>{detail.system}</pre>
        </>
      )}
    </>
  )
}

/** The exact recorded material of one tool row. */
function ToolFacts({ detail, t }: { readonly detail: FlowToolDetail; readonly t: ObservabilityTranslate }): React.JSX.Element {
  return (
    <>
      {detail.arguments !== undefined && (
        <>
          <p className={css.detailLabel}>{t('flow.tool.arguments')}</p>
          <pre className={css.detail}>{detail.arguments}</pre>
        </>
      )}
      {detail.output !== undefined && (
        <>
          <p className={css.detailLabel}>{t('flow.tool.output')}</p>
          <pre className={css.detail}>{detail.output}</pre>
        </>
      )}
      {detail.subCalls.length > 0 && (
        <>
          <p className={css.detailLabel}>{t('flow.tool.subCalls')}</p>
          <ul className={css.subCalls}>
            {detail.subCalls.map(call => <li key={call}>{call}</li>)}
          </ul>
        </>
      )}
    </>
  )
}
