import { renderTemplate } from '../../utils/template.js'
import { classifyForeshadows } from '../../story-memory/foreshadow-policy.js'

const FORESHADOWING_SYSTEM_PROMPT =
  '<role>你是一位擅长埋伏笔和制造悬念的作家，擅长在叙述中埋下不引人注意但回味无穷的线索。</role>'

export function buildForeshadowingSystemPrompt(): string {
  return FORESHADOWING_SYSTEM_PROMPT
}

const FORESHADOWING_USER_PROMPT_TEMPLATE = `<instruction>
  请分析以下章节，完成两项任务：1) 检测已埋伏笔是否在本章被回收，2) 在合适的情况下埋下新的伏笔。
  {CLOSING_PHASE_INSTRUCTION}
</instruction>

<anti_pattern>
  <trap>防止"自埋自收"陷阱</trap>
  <description>
    在判断是否需要埋下新伏笔时，请严格区分：
    <genuine>"真正的伏笔"：本章只给出轻微暗示或线索，核心悬念需要在未来章节揭示。它通常表现为未加解释的言行、异常细节或尚未兑现的暗示。</genuine>
    <narrative>"本章正常情节推进"：本章已经完整呈现或解释的内容**不是**伏笔，而是叙事本身。</narrative>
    <rule>如果某个"伏笔"的文本内容就是本章正在描写的情节，这属于"自埋自收"陷阱，**绝对不要**将其标记为新伏笔。</rule>
  </description>
</anti_pattern>

<strict_rules>
  <rule>【禁止从大纲/规划生成伏笔】你不得把故事大纲、章节规划或未来剧情摘要中的内容登记为新伏笔。新伏笔必须源自本章正文中的具体细节、对话或场景，而不是源自对后续章节的预先了解。</rule>
  <rule>【禁止把当前叙事登记为伏笔】如果某句话或某个细节在本章中已经得到解释、已经实现或已经完整呈现，它不是伏笔，而是本章叙事的一部分。已明确说出的条件、已经完成的决定、本章已揭晓的信息均不得登记为伏笔。</rule>
  <rule>【禁止登记短文本或通用细节】长度低于 {FORESHADOW_MIN_LENGTH} 字的条目、以及"角色注意到某事"这类过于笼统的描述，不得作为新伏笔。</rule>
  <rule>【禁止登记未来台词】不得把角色未来才可能说的话、未来才可能产生的想法提前登记为伏笔。伏笔必须是本章中实际出现的、可被读者感知到的暗示。</rule>
  <rule>【预期回收章节必须合理】新伏笔的预期回收章节应当是本章之后 {FORESHADOW_MIN_FULFILL_DISTANCE}-{FORESHADOW_MAX_FULFILL_DISTANCE} 章的范围内。除非有非常强的叙事理由，否则不得把伏笔预期回收章节设置得过远，以免被误判为"提前剧透"。</rule>
</strict_rules>

<chapter_content>
  {CHAPTER_CONTENT}
</chapter_content>

<existing_foreshadows>
  {EXISTING_FORESHADOWS_SECTION}
</existing_foreshadows>

<guidelines>
  <foreshadow_types>
    <type>人物言行中暗示未来走向或选择的内容</type>
    <type>环境中不寻常的细节，可能在未来产生重要影响</type>
    <type>人物对话中的承诺、预兆、预感</type>
    <type>看似无关紧要的物品、事件在未来的关键作用</type>
    <type>人物内心深处的秘密或矛盾</type>
  </foreshadow_types>

  <fulfillment_rules>
    <rule>如果本章中出现了与伏笔含义相关的情节（即使措辞不完全相同），也视为已回收</rule>
    <rule>如果伏笔的核心悬念在本章得到了揭示或呼应，也视为已回收</rule>
    <rule>如果伏笔涉及的人物、物品、事件在本章有重要进展，也视为已回收</rule>
    <rule>不要严格依赖文本完全匹配，要从语义层面判断是否回收</rule>
  </fulfillment_rules>
</guidelines>

<output_format>
  请输出 JSON 格式：
  {
    "new_foreshadows": [
      {
        "text": "伏笔文本内容",
        "foreshadow_type": "character_arc|environmental_detail|dialogue_hint|object_foreshadow|inner_conflict",
        "expected_fulfill_chapter": 数字,
        "confidence": "high|medium|low"
      }
    ],
    "fulfilled_foreshadows": ["被回收伏笔的 id 或 index 数字，不要输出伏笔文本"],
    "overdue_foreshadows": ["超过预期章节仍未回收伏笔的 id 或 index 数字，不要输出伏笔文本"]
  }
  如果本章没有发现值得埋下的伏笔，new_foreshadows 返回空数组 []。
</output_format>`

