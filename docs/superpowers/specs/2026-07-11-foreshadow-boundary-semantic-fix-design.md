# 伏笔幕边界语义修复设计

## 背景

当前幕边界校验把 `ForeshadowMemory.beatId` 所关联节拍的 `actIndex/deadlineAct`
解释为伏笔回收期限。现有数据和提示契约并不支持该解释：`beatId` 只表达伏笔与剧情节拍的关联，
`expectedFulfillChapter` 才是明确的 1-based 回收期限，`null` 表示尚未安排期限。

错误解释会在幕末把所有关联到已结束幕节拍的 required 伏笔一次性升级为阻断错误，即使这些伏笔
没有要求在该幕回收。旧故事还会因为新规则追溯检查历史关联而集中失败。

## 目标

1. 幕边界只阻断具有明确章节期限、且期限不晚于当前边界章节的 required 未回收伏笔。
2. `beatId` 和 `StoryArc.keyBeats[].foreshadowId` 继续表示剧情关联，不参与回收期限推断。
3. `expectedFulfillChapter=null` 的 required 伏笔不阻断普通幕边界，但仍在全书结尾阻断。
4. 在 JIT 大纲和章节规划之前提供本章必须回收的结构化伏笔义务，避免只在 finalize 阶段发现问题。
5. 失败运行的最新 checkpoint 不被清理，使下一次 rewrite 能读取 `pendingIssues` 并获得修复反馈。
6. 不直接修改 `books/` 中任何故事数据。

## 非目标

- 不新增 `resolveByAct` 字段；现有明确章节期限足以支持当前边界校验。
- 不根据伏笔文本、摘要或正文内容推断期限或是否回收。
- 不自动把历史伏笔标记为 fulfilled、optional 或放弃。
- 不改变普通章节中逾期伏笔仍属于软压力的既有策略。

## 结构化语义

### `beatId`

`ForeshadowMemory.beatId` 表示伏笔与一个 mandatory beat 或 key beat 的关联。它可以说明伏笔在
哪个剧情动作中被埋设或服务于哪个叙事节点，但不能说明伏笔应在何时回收。

### `expectedFulfillChapter`

`expectedFulfillChapter` 是唯一的章节级回收期限：

- 类型为 1-based 整数或 `null`；
- 有限值必须严格晚于伏笔引入章节；
- `null` 表示尚未安排明确章节期限；
- 在章节 `N` 完成时，只有 `expectedFulfillChapter <= N` 的 required 未回收伏笔属于到期义务。

### 故事结尾

全书最后一章仍要求所有 required 伏笔已回收。故事结尾是全局完整性边界，因此不要求伏笔拥有
有限的 `expectedFulfillChapter`。

## 共享边界策略

`src/story-memory/foreshadow-policy.ts` 保持单一的结构化选择函数。普通幕边界输入当前 1-based
边界章节号，返回满足以下条件的伏笔 ID：

1. `required=true`；
2. `fulfilledIn=null`；
3. `expectedFulfillChapter` 是合法有限期限；
4. `expectedFulfillChapter <= boundaryChapter`。

故事结尾返回所有期限合法或未安排期限的 required 未回收伏笔。函数不再读取 `memory.beats`、
`BeatMemory.actIndex/deadlineAct` 或 `StoryArc.keyBeats` 来判断伏笔回收期限。

## JIT 规划数据流

在生成当前章即时大纲之前，`outline-expander` 使用同一共享策略计算本章边界义务。义务保持为
结构化对象，至少包含：

- `foreshadowId`；
- `expectedFulfillChapter`；
- 展示用伏笔文本。

只在 Agent 提示边界将对象渲染为文字。ChapterOutline Agent 必须把这些稳定 ID 写入
`fulfilledForeshadowIds`；ChapterPlanner 随后必须为每个 ID 生成对应的
`foreshadow-fulfill` expected event。Writer 仍需输出带有效正文段落证据的实际事件，现有结构化
验证继续负责防止虚假声明。

