import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { ChapterOutline, ActArc, StoryArc } from '../types/outline.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { toDisplayChapterNumber } from '../utils/chapter-display.js'
import { isClosingPhase } from '../utils/story-arc.js'
import { getChapterPlanningConfig } from '../utils/chapter-planning.js'

export interface ChapterOutlineResult extends ChapterOutline {
  conflict?: boolean
  conflictReason?: string
}

export class ChapterOutlineAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.4)
  }

  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const chapterIndex = state.chapterIndex ?? 0
    const displayChapterNumber = toDisplayChapterNumber(chapterIndex)
    const storyArc = state.storyArc
    const act = this.getCurrentAct(storyArc, chapterIndex)
    const nextAct = this.getNextAct(storyArc, chapterIndex)
    const actProgress = state.actProgress ?? {}
    const actProgressForAct = act ? actProgress[act.index] : undefined

    const actSection = act
      ? `<current_act>
幕标题：${act.title}
主题：${act.theme}
叙事功能：${act.function}
章节范围：第${act.startChapter}章 – 第${act.endChapter}章
当前章号：第${displayChapterNumber}章
本章在该幕中的位置：第 ${chapterIndex + 1 - act.startChapter + 1} / ${act.endChapter - act.startChapter + 1} 章
尚未消费的 mandatory beats：${(actProgressForAct?.pending ?? act.mandatoryBeats).join('、') || '（无）'}
已消费的 mandatory beats：${(actProgressForAct?.consumed ?? []).join('、') || '（无）'}
</current_act>`
      : '<current_act>（暂无幕信息）</current_act>'

    const nextActSection = nextAct
      ? `<next_act_boundary>
下一幕标题：${nextAct.title}
下一幕主题：${nextAct.theme}
下一幕叙事功能：${nextAct.function}
下一幕从第${nextAct.startChapter}章开始。
【强制要求】本章不得提前执行下一幕的叙事功能，只能在本幕范围内推进，并为下一幕保留合理过渡空间。
</next_act_boundary>`
      : '<next_act_boundary>（已无后续幕）</next_act_boundary>'

    const planningConfig = getChapterPlanningConfig(state.genre)
    const closingPhaseSection = isClosingPhase(state.totalChapters, chapterIndex, planningConfig.closingPhaseRatio)
      ? `<closing_phase>
【全书收尾阶段】本书仅剩 ${state.totalChapters - chapterIndex} 章结束。
- 禁止引入新的主要支线、新角色或新的未解悬念。
- 必须优先推进仍未消费的 mandatory beats 和 key beats。
- 必须向最终高潮/结局推进，不得扩展无关过渡场景。
</closing_phase>`
      : ''

    const userContent = `<task>请为第 ${displayChapterNumber} 章生成具体的章节大纲。</task>

<context>
${actSection}

${nextActSection}

${closingPhaseSection}

<story_arc>
总章节数：${state.totalChapters}
全局关键情节点池：${storyArc?.keyBeats.map(k => `${k.beat}（截止第${k.deadlineAct}幕）`).join('、') || '（无）'}
</story_arc>

${state.world ? `<world>\n${state.world}\n</world>` : ''}

${state.characters ? `<characters>\n${state.characters}\n</characters>` : ''}

${state.previousChapters ? `<previous_summary>\n${state.previousChapters}\n</previous_summary>` : ''}

${state.storyState ? `<story_state>\n${state.storyState}\n</story_state>` : ''}

${state.canonicalFacts && state.canonicalFacts.length > 0 ? `<canonical_facts>\n${JSON.stringify(state.canonicalFacts, null, 2)}\n</canonical_facts>` : ''}

${state.verifiedConstraints && state.verifiedConstraints.length > 0 ? `<verified_constraints>\n${state.verifiedConstraints.join('\n')}\n</verified_constraints>` : ''}
</context>

<instruction>
1. 生成本章标题和 1–2 句描述（30–60 字）。
2. 标题和描述必须与当前幕的叙事功能和主题一致。
3. 必须尊重 <story_state> 和 <canonical_facts> 中的权威事实，不得与之矛盾。
4. 优先推进当前幕尚未消费的 mandatory beats；如果本章不适合推进任何 beat，请说明原因。
5. 不得提前执行下一幕的叙事功能，不得提前完成后续幕的 mandatory beats。
6. 如果当前幕进度偏慢（剩余章节少、pending beats 多），请在本章安排推进至少一个 pending beat。
7. 如果推进某个 mandatory beat 会与权威事实冲突，请返回 conflict: true 并说明原因，不要强行写入。
8. 输出 JSON 格式：
   {
     "title": "章节标题",
     "description": "本章具体执行描述",
     "introducedCharacters": ["新角色名"],
     "claimedBeats": ["本幕 mandatory beat 1"],
     "conflict": false,
     "conflictReason": ""
   }
</instruction>`

    return [
      this.systemMessage('你是一位严谨的小说章节策划。你的任务是在每章动笔前，根据当前幕结构、权威事实和叙事进度，即时生成该章的具体大纲。你绝不提前执行后续幕的内容，也绝不与已确立的权威事实冲突。'),
      this.userMessage(userContent),
    ]
  }

  private getCurrentAct(storyArc: StoryArc | undefined, chapterIndex: number): ActArc | undefined {
    if (!storyArc) return undefined
    const chapterNumber = chapterIndex + 1
    return storyArc.acts.find(a => chapterNumber >= a.startChapter && chapterNumber <= a.endChapter)
  }

  private getNextAct(storyArc: StoryArc | undefined, chapterIndex: number): ActArc | undefined {
    if (!storyArc) return undefined
    const chapterNumber = chapterIndex + 1
    return storyArc.acts.find(a => a.startChapter > chapterNumber)
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const baseError = (message: string, error?: unknown): AgentOutput => ({
      success: false,
      content,
      error: error instanceof Error ? `${message}: ${error.message}` : message,
    })

    const parsed = parseJsonFromLLM<ChapterOutlineResult>(trimmed)
    if (!parsed.success) {
      return baseError('无法解析章节大纲：JSON 格式错误')
    }

    const data = parsed.data
    if (!data || typeof data.title !== 'string' || typeof data.description !== 'string') {
      return baseError('章节大纲格式错误：缺少 title 或 description')
    }

    return {
      success: true,
      data: {
        title: data.title.trim(),
        description: data.description.trim(),
        introducedCharacters: Array.isArray(data.introducedCharacters)
          ? data.introducedCharacters.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
          : undefined,
        claimedBeats: Array.isArray(data.claimedBeats)
          ? data.claimedBeats.filter((beat): beat is string => typeof beat === 'string' && beat.trim().length > 0)
          : undefined,
        conflict: data.conflict === true,
        conflictReason: data.conflictReason ?? '',
      },
    }
  }
}
