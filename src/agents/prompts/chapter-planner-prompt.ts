import { renderTemplate } from '../../utils/template.js'
import {
  OFFICIAL_CHARACTER_RULES,
  FORESHADOW_DISCIPLINE_RULES,
  buildCharacterWhitelistSection,
  buildForeshadowPlanningSection,
  buildPlannerStoryEventContract,
} from './fragments/index.js'
import { isClosingPhase } from '../../utils/story-arc.js'
import type { StoryEventAuthorityRegistry } from '../../types/story-memory.js'

const CHAPTER_PLANNER_SYSTEM_PROMPT =
  '你是一位严谨的小说结构规划师。你的任务是在写作前生成详细的章节规划，确保每个大纲要求都被精确落实。你对时间线和情节顺序的准确性有零容忍态度。'

export function buildChapterPlannerSystemPrompt(): string {
  return CHAPTER_PLANNER_SYSTEM_PROMPT
}

const CHAPTER_PLANNER_USER_PROMPT_TEMPLATE = `<task>请为第 {displayChapterNumber} 章生成详细的写作规划。</task>

<context>
<outline>
【必须严格遵循】本章大纲：
{outline}
</outline>

{issuesSection}

{verifiedConstraintsSection}

{foreshadowPlanningSection}

{closingPhaseSection}

<world>
【必须严格遵循】世界观设定：
{world}
</world>

<characters>
【必须严格遵循】人物设定：
{characters}
</characters>

{characterWhitelistSection}

{storyEventAuthoritySection}

<previous_summary>
前几章摘要：
{previousSummary}
</previous_summary>

{storyStateSection}

{chapterContractSection}

{stateConflictsSection}
</context>

<instruction>
【规划要求】
1. 将本章拆分为 {MIN_SECTIONS}-{MAX_SECTIONS} 个段落/场景
2. 对每个段落，明确：
   - 段落标题（简短）
   - 内容摘要（简短概括，不写细节）
   - 预计字数
   - 涉及的事件（必须对应大纲中的情节点）
   - 出场人物
   - 时间标记（使用故事内明确的时间参照，避免模糊表述）
  3. 列出完整的时间线，确保：
     - 时间顺序正确，不能出现时间回退或跳跃未交代的情况
     - 每个关键事件都有明确的时间标记
     - 时间间隔符合大纲要求（如大纲明确指定的时间跨度必须在时间线中得到完整体现）
     - 如果本章涉及时间限制、倒计时或截止期限等时间压力，必须在 timeline 中标注剩余时间
  4. 逐条检查大纲要求，确保：
     - 大纲中的每个情节点都出现在规划中
     - 大纲中提到的所有事件都有对应的段落
     - 大纲中提到的关键台词必须原样保留
     - 大纲中的相对或绝对时间要求必须在时间线中体现
  5. 【核心事件聚焦 - 必须执行，优先级最高】
     - 本章必须有一个明确的核心事件（通常是大纲标题或第一句描述的事件）
     - 核心事件必须占据本章总字数的 {CORE_EVENT_RATIO_TARGET_PERCENT}% 以上，这是硬性要求，任何情况下不得突破
     - 非核心事件（即辅助性叙事内容）必须压缩为简短的过渡段落，单段字数不得超过 {MAX_NON_CORE_SECTION_WORD_COUNT} 字，不得发展成独立大场景
     - 如果本章大纲只要求初步、试探性或登场类事件，不得在本章把该事件完整解决或过度展开
     - 规划的总场景数不得超过 {MAX_SECTIONS} 个，核心事件场景不得少于 {MIN_CORE_SECTIONS} 个
     - 【硬性优先级】当核心事件与前章遗留差事、Deadline 到期事项发生冲突时，永远优先保证核心事件篇幅；不得以"差事到期"为由把无关差事扩展成大场景
  6. 【前章遗留差事处理 - 必须执行】
     - 如果上下文中的 <pending_tasks> 列出了前章遗留差事，必须为每条差事在 taskResolutions 中给出处理结论
     - 处理方式只能是 executed（在本章执行）、postponed（明确推迟）、superseded（因后续大纲覆盖而取消），新增 background（一句话带过，不占字数）
     - 对于 postponed，必须说明推迟到何时、原因是什么
     - 对于 superseded，必须引用后续大纲的哪一条要求覆盖了该差事
     - 对于 background，必须在 reason 中说明为什么与核心事件无关，且 sections 中不得为其分配独立场景
     - 禁止无任何说明地忽略前章差事
     - 【重要】不得为了让所有 pending task 都在本章 executed 而挤占核心事件篇幅。如果 pending task 过多或与核心事件无关，优先选择 postponed 或 background 并说明原因
     - 【绝对规则】判断一条 pending task 能否标记为 executed 的唯一标准：该 task 是本章大纲核心事件的必要组成部分，或由本章大纲明确要求在本章完成。否则即使 deadline 落在本章，resolution 也只能是 postponed 或 background，禁止 executed。
     - 【绝对规则】如果某条 pending task 与第 {displayChapterNumber} 章大纲核心事件无关，即使其 deadline 落在本章，也必须选择 postponed 或 background（或在一句话内 background 处理），总字数不得超过 {MAX_BACKGROUND_TASK_WORD_COUNT} 字，不得在 sections 中为其分配独立场景或超过 {MAX_EXECUTED_TASK_RATIO_PERCENT}% 的总字数
     - 【硬性规则】如果 taskResolutions 中某条差事为 postponed 或 background，sections 中不得出现专门执行该差事的场景；只允许在过渡句中提及
  7. 【关键物品操作规则 - 必须执行】
     - 如果本章需要角色在场景中查看、比对、拆阅或传递关键物品/道具，必须明确区分：
       1) 「原始物品位置」：由前章权威事实锁定，本章未声明转移则不变；
       2) 「本章操作对象」：可以是副本、抄件、诱饵或经授权取出的原始物品。
     - 任何让关键物品出现在角色可操作位置的情节，必须在规划或正文中说明操作对象是原始物品还是替代物；不得让读者/检查者误以为所有关键物品都被集中到同一处。
     - 如果本章确实需要转移原始物品，必须在 timeline 或 section events 中明确标注转移动作、起点与终点。
     - 如果 state_conflicts 中提示某物品存在位置冲突，本章必须选择唯一位置作为该物品的当前位置，并通过清晰动作完成转移；禁止让同一物品同时处于两个位置。
  8. 【角色完整性检查 - 必须执行】
   - 扫描人物设定和前几章摘要，识别哪些角色已加入团队/组织或已成为常驻角色
   - 对于每个已加入的常驻角色，必须在本章规划中明确安排：
     a) 出场：在对应段落的 characters 列表中加入该角色
     b) 缺席：在 timeline 或 events 中明确说明缺席的具体原因
   - 禁止无故遗漏任何已加入的团队成员
   - 如果问题反馈指出角色遗漏，必须按【角色遗漏专项修复】要求处理

  9. 【重要】检查前面章节中是否有遗留的未解决状态：
     - 扫描前面章节摘要，识别哪些角色处于异常或受限状态
     - 如果本章大纲涉及这些状态的改变，请确保在规划中包含"衔接段落"
     - 衔接段落位置：放在本章最前面或相关情节之前
     - 衔接段落内容：通过角色对话、简短回忆或旁白，解释关键状态的变化过程
     - 衔接段落只能承接已知事实，不得为了修补前文矛盾而发明新事实、新来源、新因果或新设定
     - 不得让角色说出其未在前文获得的信息；如果当前资料不足以解释，只能保持模糊或待解

  10. 【本章时间锚点 - 必须输出】
      在输出 JSON 的根级别增加字段 "chapterTimeAnchor"（字符串）。
      规则：
      - 如果本章从上一章结束时间继续推进：chapterTimeAnchor = 上一章结束时间（或标注为继续推进）。
      - 如果本章大纲要求回溯、倒叙或跨越一段时间：chapterTimeAnchor = 本章叙事起点时间，并注明时间模式与覆盖范围。
      - 如果本章包含时间限制、倒计时或截止期限等时间压力：chapterTimeAnchor 必须明确标注当前处于期限的哪个阶段、还剩多少。
      - 如果无法判断：chapterTimeAnchor = "未指定"。
      - chapterTimeAnchor 将成为本章写作者和一致性检查者的时间原点，必须准确。
      - 所有 section 的 timeMark 必须相对于 chapterTimeAnchor 推进，严禁时间回退。
  11. 【角色执行者规则 - 必须执行】
      - 如果大纲中某动作执行者未指定具体人名（即使用泛指或匿名描述），规划中必须：
        1) 优先从官方角色中选择执行者；
        2) 若官方角色均不适合，只能使用不露名、不进入 storyState、不输出 expectedEvents 的临时龙套；
        3) 禁止为该动作 invent 新的有名角色或亲属关系。
  12. 【字数控制 - 必须执行】
     - 所有 section 的 wordCount 之和应控制在 {CHAPTER_WORD_COUNT_MIN}-{CHAPTER_WORD_COUNT_MAX} 字之间
     - 单个非核心过渡 section 的 wordCount 不得超过 {MAX_NON_CORE_SECTION_WORD_COUNT} 字
     - 核心事件 section 的 wordCount 不得低于 {MIN_CORE_SECTION_WORD_COUNT} 字
  13. 【结构化事件与声明 - 必须输出】
     - 输出 expectedEvents 数组，记录本章计划产生的、会影响故事记忆的状态变化事件。
     - 每个事件必须包含 id、type、chapterIndex，以及对应类型所需的字段（如 characterId、locationId、itemId、beatId、foreshadowId、taskId 等）。
     - 事件类型包括：character-location、character-status、item-location、item-state、plot-advance、foreshadow-introduce、foreshadow-fulfill、task-resolve、task-create。
     {storyEventContractSection}
     - 【位置/状态事件纪律】character-location / character-status / item-location / item-state 事件只记录本章 sections/timeline 中实际发生的变化（含章末归位）或首次确立的状态：
       1) 不得为全程未移动、状态未变的角色或物品输出位置/状态事件（例如全程在原地熟睡的角色不应有 character-location 事件）；
       2) 不得把本章主场景地点套用到所有出场角色——每个位置事件必须与 section 中描述的具体动作一一对应；
       3) 位置/状态事件的值必须与已有故事记忆一致或体现本章真实变化，禁止编造未在 sections 中出现的移动或状态改变；
       4) 位置变化与状态变化的区分：角色或物品的移动、交接、取出、放回、随身携带、锁回某处等必须使用 location 类型事件（character-location / item-location），不得使用 status/state 类型；item-state / character-status 只用于物品或角色自身的属性变化（如破损、开封、情绪、伤势等）。
       5) 【无名角色禁入事件】expectedEvents 只允许记录上下文中已有权威 ID 的角色与物品；没有权威 ID 的无名临时角色（功能性路人）即使在本章发生移动或状态变化，也禁止为其输出 character-location / character-status 事件，禁止用中文名、描述性短语或自造 ID 充当 characterId——其动作只写入 sections/timeline 文本，不进入 storyState；
     - foreshadow-introduce 事件必须包含 text、kind、resolutionPolicy、required、expectedFulfillChapter；新建 must_resolve 事件还必须包含 resolutionQuestion 与 fulfillmentCriteria，新建 should_resolve 事件应尽量包含。若与某个节拍绑定，填写 beatId，否则 beatId 为 null。策略与截止章节必须遵守 <story_event_json_contract> 中的结构化约束。
     - 每个事件的 source 固定为 "chapter"。
     - expectedEvents 中的所有事件都由本章产生，其内部零基章节索引固定为 {chapterIndex}；不得填写展示章节号 {displayChapterNumber} 或其他章节索引。
     - 如果本章没有某类事件，对应字段的数组为空。
     - 同时输出 claimedMandatoryBeatIds、claimedBeatIds、fulfilledForeshadowIds、introducedForeshadowIds、resolvedTaskIds、createdTaskIds 六个结构化声明数组；无对应内容时输出空数组。
     - claimedMandatoryBeatIds 必须使用大纲上下文中提供的 mandatory beat ID（如 A2-M3）；claimedBeatIds 只用于全局 keyBeat ID（如 A2-B3），不得混用。

${OFFICIAL_CHARACTER_RULES}
${FORESHADOW_DISCIPLINE_RULES}
</instruction>

<output_format>
请输出 JSON 格式：
{
  "sections": [
    {
      "title": "段落标题",
      "summary": "内容摘要",
      "wordCount": 预计字数,
      "events": ["涉及事件1", "涉及事件2"],
      "characters": ["人物1", "人物2"],
      "timeMark": "时间标记"
    }
  ],
  "timeline": [
    {
      "event": "事件描述",
      "time": "具体时间",
      "notes": "注意事项"
    }
  ],
  "outlineCheck": [
    {
      "requirement": "大纲要求的具体内容",
      "fulfilled": true或false,
      "section": "对应段落标题"
    }
  ],
  "taskResolutions": [
    {
      "taskId": "任务标识",
      "assignee": "被指派的执行角色",
      "description": "任务内容摘要",
      "resolution": "executed|postponed|superseded|background",
      "reason": "处理原因",
      "section": "对应段落标题（如适用）"
    }
  ],
  "chapterTimeAnchor": "本章叙事起点时间",
  "expectedEvents": [
    {
      "id": "evt-1",
      "type": "character-location",
      "characterId": "c-1",
      "locationId": "l-1",
      "chapterIndex": {chapterIndex},
      "source": "chapter"
    }
  ],
  "claimedMandatoryBeatIds": [],
  "claimedBeatIds": [],
  "fulfilledForeshadowIds": [],
  "introducedForeshadowIds": [],
  "resolvedTaskIds": [],
  "createdTaskIds": []
}
</output_format>

<important>
【重要】
- 如果大纲要求明确的时间跨度，时间线必须完整呈现该跨度，不得用模糊表述替代
- 如果大纲要求某人说特定台词，规划中必须标注该台词原样出现
- 如果大纲要求相邻时间点发生某事，时间线必须显示前一时刻到下一时刻的过渡
- 所有大纲情节点必须在 outlineCheck 中标记为 fulfilled: true
- 所有已加入的常驻角色必须在 sections 或 timeline 中有明确交代，不得无故遗漏
- 如果上下文提供了 <pending_tasks>，必须在 taskResolutions 中逐条回应，禁止遗漏
- 【核心事件聚焦】禁止用前章遗留差事或过渡场景挤占核心事件篇幅；核心事件必须获得最大权重
- 【Deadline 冲突处理】与核心事件无关的 pending task，即使 deadline 落在本章，也必须选择 postponed 或一句话带过，不得展开为独立场景
- 【字数控制】总字数不得超过 {CHAPTER_WORD_COUNT_MAX} 字，非核心段落不得超过 {MAX_NON_CORE_SECTION_WORD_COUNT} 字
</important>`

