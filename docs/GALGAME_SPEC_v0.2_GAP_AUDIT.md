# GALGAME SPEC v0.2 差距审计

审计基线：`3075a7480fe43423a1516dc1328cf84f4cac1742`，2026-10-27；本轮路线 QA 的实现与逐提交证据见 [本轮计划](OPTIMIZATION-ROUTE-QA.md)。规范正文来自用户提供的交接文件，见 [GALGAME SPEC v0.2](GALGAME_SPEC_v0.2.md)。引擎保持 `0.3.0 alpha`；本表不代表任何作品已达到 RELEASE。

状态：`PASS` 表示所描述的有限能力有实现和证据；`PARTIAL` 表示有一部分；`ENGINE_GAP` 表示缺少明确的引擎能力；`UNVERIFIED` 表示没有对应证据；`N/A` 只在具体项目明确不适用时使用。状态不因接口存在而提升。v0.1 原机器契约仍为 `GALGAME_SPEC-v0.1`。

## 工程与运行能力

| v0.2 范围 | 当前状态 | 依据与剩余工作 |
| --- | --- | --- |
| 项目身份、故事结构、引用、占位文本（§3–15、50、55–58） | PARTIAL | `src/compliance/project.ts` 检查真实结构、静态引用与占位文本；本轮增加作者路线用例、逐步存读档和声明结局覆盖。动态 presentation 仍仅告警，剧情质量与完整作品审读须另有证据。 |
| 角色/背景/CG/音频的播放（§16–30） | PARTIAL | `src/render/dom.ts`、`src/runtime/media.ts` 有现有渲染和媒体运行时；能力不证明作品质量或正式素材完成。 |
| Choice、Auto、已读 Skip、Hide UI、History（§31–35） | PASS | 运行调度与 DOM 交互已接入；`2d185bd` 增加有界跨重启精确已读记录，文本 / 版本变化不冒充已读，浏览器导航及 Windows 进程重启通过；完整状态回滚另列。 |
| 启动、标题、New Game / Continue（§89–92、110） | PASS | 保留挂载前 Auto、独立路线验证、可选标题与确认流程、Studio 配置；`2d185bd` 浏览器 / Windows 通过；不代表正式标题美术完成。 |
| Rollback（§34） | PASS | 新增有界会话检查点，恢复实际路线 / 变量 / 舞台 / 声音绑定 / 历史游标，排除 Save / Meta 写入；`2d2cb34` 浏览器及 Windows 通过；检查点仅限当前会话。 |
| 多槽、快速、自动存档（§36–41、111–112） | PASS | 六槽、覆盖确认、Quick 控件、自动存档提示与旧槽读取已接入，浏览器和 Windows 原生重启检查通过；整体备份、路线验证与预览确认已通过 `9f7e422` 浏览器 / Windows CI；可选截图缩略图未实现。 |
| Meta、CG Gallery、Ending Collection、Replay（§42–44、103–104） | PASS | 项目可声明图鉴、结局和回看数据；播放器提供锁定遮蔽、进度、查看和独立会话回看，普通存档 / Meta 隔离；`4a8a57e` 浏览器及 Windows CI 已通过，Studio 作者面板、实际预览回看起点与真路线规则已通过 `36d492a` 浏览器及 Windows 原生检查。 |
| 演出时间线、层与关键视觉生命周期（§29–30、97、108、134） | PARTIAL | DOM 的五个视觉资源层、效果 / UI 轨道、镜头及终态重建和 Studio 作者控件已接入；`cb03e9c` 浏览器与 Windows 通过。Key Visual 范围 / 场景 / 时限与清理已实现，`9986aa7` 浏览器 / Windows 通过；作品构图仍需人工验收。 |
| Video（§98） | PARTIAL | DOM 播放、结束清理、失败回退、暂停 / 跳过 / 减少动态及编辑器配置已实现；`9894454` 浏览器及 Windows 无声 WebM 检查通过，有声听感和实际设备的编解码支持仍须验证。 |
| 小游戏（§99–100） | PARTIAL | 小游戏生命周期 v1 已接入 RuntimeSession / DOM / Studio，内置开关谜题；`c0cca95` 浏览器 / Windows 已通过，其他玩法需独立适配器。 |
| 设置、输入、字号、安全区域、无障碍（§28、45–49、96） | PARTIAL | `d0f6e36` 分轨 / Master、`0ff9841` 字号 / 高对比 / 焦点隔离均已通过浏览器和 Windows；长文本滚动、聊天 / 文书避让与 safe-area 样式已接入。作品具体设备、对比体验、字体与完整无障碍仍须验收。 |
| 作品打包、PWA、桌面与 CI（§62–71、80、115–117） | PARTIAL | 生成指纹、SHA256 与 build identity；正式打包调用 v0.2 美术 / 设备证据门禁。每个作品的实际发行、离线和各平台验收仍需单独证据；不能据此声称 v0.2 全量合规。 |
| 编辑器与数据驱动（§84–85、119） | PARTIAL | Studio 增加从开场手动录制、用例表单、撤销、失败定位和独立 Worker 执行 / 取消；工程修改使旧录制 / 结果失效。条件 / 证据与章节仍需更完整的结构化作者工具。 |
| QA / 证据 / 错误处理（§72–81、86–90、121–125） | PARTIAL | 统一 QA_REPORT 汇总结构、实际路线、真实字节 / 解码、人工记录和包复核；正式校验 / 打包 / 候选要求路线用例与声明结局覆盖 PASS。独立样例 10 个用例覆盖 11 个结局；不穷举全部分支组合、不自动审读剧情或认证人工证据。逐提交浏览器 / Windows 结果见本轮记录。 |

