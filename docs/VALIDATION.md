# v0.1.0 验证记录

日期：2026-10-25。以下对应本次抽取的代码与 provenance 精确源提交。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| TypeScript 严格编译 | 通过，无 React/Electron/Tauri 编译依赖 | `npm run build` |
| 独立依赖安装 | 通过；在独立临时目录执行 `npm ci --offline --ignore-scripts --no-audit --no-fund`，安装 3 个开发包 | package-lock 固定版本 |
| Node 回归 | 35 / 35 通过 | `tests/*.test.mjs` |
| Python 原生适配 | 6 / 6 通过 | `tests/renpy/test_adapter.py` |
| Healing 原码对照 | 65 场景、118611 次段落访问、1296 条完整路线一致 | [upstream-check.json](upstream-check.json) |
| NetLove 原码对照 | 43 场景、17251 次段落访问、288 条完整路线一致 | [upstream-check.json](upstream-check.json) |
| Circuit 原码对照 | 11 章、1521 个可达库存状态、1731 次动作转换一致 | [upstream-check.json](upstream-check.json) |
| Rain 原码对照 | 26 场景、16 条路线，原编译器与抽取编译器两个输出逐字一致 | [rain-upstream-check.json](rain-upstream-check.json) |
| 浏览器真实交互 | 8 项场景通过；后台自动计时条件另以单元检查覆盖 | [browser-check.json](browser-check.json) |
| 真实断网重开 | 下载完成后切换浏览器上下文为 offline，重载、切换模式、恢复原档通过 | 浏览器第 7 项 |
| 视图检查 | 1280px 桌面与 390px 移动视图；无横向溢出；截图已人工检查 | [桌面](previews/demo-desktop.png)、[移动](previews/demo-mobile.png) |

原码对照覆盖状态、对白变体、人物表现重建、完整结局路线与解析后的存档。Circuit 对照使用原章节数据但跳过美术装饰器；它不证明声音证据文件或正式 UI 的播放效果。Rain 检查的是编译器一致性，没有启动 SDK。

## 复现

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

`npm run check` 执行构建、Node 测试、Python 测试与来源哈希检查。浏览器检查另行启动本地服务器，自行关闭；输出写入被忽略的 test-results。可通过 `VN_ENGINE_TEST_OUTPUT` 改变测试输出目录。

本环境使用已安装的 Chromium 可执行文件运行 Playwright，采用正常站点隔离与 Web 安全设置；通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 指定该文件。默认运行使用 Playwright 安装的浏览器。

源码比较需要外部精确快照，命令见 [接入与兼容](MIGRATION.md)。普通 CI 不下载四作完整正文和媒体；该对照报告保留源提交，可在适配器变化后重跑。

## 尚未验收

- 此仓库生成的 Windows Electron/Tauri 客户端：尚未实现与运行。
- Ren’Py 8.5.3 SDK 的 lint、实际对话、原生存档/回滚：本轮未执行。
- 四个正式游戏切换依赖后的完整实包回归：本轮没有切换依赖。
- 全部演出、角色美术、配音听感与剧情创作质量：属于源项目，不能用核心测试替代。

仓库提供 GitHub Actions 检查工作流；远端运行结果以对应提交 Actions 页面为准。
