# v1.4.6 Studio 导入、草稿与候选预览修复计划

日期 2026-11-06。基线 `8deaa670dd32d26beeb3fd3ac7fc6c2516129e9b`。调查时仓库开放 Issues 和 PR 均为零，`main` 最近 16 条同类推送检查覆盖八个提交，Engine checks 和 Windows native host 均通过。本轮问题来自 Chromium 专项复现、源码检查和社区案例。[Issues](https://github.com/AureliusWu/VN-Engine-v2/issues?q=is%3Aissue+is%3Aopen) [PR](https://github.com/AureliusWu/VN-Engine-v2/pulls?q=is%3Apr+is%3Aopen) [推送检查](https://github.com/AureliusWu/VN-Engine-v2/actions?query=branch%3Amain+event%3Apush)

## 开源与社区证据

- Inky 维护者汇总了内容被清空且无法撤销的报告，记录仍缺少稳定复现。Studio 导入专项据此同时检查当前工程、未提交输入和撤销历史。Inky 用户另报告 Windows 文档目录下的预览持续等待，换目录后恢复。该报告说明有必要区分编译完成和预览实际启动，具体目录成因留在该案例的范围内。[Inky 内容清空报告](https://github.com/inkle/inky/issues/38) [Inky 预览报告](https://github.com/inkle/inky/issues/387)
- Twine 用户在 GitHub 报告重置 Chrome 设置后浏览器故事消失。独立互动小说论坛另有作者报告同一浏览器的故事库缺失旧故事，现有资料无法确定消失原因。Studio 据此检查本地恢复槽的写入所有权和保留时机。[Twine 用户报告](https://github.com/klembot/twinejs/issues/1512) [独立论坛原帖](https://intfiction.org/t/trying-to-recover-a-lost-twine-2-browser-story-from-2025/82154)
- 本仓 R5 已保护异步打开期间的作者改动，并为目录绑定回归等待目标工程实际打开。R6 已覆盖未应用 JSON 的草稿恢复，以及显式放弃后重开时防止旧文本复活。本轮补查替换工程时的草稿归属和格式化应用后的状态。[R5 目录绑定回归](https://github.com/AureliusWu/VN-Engine-v2/pull/2) [R6 草稿保全](https://github.com/AureliusWu/VN-Engine-v2/pull/3)

## 问题与实施范围

| 优先级 | 基线症状 | 修复与边界 |
| --- | --- | --- |
| P1 | Chromium 复现错误类型的分支或动作数组通过初步读入，直到构图或渲染时报错，文件打开或应用 JSON 可能只完成部分替换。 | 在提交工程前检查构图和渲染消费的分支及动作数组结构。拒绝时保留旧工程、编辑内容和撤销历史。结构可读的断链工程仍可打开修复。 |
| P1 | Chromium 复现工程 A 已落盘后再编辑，立即新建干净的 B，释放 A 的 350ms 回调后，重载恢复的是 B。 | 新工程解析和前置检查成功后、替换前同步保留旧工程的最新草稿，并取消旧定时器。坏文件或取消替换时，保留旧工程及其合法的待写草稿。 |
| P2 | Chromium 复现仅调整 JSON 格式后应用，工程数据等价，但未保存提示或草稿仍按未应用文本处理。 | 应用成功后同步更新文本比较基准、未保存状态与草稿。JSON 面板保留作者输入的原始格式，应用失败时仍保留该文本。 |
| P2 | Chromium 复现 DSL 编译成功、候选试玩预检返回 `false`，界面仍提示正在预览。 | 预检拒绝时明确显示未启动，保留有效编译结果、可用的显式应用入口及原有有效预览。 |

相关基线代码分别负责读入与构图、草稿与替换、JSON 应用和 DSL 预览交接。[读入与构图](https://github.com/AureliusWu/VN-Engine-v2/blob/8deaa670dd32d26beeb3fd3ac7fc6c2516129e9b/src/editor/model.ts#L35-L83) [草稿与替换](https://github.com/AureliusWu/VN-Engine-v2/blob/8deaa670dd32d26beeb3fd3ac7fc6c2516129e9b/editor/app.mjs#L102-L127) [应用 JSON](https://github.com/AureliusWu/VN-Engine-v2/blob/8deaa670dd32d26beeb3fd3ac7fc6c2516129e9b/editor/app.mjs#L494-L509) [候选预览交接](https://github.com/AureliusWu/VN-Engine-v2/blob/8deaa670dd32d26beeb3fd3ac7fc6c2516129e9b/editor/text-script.mjs#L19-L32)

另已复现从原始文件打开的工程恢复草稿后，来源从原始文件字节转为规范化 JSON，先前 evidence 因来源 SHA 改变被判过期。该项留待单独评估草稿体积和来源兼容。自动预览关闭前已排队的回调目前只有静态代码线索，等待独立运行复现。沿用现有工程与草稿格式、玩家运行和存档契约。

## 验收

- 保存旧码的 Chromium 失败证据和同场景修复结果。覆盖无效文件打开、无效 JSON 应用、可修复断链、格式化 JSON 应用后的原文与草稿、候选预检拒绝后的状态与原预览。草稿测试控制防抖回调时序，检查有效替换后的旧工程恢复、旧回调隔离，以及无效导入和取消时的旧工程保留。
- 本地运行相关 Node 与 Chromium 专项、`npm run check`、完整编辑器和浏览器套件。按同一提交 SHA 核对 Linux Engine checks 和 Windows native host。分别记录核心测试、真实 Chromium、原生 WebView2 文件读写与完整进程重启。样例技术检查与人工内容验收分别记录。