## v0.2 新增 / 强化项

| 要求 | 基线状态 | 依据与缺口 |
| --- | --- | --- |
| `TECH_READY` 与 `ART_READY` 分开（§130） | PARTIAL | 两种状态分别声明和检查；QA 工具可实际解码图片 / 字体 / 音频并探测视频首帧，技术结果不推导艺术质量，人工声明真实性仍未自动认证。 |
| Production Art Visual Gate（§131–133、138–140） | PARTIAL | 七项人工声明、审核者、日期和证据引用缺失时阻止发布；角色母版 / 差分继承已结构化并传播失败，实际截图内容、源图与声明真实性仍需人工验收。 |
| Key Visual 生命周期（§134） | PARTIAL | 运行时和 Studio 已限制使用范围、场景类型与明确生命周期，并检查发布声明是否矛盾；`9986aa7` 浏览器 / Windows 已通过，实际构图和人工证据仍需作品验收。 |
| 移动端实体设备（§135） | PARTIAL | 作品声明移动端 / PWA 时，门禁要求实体设备、人工审核者、日期和证据；本仓库样例没有实体设备验收，不能标 PASS。 |
| 资产生产链真实性（§136） | PARTIAL | `docs/provenance.json` 追踪引擎代码；作品门禁要求逐资产来源、审核和证据引用，但不能自动判定内容真实性。未知来源不能猜测。 |
| Production runtime 占位资产（§137） | PARTIAL | release 拒绝清单中任何显式 PLACEHOLDER，正式视觉资产须声明 READY；路径 / 名称和程序化来源触发人工复核警告，机器不能可靠识别未标注占位稿。 |
| Release Art Gate（§139） | PARTIAL | 正式作品校验 / 打包汇总七项人工证据、独立技术与美术状态、占位与实体设备结果并阻止缺项；已补母版继承检查与统一 QA；实际视觉遮挡、源图和证据真实性仍需作品人工验收。 |

## 基线验证与边界

- 本轮本地核心 140 项 Node、6 项 Python、126 项来源检查通过，四份独立样例实际执行 10 个用例、11 个声明结局和 73 次逐步存读档；正式门禁缺少用例 / 失败 / 未覆盖时不创建候选。完整浏览器和 Windows 以 [本轮逐提交记录](OPTIMIZATION-ROUTE-QA.md) 为准，生产人工验收继续 BLOCKED。

- 当前 `2d185bd`：127 项 Node、6 项 Python、119 项来源检查、完整浏览器 / 编辑器及 Windows CI 通过，启动保护、标题 / 确认与持久已读完成；四样例实际字节 / 解码 / 包检查 PASS，生产人工验收仍 BLOCKED，详见 [本轮计划](OPTIMIZATION-PLAYER-LIFECYCLE.md)。

- 上一轮 `9f7e422`：119 项 Node、6 项 Python、116 项来源检查、完整浏览器 / 编辑器和 Windows CI 通过，声音分轨、阅读 / 焦点及多槽备份完成；四样例锁定提交后的文件 / 解码 / 包复核通过，正式人工验收仍 BLOCKED；详见 [该轮计划与证据](OPTIMIZATION-NEXT.md)。

- 上一轮 `bc253ca`：111 项 Node、6 项 Python、115 项来源检查，浏览器和 Windows CI 全部通过，四样例实际文件 / 解码 / 构建包检查通过但正式人工验收保持 BLOCKED；详见 [顺序优化与证据](OPTIMIZATION-v0.2-QUEUE.md)。

- 演出作者控件阶段 `cb03e9c`：94 项 Node、6 项 Python、102 项来源检查和完整浏览器回归通过；[Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40453349708) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40453349702) 均成功。Windows 实际执行图层 / 轨道控件到 WebView2 终态和进程重启检查；镜头关键帧作者流程另由 Chromium 专项覆盖。
- 基线 `npm run check`：85 项 Node、6 项 Python 通过；98 个模块来源校验通过。
- 基线 GitHub Actions：Engine checks 和 Windows native host 在 `3075a748` 上成功；这不证明后续提交或实体移动设备验收通过。
- 规范同时包含作品创作、艺术质量与人工审核要求；引擎只能提供记录与门禁，不能凭自动化替代判断。未声明适用范围前不得把这些要求整体标为 N/A。
- 样例中的 SVG 和测试音频是技术样例，不能自动视作作品的正式资产；不迁移或改动任何已有游戏项目。

## 执行顺序

按交接推进：Persistence UI → Collection UI / 安全 Replay → Timeline / Formal Layer → Video → v0.2 Release Gate / 证据。每项应分别完成适用的运行时、自动测试、浏览器、Windows、文档与真实证据；缺失项保留 PARTIAL / UNVERIFIED。
