---
description: "Whole-log conversation counts and wall times for clients and maintainers choosing, composing, or debugging the sessionStats projection unit."
kind: "package-reference"
---

# @deepseek-ai/dsh-session-stats

English | [中文](README.zh.md)

## Summary

This package gives clients whole-session turn and step counts, LLM, tool, first-token, and decode wall times through the public `sessionStats` value, plus a bounded activity histogram through `activitySeries`. Both figures come from the complete durable log, so paging and compaction do not change them. Use it when a client must display consistent conversation statistics across reloads and reduced history, or plot how much happened over the session's own clock. When whole-session statistics are unavailable, clients can use window-scoped counting instead.

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

Mount the plugin beside the session store and the projection registry when clients should display whole-session conversation figures that survive paging and compaction. The unit registers only when the registry is present.

### Composition

```yaml
- name: '@deepseek-ai/dsh-session'
- name: '@deepseek-ai/dsh-session-projection'
- name: '@deepseek-ai/dsh-session-stats'
```

### What the figures mean

| Field | Meaning |
|---|---|
| `turns` | Distinct turns with at least one closed step; rejected or empty turns are uncounted |
| `steps` | Closed steps — completed, failed, cancelled, and max-tokens steps all count |
| `llmMs` | Summed model wall time over steps that assembled a message |
| `toolMs` | Summed matched `tool/call` → `tool/result` wall time |
| `ttftMs` / `ttftSteps` | Summed first-token latency and the steps carrying it |
| `decodeMs` / `decodeTokens` | Summed decode wall time and provider output tokens over usage-reporting steps |

Every field is 0 until its first contributing event; the composed registry always serves the key, so clients read the value rather than key presence. Clients render whole-log figures through the projection seam's snapshot and change feed; the reference consumer is the web chat stats strip, whose window fold mirrors these field names as its no-unit fallback.

### The activity histogram

`activitySeries` answers "how much happened, when" over the same complete log: a fixed grid of time buckets, each holding one sample per counted metric. The columns are `apiRequests`, `apiErrors`, `retries`, `toolCalls`, `toolErrors`, `subagentSpawns`, `turnsStarted`, `stepsClosed`, the four token columns (`tokensUncachedInput`, `tokensCacheRead`, `tokensCacheWrite`, `tokensOutput`), and the `contextTokens` gauge. Counts come from the counted event types the fold names; the token columns and the gauge come from a settled `assistant/message` usage report.

The value carries its own grid: `originMs` anchors it at the first counted event, `bucketMs` is the current bucket width, and column index `i` covers `[originMs + i * bucketMs, originMs + (i + 1) * bucketMs)` in every metric, so a reader never has to know the width separately.

### Bucket policy

`bucketMs` (default 5000) and `maxBuckets` (default 240) are this plugin's `Config`. When a sample would land at or past `maxBuckets`, the fold first doubles `bucketMs` and merges adjacent pairs, which keeps the persisted state bounded and also bounds the padding a long idle gap can allocate. Counts and token sums add when pairs merge; the `contextTokens` gauge keeps the later non-zero reading.

### Config

```yaml
- name: '@deepseek-ai/dsh-session-stats'
  config:
    bucketMs: 5000
    maxBuckets: 240
```

### Listing hints

`activitySeries` is deliberately **not** a Session-list hint: the list reader names the keys it carries, so a growth-with-session value stays a per-Session read instead of riding every listed row. See [Session projection subsystem](../../../docs/subsystems/session-projection.md).

### Failures and recovery

The unit is inert without the projection registry: `inject` keeps the fiber pending and nothing registers, so other assemblies lack the `sessionStats` and `activitySeries` keys. Unmounting the plugin removes both keys, because registrations are effects on the mounting fiber. A crash-interrupted step counts after the session reloads, when crash recovery appends its synthetic `step/end`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the fold behind the figures; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design concept

