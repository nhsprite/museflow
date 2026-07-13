import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { ConsistencyAgentInput } from './types.js'
import type { Issue } from '../types/agent.js'
import type { CanonicalFact } from '../types/story-state.js'
import { buildCharacterWhitelistSection } from './prompts/fragments/index.js'
import {
  buildConsistencySystemPrompt,
  buildConsistencyUserPrompt,
} from './prompts/consistency-prompt.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { normalizeIssues } from '../utils/agent-output.js'
import { classifyForeshadows } from '../story-memory/foreshadow-policy.js'

export class ConsistencyAgent extends BaseAgent<ConsistencyAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.3)
  }
  protected buildPrompt(state: ConsistencyAgentInput): import('../model/provider.js').Message[] {
    const zeroBasedChapterIndex = state.chapterIndex ?? 0
    const chapterIndex = zeroBasedChapterIndex + 1
    const existingForeshadows = state.foreshadowStack || []
    const activeForeshadows = existingForeshadows.filter((f) => !f.fulfilledChapter)
    const { overdueRequired: overdueForeshadows, dueRequired: mustFulfillForeshadows } =
      classifyForeshadows(activeForeshadows, chapterIndex)

    const characterWhitelistSection = buildCharacterWhitelistSection({
      charactersList: state.charactersList,
      outlineCharacters: state.outlineCharacters,
      establishedCharacters: state.establishedCharacters,
    })

    const outlineAuthorizedFacts = (state.canonicalFacts ?? []).filter(
      (f) => f.establishedIn === zeroBasedChapterIndex && f.source === 'outline_inference'
    )
    const outlineAuthorizedFactsSection =
      outlineAuthorizedFacts.length > 0
        ? `<outline_authorized_facts>
<note>【大纲推断事实（仅供参考，正文优先）】以下事实由本章大纲文本推断而来，未经验证，仅供写作参考。本章内容中出现这些事实不属于"擅自发明"或"状态污染"，不得据此报 consistency error；如果本章正文与这些事实不一致，以正文为准，最多报 warning，不得报 error：</note>
${outlineAuthorizedFacts.map((f) => `  - [${f.subject}] ${f.attribute}: ${f.value}`).join('\n')}
</outline_authorized_facts>`
        : ''

    const foreshadowsSection = `<foreshadows>
  <active>
    ${
      activeForeshadows.length > 0
        ? activeForeshadows
            .map(
              (f, i) =>
                `  <item index="${i + 1}" created_at="${f.createdAtChapter ?? '?'}" expected="${f.expectedFulfillChapter}">${f.text}</item>`
            )
            .join('\n')
        : '（暂无未回收伏笔）'
    }
  </active>
  ${
    mustFulfillForeshadows.length > 0
      ? `
  <must_fulfill>
    ${mustFulfillForeshadows.map((f, i) => `  <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${chapterIndex}">${f.text}</item>`).join('\n')}
  </must_fulfill>`
      : ''
  }
  ${
    overdueForeshadows.length > 0
      ? `
  <overdue>
    <note>以下伏笔已超过预期回收章节，仅供优先回收参考；逾期本身不是错误，不得仅因伏笔逾期未回收而报 error。</note>
    ${overdueForeshadows.map((f, i) => `  <item index="${i + 1}" expected="${f.expectedFulfillChapter}" current="${chapterIndex}" overdue="${chapterIndex - f.expectedFulfillChapter}">${f.text}</item>`).join('\n')}
  </overdue>`
      : ''
  }
</foreshadows>`

    const chapterContractSection = state.chapterContract
      ? `<chapter_contract>
<mandatory>【章节契约 - 本章一致性检查硬约束】</mandatory>
${state.chapterContract}
</chapter_contract>`
      : ''

    const userContent = buildConsistencyUserPrompt(
      {
        characterWhitelistSection,
        outlineAuthorizedFactsSection,
        foreshadowsSection,
        chapterContractSection,
      },
      {
        chapterIndex,
        worldSetting: state.world || '（暂无世界观设定）',
        characterSetting: state.characters || '（暂无人物设定）',
        outline: state.outline || '（暂无大纲）',
        storyState: state.storyState || '（暂无状态记录）',
        chapterTimeAnchor:
          state.chapterPlan?.chapterTimeAnchor ||
          state.chapterTimeAnchor ||
          '（未指定，默认以本章自身时间线为准）',
        previousSummary: state.previousChapters || '（这是第一章）',
        contentToCheck: state.chapterContent || '（无内容）',
      }
    )

    return [this.systemMessage(buildConsistencySystemPrompt()), this.userMessage(userContent)]
  }

  protected parse(content: string): AgentOutput {
    return parseJsonFromLLM(content)
  }

  async processOutput(output: AgentOutput, canonicalFacts?: CanonicalFact[]): Promise<Issue[]> {
    if (!output.success || !output.data) return []
    const data = output.data as {
      is_consistent?: boolean
      issues?: Array<{
        type?: string
        severity?: string
        description?: string
        aspect?: string
        location?: string
        locationRef?: unknown
        location_ref?: unknown
        paragraphIndex?: unknown
        sentenceIndex?: unknown
        paragraphNumber?: unknown
        sentenceNumber?: unknown
        subject?: string
        source_reference?: string
        reader_confusion?: string
        suggestion?: string
      }>
    }

    if (data.is_consistent === true) {
      return []
    }

    void canonicalFacts
    const issues = await normalizeIssues(data.issues, 'consistency', this.provider, {
      mapType: (issue) => {
        if (issue.aspect === 'outline') {
          return issue.type === 'missing_event' ? 'outline_violation' : 'outline_deviation'
        }
        return 'consistency'
      },
    })

    // 强制实施 prompt 约定：
    // 1. severity=error 的 consistency issue 必须携带 subject；未携带 subject 的 error 降级为 warning。
    // 2. aspect='outline' 的 error 必须同时携带 subject 和 source_reference，否则视为执行细节差异，降级为 warning 并改 dimension='quality'。
    //    这样可以避免 LLM 把“旋出”vs“提出”等操作细节差异误判为 structural full rewrite 触发器。
    return issues.map((issue) => {
      if (issue.severity === 'error' && !issue.subject) {
        return { ...issue, severity: 'warning' as const }
      }
      if (
        issue.severity === 'error' &&
        issue.dimension === 'outline' &&
        (!issue.sourceReference || issue.sourceReference.trim().length === 0)
      ) {
        return {
          ...issue,
          severity: 'warning' as const,
          dimension: 'quality',
        }
      }
      return issue
    })
  }
}
