# P4 Studio 后台编译 · v1.4.0

基于 [参考对照](REFERENCE-MINING-v1.4.0.md) 实施 [规划](PLAN-v1.4.0.md)。现有 [P3 语法和纯 API](P3_DEVELOPMENT.md) 不变，后台编译只属于 Studio 作者入口。

## 任务与状态

点击“编译并预览”启动独立 module Worker；语法编译、当前 id/kind 清单检查、完整 JSON 格式化均在线程内。界面只显示前 200 个来源和最多 100000 字符的 JSON 预览，截断时明确提示。编译总成本和返回结果的结构化克隆仍存在，不能由 Worker 推断整版引擎提速。

任务 10 秒未返回、脚本加载失败、初始化 / 发送 / 消息解码失败均终止 Worker、清理计时器并提示重试，不在主线程重试同步编译。“取消编译”保留文本和当前 JSON。每次任务有独立 requestId，先结束旧任务；即使旧回调已排队，也须同时匹配当前任务与序号。

新文本、载入示例、草稿恢复、工程替换、reset 和 dispose 取消旧任务。任务结果还必须匹配当前文本、工程 type/game/version 与整个最小资源清单快照，才可显示候选、预览或应用。已尝试文本遇清单变化会后台重新编译检查，完成前禁止应用；后台复核不自动刷新候选预览。标题、UI 等无关字段变化不重新编译。

状态为 idle / running / success / invalid / cancelled / error / stale，面板使用 aria-busy，运行期间保留取消入口。语法、缺失资源、种类与身份诊断继续使用 P3 的 code/path/UTF-16 span。失败或取消不产生可应用候选。

## 应用与边界

应用前再次同步比较最小清单和文本身份；发现变化先后台核查。成功仍只替换 program，并形成一次可撤销事务，其余工程字段保留。候选播放器启动、完整工程校验及实际应用是独立主线程 / 预览工作，不由后台编译免除成本。

Studio 包携带 editor/text-compile-task.mjs、editor/text-compile-worker.mjs 及已有 lib/script/text.js 和 text/project.js；离线 service worker 沿既有完整清单缓存。玩家包不携带 editor 或 DSL 作者模块，不修改 IR、VM、路线权威、存档或四作。

`npm run test:p4` 执行任务监督器与两个浏览器专项；完整 test:browser / test:editor 和 Windows 同一入口包含相应检查。替身的延迟、错误和缩短时钟用于生命周期验证，真实大文本及离线 module Worker 另行执行，范围与结果见 [验证记录](VALIDATION-v1.4.0.md)。
