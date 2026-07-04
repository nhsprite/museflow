import { renderTemplate } from '../../utils/template.js'
import { computePromptHash } from './version.js'
import {
  AI_PHRASE_PROHIBITIONS,
  FIX_OUTPUT_RULES,
  FACT_CONSISTENCY_RULES,
  buildCharacterWhitelistSection,
} from './fragments/index.js'
import type { FixAgentInput, SentenceFix, ParagraphFix } from '../types.js'
import type { Issue } from '../../types/agent.js'

export type FixPromptMode = 'sentence' | 'paragraph' | 'legacy'

const FIX_SENTENCE_SYSTEM_PROMPT =
  '你是一位极其谨慎的小说编辑。你的唯一任务是修改指定的句子。你绝对不可以修改未指定的句子，不可以添加新句子，不可以删除句子。你只能修改标记为【段落 N · 第 M 句】的内容。修改时彻底替换原句，不要残留。修改前必须对照前文摘要和角色状态，确保不引入新的跨章节矛盾。'

const FIX_PARAGRAPH_SYSTEM_PROMPT =
  '你是一位极其谨慎的小说编辑。你的唯一任务是修改指定的段落。你绝对不可以修改未指定的段落，不可以添加新段落，不可以删除段落。你只能修改标记为【需要修改的段落】的内容。修改时彻底替换原句，不要残留。修改前必须对照前文摘要和角色状态，确保不引入新的跨章节矛盾。'

const FIX_LEGACY_SYSTEM_PROMPT =
  '你是一位极其谨慎的小说编辑，擅长精准定位问题并进行最小化修改。修改前必须对照前文摘要和角色状态，确保不引入新的跨章节矛盾。'

export function buildFixSystemPrompt(mode: FixPromptMode): string {
  if (mode === 'sentence') {
    return FIX_SENTENCE_SYSTEM_PROMPT
  }
  if (mode === 'paragraph') {
    return FIX_PARAGRAPH_SYSTEM_PROMPT
  }
  return FIX_LEGACY_SYSTEM_PROMPT
}

function buildOptionalSection(
  tag: string,
  content: string | undefined | null,
  skipValue?: string
): string {
  if (!content || content.length === 0) return ''
  if (skipValue !== undefined && content === skipValue) return ''
  return `<${tag}>
${content}
</${tag}>`
}

function buildIssuesSection(issues: Issue[] | undefined): string {
  if (!issues || issues.length === 0) return ''
  return `<issues>
${issues
  .map(
    (issue, i) => `  <issue index="${i + 1}" type="${issue.type}">
    <description>${issue.description}</description>${issue.location ? `\n    <location>${issue.location}</location>` : ''}${issue.suggestion ? `\n    <suggestion>${issue.suggestion}</suggestion>` : ''}
  </issue>`
  )
  .join('\n')}
</issues>`
}

function buildCharacterWhitelistWrapper(state: FixAgentInput): string {
  const section = buildCharacterWhitelistSection({
    charactersList: state.charactersList,
    outlineCharacters: state.outlineCharacters,
    establishedCharacters: state.establishedCharacters,
  })
  return section ? `<character_whitelist>\n${section}\n</character_whitelist>` : ''
}

export interface FixPromptSections {
  issuesSection: string
  previousChaptersSection: string
  timelineSection: string
  storyStateSection: string
  boundarySection: string
  characterWhitelistSection: string
  targetSection: string
  existingChapterSection: string
}

export function buildFixPromptSections(
  state: FixAgentInput,
  targetSection: string
): FixPromptSections {
  return {
    issuesSection: buildIssuesSection(state.issues),
    previousChaptersSection: buildOptionalSection(
      'previous_chapters',
      state.previousChapters,
      '（这是第一章）'
    ),
    timelineSection: buildOptionalSection('timeline', state.timelineSnapshot, '（暂无历史记录）'),
    storyStateSection: buildOptionalSection('story_state', state.storyState, '（暂无状态记录）'),
    boundarySection: state.nextChapterBoundary
      ? `<next_chapter_boundary>\n${state.nextChapterBoundary}\n</next_chapter_boundary>`
      : '',
    characterWhitelistSection: buildCharacterWhitelistWrapper(state),
    targetSection,
    existingChapterSection: state.chapterContent
      ? `<chapter_content>\n${state.chapterContent}\n</chapter_content>`
      : '',
  }
}

