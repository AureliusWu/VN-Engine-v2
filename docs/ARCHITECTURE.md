# 架构与接口

## v1.3.0 作者演出前端

script/text.ts 将显式 cue block / cue line 编译为已有 StageCue，保留原 VM、路由与存档。script/text/project.ts 是可选纯清单检查，核对身份、资源 ID / kind，返回 DSL 范围和候选来源，不读取文件或启动设备。Studio、Agent、CLI 复用两阶段接口；玩家包按已有作者模块边界排除 text.js 与 text/ 目录，Studio 包保留它们。参考取舍与边界见 [P3 契约](P3_DEVELOPMENT.md)。

## v1.2.2 缓存身份与模块归属

SceneLoop 的稳定缓存身份与临时读取 URL 分开，MediaDirector 为 BGM / 环境音使用 AssetCatalog.sourceURL；既有两参数 select 调用继续以 URL 为身份。Blob 仍按消费者生命周期撤销，不延长 speculative URL 生命周期，解码缓存仍独立受两曲 / 32 MiB 限制。

tools/compiled-modules.mjs 从当前 src 的非声明 TypeScript 模块映射到必需 dist JS，玩家保留作者模块排除，Studio 保留作者模块；两类打包和玩家 QA 共用集合。清单不遍历 / 清理 dist 遗留项，也不证明编译新鲜度。JSON IR 与存档不变。

## v1.2.0 P1 资源与作者前端

assets/plan.ts 提供有界只读资源计划，assets/prefetch.ts 独立管理编码字节与取消；mount 以显式 opt-in 将缓存接入 AssetCatalog，不更改 driver / replay / save。script/text.ts 是可选纯编译器，只输出已有 ScriptProgram 与独立 source map，独立玩家包排除该作者模块。Studio 与 Agent 共用两者，预算、语法和边界见 [P1 约定](P1_DEVELOPMENT.md)。

## v1.1.0 P0 内建语义与运行证据

runtime/semantics.ts 是冻结的内建政策目录，区分脚本出口、玩家操作和舞台 cue，不接受项目 handler，也不替代现有 validator。runtime/evidence.ts 提供可选有界 pull/drain buffer；Session、音频与 DOM 宿主写入捕获的访问 / 尝试身份，不同步调用外部消费者。

source/origin.ts 为同一工程版本建立稳定 ID / JSON path 索引；evidence-report.ts 读取数据、限制预算并重新核对来源。当前 source SHA 才允许定位；过期或未绑定报告移除可点击路径。报告是外部声明，不能成为存档权威或自动验收 PASS。Studio 与 Agent 复用这些模块，具体接口与范围见 [P0 约定](P0_DEVELOPMENT.md)。

v1.0.0 主链由本仓库自研模块承担。解释器/状态机 → 玩法驱动 → 播放调度 → DOM/媒体宿主 → 独立离线构建，均能在没有外部游戏引擎的情况下工作。

| 层 | 入口 | 责任 |
| --- | --- | --- |
| 作者工具 | EditorModel / Studio | 变量 / 章节工作台、类型化效果与条件、原子引用命令、图、诊断、草稿、同一运行时预览与数据导出 |
| Windows 宿主 | hosts/windows | 原生窗口与受限文件桥、本地内容、作品校验、配置持久化和生命周期 |
| 作者数据 | EngineProject / ScriptProgram | 显式身份、版本、玩法、变量、剧本与资源 |
| 路线回归 | runRouteSuite / createRouteRecorder | 真实开场操作、受限步骤、状态断言、存读档与声明结局覆盖；Studio Worker 隔离，正式 QA 门禁阻断缺项 |
| 自研解释器 | ScriptEngine | 数据指令、条件、赋值/累加、回应、隐藏逻辑块、结局与重放 |
| 自研状态机 | NarrativeEngine / InvestigationEngine | 段落与路线；调查循环、证据与章节 |
| 玩法驱动 | NarrativeDriver / ScriptDriver / InvestigationDriver | 统一 frame/action/history 接口，分别保留不同机制 |
| 调度器 | RuntimeSession | Grapheme 打字、停顿、暂停作用域、自动、已读快进、visit 身份 |
| 自研 DOM 宿主 | DOMRenderer / mountGame | 实际图层、聊天/通话、调查、键盘/触控、弹层、存读档与设置 |
| 媒体宿主 | MediaDirector / SceneLoop / RecordedVoice | 访问隔离、音乐取消/缓存、语音等待、一次性音效与暂停恢复 |
| 资源 | AssetCatalog | 角色/背景/CG/音频/字体 ID、部署 base 和本地资源路径 |
| 作品打包 | tools/package-game.mjs | 自己的运行模块、原文、资源、许可、哈希与作用域离线包 |
| 兼容入口 | adapters/{healing,netlove,circuit,rain-runtime} | 四作已有数据规则与身份边界 |
| 原生历史工具 | adapters/renpy | 保留 Rain → Ren’Py DSL 的已有开发/兼容路径，不参与自研主链 |

