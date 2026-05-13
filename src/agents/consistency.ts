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

    const userContent = `请检测以下章节内容的逻辑一致性问题。

【检测范围 - 重要】
你需要检测两类问题：
1. 当前章节内部的逻辑矛盾（时间、空间、因果）
2. **当前章节与前面章节之间的逻辑矛盾**（角色知识、对话内容、事件描述、信息传递）

对于跨章节矛盾：如果当前章节的写法与前面章节已经确立的事实冲突，即使"问题看起来根源于前面章节"，也必须报告。这类跨章节角色知识矛盾是严重的叙事漏洞，必须被发现。

【世界观设定】
${state.world || '（暂无世界观设定）'}

【人物设定】
${state.characters || '（暂无人物设定）'}

【大纲】
${state.outline || '（暂无大纲）'}

【前面章节已确立的关键事实】
${state.timelineSnapshot || '（暂无历史记录）'}

【前几章摘要】
${buildLayeredSummaries(state.chapterSummaries ?? [], state.chapterIndex ?? 0)}

【故事当前状态】
${state.storyState || '（暂无状态记录）'}

【已埋伏笔状态】
${activeForeshadows.length > 0
    ? `当前共有 ${activeForeshadows.length} 个未回收伏笔：\n${activeForeshadows.map((f, i) => `${i + 1}. "${f.text}"（埋于第${f.createdAtChapter ?? '?'}章，预期第${f.expectedFulfillChapter}章回收）`).join('\n')}`
    : '（暂无未回收伏笔）'}
${mustFulfillForeshadows.length > 0 ? `\n【🚨 必须在本章回收】以下伏笔已到达预期回收章节，必须在本章回收：\n${mustFulfillForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，当前第${chapterIndex}章）`).join('\n')}` : ''}
${overdueForeshadows.length > 0 ? `\n【⚠️ 已逾期伏笔】以下伏笔已超过预期回收章节：\n${overdueForeshadows.map((f, i) => `  ${i + 1}. "${f.text}"（预期第${f.expectedFulfillChapter}章，当前第${chapterIndex}章，已逾期${chapterIndex - f.expectedFulfillChapter}章）`).join('\n')}` : ''}

