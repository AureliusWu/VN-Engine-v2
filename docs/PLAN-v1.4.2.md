# v1.4.2 Studio 试玩与捕获来源绑定计划

日期 2026-11-06。基线 `a476ed0a609941583cc3cf1b528ad7c5ea6e6287`。本轮聚焦 Studio 从 iframe 试玩写入回看起点和路线用例时的来源核对，以及运行证据和资源计划的异步发布。实际测试和平台结果另行记录。

## 基线问题

当前回看请求比对请求前后的工程文本，回复按预览 revision 匹配。候选试玩可保留同样的作品、版本和台词 ID，关闭自动预览后修改工程也可使 iframe 停留在旧内容。两种情况下，请求前后文本可以一致，但它与实际挂载的文本不同。同 revision 的超时重试也需要区分两次请求。录制启动确认可能迟到，回复成功时还需核对发送时的工程快照。[回看与预览发送](https://github.com/AureliusWu/VN-Engine-v2/blob/a476ed0a609941583cc3cf1b528ad7c5ea6e6287/editor/app.mjs#L392) [录制请求](https://github.com/AureliusWu/VN-Engine-v2/blob/a476ed0a609941583cc3cf1b528ad7c5ea6e6287/editor/app.mjs#L64) [iframe 捕获](https://github.com/AureliusWu/VN-Engine-v2/blob/a476ed0a609941583cc3cf1b528ad7c5ea6e6287/editor/preview.mjs#L32)

证据和资源计划已有 requestId、revision 与 SHA 检查。面板在收到回复后仍会异步核对来源，期间可能切换预览。结果写入面板前需要再次确认当前挂载和采集代次。已经完成的证据有自己的源 SHA，可按现有规则保留历史状态。[证据面板](https://github.com/AureliusWu/VN-Engine-v2/blob/a476ed0a609941583cc3cf1b528ad7c5ea6e6287/editor/evidence.mjs#L28) [资源计划面板](https://github.com/AureliusWu/VN-Engine-v2/blob/a476ed0a609941583cc3cf1b528ad7c5ea6e6287/editor/resources.mjs#L26)

## 开源与社区证据

- WebGAL Terre 固定提交 `e319a4d6646a9b8b2e30de659bc74777395142d7`，MPL-2.0。阅读 `packages/origine2/src/utils/editorPreviewRequestOwner.ts` 第 61–124 行。请求由 ID 和类型关联，超时或断开时清理请求，响应只结算仍匹配的等待者。可转用到同一 iframe revision 内的超时重试。WebGAL 的所有权判断基于其查询与传输上下文，Studio 还要核对挂载来源。[固定源码](https://github.com/OpenWebGAL/WebGAL_Terre/blob/e319a4d6646a9b8b2e30de659bc74777395142d7/packages/origine2/src/utils/editorPreviewRequestOwner.ts#L61-L124)
- CodeMirror lint 固定提交 `a73629893c436da6e39fe9813ad2e2a5f7c98601`，MIT。阅读 `src/lint.ts` 第 355–379 行。异步 lint 发布前比较启动时和当前文档引用，变更则另行调度。官方论坛第 5、6 帖记录了第三方异步 linter 返回旧文档范围导致越界，以及维护者对调度保护的解释。Studio 的相关快照还包括工程模型和 iframe 实际挂载。[固定源码](https://github.com/codemirror/lint/blob/a73629893c436da6e39fe9813ad2e2a5f7c98601/src/lint.ts#L355-L379) [维护者论坛](https://discuss.codemirror.net/t/replacing-entire-document-text/9190)
- VS Code Pylint 固定提交 `efed04e622be9af3d7c53263c3ec2a82ef32e5e5`，MIT。阅读 `bundled/tool/lsp_server.py` 第 339–364 行。它为同 URI 的请求分配递增代次，计算返回时淘汰被后续请求替代的结果。这个检查解决请求顺序，Studio 另用挂载记录判断内容归属。[固定源码](https://github.com/microsoft/vscode-pylint/blob/efed04e622be9af3d7c53263c3ec2a82ef32e5e5/bundled/tool/lsp_server.py#L339-L364)
- Playwright 固定提交 `58d69dcc392af3a6994eab0323dc2e883f05f396`，Apache-2.0。阅读 `packages/playwright-core/src/server/trace/recorder/tracing.ts` 第 509–529、671–679 行。记录器按页面、动作 ID 和动作阶段捕获快照，按 SHA-1 名称保存关联资源。可借鉴为证据保留捕获时的来源关联。Playwright 的追踪格式服务于浏览器调试，VN 的来源检查沿用已有 SHA-256 和回放校验。[快照捕获](https://github.com/microsoft/playwright/blob/58d69dcc392af3a6994eab0323dc2e883f05f396/packages/playwright-core/src/server/trace/recorder/tracing.ts#L509-L529) [资源归属](https://github.com/microsoft/playwright/blob/58d69dcc392af3a6994eab0323dc2e883f05f396/packages/playwright-core/src/server/trace/recorder/tracing.ts#L671-L679)

以上材料用于设计对照。具体实现沿用本仓库的 iframe 消息、数据格式和运行链。

## 实施范围

1. 在发送预览时记录模型身份、工程来源文本、revision 和用途。仅在收到匹配的挂载确认后，才将该记录视为就绪。候选可试玩，写入回看起点或路线用例须来自当前工程的对应挂载。延迟录制确认若遇工程修改、换工程或重新预览，保持录制未激活。
2. 回看和路线捕获各次请求使用唯一 requestId，回复携带同一 ID 和 revision。保留窗口来源与 origin 检查，结算前重新核对当前挂载、工程和请求身份。刷新、换工程和销毁时清理等待与期限。路线用例 ID 仍属于用例数据，单次传输 ID 只用于消息关联。
3. 运行证据和资源计划在回复与异步来源核对后都检查挂载和采集代次。新预览使仍在途的旧采集失效。历史证据保留原始 SHA，按既有来源规则评估是否可定位。保持普通工程原始来源字节和候选惰性来源规则，继续使用现有存档、回看和路线用例格式。

## 验收

- 用真实 Studio 预览覆盖候选与当前工程共享作品身份、自动预览关闭后编辑、刷新后重新捕获及成功写入。记录旧路径失败和修复后的同夹具结果。
- 控制交付顺序覆盖迟到的录制 ACK、同 revision 超时重试、旧捕获回复和来源核对完成前切换预览。单列受控消息和时钟证据，以及真实 iframe、录制、回看和导出证据。
- 核对有效证据保留原始 SHA，迟到证据或资源计划无法覆盖新预览。运行核心、完整编辑器和浏览器回归，验证生成 Studio 的子目录及断网流程，核对同一 SHA 的 Linux 和 Windows。Windows Chromium 专项、WebView2 原生文件 I/O 和完整进程重启分别按日志记录。
