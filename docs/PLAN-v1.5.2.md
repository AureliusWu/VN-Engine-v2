# v1.5.2 Studio 草稿恢复与导入保护

基线为 `7f4af837c9c9411dd90b661b3a2ba5b70d2f0554`。调查时仓库无开放 Issue 或 PR，公开 Issue 列表只有历史 PR，Discussions 关闭。v1.5.1 的 Linux 和 Windows 工作流均成功，Windows 候选工件 `13493024890` 上轮独立下载超时。本轮补验原工件，并对新提交运行同样的包校验。 [仓库 Issues](https://github.com/AureliusWu/VN-Engine-v2/issues) · [v1.5.1 Linux](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/42201155275) · [v1.5.1 Windows](https://github.com/AureliusWu/VN-Engine-v2/actions/runs/42201155330)

- Twine 作者反馈本地存储容量耗尽时缺少明确的保存失败提示。Studio 已有写入失败提示，本轮使失败后的动作与提示一致，切换工程前先保住最新编辑。 [Twine #1716](https://github.com/klembot/twinejs/issues/1716)
- 互动小说论坛的作者报告浏览器中的作品消失，讨论提到用户很难识别作品存在哪里。Studio 将已有本地草稿的恢复入口留在当前页面，便携恢复文件仍可作为独立副本。 [论坛原帖](https://intfiction.org/t/how-can-i-contact-tech-support-my-story-is-missing-got-deleted/50631)

| 基线场景 | 本轮处理 |
| --- | --- |
| 最新编辑只在内存中，本地写入失败后仍能新建工程 | 拒绝替换，保留最新编辑和旧草稿。存储恢复后可正常切换。 |
| 导入便携 B 后，保存的本地 A 没有同页恢复入口。制作筛选或放弃 B 自带的未应用 JSON 会覆盖 A。过期的启动提示还能删除稍后写入的草稿 | 保留同页入口。筛选和放弃导入的 JSON 不占用槽。提示随草稿槽更新，实际编辑后继续按单槽规则保存。 |
| 含空相机关键帧的恢复文件进入工作区后，演出属性渲染报错，已解除原项目资源绑定 | 共享工程读取器在切换前校验演出列表元素形状。结构有效的工程可继续在 Studio 修复。 |

验收使用真实 Chromium 和共享模型测试，分别执行 Windows 本地核心、完整浏览器和编辑器套件。GitHub Actions 核对同一 `main` 提交的 Linux 与 Windows 结果，Windows 原生测试包括预设路径读写和完整进程重启。下载候选工件后校验 GitHub 外层摘要、内层包结构、内容和构建身份。
