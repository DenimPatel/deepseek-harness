# Agent Note: Session observability dashboard — a read-side view over existing projections

Status: proposed

English | [中文](2026-09-16-session-observability-dashboard.zh.md)

## Problem

An ML/LLM engineer watching a session cannot see the harness's own behavior — tokens by bucket, model against tool time, first-token latency, decode throughput, cache-hit rate, context pressure, provider/model, and the sub-agent tree — from the chat transcript alone. The facts already exist durably: `assistant/message` carries `TokenUsage` and a token-timestamped stream, `request/header` carries provider/model, and the per-session projections `sessionStats`, `tokenUsage`, `contextPressure`, `subagentTiming`, and `subagent` fold the log into exactly these figures. The session list already carries each listed session's projection values, served for cold sessions from the durable projection cache and for live ones from their folds.

What is missing is a dedicated view. `StatsPills` is a tooltip-sized readout, `SubagentHeaderLineage` is a compact navigation dropdown, and the Trajectory tab is an event ledger. None combines per-session figures with a cross-session trend and the full sub-agent tree. The earlier plan proposed a new host package `session-observability-rollup` plus a Host→Client bridge to expose cross-session results. Tracing the client shows that bridge does not exist as a per-key binding: projection values reach components generically through `useProjection` and the session list's `projectionValues`. A host rollup would therefore duplicate `session-controller`'s existing list fold and add a capability with no distinct consumer.

## Proposal

Add one browser package, `@deepseek-ai/dsh-client-ui-observability`, that registers a right-Sidebar tab type named Observability with a guide entry, and mounts its body through the `sidebar.right.pane.tab` slot. The body reads only the framework's standard seats: `useProjection` for the selected session and `useSessions` for the list. It folds them with pure functions (`buildAgentTree`, `buildHistoryRows`, `format*`) into plain numbers and renders a metric strip, token and wall-time donuts, the sub-agent tree, and a cross-session token trendline over a sortable exact-figure table.

Every figure is a durable projected value; a session without figures renders its empty copy rather than a zeroed or estimated chart. Charts are hand-built SVG and positioned DOM (the repository ships no charting library), each with a "view as table" control exposing exact values. All copy flows through the `observability` locale dictionary.

The package adds no host package, no Remote method, no projection key, and no session event. Cross-session rows and the agent tree fold the session list's already-served `projectionValues`; the selected session's figures arrive through the existing generic projection delivery. This keeps the change read-side and removes the plan's two pieces that duplicated existing infrastructure. The plan's automatic-fullscreen open is dropped because `ISidebarRight` exposes no mode-setting operation; the tab uses the pane's existing widen and fullscreen chrome controls instead.

## Alternatives considered

- **Host `session-observability-rollup` plus a Host→Client bridge.** Rejected: it would re-fold what `session-controller` already serves to the browser and would add a public capability with no consumer that the client-side fold cannot serve.
- **A new projection key for the rollup.** Rejected: cross-session aggregation is not per-session state, and the change is explicitly read-side.
- **A charting dependency.** Rejected: no package in the repository uses one, and the dependency rules require evidence for a public choice that a hand-built donut and polyline do not need.
- **A conversation-view tab instead of a Sidebar tab.** Considered; the Sidebar tab keeps the dashboard independent of the conversation's own view ring.
- **Exposing `setMode` on `ISidebarRight` to force fullscreen.** Deferred: it widens a core Client service for one caller when the pane already offers the control.

## Acceptance criteria

- The Observability tab type appears on the right Sidebar guide page and opens its body in the pane.
- The session view renders the metric strip, both donuts, and the sub-agent tree from the standard seats, with empty copy before any figure arrives.
- The history view renders the cross-session token trendline and a table sortable by tokens, duration, and sub-agent count, excluding sub-agent-origin logs.
- Every chart exposes a table fallback with exact values; all copy resolves through the `observability` dictionary.
- Registration, fold, format, and component specs pass, and plugin teardown removes every registration.

## Risks

- Per-step throughput is not projected; the dashboard shows whole-session decode throughput and defers a step trendline until a consumer needs it.
- A running sub-agent's duration grows with wall clock, so the tree value moves between renders.
- History is bounded by the sessions the client list serves, not an exhaustive archive.
- The tab opens in the docked pane, not automatically fullscreen as the original plan assumed; a wide or fullscreen pane depends on the existing chrome control.
