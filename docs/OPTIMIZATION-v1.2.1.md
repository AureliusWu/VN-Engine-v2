# v1.2.1 本地与云端联调

日期：2026-10-30。基线：`e3db4c4f3735e67469f16183c38c9197da72ad0c`（v1.2.0），开始时工作区干净。仅优化引擎；不迁移或修改四作，不创建 Release 或 tag。

## 范围与验收

| 问题 | 修改方向 | 验收 |
| --- | --- | --- |
| 本地完整浏览器、编辑器与发行门禁漏掉 P0/P1；CI 额外追加，覆盖范围不同 | 将专项纳入标准 npm 入口，Linux CI 复用完整入口，Windows 保留对应专项 | 核对脚本集合；完整本地 browser/editor；相同提交的 Linux core/browser 和 Windows 工作流 |
| 调查章节 ID 有共同前缀时资源计划误定位 | 明确章节与节点身份，保持公开 ID 和存档格式 | 旧码失败；前缀章节、不同数组顺序和真实运行 frame；浏览器实际资源复用及恢复 |

本机基线 `npm run check` 执行 323 项 Node，319 通过，4 项创建符号链接时被 Windows EPERM 拒绝。该环境限制不记为通过，不跳过断言或降低门禁；Python、schema、来源和样例检查需独立执行。完整核心和原生检查依靠相同提交的云端证据补足。

## 云端基线

开始时本地与远端 main 均为上述基线，没有开放 PR。该提交的 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/41003693230) 和 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/41003693274) 均成功。旧结果仅作为基线，不证明本轮修改。

## 交付边界

测试与源码来源哈希随修改更新，最终验证单独记录。浏览器自动化、CI WebView2、人工系统对话框与实体设备分别报告；不把窗口仿真或 CI 预设路径当作人工操作。不调用付费模型，不变更玩家持久化格式。回滚使用后续 revert 提交，不重写 main 历史。
