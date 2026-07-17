import { renderTemplate } from '../../utils/template.js'
import {
  AI_PHRASE_PROHIBITIONS,
  TIMELINE_RULES,
  FACT_CONSISTENCY_RULES,
  CAPABILITY_CONSISTENCY_RULES,
  CROSS_CHAPTER_CONTINUITY_RULES,
  FORESHADOW_BOUNDARY_RULES,
  CHAPTER_OUTPUT_RULES,
  OFFICIAL_CHARACTER_RULES,
  FORESHADOW_DISCIPLINE_RULES,
  ABSTRACT_OUTCOME_RULES,
  PENDING_TASK_AUTHORITY_RULES,
  TIME_ANCHOR_AUTHORITY_RULES,
} from './fragments/index.js'

const CHAPTER_SYSTEM_PROMPT = `<system>
<role>专业小说作家</role>
<capability>擅长细腻的描写、丰富的人物刻画和扣人心弦的情节推进</capability>
<requirement>在动笔前，你必须先完成预写对齐检查，确认每个大纲要求都有明确的执行计划，然后严格按照该计划撰写正文</requirement>
</system>`

export function buildChapterSystemPrompt(): string {
  return CHAPTER_SYSTEM_PROMPT
}

const CHAPTER_USER_PROMPT_TEMPLATE = `{absoluteConstraintsSection}

<task>
<instruction>请撰写第 {displayChapterNumber} 章的正文内容。</instruction>

<main_character>
<important>【重要】本章主角列表：{protagonistList}。所有列出的主角姓名在整章中必须保持一致，不得擅自更名！</important>
</main_character>

<chapter_outline>
<requirement>【必须严格遵循】本章大纲：</requirement>
<title>标题：{chapterTitle}</title>
<description>核心事件：{chapterDescription}</description>

<important>【重要】大纲中的每个情节点都必须完整呈现！如果大纲中用连接词串联多个事件，必须在章节中呈现所有事件，不可遗漏任何情节点！</important>
</chapter_outline>

<world_setting>
<requirement>【必须严格遵循】世界观设定：</requirement>
{worldSetting}
</world_setting>

<character_setting>
<requirement>【必须严格遵循】人物设定：</requirement>
{characterSetting}
</character_setting>

{characterWhitelistSection}

{chapterSupplement}

<previous_summary>
<note>【叙事氛围参考】以下内容为前几章的压缩摘要，仅用于保持叙事风格、情绪基调和角色关系的连续性，不作为事实依据。</note>
<note>【重要】已确立的事实必须以【权威事实】中的记录为准。如果本摘要与【权威事实】存在任何差异，以【权威事实】为准。</note>
{previousSummary}
</previous_summary>

{storyStateSection}

{chapterContractSection}

{writingConstraintsSection}

{stateConflictsSection}

{timeAnchorSection}

{beatMappingSection}

{planSection}

{expectedEventsSection}

{taskResolutionSection}

{outlineComplianceSection}

{issuesSection}

{foreshadowSection}

{closingReminder}{existingChapterSection}

<output_format>
<requirement>【输出格式要求 - 必须严格遵守】</requirement>
你的输出必须分为以下部分，用以下标记分隔：

=== PRE_WRITE_CHECK ===
（预写对齐检查表，见下方说明）

=== STORY_EVENTS ===
（本章关键事实变化清单，见下方说明）

=== CHAPTER_CONTENT ===
（正文内容，从这里开始写小说正文）

=== STORY_FINAL_STATE ===
（章末终态声明，见下方说明）

<pre_write_check_section>
<title>【第一部分：PRE_WRITE_CHECK - 写正文前必须先完成】</title>
<content>在写正文之前，请先输出预写对齐检查表，逐条确认本章如何落实大纲要求。

必须包含以下检查项（以 Markdown 表格形式输出）：

| 检查项 | 来源 | 具体要求 | 本章执行计划 | 对应段落 |
|--------|------|----------|-------------|----------|
{outlineKeyPointsRows}
{planSectionsRows}
{writingConstraintRows}
{stateConflictsRow}
{expectedEventsRow}
| 关键台词 | 大纲 | （如有大纲要求的台词，请列出） | （请填写：由谁说、在什么场景说） | （请填写） |
| 事实核查 | 权威事实 | 本章涉及的事实是否已核对？ | （请填写：核对结果） | （请填写） |
| 时间线 | 大纲/规划 | （如有时间要求，请列出） | （请填写：时间如何推进） | （请填写） |
| 人物出场 | 大纲/规划 | （列出必须出场的人物） | （请填写：各自承担什么功能） | （请填写） |

在表格之后，必须输出以下自检清单：
- [ ] 所有涉及物品来源、角色关系、世界规则的描述都与已确立事实一致
- [ ] 没有 invent 新的事实
- [ ] 如果大纲有新设定，已明确标注并与旧事实区分
- [ ] 大纲中的每个情节点都已在本章找到对应呈现方式
- [ ] 章节规划中的每个段落都有明确的展开计划
- [ ] 关键台词已标注说话人和场景
- [ ] 时间线跨度符合大纲要求
- [ ] 没有遗漏任何大纲要求
- [ ] 没有发现与大纲矛盾的执行计划

<important>【重要】PRE_WRITE_CHECK 完成后，才能开始写正文。PRE_WRITE_CHECK 中的计划必须与正文完全一致，正文必须严格遵循 PRE_WRITE_CHECK 中确认的执行计划。</important>
</content>
</pre_write_check_section>

<story_events_section>
<title>【STORY_EVENTS - 正文前的关键事实变化清单】</title>
<content>在 PRE_WRITE_CHECK 之后、CHAPTER_CONTENT 之前，必须输出一个 === STORY_EVENTS === 区块，逐条列出本章明确引起的事实变化。

如果本章没有任何事实变化，可以输出空区块（只保留标记），但不得省略该区块。

每条事件使用以下格式之一，并严格使用大纲/规划中给定的精确 ID；每条事件末尾必须追加正文段落证据 @pN，其中 N 是 CHAPTER_CONTENT 中非标题正文段落的 1-based 序号：
- character-location: <characterId> -> <locationId> @pN
- character-status: <characterId> / <attribute> -> <value> @pN
- item-location: <itemId> / holder=<holderId|none> / location=<locationId|none> @pN
- item-state: <itemId> / <attribute> -> <value> @pN
- plot-advance: <plotId> / <beatId> @pN
- foreshadow-introduce: <foreshadowId> / expected=<expectedFulfillChapter|none> / policy=<must_resolve|should_resolve|may_remain_open> / kind=<character_arc|environmental_detail|dialogue_hint|object_foreshadow|inner_conflict|plot|other> / required=<true|false> / beat=<beatId|none> / text=<伏笔可读描述> / question=<resolutionQuestion> / criteria=<fulfillmentCriteria> @pN
- foreshadow-fulfill: <foreshadowId> @pN
- task-resolve: <taskId> @pN
- task-create: <taskId> / <description> @pN

<important>【重要】只列出本章正文明确造成的事实变化；不要列出前章已确立的状态、不要列出猜测或潜在可能。所有 ID 必须来自大纲、章节规划或前序状态，不得 invent 新的标识符；ID 必须使用机器可读的结构化标识符（如 c-character-id、item-item-id），禁止使用中文名称、描述性短语或自造格式作为 ID 字段的值。</important>

<important>【位置与状态事件区分 - 高频错误】
  - character-location：角色从一个地点移动到另一个地点（如离开、抵达、回家、出门）。只要角色位置发生改变，就必须使用此类型，不得使用 character-status。
  - item-location：物品被移动、交接、取出、放回、随身携带、锁回某处等导致物品所在位置或持有者变化的情况。"锁回木箱""放入抽屉""贴身携带"等动作都属于位置变化，必须使用 item-location，并将木箱/抽屉/角色等对应 ID 填入 locationId 或 holderId。
  - 【关键区分】locationId 是物品的"主位置"（ canonical location ）。物品最终停留在某个固定地点/容器时，locationId 必须是该地点/容器 ID，holderId 必须为 none；物品最终被角色随身携带且其位置就是该角色时，locationId 应填写该角色 ID（与 holderId 一致），而不是某个地点 ID。禁止出现 "locationId=地点ID 但 holderId=角色ID" 这种两者语义矛盾的写法——那会让系统无法判断物品究竟在哪里。
  - item-state：仅用于物品自身属性变化，如破损、开封、浸湿、折叠、密封状态变化、燃烧等，不用于位置变化。
  - 没有可定位正文段落证据的事件不得输出。foreshadow-introduce 的 text 必须描述本章正文中实际出现的暗示，不能写未来揭示内容；expected 必须是严格晚于本章的 1-based 整数章节号，无法安排时使用 none。
  - 新建 must_resolve 伏笔必须提供非空 question 与 criteria，分别描述待解问题和可观察的完成判据；新建 should_resolve 伏笔应尽量提供。复用 legacy 事件时允许省略，禁止臆造。</important>

<important>【expectedEvents 强制复用 - 最高优先级】
  - 如果【本章必须输出的结构化事件】已提供 expectedEvents，STORY_EVENTS 必须包含其中的每一条事件，且类型、ID、所有字段值必须与 expectedEvents 中的 JSON 完全一致。
  - 禁止省略、禁止改写为其他类型、禁止更改任何字段值、禁止 invent 新 ID 替换已有 ID。
  - character-location / item-location / character-status / item-state / plot-advance / foreshadow-introduce / foreshadow-fulfill / task-resolve / task-create 等所有类型的事件都必须按上述规则复用。
  - 输出顺序可与 expectedEvents 不同，但内容必须一一对应；系统会通过类型与字段值精确匹配来校验，任何字段不一致都会被判定为错误并要求重写。</important>

<important>【终态覆盖强制要求】如果本章正文中某实体的位置或状态发生了多次变化（例如先移走又放回、先受伤又痊愈），STORY_EVENTS 中该实体该属性的最后一条事件必须反映章末终态，而不是章中的中间状态。章末的归位、恢复、状态逆转等动作与章中的变化动作同等重要，必须输出对应事件。同一实体在本章内发生多次位置/状态变化属于正常叙事，不会被判为冲突，但所有中间变化与最终归位都必须有对应事件。</important>
</content>
</story_events_section>

<story_final_state_section>
<title>【STORY_FINAL_STATE - 章末终态自声明（正文之后必须输出）】</title>
<content>在 CHAPTER_CONTENT 正文结束之后，必须输出一个 === STORY_FINAL_STATE === 区块，以 JSON 数组逐条声明本章所有发生过位置或状态变化的实体的章末终态：

=== STORY_FINAL_STATE ===
[
  {"entityId": "<characterId 或 itemId>", "attribute": "location", "value": "<locationId 或 holderId>"},
  {"entityId": "<characterId 或 itemId>", "attribute": "status", "value": "<事件 value 字段的精确副本>"}
]

规则：
- entityId 必须是机器可读的结构化 ID（如 c-character-id、item-item-id），禁止使用中文名称、描述性短语或自造格式。
- 只声明本章正文明确引起过位置/状态变化的实体；本章没有任何位置/状态变化时输出空数组 []，但不得省略该区块。
- attribute 只能是 "location" 或 "status"。
  - location 的 value 必须是 STORY_EVENTS 中对应事件 locationId 字段的结构化 ID（物品最终在哪里就写哪里的 ID），禁止自然语言描述。若 item-location 的 locationId 为 null 而 holderId 非 null，才允许写 holderId 的值。
  - status 的 value 必须是 STORY_EVENTS 中对应 character-status / item-state 事件的 value 字段的精确副本（短枚举值、既有状态短语或 JSON 字面量均可，禁止临时编造新表述）。
- 【 critical 】status 的 value 只写事件值本身，不要把属性名与值拼接。如果 STORY_EVENTS 中的事件是 \`item-state: <item-id> / <attribute> -> <value>\`，则 STORY_FINAL_STATE 中只能写 \`{"entityId": "<item-id>", "attribute": "status", "value": "<value>"}\`，严禁写成 \`"<attribute>=<value>"\`。
- 每条声明必须与 STORY_EVENTS 一致：该实体该属性在 STORY_EVENTS 中的最后一条事件的值必须与声明的 value 完全相同。系统会逐条校验：有对应事件但终态值不一致将被判为错误并要求重写本章；声明的实体本章无对应事件时仅记为提示。
</content>
</story_final_state_section>

<chapter_content_section>
<title>【第二部分：CHAPTER_CONTENT - 正文写作要求】</title>
<content>
${CHAPTER_OUTPUT_RULES}
<rule id="1"><mandatory>【必须】</mandatory>严格按照大纲的每一个情节点展开剧情，大纲中提到的所有事件都必须完整呈现</rule>
<rule id="2"><mandatory>【必须】</mandatory>所有列出的主角姓名必须保持为"{protagonistList}"中的对应姓名，不得擅自更名</rule>
<rule id="3"><mandatory>【必须】</mandatory>物品名称、专有名词、特殊设定名称等必须与大纲完全一致</rule>
${TIMELINE_RULES}
<rule id="5"><mandatory>【必须】</mandatory>关键台词必须原样出现：
   - 大纲中明确要求的台词必须一字不差地出现
   - 不能擅自改写为意思相近但措辞不同的句子</rule>
<rule id="6"><mandatory>【必须】</mandatory>叙述视角保持一致，避免出现视角跳跃</rule>
<rule id="7"><mandatory>【必须】</mandatory>因果关系明确：前一事件的结果必须自然导致后一事件，不能生硬跳转</rule>
<rule id="8"><mandatory>【必须】</mandatory>信息一致性：本章内所有描述必须自洽，不能前后矛盾</rule>
${AI_PHRASE_PROHIBITIONS}
<rule id="10">注重人物对话和心理描写</rule>
<rule id="11">适时埋下伏笔，为后续章节留下悬念</rule>
<rule id="12"><mandatory>【必须】</mandatory>每章字数要求：
     - 本章总字数应控制在 {CHAPTER_WORD_COUNT_MIN}-{CHAPTER_WORD_COUNT_MAX} 字之间
     - 每章字数应均匀分布，避免出现过短章节
     - 严禁用几句话草率收尾，每章都必须有充实的情节展开</rule>
<rule id="12b"><mandatory>【必须】</mandatory>本章正文总字数应控制在 {CHAPTER_WORD_COUNT_MIN}-{CHAPTER_WORD_COUNT_MAX} 字之间，允许少量超出（约 {CHAPTER_WORD_COUNT_TOLERANCE_PERCENT}% 以内，作为收尾缓冲）。若超出过多，必须压缩描写、合并段落、删除冗余修辞；严重超限将被拒绝并要求重写。</rule>
${CROSS_CHAPTER_CONTINUITY_RULES}
${FACT_CONSISTENCY_RULES}
${FORESHADOW_BOUNDARY_RULES}
${CAPABILITY_CONSISTENCY_RULES}
${ABSTRACT_OUTCOME_RULES}
${PENDING_TASK_AUTHORITY_RULES}
${TIME_ANCHOR_AUTHORITY_RULES}
<rule id="16">以自然流畅的段落叙述为主</rule>
${OFFICIAL_CHARACTER_RULES}
${FORESHADOW_DISCIPLINE_RULES}
</content>
</chapter_content_section>

请严格按照上述格式输出：先输出 === PRE_WRITE_CHECK === 部分，再输出 === STORY_EVENTS === 部分，然后输出 === CHAPTER_CONTENT === 部分，最后输出 === STORY_FINAL_STATE === 部分。
</output_format>
</task>`

