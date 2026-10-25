# 架构与接口

v0.1.0 把运行规则与宿主分开。TypeScript 核心导入时没有浏览器副作用，React、Electron、Tauri 与 DOM 界面均可在外部接入；音频类仅在构造和调用时使用浏览器能力。

## 分工

| 层 | 入口 | 责任 |
| --- | --- | --- |
| 剧情运行 | `NarrativeEngine` | `newGame/getScene/recordLine/advance/choose/continueStory/replay/reread` |
| 调查运行 | `InvestigationEngine` | `initial/actions/transition/explore/reachable/validateChapter` |
| 章节进度 | `InvestigationEngine` | `newCampaign/complete/startChapter/restoreCampaign/unlocked` |
| 数据适配 | `createHealingEngine/createNetLoveEngine/createCircuitEngine` | 保留各作的入口、数值、解析规则与原始形状 |
| 存档边界 | `createHealingSaveCodec/createNetLoveSaveCodec/decodeCircuitSave` | 验证身份与位置、路线重建、只读原生格式桥接 |
| 存储宿主 | `createStore/writeBatch` | 注入 StoragePort，区分 empty/invalid/unavailable，保留失败原件 |
| 表现重建 | `presentationAt/healingPresentationAt/netlovePresentationAt/cgAt` | 从原文前缀恢复人物、表情与事件图时机 |
| 媒体宿主 | `SceneLoop/RecordedVoice/voiceFor` | 缓存限额、取消、访问身份、播放生命周期、准确台词绑定 |
| 阅读宿主 | `canRead/canAutoAdvance/ReadingVisit` | 后台、面板、隐藏界面、手动暂停和自动推进条件 |
| 原生编译 | `python -m adapters.renpy` | Rain 格式校验与 DSL 输出，交给 Ren’Py 执行 |

## 状态权威

校园/聊天剧情的权威输入是原文图、位置和此前选择。数值、历史、条件对白与表情均能重建。`replay` 有步数预算，不执行存档中的脚本；`reread` 只接受当前合法路线已经读到的段落，并取到达目标所需的最短选择前缀。

旧 Healing 台词没有全部独立 ID。适配器保留原场景 ID + 行号，声音还需精确 speaker/text 校验；不得宣称重排文本后仍然兼容。新文本应显式写稳定的 `Line.id`，配音变体以 ID 与实际文本共同绑定。

调查状态为 `(chapterId, nodeId, evidence)`。搜索将证据排序后加入状态键，允许返回调查中心、改变证据后再次进入同一节点。构造时检查所有可达库存状态、证据门槛和可通关性；超过预算会报告未完成验证，不静默视为通过。

`isState` 只校验形状和节点约束；外部恢复必须使用 `reachable` 或 `restoreCampaign`，防止只满足局部门槛却无法从章首到达。章节完成需要标准结局、核心证据与合法完成前缀。新核心的 archive 保留单次可达库存，避免拼出互斥证据集合。

## 宿主责任

- UI 负责键盘、按钮、打字计时、全屏、无障碍和实际的画面渲染。阅读门控只提供判定；宿主计时器必须调用它。
- 宿主在换段、重新读入同一段或重读时生成新的 visit；把面板、document.visibilityState 等条件传给声音播放器。
- 音乐使用外部的 AudioContext 与 GainNode。`SceneLoop` 不创建全局音频上下文；销毁时调用 `dispose`。配音关闭或销毁时调用 `stop`。
- 资源路径由宿主按部署 base URL 解析。离线文件列表来自实际构建产物；存档不进入 SW 缓存。
- `tools/serve.mjs` 仅为本地样例服务器，绑定 127.0.0.1。正式网站、桌面封装、自动存档时机与发行脚本由各宿主决定。

## 原生 Ren’Py 边界

Python 适配器沿用 Rain 的 schema_version 1、`affection/trust/truth_known` 状态定义与 n/h/p 说话人约定，具有明确的 Rain 兼容范围。它保留原编译算法、分支回应、音频清单和稳定台词标识。宿主需要角色定义、ambient channel、`ending_card` screen；立绘还需要 `heroine_position` transform。最小样例不使用立绘资源。

Ren’Py 的 save_directory、persistent、回滚与平台运行仍由原生项目控制。Web 核心不解析 Ren’Py 存档。后续需要通用 Ren’Py 作者格式时，应单独版本化适配协议。
