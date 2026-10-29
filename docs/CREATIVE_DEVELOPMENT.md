# R2 AI 内容生产与接入 · v0.6.0

> R4 政策更新：文案、美术和听感终审改为有实际输入绑定的 AI 模拟审核；技术与实体设备检查保留。当前接口见 [AI_ACCEPTANCE.md](AI_ACCEPTANCE.md)。以下旧人工声明属于旧契约 / 历史范围，不再单独批准当前内容。

`vn-creative-v1` 是 `vn-agent-v1` 的兼容扩展。工程、EditorDocument 与玩家存档继续使用 schema 1。创作简报、角色、节拍、任务和 UI 写在同一 EngineProject，Studio、Agent 预览和独立作品使用同一自研播放器。四作与 RESET 未迁移。

## 可复制的完整流程

```bash
npm ci
npm run build
npx playwright install chromium
# 下面两个命令分别使用 Node 文件 SDK 和真正的 JSON CLI。
node tools/creative-example.mjs build/r2-sdk
node tools/creative-example.mjs build/r2-cli --cli
```

输出目录必须是新的工作目录。每种调用都完成：capabilities → probe 实际文件 → init → 简报 / 角色 / 六类任务 → dry-run → 素材导入 / 台词 / 条件 / 演出 / 主题 → inspect / refs → review → validate → 路线与逐步存读档 → 桌面和 390px 预览 → 独立包。`TRANSCRIPT.json` 保存全部请求和响应，另有 MEDIA_REPORT、ROUTE_REPORT、CREATIVE_REPORT、两份预览和 `game/`。样例仅采用独立命名空间；开发预览不写玩家 Save、Meta 或已读。

样例《The Last Returned Book》有两幅实际生成的书店 / 角色插画，精确提示词在 [prompts.json](../examples/creative/prompts.json)。来源为内置 `image_gen.imagegen`；素材位于 `examples/creative/assets/bookshop-r2.png`、`an-r2.png`。配乐为 A 小调、96 BPM、四小节原创加法合成，雨声和门铃为程序音效；乐谱、参数与可重建源码见 [generate-creative-audio.py](../tools/generate-creative-audio.py)。字体沿用改名的 OFL 子集，许可证随导入和作品分发。

## 创作上下文与共享校验

入口是 `production: {schema:1,brief,characters,beats,tasks}`。简报描述前提、语气、视觉、音乐、声音、文风和受众。角色有稳定 `id`、姓名、设定和可选视觉 / 声音说明；节拍关联具体节点 / 台词、角色与制作任务。任务的 `kind` 为 `art / music / ui / sfx / text / story`，可记录提示词、来源、依赖、角色、目标和输出 asset ID。

任务状态仅为 `planned / draft / review`。它们描述制作过程；素材自己的 `DRAFT / REVIEW / READY` 与独立 AI 内容终审是另一份记录，导入、生成和技术 PASS 都不会自动升级内容批准。本样例所有素材保持 DRAFT，正式构建明确 BLOCKED。

节点 / 台词以 `{nodeId,chapterId?,lineId?}` 定位；调查节点需要准确章节。循环依赖、重复 ID、悬空角色 / 任务 / 输出 / 目标、非法状态由 Studio 和 runtime 共用校验。批次可暂时不完整，最终状态必须有效。节点、章节、角色、任务和显式台词重命名同步制作引用；台词重命名同时同步演出和路线断言，已有回看存档要求重新录制。受引用实体不能静默删除；Studio 临时断链仍会阻止导出。

## 可发现的编辑与审查

`capabilities` 声明扩展、预算、操作和 schema 路径。`capabilities {schema:"production"}` / `"ui"` 返回真实可执行 schema；`npm run check` 检查导出文件漂移。

| 入口 | 参数与作用 |
| --- | --- |
| inspect | kind 为 text / production / characters / beats / tasks / ui / assets，沿用有界分页与片段；可传 query、characterId、taskKind |
| refs | character / task / line，以及原 node / chapter / asset，返回准确字段路径 |
| production.patch | 合并顶层字段和 brief 字段，保留未修改的扩展；数组显式替换 |
| character / beat / task .put / .rename / .remove | 稳定 id 编辑、引用同步与删除保护，put 合并指定字段 |
| line.rename | nodeId + id + newId，只重命名显式台词 ID，保留正文与作者扩展 |
| ui.set | 整体设置有限主题令牌；非法色值、未知主题参数和脚本 / CSS 注入被拒绝 |
| review | 分页返回机械审查摘要与定位，不写源文件或审核状态 |

characterId 在文本目录按该角色当前姓名匹配 speaker，在节拍 / 任务按实际 characters 引用过滤；不推测别名或人物关系。query 为大小写不敏感的目录字段检索。分页游标绑定源 SHA 和全部查询过滤条件，改变范围需重新读取。

