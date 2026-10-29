# AI 开发接口 · v0.8.0

> R4 政策更新：文案、美术和听感终审改为有实际输入绑定的 AI 模拟审核；技术与实体设备检查保留。当前接口见 [AI_ACCEPTANCE.md](AI_ACCEPTANCE.md)。以下旧人工声明属于旧契约 / 历史范围，不再单独批准当前内容。

开发 Agent 是 SDK / CLI 的主要使用者；人提出创作要求、试玩、审阅与修正。Studio 继续打开相同工程。本地依赖 Node 22+；预览需要 Playwright Chromium。仓库为 public，本轮没有发布 npm 包或远程 HTTP / MCP 服务。

新增的 vn-creative-v1 创作上下文、素材探测 / 导入、主题和机械审查见 [R2 内容生产约定](CREATIVE_DEVELOPMENT.md)；R1 调用继续兼容。R3 content / impact / 独立反馈见 [迭代与审阅约定](ITERATION_DEVELOPMENT.md)。

```sh
npm ci
npm run build
npx playwright install chromium
npm run --silent agent -- capabilities
npm run --silent agent -- capabilities --params='{"schema":"request"}'
```

机器调用使用 `node tools/agent.mjs` 或 `npm run --silent agent --`。npm 不带 `--silent` 会在 JSON 前输出 npm 自身横幅。CLI 自身 stdout 始终只有一条 JSON 响应，日志进入 stderr；退出码 PASS=0、FAIL=1、BLOCKED=2、UNVERIFIED=3。`--help` 同样返回 JSON。

## 入口与项目选择

- 纯 SDK：`@aureliuswu/vn-engine-v2/agent`，仓库内 `dist/agent/index.js`；`executeAgentRequest(request, context)` 返回 `{ response, candidate?, reviewCandidate?, report? }`。它不写文件、不操作设备；候选文本与响应分开。资源验证需注入 `readAsset`，preview / build 需注入相应端口。
- Node 文件 SDK：`@aureliuswu/vn-engine-v2/agent/node`，仓库内 `tools/agent-node.mjs`；`runAgentFileRequest(request, { signal?, onLog? })` 返回机器响应，监督独立 Worker 的硬超时。
- CLI：`tools/agent.mjs`。传完整请求使用 `--request=request.json` 或 `--request=-` 从 stdin 读取。便利入口为 `<command> --project=FILE --params=JSON --request-id=ID`；参数使用等号，未知参数拒绝。
- Schema：[request](../schemas/vn-agent-v1.request.schema.json)、[response](../schemas/vn-agent-v1.response.schema.json)、[operation](../schemas/vn-agent-v1.operation.schema.json)，由 `src/agent/schema.ts` 生成，`npm run check` 校验一致性。

| init.type | 输出项目类型 | 用途 |
| --- | --- | --- |
| vn | narrative | 场景 / 台词 / 选项 Galgame |
| chat | narrative | 同一叙事规则，默认聊天台词 |
| script | script | 显式变量、有序效果、条件路由与分支 Galgame |
| investigation | investigation | 章节、节点、动作、证据、跨章 |

Rain 既有 `type: rain` 工程支持读取、引用、校验、真实路线、预览、打包；原作节点由兼容适配器管理，SDK 不承诺原作正文编辑。其他模板也不自动迁移或重编号。能力以 `capabilities` 当前响应为准。

## 请求与命令

协议固定 `vn-agent-v1`；引擎版本 0.8.0 与作品 `version` 分开维护。所有请求必须有 `protocol / requestId / command / params`，工程命令另带 `project` 文件路径。工程与回执文件使用无 BOM 的 UTF-8，SHA256 绑定原始字节；BOM / 非法编码明确拒绝并保留文件。JSON 字段不能包含可执行数据。完整可执行开发样例见后文。

```json
{"protocol":"vn-agent-v1","requestId":"inspect-001","command":"inspect","project":"build/my-game/project.json","params":{"kind":"nodes","limit":5,"maxBytes":8192}}
```

