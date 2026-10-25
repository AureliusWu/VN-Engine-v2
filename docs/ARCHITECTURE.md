# 架构与接口

v0.2 主链由本仓库自研模块承担。解释器/状态机 → 玩法驱动 → 播放调度 → DOM/媒体宿主 → 独立离线构建，均能在没有外部游戏引擎的情况下工作。

| 层 | 入口 | 责任 |
| --- | --- | --- |
| 作者数据 | EngineProject / ScriptProgram | 显式身份、版本、玩法、变量、剧本与资源 |
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

DOMRenderer 消费快照，不计算路线。图片请求与动画绑定当前访问；聊天和通话使用自己的呈现，调查热点只关联当前可用动作。弹层搜索输入不触发阅读快捷键，焦点在弹层内受约束。错误资源与不可用存储保留可阅读状态。

MediaDirector 消费 visit 和阅读条件，使用注入的 AudioContext/Audio 工厂。首次浏览器交互后由 mountGame 建立上下文；单次音效不随每个打字 tick 重放，读档/重读也不补播。dispose 清理订阅、计时器、图片探测、音乐下载和播放对象。

## 构建与平台

普通模块导入没有 DOM/存储/音频副作用；框架宿主可以只用 createProject + RuntimeSession，也可直接 mountGame。作品构建使用明确相对资源、本地许可和实际字节指纹；lib 与资源都在部署作用域内，独立产物在子目录断网重载经过浏览器测试。

浏览器 Web/PWA 是本轮实际平台。Electron/Tauri/原生 Windows 宿主、可视化编辑器、复杂动画轨道和其他渲染后端尚未验收。

详细数据和调用约定见 [自研运行时](SELF-RUNTIME.md)；原四作的正式迁移见 [接入与兼容](MIGRATION.md)。
