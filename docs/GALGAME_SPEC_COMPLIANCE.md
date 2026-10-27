# GALGAME SPEC Compliance

VN Engine v2 对 `GALGAME SPEC v0.1` 的引擎侧落实记录。

本文件只记录**可以由代码、测试、构建或明确证据验证的引擎能力**。剧情质量、美术构图、演出节奏、音频体验等仍属于作品级人工 QA，不因引擎具备接口而自动记为 PASS。

用户提供的最高规范已更新为 [GALGAME SPEC v0.2](GALGAME_SPEC_v0.2.md)。现有机器契约和本页原有状态仍对应 v0.1；v0.2 的逐项差距、适用范围与实际证据见 [v0.2 Gap Audit](GALGAME_SPEC_v0.2_GAP_AUDIT.md)。不能通过改版本标识宣称完成 v0.2。

正式发布另执行 [v0.2 美术与设备证据门禁](RELEASE_ART_GATE.md)；该补充门禁只核对结构化人工声明与证据引用，不自动判定美术质量或证据真实性。

状态统一使用：`PASS / PARTIAL / ENGINE_GAP / UNVERIFIED / N/A`。

## 当前基线

- Engine baseline: `0.3.0 alpha`
- SPEC: `GALGAME SPEC v0.1`
- 自动契约：`GALGAME_SPEC-v0.1`
- 主入口：`validateProjectCompliance()`
- CLI：`node tools/validate-project.mjs [--release] project.json [...]`
- CI：`npm run check`
- 正式总 Gate：`npm run gate:release -- /path/to/project.json`

## 已落地的规范化能力