export interface ChapterPromptSections {
  absoluteConstraintsSection: string
  characterWhitelistSection: string
  chapterSupplement: string
  previousSummary: string
  storyStateSection: string
  chapterContractSection: string
  writingConstraintsSection: string
  stateConflictsSection: string
  timeAnchorSection: string
  beatMappingSection: string
  planSection: string
  expectedEventsSection: string
  taskResolutionSection: string
  outlineComplianceSection: string
  issuesSection: string
  foreshadowSection: string
  closingReminder: string
  existingChapterSection: string
  outlineKeyPointsRows: string
  planSectionsRows: string
  writingConstraintRows: string
  stateConflictsRow: string
  expectedEventsRow: string
}

export interface ChapterPromptVariables {
  displayChapterNumber: string | number
  protagonistList: string
  chapterTitle: string
  chapterDescription: string
  worldSetting: string
  characterSetting: string
  CHAPTER_WORD_COUNT_MIN: number
  CHAPTER_WORD_COUNT_MAX: number
  CHAPTER_WORD_COUNT_TOLERANCE_PERCENT: number
  MAX_BACKGROUND_TASK_WORD_COUNT: number
  CLOSING_FORESHADOW_RECOVERY_PERCENT: number
}

export function buildChapterUserPrompt(
  sections: ChapterPromptSections,
  vars: ChapterPromptVariables
): string {
  return renderTemplate(CHAPTER_USER_PROMPT_TEMPLATE, {
    ...sections,
    ...vars,
  })
}

