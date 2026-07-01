export const OFFICIAL_CHARACTER_RULES = `<official_character_rules>
<mandatory>【必须】只能使用官方角色与大纲预告角色</mandatory>
- 本任务中 "官方角色" 指【人物设定】中明确列出的角色；"大纲预告角色" 指【大纲登场角色】中列出的、由大纲明确命名并将在本章或之前章节登场的新角色。
- 严禁为故事 invent 全新的角色名字、亲属称呼或身份，除非该角色已经出现在【大纲登场角色】中。
- 如果大纲要求未指定身份的动作执行者，必须从官方角色或大纲预告角色中选择；若均不适合，只能虚构一个不获取姓名、不建立亲属关系、不进入 storyState 的无名功能性角色。
- 角色之间的亲属关系必须来自人物设定或大纲，不得自行添加。
- 任何新角色如果要在正文中出现，必须先在大纲或人物设定中有依据；否则只能以无名的功能性身份出现，且不得在 storyState 中留下记录。
</official_character_rules>`

import type { Character } from '../../../types/character.js'

export interface CharacterWhitelistInput {
  charactersList?: Character[] | undefined
  outlineCharacters?: Character[] | undefined
  establishedCharacters?: Character[] | undefined
}

export function buildCharacterWhitelistSection(state: CharacterWhitelistInput): string {
  const establishedCharactersSection = state.establishedCharacters && state.establishedCharacters.length > 0
    ? `<established_characters>
<mandatory>【前文已建立角色】以下角色已在前面章节的摘要或故事状态中出现，允许在本章继续使用：</mandatory>
${state.establishedCharacters.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</established_characters>`
    : ''

  if (!state.charactersList || state.charactersList.length === 0) {
    return establishedCharactersSection
  }

  return `<official_characters>
<mandatory>【必须】以下为本故事官方角色。正文中出场的所有有名有姓、有亲属关系、有身份地位的角色必须来自此列表、【大纲登场角色】列表或【前文已建立角色】列表；任何不在这些列表中的人名不得获得 POV、台词、亲属称呼或持久身份：</mandatory>
${state.charactersList.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</official_characters>${state.outlineCharacters && state.outlineCharacters.length > 0 ? `
<outline_characters>
<mandatory>【大纲登场角色】以下角色由大纲明确命名并将在本章或之前章节登场，允许在本章出现：</mandatory>
${state.outlineCharacters.map(c => `- ${c.name}${c.description ? `：${c.description}` : ''}`).join('\n')}
</outline_characters>` : ''}${establishedCharactersSection}`
}
