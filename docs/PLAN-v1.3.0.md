# v1.3.0 参考引擎对照与作者演出规划

日期：2026-10-30。基线：`4c3500d23bce470f689c3da3b6e71450890990e2`（v1.2.2），开始时工作区干净。本轮规划后直接实施，继续自研主运行链，不迁移四作，不引入参考引擎依赖，不创建正式 Release / tag。

## 参考与优先级

研究证据、固定提交、官方链接与实际读取范围见 [参考对照](REFERENCE-MINING-v1.3.0.md)。本地“参考资料”目录目前没有 VN 引擎快照，采用既有 P0 锁定源码链接及官方远程资料；不把未读取的本地源码或未经执行的平台标为已验证。

| 方向 | 当前真实能力 / 缺口 | 本轮决定 |
| --- | --- | --- |
| Ren’Py / WebGAL / Monogatari 的画面与声音作者指令 | JSON StageCue 与自研宿主已支持，文本 DSL 只能写对白和分支 | 实施受限 cue 前端，直接生成已有 IR |
| 分阶段 lint / 编译诊断与稳定来源 | 已有 source map / SourceOrigin，但 DSL 不检查当前资源目录 | 实施共享的第二阶段目录检查，覆盖 Studio、Agent、CLI |
| ink 的多文件创作 | 单文件编译已可用，文件级命名空间 / 聚合预算尚需设计 | 后续独立阶段，不在本轮隐式加入文件 IO |
| Yarn / Ren’Py 的翻译与稳定 line ID 目录 | 已有稳定 ID，尚无 locale / 占位符契约 | 后续先做作者目录，再单独验证运行时与已读策略 |
| 条件 / once / 禁用选项、call-return、扩展注册 | 改变执行、路线重放和存档验证范围 | 独立方案；保留当前 canonical replay，不引入任意回调或新 VM 指令 |

## 本轮语法与接口

```text
cue block start background classroom
cue block start music theme
cue line hello portrait student
cue line hello voice greeting
cue line hello sound bell
cue line hello pause 200
cue line hello effect fade 150
cue block ending music null
```

cue 明确指定 block 或 line 的稳定 ID，允许前向引用。background / portrait / cg / music / ambience 接受资源 ID 或未加引号的 null；sound / voice 只接受 ID；pause 为 0–30000 的整数，降为 pauseMs；effect 为 fade / flash / shake，时长可省略或为 0–2000 的整数。重复目标字段、未知目标、非法参数或无对白路由块上的一次性 cue 均拒绝。最多 30000 条 cue，可收紧预算。

第二阶段 `checkTextScriptProject` 只接受显式注入的 script 工程身份及 id/kind 资源目录，不读资源文件、不 fetch、不启动播放器。检查缺失 / 类型错误，返回同一 DSL code、ScriptProgram 相对 path、UTF-16 span 和候选 IR SourceOrigin；不为尚未应用的候选虚构当前工程 source SHA。实际文件 / 解码 / 内容审核沿用现有门禁。

CLI 增加可选 `--project`，Agent `script.compile` 增加可选 projectContext；不提供上下文时保留独立编译。Studio 始终以当前资源目录检查候选，目录或身份改变后重新检查，失败不应用、不替换原 JSON；应用仍为一次可撤销事务。

## 验收与交付

1. 与手写 IR、两条真实路线、replay / save / restore 等价；旧 DSL 继续通过。
2. 同一缺失语音 / 错误背景种类在纯 API、CLI、Agent、Studio 中给出相同 code/path/span；预算、分页、过期游标与只读边界不放宽。
3. 真实播放器验证图像、音频、暂停、选路、恢复 / 回滚的一次性效果规则；Studio 验证候选预览、资源变更、诊断定位、撤销及窄屏。
4. 独立玩家包排除编译器、上下文检查模块、文本与 source map，子目录和断网新页重开；Studio 包保留作者模块。
5. 运行 npm run check、完整浏览器 / 编辑器、四样例提交锁 QA，核对同一 SHA 的 Linux 和 Windows 原生 / 完整重启。既有本机四项 EPERM 不跳过、不降低断言，CI 补足完整核心。

实现与真实结果另见 [验证记录](VALIDATION-v1.3.0.md)。原创代码标记 new，既有来源保留；只吸收架构与作者工作流，不复制上游实现。
