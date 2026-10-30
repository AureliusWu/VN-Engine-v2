# VN-Engine-v2 · VN 共用工作流 R1

本轮为制作工作流优化（2026-10-30），配置为 [workflow.json](../../.vn/workflow.json)。源码版本、平台结果与内容品质分别记录；本轮配置接入没有为玩家程序新增发行版本。

## 本作适配

- 技术：Self-developed TypeScript SDK / CLI / Studio / WebView2。
- 正文/工程来源：`src/index.ts`、`src/agent/index.ts`。
- 身份与语义：引擎和作品分别验收；旧四作与 RESET 的迁移/引擎升级须有明确用户指令。
- 本作 AGENTS 与验收规范继续控制运行行为。跨仓复用时保留故事、台词、资产、存档、应用与 PWA scope 的独立身份。

## 复用入口

共用方法、来源对照及检查工具由 [VN-Engine-v2 / R1](https://github.com/AureliusWu/VN-Engine-v2/blob/main/docs/portfolio/R1-REUSE.md) 维护。用同一份 `tools/vn_portfolio.py` 对本仓目录执行只读检查；它只查入口、声明命令、正文文件 SHA256 与三仓共用文件漂移，绝不执行配置命令。

```sh
python3 /path/to/VN-Engine-v2/tools/vn_portfolio.py /path/to/VN-Engine-v2
```

六仓全量检查额外加 `--require-all` 并传入六个目录。`PASS` 只表示工作流清单有效，`runtimeStatus=NOT_RUN`、`releaseStatus=NOT_ASSESSED`。真实平台门禁仍用下列入口，按任务范围与原有规范执行；浏览器入口可能需要先构建并启动对应服务，CI 工作流保留完整环境和前置步骤。

- `npm run check`
- `npm run test:browser`
- `python3 tools/vn_portfolio.py .`
- `npm run gate:release`

## 断点与回馈

开始时读取最新 main、AGENTS、本作规范、上述配置与已有进度记录；以当前 source SHA / 包 SHA 核对证据时效。保留原有未提交工作和失败记录。结束时记录触发条件、修复、来源提交/文件/哈希、接收方适配、实际执行命令及尚未执行的平台项。

资源完成链统一为：文件存在 → 正文引用 → 原生运行实际触发 → 显示/播放正确 → 独立质量审阅。立绘重点检查通话、旁白、离屏、角色切换与 CG；可见性规则读取本作，避免把上一角色残留或有意隐藏误判为素材缺失。

本次只接入检查配置与可发现入口；运行逻辑、剧本、媒体、旧验收与稳定发行证据保持其原有身份。本轮具体执行范围见中央 R1 报告，不把历史 Web/Windows 通过写成本次重测。
