# Agent Note: Observability activity timeline and harness flow

Status: implemented

English | [中文](2026-09-16-observability-activity-timeline-and-flow.zh.md)

## Problem

The Observability tab showed session aggregates only, so a person could not see what the harness did under the hood after pressing submit: which model requests, tool calls, sub-agent starts, and failures happened when, nor the system prompt, context injections, reasoning, tool arguments, and request configuration behind one turn. The browser holds only the resident Session window, so a complete time distribution cannot be folded where it is read.

## Decision

The tab gains two views beside Session and History, and the Session list stops carrying every cached projection value.

**Timeline** reads the new `activitySeries` projection unit in [`@deepseek-ai/dsh-session-stats`](../../../../packages/session/session-stats/README.md). The unit folds counted session events into bounded, oldest-first time buckets with one column per metric: `apiRequests`, `apiErrors`, `retries`, `toolCalls`, `toolErrors`, `subagentSpawns`, `turnsStarted`, `stepsClosed`, four token columns from settled `assistant/message` usage, and a `contextTokens` gauge. The grid anchors once at the first counted event and travels with the value as `originMs` and `bucketMs`, so a reader never assumes a width. It coarsens geometrically: when a sample would land at or past `maxBuckets`, the fold doubles `bucketMs` and merges adjacent pairs, adding counts and token sums while a gauge keeps the later non-zero reading. `bucketMs` (default 5000) and `maxBuckets` (default 240) are validated `Config` fields. Uncounted events return the same state reference, so stream deltas never publish. Event types contributed by other packages (`llm/retry`, `llm/retry-started`, `subagent/catalog`) are read by name from one table in [the fold](../../../../packages/session/session-stats/src/activity-projection.ts), because naming them in the switch would make this package depend on their contributors' host types.

**Flow** reads the Trajectory session-standard seat (`useTrajectory`) from the same `sidebar.right.pane.tab` props and folds its snapshot into per-turn ledgers of role, verbatim name, bounded preview, exact detail, and state — system prompts, context injections, user and steering messages, assistant text with reasoning, tool calls and results, commands, compaction, retries, and turn failures. A request row expands to the request's recorded configuration, offered tool catalog, and system prompt; a tool row expands to its arguments, the output the preview cut, and its nested dispatch calls. A tool row states no turn of its own — the tool lifecycle is assembled apart from the step boundaries and appears in neither the node locations nor the row's own record — so the fold gives it the turn and step of the record that issued it. Flow holds no rendering code from `ui-trajectory`: the shared seat is the data path across the two feature plugins. Older history pages through an injected `loadOlder` that compares the Trajectory snapshot identity before and after a page, so the control disappears at the start of the log.

The Session list reads a named key allowlist in [`api-session-controller`](../../../../packages/api/session-controller/src/list.ts) instead of every cached wire value: a registered key is not a list hint unless it is named there. A value that grows with the session stays a per-Session read, and a newly contributed key is excluded by default.

## Alternatives considered

**Folding the series in the browser from the resident window.** The client holds only the loaded window of the open session, so the distribution would trail the log and cold or unopened sessions would have no series at all. Only a whole-log host fold is complete.

**Growing `sessionStats` instead of adding a unit.** Extending the existing totals would change a durable projection's wire payload for every consumer and mix two concerns in one fold; a second key is additive and independently versioned.

**Rendering the Trajectory package's components in the sidebar.** A feature plugin may not runtime-import another feature plugin's values. The seat already carries the assembled records, so the Flow fold reads data, not components.

**An opt-out field on the projection unit for list hints.** Putting payload policy in every unit's contract leaves the seam unchanged less than naming the subset in the one reader that builds list rows.

**Fixed-width buckets with no cap.** Exact resolution everywhere, at the cost of persisted checkpoint state that grows with session length.

**Reusing the Trajectory tab instead of adding views.** The Trajectory tab owns the conversation view ring; the sidebar is where a running session is watched, and the two views answer different questions.

## Consequences

A session's activity is now visible as a complete, reload-stable distribution, and one turn's inner work is readable without leaving the sidebar. Both are extensible: a Timeline metric is one host column plus one descriptor row in [`activity-model.ts`](../../../../packages/client/ui-observability/src/client/activity-model.ts), and a further view is one id, one tab row, and one body in the panel.

The trade-offs are explicit. The token columns count settled messages, so a heavily retried turn can trail the `tokenUsage` session total, and early buckets coarsen in a long session. The client mirrors the host's gauge-column rule for display aggregation, because the column kinds are host fold semantics rather than wire data. Flow covers the loaded window and carries no images.

## Testing

[`activity-projection.spec.ts`](../../../../packages/session/session-stats/tests/activity-projection.spec.ts) pins the event-to-metric mapping, bucket placement, the exact cap boundary and cap-plus-one coarsening, the idle-gap bound, merge semantics for counts, sums, and gauges, fold immutability, and JSON round-trips of state and view. [`session-list-hints.host.spec.ts`](../../../../packages/api/session-controller/tests/session-list-hints.host.spec.ts) pins both directions of the allowlist and the contained failure that still serves the row. The client suites cover the activity folds, the chart and its table fallback, the flow fold over every record family, the turn and step a tool row takes from the record that issued it, the request and tool facts a row expands to, the ledger's chips and expansion, the paging control, and the view tabs.

## Related

- [Session observability dashboard](../../proposed/feature/2026-09-16-session-observability-dashboard.md) — the dashboard these views extend; it stays active and describes the Session and History views.
