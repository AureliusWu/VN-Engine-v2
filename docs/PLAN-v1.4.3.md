# v1.4.3 Studio 大图可达性诊断计划

日期 2026-11-06。基线 `5e3f0c952c7584bf959758fcf1228aab3ab93ae7`。本轮范围为 EditorModel 的结构可达性诊断，性能及平台结果另行记录。

`diagnoseProject` 先检查重复节点和断链，再从全部入口遍历。每访问一个新节点就扫描全部边，遍历成本最高为 O(V×E)。诊断只需要可达集合，遍历后的不可达警告仍可按原节点顺序生成。[基线诊断](https://github.com/AureliusWu/VN-Engine-v2/blob/5e3f0c952c7584bf959758fcf1228aab3ab93ae7/src/editor/model.ts#L88-L99)

## 开源与社区证据

- NetworkX 固定提交 `e59d71890e745effb3724dc4b5620b23f92e0ee3`，BSD-3-Clause。阅读 `networkx/algorithms/traversal/breadth_first_search.py` 第 430–479 行和 `networkx/classes/digraph.py` 第 911–941 行。多源 BFS 把全部起点放入已发现集合，随后只访问当前节点的邻接，发现子节点时立即去重。DiGraph 的邻居语义是后继，按出边方向扩展。Studio 借鉴多入口和入栈去重，用原有结构诊断语义决定警告。[多源遍历](https://github.com/networkx/networkx/blob/e59d71890e745effb3724dc4b5620b23f92e0ee3/networkx/algorithms/traversal/breadth_first_search.py#L430-L479) [有向邻接](https://github.com/networkx/networkx/blob/e59d71890e745effb3724dc4b5620b23f92e0ee3/networkx/classes/digraph.py#L911-L941) [许可](https://github.com/networkx/networkx/blob/e59d71890e745effb3724dc4b5620b23f92e0ee3/LICENSE.txt)
- xyflow 固定提交 `1bc405cd113618c17fd181b931a9fe573bec9fee`，MIT。阅读 `packages/system/src/utils/store.ts` 第 563–602 行与 `graph.ts` 第 76–93 行。连接索引在一次扫描中按端点、方向和 handle 建表。单次查询工具 `getOutgoers` 仍扫描传入的边和节点。官方 Discussions #3118 的已采纳答案展示沿后继递归处理下游节点，适用于该删节点场景。Studio 图可以含环并有多个入口，采用一次建表、共享访问集合，保留每条断链的诊断。[连接索引](https://github.com/xyflow/xyflow/blob/1bc405cd113618c17fd181b931a9fe573bec9fee/packages/system/src/utils/store.ts#L563-L602) [单次查询](https://github.com/xyflow/xyflow/blob/1bc405cd113618c17fd181b931a9fe573bec9fee/packages/system/src/utils/graph.ts#L76-L93) [社区讨论](https://github.com/xyflow/xyflow/discussions/3118) [许可](https://github.com/xyflow/xyflow/blob/1bc405cd113618c17fd181b931a9fe573bec9fee/LICENSE)
- Yarn Spinner 固定提交 `c5215f86dd5a6761aecbdc9f60f6a6108f91f919`，MIT。阅读 `YarnSpinner.Compiler/Compiler.cs` 第 782–840 行。它在编译后的基本块上核对静态目标，单独保留节点入口并将诊断映射回源码。这个判定与 Studio 从工程入口求可达集合的判定各自服务于不同诊断。这里保留本仓库已有的结构警告与运行验证边界。[基本块诊断](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/YarnSpinner.Compiler/Compiler.cs#L782-L840) [许可](https://github.com/YarnSpinnerTool/YarnSpinner/blob/c5215f86dd5a6761aecbdc9f60f6a6108f91f919/LICENSE.md)

## 实施范围

1. 保留节点重复和边目标检查的原顺序。在同一次边扫描中按 `from` 收集目标存在的出边。复用图生成的完整节点键，调查章节键继续区分不同章节中的同名节点。
2. 所有入口一起入栈，节点在入栈时标记已发现。用迭代遍历计算集合，环和自环按正常图处理。无入口、孤立节点和与入口不相连的子图维持原来的不可达结果。仍按图的节点顺序输出警告，边和节点原数据保留原顺序。
3. 兼容适配器的动态路由继续检查断链并发出原有动态路由警告。该分支跳过未用于诊断的可达性遍历。资源、内容、运行校验继续使用既有检查。
4. 复杂度目标限于建索引和遍历，预期为 O(V+E) 时间和 O(V+E) 辅助空间。公开诊断的严重级别、代码、消息、关联节点和顺序以基线输出逐项对照。

## 验收

- 用真实 `EditorModel.diagnostics()` 比较多个入口汇合、可达环、自环、孤立或无入口子图、章节同名节点、重复 ID 和断链。检查动态适配的缺边与单条动态路由警告，以及图外其他诊断的相对顺序。
- 同机同 Node，固定前后各三轮，使用相同夹具及预热规则。记录节点数、边数、全部原始样本和诊断相等性。完整耗时由真实诊断入口取得，拆分的图诊断阶段包括图提取、重复及断链检查和可达性。报告范围为测得的 Node 静态诊断。
- 运行核心、完整编辑器和浏览器回归，按同一提交核对 Linux、Windows 与样例技术检查。浏览器交互、原生 WebView2 和运行时路线保持独立的验证口径。