export function buildSentenceTargetSection(sentences: SentenceFix[]): string {
  return sentences
    .map(
      (s) =>
        `  <sentence paragraph="${s.paragraphIndex}" index="${s.sentenceIndex + 1}">\n    <original>${s.original}</original>\n    <problem>${s.issue.description}</problem>${s.issue.suggestion ? `\n    <suggestion>${s.issue.suggestion}</suggestion>` : ''}\n  </sentence>`
    )
    .join('\n')
}

export function buildParagraphTargetSection(
  paragraphs: ParagraphFix[],
  issueIndexMap: Map<Issue, number>
): string {
  return paragraphs
    .map(
      (p) =>
        `  <paragraph index="${p.index}">${p.issues.length > 0 ? `\n    <related_issues>${p.issues.map((issue) => issueIndexMap.get(issue) ?? '?').join(', ')}</related_issues>` : ''}\n    <content>${p.content}</content>\n  </paragraph>`
    )
    .join('\n')
}

export interface FixPromptVariables {
  displayChapterNumber: string
}

const SENTENCE_USER_PROMPT_TEMPLATE = `<instruction>
  请对第 {displayChapterNumber} 章的指定句子进行精准修复。
</instruction>

{issuesSection}

{previousChaptersSection}

{timelineSection}

{storyStateSection}

{boundarySection}

{characterWhitelistSection}

<context>
  {context}
</context>

<target_sentences>
{targetSection}
</target_sentences>

<constraints>
  <constraint>你只能修改上面标记的【段落 N · 第 M 句】，同一段落的其他句子必须原样保留</constraint>
  <constraint>修改后的句子必须在意思上能独立成立，与前后句衔接自然</constraint>
  <constraint>修改时必须彻底替换原句，绝不允许原句和新句同时存在</constraint>
  <constraint>不得引入新的角色、地点、物品、时间线或因果关系；只允许使用上方角色白名单中的角色，无姓名的路人除外</constraint>
  <constraint>保持原文的语言风格、叙事节奏和人物语气</constraint>
  ${AI_PHRASE_PROHIBITIONS}
  <constraint>修改后通读段落，确保没有句子重复出现</constraint>
  <constraint priority="critical">修复时必须对照"前几章摘要"和"角色状态与时间线"，确保不引入与前文矛盾的描述。例如：如果前文已确立"某物在某地"，修复时不可改为"该物在另一处"</constraint>
  <constraint priority="critical">本章只能修复上述问题，不得借机推进到后续章节的核心事件。如果修复会越界，请宁可保留原文也不要越界。</constraint>
  <constraint>你不需要输出完整章节或完整段落，只需要输出修改后的句子</constraint>
</constraints>

<output_format>
  ${FIX_OUTPUT_RULES}
  对每个需要修改的句子，按以下格式输出：
  【段落 N · 第 M 句】
  [修改后的句子内容]
  如果某个句子不需要修改，也按格式输出原内容：
  【段落 N · 第 M 句】
  [原句内容]
  请只输出需要修改的句子，不要输出任何其他内容。
</output_format>`

const PARAGRAPH_USER_PROMPT_TEMPLATE = `<instruction>
  请对第 {displayChapterNumber} 章的指定段落进行精准修复。
</instruction>

{issuesSection}

{previousChaptersSection}

{timelineSection}

{storyStateSection}

{boundarySection}

{characterWhitelistSection}

<context>
  {context}
</context>

<target_paragraphs>
{targetSection}
</target_paragraphs>

<constraints>
  <constraint>你只能修改上面标记为【需要修改的段落】的内容</constraint>
  <constraint>每个段落的修改必须是独立的：修改段落A时不能引用或改变段落B的内容</constraint>
  <constraint>修改后的段落必须在意思上能独立成立，与上下文衔接自然</constraint>
  <constraint>修改时必须彻底替换原句，绝不允许原句和新句同时存在</constraint>
  <constraint>不得引入新的角色、地点、物品、时间线或因果关系；只允许使用上方角色白名单中的角色，无姓名的路人除外</constraint>
  <constraint>保持原文的语言风格、叙事节奏和人物语气</constraint>
  ${AI_PHRASE_PROHIBITIONS}
  ${FACT_CONSISTENCY_RULES}
  <constraint>修改后通读段落，确保没有句子重复出现</constraint>
  <constraint priority="critical">修复时必须对照"前几章摘要"、"角色状态与时间线"和"故事当前状态"，确保不引入与前文矛盾的描述。例如：如果前文已确立"某物在某地"，修复时不可改为"该物在另一处"；如果状态记录显示角色"虚弱无力"，修复时不可改为"精力充沛"</constraint>
  <constraint priority="critical">本章只能修复上述问题，不得借机推进到后续章节的核心事件。如果修复会越界，请宁可保留原文也不要越界。</constraint>
  <constraint>你不需要输出完整章节，只需要输出修改后的段落</constraint>
</constraints>

<output_format>
  ${FIX_OUTPUT_RULES}
  对每个需要修改的段落，按以下格式输出：
  【段落 N】
  [修改后的段落内容]
  如果某个段落不需要修改，也按格式输出原内容：
  【段落 N】
  [原内容]
  请只输出需要修改的段落，不要输出任何其他内容。
</output_format>`

