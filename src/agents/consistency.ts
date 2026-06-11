import { BaseAgent, type AgentState, type AgentOutput } from './base.js'
import type { Issue } from '../types/agent.js'
import { generateId } from '../utils/id.js'
import { buildLayeredSummaries } from '../utils/summary-compressor.js'

export class ConsistencyAgent extends BaseAgent {
  constructor() {
    super(undefined, 0.3)
  }
  protected buildPrompt(state: AgentState): import('../model/provider.js').Message[] {
    const chapterIndex = (state.chapterIndex ?? 0) + 1
    const existingForeshadows = state.foreshadowStack || []
    const activeForeshadows = existingForeshadows.filter(f => !f.fulfilledChapter)
    const overdueForeshadows = activeForeshadows.filter(
      f => chapterIndex > f.expectedFulfillChapter + 1
    )
    const mustFulfillForeshadows = activeForeshadows.filter(
      f => !f.fulfilledChapter && chapterIndex >= f.expectedFulfillChapter && chapterIndex <= f.expectedFulfillChapter + 1
    )

    const userContent = `<instruction>
  你是一位逻辑严谨的编辑，擅长发现故事中的逻辑漏洞，尤其擅长发现跨章节的角色知识和对话矛盾。
  请严格遵循以下标准：只有真正让读者困惑的逻辑矛盾才报 error，一般性不一致报 warning，建议性意见报 info。请严格控制 error 数量。
</instruction>

<scope>
  你需要检测两类问题：
  <internal>当前章节内部的逻辑矛盾（时间、空间、因果）</internal>
  <cross_chapter>当前章节与前面章节之间的逻辑矛盾（角色知识、对话内容、事件描述、信息传递）</cross_chapter>
  <note>对于跨章节矛盾：如果当前章节的写法与前面章节已经确立的事实冲突，即使"问题看起来根源于前面章节"，也必须报告。这类跨章节角色知识矛盾是严重的叙事漏洞，必须被发现。</note>
</scope>

<context>
  <world_setting>
    ${state.world || '（暂无世界观设定）'}
  </world_setting>

  <characters>
    ${state.characters || '（暂无人物设定）'}
  </characters>

  <outline>
    ${state.outline || '（暂无大纲）'}
  </outline>

  <timeline>
    ${state.timelineSnapshot || '（暂无历史记录）'}
  </timeline>

  <chapter_summaries>
    ${buildLayeredSummaries(state.chapterSummaries ?? [], state.chapterIndex ?? 0)}
  </chapter_summaries>

  <story_state>
    ${state.storyState || '（暂无状态记录）'}
  </story_state>

  <foreshadows>
    <active>
      ${activeForeshadows.length > 0
        ? activeForeshadows.map((f, i) => `  <item index="${i + 1}" created_at="${f.createdAtChapter ?? '?'}" expected="${f.expectedFulfillChapter}">${f.text}</item>`).join('\n')
        : '（暂无未回收伏笔）'}
    </active>
    ${mustFulfillForeshadows.length > 0 ? `
    <must_fulfill>
      ${mustFulfillForeshadows.map((f, i) => `  <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${chapterIndex}">${f.text}</item>`).join('\n')}
    </must_fulfill>` : ''}
    ${overdueForeshadows.length > 0 ? `
    <overdue>
      ${overdueForeshadows.map((f, i) => `  <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${chapterIndex}" overdue="${chapterIndex - f.expectedFulfillChapter}">${f.text}</item>`).join('\n')}
    </overdue>` : ''}
  </foreshadows>
</context>

<content_to_check>
  ${state.chapterContent || '（无内容）'}
</content_to_check>

<check_dimensions>
  <dimension name="time" priority="high">事件时间顺序是否合理，是否存在时间跳跃未标注、同一时间点发生矛盾事件等问题</dimension>
  <dimension name="space" priority="high">人物移动、位置变化是否连贯</dimension>
  <dimension name="causality" priority="high">事件因果关系是否合理</dimension>
  <dimension name="character_knowledge" priority="critical">角色对某信息的了解/态度是否与前章矛盾。检查每个角色在前章中已知/承认/说过的事实，对比该角色在本章中对这些事实的态度/反应。标记"角色在前章已知某事实，本章却表现得像第一次听说"这类严重矛盾。注意：如果角色故意装作不知道，必须有合理的动机铺垫（如欺骗、试探），否则视为矛盾</dimension>
  <dimension name="timeline_anchor" priority="critical">
    角色在叙述、回忆、内心独白中提及的事件，必须是该角色已经经历过的、或明确被告知的、或在超现实场景（如预言、梦境、幻象）中看到的。
    严禁角色将尚未发生的事件描述为已发生的回忆。
    如果角色提及未来事件，必须使用前瞻性的措辞，且必须是在明确的超现实场景中。
    特别注意：涉及非线性叙事（如闪回、预言、多重时间线）时，必须严格区分"已发生的回忆"和"未发生的预示"。
  </dimension>
  <dimension name="dialogue" priority="critical">角色说过的话是否前后矛盾。前一章角色亲口说的内容，本章不能自相矛盾</dimension>
  <dimension name="information" priority="high">关键信息（物品、消息、秘密）的传递和知悉情况是否前后一致</dimension>
  <dimension name="foreshadowing" priority="critical">
    必须回收的伏笔：检查上述"必须在本章回收"和"已逾期"的伏笔是否在本章得到回收。如果未回收，报 error
    伏笔提前剧透：检查本章是否提前泄露了尚未到期的伏笔内容
    伏笔回收一致性：如果本章回收了某个伏笔，检查回收内容是否与埋下时的暗示方向一致
    正常伏笔：检查"正常伏笔"是否被不当地提前揭示
    重要区分 - 本章新设情节 vs 伏笔：本章首次引入的新情节、新场景、新描写是本章的正常叙事推进，不应被视为"已埋伏笔的提前泄露"或"伏笔自指"。只有当本章揭示了之前章节明确埋下的悬念时，才构成伏笔回收。
  </dimension>
  <dimension name="pace" priority="medium">本章节奏是否与整体故事节奏一致</dimension>
  <dimension name="structured_state" priority="critical">
    对照"故事当前状态"检查以下方面：
    角色位置一致性：角色当前位置是否与"故事当前状态"中的记录一致。如果位置变化，必须有合理的移动过程
    角色状态一致性：角色的身体状态、情绪状态是否与记录一致。如果状态变化，必须有明确的恢复描写
    物品位置一致性：关键物品的当前位置/持有者是否与记录一致。物品转移时必须有明确的交接过程
    情节推进一致性：本章的情节发展是否遵循"进行中的情节"列表，不应无故中断或偏离
    秘密揭示一致性：本章新揭示的秘密是否已经被记录在"已揭示的秘密"中，或是否属于合理的新揭示
    时间推进一致性：故事时间是否合理推进，不能倒退或与"故事当前状态"中的时间标记矛盾
  </dimension>
</check_dimensions>

<supplementary_rules>
  <rule type="chapter_explanation">
    当前章节可以通过以下方式补充前面章节缺失的铺垫，这些情况不应视为剧情断裂：
    - 回忆/倒叙：本章开头用回忆补充说明"昨夜发生了X事件"
    - 角色对话揭示：本章中角色说"三日前我已安排人手..."
    - 旁白补充：作者在本章用旁白交代"原来在读者不知道的时候，X已经发生了"
    - 秘密行动揭示：本章揭示前面章节未写的秘密行动（如营救、潜入、调查）
    判定标准：
    - 如果本章明确给出了解释（无论这个解释是通过回忆、对话还是旁白），说明角色状态变化的原因 → 不要报 error
    - 如果本章完全没有解释，角色状态突然改变且没有任何说明 → 报 error
  </rule>

  <rule type="outline_evolution">
    故事大纲在不同章节可能会揭示新的地点、新的线索或修正之前的认知。大纲层面的信息更新是正常的情节推进，不应视为矛盾。
    只有当角色对已确立的事实表现出矛盾态度（如角色已明确知道某信息，本章却表现得像第一次听说）时，才构成 consistency error。
    如果本章中某角色获得了新的信息（如通过占卜、感应、他人告知），并因此更新了认知，这是正常叙事推进，不要报 error。
    不要因为"本章揭示了新的地点/线索，与前面章节中的模糊描述不同"而报 error。重点检查角色是否对新信息表现出不合理的矛盾态度。
  </rule>
</supplementary_rules>

<severity_levels>
  <error>以下严重逻辑矛盾：跨章节的角色知识/对话矛盾、时间线严重矛盾、关键信息前后矛盾、因果关系完全断裂、必须回收的伏笔未回收、伏笔被提前剧透、伏笔回收方向矛盾、结构化状态矛盾</error>
  <warning>一般性不一致：细节描述有轻微出入、时间标记不够明确、表述歧义、前面章节缺少铺垫但本章已补充说明、伏笔回收方式可以更好</warning>
  <info>建议性意见：可以加强因果关联、可以补充过渡段落、可以改进伏笔回收的冲击力</info>
</severity_levels>

<output_format>
  请输出 JSON 格式的检测结果：
  {
    "is_consistent": true,
    "issues": [
      {
        "type": "consistency",
        "severity": "error|warning|info",
        "description": "问题描述（请明确指出涉及哪些章节的哪些内容）",
        "aspect": "time|space|causality|character_knowledge|dialogue|information|foreshadowing|pace",
        "location": "具体位置",
        "suggestion": "具体的修复建议（指明如何修改以消除矛盾）"
      }
    ]
  }
  如果没有任何逻辑问题，请返回 {"is_consistent": true, "issues": []}。
</output_format>`

    return [
      this.systemMessage('<role>你是一位逻辑严谨的编辑，擅长发现故事中的逻辑漏洞，尤其擅长发现跨章节的角色知识和对话矛盾。</role>\n<standard>只有真正让读者困惑的逻辑矛盾才报 error，一般性不一致报 warning，建议性意见报 info。请严格控制 error 数量。</standard>'),
      this.userMessage(userContent),
    ]
  }