## 状态权威

校园/聊天保存原文位置和先前选择，数值、历史、条件文本与表情可重建。旧 Healing 仍以场景/行号绑定，重排需要迁移。新作品建议使用独立 Line.id。声音变体还需实际 speaker/text 匹配。

ScriptEngine 的数值和布尔变量有声明和边界，指令仅 jump/choice/branch/end；不执行任意代码。选择回应保留稳定台词 ID，隐藏路由不会增加虚构对白。持续图层随合法执行重建，一次性事件绑定 visit，读档不补播过去的动作。

调查状态使用节点与证据集合联合验证，允许有意义的调查循环。RuntimeDriver 的存档保存实际动作日志，恢复重新执行取证、推理、重试与跨章动作；无法通过注入 completed 或 evidence 跳过门槛。已有 Circuit 原生 envelope 的只读桥接仍单独保留。

## 调度与宿主

RuntimeSession 无 DOM 依赖，可注入 Clock。打字、停顿和自动剩余时间有独立状态；后台、面板、隐藏和语音分别参与门控。取消或读档递增 generation，同一段重新访问也递增 visit。已读以台词 ID + 实际文本判断，快进不跨未读和选项；调查不启用线性快进。

DOMRenderer 与媒体宿主消费缓存的只读视图，不计算路线。frame 按访问冻结并共享，文字逐字累积；公共 getSnapshot 仍返回独立副本。聊天更新复用消息节点并保留上翻位置。图片请求与动画绑定当前访问；聊天和通话使用自己的呈现，调查热点只关联当前可用动作。弹层搜索输入不触发阅读快捷键，焦点在弹层内受约束。错误资源与不可用存储保留可阅读状态。

MediaDirector 消费 visit 和阅读条件，使用注入的 AudioContext/Audio 工厂。首次浏览器交互后由 mountGame 建立上下文；单次音效不随每个打字 tick 重放，读档/重读也不补播。dispose 清理订阅、计时器、图片探测、音乐下载和播放对象。

## 构建与平台

普通模块导入没有 DOM/存储/音频副作用；框架宿主可以只用 createProject + RuntimeSession，也可直接 mountGame。作品构建使用明确相对资源、本地许可和实际字节指纹；lib 与资源都在部署作用域内，独立产物在子目录断网重载经过浏览器测试。

浏览器 Web/PWA 与 Studio 使用相同自研执行链。DOM 执行正式视觉图层、动画轨道与镜头关键帧，Studio 控件直接编写同一演出数据。Windows 提供 WinForms/WebView2 宿主与原生工作流，原生实际验收状态单列记录；其他渲染后端仍待实现。作者工具只处理 JSON 数据，Windows 文件桥只在编辑器来源开放，作品窗口关闭原生桥。

0.2.1 的异步音频状态串行协调、演出暂停、失败清理和性能范围见 [优化记录](OPTIMIZATION-0.2.1.md)。当前只优化引擎；四作迁移仅在用户主动提出后执行。

详细数据和调用约定见 [自研运行时](SELF-RUNTIME.md)；原四作的正式迁移见 [接入与兼容](MIGRATION.md)。

## R1 AI 开发入口（0.5.0）

`src/agent` 定义 vn-agent-v1 schema 与纯数据 SDK，复用 EditorModel、RuntimeSession、runRouteSuite 和 compliance。`tools/agent-node.mjs` 注入本地资源、事务日志与真实 preview / package 端口，CLI 使用相同 Worker 入口；纯模块导入不访问设备。预览使用同一 createProject / DOMRenderer，沿作者路线从真实入口执行，逐步存档重建由现有回归器核对。独立作品排除 agent / editor 模块，Studio 仍复用作者与运行核心。详见 [AI 开发约定](AI_DEVELOPMENT.md)。

## R2 内容生产扩展（0.6.0）

