# P0 内建语义、来源与运行证据（1.1.0）

本轮采用 Architecture Mining 的 P0 范围，保留自研执行链与 canonical replay。新增模块为原创实现；未复制参考引擎代码。四作数据、依赖、宿主和原生存档未迁移。

## 参考与取舍

- Ren’Py [多阶段语句契约](https://github.com/renpy/renpy/blob/4025f3c2611e10021e620a9a7894053123fae556/renpy/statements.py#L37-L111)：适配元数据，保留当前受限 JSON，不引入 Python / pickle。
- WebGAL [Perform 生命周期](https://github.com/OpenWebGAL/WebGAL/blob/15173bc21339a65da34b78463fca8a304e4d503a/packages/webgal/src/Core/Modules/perform/performInterface.ts#L7-L29)：明确阻塞、提交和副作用；不重写为全局单例 / Pixi。
- Monogatari [Action 生命周期](https://github.com/Monogatari/Monogatari/blob/86659baf065178071f0956092f754e1d76be0072/src/lib/Action.ts#L410-L481)：声明每类恢复政策，不用通用逆操作替代 replay。
- NovelRT [状态到 UI 的适配](https://github.com/novelrt/NovelRT/blob/a47c13c2ca1e6f852799996203389b87c6c667a9/Ecs/Scripting/UI/SpokenLineTranslationSystem.cpp#L92-L156)：沿用 Driver → Session → readonly view → host 边界，不引入 ECS / Lua。

## 语义目录

`runtimeSemantics()` / `runtimeSemantic(id)` 返回冻结的 `vn-runtime-semantics-v1` 纯数据，描述 script-exit / player-action / stage-cue。输入 shape 和局部约束仅供发现和展示；现有解释器、项目和宿主校验继续是权威。Agent 作者操作、玩家输入、媒体 cue 不合并执行。

目录包含输入引用、适用工程类型、stateScopes、资源、next/auto 阻塞、skip/cancel/restore、host 和现有诊断类别。没有动态注册、第三方代码执行或新增 opcode。

## 可选事件与宿主

```ts
const evidence = new RuntimeEvidence({
  sessionId: 'development-preview', sourceSha256,
  maxEvents: 512, maxBytes: 131072
});
const game = mountGame(root, project, { storage: null, evidence });
const report = createRuntimeEvidenceReport(project, evidence.snapshot(), sourceSha256, {
  runtime: true, media: game.audioActive, audioDevice: game.audioActive
});
```

`createProject`、`RuntimeSession` 和 `mountGame` 接受可选 evidence；默认不采集或序列化事件。buffer 默认 512 条 / 128 KiB，上限 4096 条 / 1 MiB，满时保留最新窗口并累加 dropped / truncated。snapshot 返回冻结独立数据；drain 清空当前窗口，保留累计序号及丢弃信息。bytes 是原始事件 UTF-8 字节，不包括报告 origin / 外壳。

采集只写有界缓冲，不同步调用消费者、getter、toJSON 或覆写 writer。工具主动读取；接口不是 OS 或 JavaScript 沙箱，消费者主动发起控制仍经公开 Session 边界。report 规范 JSON 整体上限 4,000,000 UTF-8 字节；来源展开达到预算时保留最新窗口、可见增加 dropped / truncated，不修改原 collector。Studio 文件有同样的读取预算，默认紧凑导出；所有内容必须是 own JSON data。

事件类型 input / navigation / effect / lifecycle。身份为 sessionId、visit、effectId、attempt 和逻辑 sequence；不公开内部 generation。next 的 text-completed 与 advanced 分开，auto/skip 有不同输入来源。route recorder 保留原有包装实现和过滤规则，不将补全文字写成额外 RouteStep。

媒体事件包括真实 schedule/start/settle/fail/cancel、暂停恢复和恢复时 SE 抑制；DOM 记录图片结果、timeline 终态、视频回退、WAAPI / KeyVisual 生命周期。事件描述发生过的结果，不控制剧情，不进入 player save / meta。持续 BGM 同源可保留，语音恢复可合法再次 play，同一 SE 不因此重新创建。

`audioActive` / scope.audioDevice 只表示该预览已创建实际 AudioContext / MediaDirector，不证明物理输出设备、音质或主观听感。Node Agent preview 仍不启用音频宿主；其报告明确 media=false / audioDevice=false。事件范围不是全量覆盖声明。

scope.persistenceWrites=false 描述采集 / 导出本身不写玩家存储，不证明被观察的宿主未执行自己的自动存档。Studio 与 Node 预览另以 storage:null / 隔离存储验证；普通 mountGame 的持久化仍按传入的宿主配置工作。

## 来源与工具

`createSourceResolver(project, sha?)` 建立单个 owned revision 的索引；`resolveSourceOrigin` 用于一次查询。定位返回 game/storyVersion、node/line/chapter/asset ID 与实际 JSON path。歧义、未知和相互矛盾的 selector 不猜路径；Rain response 的运行时位置回到作者 response。行号不是存档身份。

`readRuntimeEvidenceReport` 校验声明；`assessRuntimeEvidenceReport` 以当前 game/version/source SHA 标 current / stale / unbound，重算当前路径，去除旧报告可导航路径。导入始终 externalClaim，不能推断 acceptance PASS。源哈希只是绑定，不是签名认证。

Agent 仍使用 vn-agent-v1：

- `inspect` kind=semantics：内建政策，支持分页。
- `inspect` kind=source，params.selector：来源定位。
- `inspect` kind=evidence，params.document：只读导入，始终 UNVERIFIED；cursor 同时绑定源与报告哈希。
- `preview` captureEvidence=true：输出额外 RUNTIME_EVIDENCE.json artifact，仍沿真实入口执行作者路线并用实际 renderer。
- capabilities 保留 compatibility.saveSchema=1，新增 saveEnvelopeSchema=2 / savePayloadSchema=1，避免层次混淆。原请求、存档和 receipt 语义不变。

Studio 的“运行证据”页独立于业务模块，支持当前预览采集、文件导入、下载和节点定位。请求以 requestId/revision 隔离；异步 hash 后再次检查预览身份。工程变化立即标 stale，不能把旧证据显示为当前工程通过。作者和运行数据分别导出。

## 兼容与验证边界

没有新增保存字段或变更 namespace、storyVersion / gameVersion；0.8.2 工程和合法存档夹具继续恢复。纯模块导入没有设备或网络 IO。SceneLoop 添加可选证据 context，因此来源 mode 从 verbatim 改为 adapted，保留原始来源 SHA；RecordedVoice 原码未改。

P1 的文本 DSL、资源预取预算和新的角色目录未实施。路线测试不含实际 DOM / 媒体；浏览器与 Windows 原生必须分别记录。验证命令与真实结果见 VALIDATION-v1.1.0.md。
