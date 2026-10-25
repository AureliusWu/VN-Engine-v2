# 来源与许可

本仓库的原创代码及样例采用 MIT，版权归 AureliusWu。已保留原项目的许可证文本。

- Rain：《雨停之前》；原始代码 MIT，见 `licenses/Rain-LICENSE.txt`。本仓库复用其结构化剧情校验、原生 DSL 编译与共用契约。
- Healing：《湿性愈合》；MIT，见 `licenses/Healing-LICENSE.txt`。复用其剧情重建、重读、表现与存档经验。
- NetLove：《“网”恋》；MIT，见 `licenses/NetLove-LICENSE.txt`。复用其聊天原生规则、媒体生命周期与 PWA 工具。
- Circuit：《回路》；来源是同一所有者 AureliusWu 的仓库，依据本次明确的抽取指令改编。源快照未提供独立根 LICENSE，本仓库没有伪造一个原项目许可证；改编代码采用本仓库 MIT，来源与具体改动记录在 provenance。
- 示例字体 VN Demo Sans：从 Rain 的 SourceHanSansLite 再子集化、改名，源字体遵循 SIL OFL 1.1，见 `licenses/SourceHanSans-OFL.txt`。修改后未沿用原字体名。

精确提交、来源路径与内容哈希见 `docs/provenance.json`。原四作的完整正文、角色美术、声音与模型没有随引擎重新分发。

Ren’Py SDK 未包含在仓库内，其自身与所含第三方组件依原许可证分发。开发依赖 TypeScript 与 Playwright 使用各自的 Apache-2.0 等许可；npm 安装包自带许可文件。

0.2 新增解释器、调度、DOM/媒体宿主与打包器为本仓库自研代码。examples/runtime 的 SVG 和合成测试音是代码生成的技术示例。VN Runtime Sans 同样由上述 OFL 字体子集化并改名，其许可随项目资源一同分发。

0.3 的编辑器、作者命令和 Windows 宿主为本仓库新实现。编辑器字体 VN Studio Sans 由同一 OFL 源字体子集化并改名，许可随 `editor/OFL.txt` 分发。Windows 使用 .NET/WinForms 与 Microsoft.Web.WebView2 SDK；对应代码与组件依其 [Microsoft .NET 许可](https://github.com/dotnet/runtime/blob/main/LICENSE.TXT) 和 [WebView2 SDK 许可](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3537.50/License) 使用。系统 WebView2 Runtime 不存入源码库，遵循 Microsoft 分发条款。
