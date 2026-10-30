# v1.2.1 稳定性与本地 / CI 联调

本轮基线与范围见 [方案](OPTIMIZATION-v1.2.1.md)。仅修改引擎，没有迁移四作、修改正文或玩家数据。1.2.1 是代码版本，不创建正式 Release / tag。

## 可复现问题

合法调查章节 `a` 和 `a/b` 被旧资源图的首个前缀匹配混淆。真实 `InvestigationDriver` 返回 `sceneId: start, lineId: a/b/start` 时，旧查询返回空 candidates 和 `unknown-position`，实际播放器也没有预取后续背景。Node 和 Chromium 旧码断言均失败，原始记录保留于 `test-results/investigation-prefix-old-code.log`、`prefix-browser-old.log`。

内部图查找、队列和去重改用章节 / 节点结构键。测试覆盖章节数组两种顺序、章节前缀、章节和节点都含 `/` 时的完全组合碰撞、默认入口、显式章节、真实 frame 和存档恢复。只给歧义组合 ID 时明确返回 unknown，实际 frame 的独立 sceneId 可消除歧义。公开 lineId、舞台键、owner、来源路径和存档格式不变。

独立复核补充了断链诊断的兼容回归：内部结构键不进入 `missing-target.owner`；四种项目仍返回原公开节点标识。旧码失败记录为 `test-results/investigation-owner-old-code.log`。

## 标准入口

`npm run test:browser` 包含 41 个浏览器脚本，其中包括 P0/P1 的六项专项；`npm run test:editor` 包含 19 项作者脚本，全部在完整浏览器集合内。`gate:release` 因复用完整浏览器入口同步获得这些检查。Linux CI 使用同一入口并删除重复执行；Windows 继续通过共享 `test:p0` / `test:p1` 运行对应 Node 与真实浏览器专项。

该调整不放宽失败退出或正式作品门禁。样例文件 / 路线 / 解码 / 包检查与内容终审继续分别记录。

## 性能范围

同机 Node v24.14.0、65 节点调查图，300 次预热后交替执行五轮、每轮 1000 次查询。最终中位数由 0.117 ms 变为 0.130 ms，最慢轮次均值为 0.134 / 0.160 ms；按 10% 阈值记 WARN。绝对变化约 0.013 ms，先前同法一次测量为 -2.2%，短时微基准存在波动，不能据此宣称速度提升或宏观退化。这里只测静态规划，不测下载、渲染、实体设备或进程总内存。

基线模块最终保留在忽略的 test-results 中，验收前移出 dist；以干净构建重跑完整浏览器 / 编辑器，避免比较模块进入实际打包输入。原始数据为 `test-results/planner-benchmark.json`，当前值也保留于机器记录。

## 证据记录

本机最终结果与源文件 SHA256 记录于 [机器记录](v1.2.1-validation.json)。本机符号链接权限失败、自动化浏览器、云端 Linux 和 Windows 原生分别记录；未执行的人工系统对话框、实体设备和主观听感不计通过。

云端结果须由本轮实际推送的精确提交核对；本文件不预先宣告 CI 成功。完成后将 run URL、结论与 SHA 保存为本地 `test-results/v1.2.1-cloud.json`，交付消息提供可访问的工作流链接。基线工作流不能替代本轮验证。