review 识别空 / 长 / 占位文本、待审任务、未绑定输出 / 节拍、语音的文本与发言人来源不匹配、低对比主题等。默认每页 20 项、16384 字节；最大 100 项、65536 字节。机械 PASS 仍带 `literaryQuality: UNVERIFIED` 和 `humanAcceptance: UNVERIFIED`。它不能确认文学质量、剧情一致性、美术质量或听感。

## 实际素材探测

`probe` 不需要 project，接收最多 16 个 `{id,file,kind}` 和可选 output / probeMs。Node SDK 和 CLI 使用真实 Chromium，在禁止外部连接的隔离页面解码；纯 SDK 需注入 `probe` 端口，缺失时为 HOST_PORT_REQUIRED / UNVERIFIED。

返回原字节 SHA256、长度、扩展名、建议内容寻址路径、实际解码状态；图片有尺寸与抽样透明度，字体实际 load，视频仅首帧。音频整段解码后给出时长、声道、峰值、RMS、静音比例、接近满幅比例和首尾采样差。Web Audio 分析固定重采样到 48000 Hz；WAVE 的原始采样率 / 位深另在 `container`，其他容器不猜测原采样率。首尾差小不等于听感无缝循环，解码通过不等于播放或听感通过。

单文件 64 MiB，总字节 256 MiB；图片 16 MP、分析音频 2880 万采样，探测预算最多 30 秒，完整请求最多 60 秒。预算耗尽为 UNVERIFIED，损坏 / 缺失为 FAIL。`MEDIA_UNREADABLE / MEDIA_DECODE_FAILED / MEDIA_UNVERIFIED` 带输入字段位置；输出仍为 JSON。

## 不可变导入与恢复

`apply.params.imports` 接收最多 32 个 `{source,sha256,extension}`。对应 asset.src 或 license.src 必须显式使用 `assets/imported/<sha256>.<extension>`；`probe.data.files[].assetPath` 可直接作为建议路径。来源是本地文件，不把外部生成器账户或网络依赖放进作品。

1. 检查 expectedSourceSha256、原始素材字节与预期 SHA、预算、目标冲突，以及最终项目 / 引用 / 资源。
2. dry-run 返回差异但不创建素材、源文件或回执。
3. 写入 prepared 回执；素材先经临时文件与不覆盖的硬链接发布。既有内容寻址文件只能在哈希一致时复用，不覆盖不同字节或符号链接目录。
4. 最后复核源 SHA，再原子替换工程，记录 committed 回执。外部来源始终保留。

这是工程原子替换与不可变素材发布，并非多文件数据库事务。中断可能留下未引用素材；失败响应的 imported-asset artifacts、importedFiles 与 unreferencedFilesPossible 如实说明；硬取消时 applied 可能为 unknown，应检查工程和回执。不得在仍有活写入者时删除文件。

用相同 requestId 和语义输入重试；死进程锁添加 `recover:true`。回执比对工程 before / after SHA 和导入文件实际存在性：未提交的请求继续，已提交的请求 replay，不重复编辑。已发布素材在外部原文件丢失时仍可用于恢复。缺失已提交素材为 IMPORTED_ASSET_MISSING；源字节变化为 IMPORT_SOURCE_CONFLICT，目标不同内容为 IMPORT_CONFLICT，未绑定导入为 IMPORT_UNUSED。普通字节 / 哈希导入不替代显式 probe 和后续播放验收。

## 主题与验证

`ui: {schema:1,preset:"night"|"paper"|"dusk",colors?,density?,dialogue?}`。颜色只允许六位十六进制；surface / panel / text / muted / accent / border 为有限令牌，density 为 comfortable / compact，dialogue 控制 solid / glass 的毛玻璃风格。玩家字号、对比和阅读透明度继续由玩家设置控制；高对比优先。

`npm run test:creative` 验证两个公开调用方式、真实声音图输出与门铃 playing 事件、暂停时声音时钟停止 / 恢复、恢复不补播一次性音效、Studio 导出 / 预览、390px、两个独立包子目录部署和断网新页重开。完整回归继续执行 R1 四模板、Rain、核心 / Python / 来源 / schema、浏览器和编辑器。Windows 工作流另行执行 CLI、程序 / manifest 版本、真实 WebView2 书店渲染 / 分支 / 读档，以及完整进程重启；结果必须绑定实际实现提交，不能用 Linux 浏览器代替原生结论。

已检查的界面：[桌面](previews/r2-player-desktop.png)、[390px](previews/r2-player-mobile.png)、[Studio 窄屏](previews/r2-studio-mobile.png)。截图不代表实体设备或人工作品终审。
