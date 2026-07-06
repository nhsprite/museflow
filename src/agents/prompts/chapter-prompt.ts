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
<important>【重要】本章主角姓名是"{mainCharacterName}"，主角的姓名在整章中必须保持一致，不得擅自更改为主角起其他名字！</important>
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

{stateConflictsSection}

{timeAnchorSection}

{factVerificationSection}

{beatMappingSection}

{planSection}

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

<pre_write_check_section>
<title>【第一部分：PRE_WRITE_CHECK - 写正文前必须先完成】</title>
<content>在写正文之前，请先输出预写对齐检查表，逐条确认本章如何落实大纲要求。

必须包含以下检查项（以 Markdown 表格形式输出）：

| 检查项 | 来源 | 具体要求 | 本章执行计划 | 对应段落 |
|--------|------|----------|-------------|----------|
{outlineKeyPointsRows}
{planSectionsRows}
{stateConflictsRow}
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

每条事件使用以下格式之一，并严格使用大纲/规划中给定的精确 ID：
- character-location: <characterId> -> <locationId>
- character-status: <characterId> / <attribute> -> <value>
- item-location: <itemId> -> <holderId>
- item-state: <itemId> / <attribute> -> <value>
- plot-advance: <plotId> / <beatId>
- foreshadow-introduce: <foreshadowId> (expectedFulfillChapter)
- foreshadow-fulfill: <foreshadowId>
- task-resolve: <taskId>
- task-create: <taskId> / <description>

<important>【重要】只列出本章正文明确造成的事实变化；不要列出前章已确立的状态、不要列出猜测或潜在可能。所有 ID 必须来自大纲、章节规划或前序状态，不得 invent 新的标识符。</important>
</content>
</story_events_section>

<chapter_content_section>
<title>【第二部分：CHAPTER_CONTENT - 正文写作要求】</title>
<content>
${CHAPTER_OUTPUT_RULES}
<rule id="1"><mandatory>【必须】</mandatory>严格按照大纲的每一个情节点展开剧情，大纲中提到的所有事件都必须完整呈现</rule>
<rule id="2"><mandatory>【必须】</mandatory>主角姓名必须保持为"{mainCharacterName}"，不得擅自为主角起其他名字</rule>
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

请严格按照上述格式输出：先输出 === PRE_WRITE_CHECK === 部分，再输出 === CHAPTER_CONTENT === 部分。
</output_format>
</task>`

export interface ChapterPromptSections {
  absoluteConstraintsSection: string
  characterWhitelistSection: string
  chapterSupplement: string
  previousSummary: string
  storyStateSection: string
  chapterContractSection: string
  stateConflictsSection: string
  timeAnchorSection: string
  factVerificationSection: string
  beatMappingSection: string
  planSection: string
  taskResolutionSection: string
  outlineComplianceSection: string
  issuesSection: string
  foreshadowSection: string
  closingReminder: string
  existingChapterSection: string
  outlineKeyPointsRows: string
  planSectionsRows: string
  stateConflictsRow: string
}

export interface ChapterPromptVariables {
  displayChapterNumber: string | number
  mainCharacterName: string
  chapterTitle: string
  chapterDescription: string
  worldSetting: string
  characterSetting: string
  CHAPTER_WORD_COUNT_MIN: number
  CHAPTER_WORD_COUNT_MAX: number
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

- plot-advance: act-${actIndex} / <beatId>

其中 &lt;beatId&gt; 必须严格使用下方列表中的 ID，不得使用描述文本或自造 ID。

${claimedLines.join('\n')}
${unclaimedLines.join('\n')}
</content>
</beat_mapping>`
}
