# R4 计划 · 缺陷修复与 AI 模拟审阅

状态：**引擎实现 / 修复 / 技术验收已完成**。规划：2026-10-28；收尾：2026-10-29。当前版本：**0.8.0 alpha**。最终实现 b10feaeba17d605935c3721431b816c68c8880c4；完整证据见 [验证记录](VALIDATION-v0.8.0.md) 与 [问题关闭表](R4_BUGS.md)。实际 AI 审阅只完成已观察的正文 / 原图与部分画面，完整视觉、听感及实体设备仍按真实范围保留 UNVERIFIED，不冒充整个多模态演示已经通过。

用户本次要求：以修复为主，人工文案、美术和听感终审改为 AI 模拟人类审核，并查漏补缺。该要求更新后续内容终审规则；R1—R3 的历史验收保留原来的真实状态。

| 项目 | 基线与边界 |
| --- | --- |
| 仓库 / 分支 | AureliusWu/VN-Engine-v2 / main；保留远端前移，不强推 |
| 精确基线 | `230cc360a92c6d94c61b8910096771c588a5594f`，0.7.0 alpha |
| 本次实际检查 | 本地 `npm run check`：201 项 Node、6 项 Python、172 项来源及 schema / 四份工程校验通过 |
| 规划时已复现缺陷 | B001—B003 的历史未修状态见 [预检记录](r4-preflight.json)；最终 B001—B005 均已修复并验证，见 [问题关闭表](R4_BUGS.md) |
| 版本选择 | 虽以修复为主，内容验收策略和报告协议会增加显式能力，因此建议 0.8.0；实现时再统一 npm / 锁文件 / 引擎 / Windows / manifest |
| 本次交付 | 计划、已复现问题和验收标准；没有将新接口、AI 审阅或缺陷修复标记为已经上线 |

## 目标与完成结果

1. 文案、剧情、美术整合和听感的默认终审由 AI 模拟读者、视觉审阅者和听众完成。通过实际审核的当前内容，可以满足相应内容门禁，不再单纯因缺少真人签字而 BLOCKED。
2. 修复审核过期、母版继承和成品检查中的误报 PASS，并针对 R1—R3 的高风险边界查漏补缺。
3. 从 AI 提出问题、修复、复审，到真实技术回归和新包复核形成可复现流程。准确区分工程完成、内容审核、测试包生成和 GitHub Release 发布。

本轮不安排新叙事玩法、新渲染后端或大规模架构改写。仅修改引擎和独立样例；四作与 RESET 的剧情、素材、宿主、依赖和玩家数据不迁移。

## 已复现问题：本轮必须关闭

以下结果在基线提交编译后实际运行得到，使用 `tests/qa-fixture.mjs` 的合成夹具。它们证明检查链缺陷，不代表任何作品已经完成艺术或听感审核。

| 编号 | 复现与当前结果 | 修复要求 | 回归位置 |
| --- | --- | --- | --- |
| R4-B001 / P0 | `assessQaEvidence` 先返回 PASS；修改 `scenes[0].lines[0].text`，保留旧 qa 记录，仍返回 PASS | 内容验收绑定精确工程、审核策略和实际素材；源或素材变化后旧结果不能继续批准当前版本 | `src/compliance/qa.ts`、`src/creative/feedback.ts`、`tests/qa-report.test.mjs`、SDK / CLI / Studio |
| R4-B002 / P0 | Neutral 的 `runtimeSha256` 与清单不符；只引用 smile 差分时 release 与母版继承均 PASS，另把 Neutral 加入直接引用才 BLOCKED | 母版 / Neutral 的适用检查必须沿关联完整传播，不能依赖它是否直接出现在场景；失效、未知和失败均不能被差分 PASS 掩盖 | `src/compliance/art.ts`、`tests/art-gate.test.mjs`、实际文件与候选门禁 |
| R4-B003 / P0 | 真实生成包后删除 `app.mjs`，同时漏掉 manifest 中该条目；`buildQaReport(...).build.status` 仍 PASS | 检查必需启动文件、实际入口的本地依赖、工程引用的素材 / 许可及 PWA 文件；重新核对指纹，不能只遍历清单已有条目 | `tools/qa-report.mjs`、`tools/package-game.mjs`、`tests/qa-report.test.mjs`、离线成品回归 |

P0 在本文指数据损坏、错误放行 / 错报完成，以及阻断核心流程的问题；P1 为主要作者或玩家流程缺陷；P2 为不阻断的界面与诊断改进。新增发现先保留复现、影响和原字节，再确定优先级；检查清单中的风险不自动视为已经存在的 BUG。

### 可重复的最小复现

