# R4 验证 · 0.8.0 alpha

状态：**引擎工程交付完成；实际作品全量内容终审未全部通过**。2026-10-29（北京时间）。最终实现 `b10feaeba17d605935c3721431b816c68c8880c4`；后续文档提交与该实现的 CI 证据分别记录。

| 范围 | 最终实际结果 |
| --- | --- |
| 核心 | 221 项 Node、6 项 Python、176 项来源、Agent schemas 与四工程开发校验通过 |
| 完整浏览器 / Studio | [Engine checks 40797015632](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40797015632) 成功，包含完整 test:browser、完整 test:editor 与新生成样例 QA |
| Windows | [Windows native host 40797015450](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40797015450) 成功；31 项 Node 专项、真实 CLI、编译、WebView2、文件桥、外部冲突及完整进程重启 |
| R1—R3 | SDK / CLI、四模板 / Rain、两轮修订、实际新音频字节、旧文件保留、新包子目录断网新页通过 |
| R4 审核协议 | 实际文件导入 / 证据目录 / 保存、改源过期 / 撤销复核、迟到读取取消、390px 键盘与玩家存储隔离通过；合成审核不冒充实际 AI 质量结果 |
| 离线 | 独立作品和独立 Studio 子目录断网新页；Studio 真正打开 preview.html 并运行预览 |
| 四样例 | 10 个用例 / 11 个声明结局 / 73 次逐步存读档；实际文件、解码、成品全部 PASS；正式总报告仍 BLOCKED |
| 版本 | npm / lock / ENGINE_VERSION / Windows / build manifest 为 0.8.0，原生 version-identity 实际通过 |
| 发行 | CI 测试包可下载；GitHub Release、tag 与 npm 包未发布 |

B001—B005 已关闭并由最终提交回归验证，见 [问题关闭表](R4_BUGS.md)。JSON、精确提交、CI / artifact URL 与外层 ZIP SHA256 见 [机器记录](r4-validation.json)，测试包与版本说明见 [准备稿](RELEASE-v0.8.0.md)。

## 实际 AI 观察与限制

已读取精确源 `da7e44cd…73181fdc` 的书店技术样例：全部四行对白、两个选项、两个实际结局与角色 / 创作简报；查看两张原始图片、当前 1280px / 390px 的结束画面及 Studio / Windows 截图。正文与单项原图在此狭小范围通过，完整视觉整合仍只抽样，主观听感未执行。输入哈希、观察理由和范围见 [实际 AI 审阅摘要](r4-ai-review.json)，它不是一份已放行的 acceptance.json。

当前样例仍 DRAFT；没有把接口通过、合成夹具或音频解码写成实际艺术 / 听感 / 实体设备 PASS。当前内容政策已采用 AI 模拟审核，真人内容签字不再单独阻断引擎 alpha。操作系统对话框使用 CI 预设路径；本地 Chromium 下载返回截断 ZIP，完整浏览器结果来自上述确切提交的真实 CI。

三份最新证据 ZIP（AI 审阅输入、四样例 QA、Windows 原生报告）已下载并核对 SHA256 与 CI 上传 / artifact 元数据一致。四份 QA 的 route / files / decoding / build 均 PASS、构建 commit 均为最终实现；六份原生 JSON 的 passed 状态、版本与首次 / 重启范围已读取。

## 历史阶段记录（保留当时状态）

### 初次实施

实施基线为 a039734c8e2e509d5257d194ef042a871917149e。版本已统一为 0.8.0 alpha，跨平台收尾仍在执行。

已加入源 / 素材 / 证据绑定的 AI 模拟终审、独立 acceptance 文件与 schema、SDK / CLI、Studio 和受限 Windows 文件桥。旧人工声明只作历史视图。B001—B003 已加入回归并通过本地专项；完整状态按后续确切提交的 CI 单列。

实际通过的首批专项为 12 项（8 项新 R4 与 4 项 QA 回归），包含三个已知缺陷、无人工签字的新审核、缺模态 / 抽样 / 未解决问题拒绝、实际字节变化、文件冲突、重复请求、版本历史，以及准备 / 替换后真实进程死亡恢复。后续增加的回执重查与原生检查尚待新检查结果。

