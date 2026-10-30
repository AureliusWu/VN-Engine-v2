# v1.3.0 参考引擎研究与本轮取舍

基线：VN Engine v2 **1.2.2**，提交 `4c3500d23bce470f689c3da3b6e71450890990e2`。本轮主线确定为 **DSL 演出声明与上下文资源诊断**，继续使用自研 TypeScript 解释器、DOM、Studio、Agent 和 canonical replay。

本文件的“采纳”表示方案取舍，不表示功能已经交付或验收通过。研究已完成；编译器、Studio、Agent、独立包和原生平台的实际结果必须另行记录。机器清单见 [reference-mining-v1.3.0.json](reference-mining-v1.3.0.json)。

## 实际资料来源

2026-10-30 实查 `D:\AI项目\参考资料`：目录顶层及其“参考资料说明.md”“参考资料来源.json”列出的源码是 cc-switch、Claude Code、deepseek-harness、jiwen、MemoryConstellations；没有已编目的 Ren’Py、WebGAL、Yarn Spinner、Monogatari、ink 等 VN 引擎快照。本次没有把无关 AI 工具快照当作 VN 引擎源码，也没有声称在本地读过这些上游仓库。

实际研究使用了 [P0 已锁定的官方提交](P0_DEVELOPMENT.md) 与本次重新读取的官方远程资料。Ren’Py、WebGAL、Monogatari 沿用 P0 提交并重新核对默认分支；Yarn Spinner、ink 本次按官方默认分支固定提交。全部只读；未下载上游运行包、安装其依赖、运行其构建或复制其实现。

## 官方仓库状态快照

以下 Stars 是 **2026-10-30 18:03（Asia/Shanghai）** 的 GitHub API 实查快照，不能作为以后日期的实时数值。HEAD 和 Release 在同次研究中复核；五仓库均未归档。“最新 Release”指各仓库 GitHub 的 latest 非预发布条目，发布日按 UTC；不将官网滚动开发文档的版本标题等同于已发布版本。

