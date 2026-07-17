import { renderTemplate } from '../../utils/template.js'

const CHARACTER_SYSTEM_PROMPT =
  '<role>你是一位擅长人物塑造的作家，擅长创造立体、真实、有记忆点的人物角色。</role>\n<requirement>请严格按照要求的 JSON 数组格式输出，不要添加任何额外的解释文字。</requirement>'

const CHARACTER_USER_PROMPT_TEMPLATE = `<task>
  根据以下故事设定，创建主要人物角色。
</task>

<context>
  {TITLE_SECTION}
  <story_idea>{STORY_IDEA}</story_idea>
  {WORLD_DIRECTION_SECTION}
  {WORLD_SETTING_SECTION}
</context>

<requirements>
  <requirement>为故事创建 {MAIN_CHARACTER_COUNT_MIN}-{MAIN_CHARACTER_COUNT_MAX} 个主要人物</requirement>
  <requirement>每个角色对象必须使用以下英文键：name、description、dialogueStyle、aliases、isProtagonist</requirement>
  <requirement>description 应涵盖角色定位、性格特点、背景故事、目标或动机以及与其他角色的关系</requirement>
  <requirement>aliases 必须是字符串数组；没有别名时输出空数组，不得根据姓名自行缩写</requirement>
  <requirement>isProtagonist 必须是布尔值，完整数组中至少有一个角色为 true</requirement>
  <requirement>请直接输出 JSON 数组，不要使用外层对象包装</requirement>
</requirements>
{FORMAT_REMINDER}`

export function buildCharacterSystemPrompt(): string {
  return CHARACTER_SYSTEM_PROMPT
}

export function buildCharacterUserPrompt(
  state: import('../types.js').CharacterAgentInput,
  mainCharacterCountMin: number,
  mainCharacterCountMax: number,
  worldDirSection: string,
  formatReminder?: string
): string {
  const titleSection = state.title ? `<title>${state.title}</title>` : ''
  const worldDirectionSection = worldDirSection
    ? `<world_direction>\n${worldDirSection}\n</world_direction>`
    : ''
  const worldSettingSection = state.world ? `<world_setting>\n${state.world}\n</world_setting>` : ''

  return renderTemplate(CHARACTER_USER_PROMPT_TEMPLATE, {
    TITLE_SECTION: titleSection,
    STORY_IDEA: state.idea,
    WORLD_DIRECTION_SECTION: worldDirectionSection,
    WORLD_SETTING_SECTION: worldSettingSection,
    MAIN_CHARACTER_COUNT_MIN: mainCharacterCountMin,
    MAIN_CHARACTER_COUNT_MAX: mainCharacterCountMax,
    FORMAT_REMINDER: formatReminder ?? '',
  })
}
