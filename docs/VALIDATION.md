# v0.3.0 编辑器与 Windows 宿主验证

## 2026-10-27 存档界面验证（0.3.0 alpha）

- 本地 `npm run check`：85 项 Node 测试、6 项 Python 测试和 98 项来源文件哈希检查通过。
- Chromium 153：真实 DOM 测试覆盖六个手动槽及元信息、覆盖确认和取消、损坏槽保留、旧单槽读取、F5/F9、四种玩法、断网重开、直接使用 DOMRenderer 的旧单槽兼容；原有稳定性测试通过。更早一轮完整 `npm run test:browser` 亦通过；本次最终提交以 GitHub Actions 全量结果为准。
- 人工检查桌面与 390px 浏览器视口的存档面板截图；重建样例 OFL 子集字体后新增中文控件可正常显示。窄屏浏览器不代表实体移动设备验收，`MOBILE_PHYSICAL_DEVICE = UNVERIFIED`。
- Windows 原生重启存读档 smoke 测试已改用 v2 手动槽；本次提交的实际原生执行状态以该提交的 Windows 工作流为准，未将旧提交的结果冒充新证据。

收藏界面增加独立 Chromium 测试：锁定 CG 不创建图片或泄露标题、结局锁定、解锁查看、真实独立回看与返回、无效回看拒绝、原存档及 Meta 保持不变；Windows WebView2 smoke 新增对应场景，具体原生运行结果以本提交的工作流为准。手机实体设备尚未验证。

收藏提交 `4a8a57e` 的 Engine checks 与 Windows native host 均已通过；原生 WebView2 实际执行锁定 CG 检查和隔离回看。时间线新增 Chromium DOM 测试，覆盖明确图层、镜头、隐藏 / 原生宿主暂停、跳过、减少动态、跨段落与读档终态；本次提交的 Windows 原生结果以对应工作流为准。

时间线提交 `6ec1570` 的 Windows native host 已通过；视频阶段新增真实 Chromium 播放测试，覆盖暂停、音量、循环、结束、损坏或缺失文件回退、自动播放拒绝、跳过、减少动态、读档与过期异步回调。编辑器浏览器测试实际配置、预览并导出视频 cue。Windows 测试已加入本地 WebM 播放及回退，结果以本次工作流为准；示例 WebM 是无声纯色测试素材。

视频提交 `0967a2c` 的 Windows 工作流在原生播放器检查中超时；原日志未输出内部失败原因。已增强诊断，本次实际修复与复测结果以新的 Windows 工作流为准，不把这次失败记为通过。

诊断提交 `6b293fd` 发现 Windows CI 实际报告 `prefers-reduced-motion: reduce`，引擎因此选择回退图，原播放断言不适用。后续原生 smoke 使用 WebView2 的媒体偏好模拟分别检查正常播放与显式减少动态；该模拟只用于验收，不更改玩家系统设置。

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