| 命令 | params 与结果 |
| --- | --- |
| capabilities | 无参数得到操作 / 类型 / 预算 / 兼容 / 退出码；`schema: request/response/operation/feedback` 返回具体 schema |
| init | 必填 `type, game, storyVersion, title`；`project` 或 `output` 指定新文件；`format: project/editor`，默认运行工程；不覆盖既有文件 |
| inspect | `kind: overview/nodes/chapters/variables/assets/presentation/routes`；可筛 `id,chapterId`，可设 `limit,maxBytes,cursor` |
| refs | `kind: node/variable/chapter/asset/evidence` 和 `id`；调查节点 / 证据可指定 `chapterId`；分页规则相同 |
| impact | 与 apply 相同操作与预期哈希，但只读分析；limit / output 可选，报告直接修改、资源消费者、任务 / 语音和未知范围 |
| feedback.inspect / put / transition | 独立 reviewFile、源 / 审阅哈希、目标 / 意见 / 状态历史；见 [R3 契约](ITERATION_DEVELOPMENT.md) |
| acceptance.bundle / import / inspect | 独立 acceptanceFile、实际输入、源 / 审核哈希、历史 / 冲突 / 恢复；见 [R4 AI 终审](AI_ACCEPTANCE.md) |
| apply | `expectedSourceSha256,operations` 必填，`dryRun,recover` 可选；隔离副本最终校验通过后提交 |
| validate | `mode: development/release`，默认 development；结构 / 引用 / 类型 / 资源实际字节校验与现有发布规则 |
| test | 从真实入口运行所有作者用例或指定 `caseId`；`maxOperations`；`output` 可写新的详细报告文件 |
| preview | 必填 `caseId,output`；可设 `previewMs,maxOperations,width,height`；真实会话 / DOMRenderer 沿用例合法动作生成 PNG 和源绑定报告 |
| build | 必填 `output`，`mode: development/release`；现有打包链输出独立作品、manifest / 文件列表 / 哈希与构建身份 |

所有命令可设 `timeoutMs: 1..60000`。输出目录须新建或为空，详细 test 报告文件必须不存在。preview 需要从开场可执行的作者路线；可在合法路径的中间位置结束用例，无须必须到结局。单个预览用例 PASS 不等于所有结局覆盖 PASS。

响应总有 `protocol,engineVersion,command,requestId,ok,status,project,data,diagnostics,artifacts`。`project` 在可读取时包含 `game,storyVersion,sourceSha256`；无法读取时为 null。apply 成功响应给出实际提交后的哈希；dry-run 身份仍为原源文件，候选哈希在 data 中。每条诊断给出稳定 `code,severity,message`，可用时带 `operation,path,nodeId,chapterId,assetId,expected,actual`。JSON 字段路径为数组，操作索引从 0 开始。

PASS 表示该命令声明的技术范围通过。FAIL 表示实际错误；BLOCKED 表示正式门禁阻断；UNVERIFIED 表示预算、取消、未执行或覆盖不足。导入审核文件成功不等于内容通过；当前内容放行使用有实际输入的 AI 审阅，真实平台测试另行执行。

## 有界读取

默认每页 20 项 / 16384 UTF-8 字节，最大 100 项 / 65536 字节，最小预算 4096 字节（按 JSON 编码计算，不含 CLI 行尾换行）。`data.truncated` 和 `nextCursor` 明确是否还有数据；下一次保持 kind / id / chapterId / query / characterId / taskKind，传回 cursor。游标绑定源 SHA 和查询范围，变化后返回 STALE_CURSOR，需重新读取。

单实体大于预算时返回 `fragment: {id,encoding:"json-text",offset,text,complete}`，按游标顺序拼接 text，complete 时对拼接结果 JSON.parse；不截断或丢弃作者文本。普通 items 与片段按顺序消费。节点 refs 包含连线、入口、演出与路线断言；refs 只查询真实结构字段，不通过全文模糊匹配推断引用。

## 稳定 ID 批量编辑

具体载荷由 operation schema 与对应运行模型共同约束。payload `value` 可保留作者扩展字段；修改已有 line / choice / action / route 只合并指定字段。`node.put` 是整节点替换，`node.patch` 合并字段；删除需要显式 remove，不靠省略字段删除。

| 操作 | 定位与语义 |
| --- | --- |
| project.patch / entry.set | 项目设置 / 真实入口；不在普通补丁中改变 game 和故事版本 |
| node.put/patch/rename/remove | id，调查需 chapterId；重命名复用原子引用更新，删除有保护 |
| line.put/remove/rename | nodeId + id；put 可用 afterId 插入或移动；台词文本、发言人、cue 等由 value 提供 |
| choice.put/remove / exit.set | nodeId + id / nodeId；exit 使用 native 项目对应结构，支持 next、条件路由与选择效果 |
| variable.put/rename/remove | id；value 为 initial / min / max；复用类型校验、引用同步和删除保护 |
| chapter.add/patch/rename/move/remove | id；add 可给 title；patch 给 title / entryNode / requiredEvidence；move direction 为 -1 或 1 |
| evidence.put/rename/remove | chapterId + id；同步证据条件、动作与可归属路线期望 |
| action.put/remove | chapterId + nodeId + id；调查动作 / 证据效果 |
| asset.put/remove | id；本地 src / kind / sha256 / license 等；资源文件由宿主另行提供，不由 JSON 执行文件代码 |
| stage.set/remove | scope defaults/node/line；nodeId / chapterId / 台词 id 按项目定位；set 的 value 为已有 StageCue；remove 可清除失效绑定，删除节点前可在同批清理其演出表 |
| route.put/remove | id；steps / expect 使用现有真实路线协议 |

