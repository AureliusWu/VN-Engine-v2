# v0.3.0 编辑器与 Windows 宿主验证

## 路线 QA 与作者工具

运行器提交 `a6c70cce47030ab4f8c7830963be51d99811ec2e` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40514905388) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40514905405) 均成功。本地 133 项 Node、6 项 Python、123 个来源检查与真实 Chromium 专项通过，覆盖 VN / 聊天 / Script / Rain / 调查、变量与证据、小游戏结果、命名检查点、逐步存读档、预算 / 覆盖缺失、失败 CLI 报告。浏览器对比玩家存储字节保持不变。

Studio 阶段：136 项 Node、6 项 Python、126 个来源检查与完整浏览器回归通过；实际操作从头录制、表单修改、失败定位、撤销、取消 / 过期 Worker，下载工程与报告并验证源字节 SHA256，检查 390px 无页面横向溢出。Windows 增加真实 WebView2 录制、Worker 执行与原生工程导出用例；其结果以本提交 CI 为准。新界面使用重新生成的改名 OFL 子集字体。

## 启动 / 标题 / 已读记录

最终实现 `2d185bd478cb5315fd3b3929ea8cb6d13b406c37` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40493930513) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40493930378) 均成功。Windows 实际执行保留 Auto / Continue、标题设置与确认 / 取消、新游戏、重挂载已读快进及完整进程重启后的持久标记；浏览器 / 编辑器及四样例锁定提交 QA 复核通过。正式美术 / 听感 / 实体设备仍未验收，见 [本轮机器记录](player-lifecycle-validation.json)。

已读阶段本地最终 `npm run check`（127 项 Node、6 项 Python、119 个来源）、完整 `npm run test:browser` 与 `npm run test:editor` 通过。新增检查覆盖准确文本 / 发言人 / 游戏 / 版本隔离、标题 / 暂停 / 隐藏、部分显示、读档历史不批量写入、回滚不 mark、容量与字节上限、并发合并、配额 / 损坏 / 不可用。Chromium 真正导航后重建实例，验证首句已读保留、未完成的下一句保持未读与快进停止；回看 / 回滚字节隔离用例在显式刷新已完成的原会话读记录后检查。Windows smoke 新增重挂载与完整进程重启的真实标记检查，本提交原生结果尚待确认。

标题提交 `13b12a379924b220dd81ab3e4633a3a7c942cbaa` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40492624097) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40492624215) 均成功。

标题阶段本地 122 项 Node、6 项 Python、117 个来源、完整浏览器与编辑器通过；覆盖开始前 Auto / Meta 不写、设置 / 收藏返回、Esc 不绕过、取消与确认新游戏 / 返回标题、Continue / Load、保留当前会话与旧手动 / Quick / Meta、视频回退 CG 在实际开始后解锁、Studio 预览 / 导出 / 撤销。桌面和 390px 截图已检查，不代表实体设备。Windows 原生增加相同标题流程，结果以本提交 CI 为准。

启动提交 `9ae181c4cd03702f6372aa5f6e83f15fea030899` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40491427170) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40491427233) 均成功。

启动修复本地通过 121 项 Node、6 项 Python、117 个来源检查及完整浏览器回归；Chromium 实际页面重载后旧 Auto 字节不变，Continue 能跳过损坏候选并恢复真实位置。核心覆盖四种驱动、同时间优先级、错槽、空槽与不可用存储；原生 WebView2 smoke 已加入重挂载与 Continue，Windows 结果以本提交工作流为准。

## 下一轮：声音 / 阅读 / 备份

最终实现 `9f7e4221de638ab44e945dfdb96a05a350b73ddb` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40488332833) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40488332817) 均成功；原生实际执行设置、回看继承、备份文件输入 / 预览 / 确认 / 读取恢复槽位及进程重启。按相同提交锁重建的四样例，文件 / 解码 / 包复核均 PASS，正式人工验收仍 BLOCKED。来源与逐项结果见 [本轮验证记录](optimization-next-validation.json)。

备份阶段本地最终 `npm run check`（119 项 Node、6 项 Python、116 个来源）、完整 `npm run test:browser` 与 `npm run test:editor` 均通过；实际检查 390px 备份预览截图，未宣称实体设备验收。未配置提交锁的本地 QA 样例包被身份检查拒绝；推送后按该确切提交重建复核，不使用前一个提交号标记新代码。

