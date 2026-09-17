/**
 * Pure view-model folds for the Flow view: the Trajectory snapshot's records
 * regrouped into per-turn ledgers a person can read after pressing submit.
 *
 * The fold owns no copy: each row carries the locale key naming its role plus
 * the verbatim recorded data, and the component renders them. Nothing here
 * reaches the session; the Trajectory target already assembled the snapshot.
 */

import type {
  AssistantBlock,
  ContextMessageNode,
  ConversationLocation,
  ConversationNode,
  ModelRetryNode,
  PartialAssistant,
  RequestView,
  RunningToolCall,
  SystemPromptNode,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { ObservabilityKey } from './locales.ts'

/** Longest preview the ledger keeps on one line before it needs expansion. */
const PREVIEW_LIMIT = 120

/**
 * Sort key for records that have no log position yet: an in-flight row follows
 * every settled row of its turn.
 */
const PENDING_SEQ = Number.MAX_SAFE_INTEGER

/** How a request changed the prompt it inherited, when it logged a change. */
export type FlowPromptChange = 'initial' | 'system' | 'tools' | 'system-and-tools'

/** How one row reads: settled, failed, or still in flight. */
export type FlowRowState = 'ok' | 'error' | 'running'

/** One row of the under-the-hood ledger. */
export interface FlowRow {
  /** Stable React key, unique across every turn group. */
  readonly key: string
  /** Log sequence the row is anchored at; the ledger's sort key. */
  readonly seq: number
  /** Unix epoch ms of the anchoring record, or `0` for a row with no log position yet. */
  readonly time: number
  /** Owning turn, or `null` for records placed between turns. */
  readonly turn: number | null
  /** Owning step, or `null` when the record is turn-scoped. */
  readonly step: number | null
  /** Locale key naming the row's role. */
  readonly role: ObservabilityKey
  /** Verbatim business name: tool, command, producer, provider, or failure code. */
  readonly name?: string
  /** One-line preview of the recorded text. */
  readonly summary: string
  /** Exact recorded text or arguments, present when the preview is cut. */
  readonly detail?: string
  readonly state: FlowRowState
  /** Tool-catalog size the request carried. */
  readonly tools?: number
  /** Prompt change the request logged. */
  readonly change?: FlowPromptChange
  /** Reasoning text recorded alongside an assistant message. */
  readonly reasoning?: string
}

/** One turn's ledger, or the between-turns group when `turn` is `null`. */
export interface FlowTurn {
  readonly turn: number | null
  /** Earliest row seq in the group; the group's sort key. */
  readonly seq: number
  /** Earliest logged time in the group. */
  readonly time: number
  readonly rows: readonly FlowRow[]
  /** Rows recording a tool call or tool result. */
  readonly toolCalls: number
  /** Rows recording a user, steering, or assistant message. */
  readonly messages: number
}

/** One content block's text, or `''` for a block that carries none. */
function contentBlockText(block: ContextMessageNode['content'][number]): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'tool-call':
      return block.name
    case 'tool-result':
      return block.content.map(contentBlockText).join(' ')
    default:
      return ''
  }
}

/** The joined text of one content-block list. */
function contentText(blocks: readonly ContextMessageNode['content'][number][]): string {
  return blocks.map(contentBlockText).filter(text => text !== '').join('\n')
}

/** The joined text of the assistant blocks of one kind; other kinds carry none. */
function assistantText(blocks: readonly AssistantBlock[], kind: 'text' | 'reasoning'): string {
  return blocks
    .flatMap(block => block.kind === kind ? [block.text] : [])
    .filter(text => text !== '')
    .join('\n')
}

/** Collapse one recorded text into a preview, keeping the exact text when it is cut. */
function preview(text: string): { summary: string; detail?: string } {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= PREVIEW_LIMIT) return { summary: collapsed }
  return { summary: `${collapsed.slice(0, PREVIEW_LIMIT)}…`, detail: text.trim() }
}