  protected parse(content: string): AgentOutput {
    const trimmed = content.trim()
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return { success: false, error: '无法解析检测数据：未找到 JSON 格式' }
    }
    try {
      const data = JSON.parse(jsonMatch[0])
      return { success: true, data }
    } catch {
      return { success: false, error: '无法解析检测数据：JSON 格式错误' }
    }
  }

  processOutput(output: AgentOutput): Issue[] {
    console.log('[MuseFlow] DEBUG: ConsistencyAgent.processOutput called')
    if (!output.success || !output.data) return []
    const data = output.data as {
      is_consistent?: boolean
      issues?: Array<{
        type?: string
        severity?: string
        description?: string
        aspect?: string
        location?: string
        suggestion?: string
      }>
    }

    if (data.is_consistent === true && (!data.issues || data.issues.length === 0)) {
      return []
    }

    const rawIssues = data.issues || []
    console.log(`[MuseFlow] DEBUG: Raw consistency issues count: ${rawIssues.length}`)
    
    return rawIssues.map(issue => {
      const result: Issue = {
        id: generateId(),
        type: 'consistency',
        severity: (issue.severity as IssueSeverity) || 'warning',
        description: issue.description || '',
      }
      if (issue.location) {
        result.location = issue.location
      }
      if (issue.suggestion) {
        result.suggestion = issue.suggestion
      }
      return result
    })
  }
}

type IssueSeverity = 'error' | 'warning' | 'info'
