---
description: "dsh Web 客户端的只读会话可观测性面板：令牌与耗时构成、提供方/模型指标以及子代理树，全部来自既有会话投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-observability

[English](README.md) | 中文

## 概述

可观测性标签页展示会话在对话记录之下的运行情况。它读取既有的按会话投影、会话列表与轨迹席位，然后渲染指标条（提供方、模型、首字延迟、解码吞吐、缓存命中率、上下文占用）、令牌与耗时环形图、会话的子代理树、按桶分箱的活动时间线，以及逐轮的 harness 流程。没有任何数字是估算的：每一项都是宿主已经投影或记录的持久值。可从右侧边栏的引导页打开该标签页。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开右侧边栏的引导页并选择“可观测性”。该标签页会挂载在右侧窗格中，可用窗格既有控件加宽或切换为全屏。

### 视图

会话视图展示当前会话。指标条报告提供方与模型、平均首字延迟、解码吞吐、缓存命中率、相对上下文窗口的占用、轮次与步数、令牌总数，以及模型与工具耗时之和。两个环形图给出构成：按桶拆分的令牌（未缓存输入、缓存输入、缓存写入、输出）与模型对工具的耗时。子代理树列出每一个后代会话及其模式、运行状态、提供方/模型、令牌总数与时长。

时间线视图按会话的持久分桶绘制一项被计数的活动指标：模型请求与请求失败、重试、工具调用与工具失败、子代理启动、轮次开始、步完成、四个令牌列，以及上下文占用。指标控件选择列，聚合控件合并渲染的桶，合计表列出整会话每一项指标的精确数值。

流程视图读取轨迹席位，渲染 harness 自身的轮次：已加载的系统提示、上下文注入、用户与插话消息、助手正文及其思考、工具调用与结果、命令运行、压缩标记、模型重试与轮次失败——每行都带步骤、工具目录大小、提示变更与状态，并可展开到精确记录文本。控件会持续向上翻页，直到窗口抵达日志起点。

历史视图展示列表提供的全部根会话：按会话完成时间排列的令牌趋势线，以及可排序的令牌、时长、子代理数量表格。子代理日志不计入趋势，而是通过其父级的树呈现。

每个图表都带有“查看表格”控件，用于显示精确、未取整的数值。

### 读取数字

令牌与耗时来自持久化的 `tokenUsage` 与 `sessionStats` 投影；上下文占用来自 `contextPressure`；提供方/模型来自 `modelSelection`；时间线的分桶来自 `activitySeries`；流程来自轨迹会话标准席位。跨会话行与代理树折取会话列表中的按会话投影值：宿主对冷会话从持久检查点提供，对运行中会话从实时折取提供。尚无任何数字的会话会显示其空状态文案，而不会显示伪造的读数；当组合未挂载轨迹插件时，流程视图也会如此说明。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

### 设计思路

该面板是纯消费者：它不注册任何宿主能力、会话事件或投影键。标签页主体读取框架的标准席位——用 `useProjection` 读取当前会话，用 `useSessions` 读取列表，用 `useTrajectory` 读取流程——再把它们折取为只含普通数字与字符串的视图模型。视图切换器是一张表，因此新增视图只需一个 id、一行标签与一个主体。图表组件是手工构建的 SVG 与定位 DOM，符合仓库不使用图表库的约定。

流程视图不持有轨迹包的任何渲染代码：它读取席位的快照，把每条记录折取为一行台账，携带区域文案键、逐字记录名、有界预览、精确详情与状态。向上翻页通过插件注入的 `loadOlder` 完成：它比较翻页前后轨迹快照的同一性，因此控件会在日志起点处消失。

### 源码导图

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件入口：字典、标签页类型、主体席位与注入的翻页 |
| [`src/client/face.ts`](src/client/face.ts) | 主体所消费的注入值 |
| [`src/client/ObservabilityPanel.tsx`](src/client/ObservabilityPanel.tsx) | 注册主体：读取标准席位、切换视图 |
| [`src/client/observability-model.ts`](src/client/observability-model.ts) | 纯折取：代理树、历史行、空切片判定 |
| [`src/client/activity-model.ts`](src/client/activity-model.ts) | 时间线视图的纯折取与指标表 |
| [`src/client/TimelinePanel.tsx`](src/client/TimelinePanel.tsx) | 时间线视图：分桶之上的指标与聚合控件 |
| [`src/client/flow-model.ts`](src/client/flow-model.ts) | 纯折取：把轨迹记录重组为轮次台账 |
| [`src/client/FlowPanel.tsx`](src/client/FlowPanel.tsx) | 流程视图：台账、行展开、向上翻页控件 |
| [`src/client/charts/`](src/client/charts) | `ChartSection` 外壳与 `Pie`、`Trendline`、`SeriesChart`、`StatTile` 原语 |
| [`src/client/locales.ts`](src/client/locales.ts) | `observability` 字典对 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [会话投影子系统](../../../docs/subsystems/session-projection.zh.md) — 本面板所渲染值的注册表。
- [插槽参考](../../../docs/subsystems/slots.zh.md) — 主体所用的注册与属性模型。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md) — 提供会话列表的对象层。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了面板能从所读投影中展示什么。

- **会话视图需要至少一个已结算的数值** — 在任何令牌或步骤落地之前，视图显示空状态文案，而不是全零图表。
- **耗时只覆盖模型与工具** — 持久化的 `sessionStats` 投影没有整轮墙钟总时长，因此步骤之间的空闲时间不会入图。
- **历史受会话列表限制** — 行来自客户端列表所提供的会话，而非完整归档。
- **子代理时长包含未结束轮次的已用时间** — 运行中子代理的时长会随墙钟增长，因此该值在两次渲染之间会变化。
- **时间线分辨率在久远过去会变粗** — 一旦会话超出配置上限，持久序列会把分桶宽度翻倍，因此早期活动按加宽后的宽度绘制；视图会报告它正在读取的宽度。
- **时间线令牌只统计已结算消息** — 始终未组装出消息的模型尝试不贡献令牌样本，因此在重试密集的轮次中该序列可能落后于 `tokenUsage` 的会话合计。
- **上下文占用是仪表值而非合计** — 合并分桶保留较晚的读数，未报告提示侧数值的桶则显示无读数。
- **流程只覆盖已加载窗口** — 台账渲染轨迹席位已组装的记录；更早的历史通过视图自带控件载入。
- **流程不含图片画廊** — 图片块不贡献台账文本或详情。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴随文件。本插件是纯消费者，其唯一注册项——字典、标签页类型与主体席位——都是普通副作用，其释放由注册测试直接观察；它不拥有可变的跨插件状态，也不断言任何自有运行时关系。
