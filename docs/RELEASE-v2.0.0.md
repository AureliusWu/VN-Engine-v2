# VN Engine v2.0.0

Studio 增加了多工程草稿库。切换工程时会保存当前未保存内容，多个标签页各自保存。草稿库按保存时间列出可恢复的工作区。选择条目即可恢复或导出，也可以确认删除。恢复旧快照后的编辑会成为独立条目，原快照可作为回退点。

旧版单槽草稿会出现在草稿库里。`.vnproj` 和 `.vnrecover` 可继续用于保存工程和跨设备交接。浏览器和 Windows 都会拒绝含重复顶层字段的 `.vnrecover`。恢复后可重新绑定素材目录。

从 GitHub Release 下载 `VNEngine-Studio-2.0.0-win-x64.zip`，对照 `SHA256SUMS.txt` 检查摘要。完整解压后运行 `VNEngine.exe`，保留同目录的 `site`、文档和许可文件。便携包包含 .NET 运行时，Windows 需要 Microsoft Edge WebView2 Runtime。 [GitHub Releases](https://github.com/AureliusWu/VN-Engine-v2/releases)

回退到 1.x 前，请把需要保留的草稿分别导出为 `.vnrecover`，或恢复后另存为 `.vnproj`。1.x 可打开这些文件。草稿库按浏览器或 WebView2 配置保存在本机，素材请另行备份。 [Studio 使用说明](EDITOR.md) · [Windows 使用说明](WINDOWS.md)

发行清单记录源提交、工作流和包摘要。包内样例用于技术演示。 [升级计划](PLAN-v2.0.0.md) · [验证范围](VALIDATION-v2.0.0.md)