export interface ChapterPlannerPromptSections {
  issuesSection: string
  verifiedConstraintsSection: string
  foreshadowPlanningSection: string
  closingPhaseSection: string
  storyStateSection: string
  chapterContractSection: string
  stateConflictsSection: string
  characterWhitelistSection: string
  storyEventAuthoritySection: string
  storyEventContractSection: string
}

export interface ChapterPlannerPromptVariables {
  chapterIndex: number
  displayChapterNumber: string | number
  outline: string
  world: string
  characters: string
  previousSummary: string
  CORE_EVENT_RATIO_TARGET_PERCENT: number
  CORE_EVENT_RATIO_MIN_PERCENT: number
  MAX_NON_CORE_SECTION_WORD_COUNT: number
  MIN_CORE_SECTION_WORD_COUNT: number
  MAX_BACKGROUND_TASK_WORD_COUNT: number
  MAX_EXECUTED_TASK_RATIO_PERCENT: number
  MAX_BRIDGE_SCENE_RATIO_PERCENT: number
  CHAPTER_WORD_COUNT_MIN: number
  CHAPTER_WORD_COUNT_MAX: number
  MIN_SECTIONS: number
  MAX_SECTIONS: number
  MIN_CORE_SECTIONS: number
}

function buildIssuesSection(state: import('../types.js').ChapterPlannerAgentInput): string {
  if (!state.issues || state.issues.length === 0) return ''

  const characterOmissionIssues = state.issues.filter(
    (i) => i.type === 'consistency' && i.dimension === 'character_omission'
  )

  return `【上轮问题反馈 - 必须在本次规划中修复】
${state.issues.map((issue, i) => `${i + 1}. [${issue.type}] ${issue.description}${issue.location ? `\n   位置: ${issue.location}` : ''}${issue.suggestion ? `\n   建议: ${issue.suggestion}` : ''}`).join('\n')}

【要求】请逐条对照上述问题，在本次规划中确保：
- 每个遗漏的大纲情节点都在 sections 中明确体现
- 每个错误的时间线都在 timeline 中纠正
- 每个未落实的要求都在 outlineCheck 中标记为 fulfilled
- 不得为了修补前文矛盾而发明新事实、新来源、新因果或新设定；只能使用大纲、世界观、人物设定和前文摘要中已经提供的信息
- 不得让角色说出其未在前文获得的信息；如果某个矛盾无法在已知信息内自然解决，应在规划中回避该解释或保持待解，而不是强行解释
${
  characterOmissionIssues.length > 0
    ? `
【角色遗漏专项修复】
上轮检测到以下角色遗漏问题，本次规划必须修复：
${characterOmissionIssues.map((issue, i) => `${i + 1}. ${issue.description}`).join('\n')}
修复方式（二选一）：
- 方式A：在相关段落的 characters 列表中加入该角色，并在 events 中设计该角色的出场情节
- 方式B：在 timeline 或某段落的 events 中明确说明该角色缺席的合理原因，且该原因必须来自已确立的剧情、人物状态或世界观信息
禁止方式：不得无视该角色，不得让其无故消失且不作任何交代。`
    : ''
}`
}

