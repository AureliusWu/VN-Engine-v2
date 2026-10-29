# R4 问题关闭表

验证实现：`b10feaeba17d605935c3721431b816c68c8880c4`，0.8.0 alpha。2026-10-29。所有结论绑定该提交的真实 CI；不宣称零 BUG。

| 编号 / 级别 | 复现与影响 | 修复 | 回归 / 最终状态 |
| --- | --- | --- | --- |
| R4-B001 / P0 | 正文改变，保留旧 qa 声明仍 PASS；过期审核可错误放行 | c5a4bcf：独立 AI 审阅绑定精确源、实际素材 / 许可、证据和规则；旧 humanQa 仅历史视图 | acceptance.test.mjs 与 qa-report.test.mjs，源 / 目标 / 证据变化拒绝；FIXED_VERIFIED |
| R4-B002 / P0 | 只引用 smile 时，关联 Neutral 的 runtimeSha256 失效未传递；直接引用 Neutral 才阻断 | c5a4bcf / 07b8c34：沿母版完整核对 Neutral 的存在、READY、技术哈希与当前 AI 结果 | acceptance.test.mjs / art-gate.test.mjs；失配、DRAFT、缺失的 Neutral 均阻断差分；FIXED_VERIFIED |
| R4-B003 / P0 | 删除 app.mjs，同时从清单漏列；旧 build 子检查仍 PASS | c5a4bcf：必需文件、模块依赖、当前源 / 引擎身份、实际大小 / SHA 与指纹复核 | acceptance.test.mjs；漏启动、漏模块、错指纹、同版本旧源、损坏字节拒绝；FIXED_VERIFIED |
| R4-B004 / P0 | 重新计算文件哈希与指纹后，HTML 指向缺失脚本、CSS URL / PWA 图标 / 启动页断链或缓存漏 app.mjs，仍 PASS | e85b085：检查实际 HTML 模块入口 / CSS / Web App Manifest，核对完整离线缓存及当前 worker 作用域 / 指纹 | qa-report.test.mjs：七种损坏、合法 query / fragment / data URI、被检包不改写；Linux / Windows 通过；FIXED_VERIFIED |
| R4-B005 / P1 | Windows 新增 QA 回归出现 UNVERIFIED → BLOCKED；本地用真实目录别名复现，合法审核误拒绝 | b10feae：终审宿主复用 filePath 规范化工程父目录，再检查素材边界 | qa-report.test.mjs：目录别名 / Windows junction 正向通过，目录外素材仍拒绝；FIXED_VERIFIED |

B001—B003 的旧实现复现保留在 [r4-preflight.json](r4-preflight.json)，它是 2026-10-28 规划时的历史记录。B004 的前五个损坏断言在 07b8c34 实现实际得到 PASS，回归因此失败；修复后七种损坏均 FAIL。B005 在 e85b085 的 Windows run 40796554578 失败，目录别名回归在修复前同样失败；最终 b10feae 复测通过，没有把失败 run 改记为成功。

## 查漏补缺执行范围

| 区域 | 已执行的证据 |
| --- | --- |
| Agent / 文件 / 恢复 | 核心测试及 Windows 31 项专项；重复请求、冲突、实际进程死亡恢复、终审历史与证据重查 |
| Studio 审阅 | 完整浏览器及聚焦 Studio；真实文件 / 证据目录、错误保留、过期、撤销、迟到读取取消、存储隔离 |
| 玩家存储 | 四驱动、手动 / Quick / Auto / Continue、备份预览与冲突、回滚 / Meta / 回看隔离；原生完整重启 |
| 媒体 / 生命周期 | 完整浏览器的真实音频图、一次性音效、暂停 / 恢复、坏图 / 视频回退、过期回调；Node 生命周期及 Studio 清理 |
| 剧情 / 引用 | R1—R3 SDK / CLI、四模板 / Rain、作者字段与派生 ID；四样例 10 用例 / 11 结局 / 73 存读档 |
| 布局 / 输入 | 390px、字号 / 高对比、长内容、弹层焦点与字体的已有浏览器回归；实际查看当前样例桌面 / 390px 截图 |
| 打包 / 离线 | 新生成包的子目录断网新页，独立 Studio 实际预览；清单 / 指纹 / 启动 / 缓存负向回归 |

执行范围是现有及本轮新增用例，不是所有设备、所有故事组合或任意外部 HTML / JavaScript 的证明。完整实际听感、指定作品全部画面的 AI 视觉审阅、实体设备及系统文件对话框人工操作未执行，不能标 PASS。