| 项目 | 状态 | 证据 / 行为 |
| --- | --- | --- |
| Project identity | PASS | 校验 `schema / game / version / title / type` 并实际创建 runtime |
| Stable story structure | PASS | 继续复用 Narrative / Script / Investigation 自身结构校验 |
| Asset manifest integrity | PASS | 复用 `AssetCatalog`，检查 ID、kind、路径与 manifest |
| Asset reference validation | PASS | 对背景、立绘、CG、BGM、Ambience、SE、Voice、Font、Video 与 fallback 做 ID + kind 交叉检查 |
| Placeholder text gate | PASS | development 记 warning；release 对 `TODO / FIXME / PLACEHOLDER / lorem ipsum` 失败 |
| Asset status gate | PARTIAL | 开发模式允许未完成状态；正式门禁拒绝清单中的 PLACEHOLDER，并要求相关视觉资产声明 READY 和人工证据 |
| Build Identity | PASS | 独立构建 manifest 写入 Game Version、Engine Version、Commit SHA、Build Time |
| Build checksum | PASS | 独立构建继续为每个 runtime 文件写入 SHA256 |
| Release commit lock | PASS | `VN_RELEASE_BUILD=1` 时缺少 `VN_ENGINE_COMMIT` / `GITHUB_SHA` 直接失败 |
| Release validation mode | PASS | `--release` 与 `VN_RELEASE_BUILD=1` 提升规范约束 |
| Machine-readable evidence | PASS | validator 返回 contract、mode、assets、references、lines、endings、warnings |
| Save Contract v2 | PASS | 独立 `save_version / game_version`、默认 6 手动槽、Quick、Auto、Migration Registry、损坏存档隔离 |
| Session persistence binding | PASS | `bindSessionPersistence()` 直接通过 `RuntimeSession.save()/restore()` 工作 |
| Auto Save runtime binding | PASS | `mountGame()` 每次进入新的 visit 写独立 Auto Slot，不覆盖手动/Quick |
| Persistent Meta State | PASS | 独立 Meta key，记录 `ending_seen / cg_unlocked / playthrough_count / true_route_unlocked` |
| Replay Context isolation | PASS | Replay Context 独立生成，不写普通 Save / Route 状态 |
| Collection data API | PASS | 可计算 CG / Ending 的 unlock progress；当前仍缺正式 Gallery / Collection UI |
| Formal Stage Layer vocabulary | PASS | 固定 Layer：background / character-back / character / character-front / cg / effect / ui |
| Presentation Timeline contract | PASS | Move / Scale / Opacity / Camera keyframe 有正式数据契约与 authoring validation |
| Timeline final-state settlement | PASS | Skip / Reduced Motion 可确定性收敛到 timeline 最终状态 |
| Video asset + cue contract | PASS | `video` 成为正式 AssetKind；cue 支持 fallback，并纳入 compliance 引用检查 |

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
| Save version identity | PASS | Save Contract v2 统一 `save_version / game_version` 与 migration registry |
| Manual Save | PASS | v2 默认 6 个独立 manual slots；旧 DOM 单槽仍兼容 |
| Quick Save | PASS | 独立 Quick Slot + Session binding |
| Quick Load | PASS | 独立 Quick Slot + Session restore |
| Auto Save | PASS | mount runtime 自动写独立 Auto Slot |
| Save Manager UI | PARTIAL | 已接入六槽、覆盖确认、快速存读档、旧单槽读取及自动存档提示；截图缩略图未实现，Windows 本次提交的原生验收以 CI 为准 |
| Rollback | ENGINE_GAP | History reread 可回读，但不等同完整状态 Rollback |
| History | PASS | 有 history + search + reread |
| Auto | PASS | 自研 scheduler |
| Skip Read | PASS | 仅已读文本，Choice 处停止 |
| Hide UI | PASS | DOM runtime |
| Settings persistence | PASS | 阅读与声音设置持久化 |
| Persistent Meta State | PASS | 独立 MetaState API 与 mount runtime 更新 |
| CG Gallery | PARTIAL | 配置、锁定遮蔽、查看与独立回看已通过 `4a8a57e` 浏览器和 Windows CI；专用可视化作者控件仍未提供 |
| Ending Collection | PARTIAL | 标题、True Ending、解锁进度与回看已通过 `4a8a57e` 浏览器和 Windows CI；专用可视化作者控件仍未提供 |
| BGM | PASS | Runtime media |
| SE | PASS | Runtime media |
| Ambience | PASS | Runtime media |
| Voice | PASS | Runtime media |
| Separate voice volume | PASS | Runtime settings |
| Fade | PASS | DOM effect |
| Flash | PASS | DOM effect |
| Shake | PASS | DOM effect |
| Move / Scale / Camera | PARTIAL | DOM 已执行轨道并覆盖暂停、终态与恢复；本次 Windows CI 和可视化作者控件仍需验证 |
| Formal Layer API | PARTIAL | DOM 已接入五个视觉资源层与 effect / ui 轨道；本次 Windows CI 和可视化作者控件仍需验证 |
| Video | PARTIAL | 本地播放、失败回退、暂停 / 跳过 / 减少动态和编辑器配置已接入；`9894454` 浏览器及 Windows CI 通过，有声视频听感、实际设备及编码支持仍需作品验证 |
| Investigation / nontraditional play | PASS | Investigation runtime |
| Mini game contract | PARTIAL | 可通过自定义 runtime 承载，但未提供统一 entry/exit/save/skip contract |
| Web Build | PASS | Standalone + PWA |
| PWA offline | PASS | Service Worker / fingerprint |
| Windows Build | PASS | 独立 Windows host workflow 与验收记录 |
| Visual Editor | PASS | Studio 初版已接入同一执行链 |
| Build Identity | PASS | 正式 build manifest |
| Project Compliance Gate | PASS | 项目级自动 Gate |

## 与 SPEC 的边界

引擎只提供能力，不强迫作品启用全部能力。作品如果声明支持 Gallery、Rollback、Video、小游戏等，而引擎尚未具备对应正式能力，应明确记录为 `ENGINE_GAP` 或 `PARTIAL`，不得在 Script 层长期堆临时 Hack。

自动化 Gate 负责机械可验证项：ID、引用、资源类型、占位文本、构建身份、Checksum、结构有效性、Timeline authoring 和 Video fallback 引用。剧情质量、角色一致性、CG 构图、演出节奏、UI 体验和音频体验继续由人工 QA 判断。

## 下一阶段优先级

### P0 — Persistence UI closure

- 多槽、快速存读档与自动存档提示已接入；本次 Windows 原生 CI 和可选截图缩略图仍需单独记录

### P0 — Meta / Collection UI

- CG Gallery 与 Ending Collection 已接入播放器；专用可视化作者控件仍待实现
- True Route unlock policy 数据化
- Replay 结束后安全返回 Collection

### P1 — Presentation runtime closure

- DOM 已消费 Formal Layer 与时间线；继续确认 Windows 原生 CI，并补可视化作者控件
- Video 已接入 DOM 和编辑器，浏览器与 Windows 无声 WebM 通过；有声听感和实际设备编码支持需作品验证

### P1 — Release Evidence

- 作品专用的 `gate:release -- project.json` 输出结构化检查结果；按作品发行流程保存为 CI artifact
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