const LEGACY_USER_PROMPT_TEMPLATE = `<instruction>
  请对第 {displayChapterNumber} 章进行针对性修复。
</instruction>

{issuesSection}

{previousChaptersSection}

{timelineSection}

{storyStateSection}

{boundarySection}

{characterWhitelistSection}

{existingChapterSection}

<constraints>
  <constraint>只修改与上述问题直接相关的段落或句子</constraint>
  <constraint>保留所有未涉及问题的原文内容，不得删减、改动或重新组织</constraint>
  <constraint>宁可少改，不要多改</constraint>
  <constraint>不得引入新的角色、地点、物品、时间线或因果关系；只允许使用上方角色白名单中的角色，无姓名的路人除外</constraint>
  <constraint>用"替换"而非"追加"：修改时必须彻底删除原句，用新句替代</constraint>
  ${AI_PHRASE_PROHIBITIONS}
  <constraint>修改后确保没有任何句子重复出现</constraint>
  <constraint priority="critical">修复时必须对照"前几章摘要"、"角色状态与时间线"和"故事当前状态"，确保不引入与前文矛盾的描述。例如：如果前文已确立"某物在某地"，修复时不可改为"该物在另一处"；如果前文角色"虚弱无力"，修复时不可改为"精力充沛"</constraint>
  <constraint priority="critical">本章只能修复上述问题，不得借机推进到后续章节的核心事件。如果修复会越界，请宁可保留原文也不要越界。</constraint>
</constraints>

<output_format>
  ${FIX_OUTPUT_RULES}
  请输出修复后的完整第 {displayChapterNumber} 章正文。

  必须严格使用以下格式：

  === FIXED_CHAPTER ===
  # 第{displayChapterNumber}章 章节标题
  （正文内容，段落之间用空行分隔）
  === END_FIXED_CHAPTER ===

  注意：
  - 正文必须从 "# 第{displayChapterNumber}章" 开始
  - 只输出小说正文本身
</output_format>`

export function buildSentenceUserPrompt(
  sections: Omit<FixPromptSections, 'existingChapterSection'> & { context: string },
  vars: FixPromptVariables
): string {
  return renderTemplate(SENTENCE_USER_PROMPT_TEMPLATE, { ...sections, ...vars })
}

export function buildParagraphUserPrompt(
  sections: Omit<FixPromptSections, 'existingChapterSection'> & { context: string },
  vars: FixPromptVariables
): string {
  return renderTemplate(PARAGRAPH_USER_PROMPT_TEMPLATE, { ...sections, ...vars })
}

export function buildLegacyUserPrompt(
  sections: FixPromptSections,
  vars: FixPromptVariables
): string {
  return renderTemplate(LEGACY_USER_PROMPT_TEMPLATE, { ...sections, ...vars })
}

export const PROMPT_VERSION = computePromptHash(
  FIX_SENTENCE_SYSTEM_PROMPT,
  FIX_PARAGRAPH_SYSTEM_PROMPT,
  FIX_LEGACY_SYSTEM_PROMPT,
  SENTENCE_USER_PROMPT_TEMPLATE,
  PARAGRAPH_USER_PROMPT_TEMPLATE,
  LEGACY_USER_PROMPT_TEMPLATE
)
