import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import { renderTemplate } from '../../utils/template.js'
import { computePromptHash } from './version.js'

const CHAPTER_OUTLINE_SYSTEM_PROMPT =
  '你是一位严谨的小说章节策划。你的任务是在每章动笔前，根据当前幕结构、权威事实和叙事进度，即时生成该章的具体大纲。你绝不提前执行后续幕的内容，也绝不与已确立的权威事实冲突。'

const CHAPTER_OUTLINE_USER_PROMPT_TEMPLATE = `<task>请为第 {DISPLAY_CHAPTER_NUMBER} 章生成具体的章节大纲。</task>

<context>
{ACT_SECTION}

{NEXT_ACT_SECTION}

{CLOSING_PHASE_SECTION}

<story_arc>
总章节数：{TOTAL_CHAPTERS}
全局关键情节点池：{KEY_BEATS}
</story_arc>

{WORLD_SECTION}

{CHARACTERS_SECTION}

{PREVIOUS_SUMMARY_SECTION}

{STORY_STATE_SECTION}

{CANONICAL_FACTS_SECTION}

{VERIFIED_CONSTRAINTS_SECTION}
</context>

<instruction>
1. 生成本章标题和 1–2 句描述（30–60 字）。
2. 标题和描述必须与当前幕的叙事功能和主题一致。
3. 必须尊重 <story_state> 和 <canonical_facts> 中的权威事实，不得与之矛盾。
4. 优先推进当前幕尚未消费的 mandatory beats；如果本章不适合推进任何 beat，请说明原因。
5. 不得提前执行下一幕的叙事功能，不得提前完成后续幕的 mandatory beats。
6. 如果当前幕进度偏慢（剩余章节少、pending beats 多），请在本章安排推进至少一个 pending beat。
7. conflict: true 只能用于本章 description 与 <story_state> 或 <canonical_facts> 中已确立事实发生硬冲突的情况，并必须说明冲突的具体事实。
8. 如果只是本章不适合推进某个 mandatory beat，不要返回 conflict: true；请返回 conflict: false，并从 claimedBeats 中移除该 beat，或改写 description 使其明确承载该 beat。
9. claimedBeats 只能包含 description 已明确写出具体事件、冲突或状态变化的本幕 mandatory beats，不要强行贴标签。
10. 除章节内容外，输出下列结构化声明字段（无相关项时为空数组）：
   - touchedCharacterIds: 本章出现的角色 EntityId 列表
   - touchedItemIds: 本章出现的物品 EntityId 列表
   - touchedLocationIds: 本章出现的地点 EntityId 列表
   - claimedBeatIds: 本章推进的 BeatId 列表
   - fulfilledForeshadowIds: 本章兑现的 ForeshadowId 列表
   - introducedForeshadowIds: 本章埋下的 ForeshadowId 列表
   - resolvedTaskIds: 本章关闭的 TaskId 列表
   - createdTaskIds: 本章开启的 TaskId 列表
11. 输出 JSON 格式：
   {
     "title": "章节标题",
     "description": "本章具体执行描述",
     "introducedCharacters": ["新角色名"],
     "claimedBeats": ["本幕 mandatory beat 1"],
     "touchedCharacterIds": [],
     "touchedItemIds": [],
     "touchedLocationIds": [],
     "claimedBeatIds": [],
     "fulfilledForeshadowIds": [],
     "introducedForeshadowIds": [],
     "resolvedTaskIds": [],
     "createdTaskIds": [],
     "conflict": false,
     "conflictReason": ""
   }
</instruction>`

export function buildChapterOutlineSystemPrompt(): string {
  return CHAPTER_OUTLINE_SYSTEM_PROMPT
}

export interface ChapterOutlinePromptSections {
  actSection: string
  nextActSection: string
  closingPhaseSection: string
}

export function buildChapterOutlineUserPrompt(
  state: import('../types.js').ChapterOutlineAgentInput,
  sections: ChapterOutlinePromptSections
): string {
  const storyArc = state.storyArc
  const displayChapterNumber = toDisplayChapterNumber(state.chapterIndex ?? 0)

  return renderTemplate(CHAPTER_OUTLINE_USER_PROMPT_TEMPLATE, {
    DISPLAY_CHAPTER_NUMBER: displayChapterNumber,
    ACT_SECTION: sections.actSection,
    NEXT_ACT_SECTION: sections.nextActSection,
    CLOSING_PHASE_SECTION: sections.closingPhaseSection,
    TOTAL_CHAPTERS: state.totalChapters,
    KEY_BEATS:
      storyArc?.keyBeats.map((k) => `${k.beat}（截止第${k.deadlineAct}幕）`).join('、') || '（无）',
    WORLD_SECTION: state.world ? `<world>\n${state.world}\n</world>` : '',
    CHARACTERS_SECTION: state.characters ? `<characters>\n${state.characters}\n</characters>` : '',
    PREVIOUS_SUMMARY_SECTION: state.previousChapters
      ? `<previous_summary>\n${state.previousChapters}\n</previous_summary>`
      : '',
    STORY_STATE_SECTION: state.storyState
      ? `<story_state>\n${state.storyState}\n</story_state>`
      : '',
    CANONICAL_FACTS_SECTION:
      state.canonicalFacts && state.canonicalFacts.length > 0
        ? `<canonical_facts>\n${JSON.stringify(state.canonicalFacts, null, 2)}\n</canonical_facts>`
        : '',
    VERIFIED_CONSTRAINTS_SECTION:
      state.verifiedConstraints && state.verifiedConstraints.length > 0
        ? `<verified_constraints>\n${state.verifiedConstraints.join('\n')}\n</verified_constraints>`
        : '',
  })
}

export const PROMPT_VERSION = computePromptHash(
  CHAPTER_OUTLINE_SYSTEM_PROMPT,
  CHAPTER_OUTLINE_USER_PROMPT_TEMPLATE
)
