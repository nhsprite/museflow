import { renderTemplate } from '../../utils/template.js'
import { computePromptHash } from './version.js'

const STORY_ARC_SYSTEM_PROMPT =
  '你是一位擅长长篇结构的小说策划。你的任务是为小说生成高层次的幕结构故事弧线，只规定每幕的叙事功能和必须完成的抽象情节点类型，绝不指定未来章节的具体内容。'

const STORY_ARC_USER_PROMPT_TEMPLATE = `请为一部 {TOTAL_CHAPTERS} 章的长篇小说生成故事弧线（Story Arc）。

<idea>
{IDEA}
</idea>

<genre>
{GENRE}
</genre>

{TITLE_SECTION}

{WORLD_DIRECTION_SECTION}

{WORLD_SETTING_SECTION}

{CHARACTERS_SECTION}

<requirements>
- 将 {TOTAL_CHAPTERS} 章划分为 3-5 幕（acts），合理分配每幕的章节范围（连续、不重叠、覆盖全部章节）。
- 每幕只描述叙事功能和主题张力，不要描述具体动作、地点、对话、物品转移、秘密内容或人物命运。
- mandatoryBeats 只列该幕必须完成的事件类型或状态转移类型，不要绑定具体人物动作或具体章节。
- keyBeats 只列全书级别的关键情节点类型，并标注必须在第几幕之前/之内完成（deadlineAct）。
- 输出 JSON 格式：
  {
    "totalChapters": {TOTAL_CHAPTERS},
    "acts": [
      {
        "index": 1,
        "startChapter": 1,
        "endChapter": 10,
        "title": "幕标题（概括性，不含具体事件）",
        "theme": "幕主题张力",
        "function": "该幕在全书中的叙事功能",
        "mandatoryBeats": ["事件类型1", "事件类型2"]
      }
    ],
    "keyBeats": [
      { "beat": "关键情节点类型", "deadlineAct": 2 }
    ]
  }
</requirements>`

export function buildStoryArcSystemPrompt(): string {
  return STORY_ARC_SYSTEM_PROMPT
}

export function buildStoryArcUserPrompt(state: import('../types.js').StoryArcAgentInput): string {
  const titleSection = state.title ? `<title>\n书名：${state.title}\n</title>` : ''
  const worldDirectionSection = state.worldDirection
    ? `<world_direction>\n核心冲突：${state.worldDirection.coreConflict}\n世界观特征：${state.worldDirection.worldFeatures?.join('、') || ''}\n</world_direction>`
    : ''
  const worldSettingSection = state.world ? `<world_setting>\n${state.world}\n</world_setting>` : ''
  const charactersSection = state.characters
    ? `<characters>\n${state.characters}\n</characters>`
    : ''

  return renderTemplate(STORY_ARC_USER_PROMPT_TEMPLATE, {
    TOTAL_CHAPTERS: state.totalChapters,
    IDEA: state.idea,
    GENRE: state.genre || 'default',
    TITLE_SECTION: titleSection,
    WORLD_DIRECTION_SECTION: worldDirectionSection,
    WORLD_SETTING_SECTION: worldSettingSection,
    CHARACTERS_SECTION: charactersSection,
  })
}

export const PROMPT_VERSION = computePromptHash(
  STORY_ARC_SYSTEM_PROMPT,
  STORY_ARC_USER_PROMPT_TEMPLATE
)