export interface BeatMappingEntry {
  beatId: string
  description: string
  claimed: boolean
}

export function buildBeatMappingSection(actIndex: number, entries: BeatMappingEntry[]): string {
  if (entries.length === 0) return ''

  const claimed = entries.filter((e) => e.claimed)
  const unclaimed = entries.filter((e) => !e.claimed)

  const renderEntry = (e: BeatMappingEntry) => `- ${e.beatId}: ${e.description}`

  const claimedLines =
    claimed.length > 0
      ? [
          '<claimed_beats>',
          '本章规划要求推进以下节拍（请在 STORY_EVENTS 中输出对应 plot-advance 事件）：',
          ...claimed.map(renderEntry),
          '</claimed_beats>',
        ]
      : []

  const unclaimedLines =
    unclaimed.length > 0
      ? [
          '<available_beats>',
          '本幕其余待推进节拍（如本章正文也推进了这些节拍，请同样输出 plot-advance 事件）：',
          ...unclaimed.map(renderEntry),
          '</available_beats>',
        ]
      : []

  return `<beat_mapping>
<title>【当前幕 mandatory beat ID 映射 - 必须使用这些精确 ID】</title>
<content>
第 ${actIndex} 幕的 mandatory beats 已分配稳定 ID。在 === STORY_EVENTS === 区块中，每推进一个节拍，必须输出：

- plot-advance: act-${actIndex} / <beatId> @pN

其中 &lt;beatId&gt; 必须严格使用下方列表中的 ID，不得使用描述文本或自造 ID。

${claimedLines.join('\n')}
${unclaimedLines.join('\n')}
</content>
</beat_mapping>`
}
