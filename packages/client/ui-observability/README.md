---
description: "Read-side session observability dashboard for the dsh web client: token and time breakdowns, provider/model metrics, and the sub-agent tree, all from existing session projections."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-observability

English | [中文](README.zh.md)

## Summary

The Observability tab shows what a running session is doing beneath the transcript. It reads existing per-session projections, the session list, and the Trajectory seat, then renders a metric strip (provider, model, TTFT, decode throughput, cache-hit rate, context pressure), token and wall-time donuts, the session's sub-agent tree, a bucketed activity timeline, and a turn-by-turn harness flow. No figure is estimated: each is the durable value the host already projects or records. Open the tab from the right Sidebar's guide page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open the right Sidebar's guide page and choose Observability. The tab mounts in the right pane and can be widened or taken fullscreen with the pane's existing controls.

### Views

The Session view shows the selected session. A metric strip reports provider and model, mean first-token latency, decode throughput, cache-hit rate, context pressure against the context window, turn and step counts, total tokens, and summed model and tool time. Two donuts break the session down: tokens by bucket (uncached input, cached input, cache write, output) and wall time by model against tool. The sub-agent tree lists every descendant session with its mode, running state, provider/model, token total, and duration.

The Timeline view plots one counted activity metric over the session's durable buckets: model requests and request failures, retries, tool calls and tool failures, sub-agent starts, turns started, steps closed, the four token columns, and context pressure. A metric control selects the column, an aggregation control merges rendered buckets, and a totals table lists every metric's exact figure for the whole session.

The Flow view reads the Trajectory seat and renders the harness's own turns: the loaded system prompts, context injections, user and steering messages, assistant text with its reasoning, tool calls and results, command runs, compaction markers, model retries, and turn failures — each with its step, tool-catalog size, prompt change, and state, expanding to the exact recorded text. A request row expands to that request's recorded configuration, offered tool catalog, and system prompt; a tool row expands to its raw arguments, the output the preview cut, and any nested dispatch calls. A tool row states no turn of its own — the tool lifecycle is assembled apart from the step boundaries — so it takes the turn and step of the record that issued it. A control pages older history until the window reaches the start of the log.

The History view shows every root session the list serves: a token trendline over session completion time plus a sortable table of tokens, duration, and sub-agent count. Sub-agent logs are excluded from the trend and appear through their parent's tree instead.

Every chart carries a "view as table" control exposing exact, unrounded values.

### Reading the figures

Tokens and timing come from the durable `tokenUsage` and `sessionStats` projections; context occupancy from `contextPressure`; provider/model from `modelSelection`; the timeline's buckets from `activitySeries`; the flow from the Trajectory session-standard seat. The cross-session rows and the agent tree fold the session list's per-session projection values, which the host serves from durable checkpoints for cold sessions and from live folds for running ones. A session with no figures yet renders its empty copy rather than a fabricated reading, and the flow view says so when a composition mounts no Trajectory plugin.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The dashboard is a pure consumer: it registers no host capability, no session event, and no projection key of its own. The tab body reads the framework's standard seats — `useProjection` for the selected session, `useSessions` for the list, and `useTrajectory` for the flow — and folds them into view models of plain numbers and strings. The view switcher is a table, so a further view is one id, one tab row, and one body. Chart primitives are hand-built SVG and positioned DOM, matching the repository's no-charting-library convention.

The flow view holds no rendering code from the Trajectory package: it reads the seat's snapshot and folds each record into a ledger row carrying a locale key, the verbatim recorded name, a bounded preview, the exact detail, and a state. History paging goes through the plugin's injected `loadOlder`, which compares the Trajectory snapshot identity before and after a page so the control disappears at the start of the log.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Plugin entry: dictionaries, tab type, body seat, injected paging |
| [`src/client/face.ts`](src/client/face.ts) | The injected values the body consumes |
| [`src/client/ObservabilityPanel.tsx`](src/client/ObservabilityPanel.tsx) | Registered body: reads the standard seats, switches views |
| [`src/client/observability-model.ts`](src/client/observability-model.ts) | Pure folds: agent tree, history rows, empty-cut predicate |
| [`src/client/activity-model.ts`](src/client/activity-model.ts) | Pure folds and the metric table for the Timeline view |
| [`src/client/TimelinePanel.tsx`](src/client/TimelinePanel.tsx) | Timeline view: metric and aggregation controls over the buckets |
| [`src/client/flow-model.ts`](src/client/flow-model.ts) | Pure fold: Trajectory records regrouped into turn ledgers |
| [`src/client/FlowPanel.tsx`](src/client/FlowPanel.tsx) | Flow view: ledgers, row expansion, older-history control |
| [`src/client/charts/`](src/client/charts) | `ChartSection` shell plus the `Pie`, `Trendline`, `SeriesChart`, and `StatTile` primitives |
| [`src/client/locales.ts`](src/client/locales.ts) | The `observability` dictionary pair |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session projection subsystem](../../../docs/subsystems/session-projection.md) — the registry whose values this dashboard renders.
- [Slots reference](../../../docs/subsystems/slots.md) — the registration and props model the body uses.
- [Web client architecture](../../../docs/subsystems/web-client.md) — the object layer that serves the session list.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define what the dashboard can show from the projections it reads.

- **Session view needs at least one settled figure** — before any token or step lands, the view shows its empty copy instead of zeroed charts.
- **Wall time covers model and tool only** — the durable `sessionStats` projection carries no turn wall-clock total, so idle time between steps is not charted.
- **History is bounded by the session list** — rows come from the sessions the client list serves, not an exhaustive archive.
- **Sub-agent durations include the open turn's elapsed time** — a running child's duration grows with wall clock, so the value moves between renders.
- **Timeline resolution coarsens in the distant past** — the durable series doubles its bucket width once a session outgrows the configured cap, so early activity is charted at the widened width; the view reports the width it is reading.
- **Timeline tokens count settled messages** — a model attempt that never assembles a message contributes no token sample, so the series can trail the `tokenUsage` session total for heavily retried turns.
- **Context pressure is a gauge, not a sum** — merging buckets keeps the later reading, and a bucket where no prompt-side figure was reported shows no reading.
- **Flow covers the loaded window** — the ledger renders the records the Trajectory seat has assembled; older history arrives through the view's own control.
- **Flow has no image gallery** — image blocks contribute no ledger text or detail.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The plugin is a pure consumer whose only registrations — dictionaries, the tab type, and the body seat — are plain effects whose disposal the registration specs observe directly; it owns no mutable cross-plugin state and asserts no owned runtime relationship.