`src/creative` 定义 vn-creative-v1 生产模型 / schema 与机械审查，`src/ui` 只接受有限主题令牌，`src/schema` 提供共享数据校验。production / UI 随同一 EngineProject 保留；制作数据不改变玩家状态和存档权威。`tools/agent-probe.mjs` 在显式调用时使用隔离 Chromium 解码；`tools/agent-imports.mjs` 发布不可变资源，文件 SDK 保留回执并最后原子替换工程。外部生成器不嵌入引擎，模块导入不执行设备或网络 IO。独立构建、Studio 和 Agent 均复用同一 DOM / 媒体链，见 [创作约定](CREATIVE_DEVELOPMENT.md)。

## R3 迭代与独立审阅（0.7.0）

creative/content.ts 共享字段 / 静态 cue，impact.ts 分开直接变动、资源消费者 / 依赖任务与未知范围，仍要求完整路线。feedback.ts 定义版本化文档、精确源 / 文件身份、历史与过期判断。Node 的 feedback-node.mjs 复用工程文件原语，两个文件分别提交，不虚构数据库事务。

Studio production.mjs 在隔离 EditorModel 上复用作者操作和最终校验，单次可撤销提交；反馈独立维护。媒体 / FontFace 由取消身份约束，离开 / 隐藏 / 换项目 / dispose 清理。原生新命令仍限可信顶层，文件有外部修改检测。见 [R3 约定](ITERATION_DEVELOPMENT.md)。

## R4 实际输入与 AI 终审（0.8.0）

compliance/acceptance.ts 定义独立 vn-ai-acceptance-v1 与审核策略。宿主注入源 / 素材 / 证据读取，SDK 与 CLI、Studio、Windows、QA_REPORT、正式校验和打包共用同一过期与适用性判断；模型调用只发生在显式开发工作流，运行时与模块导入不调用模型。Node 先规范化工程目录，再检查素材边界，目录别名不等于允许外部素材。

qa-report.mjs 复核完整构建身份、文件、模块、实际 HTML 入口 / CSS / PWA 依赖与当前生成的离线 worker。acceptance 文件、反馈、回执和审阅输入不进入玩家作品。Studio 离线 worker 保留 preview.html 的文档身份，并能在子目录断网新页打开实际预览。详见 [AI 终审](AI_ACCEPTANCE.md) 和 [R4 验证](VALIDATION-v0.8.0.md)。

## R5 作者输入与生命周期（0.8.1）

Studio 的 operations.mjs 独立管理未提交字段及异步工程打开代次，界面在保存前提交队列，等待期间的新编辑使旧打开失效。review-draft.mjs 只处理作者本地表单草稿的白名单、作品 / 审阅身份和问题签名；这些数据不进入运行工程或玩家存档。终审核对与文档打开分别管理请求身份。

DOM 动作区重建只恢复原本属于动作区的焦点；媒体宿主记录当前 SE 的暂停意图并续播同一实例，不更改剧情或一次性访问语义。实际范围见 [R5 验证](VALIDATION-v0.8.1.md)。

## R6 编辑与输出边界（0.8.2）

JSON 面板仅在真正进入时初始化；同页签保持原始输入，明确丢弃时同步持久化作者草稿。隐藏 / 恢复仅迁移即将隐藏的自有焦点；允许的新 visit 动作音效可以等待暂停结束，消费后不会重新登记。

tools/package-output.mjs 为游戏与 Studio 共用输出路径及发布策略：全表检查大小写与每级文件 / 目录冲突，完整字节先写独占同级暂存目录，复核新 / 空目标与可见链接后发布。空目标的 rmdir → rename 存在短窗口；这不是针对恶意并发替换 OS 祖先的沙箱。失败不递归删除目标，暂存清理只处理本次身份与内容仍相同的文件及空目录。实际范围见 [R6 计划](R6_PLAN.md)。

## v1.0.0 兼容与状态保护

editor/async-operation.mjs 提供请求序号和捕获上下文的独立策略，审阅打开与目录绑定同时受工作区模型 / 编辑版本约束；审阅保存基线只取实际快照，并由审阅文档代次隔离。真实 Windows 宿主仍同步处理文件命令并拒绝 busy 重入，受控桥应答顺序测试与物理 IO 验证分开记录。

存储契约在迁移 / decode 后核对 envelope.slot 与读取 key，portable decode 本身不绑定目标；非法槽位不写回或移动会话。DOM 在覆盖确认的创建 / 取消间维持有效焦点，以用户设置和系统减少动态偏好的并集约束演出；失败图片 probe 撤销，下一次真实访问才重试。1.x 公开入口和格式边界见 [兼容约定](V1_COMPATIBILITY.md)。
