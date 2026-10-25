# v0.3.0 编辑器与 Windows 宿主验证

日期：2026-10-25。只修改 VN-Engine-v2；四个正式游戏没有迁移，后续迁移仅在用户主动、明确提出后执行。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| TypeScript | 严格编译通过；模块导入无浏览器副作用 | npm run build |
| Node | 74 / 74 通过；原核心 62 项和作者工具 12 项 | npm run check；tests/editor.test.mjs |
| Python 历史适配 | 6 / 6 通过 | tests/renpy |
| 旧诊断页浏览器 | 8 / 8 通过 | [browser-check.json](browser-check.json) |
| 自研播放器浏览器 | 10 / 10 通过；含媒体、存档、独立打包子目录部署、真实断网重开 | [self-runtime-browser-check.json](self-runtime-browser-check.json) |
| 播放稳定性浏览器 | 4 / 4 通过 | [stability-browser-check.json](stability-browser-check.json) |
| 编辑器浏览器 | 9 / 9 通过；编辑/试玩、拖动、撤销、重命名、双格式导出、断链、调查、资源目录、草稿、移动与独立 Studio | [editor-browser-check.json](editor-browser-check.json) |
| 作者构建 | 四种新建项目分别导出并生成实际独立作品；Studio 是完整本地包 | tests/editor.test.mjs、编辑器浏览器第 9 项 |
| 来源 | 92 个文件与四个固定源提交验证通过 | docs/provenance.json |
| Windows 编译 | .NET 10 自包含 win-x64 EXE 和便携 ZIP 构建通过 | [原生工作流](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40174916074) |
| Windows 实际执行 | 5 份报告通过：宿主策略、编辑器首次/重启、作品首次/重启 | [acceptance.json](windows/acceptance.json) 与 windows/*.json |

Windows WebView2 捕获：[编辑器](previews/windows-studio.png)、[作品重启读档](previews/windows-game-restored.png)。

编辑器截图：[桌面](previews/studio-desktop.png)、[校园样例](previews/studio-campus.png)、[移动](previews/studio-mobile.png)。字体为随编辑器分发的改名 OFL 子集，不依赖截图机器安装中文字体。

## 验证范围

编辑器的预览直接调用自研 mountGame，使用真实选择、调查证据门控和原生 EngineProject。JSON 格式错误保留旧数据；断链禁用导出且支持撤销；目录选择使用真实 SVG 文件的 blob URL；页面重载恢复应用后的工程与尚未应用的 JSON。单独产物检查不依赖开发仓库的文件。

预览初始化通知竞争已修复为双向握手。调查 document 模式在未提供独立文书 cue 时，以节点正文呈现，编辑器调查样例据此通过真实文书/取证流程。

Windows 专用工作流独立运行宿主文件/路径策略、真实 WebView2 启动、原生工程打开/另存/导出/重开、全屏与最小化、进程重启后的编辑器和作品存档。文件路径由 CI 预设，使用相同的原生 I/O 和消息处理；不冒充人工点击系统选择器。Windows Server 2025 / WebView2 155 上实际编译与运行通过，源提交、逐文件宿主哈希和五份报告保存在 [原生验收](windows/acceptance.json)。报告含 8 项策略、编辑器首次 9 项/重启 10 项、作品首次/重启各 6 项检查；重复启动检查分别列明，未合并成不同功能数量。

此前 Rain 自研 VM 的 16 路线/6692 段落，以及 Healing/NetLove/Circuit 固定原码对照仍对应原记录；本轮没有更改其玩法解释规则，不把固定源码证据当作最新四作发行验收。

## 复现

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:browser
npm run build:studio -- build/studio
```

Windows 构建和原生检查命令见 [WINDOWS.md](WINDOWS.md)。原生实际执行、系统文件对话框人工操作、签名安装发行与实体设备验收分别记录。

保留此前的 [0.2.1](VALIDATION-v0.2.1.md)、[0.2.0](VALIDATION-v0.2.0.md)、[0.1](VALIDATION-v0.1.0.md) 证据。当前可用初版不包含复杂动画时间线、协作编辑或战斗系统；正式游戏迁移继续等待用户主动提出。
