# 下一轮优化：声音、阅读与存档备份

基线：`2f3f9a86d781f8a76262b31f7a810155713ddee0`，2026-10-27。版本保持 **0.3.0 alpha**，仅优化引擎；四作与 RESET 不迁移、不修改、不发布。

| 顺序 | 问题与目标 | 验收要求 | 状态 |
| --- | --- | --- | --- |
| 1 | §28、45：BGM、环境音、SE 共用音量，缺少总音量；补独立分轨与视频音量 | 旧设置保留；实时调音不重播；静音、暂停、读档与持久化正确 | PASS，`d0f6e36` 浏览器及 Windows CI 成功 |
| 2 | §46–49、96：补字号、高对比、快捷键说明和弹层焦点 | VN / 聊天 / 文书可读；窄屏可滚动；键盘不穿透弹层或嵌套回看 | PASS，`0ff9841` 浏览器及 Windows CI 成功 |
| 3 | §36–41、59、110–112：现有导出只含当前位置；补多槽备份 | 导入前预览，独立验证真实路线；拒绝跨游戏、伪造、重复槽；只覆盖列出的槽，检测预览后冲突，配额失败报告回滚结果 | PASS，`9f7e422` 浏览器及 Windows CI 成功；119 项 Node、6 项 Python、116 个来源与编辑器通过 |

每步更新来源与 CHANGELOG，小步提交到 main；提交前运行 `npm run check`，界面变化运行完整浏览器回归。Windows 原生另由对应提交工作流执行，不提前标成功。

本轮不把音量数值、浏览器视口或合成测试当作正式听感、美术或实体移动设备验收。存档备份不包含独立 Meta 收藏 / 已读记录或设置，不隐式解锁内容。

三项均已完成并分别推送。最终实现提交 `9f7e4221de638ab44e945dfdb96a05a350b73ddb` 的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40488332833) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40488332817) 均成功。按该提交锁重建四样例后，实际文件、解码与包完整性均 PASS；生产验收继续 BLOCKED。完整机器记录见 [optimization-next-validation.json](optimization-next-validation.json)，备份范围与并发限制见 [SAVE_BACKUP](SAVE_BACKUP.md)。
