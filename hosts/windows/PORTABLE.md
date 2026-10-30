# VN Engine Studio · Windows

本次为 1.0.0 引擎便携构建，版本与产物源提交可在程序中核对。更新范围和兼容约定见 [版本说明](docs/RELEASE-v1.0.0.md) 与 [1.x 兼容](docs/V1_COMPATIBILITY.md)。

完整解压后运行 `VNEngine.exe`，保留旁边的 `site` 目录。程序需要系统中的 Microsoft Edge WebView2 Runtime；.NET 运行时已包含在此包内。

默认打开可视化编辑器。可以新建工程、编辑节点和分支、绑定资源、试玩、保存 `.vnproj`，以及导出供引擎打包使用的 `.json`。

文件菜单的“运行打包作品”可打开本包的 `demo-game` 目录。它是独立引擎样例；四个正式游戏没有迁移。

- [编辑器使用说明](docs/EDITOR.md)
- [Windows 使用说明](docs/WINDOWS.md)
- [实际验证记录](docs/VALIDATION.md)
- [来源与许可](THIRD_PARTY_NOTICES.md)

工程与作品存档保存在用户配置目录。资源另存遇到内容不同的已有文件时，会保留原文件并提示冲突。F11 全屏/恢复，最小化会暂停阅读与声音。
