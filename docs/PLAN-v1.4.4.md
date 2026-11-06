# v1.4.4 Studio 批量回看校验计划

日期 2026-11-06。基线 `12bc490f8cc41b459c3f6515cedcaa231608be06`。本轮聚焦收藏含多条回看起点时的作者诊断，性能与平台结果另行记录。

基线先对完整工程执行运行校验，再对每条回看构建一份去掉 collections 的运行实例并调用 `restore`。每条回看都会重做工程、资源与解释器准备。运行恢复仍需独立建立 driver 和 session，以隔离路线、已读、小游戏、回滚和计时器状态。[基线诊断](https://github.com/AureliusWu/VN-Engine-v2/blob/12bc490f8cc41b459c3f6515cedcaa231608be06/src/editor/model.ts#L211-L218) [工程准备](https://github.com/AureliusWu/VN-Engine-v2/blob/12bc490f8cc41b459c3f6515cedcaa231608be06/src/runtime/project.ts#L34-L79) [恢复与清理](https://github.com/AureliusWu/VN-Engine-v2/blob/12bc490f8cc41b459c3f6515cedcaa231608be06/src/runtime/session.ts#L254-L282)

## 开源与社区证据

- ink 固定提交 `35c63e52f1d36060930dc7ed3cfba38ea224b528`，MIT。读取 `ink-engine-runtime/Story.cs` 第 210–238、299–311 行与 `StoryState.cs` 第 595–630 行。Story 持有解析后的内容，`ResetState` 新建状态并初始化全局变量。后台保存的补丁路径会暂借变量状态与计数，借用关系需要显式恢复。inkle 成员在社区讨论中说明，只重置调用栈可能丢失 tunnel，保留旧调用栈也可能回到上一段对话。Studio 采用内容准备与运行状态分开的思路，逐条创建运行状态。[内容装载](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/ink-engine-runtime/Story.cs#L210-L238) [状态重建](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/ink-engine-runtime/Story.cs#L299-L311) [补丁边界](https://github.com/inkle/ink/blob/35c63e52f1d36060930dc7ed3cfba38ea224b528/ink-engine-runtime/StoryState.cs#L595-L630) [成员讨论](https://github.com/inkle/ink/issues/317#issuecomment-302030018)
- Ren’Py 固定提交 `4025f3c2611e10021e620a9a7894053123fae556`。读取 `renpy/game.py` 第 360–421 行。回看建立新的回滚日志和执行上下文，备份并清理变量存储，退出时恢复原日志和存储。这里借鉴独立回看状态和异常清理。Ren’Py 的交互、store 及回滚协议属于其自身运行时。[回看实现](https://github.com/renpy/renpy/blob/4025f3c2611e10021e620a9a7894053123fae556/renpy/game.py#L360-L421)
- Yarn Spinner 固定提交 `c5215f86dd5a6761aecbdc9f60f6a6108f91f919`，MIT。读取 `YarnSpinner/Dialogue.cs` 第 583–592、726–735、783–787 行与 `VirtualMachine.cs` 第 238–250 行。程序、VM 状态和外部变量存储分别管理，重建 VM 的 State 时仍保留注入的存储。复用校验载体时应明确拥有和清理哪些状态。[程序与 VM](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner/Dialogue.cs#L583-L592) [注入存储](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner/Dialogue.cs#L726-L735) [VM 状态重建](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner/VirtualMachine.cs#L238-L250)
- Lemma Soft Forums 的作者讨论了从游戏内画廊进入回看时如何初始化变量，以及如何用显式 scope 恢复音乐。官方手册说明回看的初始变量由 scope 注入，结束时返回发起处。该案例提示回看的运行上下文应随每次恢复建立。[作者提问](https://lemmasoft.renai.us/forums/viewtopic.php?t=66097) [音乐恢复案例](https://lemmasoft.renai.us/forums/viewtopic.php?t=68631) [官方回看文档](https://www.renpy.org/doc/html/rooms.html#replay)

## 实施范围

1. 保留独立的完整工程运行校验，包含 collections 元数据及资源引用。每条回看仍基于去掉 collections 的工程校验，在一次 `diagnoseProject` 调用中共享已验证的引擎和资源准备。共享范围随诊断调用结束。
2. 每条回看创建新的 driver 和新的 `RuntimeSession`，使用现有 `restore` 验证并在完成或异常后 `dispose`。沿用从路线重建状态的校验、小游戏校验与原有错误。自定义 narrative presentation 继续逐条走原来的完整重建路径。
3. 保持完整运行错误在前、CG 回看在前而结局回看在后的诊断顺序，保留每条失败的代码和消息。播放器构建、实际播放和存档格式沿用现有契约。

## 验收

- 对照基线的完整诊断输出。覆盖坏→有效→坏、小游戏回看、无效运行和 collections 元数据、CG 与结局顺序、各 runtime 以及自定义 narrative presentation 的逐条重建路径。核对每条恢复相互独立并完成清理。
- 同机同 Node、相同输入及预热规则，基线与新版固定各三轮。两组输入分别为 9 块和 4 条回看、2049 块和 64 条回看。每组另保留相同工程但去除 replay 数据的对照，逐轮核对诊断一致，保留所有原始样本并报告中位与最慢时间。测量范围是 Node 中的真实完整作者诊断。
- 运行本地核心、编辑器与浏览器回归，按同一提交核对 Linux 与 Windows CI。样例技术检查、Windows Chromium、原生 WebView2 文件 I/O 和完整重启分别记录。
