import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import { getChapterPlanningConfig } from '../utils/chapter-planning.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { normalizeIssues } from '../utils/agent-output.js'

export class OutlineComplianceAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }

  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const outlineItem = state.outline || ''
    const planningConfig = getChapterPlanningConfig(state.genre)

    const userContent = this.fillTemplate(`<instruction>
  请检查以下章节是否严格遵循了大纲要求。
  你是一位故事结构审核员。你的职责是确保章节**核心事件**与大纲一致，同时允许作者在概括性描述上进行合理的细节演绎。不要对大纲中的概括性措辞（如"四人"、"暗藏杀机"、"埋下伏笔"）做过度字面化解读。
</instruction>

<context>
  <story_title>${state.title || '（未命名）'}</story_title>
  <characters>
    ${state.characters || '（暂无人物设定）'}
  </characters>
  <outline>
    ${outlineItem}
  </outline>
  <chapter_content>
    ${state.chapterContent || '（无内容）'}
  </chapter_content>
</context>

<checklist>
  <check_item id="1" name="核心事件检查">
    <step>识别大纲中的核心事件（用句号、分号分隔）</step>
    <step>检查每个核心事件是否在正文中有对应体现</step>
    <step>允许作者在概括性描述基础上补充细节，只要不与核心事件冲突</step>
  </check_item>

  <check_item id="2" name="时间线检查">
    <step>大纲中明确的时间要求（如"三日后""次日""凌晨"）是否在正文中精确体现</step>
    <step>正文的时间跨度是否与大纲一致</step>
    <step>事件顺序是否与大纲一致</step>
  </check_item>

  <check_item id="3" name="关键台词检查">
    <step>大纲中提到的具体台词是否在正文中原样出现</step>
    <step>台词的说话人是否正确</step>
  </check_item>

  <check_item id="4" name="情节偏离检查">
    <step>是否有与大纲核心事件相矛盾的额外情节？</step>
    <step>额外情节是否严重冲淡核心事件的叙事重心？</step>
    <step>是否遗漏了大纲要求的核心事件？</step>
    <step>本章允许存在为解决前章 deadline 而设置的简短桥接/过渡场景，只要它们：① 不占据超过本章 {MAX_BRIDGE_SCENE_RATIO_PERCENT}% 篇幅；② 服务于核心事件的引入或后果承接；③ 不把后续章节的核心结果提前完成。此类桥接不应判为 outline_deviation。只有当桥接场景独立成章、篇幅过大或提前完成后续章节核心结果时，才判为偏离。</step>
  </check_item>

  <check_item id="5" name="人物行为检查">
    <step>人物出场顺序是否与大纲一致</step>
    <step>人物行为是否符合大纲描述</step>
    <step>是否有大纲未提及的人物占据核心事件的主导地位？</step>
  </check_item>

  <check_item id="6" name="逻辑连贯性">
    <step>章节内部时间线是否连贯</step>
    <step>因果关系是否合理</step>
    <step>是否有前后矛盾</step>
  </check_item>
</checklist>

<output_format>
  如果章节整体合规，请返回 {"is_compliant": true, "event_checks": [...], "deviations": [], "summary": "..."}。
  如果存在与核心事件相矛盾的偏离，才返回 {"is_compliant": false, ...}。
  {
    "is_compliant": true或false,
    "event_checks": [
      {
        "event": "大纲中的具体情节点",
        "found": true或false,
        "location": "在正文中的位置"
      }
    ],
    "deviations": [
      {
        "type": "missing_event|extra_event|timeline_mismatch|dialogue_mismatch|title_mismatch|logic_issue|character_order",
        "severity": "error|warning|info",
        "is_bridge": true或false,
        "description": "偏离描述",
        "suggestion": "改进建议"
      }
    ],
    "summary": "总体评估"
  }
</output_format>`, {
      MAX_BRIDGE_SCENE_RATIO_PERCENT: Math.round(planningConfig.maxBridgeSceneRatio * 100),
    })

    return [
      this.systemMessage(`你是一位极其严格的故事结构审核员，负责确保每个章节都严格遵循既定的大纲。你对偏离大纲的行为保持零容忍态度。你必须逐条检查大纲中的每个情节点，绝不能遗漏任何要求。

特别注意：本章只能包含当前大纲要求的事件。你必须对照下一章大纲，判断本章是否把下一章才应出现的核心结果（如对方的明确回应、条件交换、真相揭示、事件收束等）提前完成。如果本章提前落地了下一章的核心结果，必须判为 outline_violation。`),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    return parseJsonFromLLM(content)
  }

  processOutput(output: AgentOutput): { issues: Issue[]; isCompliant: boolean } {
    if (!output.success || !output.data) {
      return { issues: [], isCompliant: true }
    }

    const data = output.data as {
      is_compliant?: boolean
      event_checks?: Array<{
        event?: string
        found?: boolean
        location?: string
      }>
      deviations?: Array<{
        type?: string
        severity?: string
        is_bridge?: boolean
        description?: string
        suggestion?: string
      }>
      summary?: string
    }

    if (data.is_compliant === true) {
      return { issues: [], isCompliant: true }
    }

    const issues: Issue[] = []

    if (data.event_checks) {
      const missingEvents = data.event_checks.filter(e => !e.found)
      for (const event of missingEvents) {
        issues.push({
          id: generateId(),
          type: 'outline_violation',
          severity: 'error',
          description: `[大纲偏离] 缺少大纲要求的情节点：${event.event || '未知事件'}`,
        })
      }
    }

    const deviationIssues = normalizeIssues(data.deviations, 'outline_deviation', {
      mapType: dev => dev.type === 'missing_event' ? 'outline_violation' : 'outline_deviation',
      filter: () => true,
    }).map(issue => {
      // Trust the agent's judgment: bridge-like or extra-event deviations should not be escalated above warning
      // unless the model explicitly marked them as error for a non-bridge reason.
      const dev = data.deviations?.find(d => d.description && issue.description.includes(d.description)) ?? {}
      const isBridgeLike = (dev as { is_bridge?: boolean; type?: string }).is_bridge === true || (dev as { type?: string }).type === 'extra_event'
      if (isBridgeLike && issue.severity === 'error') {
        return { ...issue, severity: 'warning' as const }
      }
      return issue
    })

    issues.push(...deviationIssues)

    return {
      issues,
      isCompliant: data.is_compliant ?? true,
    }
  }
}
