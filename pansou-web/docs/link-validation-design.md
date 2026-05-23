# pansou-web / pansou 链接有效性检测实现方案

## 1. 目标

为 `pansou-web` 增加一个可选的“自动检测”能力，用于在搜索结果页对当前用户正在查看的网盘链接做轻量、低风险的有效性检测。

核心约束：

- 默认关闭，用户手动开启。
- 只检测当前激活的网盘类型标签页。
- 只检测当前屏幕中真正可见的结果项。
- 用户滚动后，仅检测新进入视区的结果项；已经划过去的结果项不再重复调度。
- 已检测过的链接需要缓存，避免重复请求。
- UI 要尽量克制，优先使用标题后的状态点，不增加列表噪音。
- 检测逻辑不直接搬运参考项目代码，只借鉴思路，自行重构命名与实现。

结论：检测能力应落在后端 `../pansou` 中新增独立 API，前端只负责“可见区调度 + 状态展示 + 本地缓存命中”。

## 2. 为什么必须放后端

主流网盘的有效性检测并不等于简单访问一次分享链接。常见问题包括：

- 浏览器跨域限制。
- 平台风控要求特定请求头。
- 需要运行时生成临时 cookie、短期 token、校验参数。
- 某些平台存在验证码初始化、加密参数或跳转链路。
- 前端暴露检测逻辑后，更容易被平台针对。

因此前端不应直接请求各家网盘接口，`pansou-web` 只访问 `../pansou` 暴露的统一检测接口。

## 3. 总体架构

### 3.1 前端职责 `pansou-web`

- 在设置页新增 `检测` Tab。
- 提供 `自动检测` 开关，默认 `false`。
- 在结果列表中追踪当前激活网盘类型。
- 使用 `IntersectionObserver` 监听当前列表中真正进入视区的条目。
- 将当前视区内、尚未有缓存结果、且平台受支持的链接打包发送到后端检测。
- 将检测结果缓存到浏览器本地。
- 在标题后渲染一个极简状态点。

### 3.2 后端职责 `../pansou`

- 提供统一的检测 API。
- 解析链接类型与提取码。
- 按平台调用对应检测器。
- 做服务端缓存、并发限制、频控、超时控制。
- 返回标准化检测结果。

### 3.3 双层缓存

建议采用双层缓存，降低重复检测成本：

- 前端缓存：`localStorage` 或 `IndexedDB`
  - 目标：减少同一浏览器重复请求。
  - 适合缓存最近检测结果和时间戳。
- 后端缓存：`../pansou` 本地缓存目录或 Redis
  - 目标：跨页面、跨用户复用检测结果。
  - 适合缓存标准化后的链接检测结论。

## 4. 用户体验设计

## 4.1 设置项

在 `SearchConfig.vue` 现有标签中新增：

- `检测`

该标签下首期只放 1 个核心开关：

- `自动检测`

建议文案：

- 标题：`自动检测当前可见链接`
- 简述：`仅检测当前网盘标签页中屏幕可见的结果，减少性能消耗与风控风险。`

首期不建议塞入太多配置项，避免把设置做得像后台面板。

## 4.2 列表中的状态表达

建议不要使用大块徽标或显眼标签，避免破坏当前简约界面。

推荐方案：

- 标题末尾追加一个小圆点。
- 状态点颜色：
  - 灰色：未检测
  - 浅蓝：检测中
  - 绿色：有效
  - 红色：失效
  - 橙色：需要提取码 / 状态不确定

补充要求：

- 鼠标悬浮可显示状态文字。
- 移动端不额外显示文字，只保留圆点。
- 圆点尺寸保持克制，避免抢标题视觉中心。

## 4.3 关于“失效资源下沉”

用户提出过“红色失效项可考虑下移”的想法。这个需求可以做，但不建议在首版直接启用自动重排。

原因：

- 结果项一旦动态换位，用户滚动时会感到跳动。
- 与“只检测用户此刻看到的内容”存在冲突，重排后视区内容会突然变化。
- 移动端更容易产生错位感。

建议分阶段：

- 第一阶段：只标记，不重排。
- 第二阶段：新增可选策略 `将已确认失效项折叠到列表底部`，默认关闭。

## 5. 前端实现方案

## 5.1 配置存储

