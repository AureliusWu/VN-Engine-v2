# 自研运行时 0.2.1

主运行链为本仓库自己的 TypeScript 解释器/状态机、调度器、DOM 渲染器、输入控制、媒体调度和打包器。它直接在浏览器中执行本地项目数据，不加载 Ren’Py、Unity、Godot、外部 VN 框架或在线服务。React/Electron/Tauri 均不是主链依赖。

## 运行与打包

```bash
npm ci
npm run demo
```

访问 `http://127.0.0.1:4173/engine/`。原 0.1 技术检查页仍在 `/`，自研播放器入口在 `/engine/`。

四份独立项目位于 `examples/runtime/{campus,netlove,circuit,rain}.json`。用以下命令生成可独立部署、可离线运行的作品目录：

```bash
npm run build:game -- examples/runtime/rain.json build/my-game
python -m http.server 8000 --directory build/my-game
```

输出目录必须新建或为空，已有文件会被保留并拒绝覆盖。打包包括自己的运行模块、项目数据、实际媒体、字体许可、PWA manifest、按文件指纹生成的 worker 与 `build-manifest.json`。无需 SDK 下载或四作原仓库。用 HTTP/HTTPS 打开；本地双击 file:// 不具备 service worker 与模块 fetch 所需环境。

## 最小接入

```ts
import { mountGame } from '@aureliuswu/vn-engine-v2';
const game = mountGame(document.getElementById('game')!, project, {
  baseURL: new URL('./', location.href), storage: localStorage
});
// 页面或路由实际卸载时释放计时器、DOM、声音与资源请求。
game.dispose();
```

`mountGame` 只在调用时接触浏览器；导入模块没有 DOM、localStorage 或 AudioContext 副作用。也可只使用 `createProject`/`RuntimeSession`，由其他宿主自行绘制。

## 项目与驱动

| `project.type` | 自研驱动 | 作者数据 |
| --- | --- | --- |
| `narrative` | `NarrativeDriver` + `NarrativeEngine` | 段落/选项/条件文本，可选择 Healing/NetLove 的已有规则 |
| `script` | `ScriptDriver` + `ScriptEngine` | 显式变量、剧本块、跳转、选择、条件路由与结局 |
| `rain` | `compileRainProgram` → `ScriptEngine` | Rain schema 1 数据直接转入自研 VM，保留选择回应 |
| `investigation` | `InvestigationDriver` + `InvestigationEngine` | 章节、节点、动作、证据、热点、推理与重试 |

所有项目显式声明 `schema:1/game/version/title/assets`。样例采用 `vn-self-*` 身份。游戏身份和版本进入存档 envelope，不接受另一个游戏的进度；原四作的存档键未被修改。

## 数据解释器

`ScriptProgram` 包含数值/布尔变量和 `ScriptBlock`。出口只有四种指令：

| 指令 | 作用 |
| --- | --- |
| `jump` | 进入声明的剧本块 |
| `choice` | 等待明确选择，应用 `add` 或 `set`，再跳转 |
| `branch` | 按顺序检查 `eq/gte`，必须有末尾无条件回退 |
| `end` | 停留在结局，保留最后段落 |

无对白的逻辑块由 VM 消化，不会凭空增加一页文字。选择后回应被编成带稳定台词 ID 的独立块，播放完再进入原目标。逻辑循环、未知变量/指令、类型错误、越界数值、重名与断链都会拒绝；执行和重放均有预算。作者 JSON 不会转换为可执行 JavaScript。

存档只保存位置与之前选择。变量、历史与持续画面状态由重放推导；导入的派生值不构成权威。调查驱动另用动作日志重放取证、失败重试与跨章行为，不给调查强加线性快进或随意回跳。

## 演出与媒体

`StageCue` 支持 background/portrait/cg、music/ambience、voice/sound、fade/flash/shake、pauseMs 和调查文书。背景、人物、CG 与背景音是持续状态；动作音效、闪白等是本次访问的一次性事件。读档与历史重读重建画面，不补播旧动作音效或震屏；当前段落的语音可重新开始。

`RuntimeSession` 用 Unicode grapheme 逐字显示。内置宿主使用不可变的 `getView()` 共享 frame；`getSnapshot()` 保留独立可修改副本的兼容约定。点击先补全当前句，再推进；剧情停顿、后台、面板、隐藏界面、语音等待和选择门槛分别参与调度。自动阅读不会替人选选项；已读快进按台词 ID 加实际文本识别，遇到未读或选择即停止。同段落重新读档也产生新 visit，迟到的旧事件不能接管新画面。

图片用请求身份隔离迟到回调。缺图或声音失败保留可阅读状态。播放器首次交互后才建立音频上下文；关闭音乐会取消不需要的音乐下载。销毁时取消计时器、动画、订阅、下载和声音。

## 资源与界面

