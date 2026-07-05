import { renderTemplate } from '../../utils/template.js'
import {
  OFFICIAL_CHARACTER_RULES,
  STATE_AUTHORITY_RULES,
  buildCharacterWhitelistSection,
} from './fragments/index.js'

const SUMMARY_SYSTEM_PROMPT =
  '<role>你是一位故事结构分析专家，擅长从章节内容中提取人类可读摘要和结构化事件。你必须基于章节正文，输出客观的事实变化事件，不编造、不推测。</role>'

export function buildSummarySystemPrompt(): string {
  return SUMMARY_SYSTEM_PROMPT
}

export function buildClaimedBeatsSection(claimedBeats: string[]): string {
  if (claimedBeats.length === 0) return ''
  return `<claimed_beats>
本章大纲声称要推进的 mandatory beats：
${claimedBeats.map((beat) => `- ${beat}`).join('\n')}

如果上述 beat 在本章正文中确实发生，请在 storyEvents 中以 plot-advance 事件体现；未发生则不要编造对应事件。
</claimed_beats>`
}

const SUMMARY_USER_PROMPT_TEMPLATE = `<task>
  请分析以下章节内容，输出本章摘要和结构化事件。
</task>

<chapter_info>
  <title>{chapterTitle}</title>
  <number>{displayChapterNumber}</number>
</chapter_info>

{claimedBeatsSection}

<chapter_content>
  {chapterContent}
</chapter_content>

{whitelistSection}
${OFFICIAL_CHARACTER_RULES}
${STATE_AUTHORITY_RULES}

<output_rules>
  <requirement>你的响应必须且只能包含两个区块：&lt;chapter_summary&gt; 和 &lt;story_events&gt;。</requirement>
  <requirement>&lt;chapter_summary&gt; 中是人类可读摘要，不要包含 JSON 或代码块。</requirement>
  <requirement>&lt;story_events&gt; 中是一个合法的 JSON 数组，不要包含 Markdown 代码块标记、注释或解释性文字。</requirement>
  <requirement>JSON 必须完整可解析：所有键名用双引号包裹；字符串值中的双引号必须转义；数组和对象末尾不要有多余逗号。</requirement>
  <requirement>如果本章没有某类事件，返回空数组。</requirement>
</output_rules>

<event_types>
  事件类型说明：
  - character-location: 角色所在位置发生变化。
  - character-status: 角色的身体状况、情绪、能力等状态发生变化。
  - item-location: 物品的位置或持有者发生变化。
  - item-state: 物品的状态、属性发生变化。
  - plot-advance: 本章推进了某个关键情节节拍；必须引用 outline 中该节拍的精确 beatId。
  - foreshadow-introduce: 本章新埋下一个伏笔；必须引用 outline 中该伏笔的精确 foreshadowId，并标注预计回收章节 expectedFulfillChapter。
  - foreshadow-fulfill: 本章回收了某个伏笔；必须引用 outline 中该伏笔的精确 foreshadowId。
  - task-resolve: 本章完成了某个任务；必须引用 outline 中该任务的精确 taskId。
  - task-create: 本章创建了某个新任务；必须引用 outline 中该任务的精确 taskId。
</event_types>

<event_rules>
  <requirement>每个事件必须包含 id、type、chapterIndex、source 字段。</requirement>
  <requirement>source 固定为 "chapter"。</requirement>
  <requirement>所有 ID（characterId、itemId、locationId、beatId、foreshadowId、taskId 等）必须使用 outline 中的精确 ID，不得 invent 新 ID。</requirement>
  <requirement>事件必须基于本章正文中明确发生的事实，禁止编造、推测或引入正文未出现的内容。</requirement>
  <requirement>只输出本章新发生或状态发生变化的事件；未变化的状态不要重复输出。</requirement>
</event_rules>

<output_format>
  请严格按以下格式输出：

  <chapter_summary>
  ...本章的人类可读摘要...
  </chapter_summary>

  <story_events>
  [
    { "id": "evt-1", "type": "character-location", "characterId": "c-1", "locationId": "l-1", "chapterIndex": 1, "source": "chapter" }
  ]
  </story_events>
</output_format>

<warnings>
  <warning>你必须严格从上方提供的章节内容中提取事实，禁止编造、推测或引入内容中未出现的角色和事件。</warning>
  <warning>如果某个角色或物品在本章中没有明确变化，则不要为其创建事件。</warning>
  <warning>摘要必须客观，使用第三人称，不得泄露后续章节或大纲中的未来情节。</warning>
</warnings>`

export interface SummaryPromptSections {
  claimedBeatsSection: string
  whitelistSection: string
}

export interface SummaryPromptVariables {
  chapterTitle: string
  displayChapterNumber: string
  chapterContent: string
}

export function buildSummaryUserPrompt(
  sections: SummaryPromptSections,
  vars: SummaryPromptVariables
): string {
  return renderTemplate(SUMMARY_USER_PROMPT_TEMPLATE, {
    ...sections,
    ...vars,
  })
}

export { buildCharacterWhitelistSection }
