# v0.2.1 引擎优化验证

日期：2026-10-25。当前代码形成自主执行、绘制、交互和打包闭环；不依赖 Ren’Py 执行自研样例。

| 检查 | 实际结果 | 证据 |
| --- | --- | --- |
| TypeScript 编译 | 通过；严格模式；导入模块无浏览器副作用 | npm run build |
| Node | 62 / 62 通过；含调度、暂停、Grapheme、VM、日志恢复、媒体和打包 | tests/*.test.mjs |
| 原生历史工具 | Python 6 / 6 通过，原编译适配保留 | tests/renpy |
| Rain 自研 VM 对照 | 26 原场景 → 32 自研执行块；16 路线、6692 次段落、168 次选择回应访问 | [rain-self-runtime-check.json](rain-self-runtime-check.json) |
| 自研宿主浏览器 | 10 / 10 通过 | [self-runtime-browser-check.json](self-runtime-browser-check.json) |
| 优化稳定性浏览器 | 4 / 4 通过；节点复用、演出暂停、失败清理与控件更新 | [stability-browser-check.json](stability-browser-check.json) |
| 原诊断页浏览器 | 8 / 8 通过，作为旧模块回归 | [browser-check.json](browser-check.json) |
| 独立作品构建 | 四种项目均构建通过；拒绝已有输出、损坏哈希、逃逸链接和路径冲突 | tests/package.test.mjs |
| 实际独立产物 | 在 /play/ 子目录启动、选项回应、PWA 下载、真实断网刷新通过 | 自研浏览器第 10 项 |
| 媒体 | 真实 Web Audio/HTML audio 播放；语音结束才释放自动阅读 | 自研浏览器第 8 项 |
| 失败恢复 | 立绘下载失败仍可读与选择；损坏存档不改变当前进度 | 浏览器与 Node |
| 视图 | 1280px 与 390px 无横向溢出；截图检查后修正立绘素材透明边界 | [桌面](previews/self-engine-desktop.png)、[移动](previews/self-engine-mobile.png) |

本轮优化范围、六项旧版本复现与局部性能基准见 [OPTIMIZATION-0.2.1.md](OPTIMIZATION-0.2.1.md)。保留 [0.2.0 验证记录](VALIDATION-v0.2.0.md)。

## 原数据对照的范围

自研 Rain 对照逐条检查原台词 ID 与选择回应的准确顺序，检查数值/布尔最终状态、可达结局和自研存档重放。比较器只调用原 Python 状态枚举器产生期望结果，自研程序执行完全由 TypeScript VM 完成；没有调用 Ren’Py SDK、WASM 或运行时。

v0.1 的 Healing 1296 路线、NetLove 288 路线、Circuit 1521 状态/1731 转换等提取证据保留在 [旧验收记录](VALIDATION-v0.1.0.md)。本轮原提取状态机规则未改动；新驱动、调度与宿主另有专门回归。完整源项目对照报告仍明确对应 provenance 的固定提交，不冒充四作最新发行验收。

## 复现

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:browser
npm run verify:rain -- /path/to/pinned/Rain docs/rain-self-runtime-check.json
```

普通 CI 运行 Node/Python、来源校验和三组浏览器，并构建四份独立作品。浏览器报告、截图和构建 artifact 在对应 Actions 提交中留档。原作源码比较需要明确提供的固定源码，普通 CI 不获取四作完整媒体。

## 本轮未完成的范围

- 四作迁移不在当前任务范围，仅用户主动、明确提出后执行。
- Windows 原生桌面宿主和原生系统集成。
- 可视化编辑器、复杂动画轨道、3D/物理/战斗。
- 四作正式素材与声音的创作质量；样例 SVG/测试音只验证引擎。

Ren’Py 兼容工具仍通过原测试，但其 SDK 实际执行不是本轮自研运行时证据。