function buildVerifiedConstraintsSection(verifiedConstraints: string[] | undefined): string {
  if (!verifiedConstraints || verifiedConstraints.length === 0) return ''

  return `【已验证约束 - 后续规划必须保持】
以下约束来自前序重写轮次中已成功解决的问题。它们代表当前章节已被验证为正确的写法、事实或处理方向。本次规划与正文必须继续保持，不得推翻、改写或重新引入已被消除的矛盾：
${verifiedConstraints.map((constraint, i) => `${i + 1}. ${constraint}`).join('\n')}

【要求】
- 如果某条约束涉及时间线、人物关系或关键物品状态，后续规划必须沿用该设定，不得与之矛盾
- 如果某条约束涉及"不得提前推进到后续章节"，必须严格控制本章边界
- 如果某条约束指出某些内容为"非本章核心事件"，应减少其篇幅，聚焦于本章大纲要求的核心事件`
}

function buildClosingPhaseSection(
  totalChapters: number,
  chapterIndex: number,
  bookClosingPhaseRatio: number
): string {
  if (!isClosingPhase(totalChapters, chapterIndex, bookClosingPhaseRatio)) return ''

  return `<closing_phase>
【全书收尾阶段】本书仅剩 ${totalChapters - chapterIndex} 章结束。
- 禁止规划任何专门用于铺垫后续章节的新支线、新角色或新未解悬念；已无未来章节可供延迟回收。
- 必须优先在 outlineCheck 中覆盖所有仍未消费的 mandatory beats 和 key beats，并为每条 pending beat 分配对应 section。
- 非核心过渡段落应尽量压缩，不得发展成独立大场景。
- 本章规划必须向最终高潮/结局推进。
</closing_phase>`
}