最多 128 操作；批次内部可暂时缺少出口目标，最终状态必须通过作者模型、运行时与实际资源校验。现有 rename / remove 的引用、回看身份和类型保护不因批次绕过；遇到保护应先在批内显式修改相关引用或拆分意图，不能直接跳过校验。未修改扩展字段与编辑器 positions 保留。

`dryRun:true` 不写工程或回执，返回 before/after SHA、最多 128 个变更字段路径、before / after 值或片段（差异总计最多 8192 字节）及 truncated 标记。正式写入用相同 expected SHA 与新请求 ID；原文件变化则 SOURCE_CONFLICT，重新 inspect 后重整批次。

## 并发与断点恢复

Node SDK 在同目录创建 `project.json.agent-lock` 和 `project.json.agent-journal.json`。前者为协作排他锁，后者记录请求 ID、规范化输入 SHA、修改前后 SHA、prepared / committed / rejected / not-applied 及完整响应。timeoutMs / recover 不影响请求语义摘要。日志保留最多 128 批或 8 MB；满后拒绝新批次，由使用者归档，不能假定历史请求仍能去重。

同一个 requestId 和输入可重试：若源字节仍匹配已提交回执，返回 replayed=true，不重复追加；同 ID 不同输入返回 REQUEST_REUSED；之后又有其他更改返回 REPLAY_CONFLICT。崩溃时先比较当前源：等于 after 则确认已提交，等于 before 则允许重做，否则 RECOVERY_REQUIRED。死进程锁需要给原请求加 `recover:true`，活进程锁保持 LOCKED。不要给语义不同的操作复用请求 ID。

硬超时 / 取消的修改可能已经完成：返回 applied=unknown、recoveryRequired=true，不谎报回滚；用完全相同请求重试并核对实际文件。纯 SDK 只准备候选，以上文件事务保证属于 Node SDK。文件替换使用同目录临时文件、fsync 后 rename；只有合作写入者遵守锁。外部不合作程序仍可能在最终哈希检查与 rename 之间竞争，电源故障与文件系统 durability 不等于数据库事务；发现差异会阻断，不能恢复时明确报告。

不要编辑回执以绕过去重。需要人工解决 RECOVERY_REQUIRED 时先保存当前工程和 journal，比较 before / after 与当前哈希，再以新的请求 ID 和当前哈希提交明确修复。

## 从零到独立包：完整可执行样例

两个独立工程的内容都仅通过接口写入；样例脚本另行提供一张原创技术 SVG 和带许可、改名的 OFL 字体子集。每轮输出使用新目录。

```sh
npm ci
npm run build
npx playwright install chromium
# 两个完整流程均通过 Node SDK：四类创建 + VN 分支 / 变量 / 条件 + 两章证据调查
node tools/agent-example.mjs build/r1-sdk
# 相同流程独立通过 CLI stdin JSON：28 次调用，含 dry-run、refs、test、preview、build
node tools/agent-example.mjs build/r1-cli --cli
```

输出各有 TRANSCRIPT.json（完整可复制请求 / 响应）；script / investigation 目录内有 project.json、ROUTE_REPORT.json、preview/preview.png、PREVIEW_REPORT.json 与 game/build-manifest.json。调查示例重命名章节和证据、检查引用、跨章到达结局。独立包可由任意静态服务器部署到子目录，下载完成后离线重开。技术样例仍为 DRAFT，缺少当前完整 AI 内容 / 设备证据；development 包可生成，release 模式保持 BLOCKED。

单次创建和 Node SDK 编辑：

```sh
mkdir -p build/custom
node tools/agent.mjs init --project=build/custom/project.json --request-id=create-001 --params='{"type":"vn","game":"my-galgame","storyVersion":"draft-1","title":"雨后约定"}'
```

