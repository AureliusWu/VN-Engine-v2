# VN Engine Studio · Windows

这是 VN Engine Studio 的引擎便携构建。程序界面显示引擎版本，GitHub Release 的清单提供源提交与校验摘要。更新范围和兼容约定见 [2.0.0 版本说明](docs/RELEASE-v2.0.0.md) 与 [工程接入与兼容](docs/MIGRATION.md)。

完整解压后运行 `VNEngine.exe`，保留旁边的 `site` 目录。程序需要系统中的 Microsoft Edge WebView2 Runtime；.NET 运行时已包含在此包内。

默认打开可视化编辑器。可以新建工程、编辑节点和分支、绑定资源、试玩、保存 `.vnproj`，以及导出供引擎打包使用的 `.json`。

侧栏“工程恢复”可导出和打开 `.vnrecover`。恢复文件带有工程、布局和待提交的作者输入。请单独备份素材目录，恢复后按工程的相对路径重新绑定。

文件菜单的“运行打包作品”可打开本包的 `demo-game` 目录。它是独立引擎样例；四个正式游戏没有迁移。

- [编辑器使用说明](docs/EDITOR.md)
- [Windows 使用说明](docs/WINDOWS.md)
- [实际验证记录](docs/VALIDATION.md)
- [来源与许可](THIRD_PARTY_NOTICES.md)

工程与作品存档保存在用户配置目录。资源另存遇到内容不同的已有文件时，会保留原文件并提示冲突。F11 全屏/恢复，最小化会暂停阅读与声音。
