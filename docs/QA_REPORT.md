# 统一 QA 报告与正式候选门禁

> R4 政策更新：文案、美术和听感终审改为有实际输入绑定的 AI 模拟审核；技术与实体设备检查保留。当前接口见 [AI_ACCEPTANCE.md](AI_ACCEPTANCE.md)。以下旧人工声明属于旧契约 / 历史范围，不再单独批准当前内容。

报告契约为 `GALGAME_SPEC-v0.2-qa-draft`。它汇总当前可检查范围，不是完整 v0.2 认证，不会自动生成真实人工验收。

## 独立检查项

| 项目 | 实际检查 |
| --- | --- |
| structure / formalStructure | 身份、故事结构、引用、占位文本、演出、小游戏结果映射和回看数据 |
| routes | 从真实开场执行作者用例，断言结局 / 变量 / 证据 / 小游戏并逐步存读档；全部声明结局须由成功用例覆盖 |
| art | 独立 TECH_READY / ART_READY 声明、七项视觉门禁、母版关联及继承、实体设备和 Key Visual 证据 |
| humanQa | 剧情与文本质量、实际场景、听感、无障碍及目标平台的人工记录 |
| files | 实际资源和许可存在、本地路径边界、实际字节与声明 SHA256；逐项汇总失败 |
| decoding | Chromium 解码图片 / 字体 / 完整音频；视频检查首帧，记录尺寸、时长及浏览器版本 |
| build | 可选独立包的提交锁、Game Version、实际文件大小 / SHA256，以及打包工程与当前源数据是否相同 |

美术或人工证据失败不会中止其他独立项。未运行解码时为 UNVERIFIED，不会仅凭文件存在推导 TECH_READY。声明的 `art.TECH_READY` 与实际探测并列保留：若图片不能解码，即使声明为 PASS，报告仍阻断。

路线检查参见 [ROUTE_QA](ROUTE_QA.md)。没有用例、预算耗尽或未覆盖声明结局时 routes 为 UNVERIFIED，失败为 FAIL；两者都会阻断正式门禁。正常开发播放和开发打包可继续使用没有用例的旧工程。路线用例通过不替代人工剧情审读，也不穷举相同结局的全部分支组合。

视频首帧成功不等于整段播放、声音听感或所有设备编码支持；这些仍须目标平台人工 QA。Chromium 视口不作为实体手机证据。

## 人工记录

`releaseEvidence.qa` 使用以下 category，每项格式为 `{ status, reviewer, reviewedAt, evidence }`。状态只允许 PASS / FAIL / UNVERIFIED。必须有真实审核者、有效日期及证据引用；缺失时正式校验 / 打包阻断。

| category | 适用范围 |
| --- | --- |
| story | 全部作品：剧情完整性、路线 / 结局与逻辑 |
| text | 全部作品：错字、标点、占位、口吻与文本质量 |
| visualIntegration | 全部作品：实际运行场景与交互内容的视觉整合 |
| accessibility | 全部作品：输入、可读性及相关无障碍验收 |
| audio | 清单含音频或视频时：实际播放和听感 |
| web | 声明移动 / PWA，或未声明仅桌面目标时 |
| pwa | 声明 PWA 或检查本引擎生成的 PWA 包时 |
| windows | 声明 desktop 时：当前自研桌面宿主为 Windows |

没有声明目标时不推断 N/A。人工 QA 检查作品质量与运行行为，不承担伦理或内容审查。

例如尚未验收的记录应保持：

```json
{"story":{"status":"UNVERIFIED","reviewer":"UNVERIFIED","reviewedAt":"","evidence":"UNVERIFIED"}}
```

## 运行

```bash
npm run qa:report -- /path/to/project.json --decode --output=build/QA_REPORT.json
npm run qa:report -- /path/to/project.json --decode --build=/path/to/game --output=build/QA_REPORT-with-build.json
VN_ENGINE_COMMIT=<40位实际提交SHA> npm run gate:release -- /path/to/project.json
```

`qa:report` 用于保留可审阅报告，默认报告 BLOCKED 仍正常写出；加 `--release` 时自动执行解码，非 PASS 返回失败退出码。未提供 build 的报告明确记录 build 未检查，其范围仅为工程 / 源资产；不等同最终成品验收。指定 build 时，本引擎的包同时包含 PWA，必须具备 PWA 与实体设备证据。

`gate:release` 先运行核心 / 浏览器检查，再执行源工程、实际路线、人工证据与解码门禁。全部通过后才在新的 `build/release-gate-*` 目录创建正式候选，按实际字节复核候选并保存 `QA_REPORT.json`。缺少有效提交锁或构建失败时保留阻断报告；不覆盖已有目录，不发布网站或 Release。也可使用 `--output=/path/to/new-directory` 指定新的输出目录。直接使用正式 `validate-project` 或 `VN_RELEASE_BUILD=1` 打包也执行相同路线门禁，成功 manifest 留存路线摘要。

CI 的 `alpha-qa-reports` 为四种独立技术样例生成 QA_REPORT、ROUTE_REPORT 及对应 build manifest。10 个真实用例覆盖 11 个声明结局；路线报告附实际源文件 SHA256、引擎版本和构建身份，路线非 PASS 时 CI 失败。样例路线 / 文件 / 解码 / 构建可以 PASS，但缺少正式人工证据，QA_REPORT 应为 BLOCKED。CI 成功只证明实现、回归和报告生成正确，不能把样例升级成正式作品。
