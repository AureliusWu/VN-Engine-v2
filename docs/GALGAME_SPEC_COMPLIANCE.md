# GALGAME SPEC Compliance

VN Engine v2 对 `GALGAME SPEC v0.1` 的引擎侧落实记录。

本文件只记录**可以由代码、测试、构建或明确证据验证的引擎能力**。剧情质量、美术构图、演出节奏、音频体验等仍属于作品级人工 QA，不因引擎具备接口而自动记为 PASS。

状态统一使用：`PASS / PARTIAL / ENGINE_GAP / UNVERIFIED / N/A`。

## 当前基线

- Engine baseline: `0.3.0 alpha`
- SPEC: `GALGAME SPEC v0.1`
- 自动契约：`GALGAME_SPEC-v0.1`
- 主入口：`validateProjectCompliance()`
- CLI：`node tools/validate-project.mjs [--release] project.json [...]`
- CI：`npm run check`
- 正式总 Gate：`npm run gate:release`

## 本轮新增的规范化能力

| 项目 | 状态 | 证据 / 行为 |
| --- | --- | --- |
| Project identity | PASS | 校验 `schema / game / version / title / type` 并实际创建 runtime |
| Stable story structure | PASS | 继续复用 Narrative / Script / Investigation 自身结构校验 |
| Asset manifest integrity | PASS | 复用 `AssetCatalog`，检查 ID、kind、路径与 manifest |
| Asset reference validation | PASS | 对背景、立绘、CG、BGM、Ambience、SE、Voice、Font 做 ID + kind 交叉检查 |
| Placeholder text gate | PASS | development 记 warning；release 对 `TODO / FIXME / PLACEHOLDER / lorem ipsum` 失败 |
| Asset status gate | PARTIAL | 支持读取 `PLACEHOLDER / DRAFT / REVIEW / READY / DEPRECATED`；当前资产 schema 尚未强制要求 status |
| Build Identity | PASS | 独立构建 manifest 写入 Game Version、Engine Version、Commit SHA、Build Time |
| Build checksum | PASS | 独立构建继续为每个 runtime 文件写入 SHA256 |
| Release commit lock | PASS | `VN_RELEASE_BUILD=1` 时缺少 `VN_ENGINE_COMMIT` / `GITHUB_SHA` 直接失败 |
| Release validation mode | PASS | `--release` 与 `VN_RELEASE_BUILD=1` 提升规范约束 |
| Machine-readable evidence | PASS | validator 返回 contract、mode、assets、references、lines、endings、warnings |

## Engine Compliance Matrix

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Dialogue | PASS | 自研 runtime |
| Narration | PASS | 自研 runtime |
| Character Sprite | PASS | AssetCatalog + DOM renderer |
| Background | PASS | AssetCatalog + DOM renderer |
| CG | PASS | AssetCatalog + DOM renderer |
| Choice | PASS | Narrative / Script / Investigation |
| Flag / Variable | PASS | Narrative stats、Script variables |
| Conditional branch | PASS | Narrative / Script VM |
| Save | PASS | Narrative / Script / Investigation 均有可验证存档 |
| Load | PASS | 非法存档拒绝、损坏数据保留 |
| Save version identity | PARTIAL | 各 runtime 已带 schema + game/story version；尚未统一成同一 Save Migration API |
| Manual Save | PASS | DOM runtime 当前提供独立手动存档入口 |
| Quick Save | ENGINE_GAP | 尚未作为独立 quick slot 暴露 |
| Quick Load | ENGINE_GAP | 尚未作为独立 quick slot 暴露 |
| Auto Save | ENGINE_GAP | 尚未形成统一关键节点自动存档策略 |
| Rollback | ENGINE_GAP | History reread 可回读，但不等同完整状态 Rollback |
| History | PASS | 有 history + search + reread |
| Auto | PASS | 自研 scheduler |
| Skip Read | PASS | 仅已读文本，Choice 处停止 |
| Hide UI | PASS | DOM runtime |
| Settings persistence | PASS | 阅读与声音设置持久化 |
| Persistent Meta State | PARTIAL | 各作品可实现，但尚无统一 `MetaState` API |
| CG Gallery | ENGINE_GAP | 引擎未提供通用 Gallery 模块 |
| Ending Collection | ENGINE_GAP | 引擎未提供通用 Ending Collection 模块 |
| BGM | PASS | Runtime media |
| SE | PASS | Runtime media |
| Ambience | PASS | Runtime media |
| Voice | PASS | Runtime media |
| Separate voice volume | PASS | Runtime settings |
| Fade | PASS | DOM effect |
| Flash | PASS | DOM effect |
| Shake | PASS | DOM effect |
| Move / Scale / Camera | ENGINE_GAP | 尚无正式时间线 API |
| Formal Layer API | PARTIAL | DOM 有固定渲染层，但没有公开枚举式 Layer 编排 API |
| Video | ENGINE_GAP | 尚无正式 Video cue + fallback |
| Investigation / nontraditional play | PASS | Investigation runtime |
| Mini game contract | PARTIAL | 可通过自定义 runtime 承载，但未提供统一 entry/exit/save/skip contract |
| Web Build | PASS | Standalone + PWA |
| PWA offline | PASS | Service Worker / fingerprint |
| Windows Build | PASS | 独立 Windows host workflow 与验收记录 |
| Visual Editor | PASS | Studio 初版已接入同一执行链 |
| Build Identity | PASS | 本轮加入正式 build manifest |
| Project Compliance Gate | PASS | 本轮加入 |

## 与 SPEC 的边界

引擎只提供能力，不强迫作品启用全部能力。作品如果声明支持 Gallery、Rollback、Video、小游戏等，而引擎尚未具备对应正式能力，应明确记录为 `ENGINE_GAP`，不得在 Script 层长期堆临时 Hack。

自动化 Gate 负责机械可验证项：ID、引用、资源类型、占位文本、构建身份、Checksum、结构有效性。剧情质量、角色一致性、CG 构图、演出节奏、UI 体验和音频体验继续由人工 QA 判断。

## 下一阶段优先级

### P0 — Save Contract 2

- 多 Manual Slot
- 独立 Quick Slot
- Auto Save Slot
- 统一 `save_version / game_version`
- Migration registry
- Corrupted save isolation evidence

### P0 — Meta / Collection

- `MetaState`
- `ending_seen`
- `cg_unlocked`
- `playthrough_count`
- CG Gallery
- Ending Collection
- Replay Context，不污染正常 Save / Route

### P1 — Presentation Timeline

- Formal Layer
- Move / Scale
- Camera
- Animation timeline
- Skip 收敛到最终状态
- Video + fallback

### P1 — Release Evidence

- 将 `gate:release` 的 JSON 输出作为 CI artifact
- 统一 `QA_REPORT`
- Windows / Web / PWA 的 build identity 与 checksum 汇总
- RC / RELEASE 时强制 `VN_RELEASE_BUILD=1`

## Definition of Done

本引擎后续单项功能只有同时完成：

```text
实现
+
接入 runtime / editor（适用时）
+
自动测试
+
真实运行验收（适用时）
+
文档 / compliance 状态更新
```

才可从 `ENGINE_GAP / PARTIAL` 改为 `PASS`。