function buildStoryStateSection(storyState: string | undefined): string {
  return storyState
    ? `【上一章结束时间】\n${storyState}\n\n请根据本章大纲，判断本章叙事应该从何时开始。如果本章只是正常继续推进，chapterTimeAnchor 等于上一章结束时间；如果本章需要回溯、倒叙或跨越一段时间，请在 chapterTimeAnchor 中明确说明。`
    : '（暂无上一章状态）'
}

function buildStateConflictsSection(stateConflicts: string | undefined): string {
  if (!stateConflicts) return ''

  return `<state_conflicts>
<mandatory>【必须处理的上游状态冲突】</mandatory>
${stateConflicts}

<mandatory>【强制要求】如果上述冲突涉及物品位置矛盾，本章必须明确该物品的唯一当前位置，并通过清晰的角色动作（即物品转移或交接动作）完成转移，不得让同一物品同时出现在两个位置；如果涉及歧义物品名，本章必须使用统一标准名称，禁止同一物品以多个别名并存。</mandatory>
</state_conflicts>`
}

function buildChapterContractSection(chapterContract: string | undefined): string {
  if (!chapterContract) return ''

  return `<chapter_contract>
<mandatory>【章节契约 - 写作前硬约束】</mandatory>
${chapterContract}
</chapter_contract>`
}

