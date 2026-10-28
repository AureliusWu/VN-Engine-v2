# AI 模拟内容终审 · R4

当前策略为 ai-simulated。文案、剧情、视觉整合、单项美术与听感可由 AI 模拟读者、视觉审阅者和听众完成，不再要求真人内容签字。技术类别使用实际测试记录。模型身份与观察声明仍为自报，文件校验不认证模型确实执行。

## 数据和实际输入

独立 acceptance.json 使用 vn-ai-acceptance-v1 / schema 1，规则版本 r4-1，完整 schema 位于 schemas/vn-ai-acceptance-v1.document.schema.json。记录绑定 game、storyVersion、ENGINE_VERSION、精确源字节、实际素材 / 许可，另存输入、模型、模态、时间、覆盖、理由与定位问题。完整记录不进入玩家工程、存档或成品资源。

- story / text / visualIntegration / audio / art / master 使用 ai-simulated。
- accessibility / web / pwa / windows 使用 automated，需对应当前源 SHA 的实际 PASS 测试报告；报告须列明 categories，Windows 另须 platform:win32，AI 意见不能替代平台执行。
- 每条审阅须引用精确 $source 输入。剧情另需当前路线报告；视觉整合须含 1280px 和 390px 的实际 PNG；美术须含当前资源图；母版须含对应哈希的图；听感须覆盖全部适用音频，并声明 audio 观察能力。
- 主机重新读取输入字节并验证哈希，核对 PNG 头部尺寸。这些结构与字节检查不自动证明审美、听感或模型身份。源、素材、主题 / 演出、目标、引擎或规则变化均使旧结果失效。
- 缺模态、缺文件、抽样覆盖、未处理 error、超时或 UNVERIFIED 均不能批准完整范围。解码 / RMS / 峰值不自动成为艺术或听感 PASS。

旧 releaseEvidence.qa 在 QA 报告的 humanQa 中保留为 legacy-declared 历史视图，**不参与当前放行**。contentReview 是当前结果。旧工程与 Save / Editor schema 1 仍可开发、播放、导出。

## SDK / CLI 流程

vn-agent-v1 新增三个命令，JSON stdout 与 0/1/2/3 状态约定保留：

1. acceptance.bundle：params.output 为新目录，可用 inputs:[{id,file,kind}] 加入实际 screenshot / test-report / image / audio。复制实际工程与素材，执行路线并生成 acceptance.draft.json。它明确 modelExecuted:false，审阅均为 UNVERIFIED，不调用或伪装模型。
2. 使用当前开发环境的 AI 观察实际正文、图片、音频和截图，填写判断、理由、覆盖与问题。技术报告来自真实测试。修复后按最新输入复审，可把问题关联到 R3 的 review.json；缺音频能力时如实保留 UNVERIFIED。
3. acceptance.import：提交 document、expectedSourceSha256、expectedReviewSha256（新文件为 null），可指定 acceptanceFile。支持 dryRun / recover、源与文件冲突检查、原子替换和请求回执。新修订的 supersedesSha256 指明旧文件哈希，前后版本保存在相邻 .history 目录。回执重放也重新检查当前证据；已提交不等于当前仍可放行。
4. acceptance.inspect：有界分页读取结果，支持 limit / maxBytes / cursor / acceptanceFile。第一项为摘要，随后按范围列状态。工程或证据改变后旧游标失效。

CLI 请求通过 stdin 交给 node tools/agent.mjs，例如：

    {"protocol":"vn-agent-v1","requestId":"bundle-1","command":"acceptance.bundle","project":"/work/project.json","params":{"output":"/work/review-bundle"}}

证据路径相对于 acceptanceFile 目录解析，默认报告为工程目录的 acceptance.json。路径与预算沿用现有边界。可保存字节绑定正确但包含 FAIL / UNVERIFIED 的审阅；导入命令成功与内容放行分别记录。

纯 SDK 以 captureAcceptanceContext(project, sourceText, document, readAsset, readEvidence) 注入实际读取，再给 executeAgentRequest / validateProjectCompliance 提供 acceptance 与 acceptanceContext。未注入主机条件时正式结果为未验证。模块导入不访问设备或网络。

## Studio 和 Windows

制作面板 → 验证状态 → AI 模拟终审：打开报告、绑定证据目录、核对当前版本、独立保存、把问题转入 R3 反馈。错误导入保留旧文档；换工程 / 离开面板取消迟到读取。修改、撤销与重做后重新核对。

Windows 的 open-ai-acceptance / save-ai-acceptance / read-ai-acceptance-input 仅向可信顶层编辑器开放，文件独立于 review.json。外部变更阻止覆盖；证据限于该文件声明的本地相对路径，每项最多 64 MiB。CI 使用预设路径，不代表人工操作系统对话框。

## 统一正式门禁

QA_REPORT、正式校验、候选和打包器默认加载独立文件，可显式指定：

    node tools/qa-report.mjs project.json --decode --acceptance=/work/review/acceptance.json --output=build/QA_REPORT.json
    node tools/validate-project.mjs --release --acceptance=/work/review/acceptance.json project.json
    VN_RELEASE_BUILD=1 node tools/package-game.mjs project.json build/game --acceptance=/work/review/acceptance.json
    node tools/release-gate.mjs project.json --acceptance=/work/review/acceptance.json

Agent validate / build 的 params.acceptanceFile 使用同一策略。技术就绪、资源 READY 与来源元数据单独检查；AI 不批量改写 DRAFT / PLACEHOLDER。更改 READY 或元数据导致源变化时也须复审，不能搬用旧记录。

母版 / Neutral 的检查沿关联传给差分。成品复核检查必需入口、本地模块依赖、实际文件 / 清单、当前源与引擎以及内容指纹。引擎技术完成、示例内容审核、测试包和 GitHub Release 是独立状态。

synthetic / fixture:true 测试记录只验证流程，不代表实际 AI 文学、美术、听感或设备验收。AI 终审取代真人内容签字；声明实体设备时仍需实际证据，390px 视口不改称实体设备。