/** Resolve the turn and step of one record from the node, else from its location. */
function locate(
  seq: number,
  own: { turn?: number; step?: number },
  locations: ReadonlyMap<number, ConversationLocation>,
): { turn: number | null; step: number | null } {
  const location = locations.get(seq)
  if (location?.kind === 'step') return { turn: location.turn.turn, step: location.step.step }
  if (location?.kind === 'turn') return { turn: location.turn.turn, step: null }
  return { turn: own.turn ?? null, step: own.step ?? null }
}

/** One ledger row for a loaded system prompt. */
function systemPromptRow(prompt: SystemPromptNode): FlowRow {
  return {
    key: `system:${prompt.seq}`,
    seq: prompt.seq,
    time: prompt.time,
    turn: prompt.turn,
    step: prompt.step,
    role: 'flow.role.system',
    ...preview(prompt.text),
    state: 'ok',
  }
}

/** One ledger row for a tool result, paired with its call head when in-window. */
function toolResultRow(node: ToolResultNode, locations: ReadonlyMap<number, ConversationLocation>): FlowRow {
  const { turn, step } = locate(node.seq, {}, locations)
  const output = preview(contentText(node.content))
  const detail = output.detail ?? node.call?.argsRaw
  return {
    key: `tool:${node.seq}:${node.callId}`,
    seq: node.seq,
    time: node.time,
    turn,
    step,
    role: 'flow.role.tool',
    ...node.call === null ? {} : { name: node.call.name },
    summary: output.summary,
    state: node.isError ? 'error' : 'ok',
    ...detail === undefined ? {} : { detail },
  }
}

/** One ledger row for a model-retry notice. */
function modelRetryRow(node: ModelRetryNode): FlowRow {
  return {
    key: `retry:${node.seq}`,
    seq: node.seq,
    time: node.time,
    turn: node.turn,
    step: node.step,
    role: 'flow.role.retry',
    name: node.provider,
    summary: node.failure.message,
    state: node.retryState === 'cancelled' ? 'ok' : 'running',
  }
}

