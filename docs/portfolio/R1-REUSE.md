# 六仓 VN 共用工作流 · R1

日期：2026-10-30。范围为五部作品和一个引擎；从当前 GitHub 可访问的全部 14 个仓库中识别出这 6 个 VN 相关仓库。基线提交与包版本见 [R1-BASELINES.json](R1-BASELINES.json)，执行结果见 [R1-AUDIT.json](R1-AUDIT.json)。这是工作流优化，不是新的玩家版本或全作品终审。

## 接管与差异

| 仓库 | 基线版本 | 正文 / 工程事实源 | 原生运行与必须保留的语义 |
| --- | --- | --- | --- |
| Rain | 1.7.0 | game/data/story.json | Ren’Py 8.5.3 / 官方 Web WASM；状态路线、原生存档、persistent |
| Healing | 1.5.4 | src/story/chapter1.ts 至 chapter3.ts | React / Electron；跨章桥接、浮层阅读、隐藏暂停、旧章存档 |
| NetLove | 1.1.1 | src/story/story.json | React / Electron；匿名聊天、通话、medium/noSprite、独立存档 |
| Circuit | 1.10.1 | src/story/chapters/*.ts | React / Tauri；调查与证据联合搜索、可重试错误结局、有意义循环 |
| RESET | 1.3.1 | game/content/manifest.json + chapters/01–07.json | 精确锁定引擎 0.3.0；行级立绘、Meta、六槽、Boss、True End 不可逆 |
| VN-Engine-v2 | 1.4.0 | src/ 与 schemas/；工程由调用方注入 | 自研 SDK / CLI / Studio / WebView2；无作品正文耦合 |

Engine 当前版本不能推导 RESET 的锁定版本。优化和复用本身不授权迁移作品、升级依赖、改存档键或替换人物素材。

## 已存在的复用与本轮缺口

Rain、Healing、NetLove 已有 `SHARED-VN.md` v1.2.0、`vn-contract`、`vn-creative`、`vn-materials` 与 15 项 LF/SHA256 共用清单。三仓这些文件逐项相同；继续维护原契约。本轮没有复制这套 DAG 检查到 Circuit，也没有复制到 RESET 以替代原生运行规则。

Circuit、引擎和 RESET 已有各自验收方法，但六仓没有统一可发现的制作配置和跨仓漂移检查。旧问题包括读到历史进度就沿用旧证据、只看存在/审批/映射而遗漏运行时、混淆浏览器与原生运行、重写专属人物/存档身份。本轮新增统一入口、只读审计和技能，复用的是工作方法。

## 可复用技能内容

| 能力 | 证据来源 | 复用方式与接受条件 |
| --- | --- | --- |
| 接管 / 断点 | 六仓 AGENTS、Healing ITERATIONS、NetLove WORK_CHECKPOINT、引擎反馈事务 | 先读当前 main、唯一正文、源 SHA、未完成问题；先读回执再重试，源变更使旧证明过期 |
| 剧情 / 文案 | 三仓 CREATIVE-PLAYBOOK / vn-creative；Circuit 原生调查 | 先捕获台词/段落/路由/录音基线；保留稳定身份，条件与证据由本作真实运行器遍历 |
| 美术接入 | Rain provenance / 素材目录、Healing 图集/alpha、RESET NPC hotfix | 原图/实际请求/许可/哈希 → runtime → 引用 → 真实 frame/DOM → 独立视觉观察 |
| 音乐 / 语音 / SFX | 四作离线媒体与引擎 MediaDirector 生命周期 | 实际事件触发、分轨/ducking、暂停/恢复、换曲、离场清理；测量和解码分别于试听记录 |
| UI / UX | Healing 浮层、隐藏/旋转；RESET 44px/4K；引擎焦点/减少动态 | 按本作视口和布局检查可操作性、长文、隐藏不推进、旋转位置、焦点与设置持久化 |
| 全路线 / 试玩 | 原生状态路线、Circuit 证据搜索、引擎 replay、RESET 最终包玩家矩阵 | 同源码与最终包遍历，逐步存读档；观察绑定实际截图/包 SHA，AI 不能冒充真人或实体设备 |
| 发布 / 复用回馈 | 六仓现有不可变发布与包回读；三仓许可分类 | 同提交构建、实包 Web/Windows、PWA 更新/离线、附件回读；licensed/recipe 与 project-only 分开 |

### NPC / noSprite 经验的适用边界

RESET 0.3.0 的整场 noSprite 会清空立绘，默认表现也可能继承上一人。v1.3.1 在作品层编译逐行 portrait，旁白与具名离屏对白清空，并检查 12 人真实 frame/DOM。详见 [RESET hotfix](https://github.com/AureliusWu/RESET/blob/45996c5445eb9ef9a60448e77673260ea3f7ce0d/docs/NPC_RUNTIME_HOTFIX_v1.3.1.md)。

复用诊断顺序和逐行证据；不要把 RESET 的清空规则直接应用到 NetLove 或 Healing。三仓既有 playbook 明确旁白继承/匿名通话政策，Circuit 资料图也不等同在场立绘。跨作复用必须写清接收方语义与运行结果。

## 只读检查工具

每仓 `.vn/workflow.json` 声明来源、必要入口、命令 argv 与平台 workflow。`tools/vn_portfolio.py` 只读取这些配置、源码和共用清单，不执行其中的命令，也不读取或修改玩家数据。Python 3.12，无第三方依赖。

```sh
# 引擎内本仓检查与工具回归
npm run audit:workflow
npm run test:portfolio

# 六仓在同一级目录；完整范围必须明确要求
python3 tools/vn_portfolio.py . ../Rain ../Healing ../NetLove ../Circuit ../RESET --require-all --out /new/path/audit.json
```

报告会保留每仓 HEAD、dirty、profile SHA256、匹配正文文件 SHA256 与 workflow SHA256。单仓检查为 `coverage=partial`；`--require-all` 遇缺仓或重复仓失败。错误配置、缺正文、失效 npm/Node/Python 入口、共用实际字节或清单漂移返回非零。`--out` 只创建新文件，不覆盖已有验收证据。

`PASS` 只代表 `scope=workflow-inventory-only`；报告始终保留 `commandsExecuted=false`、`runtimeStatus=NOT_RUN`、`releaseStatus=NOT_ASSESSED`。它不验证 shell script 内部依赖、素材总量、语义/听感、远端 Actions 结论或公开发行。稀疏工作区需要包含 profile 引用的全部来源、入口和共用文件；缺文件应失败，不能自动忽略。

稀疏工作区运行完整素材检查时，还需要检出媒体和许可。若本地提示缺文件，先用 `git ls-tree -r HEAD -- <path>` 或该提交的 GitHub tree 核实；“未检出”不是“仓库缺失”。本轮独立演练中的 Rain 配乐和两作字体许可均已在 Git tree 中确认存在，不能据本地稀疏检查失败发起重生成或修改远端资源。

CI 的 [VN portfolio workflow inventory](../../.github/workflows/vn-portfolio.yml) 只读检出六仓、记录实际提交并上传新报告。引擎 `npm run check` 同时包含工具回归和本仓配置检查。各作品后续改动继续执行自己的真实门禁；中央工作流可手动重新检查六仓当前状态。

## 交付与后续维护

R1 各仓新增 `.vn/workflow.json`、本仓 `VN-WORKFLOW-R1.md` 与 AGENTS 链接；引擎保存中央工具、基线与本轮报告。共用脚本原有版本/哈希、人物与媒体、正文/存档、RESET 锁定引擎和稳定 Release 都继续沿用本作身份。

另安装个人技能 `vn-production-workflow`（VN 制作与验收），包括工作流、六仓适配参考、资源接入与续接/发布方法，以及同字节审计脚本。脚本来源/版本/哈希随技能参考保存；更新工具时同时核对技能脚本。技能目录负责其生命周期，GitHub 保留中央流程与实际验证记录。

本轮真实验证与限制只写入 [R1-VALIDATION.md](R1-VALIDATION.md)。后续优化先记录新问题及收益，再决定通用化；专属效果和没有跨作实证的方法保留在作品内。