备份阶段新增 7 项核心测试：四种叙事驱动、跨游戏 / 重复槽 / 不可能路线拒绝、迁移、预览不可变与一次提交、确认前冲突、配额与回滚失败、小游戏中途状态。Chromium 实际下载 / 上传文件并走预览、取消、确认、读档，检查当前位置 / Meta 不改、预览后并发写入拒绝、关闭面板的迟到文件与连续选文件竞争。Windows smoke 新增真实 WebView2 文件输入、预览确认与读取已恢复槽位；原生结果以本提交工作流为准。

阅读提交 `0ff984155290a1de3cfa265e080511a954635358` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40486930321) 和 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40486930277) 均成功。

阅读阶段完整本地核心与浏览器回归通过：字号 100–160%、高对比、长对白滚动、聊天与文书避让、设置持久化、Tab 绕过隐藏文件输入、关闭后恢复焦点、回看里的设置 Esc 不退出外层。实际检查 390px 高对比设置截图，补齐运行样例和 Studio OFL 子集字体；实体移动设备和完整无障碍人工评估仍未验证。

声音提交 `d0f6e36fbd5c7a909b2c900833837cccb3e983e4` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40486346521) 和 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40486346529) 均成功。

声音分轨阶段：本地 `npm run check`（112 项 Node、6 项 Python、115 个来源）和完整 `npm run test:browser` 通过。新用例检查旧设置迁入、独立分轨、Master 与 Voice / SE / Video 乘积、实时调音不重播、环境音独立开关与持久化；Windows smoke 已加入实际设置控件和视频音量检查，原生执行结果以本提交工作流为准。合成音频的音量数值不作为正式听感验收。

## 2026-10-27 顺序优化

收藏提交 `36d492a` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40455664728) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40455664704) 均成功，原生 Studio 实际配置 CG 收藏、抓取预览 driver 存档，并保存和导出。

Key Visual 新增范围 / 场景 / 时长校验和 Studio 控件；Chromium 实际覆盖横幅容器、隐藏与宿主暂停、到时清理、离场、读档、跳过、减少动态和全屏演出下的可交互对白。Windows smoke 新增横幅开始和减少动态清理，本地 98 项 Node、6 项 Python、106 项来源检查、完整浏览器与编辑器专项通过；实际 Windows 结果以本次工作流为准。

收藏作者控件支持新增 CG / 结局、真结局标记、当前预览回看起点及真路线规则。新增单元测试覆盖组合条件、规则输入不可变、无效回看诊断和撤销修复；Chromium 专项覆盖真实预览位置抓取、导出、失效数据阻断与 390px 页面。Windows smoke 新增相同作者控件与真实回看起点的原生检查；该提交结果以工作流为准，尚未提前标 PASS。本地 96 项 Node、6 项 Python、104 项来源检查与完整浏览器 / 编辑器检查通过。

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

提交 `9894454` 的 Engine checks 与 Windows native host 均通过；Windows WebView2 实际播放无声 WebM，并验证显式减少动态时的回退。该结果不证明所有编码格式、有声视频听感或实体手机表现。

v0.2 美术门禁增加自动测试，使用明确标为测试的合成数据，验证技术 / 美术状态分离、七项人工证据、来源未确认、占位素材、动态人物 / UI 视觉、PWA 实体设备证据、真实文件 SHA256、提交身份和可解析的阻断报告。测试数据不是任何真实作品或实体设备的验收证据。

正式 CLI 同时验证资源存在、路径不越界及声明的 SHA256；Key Visual 的使用及生命周期需由作品提供人工声明和证据。这些检查不自动读取截图内容，也不替代目标设备人工验收。

Studio 演出控件新增 Chromium 验收：图层绑定、动画终点、镜头关键帧能进入真实预览并导出原始数据；无效时长阻止导出且可撤销 / 重做修复。Windows smoke 新增相同控件到 WebView2 最终姿态的检查，本次原生结果以该提交工作流为准。

本次本地 `npm run check` 通过 94 项 Node、6 项 Python 和 102 项来源检查；`npm run test:browser` 与 `npm run test:editor` 全部通过。浏览器证据包括 `studio-presentation.png` 和 `studio-camera.png`，由工作流随其余证据上传；视口截图不作为实体设备或正式美术验收。