```js
import { runAgentFileRequest } from './tools/agent-node.mjs';
const project = 'build/custom/project.json';
const call = (command, params, requestId) => runAgentFileRequest({
  protocol: 'vn-agent-v1', command, requestId, project, params
});
const before = await call('inspect', { kind: 'nodes', id: 'start' }, 'read-001');
const batch = await call('apply', {
  expectedSourceSha256: before.project.sourceSha256,
  operations: [
    { op: 'line.put', nodeId: 'start', id: 'start-1', value: { text: '雨终于停了。' } },
    { op: 'route.put', id: 'complete', value: { steps: [{ type: 'action', id: 'continue' }], expect: { ending: '完成' } } }
  ]
}, 'edit-001');
if (!batch.ok) throw Error(JSON.stringify(batch.diagnostics));
for (const [command, params] of [
  ['validate', {}], ['test', {}],
  ['preview', { caseId: 'complete', output: 'build/custom/preview' }],
  ['build', { output: 'build/custom/game', mode: 'development' }]
]) { const response = await call(command, params, 'custom-' + command); if (!response.ok) throw Error(JSON.stringify(response)); }
```

## 预算与兼容边界

输入 / 源文件最多 8 MB，嵌套 60 层；单资源 64 MiB、单请求资源共 256 MiB；路线最多 20000 操作；预览最多 30000ms；请求最多 60000ms。预算耗尽不标 PASS。预览使用可注入虚拟时钟处理剧情等待，真实 Chromium / DOMRenderer 验证画面；默认 reduced motion，禁用音频设备，不能替代动画、声音、实体设备或实际构图审阅。预览存储被隔离，测试逐步标准 save/restore，不向玩家 Save / Meta / 已读写入。

项目 / EditorDocument / Save 均保留 schema 1；运行器和 Studio 语义未另建副本。game、故事版本、台词与章节 ID 仍是存档身份，调整已发行作品身份 / 顺序需要独立兼容设计；R1 不执行迁移。旧 Rain 入口与原存档重建规则保持。四作和 RESET 正式文件、资产、玩家数据均独立。

## 错误码索引

| 类别 | 常见稳定码 | 处理 |
| --- | --- | --- |
| 协议 | MALFORMED_JSON / INVALID_REQUEST / INVALID_ARGUMENT / PROTOCOL_UNSUPPORTED / UNKNOWN_COMMAND / INVALID_ENCODING | 修正请求 / 编码，保留 JSON 结构 |
| 定位与模型 | PROJECT_REQUIRED / INVALID_PROJECT / PROJECT_SHAPE / NOT_FOUND / REFERENCE_AMBIGUOUS / INVALID_ID / OPERATION_FAILED / INVALID_OPERATION / OPERATION_UNSUPPORTED / REPLAY_RECAPTURE_REQUIRED | 查看 path / operation，修正定位或载荷；模型保护原因在 message |
| 引用与验证 | PROJECT_* / ROUTE_REFERENCE_MISSING / PROJECT_PRESENTATION_TARGET_MISSING / VALIDATION_FAILED / ASSET_UNREADABLE / ASSET_PATH_UNSAFE / ASSET_HASH_MISMATCH / ASSETS_UNVERIFIED | 修复结构、类型、引用、资源或注入实际资源端口 |
| 读取 | INVALID_CURSOR / STALE_CURSOR / BUDGET_EXCEEDED | 重新读取、缩小范围或预算内分批 |
| 文件事务 | SOURCE_CONFLICT / REQUEST_REUSED / REPLAY_CONFLICT / LOCKED / RECOVERY_REQUIRED / JOURNAL_ERROR / JOURNAL_FULL | 按前文核对源字节与请求日志，不盲目重放 |
| 宿主 | FILE_NOT_FOUND / PROJECT_PATH_UNSAFE / IO_ERROR / OUTPUT_EXISTS / HOST_PORT_REQUIRED | 检查路径、输出或端口；已有内容不覆盖 |
| 执行 | ROUTE_FAILED / PREVIEW_STATE_MISMATCH / PREVIEW_RENDER_FAILED / PREVIEW_ERROR / BUILD_ERROR / BUILD_IDENTITY_CONFLICT / RELEASE_GATE_BLOCKED | 看实际路线 / 资源 / 门禁原因，不自动提升素材或内容状态 |
| 中断 | TIMEOUT / ABORTED / WORKER_ERROR / WORKER_EXIT / INTERNAL_ERROR | 未验证；写入可能已完成时按回执恢复 |

作者模型诊断码保留为 `PROJECT_` 加原码大写（连字符转下划线）；具体校验原因不被稳定错误码替代。协议 schema 与模型 schema 共同定义有效数据，扩展未声明能力需升级协议或清楚标识兼容扩展。