`AssetCatalog` 使用 ID 与相对路径。打包器检查真实文件、可选 SHA-256、输出冲突与离开项目目录的符号链接；所有实际输出都记入哈希清单。字体需要附自己的许可记录。自研样例的 SVG 和测试音由代码生成，仅验证能力，不冒充正式角色差分、CG 或配音。

DOM 宿主包括阅读层、聊天气泡、通话视图、调查文书/热点、证据簿、历史搜索与重读、设置、存读档、导入导出、全屏和触控按钮。使用原生语义按钮、键盘焦点与弹层焦点约束。输入框内的文字和快捷键不会推进剧情；减少动态效果与透明度可调整。

`mountGame` 将 v2 存档绑定到播放器：六个手动槽显示时间、版本、场景和段落；覆盖已有或损坏的槽需要确认。工具栏提供快速存档和快速读档，焦点在播放器且不处于弹层、输入或暂停时可用 F5 / F9；每次进入新段落自动写入独立自动槽。读档面板可读取自动槽，也可在存在旧版 `vn-engine:<game>:save:1` 时读取旧单槽；旧数据不会被自动覆盖。存档损坏、存储不可用或恢复失败时保留原记录。截图缩略图暂未实现。

作品可以声明 `collections: { cgs: [{ id, title?, replay? }], endings: [{ id, title?, trueEnding?, replay? }] }`。CG 的 `id` 必须指向 CG 资源，结局 `id` 与实际结局 ID 一致；没有声明时不显示对应入口。`replay` 可填写由同一作品、版本和引擎驱动生成的 `session.save()` 数据；缺少回看数据时只展示已解锁项目。锁定条目不显示标题或图像，也不创建图片元素，但作品包中的资源本身并非加密保护。回看创建独立引擎会话，不订阅普通自动存档或 Meta 更新；返回、Escape 和销毁都会清理该会话并回到收藏页或原剧情。无效回看数据会报错且保留原进度。回看数据仍应由作品维护并在故事或版本变化时重新验证。

Studio 的“收藏与解锁”面板可配置条目、标记真结局，并将当前真实预览位置保存为回看起点。可声明 `collections.trueRoute: { endings?: string[], cgs?: string[], minPlaythroughs?: number }`；全部条件满足才把独立 Meta 的 `true_route_unlocked` 设为 true，普通读档不会撤销该解锁。规则不修改剧情变量，作品需显式消费这一跨周目状态；隔离回看不累计解锁条件或完成周目。无效或其他作品 / 版本的回看起点会阻止作者导出与项目校验。

演出 cue 可用 `layers` 为 `background / character-back / character / character-front / cg` 声明 `{ asset, kind }`，对应层可设为 `null` 清除；旧 `background / portrait / cg` 仍映射到对应图层。`timeline` 使用 `animations` 与 `camera` 数据：位移单位为 CSS 像素，支持延时、时长、缩放和透明度；`target` 如填写，必须匹配该视觉层实际资源 ID，effect / ui 轨道作用于整层。镜头只作用于视觉画布，不移动对白和选项。画面暂停、隐藏和后台会暂停轨道；跳过、减少动态或读档时收敛到终态，并可在后续段落重建此前终态。Studio 提供图层、轨道和镜头关键帧控件，实际构图仍需人工验收。

`video: { asset, muted?, loop?, fallback?: { asset, kind } }` 使用本地视频资源；回退资源为 CG 或背景。默认静音，显式设置 `muted: false` 时跟随音量设置并受浏览器自动播放策略限制。播放失败、格式不支持或自动播放被拒绝时显示回退并允许剧情继续；减少动态、跳过及从该段读档时使用回退画面。隐藏、后台和原生宿主暂停会暂停视频，退出场景或销毁会清理播放器。视频与剧情并行，不等待视频结束才允许继续。支持格式取决于实际浏览器 / WebView2 和设备，作品需用目标设备验证。

## 当前边界

这是能独立执行与打包的自研叙事引擎 alpha。尚未提供可视化编辑器、复杂场景动画轨道、3D/物理/战斗、Windows 原生宿主和兼容 Ren’Py 二进制存档的迁移器。四作仍在原仓库运行。当前只优化引擎；迁移留到最后，必须等待用户主动、明确提出后才执行。

## 0.3 作者与桌面入口

Studio 直接维护 EngineProject，预览共用 createProject/mountGame，见 [EDITOR.md](EDITOR.md)。mountGame 可注入 assetURL 将已授权本地文件映射到临时 blob 或本地来源；默认目录 URL 和清单验证保持不变。宿主的 `vn-engine-host-visibility` 事件以布尔 hidden 状态门控同一会话，销毁会移除监听。Windows 原生窗口与受限文件桥见 [WINDOWS.md](WINDOWS.md)。游戏独立构建不带作者模块。
