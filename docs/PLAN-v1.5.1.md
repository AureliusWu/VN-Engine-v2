# v1.5.1 Studio 恢复保护计划

日期 2026-11-06。基线为正式版 `f641a57878f9bddbbc191818ebb2287de4efca87`。调查时 `v1.5.0` 仍是公开 latest，发布 tag 与远端 `main` 指向同一提交。仓库 Issues 已启用，开放 Issue 和 PR 均为零，Discussions 关闭，未发现发行后的公开报告。最近 12 条 `main` CI 全部通过。本轮交付 `main` 和同 SHA CI，正式下载仍使用 v1.5.0。[正式版](https://github.com/AureliusWu/VN-Engine-v2/releases/tag/v1.5.0) [Issues](https://github.com/AureliusWu/VN-Engine-v2/issues) [PR](https://github.com/AureliusWu/VN-Engine-v2/pulls) [CI](https://github.com/AureliusWu/VN-Engine-v2/actions?query=branch%3Amain)

## 社区与规范

- Twine 的一条历史用户报告描述多个同名故事副本各自保存了不同进度。互动小说论坛有作者询问如何跨电脑继续写作，另有作者分享实际以 ZIP 和变更记录轮流交接工程。案例支持在恢复另一份快照时保留本机尚未交接的工作。它们是上游项目的观察，本轮问题以本地复现为准。[Twine Issue #628](https://github.com/klembot/twinejs/issues/628) [跨电脑写作](https://intfiction.org/t/accessing-my-wip-from-various-computers/52928) [作者协作记录](https://intfiction.org/t/collaborative-work-on-twine/51620)
- W3C File API 将 `Blob.text()` 定义为 WHATWG 的 UTF-8 解码，其中错误模式为 replacement。WHATWG Encoding 也提供 `TextDecoder` 的 `fatal` 选项。恢复文件需要严格识别损坏字节，浏览器采用原始字节与严格解码，对齐 Windows 原生读入。合法的 UTF-8 BOM 和合法编码的 U+FFFD 分别验证。[W3C File API](https://www.w3.org/TR/FileAPI/#dom-blob-text) [UTF-8 解码](https://encoding.spec.whatwg.org/#utf-8-decode) [TextDecoder](https://encoding.spec.whatwg.org/#interface-textdecoder)

## 基线复现与修复范围

基线证据来自真实 Chromium 中的导出、文件选择和重载，Rain 案例在公开 Windows 包解压后的 Studio 复现。公开 ZIP 的 SHA-256 为 `8bdc62041b2a3ae4babe8cf184d6f6dff6e7fe78c2380cffc9702702348ef768`，下载复验见 `test-results/v150-public-verification.json`。原始复现记录也在忽略目录 `test-results`。UTF-8 记录使用完整执行的首个用例，保留同次脚本后续断言失败的原文。

| 场景 | 实际观察 | 本轮修复 |
| --- | --- | --- |
| 草稿归属 | 脏工作区 A 接受导入便携快照 B，旧槽马上被 B 覆盖，重载只找回 B。`v151-recovery-baseline-repro.json` | 确认替换后先保存 A 的最新状态。导入 B、读取恢复界面及未经编辑重载期间继续保留 A。B 实际后续编辑或显式保存后才接管槽。若 A 干净且没有旧槽，继续自动写入 B。 |
| 制作面板筛选 | 接收端仍筛选 `art`，便携快照中的 `story-1` 待提交字段无法定位。清除筛选后仍只看到旧值。`v151-recovery-baseline-repro.json` | 恢复时重置制作筛选，按恢复视图挂载字段并还原待提交值。合法但确实无对应控件的输入沿用受控跳过。 |
| UTF-8 | 浏览器把坏字节 `80` 替换成 U+FFFD 后成功打开恢复文件。`v150-recovery-stability-audit.json` | 在解析恢复数据前严格解码，坏字节拒绝后保留工作区。Windows 已有严格 UTF-8 读入，沿用其 BOM 策略和 16 MB 限制。 |
| 素材数组元素 | 便携快照含 `assets: [null]`，导入先替换项目和资源绑定，随后面板读取 `kind` 报错。`v150-recovery-preflight-probes.json` | 共享工程 reader 在提交前拒绝非对象的素材项，保留原工程、草稿和绑定目录。结构可读的工程仍可进入诊断修复。 |
| Rain 待修工程 | 同一错误说话者工程可正常打开并显示 `Unknown Rain speaker`，但带空反馈目标的便携快照被内容目录编译挡住。旧工程仍在。`v151-rain-recovery-baseline.json` | 空反馈目标无需构建内容目录。还原后继续显示原运行诊断，允许作者修复。实际提供的反馈目标按现有规则核验。 |

本轮沿用 `.vnrecover` 和 `.vnproj` 格式、单槽设计及玩家数据隔离。便携文件仍需在接收端重新绑定本地资源。基线代码可追溯至恢复提交、文件读取、制作筛选和共享工程 reader。[恢复与提交](https://github.com/AureliusWu/VN-Engine-v2/blob/f641a57878f9bddbbc191818ebb2287de4efca87/editor/app.mjs#L145-L181) [浏览器读入](https://github.com/AureliusWu/VN-Engine-v2/blob/f641a57878f9bddbbc191818ebb2287de4efca87/editor/app.mjs#L611-L617) [制作面板](https://github.com/AureliusWu/VN-Engine-v2/blob/f641a57878f9bddbbc191818ebb2287de4efca87/editor/production.mjs#L14) [共享 reader](https://github.com/AureliusWu/VN-Engine-v2/blob/f641a57878f9bddbbc191818ebb2287de4efca87/src/editor/model.ts#L40-L59)

## 验收

- 保留旧版复现，使用相同真实浏览器路径验证 A→B 导入、重载及 B 后续编辑和保存，检查制作字段、非法字节和坏素材输入拒绝后的工作区。用待修 Rain 样例验证运行诊断、修正和既有反馈目标约束。
- 本地运行恢复相关 Node、浏览器和编辑器专项，再执行完整核心、浏览器与编辑器回归。按精确提交核对 Linux Engine checks 和 Windows native host。Windows 沿用 R6、生成包离线恢复与原生文件 I/O、首启、完整进程重启的自动化验证。记录测试使用预设路径的范围。