如果即时大纲遗漏边界义务，使用已有的大纲重试循环追加结构化纠正约束并重试；达到重试上限后
停止进入正文起草，返回明确的规划错误。已有具体大纲的 rewrite 路径也必须把义务加入规划上下文，
不能只依赖首次 JIT 大纲生成。

## 幕边界调整

自动缩短幕边界时，应针对候选 `proposedEndChapter` 运行同一章节期限策略。只有期限不晚于候选
边界的 required 未回收伏笔才禁止缩短；期限晚于候选边界或为 `null` 的伏笔不影响缩短决定。

这保留当前工作树中“缩短前检查伏笔”的意图，同时移除从 beat 归属推断期限的错误语义。

## Finalization

finalize 在应用本章有证据的 StoryEvent 后，针对最终采用的幕边界再次调用共享策略。这是提交前的
防御性检查：

- 正常情况下，JIT 大纲和规划已安排回收，finalize 不产生新问题；
- 模型没有实际输出回收事件时，继续产生 `foreshadow_boundary_unresolved`；
- 错误描述引用稳定伏笔 ID、边界章节和幕编号，但控制流不解析描述文字。

## Checkpoint 保留

`pruneIntermediateCheckpoints()` 除章节 marker 外，还必须保留 `latest.json` 当前指向的 checkpoint。
失败 finalize 不创建章节 marker，但其 checkpoint 包含 `rewriteRequested` 和具体 `pendingIssues`，
必须留给下一次 rewrite 使用。后续成功运行产生新的 latest 和 marker 后，旧失败 checkpoint 可在下一次
清理中自然删除。

如果 `latest.json` 已经损坏或指向不存在的文件，现有扫描回退逻辑保持不变；本设计只防止清理流程
主动制造新的悬空 latest 指针。

## 兼容性

- 不改变 StoryMemory schema，旧 checkpoint 和 `story-memory.json` 继续可读。
- 旧伏笔的 `beatId` 保留，不迁移、不删除，只是不再作为期限使用。
- 旧伏笔的有限 `expectedFulfillChapter` 继续生效；明确逾期且跨越当前幕边界时仍会阻断。
- 旧伏笔的 `expectedFulfillChapter=null` 仅在故事结尾进入硬阻断。
- 不修改任何已有章节正文或运行时故事文件。

## 测试

1. 共享策略单测：
   - 关联当前幕 beat、但期限晚于边界的伏笔不阻断；
   - 关联当前幕 beat、但期限为 `null` 的伏笔不阻断；
   - 有限期限不晚于边界的 required 未回收伏笔阻断；
   - optional 或已回收伏笔不阻断；
   - 故事结尾阻断所有 required 未回收伏笔。
2. finalization 测试验证幕末使用章节期限，而不是 beat 归属。
3. outline-expander 测试验证边界义务进入 JIT 大纲和已有大纲的规划上下文，并验证遗漏义务会重试或停止。
4. story-arc 测试验证自动缩短使用候选结束章节判断到期义务。
5. checkpoint-service 测试验证清理后 latest 指向的 checkpoint 仍存在，失败问题可被重新加载。
6. 完整运行 `npm test`、`npm run typecheck`、`npm run build` 和 `git diff --check`。

## 成功标准

- 示例故事在第 26 章不会因为 9 个第 1 幕关联伏笔和 5 个第 2 幕关联伏笔而被错误阻断。
- 具有明确 `expectedFulfillChapter <= 26` 且仍未回收的 required 伏笔会在规划前成为本章硬义务，
  并在缺少实际回收事件时继续阻断定稿。
- 重写失败后再次运行 rewrite 能读取上一轮的具体错误，而不是回退到无错误的章节 marker。
- 所有控制流判断仅使用稳定 ID、布尔值、枚举和章节数字。