function buildStoryEventAuthoritySection(
  authority: StoryEventAuthorityRegistry | undefined
): string {
  if (!authority) return ''

  return `<story_event_authority>
以下 JSON 是为本章筛选并限量的 expectedEvents 权威机器 ID 视图。references 仅用于把可信结构化名称与 ID 对应起来；各类 *Ids 数组是本章规划应优先使用的引用 ID，不得从其他人物名、描述、摘要或叙事文本推断或自造 ID。omittedCounts 仅表示还有未展示的 runtime authority ID，禁止据此猜测其值。
字段授权映射：
- characterId ∈ characterIds
- character-location.locationId ∈ locationIds ∪ {null}
- itemId ∈ itemIds
- item-location.holderId ∈ characterIds ∪ itemIds ∪ {null}
- item-location.locationId ∈ locationIds ∪ characterIds ∪ itemIds ∪ {null}
- plotId ∈ plotIds；beatId ∈ beatIds，允许为 null 的事件可显式输出 null
- 引用既有伏笔的 foreshadowId ∈ foreshadowIds；task-resolve.taskId ∈ taskIds
事件记录自身的 id 每次都使用新的唯一机器 ID，它不是实体引用，也不需要出现在注册表中。
只有创建事件声明的新实体 ID 可以不在注册表中：foreshadow-introduce.foreshadowId 与 task-create.taskId。创建事件内对既有节拍的 beatId 等其他引用仍必须来自注册表。
${JSON.stringify(authority, null, 2)}
</story_event_authority>`
}

