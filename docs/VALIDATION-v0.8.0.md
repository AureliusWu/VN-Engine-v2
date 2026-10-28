# R4 验证进行中

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
