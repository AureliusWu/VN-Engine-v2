# v0.6.0 R2 验证记录

R2 技术验收完成。最终实现为 `cfa941cd2afa175a813a9d7a42fa5f6a8148ee01`，文件树 `2290b74c4828f61323592bba3cf8ba6e82883d4b`；在远端 main 的提示词提交 `8d89be92c53981a3675842eccaf668e5a18f8651` 上实现。以下 CI 和下载核对的产物均来自这一确切实现提交；后续收尾文档不冒充另一次实现验收。

| 工作流 | 真实结果 |
| --- | --- |
| [Engine checks · 40641903851](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40641903851) | SUCCESS：核心、完整浏览器、四样例路线 / 字节 / 解码 / 独立包 QA |
| [Windows native host · 40641903899](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40641903899) | SUCCESS：CLI、实际素材探测、编译、程序 / manifest、WebView2、首次启动与完整进程重启 |

完整机器记录见 [r2-validation.json](r2-validation.json)，复现命令见 [CREATIVE_DEVELOPMENT.md](CREATIVE_DEVELOPMENT.md)。

| 范围 | 已验证事实 |
| --- | --- |
| 核心 / Python / schema / 来源 | 194 项 Node、6 项 Python、165 项来源检查，schema 与执行代码一致 |
| 兼容 | R1 SDK / CLI、四模板、Rain 原生格式的 inspect / validate / test / preview / build；项目、编辑器和玩家存档 schema 1 |
| R2 创作 | SDK / CLI 各 15 次公开调用；Windows CLI 13 次（不启用两个 Chromium 预览），均从简报 / 角色 / 六任务到真实素材、主题、文本、条件、路线和独立包 |
| 一致身份 | 上述三种流程生成同一工程 SHA256 `912c8b1bff81101fd0b00ca3ea70f197503c4944f9a92bc9446fe00838770c37`；引擎 / npm / 锁文件 / Windows / build manifest 均为 0.6.0 |
| 路线 / 存档 | 书店样例每流程覆盖两个结局、10 次存读档重建；原四样例 10 用例 / 11 结局 / 73 次重建，技术文件 / 解码 / 构建均 PASS |
| 声音 | 真正 Web Audio 输出非零、音乐和雨声两条循环；设置暂停时声音时钟停止 / 恢复；门铃实际 playing 一次，设置和 restore 不补播。浏览器声音图验证不等于人耳听感验收 |
| 画面 / UI | 实际生成插画 / 字体解码，播放器 / Studio / Agent 预览主题；桌面和 390px、高对比及字号优先，Studio 导出保留生产数据和 UI，玩家存储字节隔离 |
| 离线 | SDK / CLI 两个独立包分别在子目录部署，断网后新页重开，实际插画和主题可用 |
| 失败与恢复 | 错误 / 缺失素材、预算、过期 SHA、内容寻址目标冲突、失败批次、dry-run、重复请求、真实子进程中断 / 部分导入恢复、残留文件说明、任务循环 / 悬空引用、非法主题 |
| 原生 | 5 份宿主 / 编辑器 / 作品报告 PASS；额外版本报告验证 `0.6.0+cfa941c...`。WebView2 首次与重启均绘制书店插画 / 主题，执行真实分支、读档与隔离检查 |
| 人工状态 | 所有样例素材 DRAFT；听感、文学与人工作品终审 UNVERIFIED；正式构建及原四样例人工 QA 保持 BLOCKED |

本地完整 `npm run check`、`npm run test:browser`、`npm run test:editor` 通过。CI 在干净检出的实现提交重新执行；编译、浏览器和 Windows 原生分别记录。Windows 系统文件对话框沿用 CI 预设路径，不代表人工点击；浏览器 390px 不代表实体手机。

已实际下载核对浏览器与 Windows 证据，确认源 SHA / 引擎提交、实际音频图、CLI、两份原生 R2 检查和版本。界面已查看：[桌面](previews/r2-player-desktop.png)、[390px](previews/r2-player-mobile.png)、[Studio](previews/r2-studio-mobile.png)、[Windows WebView2](previews/r2-windows.png)。插画提示词与字节来源见 [素材记录](creative-assets.json)。

| 产物 | 编号 |
| --- | --- |
| [Windows v0.6.0 portable](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40641903899/artifacts/12795572740) | 12795572740 |
| [Windows 原生与 CLI 证据](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40641903899/artifacts/12795492974) | 12795492974 |
| [完整浏览器 / R2 流程 / 播放 / 离线证据](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40641903851/artifacts/12796032627) | 12796032627 |
| [四样例 QA](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40641903851/artifacts/12795548868) | 12795548868 |

R2 到此完成并停止，不自动开展 R3。四作和 RESET 的剧情、正式美术、运行链与玩家存档没有修改。
