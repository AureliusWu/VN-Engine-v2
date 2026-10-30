# VN 工作流 R1 · 实际验证

日期：2026-10-30。本轮修改制作配置、审计工具、文档和技能；不宣称新一次作品终审或玩家发行。精确基线在 R1-BASELINES.json，工作区来源/配置/流程身份在 R1-AUDIT.json。

| 实际执行 | 结果 | 说明 |
| --- | --- | --- |
| 六仓 `vn_portfolio.py --require-all` | PASS，6/6 | 31 份来源文件、22 个命令入口、15 个平台 workflow；命令未执行 |
| 三仓共用清单 | PASS，15/15 × 3 | LF 规范化真实字节与各仓清单一致，三仓清单相同 |
| 引擎 `npm run check` | PASS | 381 Node、6 Ren’Py 兼容适配、8 工作流测试；schema、200来源与四样例技术校验通过 |
| 同字节技能脚本执行六仓检查 | PASS | 工具 SHA256 见 R1-VALIDATION.json，未执行 profile 声明命令 |
| 技能 quick_validate | PASS | 主入口、参考资料、UI 元信息与脚本 |
| 独立只读技能接管演练 | 完成 | 能正确识别六仓版本、来源、各作差异与工作流/正式验收边界；另跑 Rain/NetLove 图检查通过 |
| 独立演练的完整素材 verify | 未完成 | 精简检出缺媒体/许可；用 HEAD Git tree 确认 Rain 配乐、Healing/NetLove OFL 文件实际已入库，补充“先核实未检出”的技能规则；不把它报告为远端资产缺失 |
| 引擎完整浏览器 / Studio CI | PASS | Engine checks 41082878184，core 与 browser 均成功，完整套件和 source-bound QA 报告步骤成功 |
| 引擎 Windows 原生 CI | PASS | Windows native host 41082878074；实际 WebView2、文件 IO 与完整进程重启步骤成功 |
| 五部作品完整原生/浏览器发布验收、实体设备 / 真人 | NOT_RUN | 本轮作品运行链没有修改；原有内容授权与各作发布门禁继续独立有效 |

新增8项工作流测试覆盖：不执行配置命令/不授予发布、完整六仓/缺仓/重复仓、来源和命令缺失、坏配置不隐藏其他仓、字节与跨仓清单漂移、LF规范化、越界/符号链接、CLI非零和旧证据不覆盖。临时夹具是检查器验证，不是作品验收。

R1-AUDIT.json 已更新为本轮六仓 CI 的真实 JSON 输出，六仓均为已写回的精确提交、dirty=false。仅将绝对工作区路径改为仓库名，保留源、profile、workflow、commit 与检查结果；原报告在 artifact 12990701391，ZIP digest 与 job/run 身份随报告保存。初次本地工作区报告保留在实现提交 8f30979 的历史中。

## 远端闭环

实现提交：`8f30979e10bf2f8df602ed41be05d4371aedd63e`。同提交 [六仓清单 CI](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/41082878233)、[Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/41082878184)、[Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/41082878074) 全部成功；已逐项核对日志、实际步骤和 artifacts。六仓写回提交、变更文件及相关工件 ID / digest 见 [R1-DELIVERY.json](R1-DELIVERY.json)。五部作品只更新工作流入口/规范，使用文档提交跳过玩家发行流水线；未创建游戏 Release。

文档收尾只补充已发生的证据并清理空行；不将实现提交的 CI 宣称为收尾提交的新一次运行。AI 技能接管演练、引擎样例、实际 WebView2 与真人/实体设备验证分别保留范围。
