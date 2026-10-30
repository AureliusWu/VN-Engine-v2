# v1.4.0 验证记录

基线 `2135b8b`（v1.3.0），范围见 [规划](PLAN-v1.4.0.md)，官方固定来源见 [参考对照](REFERENCE-MINING-v1.4.0.md)。本轮只调整 Studio 作者编译生命周期，纯 API / CLI / Agent、DSL、JSON IR、VM 和存档格式不变，不迁移四作、不创建正式 Release / tag。

## 任务与真实浏览器

任务监督器 14 项 Node 回归通过，覆盖成功、合法语法 / 清单失败、取消、新任务替换、迟到消息、超时、初始化 / 发送 / 消息解码失败、损坏回复、重试及销毁。Worker 在完成和异常后均 detach / terminate / clearTimer，无同步主线程降级；损坏消息只浅查展示元数据，不重新执行 IR 验证。

Studio 浏览器专项 6 项通过：真实 parser 结果被受控延迟并强制迟到投递，检查取消 / 文本变化 / 身份变化 / 新工程的拒收；资源 id/kind 变化后台复核，标题变化不重编译，复核不自动候选预览；模拟错误和 10000→40ms 的缩短计时器验证失败后真实重试；单次撤销、390px 与另一未包装 context 的真实 7000-cue Worker 均通过。任务延迟、错误和缩短时钟明确是模拟，未计作真实等待 10 秒或实体设备结果。

生成包专项 3 项通过：Studio 包带任务、Worker 与编译依赖，实际子目录部署和断网新页均通过真实 Worker 编译、候选预览、应用及导出。玩家 manifest 排除作者模块，既有 P3 玩家网络 / cache 专项继续通过；实际目录输入不代表人工系统对话框。报告为 `test-results/p4-studio/REPORT.json`、`p4-package/REPORT.json`。

测试初次错误地假设“应用 JSON 身份变化”会清空 DSL 草稿，原始失败保留于 `test-results/p4-studio/INITIAL_TEST_ASSUMPTION.json`；修正夹具以验证草稿保留、旧候选失效，再分别验证新工程 reset，没有改产品行为。最终心跳断言只在 running 状态计数，不把点击前的空闲心跳算入工作期响应。

## 同机性能与回退范围

1360×1000、同一 Chromium 153.0.8010.12，固定 7000 行 / 7000 cue / 627857 UTF-16 字符，源 SHA256 `a420507a744229ae037b1d2c596bc28ce2f48866cd11481a9aeb346ecca45886`。两边均以生成夹具写 textarea 并 dispatch input，再点击真实编译按钮。每侧固定三轮，全部样本保留；新实现未包装 Worker，计时窗口没有其他构建或测试。

| 指标 | 旧中位 | 新中位 | 变化 / 判定 |
| --- | --- | --- | --- |
| 点击到绘制 | 220.90ms | 13.10ms | −94.07%，响应 PASS |
| 主线程心跳最大间隔 | 265.30ms | 138.10ms | −47.95%，改善但仍有结果处理长任务 |
| 候选就绪总 wall | 281.26ms | 297.39ms | +5.74%，PASS |
| 试玩就绪总 wall | 282.77ms | 341.50ms | +20.77%，按默认增长阈值 FAIL，保留观察 |

旧长任务为 241 / 221 / 217ms，新为 98 / 86 / 83ms。Worker 启动、结果结构化克隆、DOM 展示与真实候选播放器校验仍有成本；这些数据不能证明整个引擎提速或所有作者操作都无阻塞。功能 PASS、响应 PASS 与试玩总耗时回退分别报告，综合性能 WARN；没有为取更好结论重抽同代码样本。

原始数据为 `test-results/v140-baseline-performance.json`、`v140-after-performance.json`。此前 locator.fill 大文本的 30 秒 actionability 超时作为 setupFailure 保留，没有算成编译样本；另外 8000-cue Node 组件采样属不同负载，未拿来与上述浏览器做同比。

重新生成的同一校园样例玩家 lib JS 仍为 68 模块、423183 B / gzip 121174 B，无增长。Studio lib 仍为 82 模块；本轮另统计所有 editor JS/CSS，避免只看 lib 漏掉新增 Worker：editor + lib 合计 769623→778486 B（+1.15%），逐文件 gzip 合计 228227→231113 B（+1.26%）。报告为 `test-results/v140-payload.json`，不据此推断网络延迟。

## 完整本地与交付范围

最终 npm run check：Node 381 项，377 通过、4 失败、0 跳过；四项仍为既有 Windows symlink 夹具 EPERM，不改断言。命令在 Node 失败后停止，因此另行执行 Python 6 项、schema 同步、provenance 199 文件和五个工程规范验证，全部通过。

完整浏览器 48 个脚本、完整编辑器 21 个脚本均通过，编辑器最终执行包含只在 running 计数的加强心跳断言。

最终日志、性能、包体与 LF 规范化源 SHA256 见 [机器记录](v1.4.0-validation.json)。推送后另核对同一精确 SHA 的 Linux 381 项零跳过、完整 48 浏览器、Windows P4 同入口与原生通用文件 IO / WebView2 / 完整进程重启，不将 Windows Chromium 专项混称为人工原生 P4 验收。

精确 SHA 的五样例路由 / 文件 / 解码 / 产物 QA、两条 CI 原始日志与原生 JSON 汇总保留于 `test-results/v1.4.0-cloud.json`、`v1.4.0-delivery.json`。技术样例素材仍为 DRAFT，内容终审、实体设备与听感继续按各自范围记录；本文件不提前宣告云端成功。