在本提交基线运行 `npm ci && npm run build` 后，于仓库根目录执行以下 JavaScript（`node --input-type=module`）。只使用临时文件，不修改作品或仓库工程。修复后，以下输出必须改变为保守拒绝 / 失败，并由正式回归断言覆盖。

```js
import { qaFixture, writeQaFixture } from './tests/qa-fixture.mjs';
import { assessQaEvidence, assessProductionArt } from './dist/index.js';
import { packageGame } from './tools/package-game.mjs';
import { buildQaReport } from './tools/qa-report.mjs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const p = qaFixture().project;
const before = assessQaEvidence(p).release;
p.scenes[0].lines[0].text = 'Rewritten content has not been reviewed.';
console.log('B001', before, assessQaEvidence(p).release); // 当前 PASS PASS

const q = qaFixture().project, review = q.releaseEvidence.art.room;
const masterSha256 = 'a'.repeat(64), sha256 = q.assets[0].sha256;
q.assets.push(
  { id: 'hero/neutral', kind: 'portrait', src: 'assets/neutral.svg', sha256, status: 'READY' },
  { id: 'hero/smile', kind: 'portrait', src: 'assets/smile.svg', sha256, status: 'READY' }
);
q.releaseEvidence.art['hero/neutral'] = { ...review, runtimeSha256: 'b'.repeat(64),
  masterSha256, characterMaster: { id: 'hero', role: 'neutral' } };
q.releaseEvidence.art['hero/smile'] = { ...review, masterSha256,
  characterMaster: { id: 'hero', role: 'variant' } };
q.releaseEvidence.characterMasters = { hero: { ...review, masterSha256,
  neutralAsset: 'hero/neutral', evidence: 'test://synthetic-master' } };
console.log('B002', assessProductionArt(q, ['room', 'hero/smile']).release,
  assessProductionArt(q, ['room', 'hero/smile', 'hero/neutral']).release);
// 当前 PASS BLOCKED

const root = await mkdtemp(join(tmpdir(), 'vn-r4-plan-'));
try {
  const f = qaFixture(), source = await writeQaFixture(root, f.project, f.picture);
  const output = join(root, 'game');
  process.env.VN_ENGINE_COMMIT = '230cc360a92c6d94c61b8910096771c588a5594f';
  await packageGame(source, output);
  const file = join(output, 'build-manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  await rm(join(output, 'app.mjs'));
  manifest.files = manifest.files.filter(entry => entry.name !== 'app.mjs');
  await writeFile(file, JSON.stringify(manifest));
  console.log('B003', (await buildQaReport(source, { buildDirectory: output })).build.status);
  // 当前 PASS；检查的是 build 子项，未请求解码的总报告并非 PASS
} finally {
  await rm(root, { recursive: true, force: true });
}
```

## A：AI 模拟人类审核与内容门禁

### 默认审核规则

| 范围 | AI 模拟审核内容 | 必须使用的输入 |
| --- | --- | --- |
| 剧情 / 文案 | 错字、标点、占位、人物口吻、前后逻辑、选择与回应、节奏和结局解释 | 当前正文与条件变体目录、角色 / 简报、真实路线记录；覆盖范围逐项列明 |
| 美术 | 角色身份、母版 / 差分一致性、构图、风格、场景适配、文字 / 按钮遮挡及可读性 | 实际图片、母版关联、真实运行截图和交互状态；1280px 与 390px、字号 / 高对比场景 |
| 听感 | 噪声、爆音、失真、截断、循环接缝、轨道音量关系、场景情绪、配音与实际文本匹配 | 实际音频或录制的混音、播放上下文、轨道配置和技术测量；明确全量 / 分段 / 抽样范围 |

正式名称使用 **AI 模拟审阅（ai-simulated）**，界面、CLI、报告和包身份保持一致。AI 通过可作为本轮内容终审的接受结果；保留人工补充意见的能力，但不再强制等待人工文案 / 美术 / 听感签字。

AI 必须查看实际正文、图片或音频。只读文件名、只看哈希、只测解码 / 波形 / 音量，不能产生相应艺术或听感 PASS。当前执行模型不支持某种模态、缺少文件、覆盖不完整、超时或工具失败时，对该范围输出 UNVERIFIED 并说明缺项，不能生成空泛的“模拟人类已通过”。采样审核不冒充全量审核。

使用显式调用的 AI 开发工作流导出审阅输入、执行多模态审阅并导入结果；不在运行时或 CI 的模块导入中调用模型。可使用当前开发环境提供的模型能力，不把外部账号或密钥配置变成本轮的必备条件。没有可执行的审阅能力时必须如实保留未审核状态。

### 审核数据与复审

