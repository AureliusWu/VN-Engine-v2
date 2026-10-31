# VN Engine v2

<!-- project-badges:start -->
[![Version](https://img.shields.io/github/v/tag/AureliusWu/VN-Engine-v2?sort=semver&style=flat-square&label=version)](https://github.com/AureliusWu/VN-Engine-v2/tags) [![Build](https://github.com/AureliusWu/VN-Engine-v2/actions/workflows/check.yml/badge.svg?branch=main)](https://github.com/AureliusWu/VN-Engine-v2/actions/workflows/check.yml) [![Last commit](https://img.shields.io/github/last-commit/AureliusWu/VN-Engine-v2?style=flat-square)](https://github.com/AureliusWu/VN-Engine-v2/commits/main) [![License](https://img.shields.io/github/license/AureliusWu/VN-Engine-v2?style=flat-square)](LICENSE)
<!-- project-badges:end -->

当前开发版本：`1.4.0`。最新正式 GitHub Release 为 `v1.0.0`。

自研 TypeScript 叙事引擎，包含剧本解释器、状态机、播放器、画面 / 音频调度、作者工具、路线 QA、Windows 宿主与独立 PWA 打包。主运行链不依赖 Ren’Py、Electron 或 Tauri。

## 核心能力

- 条件分支、变量、选择、结局、路线重建与多槽存档。
- 视觉小说、聊天 / 通话、调查 / 证据 / 推理等不同玩法入口。
- 背景、立绘、CG、文本、音频与演出效果调度。
- Studio 可视化编辑、资源诊断、撤销 / 恢复与真实预览。
- SDK、文件 SDK 与统一 JSON CLI，供 AI / Agent 批量编辑和验证。
- 路线 QA、内容审阅协议、独立作品构建与 PWA 离线产物。
- Windows WebView2 宿主与原生文件桥。

## 运行与验证

需要 Node.js 22+；完整检查还需 Python 3.10+。

```bash
npm ci
npm run demo
npm run check
npx playwright install chromium
npm run test:browser
```

独立作品示例：

```bash
npm run build:game -- examples/runtime/rain.json build/my-game
python -m http.server 8000 --directory build/my-game
```

## AI / 维护者入口

修改前先读 [AGENTS.md](AGENTS.md)。

- 架构：`docs/ARCHITECTURE.md`。
- 提取与来源：`docs/EXTRACTION.md`、`docs/provenance.json`。
- 迁移规则：`docs/MIGRATION.md`。
- AI 开发接口：`docs/AI_DEVELOPMENT.md`。
- 当前验证：`docs/VALIDATION.md` 及对应版本验证文档。
- 跨仓制作：`docs/production/VN-WORKFLOW-R1.md`、`.vn/workflow.json`。

当前任务默认只优化引擎本体；**迁移现有作品必须由用户主动、明确提出**，不能把“继续优化”解释为迁移授权。保持各作品的 ID、存档、素材与运行链独立。

README 不保存逐版本优化流水和完整验收记录；这些内容继续留在 `CHANGELOG.md`、`docs/`、Release 与 Git 历史中。

## License

[MIT License](LICENSE)。