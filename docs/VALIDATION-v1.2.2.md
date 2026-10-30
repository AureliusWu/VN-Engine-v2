# v1.2.2 验证记录

基线与范围见 [方案](OPTIMIZATION-v1.2.2.md)。只优化引擎，四作原仓库、正文与玩家数据未迁移；1.2.2 是代码版本，不创建正式 Release / tag。

## 旧码失败与修复回归

1. 在隔离仓库的 dist 加入孤儿 JS 与非模块作者笔记，旧打包器会改变包、manifest 和 SW；即使自洽重算额外模块的字节哈希 / 指纹 / worker，旧 QA 仍返回 build PASS。两项旧码断言均失败，日志为 `test-results/v122-package-old-code.log`。修复后两类包的干净 / 带遗留文件输出完全相同，遗留文件留在原位，QA 拒绝额外 lib 模块。小夹具还检查缺失必需产物、作者模块边界及可见链接拒绝。
2. 真实 Chromium / AudioContext 上，两轨 BGM 与环境音 A→B→A 的预取旧码累计解码为 2→4→6，新码与关闭预取的基线均为 2→4→4，播放启动均为 2→4→6。缓存保留四份编码数据（192,176 B），没有靠驱逐或延长 Blob 生命周期掩盖问题；回访使用新 URL，旧 URL 撤销，dispose 后 URL / 缓存为零且 AudioContext 关闭。同身份只更换 URL 不增加启动、停止或解码。原始旧码报告为 `test-results/resource-audio-old-code/resource-audio/REPORT.json`，新报告为 `test-results/resource-audio/REPORT.json`。该结果不证明实体扬声器听感。
3. `toString` 等变量的等价手写 IR 可以执行，旧 DSL 因继承 Object 属性错报 Duplicate condition；旧码失败见 `test-results/dsl-inherited-condition-old-code.log`。新回归覆盖三种变量名、数值 / 布尔、正负路线、replay / 存档，以及重复条件继续拒绝。

真实打包专项从隔离镜像生成玩家与 Studio，确认旧模块不在包或浏览器 cache 中；两类包均在子目录执行实际工作流并断网新页重开。Studio 在线编写文本并预览，断网后重新打开作者工具并建立聊天工程。报告为 `test-results/package-modules-browser/REPORT.json`，不把它当作实体设备或 Windows 原生验收。

## 完整回归中的端口问题

首次完整浏览器执行在小游戏启动前出现 `net::ERR_UNSAFE_PORT`，实际 URL 端口为 6668，原始失败日志保留于 `test-results/v122-browser-first.log`。修复共享监听后，测试与 Agent 浏览器服务仅绑定 127.0.0.1 的动态高端口，并有限重试冲突；不添加关闭端口安全的浏览器参数，不修改系统配置。失败运行不计作通过，最终完整重跑单列。

## 打包策略对比

同一台 Windows / Node v24.14.0，三轮交替顺序；两侧复制同一份当前 dist（81 份 JS 逐文件哈希相同），固定时间与提交声明。计时只包含 packageGame / packageStudio 调用，导入、复制、盘点与 gzip 排除；全部样本保留，无缓存刷新或预热。

| 目标 | 旧中位 / 最慢 | 新中位 / 最慢 | 输出字节 / 模块数 |
| --- | --- | --- | --- |
| Game | 186.20 / 188.24 ms | 181.63 / 187.33 ms | 591,223 / 68 |
| Studio | 190.99 / 194.50 ms | 189.97 / 193.32 ms | 1,068,021 / 81 |

两侧输出逐文件字节相同，没有观察到明显耗时退化或体积增长。这里只比较打包策略；旧工具加同一当前 dist 的镜像不是历史正式版本，不宣称整版引擎提速。完整数据为 `test-results/v122-package-performance.json`，机器记录保留摘要。

另外按实际保留的 1.2.1 干净包与 1.2.2 包比较同一校园样例的 lib JS：玩家 422,480→423,183 B（+0.17%，gzip +0.15%），Studio 586,678→587,420 B（+0.13%，gzip +0.11%），模块数仍为 68 / 81。该读数包含本轮代码增量，未超过体积警戒；没有据此推断网络延迟。原始记录为 `test-results/v122-runtime-bundle-size.json`。

## 本地、CI 与交付范围

本地最终计数、专项、日志和 LF 规范化后的源文件 SHA256 见 [机器记录](v1.2.2-validation.json)。本机既有四项符号链接创建 EPERM 不跳过、不降低断言；完整 Linux 核心需要由本轮精确 SHA 的 CI 补足。浏览器、Studio、原生 WebView2 / 进程重启、CI 对话框预设路径与人工系统对话框分别记录。

本文件不提前宣告本轮 CI 成功。推送后的真实 run URL、精确 SHA 和原生报告汇总保留于本地 `test-results/v1.2.2-cloud.json` 与 `test-results/v1.2.2-delivery.json`，交付消息提供工作流链接。四样例技术门禁与正式内容终审继续分别报告。
