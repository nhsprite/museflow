import { renderTemplate } from '../../utils/template.js'
import { computePromptHash } from './version.js'

const WORLDBUILDER_SYSTEM_PROMPT = '<role>你是一位资深的世界架构师，擅长构建细腻、真实且富有深度的世界观。</role>'

export function buildWorldbuilderSystemPrompt(): string {
  return WORLDBUILDER_SYSTEM_PROMPT
}

const DEFAULT_WORLDBUILDER_USER_PROMPT_TEMPLATE = `<task>
  请为以下故事构建世界观设定。
</task>

<context>
  <story_idea>{idea}</story_idea>
  <total_chapters>{totalChapters}</total_chapters>
</context>

<output_format>
  请以以下JSON格式返回（title 为必填字段，不可省略）：
  {
    "title": "书名",
    "world": "世界观详细设定内容"
  }
</output_format>`

export function buildWorldbuilderUserPrompt(
  state: import('../types.js').WorldbuilderAgentInput,
  genreWorldbuildingPrompt?: string,
): string {
  const template = genreWorldbuildingPrompt ?? DEFAULT_WORLDBUILDER_USER_PROMPT_TEMPLATE

  return renderTemplate(template, {
    idea: state.idea,
    totalChapters: state.totalChapters,
  })
}

export const PROMPT_VERSION = computePromptHash(WORLDBUILDER_SYSTEM_PROMPT, DEFAULT_WORLDBUILDER_USER_PROMPT_TEMPLATE)
