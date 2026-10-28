# R3 内容迭代与作者审阅 · 0.7.0

> R4 政策更新：文案、美术和听感终审改为有实际输入绑定的 AI 模拟审核；技术与实体设备检查保留。当前接口见 [AI_ACCEPTANCE.md](AI_ACCEPTANCE.md)。以下旧人工声明属于旧契约 / 历史范围，不再单独批准当前内容。

R3 复用 R1 / R2 的作者模型、解释器、路线与打包。新增内容目录、修改影响与独立审阅文件；vn-agent-v1、vn-creative-v1、Project / EditorDocument / Save schema 1 保持兼容。基础调用见 [AI 入口](AI_DEVELOPMENT.md)。

## 内容目录与影响

inspect 的 kind: content 返回 line / variant / choice / action，覆盖 narrative、chat、script、investigation 和 Rain 回应。结果有 contentId、区分种类 / 章节 / 节点的 id、原 path、derived、文本 / 发言人 / 语音与有效演出资源。没有显式 ID 的旧内容保留派生身份，不自动重编号；旧 text 目录仍只返回台词。refs 的 content 查询制作引用，asset 引用增加内容消费者。

impact 接受与 apply 相同的 expectedSourceSha256、operations、imports 和预算，另有 limit / output。它只读分析，不写工程或导入文件。vn-content-impact-v1 报告 beforeSha256 / afterSha256、直接修改的 content / nodes / assets、affectedContent / affectedNodes、依赖任务、潜在语音复核、完整作者路线与 unknown。各列表有 total / items / truncated，limit 最高 100，整体响应继续受 65536 UTF-8 字节预算限制；apply / dry-run 同时返回 impact。

替换素材会报告资源消费者，不谎称台词正文被改写。语音计算沿实际默认 / 场景 / 台词及一次性 cue 规则；前序节点继承、动态 presentation 和路线可达性仍需实际试玩。previousResultsInvalidated 依据工程源 SHA，fullRouteSuiteRequired 始终为 true，不批准只跑部分路线后发布。旧路线 / 预览 / 构建报告保留原身份，必须与当前 SHA 对比。

## 独立 review.json

[文件 schema](../schemas/vn-author-review-v1.document.schema.json) 可通过 capabilities 的 schema: feedback 发现。契约为 vn-author-review-v1，schema 1，包含 game、storyVersion 与最多 500 条 items，保留根 / 每条记录的扩展字段。

每项有稳定 id、category、target、comment、state、binding 与最多 64 条 events。target 支持 project / node / line / variant / choice / action / asset / task / character / beat；内容提供 nodeId，调查还提供 chapterId。历史目标消失后保留并显示过期，不能默默改指其他内容。

| 状态 | 语义 |
| --- | --- |
| open | 新问题待处理 |
| addressed | 修复说明绑定当前源与实际文件，等待复验 |
| verified | 前一状态须为当前有效的 addressed，另需明确 evidence 声明 |
| reopened | 重开；编辑已有问题也进入此状态 |

actor / at / note / evidence 与当时 binding 追加到历史。actor 是自报身份，evidence 是声明；机器不认证本人、文学、美术、人耳或实体设备终审，不写 releaseEvidence、不提升 READY。

binding 记录精确源 UTF-8 字节 SHA、实际素材 / 许可 SHA 与 filesVerified。当前保守绑定全部清单文件：单文件 64 MiB、累计 256 MiB、最多 10000 个身份。目标 / 源变化或已知字节不同为 stale；文件缺失、未注入读取器或清单哈希不符不能认证 fresh。完整 verified 且 fresh 的集合才得到机械 PASS，否则 UNVERIFIED；stale 是项有效性，不改变 CLI 顶层状态契约。

## SDK / CLI

| 命令 | params |
| --- | --- |
| feedback.inspect | 可选 reviewFile、id、limit、maxBytes、cursor；summary 与反馈共用分页 / 片段机制 |
| feedback.put | expectedSourceSha256、expectedReviewSha256（新文件为 null）、id、actor、value；value 包含 category / target / comment |
| feedback.transition | 相同预期哈希 / id / actor，加 state: addressed / verified / reopened、note；verified 需要 evidence |

