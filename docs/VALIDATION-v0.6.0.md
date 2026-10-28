# v0.6.0 R2 验证记录

本轮约定见 [R2_PROMPT.md](R2_PROMPT.md)，接口与复现见 [CREATIVE_DEVELOPMENT.md](CREATIVE_DEVELOPMENT.md)。R2 基于 main 的 `8d89be92c53981a3675842eccaf668e5a18f8651` 继续；下述本地结果是工作区验证，最终原生和干净检出证据将在实现提交 CI 完成后补齐，不将基线 SHA 冒充新实现提交。

| 范围 | 当前实际结果 |
| --- | --- |
| 核心 / Python / schema / 来源 / 四样例 | 194 项 Node、6 项 Python；schema 一致、四样例开发校验 PASS |
| 完整浏览器 | PASS；包含全部原有测试、R1 四模板 / Rain，以及 R2 新专项 |
| R2 创作 | SDK / CLI 各 15 次公开调用，从简报与六任务到真实素材、主题、文本、条件、路线、预览和独立包 |
| 路线 / 读档 | 每种调用覆盖两个结局、10 次逐步重建；不改变玩家数据 |
| 声音 | 真实 Web Audio 输出采样非零，音乐与雨声两条循环；设置暂停时声音时钟停止 / 恢复；门铃真实 playing 事件一次，设置 / restore 不补播 |
| 画面 / 主题 | 实际插画和字体解码、播放器 / Studio / Agent 预览、桌面和 390px；高对比及玩家字号优先 |
| 离线 | SDK / CLI 两个独立包均在子目录部署并断网新页重开，实际插画可用 |
| 失败与恢复 | 错误 / 缺失素材、探测预算、过期 SHA、目标冲突、失败批次、dry-run、重复请求、实际进程中断 / 部分导入恢复、剩余文件说明、任务循环 / 悬空引用、非法主题 |
| Windows | 待对应实现提交执行 CLI / probe、版本一致性、WebView2、首次与完整进程重启 |
| 正式人工审阅 | 未执行；素材 DRAFT，听感 / 文学质量 / 人工 QA 为 UNVERIFIED，正式构建 BLOCKED |

本地浏览器为 Chrome Headless Shell 156.0.8078.73，通过 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH 使用；默认 Playwright 下载在本环境返回非 ZIP，因此未把安装失败写为测试通过。原生 Windows 必须以 GitHub 工作流实际执行为准。系统文件对话框沿用 CI 预设路径，不代表人工点击。

新插画的精确提示词和字节哈希、程序音乐 / 声音源码见 [素材记录](creative-assets.json)。截图检查了书店人物、文字可读性、390px 布局与 Studio；生成成功和机械验证不会把 DRAFT 提升为 READY。

完成 R2 后停止，不自动开展 R3；四作和 RESET 的原作资源、运行链和存档未修改。
