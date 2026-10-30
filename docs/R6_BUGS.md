# R6 问题与回归

基线为 `b297a570e0156183b334552cd469ba8621abc78d`，目标 0.8.2 alpha。预检来源与范围见 [计划](R6_PLAN.md) 和 [预检记录](r6-preflight.json)。

| 编号 | 预检证据 | 状态 |
| --- | --- | --- |
| R6-B001 | 本机 Edge 实际输入未应用 JSON，再点当前页签后文本回到旧标题；受控回归确认后续保存会覆盖可恢复草稿 | 已修复；R6 Studio 6 组覆盖原文 / 草稿 / 导出 / 明确丢弃立即刷新，实机重点击与应用成功 |
| R6-B002 | 实际预览点击隐藏后按 H 无变化；鼠标恢复后再按 H 也无变化；受控回归确认焦点在隐藏按钮或 BODY | 已修复；R6 运行时浏览器覆盖 H / Enter / 数字及外部 / 面板焦点，实机进入结局 |
| R6-B003 | 受控 Node / 实际 HTML 音频回归：标题开始后首句 0 个 SE，下一句同素材正常播放 | 已修复；媒体 / 稳定性 Node 25 项与 R6 实际音频生命周期回归通过 |
| R6-B004 | snapshot-ready 阶段在输出创建 index.html sentinel，构建成功却覆盖该文件 | 已修复；共享暂存发布，晚文件 / junction / 修改暂存 / 并发发布检查保留字节 |
| R6-B005 | Windows 的 Index.html 素材与生成 index.html 同时进清单、实际文件被覆盖，素材 SHA 与清单不符 | 已修复；全表大小写与每级祖先检查，R6 打包 13 项含共享素材 / 许可与非相邻前缀 |

测试入口为 tests/r6-studio-browser.mjs、tests/r6-runtime-browser.mjs、tests/runtime-media.test.mjs 和 tests/r6-package.test.mjs。完整结果见 [R6 验证](VALIDATION-v0.8.2.md)。实机可见行为、受控自动回归和 Windows 原生 CI 分开记录，不据这些结果宣称零缺陷或正式作品验收。