- 新增独立 `acceptance.json`，拟定版本化契约 `vn-ai-acceptance-v1`，不将完整审核记录或模型输入装入玩家作品。复用 R3 的源哈希、实际文件哈希、目标定位、锁、回执、冲突和中断恢复原语。
- 记录 game、storyVersion、引擎身份、精确源字节 SHA256、实际素材 / 许可 SHA256、审核规则版本、模型 / 执行器身份、时间、输入清单与证据摘要哈希。可验证的是输入 / 记录绑定；模型身份的声明范围也须标明，不虚构认证。
- 每个适用类别分别给出 PASS / FAIL / UNVERIFIED、具体依据、定位、严重度、覆盖与未覆盖范围。不得通过平均分抵消一个未解决的阻断问题。
- AI 首审发现问题后，复用 `review.json` 的问题 / 修复 / 复验 / 重开流程关联处理；`addressed` 只表示已修复待审核，单个反馈 `verified` 或空反馈列表均不能直接批准整份作品。
- AI 复审必须读取修复后的实际输入并保留前后记录。源、素材、母版、主题 / 演出、审核规则或适用目标发生变化时，旧结果显示过期并退出当前放行依据。R4 先采用保守的整体源失效，不实现“只跑部分路线即可发布”。
- 验收数据独立保存，通过工具显式传入，避免把审核结果写回被哈希的工程而形成自引用。工程和审核文件分别原子写入，继续明确不存在跨文件数据库事务。
- 审阅通过只允许显式推进已审核的对应资源状态；不得一次把全部 DRAFT / PLACEHOLDER 改成 READY，也不得将技术解码成功写成艺术通过。

新增 SDK / CLI 操作的名称、schema、字节 / 操作 / 时间预算和错误码在实现提交中固定；未实现前不放入 capabilities。保持 vn-agent-v1 请求封套与既有调用可用，旧报告可以读取。新验收使用显式协议版本；旧 `humanQa` 字段只保留旧契约含义，AI 记录不伪装成真人记录。同步更新 `QA_REPORT.md`、`RELEASE_ART_GATE.md`、AI / 创作 / 迭代入口、Studio 文案和当前 Compliance 说明；历史验证不回填 PASS。

### 技术验收与发布状态

AI 模拟审阅替代上述内容终审；路线、存读档、文件哈希、解码、实际播放、Web/PWA 离线和 Windows 原生仍执行真实测试。AI 可以审读这些结果，不把未执行的平台测试补成通过。

| 状态 | R4 应表达的含义 |
| --- | --- |
| 引擎实现 / 技术回归 | 当前确切引擎提交的检查结果 |
| 内容终审 | 指定作品及输入版本的 AI 模拟审阅结果，独立列出适用类别 |
| 测试包 | 已生成并复核的可下载产物，附提交、版本、SHA256 与来源 |
| GitHub Release | 是否实际创建、tag / prerelease 与附件；不得由“构建成功”推断已发布 |
| 实体设备 | 只记录实际执行范围；390px 浏览器视口或 AI 判断仍是模拟 / 审阅证据 |

引擎 alpha 的完成与发布就绪不再由示例游戏的真人内容签字决定。具体作品的正式候选仍须满足所声明目标的文件、内容和技术要求；若声明实体手机验收，就保留实际设备检查，不伪造物理设备记录。本轮不把旧规范中要求“真人内容终审”的文字重新作为 AI 审阅的隐形阻断项。

## B：已复现 BUG 修复与检查链统一

1. 先为 B001—B003 建立能稳定复现的回归断言，再修复共享实现。保留“旧代码会失败、修复后通过”的证据。
2. `validateProjectCompliance`、QA_REPORT、SDK / CLI、Studio、正式打包与候选复核采用同一内容验收策略、适用性、过期规则与失败原因，避免一个入口 PASS、另一入口因缺少真人记录继续 BLOCKED。
3. 母版 / Neutral 的完整关联、清单哈希、实际字节、新 AI 审阅和当前范围共同决定差分有效性；另测母版缺失、DRAFT / PLACEHOLDER、失败与 UNVERIFIED 的传播。
4. 成品完整性必须校验清单漏列、重复、缺失、依赖、实际字节和身份。故意损坏启动文件、遗漏清单、替换同版本旧故事、漏掉许可 / 资源及旧指纹均不得 PASS；校验也不能覆盖或修补被检查的原包。
5. 文件失败不应被先遇到的内容审核失败遮蔽，报告保留全部独立项；当前可验证范围不足时明确 UNVERIFIED，不用成功退出码掩盖缺项。

## C：BUG 查漏补缺矩阵

以下是计划中的边界检查，不是预先认定的缺陷。复用现有测试和实际样例，只为尚未覆盖或已失败的边界增加有意义的回归。

