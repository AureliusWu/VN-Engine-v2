# VN Engine v2 — v0.4.0 作者工作台

日期：2026-10-28。状态：alpha。实现与真实验收见 [升级计划](OPTIMIZATION-v0.4.0.md)。

## 这次可以完成的作者流程

条件剧本可以直接在工作台声明数值 / 布尔变量、设置边界和初值，在节点中按顺序编写赋值与累加，再通过已有条件路由和路线用例验证结果。变量改名同步引用，已用变量禁止直接删除或改类型；无需先手写变量和效果 JSON。

调查项目可以添加章节、编辑入口和标题、排序、定位、重命名并执行跨章试玩。章节身份变更同步演出、布局、动作、结局和路线断言；外部引用和回看快照会阻止不安全删除或身份修改。排序会让旧回归结果失效，需要重新验证。

两套流程共用原子编辑、撤销 / 重做、草稿、工程保存、原生数据导出、同一解释器预览、Worker 路线回归与独立 Studio。版本一致性覆盖 npm / 锁文件、引擎导出、构建 manifest 和 Windows 程序。

## 兼容与边界

- EngineProject、编辑器工程和原生存档的 schema 继续为 1；纯变量改名后，Script 的旧格式选择日志仍能在同样 storyVersion 下重建。
- 修改变量类型 / 数值或章节身份 / 顺序可能改变故事语义；已有发行作品须单独安排 storyVersion 与存档迁移。本轮不自动迁移游戏或玩家数据。
- 引擎仍为 alpha；正式作品美术、听感、实体设备和签名安装发行依然按各自证据验收。

## 验收

实现提交 `140d04e8e5911df236e36d468123a93f23029ed1`：155 项 Node、6 项 Python、130 项来源与完整浏览器 / 编辑器通过；[Engine CI](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40611729066) 和 [Windows CI](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40611729075) 均成功。Windows 实际版本 0.4.0，工作台与跨章流程在首次 / 重启后均通过；四样例的路线 / 解码 / 包复核通过。

[Windows x64 便携包](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40611729075/artifacts/12783382651) · [独立样例包](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/40611729066/artifacts/12782598752) · [完整验收](VALIDATION-v0.4.0.md)。