/** One ledger row for a durable conversation node. */
function nodeRow(node: ConversationNode, locations: ReadonlyMap<number, ConversationLocation>): FlowRow {
  switch (node.kind) {
    case 'user': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `user:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.user',
        ...preview(contentText(node.content)),
        state: 'ok',
      }
    }
    case 'steering': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `steering:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.steering',
        ...preview(contentText(node.content)),
        state: 'ok',
      }
    }
    case 'context': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `context:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.context',
        name: node.producer.label ?? node.producer.role,
        ...preview(contentText(node.content)),
        state: 'ok',
      }
    }
    case 'assistant': {
      const reasoning = assistantText(node.blocks, 'reasoning')
      return {
        key: `assistant:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn: node.turn,
        step: node.step,
        role: 'flow.role.assistant',
        ...preview(assistantText(node.blocks, 'text')),
        state: node.interrupted === true ? 'error' : 'ok',
        ...reasoning === '' ? {} : { reasoning },
      }
    }
    case 'tool-result':
      return toolResultRow(node, locations)
    case 'command': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `command:${node.seq}:${node.commandId}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.command',
        ...node.name === null ? {} : { name: node.name },
        ...preview(node.outcome?.text ?? node.args ?? ''),
        state: node.outcome === null ? 'running' : node.outcome.kind === 'error' ? 'error' : 'ok',
      }
    }
    case 'compaction': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `compaction:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.compaction',
        ...preview(node.summary ?? ''),
        state: 'ok',
      }
    }
    case 'model-retry':
      return modelRetryRow(node)
    case 'turn-error':
      return {
        key: `turn-error:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn: node.turn,
        step: node.step,
        role: 'flow.role.error',
        ...node.code === undefined ? {} : { name: node.code },
        summary: node.message,
        state: 'error',
      }
    case 'turn-max-tokens':
      return {
        key: `max-tokens:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn: node.turn,
        step: node.step,
        role: 'flow.role.maxTokens',
        summary: '',
        state: 'ok',
      }
    // A surface event this UI version does not model still shows its type
    // instead of vanishing from the ledger.
    case 'unknown': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `unknown:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.unknown',
        name: node.type,
        summary: '',
        state: 'ok',
      }
    }
  }
}

/** One ledger row for a provider request, carrying its prompt-change fact. */
function requestRow(request: RequestView): FlowRow {
  const provider = request.providerMetadata?.provider ?? request.requestConfig?.provider
  const model = request.providerMetadata?.model ?? request.requestConfig?.model ?? ''
  const tools = request.purpose === 'assistant' ? request.prompt?.tools.length : undefined
  return {
    key: `request:${request.startSeq}`,
    seq: request.startSeq,
    time: request.startedAt,
    turn: request.turn,
    step: request.step,
    role: 'flow.role.request',
    ...provider === undefined ? {} : { name: provider },
    summary: model,
    state: request.status === 'running' ? 'running' : request.status === 'error' ? 'error' : 'ok',
    ...tools === undefined ? {} : { tools },
    ...request.purpose === 'assistant' && request.promptChange !== undefined
      ? { change: request.promptChange.kind }
      : {},
    ...request.error === undefined ? {} : { detail: request.error },
  }
}

/** One ledger row for the in-flight assistant output. */
function partialRow(partial: PartialAssistant): FlowRow {
  return {
    key: `partial:${partial.turn}:${partial.step}`,
    seq: PENDING_SEQ,
    time: 0,
    turn: partial.turn,
    step: partial.step,
    role: 'flow.role.assistant',
    ...preview(assistantText(partial.blocks, 'text')),
    state: 'running',
  }
}

/** One ledger row for a tool call whose result has not landed. */
function runningCallRow(call: RunningToolCall): FlowRow {
  return {
    key: `call:${call.callId}`,
    seq: PENDING_SEQ,
    time: 0,
    turn: call.turn,
    step: call.step,
    role: 'flow.role.tool',
    name: call.name,
    summary: '',
    state: 'running',
    detail: call.argsRaw,
  }
}

/** Earliest logged time in one group, or `0` while every row is still pending. */
function earliestTime(rows: readonly FlowRow[]): number {
  const logged = rows.filter(row => row.time > 0).map(row => row.time)
  return logged.length === 0 ? 0 : Math.min(...logged)
}

/** Group rows into one ordered ledger. */
function toTurn(turn: number | null, rows: readonly FlowRow[]): FlowTurn {
  const ordered = [...rows].sort((left, right) => left.seq - right.seq || left.key.localeCompare(right.key))
  return {
    turn,
    seq: Math.min(...ordered.map(row => row.seq)),
    time: earliestTime(ordered),
    rows: ordered,
    toolCalls: ordered.filter(row => row.role === 'flow.role.tool').length,
    messages: ordered.filter(row =>
      row.role === 'flow.role.user'
      || row.role === 'flow.role.steering'
      || row.role === 'flow.role.assistant').length,
  }
}

/** Sort rank of one turn group: numbered turns ascend, the between-turns group is last. */
function turnOrder(turn: number | null): number {
  return turn === null ? Number.MAX_SAFE_INTEGER : turn
}

/** Order two turn groups. */
function compareTurns(left: FlowTurn, right: FlowTurn): number {
  return turnOrder(left.turn) - turnOrder(right.turn)
}

/**
 * Group the Trajectory snapshot's records into readable turn ledgers.
 * @param snapshot - the assembled Trajectory snapshot for one session.
 * @returns one ledger per turn, oldest first, with the between-turns group last.
 */
export function buildFlow(snapshot: TrajectorySnapshot): FlowTurn[] {
  const rows: FlowRow[] = []
  for (const node of snapshot.eventNodes) rows.push(nodeRow(node, snapshot.eventLocations))
  for (const prompt of snapshot.systemPrompts ?? []) rows.push(systemPromptRow(prompt))
  for (const request of snapshot.requests) rows.push(requestRow(request))
  if (snapshot.partial !== null) rows.push(partialRow(snapshot.partial))
  for (const call of snapshot.runningCalls) rows.push(runningCallRow(call))

  const groups = new Map<number | null, FlowRow[]>()
  for (const row of rows) {
    const bucket = groups.get(row.turn)
    if (bucket === undefined) groups.set(row.turn, [row])
    else bucket.push(row)
  }
  return [...groups.entries()].map(([turn, groupRows]) => toTurn(turn, groupRows)).sort(compareTurns)
}
