# v1.1.0 P0 验证记录

日期：2026-10-30。基线：v1.0.0 `972a2f0d5770b9b83b13bd09bdb4d50f47f48d3e`。本轮只修改引擎，不迁移四作，不更改作品 game/storyVersion、原生 namespace 或保存格式。

## 已执行的专项

| 范围 | 实际结果 | 证据 / 复现入口 |
| --- | --- | --- |
| 语义、来源、事件、媒体、报告与 Agent | 36 项 P0 Node 测试通过 | `node --test tests/p0-*.test.mjs` |
| 旧执行 / 媒体兼容 | P0 与原有 runtime / runtime-media 合并 64 项通过；旧 0.8.2 工程及存档夹具恢复通过 | tests/runtime.test.mjs、runtime-media.test.mjs、v1-compatibility.test.mjs |
| 运行时真实浏览器 | 5 项通过：首帧前暂停、图片恢复、迟到图片隔离、timeline 多路径终态、实际音视频事件 | tests/p0-runtime-browser.mjs；test-results/p0-runtime/P0_RUNTIME_REPORT.json |
| Studio | 语义目录、采集 / 导入 / 下载、来源导航、过期保护、390px 布局与聚焦重绘回归通过 | tests/p0-studio-browser.mjs；test-results/p0-studio/studio-evidence.png |
| SDK 实际预览 | 真实 renderer、源绑定的额外证据 artifact / SHA、玩家存储隔离通过；未启用音频宿主 | tests/p0-preview-browser.mjs；test-results/p0-preview/P0_PREVIEW_REPORT.json |
| Python 兼容工具 | 6 项通过 | `npm run test:renpy` |
| Schema / 来源 / 四样例结构 | 执行契约与生成 schema 一致，来源哈希校验及四样例结构通过 | write-agent-schemas --check、check-provenance、validate-project |

本机环境：Windows、Node 24.14.1，专项 Chromium 148.0.7778.96 headless。实际 AudioContext、HTML audio/video 与视觉输出通过，报告仍明确 physicalAudioListening=false、nativeWindowsInput=false、exhaustive=false。浏览器视口模拟不代表实体手机。

## 完整回归与 CI

本机 `npm run check` 执行 287 项 Node：283 项通过，4 项既有 symlink 夹具在创建链接时遭 Windows EPERM，未进入对应断言；未修改权限或跳过断言。涉及 tests/agent-imports.test.mjs、agent-node.test.mjs 两项和 package.test.mjs。Python、schema、provenance 和四样例检查随后独立执行，不把 npm run check 的短路结果标成全量成功。

完整 `npm run test:browser` 与 `npm run test:editor` 已在构建冻结后顺序通过，随后三份 P0 浏览器 / Studio / SDK 预览专项再次通过。本地日志为 test-results/p0-full-browser-final.log、p0-full-editor-final.log；[Studio 运行证据](previews/p0-studio.png) 和 [实际媒体场景](previews/p0-media.png) 已查看。

此前一次完整浏览器在 acceptance 等待 PASS 时超时；固定 dist 后原 acceptance 及带失败状态捕获的复核均通过。期间曾重新构建 dist，可能使测试创建的旧产物身份与后续模块字节不一致；未通过降低验收门槛消除失败。最终完整套件的成功来自冻结后的重新执行。

Engine checks 包含完整核心 / 浏览器 / Studio 与新增 P0；Windows workflow 包含 P0 契约与浏览器、CLI、实际 WebView2 文件 IO / 完整进程重启及 1.1.0 产物身份。CI 的通过必须以该 PR 与最终 main 对应工作流结果为准；此处不预设 CI 或原生结果，也不沿用 1.0.0 的通过记录。

## 本轮发现与修复

1. **路线面板聚焦重入**：受控浏览器夹具在修复前复现，异步预览 / Worker 重绘移除聚焦字段，引发同步 change → update → 嵌套 replaceChildren，Chrome 报 NotFoundError。现串行完成当前 DOM 更新再处理重绘请求；测试保留原输入、STALE 状态并要求无 pageerror。
2. **P0 输入来源**：初始实现把 action 记录到目标节点。现使用执行前 view，accepted input 先于目标 navigation；文字补全、自动 / 快进和 mini-finish 有明确来源与 outcome，不改变 recorder 或 replay。
3. **P0 报告放大**：合法 4096 条 / 1 MiB buffer 可因重复来源字段超过报告预算。旧实现回归夹具实际失败；现单次建索引，按 4 MB 文档预算保留最新连续窗口、准确增加 dropped / truncated，原 buffer 不变。
4. **P0 时间线证据**：审阅发现首帧前暂停可能把恢复再次记成 started。现独立记录 started / paused，真实浏览器断言一个 started、一个 paused 和一个 resumed，逻辑终态不变。

## 实机控制限制

本轮尝试 Windows computer-use，工具因无法可靠识别当前浏览器 URL、无法执行其策略检查而停止。之后没有继续发送该工具的应用输入，也没有换用其他 UI 工具绕过。该尝试不记为实机操作通过；自动化浏览器、CI 原生执行、人工系统文件对话框和主观听感分别记录。

## 范围与兼容

事件为可选开发证据，不进入 save/meta；默认不创建 collector。恢复仍走原 codec / canonical replay，一次 SE 在 restore/reread/rollback 中不重播。旧 .agent source SHA / receipt、vn-agent-v1 和 envelope/payload 层次保持兼容；导入证据始终 UNVERIFIED，来源过期时不可导航。

新增原创模块记录为 new；SceneLoop 加可选事件上下文改为 adapted，保留原始源码来源 SHA；Studio 字体从相同 SHA 的 OFL SourceHanSansLite 重新子集化并保持改名。没有导入四个参考引擎的实现代码。
