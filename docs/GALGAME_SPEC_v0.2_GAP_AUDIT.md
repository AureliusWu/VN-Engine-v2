# GALGAME SPEC v0.2 差距审计

审计基线：`3075a7480fe43423a1516dc1328cf84f4cac1742`，2026-10-27。规范正文来自用户提供的交接文件，见 [GALGAME SPEC v0.2](GALGAME_SPEC_v0.2.md)。引擎保持 `0.3.0 alpha`；本表不代表任何作品已达到 RELEASE。

状态：`PASS` 表示所描述的有限能力有实现和证据；`PARTIAL` 表示有一部分；`ENGINE_GAP` 表示缺少明确的引擎能力；`UNVERIFIED` 表示没有对应证据；`N/A` 只在具体项目明确不适用时使用。状态不因接口存在而提升。v0.1 原机器契约仍为 `GALGAME_SPEC-v0.1`。

## 工程与运行能力

| v0.2 范围 | 基线状态 | 依据与剩余工作 |
| --- | --- | --- |
| 项目身份、故事结构、引用、占位文本（§3–15、50、55–58） | PARTIAL | `src/compliance/project.ts` 调用真实项目构造器并检查静态引用和占位文本；动态 presentation 仅告警，剧情质量、路线矩阵和作品审读须另有证据。 |
| 角色/背景/CG/音频的播放（§16–30） | PARTIAL | `src/render/dom.ts`、`src/runtime/media.ts` 有现有渲染和媒体运行时；能力不证明作品质量或正式素材完成。 |
| Choice、Auto、已读 Skip、Hide UI、History（§31–35） | PASS | 现有运行调度与 DOM 交互及浏览器回归；完整状态回滚另列。 |
| Rollback（§34） | ENGINE_GAP | 历史重读不等于回滚变量、路线、舞台、声音及历史游标。 |
| 多槽、快速、自动存档（§36–41、111–112） | PARTIAL | `src/storage/contract.ts`、`src/render/mount.ts` 和 `src/render/dom.ts` 已接入六槽、覆盖确认、Quick 控件、自动存档提示与旧槽读取；本次 Windows 原生 CI 和可选缩略图需另列证据。 |
| Meta、CG Gallery、Ending Collection、Replay（§42–44、103–104） | PARTIAL | 项目可声明图鉴、结局和回看数据；播放器提供锁定遮蔽、进度、查看和独立会话回看，普通存档 / Meta 隔离；`4a8a57e` 浏览器及 Windows CI 已通过，可视化作者控件仍待实现。 |
| 演出时间线、层与关键视觉生命周期（§29–30、97、108、134） | PARTIAL | DOM 已消费五个视觉资源层、效果 / UI 轨道和镜头，处理暂停、跳过、读档及后续段落终态重建；本次 Windows CI、可视化作者控件和关键视觉使用范围约束仍待完成。 |
| Video（§98） | PARTIAL | `src/stage/types.ts` 和 validator 有视频及 fallback 契约；DOM 视频播放、失败回退与生命周期未接入。 |
| 小游戏（§99–100） | PARTIAL | 不同玩法驱动存在，但缺统一 entry / exit / save / restore / skip / abort / result 协议。 |
| 设置、输入、字号、安全区域、无障碍（§45–49、96） | PARTIAL | 有 DOM 设置、键盘交互、样式和现有浏览器检查；作品具体设备、安全区域、字体与可访问体验须逐项验收。 |
| 作品打包、PWA、桌面与 CI（§62–71、80、115–117） | PARTIAL | `tools/package-game.mjs` 生成指纹、SHA256 与 build identity；基线 GitHub Engine checks / Windows 工作流成功。每个正式作品的发行、离线和各平台验收需单独证据；`gate:release` 不是完整 v0.2 Art Gate。 |
| 编辑器与数据驱动（§84–85、119） | PARTIAL | Studio 和项目格式存在；新增运行时能力还需评估编辑器适配，不把既有编辑器成功当作新能力验收。 |
| QA / 证据 / 错误处理（§72–81、86–90、121–125） | PARTIAL | v0.1 报告有结构化项目检查，媒体和存档有失败处理；尚无覆盖 v0.2 的统一作品验收报告与人工证据门禁。 |

## v0.2 新增 / 强化项

| 要求 | 基线状态 | 依据与缺口 |
| --- | --- | --- |
| `TECH_READY` 与 `ART_READY` 分开（§130） | ENGINE_GAP | 打包检查文件、可选 SHA256 和引用，不提供这两个独立状态；不检查美术构图，也不能推导 ART_READY。 |
| Production Art Visual Gate（§131–133、138–140） | ENGINE_GAP | 未发现七项视觉门禁、逐资产人工复核记录或据此阻止发行的逻辑；图像解码/构建通过不能替代。 |
| Key Visual 生命周期（§134） | ENGINE_GAP | `StageCue` 无装饰使用范围或生命周期声明；固定渲染层也没有该项门禁。 |
| 移动端实体设备（§135） | UNVERIFIED | 仓库旧浏览器报告有视口检查，未找到本次作品在实体移动设备上的验收记录；`MOBILE_PHYSICAL_DEVICE` 不能标 PASS。 |
| 资产生产链真实性（§136） | PARTIAL | `docs/provenance.json` 追踪引擎源代码及来源快照，并非作品逐资产生产链；缺资产级可核验来源及人工判断记录。未知来源不能猜测。 |
| Production runtime 占位资产（§137） | PARTIAL | validator 接受可选 `status`，release 时拒绝任一声明为 `PLACEHOLDER` 的清单项；这比只拒绝被引用项更严格，但状态不是强制、动态引用仅告警，文件名/目录和程序化占位也未核实。 |
| Release Art Gate（§139） | ENGINE_GAP | `gate:release` 执行现有 v0.1 校验和浏览器测试，没有聚合七项人工证据或在美术未验收时阻止正式作品发布。 |

## 基线验证与边界

- 基线 `npm run check`：85 项 Node、6 项 Python 通过；98 个模块来源校验通过。
- 基线 GitHub Actions：Engine checks 和 Windows native host 在 `3075a748` 上成功；这不证明后续提交或实体移动设备验收通过。
- 规范同时包含作品创作、艺术质量与人工审核要求；引擎只能提供记录与门禁，不能凭自动化替代判断。未声明适用范围前不得把这些要求整体标为 N/A。
- 样例中的 SVG 和测试音频是技术样例，不能自动视作作品的正式资产；不迁移或改动任何已有游戏项目。

## 执行顺序

按交接推进：Persistence UI → Collection UI / 安全 Replay → Timeline / Formal Layer → Video → v0.2 Release Gate / 证据。每项应分别完成适用的运行时、自动测试、浏览器、Windows、文档与真实证据；缺失项保留 PARTIAL / UNVERIFIED。
