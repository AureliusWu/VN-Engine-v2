# v2.1.1 Studio 源稿和草稿恢复

基线为正式版 v2.1.0（ab887b7b07cfba449a12600ee40be036d5b7e057）。2026-11-06 核对了项目 Issues、Pull Requests 和发行记录，正式发布后未见公开 Issue 或 PR，仓库未启用 Discussions。本轮采用同类产品反馈筛选风险，再在 VN Engine 基线上复现。 [项目 Issues](https://github.com/AureliusWu/VN-Engine-v2/issues) · [正式基线](https://github.com/AureliusWu/VN-Engine-v2/releases/tag/v2.1.0)

| 来源 | 对应的排查 |
| --- | --- |
| Inky 曾修复 Windows 源码跳转，并为叙事脚本提供可点击诊断。Godot 论坛讨论编辑器对换行的默认约定。 | 核对工程保存的源稿、后台编译输入及编辑框定位是否采用一致的换行与索引。 [Inky 发行记录](https://github.com/inkle/inky/releases/tag/0.15.0) · [Godot 论坛](https://forum.godotengine.org/t/tabs-vs-spaces-in-script-defaults/66320) |
| Ink 用户报告编辑、保存、重开后出现文本损坏。Twine 论坛用户记录了崩溃后的草稿找回和导入问题。 | 从真实编辑过程生成待修草稿，检查恢复是否完整，确认示例命令替换文本时是否提醒。 [Ink #946](https://github.com/inkle/ink/issues/946) · [Interactive Fiction 论坛](https://intfiction.org/t/lost-a-week-of-work-on-my-twine-story-can-it-be-recovered/48077) |
| Twine 用户报告快速点击试玩时遗漏刚编辑的文本。 | 检查编译、应用、预览与保存各自使用的源稿快照。 [Twine #1689](https://github.com/klembot/twinejs/issues/1689) |

1. 使用实际保存的 DSL 源稿参与 Studio 编译与提交检查，诊断和源码范围按编辑框的换行方式定位。核对 Windows CRLF 多行文本的 Studio 和共享编译器输出。
2. 保护未保存的 DSL 输入。载入语法示例前确认是否替换，取消时保留文本与当前编译状态。
3. 修复制作反馈恢复失败造成的工作区部分切换。验证本地草稿和便携恢复经过一致的检查，并明确待修工程与反馈定位的处理边界。
4. 本地完整核心、浏览器和编辑器回归与同一提交的 Linux、Windows CI 分开记录。下载 Windows 候选工件，核对外层 SHA-256、内层文件与构建身份，再从收到的包验证修复。
