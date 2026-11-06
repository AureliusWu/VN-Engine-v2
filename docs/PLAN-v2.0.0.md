# v2.0.0 Studio 多工程草稿库

本轮以 v1.5.2 的 `d6e8d83e43511967bdf9fc664e8c45bdbf079485` 为基线。仓库公开 Issues 未发现用户报告。真实 Chromium 复现了两条覆盖路径。同页从 A 切换到 B 后，保存 B 会占用 A 的草稿槽。两个同源标签页分别保存时，关闭较早的 A 也会用其旧数据覆盖 B。已校验的 v1.5.2 Windows 候选包还复现了浏览器读取重复顶层字段时采用最后一个值，导致当前工程被替换。 [Issues](https://github.com/AureliusWu/VN-Engine-v2/issues) · [基线提交](https://github.com/AureliusWu/VN-Engine-v2/commit/d6e8d83e43511967bdf9fc664e8c45bdbf079485)

Twine 作者报告过作品从浏览器消失，讨论中建议用故事归档留独立备份。Twine 的保存状态建议还指出，配额耗尽时作者需要明确知道自动保存失败。Godot 的外部变更案例也表明，工作区切换或忽略外部变更时应先保护编辑内容。这些案例用于选择排查路径。 [Twine 论坛](https://intfiction.org/t/data-lost/43721) · [Twine 保存状态 #1716](https://github.com/klembot/twinejs/issues/1716) · [Godot 外部变更 #117489](https://github.com/godotengine/godot/issues/117489)

- 每个编辑工作区使用独立的本地存储键。每次自动保存仅写当前工作区，切换工程前同步保存，写入失败时保留当前编辑。恢复已归档草稿后，后续编辑会写入一个新条目。
- 草稿库显示可读快照，可恢复、导出为 `.vnrecover`，或确认删除所选条目。所选条目在另一页删除后，需要重新选择才能操作其他草稿。旧版单槽继续读入。草稿配额由浏览器或 WebView2 配置决定，库满时保留旧条目和当前工作区。
- 便携恢复读取器与 Windows 文件桥对齐，拒绝重复的顶层字段，包括转义拼写等同的键。工程数据与 `.vnrecover` 继续使用原有格式。
- 按同一提交验收本地测试、Linux 和 Windows CI、实际下载的 Windows 候选包与离线恢复。正式发行上传候选原件与摘要，再通过公开 Release 接口和实际下载复验。
