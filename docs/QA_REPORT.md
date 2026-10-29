# 统一 QA 报告与正式候选门禁 · 0.8.0

当前内容审核策略为 **AI 模拟审阅（ai-simulated）**。文案、剧情、美术和听感使用绑定实际输入的 AI 结果；技术与实体设备检查执行真实测试。接口见 [AI_ACCEPTANCE.md](AI_ACCEPTANCE.md)。报告契约保持 `GALGAME_SPEC-v0.2-qa-draft`，不等于完整 v0.2 认证。

## 独立检查项

| 项目 | 实际检查 |
| --- | --- |
| structure / formalStructure | 身份、结构、引用、占位、演出、小游戏及回看数据 |
| routes | 从真实开场执行作者用例、结局 / 变量 / 证据断言、逐步存读档与全部声明结局覆盖 |
| art | 技术就绪、当前 AI 美术审阅、Character Master / Neutral 关联继承、实体设备及 Key Visual |
| contentReview | 当前源 / 素材 / 证据绑定的 AI 内容审核与 automated 技术审核；这是当前内容放行依据 |
| humanQa | `releaseEvidence.qa` 的 legacy-declared 历史视图，不参与当前放行，也不自动改写为 AI 审核 |
| files | 实际资源 / 许可、本地路径边界、字节与声明 SHA256；保留独立失败 |
| decoding | Chromium 图片 / 字体 / 整段音频解码、视频首帧和技术测量 |
| build | 当前源与引擎身份、提交锁、大小 / SHA256、指纹、模块与 HTML / CSS / PWA 依赖、离线 worker 完整性 |

某项审核失败不会遮蔽其他文件错误。未执行解码时 decoding 为 UNVERIFIED；解码通过不产生文学、美术或听感 PASS。路线覆盖作者用例及声明结局，不穷举所有分支组合。

## 当前内容审核

独立 `acceptance.json` 使用 `vn-ai-acceptance-v1`。源、实际素材 / 许可、证据、规则或引擎身份变化后，旧结果失效。每项记录模型 / 执行器、模态、覆盖、具体理由和问题；没有认证模型身份或自动调用模型。

| category | 模式与适用范围 |
| --- | --- |
| story / text | ai-simulated；全部作品，story 另需当前真实路线报告 |
| visualIntegration | ai-simulated；实际 1280px / 390px 运行图片及完整声明范围 |
| art / master | ai-simulated；对应资源或母版的实际图片与精确 SHA256 |
| audio | ai-simulated；清单含音频 / 视频时，观察全部适用音频并具备 audio 输入能力 |
| accessibility | automated；全部作品，当前源的实际 PASS 报告必须声明此类别 |
| web / pwa / windows | automated；按目标及 PWA 包适用性检查，Windows 报告须为 win32 |

只看文件名、波形或音量不构成听审。缺模态、抽样、未完成或未解决的阻断问题不能批准完整范围。真人补充意见可以保留，当前内容终审不再强制等待真人签字。技术播放、目标平台及声明的实体设备验证仍须实际执行；390px 视口不作为实体手机证据。

## 成品复核

除逐文件哈希外，build 检查必需文件是否漏列，检查相对模块依赖、index.html 是否真的加载 app.mjs、HTML / CSS 的本地资源及 Web App Manifest 的启动页和图标。查询参数和 fragment 按浏览器 URL 规则定位本地文件，内联 data 图像不会被误判为缺失文件。

离线缓存必须包含实际包文件，worker 必须与当前作用域、内容指纹及本引擎生成策略一致。即使重新计算清单哈希和内容指纹，断链或漏缓存仍 FAIL。检查只读原包，不能修补后再把原包记为通过。构建完整性不替代真实启动 / 离线 / 平台测试。

## 运行

```bash
npm run qa:report -- /path/to/project.json --decode --acceptance=/path/to/acceptance.json --output=build/QA_REPORT.json
npm run qa:report -- /path/to/project.json --decode --build=/path/to/game --output=build/QA_REPORT-with-build.json
VN_ENGINE_COMMIT=<40位实际提交SHA> npm run gate:release -- /path/to/project.json --acceptance=/path/to/acceptance.json
```

默认读取工程目录的 acceptance.json，可显式传入。`qa:report` 即使 BLOCKED 也写出可审阅报告；加 `--release` 自动解码，非 PASS 返回失败退出码。未提供 build 时明确未验收成品。

`gate:release` 先执行核心 / 浏览器，再执行源、路线、AI / 技术证据和解码门禁。通过后才在新目录创建候选，再只读复核实际包并保存 QA_REPORT。失败保留报告，不覆盖旧目录；不会发布网站或 GitHub Release。正式校验、SDK / CLI build 和 `VN_RELEASE_BUILD=1` 使用同一策略。

CI 的 `alpha-qa-reports` 为四种独立样例生成源哈希与构建身份绑定的报告：10 个用例、11 个声明结局、73 次存读档检查。样例技术项可以 PASS，但素材仍为 DRAFT、缺少当前完整内容和实体设备证据时，总报告保持 BLOCKED。引擎 alpha 完成不由样例真人签字决定。
