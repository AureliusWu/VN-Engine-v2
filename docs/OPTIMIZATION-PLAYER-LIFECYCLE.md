# 本轮优化：启动、标题与已读记录

基线：`2ef600769c54d24e555d54031545fad9ef741812`，2026-10-27。只改 VN-Engine-v2，保持 **0.3.0 alpha**；不迁移四作或 RESET，不发布正式作品。

| 顺序 | 工作 | 验收条件 | 状态 |
| --- | --- | --- | --- |
| 1 | 修复挂载时覆盖已有 Auto，增加最近有效存档 Continue | 重开前后旧 Auto 字节不变；按时间寻找真实可恢复路线；损坏槽保留并跳过；四种驱动可继续 | PASS，`9ae181c` 两条 CI 成功 |
| 2 | 可配置标题菜单与危险操作确认 | 开始前不记剧情进度；Continue / Load / Settings / Collections 可操作；新游戏与返回标题可取消；Studio 可配置导出 | PASS，`13b12a3` 两条 CI 成功 |
| 3 | 跨重启已读记录 | 完整显示且实际阅读时记录；按游戏 / 故事版本和准确文本隔离；不跨未读 / 选择；损坏 / 配额失败保持可读，回看与回滚不写记录 | PASS，`2d185bd` 两条 CI 成功；127 项 Node、6 项 Python、119 个来源与完整编辑器通过 |

每步独立提交 main，更新来源与真实验证；运行核心、浏览器及适用的编辑器检查，Windows 原生结果按各提交 CI 单列。标题菜单为显式启用的项目选项，旧项目保留直接进入阅读的行为。已读记录独立于普通存档、Meta 和设置，不自动导入其他版本的阅读标记。

浏览器视口、测试字体和合成音频不作为实体设备、美术或听感验收。

本轮三项已完成并分别推送，最终实现提交 `2d185bd478cb5315fd3b3929ea8cb6d13b406c37` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40493930513) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40493930378) 均成功。四种独立样例按相同提交锁重建，文件 / 解码 / 包检查 PASS；缺少人工证据的生产验收继续 BLOCKED。机器记录见 [player-lifecycle-validation.json](player-lifecycle-validation.json)，使用与容量 / 并发边界见 [PLAYER_LIFECYCLE](PLAYER_LIFECYCLE.md)。