新增本地配置键：

- `pansou_detection_settings`

建议结构：

```json
{
  "enabled": false,
  "cacheTtlHours": 24,
  "showUnknownDot": false
}
```

首期真正暴露给用户的只有 `enabled`，其余字段可以先内部保留。

## 5.2 结果项状态模型

前端不要直接复用参考项目的状态枚举名，建议自定义：

```ts
type LinkHealthState =
  | 'idle'
  | 'pending'
  | 'ok'
  | 'bad'
  | 'locked'
  | 'unsupported'
  | 'uncertain'
```
```

建议语义：

- `idle`：未检测
- `pending`：检测中
- `ok`：有效
- `bad`：失效
- `locked`：需要提取码或提取码错误
- `unsupported`：当前平台暂不支持检测
- `uncertain`：检测失败但不能明确判定

## 5.3 视区检测调度

关键点：当前 `ResultTabs.vue` 只是“按页增量渲染”，这不等于“可见区检测”。需要额外做视区追踪。

建议机制：

1. 在当前激活 tab 的每一项结果节点上挂一个可观测标识。
2. 使用 `IntersectionObserver` 监听每个结果项。
3. 只收集满足以下条件的结果：
   - 属于当前激活 tab
   - 当前进入视区
   - 本地无有效缓存
   - 当前未在请求队列中
   - 平台受支持
4. 将本次视区内候选项合并为一个小批次请求。
5. 当用户切换 tab、滚动、或搜索结果刷新时，重建观察器和队列。

建议策略：

- 只对 `intersectionRatio > 0.35` 的项判定为“用户正在看”。
- 每次批量最多检测 4 到 6 条。
- 请求节流间隔 200 到 400ms。
- 同一时刻仅保留一个活动检测请求，避免叠加。

这样能较好满足“只检测眼睛真正看到的部分”的要求。

## 5.4 前端去重键

前端缓存键建议基于“网盘类型 + 标准化链接”生成，不要直接依赖标题。

建议标准化规则：

- 去掉首尾空白。
- 统一协议大小写。
- 清理无意义尾部斜杠。
- 统一提取码拼接形式。
- 对已附带 `pwd` 参数的链接归一化顺序。

建议缓存键格式：

```text
health:{diskType}:{normalizedUrl}
```

## 5.5 前端缓存 TTL

建议：

- `ok`：24 小时
- `bad`：6 小时
- `locked`：12 小时
- `uncertain`：1 小时
- `unsupported`：24 小时

原因：

- 有效链接通常不必频繁重检。
- 无效链接存在“源站恢复 / 误判 / 临时风控”可能，TTL 应更短。

## 5.6 前端请求适配

在 `src/api/index.ts` 新增单独接口，不混入搜索接口：

建议函数名：

- `inspectVisibleLinks`

建议请求路径：

- `POST /api/check/links`

建议请求体：

```json
{
  "items": [
    {
      "disk_type": "quark",
      "url": "https://pan.quark.cn/s/xxxx?pwd=abcd",
      "password": "abcd"
    }
  ],
  "view_token": "tab-quark-1713600000000"
}
```

`view_token` 用于前端丢弃过期响应：

- 用户切换 tab 或重新搜索后，旧响应即使返回，也不再落到当前界面。

## 6. 后端 API 设计 `../pansou`

## 6.1 推荐新增路由

在 `api/router.go` 下新增：

- `POST /api/check/links`

可选补充：

- `POST /api/check/links-batch`
- `GET /api/link-inspection/platforms`

首期只需要一个 `check` 即可。

## 6.2 请求结构

建议在 `model` 中新增独立请求对象：

```go
type CheckRequest struct {
    Items     []InspectItem `json:"items"`
    ViewToken string        `json:"view_token,omitempty"`
}

type InspectItem struct {
    DiskType string `json:"disk_type"`
    URL      string `json:"url"`
    Password string `json:"password,omitempty"`
}
```

## 6.3 响应结构

建议返回稳定、可缓存的标准结构：

```go
type CheckResponse struct {
    Results []InspectOutcome `json:"results"`
}

