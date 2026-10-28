# v0.7.0 alpha · R3 验证记录

**R3 已完成。** 最终实现为 [399d8e2](https://github.com/AureliusWu/VN-Engine-v2/commit/399d8e2991a79dbdb8cfd780d758b39cf0e11465)，对应 [Engine checks](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40658600876) 与 [Windows native host](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40658600840) 均成功。机器身份、来源哈希、范围和 artifact 摘要见 [r3-validation.json](r3-validation.json)。

| 范围 | 实际结果 |
| --- | --- |
| 核心 | 201 项 Node、6 项 Python、172 项来源、schema 一致性和四份开发工程校验通过 |
| 完整浏览器 / Studio | 所有原有回归、R1 / R2、R3 工作台和两轮修订通过；含共享操作 / 扩展 / 循环拒绝、真实图片 / 字体 / 音频、主题、修复 / 合成复验 / 重开、源 / 实际字节过期、撤销 / 重做、实际文件 / 草稿重开、390px 键盘与玩家字节隔离 |
| 稳定定位 / 取消 | 派生 ID 定位原字段不分配 ID，Rain 选择原格式字段；换项目取消迟到读取，修改身份后可恢复旧审阅但拒绝跨身份写入 |
| SDK / 真实 CLI | 各自两轮台词 / 分支和配乐 / 主题修改、精确影响、旧报告 / 反馈失效、旧寻址文件原字节保留、完整路线与每套最终路线 10 次存读档检查通过 |
| 实际媒体 / 离线 | 新 44100 Hz 两秒配乐字节、真实 Web Audio 缓冲与非零信号；两个最新包分别子目录部署后断网新开页面，正文 / 图片 / 字体 / paper 主题 / 音频哈希正确，无作者审阅数据 |
| 原有四样例 | campus / netlove / circuit / rain 的完整声明结局、文件、实际解码和包复核均 PASS；正式人工 QA 仍 BLOCKED |
| Windows | CLI、实际媒体探测、自包含编译、程序 / 引擎 / manifest 统一 0.7.0；5 份原生报告通过，含可信文件桥、最新修订包 / 分支 / 重建、审阅独立存读 / 外部冲突 / 派生台词焦点 / 真实试听清理，以及完整进程重启后的文件 / 源身份 |

原生重启报告明确再次执行最新修订包与声音字节核对，并重新打开 review.json 及历史。文件外部追加字节时保存被拒绝、原字节保留，重新打开观测新版本后可保存。首次及重启均检查实际本地试听，离开面板移除媒体元素。

## 产物与来源

- [Windows 0.7.0 便携包](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40658600840/artifacts/12803226587)
- [Windows 原生 / CLI / 审阅证据](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40658600840/artifacts/12803146877)
- [浏览器截图 / SDK / CLI / 离线证据](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40658600876/artifacts/12802198777)
- [四样例 QA 报告](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40658600876/artifacts/12803381063)；[四份独立作品](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40658600876/artifacts/12803216133)

字体由固定 Rain d96510fc73ebe6a354bbf638613f8e4483f3366b / SourceHanSansLite SHA256 b2aaf73b7acc23d746b110f1caeaecc93d4292824979af44e96000200591b2a7 重建并改名，保留 OFL。使用 fontTools 4.68.0 / Brotli 1.2.1，见 [重建运行](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40658104130)；生成 Git SHA 与上传 blob 一致，精确 SHA256 写入 provenance。收取字体后移除临时工作流。

## 逐阶段记录与边界

A 为 a5fc8db，B 为 373a0ee，C 为 8b37ce5；最终字体与范围复核为 399d8e2。B 的 Engine 成功，Windows 在派生台词焦点检查失败；C 按原字段路径修复后首次 / 重启通过，没有为旧台词重编号。最终两条 CI 的证据均绑定 399d8e2，父提交结果不冒充最终结果。

本地 B 的完整 check / browser / editor 通过，C 的 0.7.0 核心与派生 / Rain 专项通过。其后工作环境中断，未收到完成结果的本地运行未计成功；使用 GitHub 完成剩余写入和确切提交 CI。收尾提交只整理文档及增加显式 test:editor / Windows 新反馈进程死亡恢复 CI 步骤；这些新增执行按收尾提交自己的工作流记录，不冒用上述实现运行。

反馈 verified 的操作者与 evidence 为自报；测试中的复验全部明确为合成夹具，不认证文学、美术、人耳或实体设备终审。素材仍 DRAFT，正式 release BLOCKED。Windows 系统选择对话框使用 CI 预设路径，不代表人工点击；静态未知仍需实际试玩和完整路线。工程与反馈分别写入，不宣称数据库事务。

四作与 RESET 的内容、宿主、依赖和玩家数据未迁移。R3 收尾后停止，不自动开始下一轮。接口与限制见 [R3 使用约定](ITERATION_DEVELOPMENT.md)。
