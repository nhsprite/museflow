import { renderTemplate } from '../../utils/template.js'
import { computePromptHash } from './version.js'

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
  <requirement>每个角色需要包含：姓名、角色定位（主角/反派/配角等）、性格特点、背景故事、在故事中的目标或动机、与其他角色的关系、对话风格</requirement>
  <requirement>请以 JSON 数组格式输出</requirement>
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

export const PROMPT_VERSION = computePromptHash(
  CHARACTER_SYSTEM_PROMPT,
  CHARACTER_USER_PROMPT_TEMPLATE
)