写命令支持 dryRun / recover / timeoutMs。reviewFile 默认是工程路径加 .review.json，推荐显式使用独立 review.json；禁止覆盖工程、清单素材或许可。成功写入返回 data.reviewSha256；project.sourceSha256 仍是相关工程身份。

纯 executeAgentRequest(request,{source,reviewSource,readAsset}) 返回独立 reviewCandidate，不执行 IO。Node / CLI 以审阅文件自己的 .agent-lock / .agent-journal.json、请求摘要、预期哈希、prepared / committed 回执和原子替换落盘。真实进程在 rename 前后死亡可用同请求 recover，重复请求不重复追加。写前后复核工程；两个文件分别提交，不宣称跨文件数据库事务。不合作外部写入及电源持久性边界沿用 R1。

常见错误有 SOURCE_CONFLICT、REVIEW_CONFLICT、REPLAY_CONFLICT、REVIEW_TARGET_MISSING、REVIEW_STALE、INVALID_REVIEW、REVIEW_EVENT_LIMIT、BUDGET_EXCEEDED。硬中断可能 applied=unknown，按原请求核对实际文件与回执。feedback.inspect 游标绑定源、审阅原字节与实际文件身份；任何变化后重新读。片段需完整拼接后 JSON.parse，不能丢弃长意见和历史。

## Studio 与 Windows

制作与审阅面板提供简报 / 角色 / 节拍、六类任务筛选与依赖 / 目标 / 输出关联、素材使用处和来源、实际图片 / 字体 / 哈希 / 音频、有限主题、反馈与验证状态。项目操作先在隔离 EditorModel 上调用共享作者命令并最终校验，再作为一次可撤销编辑提交；错误保留原数据和扩展。临时无效演出只显示影响尚未核实，不中断旧编辑器修复。

反馈有独立 32 步撤销 / 重做，草稿在 document 旁保存 authorReview。浏览器实际打开 / 下载 JSON；Windows 仅向可信 Studio 顶层开放 open-author-review / save-author-review，作品和预览 iframe 无文件桥。原生文件有 8 MB / 契约检查、排他租约、原子写与外部修改检测，不能覆盖工程或清单资源；完整语义由共享 JS 校验。

反馈不进入项目、.vnproj、Save / Meta / 已读或作品包，必须另存。源 / 实际字节变化显示过期；状态更新前重新读文件，期间换项目会取消。原始 runtime JSON 保留原字节身份，编辑后使用导出的规范 JSON；只改格式也保守过期。直接修改作品身份时保留旧审阅及原身份，可恢复草稿和另存，但拒绝跨身份写反馈；正常文件导入仍严格检查 game / storyVersion。

可定位显式或派生台词的原字段，不分配 ID；Rain 选择对应原格式 JSON 字段。试听只有一个真实媒体元素，离开 / 换项目 / 隐藏 / 最小化 / dispose 清理；字体异步加载有取消身份。播放器仍使用 storage:null，作者工作不会写玩家状态。

## 两轮真实修订

```sh
npm ci
npm run build
npx playwright install chromium
node tools/iteration-example.mjs build/r3-sdk
node tools/iteration-example.mjs build/r3-cli --cli
npm run test:iteration
```

两个流程复用 R2 插画 / 原创程序音频 / 许可字体，以独立 game / storyVersion 初始化。第一轮改稳定台词和 leave 分支；第二轮导入两秒 C5 / A4 / F4 / E4 配乐并改为 paper 主题，旧内容寻址文件保留原字节。每轮完整路线 / 逐步存读档，默认输出桌面 / 390px PNG；所有人工复验都是明确的合成夹具。

输出包含 project.json、review.json、ITERATION_TRANSCRIPT / REPORT、REVISION_SNAPSHOTS、IMPACT_ONE / TWO、ROUTES_ONE / FINAL、REVISION_MEDIA_REPORT、初稿 game 与最新 latest-game。最新包不带反馈或回执；正式 release 仍 BLOCKED。实际跨平台结果见 [0.7.0 验证](VALIDATION-v0.7.0.md)。R3 后停止，不自动推进下一轮或迁移四作 / RESET。