【待检测章节】
${state.chapterContent || '（无内容）'}

 一致性检测维度：
 1. **时间逻辑**：事件时间顺序是否合理，是否存在"同一天写了三天后的事"等矛盾
 2. **空间逻辑**：人物移动、位置变化是否连贯
 3. **因果逻辑**：事件因果关系是否合理
 4. **角色知识一致性（重点）**：角色对某信息的了解/态度是否与前章矛盾
   - 检查每个角色在前章中已知/承认/说过的事实
   - 对比该角色在本章中对这些事实的态度/反应
   - 标记"前一章亲口承认X，本章却表现得像第一次听说X"这类严重矛盾
   - 注意：如果角色故意装作不知道，必须有合理的动机铺垫（如欺骗、试探），否则视为矛盾
 5. **对话一致性（重点）**：角色说过的话是否前后矛盾
   - 前一章角色亲口说的内容，本章不能自相矛盾
   - 例如：前一章说"信是我转交的"，本章不能说"什么信？"
 6. **信息一致**：关键信息（物品、消息、秘密）的传递和知悉情况是否前后一致
 7. **伏笔回收与保护（重点）**：
   - **必须回收的伏笔**：检查上述"必须在本章回收"和"已逾期"的伏笔是否在本章得到回收。如果未回收，报 error
   - **伏笔提前剧透**：检查本章是否提前泄露了尚未到期的伏笔内容（如第5章埋伏笔"神秘人身份"，第8章就揭示了，但预期第15章才回收）
   - **伏笔回收一致性**：如果本章回收了某个伏笔，检查回收内容是否与埋下时的暗示方向一致（如伏笔暗示是"盟友"，回收却说是"路人"，则矛盾）
   - **正常伏笔**：检查"正常伏笔"是否被不当地提前揭示
  8. **节奏一致**：本章节奏是否与整体故事节奏一致
  9. **结构化状态一致性（重点）**：对照"故事当前状态"检查以下方面：
    - **角色位置一致性**：角色当前位置是否与"故事当前状态"中的记录一致。如果位置变化，必须有合理的移动过程
    - **角色状态一致性**：角色的身体状态、情绪状态是否与记录一致。如果状态变化（如从受伤恢复健康），必须有明确的恢复描写
    - **物品位置一致性**：关键物品的当前位置/持有者是否与记录一致。物品转移时必须有明确的交接过程
    - **情节推进一致性**：本章的情节发展是否遵循"进行中的情节"列表，不应无故中断或偏离
    - **秘密揭示一致性**：本章新揭示的秘密是否已经被记录在"已揭示的秘密"中，或是否属于合理的新揭示
    - **时间推进一致性**：故事时间是否合理推进，不能倒退或与"故事当前状态"中的时间标记矛盾
 
 【关于"当前章节补充说明"的重要判定规则】
 当前章节可以通过以下方式补充前面章节缺失的铺垫，这些情况**不应**视为剧情断裂：
 - **回忆/倒叙**：本章开头用回忆补充说明"昨夜发生了X事件"
 - **角色对话揭示**：本章中角色说"三日前我已安排人手..."
 - **旁白补充**：作者在本章用旁白交代"原来在读者不知道的时候，X已经发生了"
 - **秘密行动揭示**：本章揭示前面章节未写的秘密行动（如营救、潜入、调查）
 
 **判定标准**：
 - 如果本章**明确给出了解释**（无论这个解释是通过回忆、对话还是旁白），说明角色状态变化的原因 → **不要报 error**
 - 如果本章**完全没有解释**，角色状态突然改变且没有任何说明 → **报 error**
 
 【分级标准 - 严格按此执行】
 - **error**：以下严重逻辑矛盾：
   - 跨章节的角色知识/对话矛盾（如角色态度突变无解释、亲口说过的话前后矛盾）
   - 时间线严重矛盾（如先写"三天后"后面又写"同一天"）
   - 关键信息前后矛盾（如先写"纸条已被取走"后面又写"发现纸条"）
   - 因果关系完全断裂（如**本章内也毫无铺垫地**发生关键事件）
   - **必须回收的伏笔未回收**（已逾期或已到期的伏笔在本章未得到呼应/揭示）
   - **伏笔被提前剧透**（未到期的伏笔内容被提前泄露，破坏悬念）
    - **伏笔回收方向矛盾**（回收内容与埋下时的暗示严重不符）
    - **结构化状态矛盾**（角色位置/状态/物品位置与"故事当前状态"记录严重不符且无合理解释）
 - **warning**：一般性不一致：
   - 细节描述有轻微出入（如某个物品的描述前后略有不同但不影响理解）
   - 时间标记不够明确（如"不知过了多久"但没有明确的时间跳跃）
   - 表述歧义（如某个描述可以有多种理解但不构成矛盾）
   - 前面章节缺少铺垫，但本章已补充说明（建议性意见：前面章节可增加铺垫）
   - 伏笔回收方式可以更好（但方向正确）
 - **info**：建议性意见：
   - 可以加强因果关联
   - 可以补充过渡段落
   - 可以改进伏笔回收的冲击力

【重要】请严格控制 error 数量，只有真正让读者困惑的逻辑矛盾才报 error。一般性不一致报 warning，建议性意见报 info。

请输出 JSON 格式的检测结果：
{
  "is_consistent": true或false,
  "issues": [
    {
      "type": "consistency",
      "severity": "error|warning|info",
      "description": "问题描述（请明确指出涉及哪些章节的哪些内容）",
      "aspect": "time|space|causality|character_knowledge|dialogue|information|foreshadowing|pace",
      "location": "具体位置",
      "suggestion": "具体的修复建议（如：将'什么信？'改为'那封信我转交时血迹已经干了'）"
    }
  ]
}

如果没有任何逻辑问题，请返回 {"is_consistent": true, "issues": []}。`

    return [
      this.systemMessage('你是一位逻辑严谨的编辑，擅长发现故事中的逻辑漏洞，尤其擅长发现跨章节的角色知识和对话矛盾。你的评审标准是：只有真正让读者困惑的逻辑矛盾才报 error，一般性不一致报 warning，建议性意见报 info。请严格控制 error 数量。'),
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

    return (data.issues || []).map(issue => {
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
