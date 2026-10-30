# v1.4.0 后台作者编译参考研究

日期：2026-10-30。研究状态：**COMPLETE**；实现验收：**PENDING_SEPARATE_VALIDATION**。本文件记录已读取的固定官方源码、与本仓库基线的对照及本轮采纳范围。它不证明 v1.4.0 代码、性能、浏览器、离线或 Windows 原生执行已经通过；本轮计划和实际验收由独立文档记录。

本仓库对照基线为 v1.3.0 `2135b8b27850811e388384b841308ff5b2d7e305`。Yarn Spinner 和 ink 沿用 [v1.3.0 研究](REFERENCE-MINING-v1.3.0.md) 的固定提交，不把旧快照称为实时 HEAD；Inky 在本次研究中读取官方 master 并锁定为下表提交。未盘点 stars。既有实际目录盘点发现 `D:\AI项目\参考资料` 没有 VN 引擎快照；本次没有重新盘点，也没有把官方远程读取写成本地源码阅读。机器记录见 [reference-mining-v1.4.0.json](reference-mining-v1.4.0.json)。

## 固定来源与实际读取范围

| 官方仓库 | 固定提交 | 许可与本轮用途 |
| --- | --- | --- |
| YarnSpinnerTool/YarnSpinner | `c5215f86dd5a6761aecbdc9f60f6a6108f91f919` | MIT；具名编译输入、取消令牌与多阶段取消检查 |
| inkle/inky | `3d46aa92bf1572797f35d338bf75e37bb047f2e3` | [README 的 MIT 声明](https://github.com/inkle/inky/blob/3d46aa92bf1572797f35d338bf75e37bb047f2e3/README.md#L159)；编译会话隔离、停止旧任务与拒收旧结果 |
| inkle/ink | `35c63e52f1d36060930dc7ed3cfba38ea224b528` | MIT，沿用既有固定许可记录；多文件来源与解析边界，仅用于后续取舍 |

Yarn 的 [CompilationJob.cs](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Compiler/CompilationJob.cs#L33)实际请求并读取第 1–240 行：文件输入同时保留文件名与源码，任务携带 CancellationToken。[Compiler.cs](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Compiler/Compiler.cs#L298)获取全文后，重点核对 36–53、97–145、298–352、378–407、445–450、618–624 行：编译分阶段处理输入，在类型检查等循环检查取消；发布构建的类型求解过程有 10 秒 watchdog 并生成超时诊断。这只能支持“分阶段取消与有界失败”的架构启发，不能推断所有解析阶段可立即中断，也不能将局部求解期限当作整个工程的安全预算。

Inky 的 [liveCompiler.js](https://github.com/inkle/inky/blob/3d46aa92bf1572797f35d338bf75e37bb047f2e3/app/renderer/liveCompiler.js#L84)获取全文后核对 53–69、84–158、192–234、270–305 行：构造具名更新输入，启动新会话前停止旧会话，用当前 session ID 过滤完成通知，并在作者停顿后触发 live compile。[inklecate.js](https://github.com/inkle/inky/blob/3d46aa92bf1572797f35d338bf75e37bb047f2e3/app/main-process/inklecate.js#L50)核对 50–107、277–317 行：实际编译使用独立子进程，会话停止执行 SIGTERM 并清理会话。这里不是浏览器 Worker 的上游实现；本仓库只采用任务身份、执行隔离与清理思想，不引入 Electron IPC、外部编译器或临时磁盘工程。许可实际读取 README 159–174 行。

ink 的 [InkParser_Include.cs](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/compiler/InkParser/InkParser_Include.cs#L19)读取 1–76 行：通过文件处理器解析 include，检测当前打开文件形成的递归，子解析器保留文件名。[FileHandler.cs](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/compiler/FileHandler.cs#L5)读取 1–25 行：名称解析与内容读取可分离。该读取范围没有证明完整的全工程资源预算；默认文件系统实现不进入我们的纯编译器。

全部上游材料均通过官方 GitHub 远程只读取得，没有复制上游实现、安装其依赖或执行其构建。精确 blob SHA、读取范围与 URL 保存在机器记录。

## 本仓库已有基础与本轮缺口

基线 [editor/text-script.mjs](https://github.com/AureliusWu/VN-Engine-v2/blob/2135b8b27850811e388384b841308ff5b2d7e305/editor/text-script.mjs#L21)同步调用 compileTextScript，draw 又同步执行 checkTextScriptProject；目录检查需要克隆候选，预览需要序列化和更新 DOM。大文本下这些工作占用 Studio 主线程。已有显式预览、身份检查、应用时复核及一次撤销事务应保留。

基线 [editor/routes.mjs](https://github.com/AureliusWu/VN-Engine-v2/blob/2135b8b27850811e388384b841308ff5b2d7e305/editor/routes.mjs#L6)已经为路线检查提供模块 Worker、requestId、Worker 对象身份、terminate、30 秒期限、源变化拒收与 dispose 清理；[route-worker.mjs](https://github.com/AureliusWu/VN-Engine-v2/blob/2135b8b27850811e388384b841308ff5b2d7e305/editor/route-worker.mjs#L1)接收显式数据并输出带来源的报告。[tools/agent-node.mjs](https://github.com/AureliusWu/VN-Engine-v2/blob/2135b8b27850811e388384b841308ff5b2d7e305/tools/agent-node.mjs#L139)已有 Node Worker 监督、AbortSignal、期限与完成清理。它们是本仓库现有模式，不是本轮新增交付；路线线程的 30 秒值也不是自动选定的新编译期限。

## 本轮采纳范围

1. 在作者专用浏览器 Worker 中执行现有语法编译及工程资源目录检查，以任务快照传递数据。保留同步纯 API、现有 DSL、IR、source map 和预算；CLI / Agent 契约、运行解释、canonical replay 与存档身份保持兼容。
2. 任务绑定请求身份、文本和当前工程 / 资源目录上下文。新编译、取消、reset、dispose 使旧任务失效；真实终止 CPU 密集 Worker，同时在宿主拒收迟到或身份错误的结果。仅给正在同步编译的 Worker 发送取消消息，不能保证它及时处理该消息。
3. 显式应用仍是一次可撤销事务；失败、取消、过期、超时或 Worker 启动不可用均保留当前 JSON，提供明确状态。预览与应用前继续核对当前上下文，不能把“任务曾成功”当作当前可应用证明。
4. 本轮首先改善主线程响应和任务生命周期。总编译时长、传输 / 克隆及 DOM 呈现成本仍需实际测量；移动到 Worker 不自动降低总成本，也不撤销 v1.3.0 的 7000-cue 历史性能 WARN。

以上是研究支持的实施约束，不是已完成验收。

## 多文件后置与拒绝范围

v1.4.0 不增加 include 语法、多文件工程格式、命名空间、文件加载或隐式 IO。后续采用具名源码输入时，需独立定义稳定顺序、跨文件重复 ID / 前向引用、include 环、每文件 UTF-16 span 与来源身份，以及文件数、总源码、token、结构、cue 和诊断的聚合预算。逐文件重复套用现有上限会放大全工程工作量，不能作为整体限制。CLI / Agent / Studio 的路径边界、构建来源和运行 / 存档兼容需要独立验证。

本轮不采用上游 VM、运行时、任意回调扩展或其源码实现；不引入 Electron / inklecate，不启动上游构建，不迁移四个正式游戏。新增代码应原创实现并按仓库规则记录为 new，既有来源保持可追溯。

## 待独立验证

- Worker 与同步两阶段 API 的输出、诊断、预算、UTF-16 范围和输入不变性一致。
- 真实大文本下 UI 可响应；取消后可重试；重复任务、错误身份及文本 / 目录改变后的旧响应不能预览或应用；reset / dispose / 超时 / 异常释放资源。
- 应用一次撤销，失败不改 JSON；Worker 不可用不会悄悄退回长时间主线程编译。
- 新生成 Studio 包在子目录与断网新页加载真实 Worker；玩家包继续排除作者编译模块及 Worker。
- 本地核心、完整浏览器 / 编辑器、样例技术 QA，以及同一 SHA 的 Linux CI 和 Windows 编译 / 实际 WebView2 / 完整进程重启分别记录。CI 预设路径不等于人工操作系统对话框，技术通过不等于内容放行。

这些项目在本研究记录中均为 PENDING；实际结果归入本轮独立验收，不用研究完成状态替代执行证据。
