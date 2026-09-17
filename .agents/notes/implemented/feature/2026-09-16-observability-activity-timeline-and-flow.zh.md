# Agent Note: 可观测性活动时间线与 harness 流程

Status: implemented

[English](2026-09-16-observability-activity-timeline-and-flow.md) | 中文

## Problem

可观测性标签页此前只展示会话聚合数字，因此人们看不到 harness 在按下提交之后究竟做了什么：哪些模型请求、工具调用、子代理启动与失败发生在何时，也看不到某一轮背后的系统提示、上下文注入、思考、工具参数与请求配置。浏览器只持有常驻的 Session 窗口，因此完整的时间分布无法在读取处折叠出来。

## Decision

该标签页在会话与历史之外新增两个视图，同时会话列表不再承载全部已缓存投影值。

**时间线**读取 [`@deepseek-ai/dsh-session-stats`](../../../../packages/session/session-stats/README.zh.md) 中新增的 `activitySeries` 投影单元。该单元把被计数的会话事件折叠为有界、由旧到新的时间分桶，每个指标一列：`apiRequests`、`apiErrors`、`retries`、`toolCalls`、`toolErrors`、`subagentSpawns`、`turnsStarted`、`stepsClosed`、来自已结算 `assistant/message` 用量的四个令牌列，以及 `contextTokens` 仪表值。网格在首个被计数事件处一次性锚定，并随值以 `originMs` 与 `bucketMs` 一同传递，因此读取方从不假定宽度。网格按几何方式变粗：当样本将落在 `maxBuckets` 或之后时，折叠把 `bucketMs` 加倍并合并相邻对，计数与令牌求和相加，而仪表值保留较晚的非零读数。`bucketMs`（默认 5000）与 `maxBuckets`（默认 240）是经过校验的 `Config` 字段。未被计数的事件返回同一状态引用，因此流式增量从不发布。由其他包贡献的事件类型（`llm/retry`、`llm/retry-started`、`subagent/catalog`）在[折叠](../../../../packages/session/session-stats/src/activity-projection.ts)中从同一张表按名读取，因为在 switch 中点名它们会让本包依赖其贡献者的宿主类型。

**流程**从同一 `sidebar.right.pane.tab` 属性中读取轨迹会话标准席位（`useTrajectory`），把其快照折叠为逐轮台账：区域、逐字名称、有界预览、精确详情与状态——涵盖系统提示、上下文注入、用户与插话消息、带思考的助手正文、工具调用与结果、命令、压缩、重试与轮次失败。请求行可展开为该请求记录的配置、所提供工具目录、系统提示，以及——当结算报告了用量时——其互斥的令牌分桶(未缓存输入、输出、缓存读取、缓存写入)与基于其计算的缓存命中率(计费提示令牌中缓存读取的占比：未缓存输入加缓存读取)，复用与会话视图整会话指标卡片相同的 `cacheHitRatio`/`formatRatio` 辅助函数；工具行可展开为参数、被预览截断的输出及其嵌套派发调用。工具行自身不声明轮次——工具生命周期与步骤边界分开组装，既不在节点位置中也不在该行自身记录中——因此折叠为它取发出它的那条记录所属的轮次与步骤。流程不持有 `ui-trajectory` 的任何渲染代码：跨两个功能插件的通路是共享席位。更早的历史通过注入的 `loadOlder` 翻页，它比较翻页前后轨迹快照的同一性，因此控件会在日志起点处消失。

会话列表改为读取 [`api-session-controller`](../../../../packages/api/session-controller/src/list.ts) 中的具名键白名单，而不再读取每个已缓存 wire 值：已注册的键只有在被点名时才是列表提示。随会话增长的值因此保留为按会话读取，新贡献的键默认被排除。

## Alternatives considered

**在浏览器中从常驻窗口折叠该序列。** 客户端只持有当前会话已加载的窗口，因此分布会落后于日志，冷会话或未打开的会话则完全没有序列。只有全日志的宿主折叠才是完整的。

**扩充 `sessionStats` 而不新增单元。** 扩展既有总计会为所有消费者改变一个持久投影的 wire payload，并把两件事混进同一个折叠；新增一个键是可加的，且可独立版本化。

**在侧栏渲染轨迹包的组件。** 功能插件不得运行时导入另一功能插件的值。席位已经携带组装好的记录，因此流程折叠读取的是数据，而不是组件。

**在投影单元上加列表提示的退出字段。** 把 payload 策略放进每个单元的约定，不如在唯一构建列表行的读取方中点名子集，后者完全不动 seam。

**无上限的固定宽度分桶。** 处处精确，代价是随会话长度增长的持久检查点状态。

**复用轨迹标签页而不新增视图。** 轨迹标签页属于会话视图环；侧栏才是观察运行中会话的地方，而两个视图回答不同的问题。

## Consequences

会话的活动现在以完整、跨重载稳定的分布呈现，单一轮次的内部工作也能在不离开侧栏的情况下阅读。两者都可扩展：时间线的一个指标等于一列宿主数据加 [`activity-model.ts`](../../../../packages/client/ui-observability/src/client/activity-model.ts) 中的一行描述符，而新增一个视图等于一个 id、一行标签与一个主体。

取舍是明确的。令牌列只统计已结算消息，因此重试密集的轮次可能落后于 `tokenUsage` 的会话合计；长会话中早期分桶会变粗。客户端为展示聚合镜像了宿主的仪表列规则，因为列的分类属于宿主折叠语义，而非 wire 数据。流程只覆盖已加载窗口，且不包含图片。

## Testing

[`activity-projection.spec.ts`](../../../../packages/session/session-stats/tests/activity-projection.spec.ts) 固定了事件到指标的映射、分桶落点、上限边界与上限加一时的变粗、空闲间隙的边界、计数/求和/仪表值的合并语义、折叠不可变性，以及状态与视图的 JSON 往返。[`session-list-hints.host.spec.ts`](../../../../packages/api/session-controller/tests/session-list-hints.host.spec.ts) 固定白名单的两个方向，以及仍能提供该行的受控失败。客户端套件覆盖活动折取、图表及其表格回退、覆盖每类记录的流程折取、工具行从发出它的记录取得的轮次与步骤、行展开后的请求与工具事实(包括已结算请求用量所携带的按请求令牌分桶与缓存命中率)、台账的标签与展开、翻页控件，以及视图标签。

## Related

- [会话可观测性面板](../../proposed/feature/2026-09-16-session-observability-dashboard.zh.md)——这两个视图所扩展的面板；该备注保持有效，描述会话与历史视图。
