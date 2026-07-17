import { toDisplayChapterNumber } from '../../utils/chapter-display.js'
import { renderTemplate } from '../../utils/template.js'
import type { ChapterPlanningConfig } from '../../types/genre.js'
import { buildForeshadowPlanningSection } from './fragments/index.js'

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

{CURRENT_STATE_SNAPSHOT_SECTION}

{VERIFIED_CONSTRAINTS_SECTION}

{FORESHADOW_PLANNING_SECTION}
</context>

<instruction>
1. 生成本章标题和 {OUTLINE_DESCRIPTION_SENTENCE_COUNT_MIN}–{OUTLINE_DESCRIPTION_SENTENCE_COUNT_MAX} 句描述（{OUTLINE_DESCRIPTION_LENGTH_MIN}–{OUTLINE_DESCRIPTION_LENGTH_MAX} 字）。
2. 标题和描述必须与当前幕的叙事功能和主题一致。
3. 必须尊重 <story_state>、<canonical_facts> 和 <current_state_snapshot> 中的权威事实，不得与之矛盾。本章 description 中的角色位置、物品位置和时间起点必须与 <current_state_snapshot> 保持一致；如需改变这些状态，必须通过清晰的角色动作完成转移，不得让角色或物品瞬间跳转。
4. 优先推进当前幕尚未消费的 mandatory beats；如果本章不适合推进任何 beat，请说明原因。
5. 不得提前执行下一幕的叙事功能，不得提前完成后续幕的 mandatory beats。
6. 如果当前幕进度偏慢（剩余章节少、pending beats 多），请在本章安排推进至少一个 pending beat。
7. 【节拍预算】本章 claimedBeats 数量不得超过 <current_act> 中“本章节拍预算”给出的上限。description 中若涉及多个节拍事件，请只选择本章真正核心推进的若干项纳入 claimedBeats，其余可作为铺垫、悬念或后续伏笔处理，避免把整幕节拍集中在本章一次性消费完。
8. claimedBeats 只能包含 description 已明确写出具体事件、冲突或状态变化的本幕 mandatory beats，不要强行贴标签。
9. 除章节内容外，输出下列结构化声明字段（无相关项时为空数组）：
   - touchedCharacterIds: 本章出现的角色 EntityId 列表
   - touchedItemIds: 本章出现的物品 EntityId 列表
   - touchedLocationIds: 本章出现的地点 EntityId 列表
   - claimedMandatoryBeatIds: 本章推进的 mandatory beat ID 列表，必须严格引用 <current_act> 中给出的精确 ID（如 A2-M3），不得使用描述文本或自造 ID
   - claimedBeatIds: 本章推进的全局 keyBeat ID 列表，只能引用上方 <story_arc> 中 keyBeats 给出的精确 ID（如 A2-B3）；没有推进全局 keyBeat 时输出空数组
   - fulfilledForeshadowIds: 本章兑现的 ForeshadowId 列表；只收录本章有真实、可验证回收事件的 ID
   - deferredForeshadowIds: 本章顺延的候选伏笔 ForeshadowId 列表；收录允许顺延且与本章核心事件不相容的候选 ID
   - introducedForeshadowIds: 本章埋下的 ForeshadowId 列表
   - resolvedTaskIds: 本章关闭的 TaskId 列表
   - createdTaskIds: 本章开启的 TaskId 列表
10. 若存在 <foreshadow_obligations>：每个 schedulingMode=mandatory 的候选 ID 必须出现在且仅出现在 fulfilledForeshadowIds 与 deferredForeshadowIds 之一；mustFulfillThisChapter=true 的 ID 只能兑现，不能顺延。
11. schedulingMode=opportunity 或 ambient 的候选，只有本章核心事件本身能够自然承载真实、可验证的回收时，才放入 fulfilledForeshadowIds；不得为自然回收机会改变本章核心事件。当前章不适合时放入 deferredForeshadowIds，不需要额外制造剧情。
12. 若本章确需引入新伏笔：没有明确且可辩护的有限截止章节时，后续规划应将其声明为 should_resolve；不得把普通伏笔升级成必须在边界前清空的硬义务。
13. 输出 JSON 格式：
   {
     "title": "章节标题",
     "description": "本章具体执行描述",
     "introducedCharacters": ["新角色名"],
     "claimedBeats": ["本幕 mandatory beat 1"],
     "claimedMandatoryBeatIds": ["A2-M1"],
     "touchedCharacterIds": [],
     "touchedItemIds": [],
     "touchedLocationIds": [],
     "claimedBeatIds": [],
     "fulfilledForeshadowIds": [],
     "deferredForeshadowIds": [],
     "introducedForeshadowIds": [],
     "resolvedTaskIds": [],
     "createdTaskIds": []
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
  sections: ChapterOutlinePromptSections,
  planningConfig: Pick<
    ChapterPlanningConfig,
    | 'outlineDescriptionLengthMin'
    | 'outlineDescriptionLengthMax'
    | 'outlineDescriptionSentenceCountMin'
    | 'outlineDescriptionSentenceCountMax'
  >
): string {
  const storyArc = state.storyArc
  const displayChapterNumber = toDisplayChapterNumber(state.chapterIndex ?? 0)

  return renderTemplate(CHAPTER_OUTLINE_USER_PROMPT_TEMPLATE, {
    DISPLAY_CHAPTER_NUMBER: displayChapterNumber,
    OUTLINE_DESCRIPTION_LENGTH_MIN: planningConfig.outlineDescriptionLengthMin,
    OUTLINE_DESCRIPTION_LENGTH_MAX: planningConfig.outlineDescriptionLengthMax,
    OUTLINE_DESCRIPTION_SENTENCE_COUNT_MIN: planningConfig.outlineDescriptionSentenceCountMin,
    OUTLINE_DESCRIPTION_SENTENCE_COUNT_MAX: planningConfig.outlineDescriptionSentenceCountMax,
    ACT_SECTION: sections.actSection,
    NEXT_ACT_SECTION: sections.nextActSection,
    CLOSING_PHASE_SECTION: sections.closingPhaseSection,
    TOTAL_CHAPTERS: state.totalChapters,
    KEY_BEATS:
      storyArc?.keyBeats
        .map((k) => `${k.beat} [ID:${k.id}]（截止第${k.deadlineAct}幕）`)
        .join('、') || '（无）',
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
    CURRENT_STATE_SNAPSHOT_SECTION: state.currentStateSnapshot
      ? `<current_state_snapshot>\n<mandatory>【当前状态快照 - 本章大纲必须与之一致】</mandatory>\n${state.currentStateSnapshot}\n</current_state_snapshot>`
      : '',
    VERIFIED_CONSTRAINTS_SECTION:
      state.verifiedConstraints && state.verifiedConstraints.length > 0
        ? `<verified_constraints>\n${state.verifiedConstraints.join('\n')}\n</verified_constraints>`
        : '',
    FORESHADOW_PLANNING_SECTION: buildForeshadowPlanningSection(state),
  })
}