本地 Chromium 下载返回损坏 ZIP，未将本地浏览器或 Windows 标记通过。完整浏览器、聚焦 Studio、原生文件 / 重启专项由实施提交的 GitHub 工作流执行。CI 合成审核只证明流程；实际作品 AI 审核另行记录。

阶段完整本地 npm run check 已通过：209 项 Node、6 项 Python、176 项来源、schema 与四份开发工程校验。此结果不替代浏览器或 Windows 执行。

完成定义见 [R4 计划](R4_PLAN.md)，接口见 [AI 模拟终审](AI_ACCEPTANCE.md)。四作 / RESET 未迁移，GitHub Release 未创建。

## C 阶段本地与 A/B 的真实 CI

A/B 实现 c5a4bcf55c0d46d054804fea6d2e7688f22db53c 的 Windows native host 40702099894 与 Engine core 通过；browser 40702099855 的 R1—R3 和旧功能回归通过，新终审用例因等待了初始 BLOCKED 而未等待异步结果失败。C 改为等待范围结果，UI 也明确显示核对中并在离开子面板时取消旧读取。

C 增加技术报告适用类别 / Windows 平台拒绝、打包源变化保护、缺失 Neutral 返回阻断；回执重放重查当前证据。独立 Studio 使用作用域隔离的离线缓存，保留 preview.html 的实际文档；新增子目录断网新页和真实预览回归。

npm / lock / 引擎 / Windows 已统一 0.8.0。211 项 Node 与 6 项 Python、schema 和四工程校验通过；来源清单对 tools/pwa.mjs 从 verbatim 改为 adapted，保留原来源哈希，以记录 Studio 的导航缓存适配。Studio 字体由原固定 Rain 字体 SHA256 重建，新增界面文字没有缺字。

实际查看了两张 R2 原图及 Windows 真实场景 / 审阅截图。当前模型不支持音频输入；尝试提供实际音频后工具明确拒绝输入，因此不能把本会话的听感标为 PASS。AI 听感接口和拒绝缺模态回归已实现；实际作品听感仍须具备音频输入能力的 AI 执行。合成测试与此限制分别记录。

## 2026-10-29 断点续跑

核实远端 `07b8c349cbe9b53b24dd4c43cad4712ba23a5eaa` 的 Engine checks `40705933562` 与 Windows native host `40705933603` 均成功；完整浏览器 / 聚焦 Studio / 原生首次和进程重启均有真实日志。已下载审核与原生证据，两份 ZIP 的 SHA256 与 CI 上传摘要一致，并查看桌面、390px Studio 与实际书店样例画面。本地在该基线重跑 211 项 Node、6 项 Python、176 项来源和 schema / 四工程校验通过。

查漏补缺复现 R4-B004：重新计算清单哈希与内容指纹后，损坏 HTML 启动脚本、CSS URL、PWA 图标 / 启动页或从离线缓存漏掉 app.mjs，旧实现的 build 子项仍为 PASS；五个负向用例均在旧实现失败。新增实际入口 / CSS / Web App Manifest / 当前生成 worker 检查，并补充无模块入口、过期缓存指纹及合法查询参数 / fragment / data URI 的回归。检查保留原成品，不修补被检文件。

本次本地 Chromium 下载仍返回截断 ZIP，没有声称本地浏览器执行。新增修复的完整跨平台结果等待本提交 CI，不能沿用 `07b8c34` 的通过结果。

`e85b085` 首次 Windows 扩展检查发现旧 QA 用例的总结果由预期 UNVERIFIED 变成 BLOCKED。进一步用真实目录别名在本地复现 R4-B005：loadAcceptanceOptions 用未规范化的父目录与规范化素材路径比较，错误拒绝合法输入。改为复用现有 filePath 规范化；补充目录别名 / Windows junction 正向检查及外部素材目录拒绝检查。未放宽素材边界，也未跳过 Windows 用例。
