# VN Engine v1.5.0

v1.5.0 为 Studio 增加可跨设备使用的工程恢复文件，并修复恢复本地草稿后原始来源身份丢失的问题。

## 工程恢复

- 在 Studio 侧栏选择“导出恢复文件”，生成 `.vnrecover`。文件保存工程、节点布局、未应用的 JSON、DSL 文本、待提交字段及制作审阅。即使字段仍需修正，也能先导出。
- 在目标设备选择“打开恢复文件”。Studio 校验格式、大小和项目数据，再替换当前工作区。请在目标设备重新绑定素材目录。Windows 使用受限的原生打开与原子保存流程。
- 工程未改写时，保留打开时采用的原始运行 JSON。恢复后，来源 SHA 仍由实际文本计算。素材和报告绑定仍按当前文件独立核对。
- v1.4.x 的本地草稿仍可读。普通 `.vnproj`、运行 `.json` 和玩家存档继续使用各自格式。16 MB 是恢复文件上限，浏览器自动草稿还受所在配置的存储配额限制。

## 下载与升级

从 [GitHub Releases](https://github.com/AureliusWu/VN-Engine-v2/releases) 下载 `VNEngine-Studio-1.5.0-win-x64.zip`，按 `SHA256SUMS.txt` 核对摘要。完整解压后运行 `VNEngine.exe`，保留旁边的 `site` 和许可文件。便携包自带 .NET 运行时，Windows 需要 Microsoft Edge WebView2 Runtime。

工作区与素材建议分别备份。若需要回退到旧版，请先从 v1.5.0 保存普通 `.vnproj` 并另外保留素材和审阅文件。旧版读取普通工程和运行数据，新恢复文件用于 v1.5.0 及支持该格式的版本。[编辑器使用说明](EDITOR.md) · [Windows 使用说明](WINDOWS.md)

GitHub Release 的 `RELEASE_MANIFEST.json` 记录源提交、工作流及校验摘要，`RELEASE_NOTES.md` 记录本次交付的具体身份。包内独立样例用于技术演示，内容验收单独记录。[计划](PLAN-v1.5.0.md) · [验证](VALIDATION-v1.5.0.md)