The unit is a pure fold over committed session events: `step/end` is the counted step event because the agent loop appends exactly one per entered step in a `finally`, so completed, failed, cancelled, and max-tokens steps all land one. Counting assembled assistant messages instead would overcount max-tokens usage-host messages (empty content, excluded from the surface) and undercount cancelled steps (aborted before the message assembles). The wall-time folds mirror the client window fold field by field.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `inject`, `Config`, both unit registrations on the mounting fiber |
| [`src/projection.ts`](src/projection.ts) | The `sessionStats` fold: state shape, per-event transitions, wire view |
| [`src/types.ts`](src/types.ts) | One home of the `sessionStats` projection-key declaration and field types |
| [`src/activity-projection.ts`](src/activity-projection.ts) | The `activitySeries` fold: bucketing, coarsening, and column writes |
| [`src/activity-metrics.ts`](src/activity-metrics.ts) | The closed metric vocabulary and which columns are gauges |
| [`src/activity-types.ts`](src/activity-types.ts) | One home of the `activitySeries` projection-key declaration |

### Data model

The fold state holds the eight totals plus in-flight boundaries: `lastTurn` (turn of the last counted `step/end`), `openStep` (the open step's boundary facts, closed by its `assistant/message`), and `pendingCalls` (tool dispatch times by callId). The wire view is a strict subset — the eight totals — so the persisted-cache state schema extends the view schema with the boundary fields.

### Fold rules

- Uninteresting events return the same state reference; the registry's `Object.is` gate keeps the change feed quiet.
- First-token latency records the first non-empty delta chunk and survives an in-step `llm/retry`.
- Decode time and tokens accrue only over steps carrying both a first token and a valid provider usage report; malformed usage is ignored like the window fold guards node usage.
- Tool time pairs `tool/call` → `tool/result` by callId; unresolved calls are dropped at `turn/end` because results land within their turn, and a callId colliding with an `Object` prototype name reads as unmatched.
- The activity fold counts only the event types it names. Event types contributed by other packages (`llm/retry`, `llm/retry-started`, `subagent/catalog`) are read by name from one table, because naming them in the switch would make this package depend on their contributors' host types.
- A reading whose time precedes the grid anchor (clock skew) lands in the first bucket instead of a negative index.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the unit's contract is not enough. They move from the registry that drives units to adjacent session packages.

- [Session projection subsystem](../../../docs/subsystems/session-projection.md) — the registry that drives units and serves snapshot and change-feed values.
- [Session projection registry package](../session-projection/README.md) — the registry contract units register against.
- [Session package map](../README.md) — adjacent persistence, projection, title, and telemetry packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the sessionStats unit folds already-logged step boundaries into a client-facing read model and registers nothing model-facing.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the figures describe and when the unit is absent. They are current package constraints.

- **Steps count work attempted, not visible output** — a step that failed before producing visible content still closes with `step/end` and counts; a step interrupted by a crash counts after the session reloads, when crash recovery appends its synthetic `step/end`.
- **A cancelled step is counted but untimed** — no assistant message assembles, so its partial stream time enters no wall-time figure; a max-tokens usage-host message conversely contributes model time the surface does not show.
- **Counts are log-scoped, not surface-scoped** — steps whose messages were later compacted away stay counted; the figures describe the whole session, not the current model-visible surface.
- **Mounted only where the projection registry is composed** — other assemblies serve no `sessionStats` or `activitySeries` key, and their consumers fall back to window-scoped counting.
- **The histogram's token columns count settled messages** — a model attempt that never assembles an `assistant/message` contributes no token sample, so the series can trail the `tokenUsage` session total for heavily retried turns; the session total remains authoritative.
- **Bucket width changes over a long session** — the geometric roll-up keeps state bounded by doubling the width, so early buckets end up coarser than late ones; readers must take `bucketMs` from the value rather than assume the configured default.
- **A bucket's context gauge is a reading, not an aggregate** — the column records the prompt-side figure of the last settled message in that bucket, and a bucket with no such report keeps its `0`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns a single pure projection fold whose wire payload is schema-validated by the projection registry at every snapshot and change-feed emission, and the event relations the fold relies on (`step/end` exactly once per entered step, monotonic host-assigned turn numbers, chunk and tool events carrying their step coordinates and call ids) are owned and runtime-checked by dsh-agent-loop and the session surface, not here.
