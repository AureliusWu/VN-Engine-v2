# 接入与兼容

**执行边界（2026-10-25 用户指令）：先优化引擎。四作迁移留到最后，只有用户主动、明确提出后才执行。** 本文是兼容约束参考，不是已授权的实施计划；“继续推进”“最高权限”等不替代迁移指令。

v0.2 已补齐自研执行、调度、DOM、媒体与独立构建。四个正式游戏仍在原仓库运行，原剧情、公开发行和玩家数据未改写。新作品可以直接使用 mountGame；已有作品需要保留下面的身份与平台契约。

自研项目格式、Rain 自研 VM 入口与独立构建见 [SELF-RUNTIME.md](SELF-RUNTIME.md)。Rain 结构化文本可直接导入自研 VM；Ren’Py 二进制存档和 persistent 不会被自研运行时直接接受，两者需明确迁移桥。

## 新项目

构建后可用本地 `file:` 依赖或工作区依赖引用本仓库。npm 包还未发布。使用独立 game、storyVersion 和存储 namespace，原文数据从项目注入，UI 由项目实现。

```ts
import { createNetLoveEngine, createNetLoveSaveCodec, createStore } from '@aureliuswu/vn-engine-v2';
const engine = createNetLoveEngine(scenes);
const codec = createNetLoveSaveCodec(engine);
// 这里是独立技术样例键；正式接入时明确传入原游戏所需命名空间。
const store = createStore('my-demo:v1', storage, codec);
const state = engine.newGame();
store.write('auto', codec.encode(state));
```

上述命名适配器属于对应游戏协议。新原创游戏应直接使用 `NarrativeEngine` 并声明自己的身份，避免沿用别的游戏 game 值。

## 已有四作的后续接入

| 游戏 | 必须保留 | 已提供的入口 | 接入前还需验证 |
| --- | --- | --- | --- |
| Healing | `moist-healing`、`moist-healing-v1`、旧 `chapter1-v1` 仅第一章、`moist-healing:v1`、场景/行号/顺序 | `createHealingEngine`、`createHealingSaveCodec`、`healingPresentationAt` | 完整阅读备份、回忆证明、自动存档时机、React 交互与 Electron/PWA 实包 |
| NetLove | `netlove`、`netlove-v1`、`netlove:v1`、稳定台词 ID、medium/noSprite | `createNetLoveEngine`、`createNetLoveSaveCodec`、`netlovePresentationAt` | 聊天历史预览、原文与条件变体声音、完整备份与双端发行 |
| Circuit | 原 `circuit-*-v011/v100` 键、章节/证据 ID、v1/v2 与旧格式迁移 | `createCircuitEngine`、`decodeCircuitSave` | 原 v010 迁移仍留在源项目；完整 campaign/历史与声音证据；原生包 |
| Rain | Ren’Py save_directory/persistent/回滚、标签与台词 ID | Python 编译器与校验器 | 原生编译后 lint、实际平台交互、screens/transform/asset manifest 及旧档 |

原始 UI 使用函数导出；接入实例后应显式包一层函数转发，保留 `this`：

```ts
export const advance = (state) => engine.advance(state);
export const replay = (decisions, sceneId, line) => engine.replay(decisions, sceneId, line);
```

不要把未绑定的实例方法直接赋给按钮回调。核心没有全局单例，可以同时建立两个游戏实例。

## 存档保证与限制

校园/聊天的适配 codec 保留 schema 1 原生 envelope，从选择重建历史和数值；各作 codec 的 24 次选择上限与旧章范围保持原约定。校验失败不写入数据。存储 I/O 与解析分开注入，损坏与不可用会返回不同状态。

Circuit 桥接读取 v1/v2 envelope，对外部状态额外要求从章首真实可达。不能证明的状态会拒绝导入。新 campaign 核心要求完成前缀与单次可达的证据归档，可能拒绝旧存档中仅通过结构检查的拼接记录。它不会自动迁移或覆盖原键；源项目原迁移器保持权威。

新核心的批量写入会尝试回滚配额失败。存储也可能拒绝回滚，结果用 `rollbackFailed` 明示，调用方不能无条件提示“原数据完全保留”。

## 与原码再对照

准备与 provenance 中提交一致的四份只读源码，放为 `snapshots/Rain`、`snapshots/Healing`、`snapshots/NetLove`、`snapshots/Circuit`。源码副本不入本仓库。

```bash
npm run verify:upstream -- /path/to/snapshots --out=report.json
python -m tools.compare_rain /path/to/snapshots/Rain --out rain-report.json
```

比较器会执行显式提供的本地 TypeScript 原码，仅用于受信源码的开发验证。Circuit 的原美术装饰器在比较中替换为恒等函数，检查的是玩法状态；真实 UI 与素材必须另做回归。