type InspectOutcome struct {
    DiskType       string `json:"disk_type"`
    URL            string `json:"url"`
    NormalizedURL  string `json:"normalized_url,omitempty"`
    State          string `json:"state"`
    CacheHit       bool   `json:"cache_hit"`
    CheckedAt      int64  `json:"checked_at"`
    ExpiresAt      int64  `json:"expires_at"`
    Summary        string `json:"summary,omitempty"`
}
```

其中 `State` 建议取值：

- `ok`
- `bad`
- `locked`
- `unsupported`
- `uncertain`

## 6.4 错误处理原则

单条失败不要拖垮整批请求。

即：

- 整个请求参数非法时，返回 HTTP 400。
- 某一条链接解析失败时，该条结果状态返回 `uncertain` 或 `unsupported`。
- 仅在系统级错误时返回 HTTP 500。

## 7. 后端模块拆分建议 `../pansou`

不照抄外部项目命名，建议自行组织为以下模块：

```text
api/
  check_handler.go

service/
  check_service.go
  link_probe_registry.go
  link_probe_scheduler.go

model/
  check.go

util/
  sharelink/
    normalize.go
    parse.go

cache/
  inspection_cache.go

providercheck/
  common/
  baidu/
  quark/
  aliyun/
  uc/
  tianyi/
  pan123/
  pan115/
  xunlei/
  mobile/