| 官方仓库 | 默认分支 | 精确 HEAD | 最新 GitHub Release / 发布日 | Stars 快照 | 许可证出处 |
| --- | --- | --- | --- | ---: | --- |
| [Ren’Py](https://github.com/renpy/renpy) | master | `4025f3c2611e10021e620a9a7894053123fae556` | [8.5.3.26051504](https://github.com/renpy/renpy/releases/tag/8.5.3.26051504) / 2026-05-16 | 6,953 | [MIT for most engine/docs; LGPL and other dependency licenses separately](https://github.com/renpy/renpy/blob/4025f3c2611e10021e620a9a7894053123fae556/sphinx/source/license.rst) |
| [WebGAL](https://github.com/OpenWebGAL/WebGAL) | main | `15173bc21339a65da34b78463fca8a304e4d503a` | [4.6.6](https://github.com/OpenWebGAL/WebGAL/releases/tag/4.6.6) / 2026-10-08 | 4,020 | [MPL-2.0](https://github.com/OpenWebGAL/WebGAL/blob/15173bc21339a65da34b78463fca8a304e4d503a/LICENSE) |
| [Yarn Spinner](https://github.com/YarnSpinnerTool/YarnSpinner) | main | `c5215f86dd5a6761aecbdc9f60f6a6108f91f919` | [v3.2.1](https://github.com/YarnSpinnerTool/YarnSpinner/releases/tag/v3.2.1) / 2026-05-05 | 2,864 | [MIT](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/LICENSE.md) |
| [Monogatari](https://github.com/Monogatari/Monogatari) | develop | `86659baf065178071f0956092f754e1d76be0072` | [v2.8.0](https://github.com/Monogatari/Monogatari/releases/tag/v2.8.0) / 2026-06-18 | 891 | [MIT](https://github.com/Monogatari/Monogatari/blob/86659baf065178071f0956092f754e1d76be0072/LICENSE) |
| [ink（后置候选）](https://github.com/inkle/ink) | master | `35c63e52f1d36060930dc7ed3cfba38ea224b528` | [v1.2.1](https://github.com/inkle/ink/releases/tag/v1.2.1) / 2026-05-05 | 4,995 | [MIT](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/LICENSE.txt) |

Ren’Py 的官方许可文档明确区分主要 MIT 部分与 LGPL/其他依赖许可，不将整个 SDK 简化为只有 MIT。WebGAL 为 MPL-2.0；其余三者为 MIT。本轮没有上游代码进入实现；这些许可证信息用于研究追溯，不改变本仓库既有许可与第三方记录。

## v1.2.2 已有能力与缺口

| 范围 | 基线已有 | 本轮实际缺口 |
| --- | --- | --- |
| 解释器与舞台 | JSON ScriptProgram 已有 block/line cue；StageCue、持久舞台重建、visit 绑定的一次性媒体 | 文本 DSL 不能编写这些既有演出字段 |
| 调度与媒体 | RuntimeSession、DOMRenderer、MediaDirector 已区分推进、暂停、恢复和单次音效；有预算预取 | 需要验证新文本入口沿用同一语义，不能再造一个媒体执行器 |
| 作者工具 | 纯文本编译、显式 ID、source map、候选预览、明确应用、单次撤销 | 缺少 cue 声明及目标/资源上下文定位诊断 |
| Agent 与构建 | script.compile、JSON IR、来源绑定、独立包及子目录离线测试 | Studio/Agent/CLI 应使用同一资源上下文；玩家包仍只接收既有 JSON IR |

相关基线约定见 [P1](P1_DEVELOPMENT.md)、[架构](ARCHITECTURE.md) 和 [v1.2.2 优化](OPTIMIZATION-v1.2.2.md)。本轮不把已有预取、音量分轨、存档或离线功能重新记为新增能力。

## 参考概念与采用方式

**Ren’Py：可检查的图像、音频语句。** 图像文档分别描述命名图像、图层显示、清除与移除；音频文档区分通道、切换和重复播放。语句注册接口把 parse、lint、execute、predict 分开。本轮采用“作者声明可独立检查”的思路：文字只生成既有 StageCue，资源错误在作者入口定位；不引入 Python、任意表达式、Ren’Py 运行时或它的存档体系。

**WebGAL：状态与运行时演出分工。** 已读固定 SHA 的媒体脚本及内核作者指南，把可恢复状态的计算与 commit 后的媒体/视觉动作区分开，并给出演出的启动、清理和推进门控。本轮保留自研 replay、Session、MediaDirector 的现有边界：新 DSL 不在编译时播放素材，恢复不补播历史单次动作。没有把 WebGAL 的全局对象、Redux/Pixi 或媒体实现搬入本仓库。

**Monogatari：show/play 与 Action 生命周期。** ShowBackground、Play 及 Action 展示了应用、恢复、回退与清理分别处理的概念。本轮只据此核对自研宿主的生命周期要求；不引入动态 Action 注册或项目函数回调，也不用通用逆操作取代真实路线重建。

**Yarn Spinner：显式身份与结构化诊断。** DiagnosticDescriptor 将代码、严重性与源位置关联；StringTableManager 区分显式和隐式 line ID；官方诊断目录单列重复 line ID 和未知命令。本轮保留显式 block/line ID、稳定 source path/span 和可定位诊断。Yarn 的 UnknownCommand 条目是 language-server warning 政策，本仓库受限 DSL 的未知语法/字段继续按自身编译契约拒绝，不能照搬上游严重性或接受任意命令。

## 本轮确定的边界

1. 使用 `cue block <explicit-id> …`、`cue line <explicit-id> …` 的目标形式；只允许本轮契约列出的字面量字段映射到既有 StageCue。白名单不是开放全部 StageCue，也不接受任意对象透传。
2. 目标按显式 ID 解析，不依赖文件排版或“最近一行”的隐式身份；错误必须关联原始文本位置。不得因新增声明重排正文身份。
3. 资源检查来自显式注入、有预算的作者上下文；检查 asset ID、kind、字段类型与范围。未提供上下文时不伪称资源已验证，也不在纯编译模块读取文件、网络、DOM 或创建音频对象。
4. 编译结果仍是现有 ScriptProgram/JSON IR，source map 和诊断属于作者数据；不得写进玩家存档或变成状态权威。Studio 候选预览、明确应用和撤销沿用现有事务。
5. 媒体、暂停、恢复、打字和离线构建复用现有执行链。新增实现独立原创，来源分类为 new；本文件的上游链接仅记录概念启发，没有复制上游 parser、Action 或媒体代码。
6. 四作和 RESET 的迁移不在授权范围；不修改其宿主、剧情、数据或原生存档。

语法的完整字段白名单、字面量规则和对外参数以本轮最终实现契约为准。这里不预先承诺尚未实现的嵌套 timeline、任意媒体脚本或宿主扩展。

## 后置方向

| 候选 | 为什么不并入 v1.3.0 | 独立推进前必须验证 |
| --- | --- | --- |
| 多文件 DSL / include 工程 | 文件身份、解析顺序、路径和工作区格式是另一条作者链 | 文件清单、循环/预算、跨文件 source map、路径边界、原子应用 |
| locale / 文本目录 / 插值 | 涉及文本和语音语言、占位符、字体与已读/历史身份 | 来源过期、缺译回退、占位符、切换时机、读档/回看、无障碍呈现 |
| 条件 / once / 禁用选项 | 改变可用动作集合与剧情决策语义 | canonical replay、循环重访、回滚、旧档兼容和伪造选择拒绝 |
| call/return / tunnel / 局部作用域 | 改变控制流与恢复权威，需要新的连续执行设计 | 调用边界、栈预算、路线枚举、存读档和迁移策略 |

ink 的多文件组织和 Yarn/Monogatari 的语言或选项机制属于后续候选；本轮没有实现，也不列为自动执行的下一步。已有明确目标优先于按热门仓库功能表扩展范围。

## 固定提交的实际读取清单

每行链接都固定到本次读取的上游提交和文件，不依赖可前移的 master/main/develop。精确提交、读取窗口和 Git blob SHA 另存于机器清单；窗口末端可能超过实际 EOF，不表示读取了不存在的行。

| ID | 实际读取的文件与位置 | 许可范围 | 用于判断的概念 |
| --- | --- | --- | --- |
| rpy-images | [sphinx/source/displaying_images.rst](https://github.com/renpy/renpy/blob/4025f3c2611e10021e620a9a7894053123fae556/sphinx/source/displaying_images.rst#L1) | MIT primary; dependency licenses separate | Named image/layer statements and lintable media declarations |
| rpy-audio | [sphinx/source/audio.rst](https://github.com/renpy/renpy/blob/4025f3c2611e10021e620a9a7894053123fae556/sphinx/source/audio.rst#L1) | MIT primary; dependency licenses separate | Explicit media channels and repeat/replace semantics |
| rpy-statements | [renpy/statements.py](https://github.com/renpy/renpy/blob/4025f3c2611e10021e620a9a7894053123fae556/renpy/statements.py#L1) | MIT | Distinct parse/lint/execute/predict responsibilities |
| rpy-license | [sphinx/source/license.rst](https://github.com/renpy/renpy/blob/4025f3c2611e10021e620a9a7894053123fae556/sphinx/source/license.rst#L1) | MIT plus LGPL/other dependencies | License scope, not code reuse authorization |
| webgal-authoring | [packages/webgal/src/Core/gameScripts/SCRIPT_AUTHORING.md](https://github.com/OpenWebGAL/WebGAL/blob/15173bc21339a65da34b78463fca8a304e4d503a/packages/webgal/src/Core/gameScripts/SCRIPT_AUTHORING.md#L1) | MPL-2.0 | Calculation state and post-commit presentation separation |
| webgal-perform | [packages/webgal/src/Core/Modules/perform/performInterface.ts](https://github.com/OpenWebGAL/WebGAL/blob/15173bc21339a65da34b78463fca8a304e4d503a/packages/webgal/src/Core/Modules/perform/performInterface.ts#L1) | MPL-2.0 | Explicit presentation start/cleanup/next/auto lifecycle |
| webgal-bgm | [packages/webgal/src/Core/gameScripts/bgm.ts](https://github.com/OpenWebGAL/WebGAL/blob/15173bc21339a65da34b78463fca8a304e4d503a/packages/webgal/src/Core/gameScripts/bgm.ts#L1) | MPL-2.0 | Named media statements and media parameters |
| webgal-effect | [packages/webgal/src/Core/gameScripts/playEffect.ts](https://github.com/OpenWebGAL/WebGAL/blob/15173bc21339a65da34b78463fca8a304e4d503a/packages/webgal/src/Core/gameScripts/playEffect.ts#L1) | MPL-2.0 | One-shot versus held media and explicit cleanup |
| webgal-background | [packages/webgal/src/Core/gameScripts/changeBg/index.ts](https://github.com/OpenWebGAL/WebGAL/blob/15173bc21339a65da34b78463fca8a304e4d503a/packages/webgal/src/Core/gameScripts/changeBg/index.ts#L1) | MPL-2.0 | Persistent visual state versus transitions |
| webgal-figure | [packages/webgal/src/Core/gameScripts/changeFigure.ts](https://github.com/OpenWebGAL/WebGAL/blob/15173bc21339a65da34b78463fca8a304e4d503a/packages/webgal/src/Core/gameScripts/changeFigure.ts#L1) | MPL-2.0 | Explicit target identity and media argument parsing |
| monogatari-show | [src/actions/ShowBackground.ts](https://github.com/Monogatari/Monogatari/blob/86659baf065178071f0956092f754e1d76be0072/src/actions/ShowBackground.ts#L1) | MIT | Named show action and restore lifecycle |
| monogatari-play | [src/actions/Play.ts](https://github.com/Monogatari/Monogatari/blob/86659baf065178071f0956092f754e1d76be0072/src/actions/Play.ts#L1) | MIT | Audio progression, restore and lifecycle distinctions |
| monogatari-action | [src/lib/Action.ts](https://github.com/Monogatari/Monogatari/blob/86659baf065178071f0956092f754e1d76be0072/src/lib/Action.ts#L410) | MIT | Before/apply/after and revert boundaries |
| yarn-diagnostics | [YarnSpinner.Compiler/DiagnosticDescriptor.cs](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Compiler/DiagnosticDescriptor.cs#L1) | MIT | Stable diagnostic code/severity/source locations |
| yarn-lineids | [YarnSpinner.Compiler/StringTableManager.cs](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Compiler/StringTableManager.cs#L1) | MIT | Explicit versus implicit line identity and source association |
| yarn-duplicate-id | [YarnSpinner.Diagnostics/Definitions/YS0018-DuplicateLineID.md](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Diagnostics/Definitions/YS0018-DuplicateLineID.md#L1) | MIT | Duplicate line identity diagnostic |
| yarn-unknown-command | [YarnSpinner.Diagnostics/Definitions/YS0060-UnknownCommand.md](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Diagnostics/Definitions/YS0060-UnknownCommand.md#L1) | MIT | Unknown-command diagnostic with upstream language-server severity policy |

后置候选另读了 [ink 多文件与选项文档](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/Documentation/WritingWithInk.md#L448)、[Monogatari Choices](https://github.com/Monogatari/Monogatari/blob/86659baf065178071f0956092f754e1d76be0072/docs/script-actions/choices.md#L1) 和 [Monogatari UI 翻译](https://github.com/Monogatari/Monogatari/blob/86659baf065178071f0956092f754e1d76be0072/docs/advanced-monogatari-development/translations.md#L1)，许可均为 MIT，精确 blob 另存于机器清单 deferredSources。这些是后置候选依据，没有被误写成 DSL cue 已实现的证据。

## 必须另行提供的验证

- 编译器：既有 DSL 等价性；目标 ID、重复/未知字段、字面量和资源 ID/kind 错误；CJK/CRLF 精确定位；预算耗尽不产出半成品。
- Studio/Agent/CLI：同一编译器与资源上下文；候选预览、明确应用、单次撤销；来源或目录上下文过期时不应用迟到结果。
- 运行时：编译后的 JSON 与手写 JSON 路线/状态等价；实际图像、音频和暂停；读档/回看不重放历史一次性动作。
- 构建与平台：生成玩家包和 Studio 包在子目录及断网新页实际执行；Linux 完整核心/浏览器与 Windows 实际 WebView2/文件 IO/完整重启分别记录。

以上在本研究记录中均为待验证。编译通过、浏览器通过、原生自动化、系统对话框人工操作和正式作品内容验收分别报告，不互相替代。
