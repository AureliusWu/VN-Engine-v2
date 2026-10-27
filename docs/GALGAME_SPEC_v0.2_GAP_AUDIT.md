# GALGAME SPEC v0.2 差距审计

审计基线：`3075a7480fe43423a1516dc1328cf84f4cac1742`，2026-10-27；当前进展更新至 `cb03e9c`。规范正文来自用户提供的交接文件，见 [GALGAME SPEC v0.2](GALGAME_SPEC_v0.2.md)。引擎保持 `0.3.0 alpha`；本表不代表任何作品已达到 RELEASE。

状态：`PASS` 表示所描述的有限能力有实现和证据；`PARTIAL` 表示有一部分；`ENGINE_GAP` 表示缺少明确的引擎能力；`UNVERIFIED` 表示没有对应证据；`N/A` 只在具体项目明确不适用时使用。状态不因接口存在而提升。v0.1 原机器契约仍为 `GALGAME_SPEC-v0.1`。

## 工程与运行能力

| v0.2 范围 | 当前状态 | 依据与剩余工作 |
| --- | --- | --- |
| 项目身份、故事结构、引用、占位文本（§3–15、50、55–58） | PARTIAL | `src/compliance/project.ts` 调用真实项目构造器并检查静态引用和占位文本；动态 presentation 仅告警，剧情质量、路线矩阵和作品审读须另有证据。 |
| 角色/背景/CG/音频的播放（§16–30） | PARTIAL | `src/render/dom.ts`、`src/runtime/media.ts` 有现有渲染和媒体运行时；能力不证明作品质量或正式素材完成。 |
| Choice、Auto、已读 Skip、Hide UI、History（§31–35） | PASS | 现有运行调度与 DOM 交互及浏览器回归；完整状态回滚另列。 |
| Rollback（§34） | PARTIAL | 新增有界会话检查点，恢复实际路线 / 变量 / 舞台 / 声音绑定 / 历史游标，排除 Save / Meta 写入；本轮浏览器通过，Windows 待确认。 |
| 多槽、快速、自动存档（§36–41、111–112） | PASS | 六槽、覆盖确认、Quick 控件、自动存档提示与旧槽读取已接入，浏览器和 Windows 原生重启检查通过；可选截图缩略图未实现。 |
| Meta、CG Gallery、Ending Collection、Replay（§42–44、103–104） | PASS | 项目可声明图鉴、结局和回看数据；播放器提供锁定遮蔽、进度、查看和独立会话回看，普通存档 / Meta 隔离；`4a8a57e` 浏览器及 Windows CI 已通过，Studio 作者面板、实际预览回看起点与真路线规则已通过 `36d492a` 浏览器及 Windows 原生检查。 |
| 演出时间线、层与关键视觉生命周期（§29–30、97、108、134） | PARTIAL | DOM 的五个视觉资源层、效果 / UI 轨道、镜头及终态重建和 Studio 作者控件已接入；`cb03e9c` 浏览器与 Windows 通过。Key Visual 范围 / 场景 / 时限与清理已实现，`9986aa7` 浏览器 / Windows 通过；作品构图仍需人工验收。 |
| Video（§98） | PARTIAL | DOM 播放、结束清理、失败回退、暂停 / 跳过 / 减少动态及编辑器配置已实现；`9894454` 浏览器及 Windows 无声 WebM 检查通过，有声听感和实际设备的编解码支持仍须验证。 |
| 小游戏（§99–100） | PARTIAL | 不同玩法驱动存在，但缺统一 entry / exit / save / restore / skip / abort / result 协议。 |
| 设置、输入、字号、安全区域、无障碍（§45–49、96） | PARTIAL | 有 DOM 设置、键盘交互、样式和现有浏览器检查；作品具体设备、安全区域、字体与可访问体验须逐项验收。 |
| 作品打包、PWA、桌面与 CI（§62–71、80、115–117） | PARTIAL | 生成指纹、SHA256 与 build identity；正式打包调用 v0.2 美术 / 设备证据门禁。每个作品的实际发行、离线和各平台验收仍需单独证据；不能据此声称 v0.2 全量合规。 |
| 编辑器与数据驱动（§84–85、119） | PARTIAL | Studio 和项目格式存在；新增运行时能力还需评估编辑器适配，不把既有编辑器成功当作新能力验收。 |
| QA / 证据 / 错误处理（§72–81、86–90、121–125） | PARTIAL | 结构化项目检查、媒体 / 存档失败处理和 v0.2 人工美术 / 设备证据门禁已接入；尚无覆盖全部 v0.2 条目的统一作品验收报告。 |

## v0.2 新增 / 强化项

| 要求 | 基线状态 | 依据与缺口 |
| --- | --- | --- |
| `TECH_READY` 与 `ART_READY` 分开（§130） | PARTIAL | 两种状态分别声明和检查，技术结果不会自动推导美术结果；validator 不自动解码图片或验证人工声明真实性。 |
| Production Art Visual Gate（§131–133、138–140） | PARTIAL | 七项人工声明、审核者、日期和证据引用缺失时阻止发布；角色母版 / 差分继承、实际截图内容和真实性仍需人工验收或后续实现。 |
| Key Visual 生命周期（§134） | PARTIAL | 运行时和 Studio 已限制使用范围、场景类型与明确生命周期，并检查发布声明是否矛盾；`9986aa7` 浏览器 / Windows 已通过，实际构图和人工证据仍需作品验收。 |
| 移动端实体设备（§135） | PARTIAL | 作品声明移动端 / PWA 时，门禁要求实体设备、人工审核者、日期和证据；本仓库样例没有实体设备验收，不能标 PASS。 |
| 资产生产链真实性（§136） | PARTIAL | `docs/provenance.json` 追踪引擎代码；作品门禁要求逐资产来源、审核和证据引用，但不能自动判定内容真实性。未知来源不能猜测。 |
| Production runtime 占位资产（§137） | PARTIAL | release 拒绝清单中任何显式 PLACEHOLDER，正式视觉资产须声明 READY；路径 / 名称和程序化来源触发人工复核警告，机器不能可靠识别未标注占位稿。 |
| Release Art Gate（§139） | PARTIAL | 正式作品校验 / 打包汇总七项人工证据、独立技术与美术状态、占位与实体设备结果并阻止缺项；母版 / 差分继承、视觉遮挡与证据真实性仍未自动证明。 |

## 基线验证与边界

- 当前 `cb03e9c`：94 项 Node、6 项 Python、102 项来源检查和完整浏览器回归通过；[Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40453349708) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40453349702) 均成功。Windows 实际执行图层 / 轨道控件到 WebView2 终态和进程重启检查；镜头关键帧作者流程另由 Chromium 专项覆盖。
- 基线 `npm run check`：85 项 Node、6 项 Python 通过；98 个模块来源校验通过。
- 基线 GitHub Actions：Engine checks 和 Windows native host 在 `3075a748` 上成功；这不证明后续提交或实体移动设备验收通过。
- 规范同时包含作品创作、艺术质量与人工审核要求；引擎只能提供记录与门禁，不能凭自动化替代判断。未声明适用范围前不得把这些要求整体标为 N/A。
- 样例中的 SVG 和测试音频是技术样例，不能自动视作作品的正式资产；不迁移或改动任何已有游戏项目。

## 执行顺序

按交接推进：Persistence UI → Collection UI / 安全 Replay → Timeline / Formal Layer → Video → v0.2 Release Gate / 证据。每项应分别完成适用的运行时、自动测试、浏览器、Windows、文档与真实证据；缺失项保留 PARTIAL / UNVERIFIED。