```

设计原则：

- `handler` 只做参数校验和响应输出。
- `service` 负责调度、缓存、并发、频控。
- `providercheck` 只做单平台探测。
- `sharelink` 负责 URL 标准化、提取码抽取、平台识别。

## 8. 平台探测器接口设计

建议定义统一接口，不使用参考项目的命名：

```go
type LinkProbe interface {
    ProviderKey() string
    CanHandle(input NormalizedShareLink) bool
    Probe(ctx context.Context, input NormalizedShareLink) ProbeResult
}
```

返回结构建议：

```go
type ProbeResult struct {
    State         string
    Summary       string
    NormalizedURL string
    RetryAfterSec int
}
```

含义：

- `State`：标准化状态
- `Summary`：可选的简短说明
- `NormalizedURL`：归一化后的链接
- `RetryAfterSec`：如果检测端认为近期不宜重试，可返回建议重试时间

## 9. 链接标准化规则

这是整个方案里很关键的一层，建议放在后端统一做。

标准化目标：

- 尽量把“同一资源的不同写法”变成同一个缓存键。
- 将可拼接的提取码统一补入 URL。
- 避免导出、展示、检测三套逻辑各做一遍。

建议规则：

- 百度、夸克、迅雷等支持 `?pwd=` 的，统一将提取码并入链接。
- 若原链接已带 `pwd` 且与独立提取码一致，则不重复保存独立提取码。
- 若原链接已带提取码，则以链接中的值为准。
- 若平台没有标准 query 形式，再保留独立 `passcode` 字段。

缓存键建议：

```text
probe:{provider}:{normalizedUrl}
```

## 10. 后端缓存设计

## 10.1 服务端缓存位置

因为 `pansou` 已经有缓存体系，检测缓存可以单独增加一类命名空间，不和搜索结果缓存混在一起。

推荐两种实现：

- 首选：复用现有本地两级缓存体系，单独前缀隔离。
- 可选：若后续接入多实例部署，再切 Redis。

## 10.2 TTL 建议

- `ok`：24 小时
- `bad`：6 小时
- `locked`：12 小时
- `uncertain`：30 分钟
- `unsupported`：24 小时

## 10.3 反抖与共享

为了防止同一链接在短时间内被多个请求同时击穿，建议增加“飞行中去重”：

- 同一个标准化链接正在检测时，后续相同请求直接等待前一个结果。

可抽象为：

- `singleflight` 风格的 in-flight map

但实现时可自行写，不必照搬外部结构。

## 11. 并发与风控控制

用户非常在意被风控风险，因此后端调度要保守。

建议策略：

- 按平台配置不同并发上限。
- 单批请求内部按平台分组执行。
- 每个平台内部串行或低并发执行。
- 请求头、超时、重试策略按平台单独配置。
- 对高风险平台加最小请求间隔。

建议初始值：

- 百度：1 到 2 并发
- 夸克：2 并发
- 阿里：2 并发
- 迅雷：1 并发
- 移动云盘：1 并发
- 123 / 天翼 / UC：2 到 3 并发

对于连续失败、超时、429、403、验证码初始化失败的情况，建议触发短期熔断：

- 例如 2 分钟内只返回 `uncertain`，不继续打平台。

## 12. 支持平台与实施顺序

虽然前面参考过较多平台，但不建议首版一次全上。

推荐顺序：

第一阶段：

- 百度
- 夸克
- 阿里
- UC

第二阶段：

- 天翼
- 123
- 迅雷

第三阶段：

- 115
- 移动云盘

首版不建议支持：

- `pikpak`
- `magnet`
- `ed2k`

这些类型要么检测语义不稳定，要么不适合用“分享是否有效”这套模型表达。

## 13. 前端与后端的状态衔接

前端不需要理解每个平台的细节，只消费统一状态。

建议映射：

- `ok` -> 绿点
- `bad` -> 红点
- `locked` -> 橙点
- `uncertain` -> 可选灰点或不显示
- `unsupported` -> 不显示
- `pending` -> 蓝点微动效

动效要求：

- 仅 `pending` 有轻微呼吸感。
- 动效时长短、透明度低，避免廉价感。

## 14. 关于“只检测可见部分”的精确定义

为了避免实现阶段理解偏差，这里明确业务规则：

- 当前用户看的是哪个网盘类型标签页，就只检测这个标签页。
- 当前这个标签页里，只有真正进入视区的条目才会被调度检测。
- 列表中虽然已经渲染出来、但用户还没滚动到的条目，不检测。
- 用户滚过且离开视区的条目，不再因为“曾经出现过”而继续重复检测。
- 如果用户直接拖到底部，则只检测底部当前视区那几条。
- 同一条链接若本地或服务端已有有效缓存，直接复用，不重新请求。

这一定义要同时写进前端实现和后端接口使用约束里。

## 15. 推荐实施步骤

### 阶段 A：文档和接口骨架

- 在 `../pansou` 增加数据模型、路由、空 handler、空 service。
- 在 `pansou-web` 增加检测设置结构和 API 适配函数。
- 不接真实平台，只跑通前后端协议。

### 阶段 B：前端可见区调度

- 在 `ResultTabs.vue` 中增加 item observer。
- 增加本地检测缓存读取。
- 在标题后显示状态点。

### 阶段 C：后端首批平台接入

- 先接入 2 到 4 个最常见平台。
- 建立标准化、缓存、并发限制、单飞去重。

### 阶段 D：灰度优化

- 调整 TTL。
- 调整每个平台超时和并发。
- 观察误判率与风控反馈。

### 阶段 E：进阶能力

- 可选的失效项折叠。
- 可选的手动重检按钮。
- 可选的平台支持状态展示。

## 16. 不建议做的事

- 不要在浏览器中直接调用网盘平台检测接口。
- 不要对整页所有搜索结果做自动批量检测。
- 不要在用户没看到的 tab 上后台偷偷检测。
- 不要首版就做动态重排，容易造成视觉跳动。
- 不要把检测状态做成大块 badge，列表会很吵。
- 不要把搜索缓存和检测缓存混成同一类 key。

## 17. 推荐命名清单

为了避免照搬参考项目，建议使用以下命名风格：

- 前端 API：
  - `inspectVisibleLinks`
- 前端状态：
  - `LinkHealthState`
  - `linkHealthStore`
  - `visibleProbeQueue`
- 后端 handler：
  - `CheckHandler`
- 后端 service：
  - `CheckService`
  - `ProbeCoordinator`
  - `ProviderRouter`
- 后端平台实现：
  - `BaiduProbe`
  - `QuarkProbe`
  - `AliyunProbe`
- 链接工具：
  - `NormalizeShareLink`
  - `DetectProvider`
  - `MergePasscodeIntoURL`

## 18. 最终建议

这个需求是值得做的，但要分成两块：

- `pansou-web` 负责“用户此刻看到什么，就检测什么”。
- `../pansou` 负责“如何安全、低频、可缓存地判断链接是否有效”。

首版先把链路打通，不要一次追求全平台、全排序、全重排。只要先实现：

- 设置里可开关
- 当前 tab 可见项自动检测
- 本地 + 服务端缓存
- 标题后状态点

这个功能就已经足够实用，而且风险可控。
