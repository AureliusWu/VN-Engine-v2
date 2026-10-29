# 正式美术与设备证据门禁 · R4

这是 GALGAME SPEC v0.2 的部分工程门禁。项目契约保持 `GALGAME_SPEC-v0.1`，美术报告保持 `GALGAME_SPEC-v0.2-art-draft`；不声称全部 v0.2 合规。当前文案、美术和听感终审采用 [AI 模拟审阅](AI_ACCEPTANCE.md)。

## 当前正式门禁

开发模式允许草稿。正式校验和 `VN_RELEASE_BUILD=1` 打包分别检查：

- 相关视觉资源显式 READY、TECH_READY、实际清单 SHA256 与 runtimeSha256、真实来源和本地文件。技术就绪不会自动提升美术状态。
- 独立 acceptance.json 中当前源 / 素材 / 证据绑定的 `art:<assetId>` AI 审阅。审核者必须看到实际图片；旧 ART_READY、七项视觉标记或真人签字不能单独批准当前资源。
- 正式立绘的 Character Master、neutral / variant 用途、母版 SHA256，以及 `master:<characterId>` AI 审阅。关联 Neutral 即使未直接出现在场景，也必须存在、READY、技术哈希与 AI 审阅有效；失败、未知和缺失都会传递给差分。
- `visualIntegration` AI 审阅检查实际画面、桌面 / 390px 与交互覆盖；Key Visual 使用声明必须与演出一致。动态人物引用不能凭静态未引用判断为无须审核。
- 清单出现 PLACEHOLDER 会阻断。潜在占位或程序 / 模板来源给出待审警告；是否符合正式视觉风格由实际 AI 美术审阅判断。
- 显式 mobile / pwa / desktop 目标，至少一个为 true。生成的 PWA 正式包须声明 pwa；移动 / PWA 的 mobilePhysicalDevice 仍须真实设备、操作者、日期与证据。浏览器视口和 AI 判断不能补写实体设备 PASS。
- 当前剧情 / 文案 / 听感和实际平台技术结果见 [QA_REPORT.md](QA_REPORT.md)。缺失、过期、抽样或模态不足不通过。

AI PASS 在报告计算中投影为旧视觉结果字段，保留旧字段的可读兼容；不批量改写工程的 DRAFT / READY。更改资源状态、主题或正文后必须按新源复审。模型 / 人的身份、来源真实性与物理设备声明未被文件哈希自动认证。

## 工程元数据与独立审阅

工程中的 releaseEvidence 继续保存目标、技术状态、来源及母版关联。以下未完成示意会阻断；实际 AI 观察与证据清单另存 acceptance.json，不放进玩家包。

```json
{
  "releaseEvidence": {
    "targets": { "mobile": true, "pwa": true, "desktop": true },
    "keyVisual": { "used": false },
    "mobilePhysicalDevice": {
      "status": "UNVERIFIED", "kind": "physical", "device": "UNVERIFIED",
      "reviewer": "UNVERIFIED", "reviewedAt": "", "evidence": "UNVERIFIED"
    },
    "art": {
      "room": {
        "TECH_READY": "UNVERIFIED", "ART_READY": "UNVERIFIED",
        "runtimeSha256": "", "source": "UNVERIFIED"
      }
    }
  }
}
```

母版关联示意：

```json
{
  "characterMasters": {
    "hero": { "masterSha256": "<真实64位SHA256>", "neutralAsset": "hero/neutral" }
  },
  "art": {
    "hero/neutral": { "masterSha256": "<真实64位SHA256>", "characterMaster": { "id": "hero", "role": "neutral" } },
    "hero/smile": { "masterSha256": "<真实64位SHA256>", "characterMaster": { "id": "hero", "role": "variant" } }
  }
}
```

这些是片段，不是能直接放行的完整工程。旧 releaseEvidence.qa、reviewer / reviewedAt 和七项视觉声明仍可读取；独立当前审核与真实字节检查决定现行结果。

## 运行与状态

```bash
npm run validate:spec:release -- /path/to/project.json --acceptance=/path/to/acceptance.json
VN_ENGINE_COMMIT=<40位实际提交SHA> npm run gate:release -- /path/to/project.json --acceptance=/path/to/acceptance.json
VN_RELEASE_BUILD=1 VN_ENGINE_COMMIT=<40位实际提交SHA> npm run build:game -- /path/to/project.json /path/to/new-output --acceptance=/path/to/acceptance.json
```

失败输出结构化 ART / QA / ROUTE / FILE 门禁原因；正式构建记录 artGate / qaGate 和路线摘要。VN_ENGINE_COMMIT 与 GITHUB_SHA 同时存在时必须相同。候选包进一步检查实际文件、源、启动依赖、离线缓存和指纹。

引擎完成、指定作品内容通过、测试包可下载和 GitHub Release 已发布分别记录。AI 模拟审阅替代内容终审的真人签字；实际声音播放、平台测试与声明的实体设备检查继续使用真实证据。
