# P1 资源计划与受限文本作者前端 · v1.2.0

本轮按 Architecture Mining 报告的 P1-A / P1-B 实施两项独立增量。只优化引擎；四作原仓库、正文、宿主与玩家数据均不迁移。没有复制参考引擎实现。JSON IR、ScriptEngine、canonical replay、存档 envelope / payload 与持久键沿用现有约定。

## 资源计划与预算预取

`createResourcePlan(project, position?, options?)` 是纯只读查询，返回冻结的 `vn-resource-plan-v1`。支持四类项目，输出 active / candidates、资源 ID / kind / src、owner、统一 SourceOrigin、距离、已知估算与未知项、访问预算和截断标记。静态图对条件分支取候选，不执行条件、driver 或自定义 presentation callback。当前实际 frame.stage 是 active 的权威输入；缺少当前舞台或动态演出时明确报告 unknown，不把静态猜测称为精确依赖。深度、访问数和候选数有界；只规范化已访问节点 / 台词，不复制完整剧本。估算字节来自可选宿主提示，不冒充实际解码内存。

`ResourcePrefetcher` 只下载编码字节。默认预算为并发 2、队列 32、单次 2 MiB、编码缓存加在途预留 8 MiB。宿主可设置更低 / 更高的有限预算。流式读取检查实际长度，不能依靠 Content-Length 绕过上限；超过限制或失败则退出该次意图，仅在新计划后重试。相同 asset ID 共享工作；改变分支、暂停、隐藏或 dispose 取消过期候选。不遵守 abort 的注入 loader 仍占用物理槽和预算，直到 settle，旧响应不能发布。

当前资源不会被预取驱逐。`retain(owner, ids)` / `release(owner)` 为宿主提供额外持有；释放须在消费者停止使用 URL 后进行。Blob URL 仅在已缓存资源成为 active / retained 时按需创建，安全释放后撤销；speculative 数据本身不创建图片、字体或媒体元素。原有 BGM 的两轨 / 32 MiB 解码 LRU 继续独立工作。这里的预算是编码载荷与在途预留，不是 JS 堆、浏览器 HTTP / SW cache、GPU 图像、流媒体缓冲或总进程内存上限。

`mountGame(root, project, {prefetch:{maxConcurrent:2,maxQueued:8,maxTransferBytes:2097152,maxBytes:8388608,plan:{maxDepth:2,maxVisits:64,maxAssets:64}}})` 显式启用；默认 / `false` 不预取。挂载独占 scheduler，按新 visit 更新计划，普通打字 / 设置通知不会重新下载失败候选。AssetCatalog 保留 `sourceURL()`，`url()` 可在实际渲染时复用已预取的 Blob，避免再次请求同一来源。订阅完成后再释放旧消费者 URL。`resourceSnapshot()` 返回 enabled、plan、cache，既不写存档也不改变路线。独立重读驱动不共享主会话的 speculative 状态。

Studio“资源计划”页默认关闭，显式设置预算并刷新预览后才启用；按 requestId / revision / source SHA 采集实际挂载计划与缓存指标。来源过期或 DSL 候选与当前 JSON 不同，不能标记为当前工程证据。Agent `inspect {kind:"resources",position?,plan?}` 仅查询计划，不 fetch；大结果沿用分页、字节预算和 SHA 绑定游标。

## 文本 DSL

作者入口为包的子路径 `@aureliuswu/vn-engine-v2/script-text` 的 `compileTextScript(source, options?)`，或者 Studio“文本 DSL”。成功得到现有 ScriptProgram；失败不返回 program，提供有界诊断。独立 sourceMap 使用 ScriptProgram 相对 JSON path、显式 ID、文件名和 UTF-16 offset；行列从 1 开始，end exclusive。统一来源导航仍通过项目 game / version / ID / JSON path；sourceMap 是作者辅助数据，不是新的玩家协议。

```text
vn-script 1
game "p1-example"
version "1"
entry start
var trust number 0 min 0 max 10
var consent boolean false
block start "开场"
line hello "旁白" "你好。"
choice accept "继续" -> route with add trust 2, set consent true
choice decline "离开" -> neutral
block route
branch
when trust >= 2 && consent == true -> good
else -> neutral
block good
line good-line "旁白" "完成。"
end good
block neutral
line neutral-line "旁白" "结束。"
end neutral
```

逐行命令，缩进无语义；`#` / `//` 是字符串外的注释，双引号支持 JSON 转义，三双引号为原文多行。所有 block / line / choice ID 显式声明，排版不会重新编号。变量只支持 number / boolean，条件只支持 `==` / `>=` 与 `&&`；add / set 仅附属于 choice。jump / branch / end 沿用已有出口。默认最多 1,000,000 UTF-16 源字符、100,000 tokens、200,000 字符字符串、10,000 blocks、30,000 lines、30,000 choices、1,000 variables、100 diagnostics；ID 最大 256，文件名最大 4096，可收紧预算。最终 IR 由现有 ScriptEngine 复核。

首版没有独立 set opcode、任意表达式、JavaScript、文件 / 网络访问、调用栈、媒体 cue 文本扩展，也不声称兼容其他引擎语法。已有 JSON 的 StageCue 等能力仍保留。Studio 可先编译候选试玩，再显式应用；只替换当前 script 工程 program，为单次可撤销事务，身份不匹配或编译失败不应用。其余资源 / UI / 元数据保持原值。文本草稿与范围不进入玩家数据；JSON 编辑后不承诺无损反写 DSL。

CLI：先 `npm run build`，再 `node tools/compile-script.mjs examples/dsl/branch.vn.txt --out PROGRAM.json --map SOURCE-MAP.json`。输出仅是 ScriptProgram，作者仍将它显式放入 EngineProject.program；不会创建或覆盖作品工程。输出文件必须不存在，冲突不覆盖原文件，编译失败不写输出。Agent `script.compile` 无需工程路径，提供只读、分页的 program / diagnostics / source map，使用同一编译器；不会产生修改 receipt 或 journal。

玩家包只接受 JSON IR，不携带编译器、DSL 原文或 source map；Studio 包包含作者编译模块。没有引入运行时 parser 初始化或新的 save schema。验证记录见 [VALIDATION-v1.2.0.md](VALIDATION-v1.2.0.md)。