提交 `cb03e9c7585ba91cc4fa69ac7d0e0f6cbb6bfbeb` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40453349708) 和 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40453349702) 均成功。原生 Studio 用实际控件绑定前景立绘和动画轨道，并在 WebView2 预览确认终态，随后执行原生保存、导出和完整进程重启；镜头关键帧作者流程由 Chromium 验证。编辑面板展开状态与滚动位置在更改后保留。系统文件对话框仍使用 CI 预设路径，不冒充人工操作。

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

保留此前的 [0.2.1](VALIDATION-v0.2.1.md)、[0.2.0](VALIDATION-v0.2.0.md)、[0.1](VALIDATION-v0.1.0.md) 证据。当前时间线支持位移 / 缩放 / 透明度与镜头关键帧；收藏作者面板和 Key Visual 生命周期约束已验收；会话内状态回滚已实现，本轮原生结果以工作流为准。正式游戏迁移继续等待用户主动提出。

Key Visual 提交 `45e76c4` 的 Windows 工作流成功，浏览器 CI 在作者控件中发现异步 toggle 事件与属性重建竞争：修改资源后面板可能收起。修复在重建前同步读取实际展开状态；该失败保留记录，修复结果以新提交 CI 为准。

修复提交 `9986aa7` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40457166036) 和 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40457166043) 均成功；同步属性编辑期间展开状态得到保留，Key Visual 范围 / 生命周期及原生检查通过。

状态回滚本地通过 102 项 Node、6 项 Python、107 项来源检查与完整浏览器回归：三类 driver 的路线 / 变量 / 证据恢复、有限步数和读档边界、声音绑定 / 语音回到当前句且不重播 SE；真实 DOM 验证终态和存档 / Meta 字节保持不变。Studio 可关闭回滚或配置步数。Windows smoke 新增真实回退控件到之前台词 / 舞台的检查，本次原生结果以对应工作流为准。

回滚性能修正：内部检查点只捕获已由 driver 持有的路线和位置，恢复仍通过标准 codec 重建；不在每次翻页时做完整路线重放。关闭回滚不抓取检查点，抓取异常保留阅读能力。500 次同场景翻页的本地单进程微测约 50ms（开启 / 关闭均为这一量级），仅说明该合成夹具，不代表端到端 FPS。

回滚提交 `2d2cb34` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40457880306) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40457880458) 均成功；原生 WebView2 验证先前台词 / 舞台恢复、Auto / Meta 不改写以及进程重启。

小游戏 v1 增加可实际游玩的开关谜题；单元测试验证所有结果、输入记录重放、失效导入拒绝和原状态保留、暂停 / 配置隔离；浏览器专项验证中途 Quick / Auto 存档、恢复、原生暂停事件、回滚、跳过 / 退出结果及 Studio 配置和试玩。Windows smoke 加入同一玩法的真实操作与恢复；本地 106 项 Node、6 项 Python、110 项来源检查、完整浏览器与编辑器专项均通过，本次原生结果以工作流为准。

小游戏提交 `c0cca95` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40459233810) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40459233870) 均成功；原生 WebView2 实际完成输入、中途存档恢复、结果入剧情和回滚。

统一 QA / 母版阶段新增测试：人工 QA 缺项与适用性、Neutral 失败传给差分、独立失败汇总、实际包文件损坏 / 同版本旧故事拒绝、CLI 阻断报告保留，以及 Chromium 实际解码和正式候选端到端门禁。所有人工 PASS 数据均明确为合成测试夹具，不是作品或实体设备证据。本地四种样例的实际文件、解码和候选包检查通过；它们缺少正式美术与人工记录，报告均保持 BLOCKED。

本阶段本地最终 `npm run check`：111 项 Node、6 项 Python、115 项来源检查通过；完整 `npm run test:browser` 和 QA 的真实 Chromium 解码 / 正式候选 API 与 CLI 端到端专项通过。四样例生成实际 QA_REPORT 与 build manifest，文件 / 解码 / 包校验均 PASS，人工与艺术验收缺失继续 BLOCKED。最新工作流结果单独确认。

统一 QA 提交 `bc253ca371efad19f1201814650db39a799a896d` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40462250715) 和 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40462250734) 均成功；CI 生成并上传 [alpha-qa-reports](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40462250715/artifacts/12714878378)。四种样例真实字节 / 解码 / 包复核均 PASS，正式人工验收继续 BLOCKED。完整闭环记录见 [optimization-v0.2-validation.json](optimization-v0.2-validation.json)。
