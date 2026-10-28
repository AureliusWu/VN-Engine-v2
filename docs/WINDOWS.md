# Windows 原生宿主 0.4

本仓库实现 WinForms 原生窗口与 WebView2 宿主。剧本、状态、调度、DOM 和媒体仍由本仓库自研引擎执行。桌面程序不启动 Node 服务；本地虚拟 HTTPS 来源映射自身内容，运行作品可完全使用磁盘资源。

## 使用

从 `Windows native host` Actions 的 `VNEngine-Studio-win-x64` artifact 下载便携包，完整解压，然后运行 `VNEngine.exe`。保留同目录的 `site`；包内 `demo-game` 是引擎独立校园样例，未迁移任何正式游戏。需要 Microsoft Edge WebView2 Runtime，.NET 运行时已随自包含构建带入。程序以普通用户权限运行。

- 默认进入可视化编辑器，原生打开 `.vnproj` / `.json`、保存工程、导出运行数据、选择资源目录。
- 0.4 的“章节与变量”工作台和类型化效果表单与浏览器共用实现；CI 额外核对 EXE 与内置引擎版本一致，并在真实 WebView2 / 进程重启后执行变量和跨章流程。
- 文件菜单“运行打包作品”选择包含 `build-manifest.json` 的引擎产物目录；启动前核对每个文件的大小与 SHA-256。
- F11 全屏/恢复，记住窗口位置。最小化暂停实际引擎会话，恢复继续；编辑器的预览同样受控。
- 作品窗口使用播放器自己的存读档、历史、设置与备份；JSON 备份下载通过原生保存对话框。工程和作品使用不同的持久化目录。

```powershell
VNEngine.exe --game "C:\MyGame"
```

存储位置：`%LOCALAPPDATA%\VNEngine\Studio` 与 `%LOCALAPPDATA%\VNEngine\Games\<game-id-hash>`。作品身份决定稳定配置目录和本地来源；换路径不更换该作品存档空间，不同作品隔离。变更发行作品身份仍需显式兼容方案。

另存工程时，已绑定的引用资源按相对路径复制；已有不同文件会阻止操作并保留原内容。草稿可以保留缺失资源的引用，运行数据导出要求资源可读。目录绑定、文件选择与覆盖确认由系统对话框完成。

## 构建

需要 Windows、Node.js 22+ 与 .NET 10 SDK。WebView2 SDK 固定在项目文件中，实际 WebView2 Runtime 由系统提供。

```powershell
npm ci
npm run build
node tools/package-studio.mjs build/windows/site
node tools/package-game.mjs examples/runtime/campus.json build/windows/demo-game
dotnet publish hosts/windows/VNEngine.Windows.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o build/windows/app
Copy-Item build/windows/site build/windows/app/site -Recurse
Copy-Item build/windows/demo-game build/windows/app/demo-game -Recurse
./tools/test-windows.ps1 -Executable build/windows/app/VNEngine.exe -Site build/windows/app/site -Game build/windows/app/demo-game
```

输出是 EXE 与本地内容组成的便携目录。SDK、依赖、生成代码、构建 EXE 和浏览器配置不入源码仓库；CI 保留 ZIP 与验证证据。

## 边界和验收

原生桥只接受精确编辑器顶层来源及四个明确命令；作品窗口关闭这条桥。资源读取要求有效随机工作区、清单路径和授权目录，拒绝目录穿越、链接/联接点与 Windows 设备名。外部导航、窗口、设备权限和网络资源默认阻断，不提供任意命令执行或任意文件读取入口。

Windows CI 包含宿主策略/文件 I/O、实际 WebView2 启动、工程资源打开/另存/重开、导出、全屏、最小化暂停，以及编辑器和作品完整进程重启后的持久化。CI 文件选择使用预设路径；人工点击系统文件/目录对话框、签名安装包、自动更新、其他架构和多种实体 Windows 设备尚未验收。

本轮 Windows 实际结果以 [VALIDATION.md](VALIDATION.md) 和对应 Actions 报告为准；源码与构建配置存在不等同于原生执行成功。四个游戏的迁移仍只在用户主动、明确提出后执行。

API 依据：[WebView2 本地内容](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/working-with-local-content)、[宿主安全边界](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security)、[dotnet publish](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-publish)。

## 0.7 独立作者审阅

Studio 通过受限文件桥分别打开 / 原子保存 review.json，检查外部修改并保护工程 / 清单资源，反馈不混入 .vnproj 或玩家数据。原生 CI 使用预设路径，覆盖修复 / 合成复验 / 重开、文件再打开、外部冲突、完整进程重启及最新 CLI 修订包 / 实际字节 / 试听。系统对话框人工操作、人耳与实体设备终审仍单列未验收，见 [0.7.0](VALIDATION-v0.7.0.md)。
