# v1.4.1 Studio 候选预览优化计划

日期 2026-11-06。基线 `020cbd913231a4c641addeb211c779d12d929adb`。本轮聚焦 Studio 从编译候选到可试玩的开销。实现与平台验收待独立记录。

v1.4.0 的 7000 行和 7000 cue 同机历史对照中，点击到绘制中位从 220.90 ms 降到 13.10 ms，候选就绪从 281.26 ms 增到 297.39 ms，试玩就绪从 282.77 ms 增到 341.50 ms。最后一项增长 20.77%，按当时阈值判为 FAIL，综合性能记为 WARN。新一轮须重测当前基线，使用同口径数据判断回退是否改善。[v1.4.0 验证](VALIDATION-v1.4.0.md)

## 开源与社区证据

- WebGAL Terre 固定提交 `e319a4d6646a9b8b2e30de659bc74777395142d7`，MPL-2.0。阅读 `packages/origine2/src/utils/editorPreviewClient.ts` 第 274–343 行、`editorPreviewTransport.ts` 第 72–92 行和 `editorPreviewRequestOwner.ts` 第 61–124 行。场景同步用场景名、句子号和相关参数，显式执行整场内容才携带场景文本。查询回复核对请求 ID 与类型，并清理过期请求。可借鉴按消费范围组织数据及关联回复的方式。它使用 WebSocket 和 JSON，其传输实现与我们的 iframe 环境不同。[场景命令](https://github.com/OpenWebGAL/WebGAL_Terre/blob/e319a4d6646a9b8b2e30de659bc74777395142d7/packages/origine2/src/utils/editorPreviewClient.ts#L298) [消息发送](https://github.com/OpenWebGAL/WebGAL_Terre/blob/e319a4d6646a9b8b2e30de659bc74777395142d7/packages/origine2/src/utils/editorPreviewTransport.ts#L80) [请求归属](https://github.com/OpenWebGAL/WebGAL_Terre/blob/e319a4d6646a9b8b2e30de659bc74777395142d7/packages/origine2/src/utils/editorPreviewRequestOwner.ts#L61) [许可](https://github.com/OpenWebGAL/WebGAL_Terre/blob/e319a4d6646a9b8b2e30de659bc74777395142d7/LICENSE)
- Mozilla Bugzilla #1546847 的第 17 条讨论中，Workers 维护者分析了 Firefox SessionStore 发送大对象时的卡顿，建议先缩小对象图，也解释了 Blob 构造与展开仍有成本。WHATWG 的窗口消息步骤确认发送方先进行结构化序列化，随后为接收方排队。本轮采用减少负载的方向，性能收益以本仓库 Chromium 同机对照为准，WebView2 原生流程另作功能验收。[Mozilla 讨论](https://bugzilla.mozilla.org/show_bug.cgi?id=1546847#c17) [WHATWG 窗口消息步骤](https://html.spec.whatwg.org/multipage/web-messaging.html#window-post-message-steps)
- Mozilla Discourse 上有扩展作者报告结构化克隆占用了较多 CPU 和内存。该帖记录的是 Firefox 扩展的个人 profiling，作为排查线索。[论坛原帖](https://discourse.mozilla.org/t/much-time-and-memory-consumed-on-structured-clone/120766)
- GoogleChromeLabs 的 `buffer-backed-object` 固定提交 `812120ea03ed72b6baf0726a9ae3aec68ba8fb62`，Apache-2.0。README 第 1–73 行展示按 schema 用 DataView 访问 ArrayBuffer，按访问时机承担编解码开销。可转移缓冲区属于需单独测量的备选，须计入对象编码、解码、所有权转移及应用时仍要使用候选的成本。本轮使用现有对象消息。[设计说明](https://github.com/GoogleChromeLabs/buffer-backed-object/blob/812120ea03ed72b6baf0726a9ae3aec68ba8fb62/README.md#L9) [许可](https://github.com/GoogleChromeLabs/buffer-backed-object/blob/812120ea03ed72b6baf0726a9ae3aec68ba8fb62/LICENSE) [WHATWG 可转移对象](https://html.spec.whatwg.org/multipage/structured-data.html#transferable-objects)

## 实施范围

1. Studio 的私有 Worker 回复携带前 200 条来源位置和总数，保留完整候选 IR 与现有诊断。基线将整份 source map 发回，面板随后只展示前 200 条。保留纯编译 API、CLI 和只读 Agent 的完整 source map，以及原有定位范围、预算、取消和过期拒收。
2. 候选从只读工程视图组装，复用现有工程诊断与运行校验，去掉只为诊断创建的临时 `EditorModel` 及重复拷贝。复核临时模型承担的 JSON 深度、保留键和根结构检查，确保候选路径保留适用门槛。无效候选继续保留上次有效预览，显式应用仍是一次可撤销操作。
3. 发送候选试玩时只传供挂载的项目对象及所需元数据。证据和资源计划抓取时，按当前已挂载的候选及 revision 惰性生成原规则的缩进 JSON 加 LF。保留普通工程的原始来源字节身份，保留 origin、窗口来源、revision 与异步结果拒收。抓取应绑定挂载前的项目快照，包括路线录制选项覆盖前的数据。

基线位置见 Worker 回复、面板来源展示、候选构造及发送、iframe 抓取，以及临时模型承担的检查。[Worker](https://github.com/AureliusWu/VN-Engine-v2/blob/020cbd913231a4c641addeb211c779d12d929adb/editor/text-compile-worker.mjs#L8) [面板](https://github.com/AureliusWu/VN-Engine-v2/blob/020cbd913231a4c641addeb211c779d12d929adb/editor/text-script.mjs#L66) [候选构造](https://github.com/AureliusWu/VN-Engine-v2/blob/020cbd913231a4c641addeb211c779d12d929adb/editor/app.mjs#L96) [试玩发送](https://github.com/AureliusWu/VN-Engine-v2/blob/020cbd913231a4c641addeb211c779d12d929adb/editor/app.mjs#L404) [证据抓取](https://github.com/AureliusWu/VN-Engine-v2/blob/020cbd913231a4c641addeb211c779d12d929adb/editor/preview.mjs#L11) [工程模型](https://github.com/AureliusWu/VN-Engine-v2/blob/020cbd913231a4c641addeb211c779d12d929adb/src/editor/model.ts#L43)

## 验收

- 同机、同 Chromium、同 7000 行和 7000 cue 夹具，固定采样次数并保留原始样本。分别报告点击到绘制、候选就绪、每轮候选到试玩的增量及点击到试玩总墙钟，记录最慢样本和心跳或长任务。另记录首次证据抓取与来源哈希，区分工作移出启动路径和总成本下降。
- 核对大候选显示 200 条来源位置并报告总数，纯 API 与 Agent 能取得完整位置，诊断内容和定位一致。覆盖目录资源缺失、过期任务、候选证据和资源计划哈希、普通工程的原始来源字节身份及一次撤销。
- 运行完整核心、编辑器和浏览器回归，使用生成 Studio 做子目录部署及断网重开，核对玩家作者代码边界。确认同一提交的 Linux 与 Windows CI。Windows Chromium 专项、原生 WebView2 文件 I/O 和完整进程重启按实际日志分别记录。范围限自研引擎及其技术样例。
