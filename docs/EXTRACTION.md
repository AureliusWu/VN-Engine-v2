# 抽取范围与来源

基线：2026-10-25。四个源仓库在本次工作中只读；使用精确提交的副本，未读取或改写源仓库的未提交修改。

| 项目 | 已识别的技术与玩法 | 本轮抽取 | 继续留在源项目 |
| --- | --- | --- | --- |
| [Rain](https://github.com/AureliusWu/Rain)《雨停之前》 | Ren’Py 8.5.3；结构化 JSON 编译为标准 DSL；选择与条件结局；官方 WASM PWA | 原生故事校验/状态路线枚举、编译器、共用静态图契约 | screens、美术演出、persistent、原生存档/回滚、SDK 与发行工具 |
| [Healing](https://github.com/AureliusWu/Healing)《湿性愈合》 | React/TS/Vite；章节 TS；校园 VN；PWA/Electron | 段落/选择、数值结局、跨章桥接、replay/reread、表现重建、CG 触发、搜索和存档失败经验 | 三章正文、人物/插图、阅读 UI、具体场景音乐与打包 |
| [NetLove](https://github.com/AureliusWu/NetLove)《“网”恋》 | React/TS/Vite；单一 story.json；聊天/通话与线下关系 | JSON 场景运行、条件对白、noSprite、独立存档、音乐/配音生命周期、PWA 工具 | 人物关系、聊天视觉设计、原作语音与美术、Electron 发行 |
| [Circuit](https://github.com/AureliusWu/Circuit)《回路》 | React/TS/Vite/PWA/Tauri；按章调查、证据、推理、失败重试 | 注入式调查状态机、库存联合遍历、热点检查、章节进度、原生存档只读桥接 | 章节正文、声音证据录音、通讯/资料呈现、人物与场景资源、正式存档键 |

源提交与逐文件 SHA-256 见 [provenance.json](provenance.json)。当前 Circuit 快照包含 11 章；部分旧文档仍写 10 章，本次行为对照以快照实际代码为准，不据此判断剧情创作质量。

## 抽取方式

- `verbatim`：音乐 SceneLoop、RecordedVoice、历史搜索、PWA 指纹/worker、共用图契约、Rain story_model。保持原代码并用来源哈希验证。
- `adapted`：移除对固定正文、人物枚举和全局 localStorage 的依赖，变为注入式实例；保留原运行顺序并对照原码。
- `new`：对外导出、宿主门控、最小样例、测试/比较工具、来源检查与文档。没有把新设计写成已存在的原项目能力。

本轮没有搬入四作全部正文、美术、配音、BGM、API 凭证或成品。独立技术样例的文本仅用于展示接口，不扩充原作设定。音乐/配音类的生命周期测试使用替身；浏览器样例没有假装播放正式角色素材。

视频测试使用本仓库以 `tools/generate-runtime-video.py` 和 FFmpeg/libvpx 合成的两秒无声纯色 WebM；它仅用于检验媒体生命周期，不是作品正式美术或发行素材。实际字节 SHA256 记录于来源清单。

字体样例来自 Rain 的 SourceHanSansLite，按演示文字重新子集化并改名 VN Demo Sans，保留 OFL。重建脚本为 `tools/subset_demo_font.py`，需要可选的 fonttools/woff2 支持与源字体；日常构建直接使用已保存的子集文件。

## 结构验证的实际范围

共用静态图检查面向有向无环的场景叙事，识别重名、断链、孤立场景与误循环。《回路》必须使用自己的库存状态搜索，不能拿静态图检查代替。Rain 使用原生条件与状态枚举。路线与图检查均不能代替逻辑、人物口吻、美术质量和听感审读。

## v0.2 自研扩展

新增 ScriptEngine、RuntimeSession、DOMRenderer、MediaDirector、资源清单与独立作品构建均在本仓库实现。Rain 格式转入自研执行块，保留原行与选择回应，执行无需 Ren’Py。旧 SDK 编译路径仅作兼容。新样例 SVG/合成测试音有独立用途，不计入四作正式素材完成度。

## R4 离线适配

tools/pwa.mjs 为独立 Studio 增加导航壳和精确文档优先参数，由 verbatim 改为 adapted，保留原提交与来源哈希；游戏默认策略继续回归。Studio 字体沿用固定 Rain 字体字节与 OFL，按新增 AI 审阅界面重建子集。
