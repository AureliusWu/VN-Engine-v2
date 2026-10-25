# VN Engine v2 开发约定

- 本仓库主运行链采用自研 TypeScript 解释器/状态机、播放调度、DOM 渲染、输入、媒体与打包，遵循用户 2026-10-25 明确的“要求自研引擎”。保留校园 VN、聊天叙事、调查 AVG 和结构化条件剧本的差异。Ren’Py 只作为已有项目的兼容工具保留，不承担主引擎执行。
- 开始修改前阅读 `docs/ARCHITECTURE.md`、`docs/EXTRACTION.md`、`docs/MIGRATION.md` 和 `docs/VALIDATION.md`。
- 核心接受注入的数据、存储、音频与宿主条件；不从运行时模块导入某个游戏的正文或人物资源。模块导入不能直接访问 DOM、localStorage 或创建 AudioContext。
- 游戏 ID、storyVersion、台词 ID、原生存档键分别维护。改变原文顺序或身份时先提供迁移方案。示例使用独立命名空间。
- 读档与重读依靠路线重建；不信任导入的数值、对白历史或未来解锁。调查图用节点与证据集合联合检查，允许有意义的循环。
- 提取或修改代码时更新 `docs/provenance.json`，保留来源仓库、精确提交、路径与哈希。新增原创模块明确记录为 `new`。
- 运行与变化相称的检查；提交前运行 `npm run check`。界面、离线或存储接入有变化时运行 `npm run test:browser`。涉及游戏适配语义时运行相应原码对照。
- 更新 `CHANGELOG.md` 与真实验证记录。编译通过、浏览器通过、原生平台执行分别记录，未执行的检查不标记成功。
- 只维护 `main`，保留远端前移，不强推。源游戏仓库继续独立维护；只有明确的接入任务才修改它们。
- `dist/`、node_modules、SDK、游戏成品和生成的 Ren’Py 脚本不入库。预览与证据可留在 docs；保留许可。
- 自研宿主更改运行 `tests/runtime-browser.mjs`；打包器必须用生成产物做子目录部署和断网重开。自研 Rain 适配修改后执行 `tools/compare-rain-runtime.mjs` 的原作 16 路线对照。
