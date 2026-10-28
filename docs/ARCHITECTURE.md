# 架构与接口

v0.4.0 主链由本仓库自研模块承担。解释器/状态机 → 玩法驱动 → 播放调度 → DOM/媒体宿主 → 独立离线构建，均能在没有外部游戏引擎的情况下工作。

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