export function buildChapterPlannerUserPrompt(
  state: import('../types.js').ChapterPlannerAgentInput,
  planningConfig: import('../../types/genre.js').ChapterPlanningConfig,
  chapterWordCountMin: number,
  chapterWordCountMax: number,
  displayChapterNumber: string | number
): string {
  const chapterIndex = state.chapterIndex ?? 0

  const sections: ChapterPlannerPromptSections = {
    issuesSection: buildIssuesSection(state),
    verifiedConstraintsSection: buildVerifiedConstraintsSection(state.verifiedConstraints),
    foreshadowPlanningSection: buildForeshadowPlanningSection(state),
    closingPhaseSection: buildClosingPhaseSection(
      state.totalChapters,
      chapterIndex,
      planningConfig.bookClosingPhaseRatio
    ),
    storyStateSection: buildStoryStateSection(state.storyState),
    chapterContractSection: buildChapterContractSection(state.chapterContract),
    stateConflictsSection: buildStateConflictsSection(state.stateConflicts),
    characterWhitelistSection: buildCharacterWhitelistSection({
      charactersList: state.charactersList,
      outlineCharacters: state.outlineCharacters,
    }),
    storyEventAuthoritySection: buildStoryEventAuthoritySection(state.storyEventAuthority),
    storyEventContractSection: buildPlannerStoryEventContract(chapterIndex),
  }

  const vars: ChapterPlannerPromptVariables = {
    chapterIndex,
    displayChapterNumber,
    outline: state.outline || '',
    world: state.world || '（尚未构建）',
    characters: state.characters || '（尚未创建）',
    previousSummary: state.previousChapters || '（这是第一章）',
    CORE_EVENT_RATIO_TARGET_PERCENT: Math.round(planningConfig.coreEventRatioTarget * 100),
    CORE_EVENT_RATIO_MIN_PERCENT: Math.round(planningConfig.coreEventRatioMin * 100),
    MAX_NON_CORE_SECTION_WORD_COUNT: planningConfig.maxNonCoreSectionWordCount,
    MIN_CORE_SECTION_WORD_COUNT: planningConfig.minCoreSectionWordCount,
    MAX_BACKGROUND_TASK_WORD_COUNT: planningConfig.maxBackgroundTaskWordCount,
    MAX_EXECUTED_TASK_RATIO_PERCENT: Math.round(planningConfig.maxExecutedTaskRatio * 100),
    MAX_BRIDGE_SCENE_RATIO_PERCENT: Math.round(planningConfig.maxBridgeSceneRatio * 100),
    CHAPTER_WORD_COUNT_MIN: chapterWordCountMin,
    CHAPTER_WORD_COUNT_MAX: chapterWordCountMax,
    MIN_SECTIONS: planningConfig.minSections,
    MAX_SECTIONS: planningConfig.maxSections,
    MIN_CORE_SECTIONS: planningConfig.minCoreSections,
  }

  return renderTemplate(CHAPTER_PLANNER_USER_PROMPT_TEMPLATE, {
    ...sections,
    ...vars,
  })
}
