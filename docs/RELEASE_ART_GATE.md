# v0.2 正式美术与设备证据门禁

这是 `GALGAME SPEC v0.2` 的**部分工程门禁**，不是对 v0.2 全部条款的合规声明。既有项目契约标识保持 `GALGAME_SPEC-v0.1`；新增报告标识为 `GALGAME_SPEC-v0.2-art-draft`。

## 门禁做什么

开发模式允许未完成资产继续迭代。正式校验和 `VN_RELEASE_BUILD=1` 打包会检查：

- 已引用的背景、立绘、CG，以及资源清单中的 UI 视觉素材；无法静态穷尽的动态人物演出会保守检查全部视觉资源，并要求另附运行验收证据。
- 正式视觉资源声明 `status: READY`、资源清单 SHA256 和相同的 `runtimeSha256`。正式 CLI 校验与打包器会另读取实际文件并核对声明的 SHA256；二者不检查图像解码或尺寸。
- 每项分别声明 `TECH_READY`、`ART_READY`、七项视觉门禁、审核者、日期、真实来源和桌面 / 移动 / 来源证据引用。缺项或 `UNVERIFIED` 会阻止正式发布；技术状态不会自动改写美术状态。
- 资源清单中存在显式 `PLACEHOLDER` 即阻止发布；文件名、路径或说明含占位字样，以及来源描述为程序化 / 模板时，输出需要人工复核的警告。程序生成是否为作品有意采用的正式风格由人工判断。
- 显式声明 `mobile / pwa / desktop` 目标。声明移动端或 PWA 时，必须提供 `mobilePhysicalDevice` 的 `kind: physical`、设备、人工审核者、日期与证据；浏览器窄屏截图不能替代实体设备记录。本打包器总会生成 PWA，因此正式包须声明 `pwa: true`。
- 声明是否使用装饰性 Key Visual；使用时需提供在实际剧情、对白和选项中检查遮挡及生命周期的人工证据。引擎不自动判定这些声明的真实性。

门禁核对的是**人工填写的声明和引用是否齐备**，不会自动鉴定截图真实性、构图、美术风格、来源真实性或设备是否确为实体设备。来源无法确认时请填 `UNVERIFIED`，不要猜测。应由作品团队保留原始截图、文件哈希、审核记录及实际设备证据。

## 作品数据示意

下例故意保持 `UNVERIFIED`，会被正式门禁阻止。`room` 需对应资源清单中的 `background / portrait / cg / ui` 资源，其 `status` 与 `sha256` 也需按实际结果填写；不要把示例当作已通过证据。

```json
{
  "releaseEvidence": {
    "targets": { "mobile": true, "pwa": true, "desktop": true },
    "keyVisual": { "used": true, "status": "UNVERIFIED", "reviewer": "UNVERIFIED", "reviewedAt": "", "evidence": "UNVERIFIED" },
    "mobilePhysicalDevice": {
      "status": "UNVERIFIED", "kind": "physical", "device": "UNVERIFIED", "reviewer": "UNVERIFIED",
      "reviewedAt": "", "evidence": "UNVERIFIED"
    },
    "art": {
      "room": {
        "TECH_READY": "UNVERIFIED", "ART_READY": "UNVERIFIED",
        "VISUAL_IDENTITY_PASS": "UNVERIFIED", "COMPOSITION_PASS": "UNVERIFIED",
        "STYLE_PASS": "UNVERIFIED", "SCENE_INTEGRATION_PASS": "UNVERIFIED",
        "MOBILE_PASS": "UNVERIFIED", "DESKTOP_PASS": "UNVERIFIED", "PROVENANCE_PASS": "UNVERIFIED",
        "reviewer": "UNVERIFIED", "reviewedAt": "", "source": "UNVERIFIED", "runtimeSha256": "",
        "evidence": { "desktop": "UNVERIFIED", "mobile": "UNVERIFIED", "provenance": "UNVERIFIED" }
      }
    }
  }
}
```

如使用动态人物呈现，还需 `dynamicPresentation: { status, reviewer, reviewedAt, evidence }`，确认实际运行中的动态资源引用。证据的 `status` 为 `PASS / FAIL / UNVERIFIED`；必须是经人工复核后的实际结果。可选 `masterSha256` 如填写需是 64 位十六进制 SHA256。

## 运行

```bash
npm run validate:spec:release -- /path/to/project.json
npm run gate:release -- /path/to/project.json
VN_RELEASE_BUILD=1 VN_ENGINE_COMMIT=<40位提交SHA> npm run build:game -- /path/to/project.json /path/to/new-output
```

`gate:release` 需传入具体作品，不再把技术样例误当正式作品；它先运行项目自身检查和浏览器回归，再按本引擎生成 PWA 的打包方式进行正式校验。单独的 `validate:spec:release` 按作品声明的目标检查；如也要检查本引擎的 PWA 打包要求，可加 `--pwa-package`。失败时 CLI 输出 `SPEC_ART_GATE_BLOCKED` 或 `SPEC_FILE_GATE_BLOCKED` 及结构化 JSON；成功的正式构建把 `artGate` 写入 `build-manifest.json`。正式构建要求有效的 40 位提交 SHA；同时提供 `VN_ENGINE_COMMIT` 与 `GITHUB_SHA` 时，两者必须一致。

现阶段仍缺角色 Neutral Master 与表情差分的自动继承关系检查、装饰 Key Visual 使用范围 / 生命周期约束、自动图像解码与人工证据真实性验证。它们保持 `PARTIAL / ENGINE_GAP`，需按规范由作品团队人工验收或后续补齐，不能因本门禁返回 PASS 而宣称整部作品或 v0.2 全量合规。