export interface ForeshadowingPromptVariables {
  closingPhaseInstruction: string
  chapterContent: string
  existingForeshadowsSection: string
  FORESHADOW_MIN_LENGTH: number
  FORESHADOW_MIN_FULFILL_DISTANCE: number
  FORESHADOW_MAX_FULFILL_DISTANCE: number
}

export function buildForeshadowingUserPrompt(
  state: import('../types.js').ForeshadowingAgentInput,
  planningConfig: import('../../types/genre.js').ChapterPlanningConfig
): string {
  const existingForeshadows = state.foreshadowStack || []
  const currentChapter = (state.chapterIndex ?? 0) + 1
  const totalChapters = state.totalChapters ?? currentChapter

  const noNewThreshold = Math.max(3, Math.floor(totalChapters * planningConfig.closingPhaseRatio))
  const isClosingPhase = currentChapter > totalChapters - noNewThreshold

  const {
    overdueRequired: overdueForeshadows,
    dueRequired: mustFulfillForeshadows,
    normalRequired: normalForeshadows,
    optional: optionalForeshadows,
  } = classifyForeshadows(existingForeshadows, currentChapter)

  const closingPhaseInstruction = isClosingPhase
    ? `当前已进入收尾阶段（第 ${currentChapter}/${totalChapters} 章，剩余 ${totalChapters - currentChapter} 章）。**禁止埋下新的伏笔**。所有未回收的必需伏笔必须在本章或剩余章节内回收完毕。new_foreshadows 必须返回空数组 []。`
    : '请先检查回收，再考虑埋下新伏笔。如果已有大量未回收伏笔，应优先回收而非新增。'

  const existingForeshadowsSection = `${
    existingForeshadows.length > 0
      ? existingForeshadows
          .map(
            (f, i) =>
              `  <item id="${f.id}" index="${i + 1}" created_at="${f.createdAtChapter ?? '?'}" expected="${f.expectedFulfillChapter}">${f.text}</item>`
          )
          .join('\n')
      : '（暂无已埋伏笔）'
  }
  ${
    mustFulfillForeshadows.length > 0
      ? `
  <must_fulfill>
    ${mustFulfillForeshadows.map((f, i) => `    <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${currentChapter}">${f.text}</item>`).join('\n')}
  </must_fulfill>`
      : ''
  }
  ${
    overdueForeshadows.length > 0
      ? `
  <overdue>
    ${overdueForeshadows.map((f, i) => `    <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${currentChapter}" overdue="${currentChapter - f.expectedFulfillChapter}">${f.text}</item>`).join('\n')}
  </overdue>`
      : ''
  }
  ${
    normalForeshadows.length > 0
      ? `
  <normal>
    ${normalForeshadows.map((f, i) => `    <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${currentChapter}">${f.text}</item>`).join('\n')}
  </normal>`
      : ''
  }
  ${
    optionalForeshadows.length > 0
      ? `
  <optional>
    ${optionalForeshadows.map((f, i) => `    <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${currentChapter}">${f.text}</item>`).join('\n')}
  </optional>`
      : ''
  }`

  return renderTemplate(FORESHADOWING_USER_PROMPT_TEMPLATE, {
    CLOSING_PHASE_INSTRUCTION: closingPhaseInstruction,
    CHAPTER_CONTENT: state.chapterContent || '（无内容）',
    EXISTING_FORESHADOWS_SECTION: existingForeshadowsSection,
    FORESHADOW_MIN_LENGTH: planningConfig.foreshadowMinLength,
    FORESHADOW_MIN_FULFILL_DISTANCE: planningConfig.foreshadowMinFulfillDistance,
    FORESHADOW_MAX_FULFILL_DISTANCE: planningConfig.foreshadowMaxFulfillDistance,
  })
}