| 区域 | 必查场景 | 验证方式 |
| --- | --- | --- |
| Agent / 文件 | 相同请求重试、重复 ID 不同输入、陈旧源 / 审阅哈希、写入前后进程死亡、恢复途中再次中断、文件被外部修改、预算 / 取消 | Node 真文件与实际子进程；Windows 路径 / 锁 / 进程复测 |
| Studio 审阅 | 首审→修复→复审→重开、换工程 / 改身份 / 关闭面板后的迟到结果、素材字节变化、撤销重做、草稿 / 文件重开、错误保留输入 | 真实 Chromium 控件与 WebView2；审阅状态与玩家字节分别检查 |
| 玩家存储 | 手动 / Quick / Auto / Continue、损坏 / 满额 / 不可用、备份确认前冲突、回滚失败、标题 / 新游戏 / 收藏 / 回看隔离 | 四驱动真实执行、逐步重建与存储字节比较 |
| 媒体 / 生命周期 | 连续换场、读档、回滚、跳过、隐藏 / 暂停、挂载 / dispose、自动播放拒绝、坏图 / 视频回退、试听离开后的释放 | 实际媒体与取消身份检查；不以静音夹具声称听感已审核 |
| 剧情 / 引用 | 条件变体、选择回应、派生 ID、Rain 原字段、跨章证据 / 重命名 / 删除、主题或资源变化使报告失效 | 完整 authored routes、结局覆盖与原有 R1—R3 回归 |
| 布局 / 输入 | 390px、1280px、字号 160%、高对比、长中文 / 长标题、嵌套弹层、键盘焦点、中文字体覆盖 | 实际截图、控件操作和 AI 视觉审阅；不只检查页面无横向滚动 |
| 打包 / 离线 | 子目录、更新缓存、断网新页、独立 Studio / 作品、作者审阅不进入作品、清单与实际文件一致 | 对生成产物执行真实浏览器启动、离线重开及哈希检查 |

优先处理 P0 / P1；P2 只做与复现直接相关的修正。无法复现的疑点留在问题表并写明条件，不为扩大本轮而重构。每个确认 BUG 都记录：编号、基线、步骤、预期 / 实际、影响、修复提交、回归命令与最终状态。

## D：验收、版本与交付

按 A → B → C → D 小步提交。共享构建目录的检查顺序执行，不并行争用 dist。每阶段先检查，再提交 main，保留远端新增提交。

| 阶段 | 退出条件 |
| --- | --- |
| A：AI 内容审阅 | 真正的正文 / 图像 / 音频输入→AI 问题与依据→修复→新版本复审；有源绑定、覆盖与模态不足拒绝；文案 / 美术 / 听感通过不再要求真人签字 |
| B：已知缺陷 | B001—B003 的回归在旧实现复现，在新实现通过；各入口报告一致，失败保留原数据 |
| C：查漏补缺 | 矩阵执行范围可追溯；本轮确认的 P0 / P1 关闭，P2 或未执行项逐项列出，不宣称零 BUG |
| D：跨平台交付 | 确切提交的核心、完整浏览器 / Studio、原生与离线通过，版本统一，文档和问题记录完整；包状态和 Release 状态明确 |

必需技术检查：

- `npm run check`、`npm run test:browser`、`npm run test:editor`，现有 R1 / R2 / R3 SDK / CLI 流程、四模板 / Rain、四份独立样例的完整路线及存读档回归。
- 新审核协议 / 旧格式兼容、源 / 素材 / 规则 / 目标过期、合成测试夹具与实际 AI 审阅明确分开；缺模态、损坏媒体、缺失审核、不完整覆盖及预算耗尽均有负向用例。
- Windows 工作流真实 CLI / 文件桥 / WebView2、外部冲突与完整进程重启；系统对话框 CI 预设路径照实记录。
- 最新生成的独立作品与 Studio 的启动、子目录和离线新页重开；新包不能夹带作者问题、验收明细或模型输入。
- 0.8.0 的 npm / 锁文件 / ENGINE_VERSION / Windows / build manifest 一致；代码变更更新 provenance。新增验证文档与机器记录绑定真实实现提交，不套用 R3 数量与结果。

用可审阅的 0.8.0 alpha 产物、准确问题关闭表、AI 审阅证据摘要和 Release 说明准备稿收尾。仅本次规划不创建 GitHub Release，也不把规划当成修复或审核已执行；实际发布状态在实施收尾中单列。R4 完成后停止，不自动开启下一轮。

## 规划时预检的边界（2026-10-28 历史记录）

本次实际执行了核心检查和三个最小复现；没有重新执行完整浏览器、AI 多模态终审或 Windows 原生。R3 的最终 CI 仅作为旧基线来源，见 [R3 验证](VALIDATION-v0.7.0.md)。`r4-preflight.json` 是规划证据，不是 R4 验收报告。当前三个缺陷均保持 CONFIRMED_UNFIXED。
