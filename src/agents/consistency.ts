import type { ModelProvider } from '../model/provider.js'
import { BaseAgent, type AgentOutput } from './base.js'
import type { ConsistencyAgentInput } from './types.js'
import type { Issue } from '../types/agent.js'
import type { CanonicalFact } from '../types/story-state.js'
import { buildCharacterWhitelistSection } from './prompts/fragments/index.js'
import { buildConsistencySystemPrompt, buildConsistencyUserPrompt } from './prompts/consistency-prompt.js'
import { parseJsonFromLLM } from '../utils/json.js'
import { normalizeIssues } from '../utils/agent-output.js'

export class ConsistencyAgent extends BaseAgent<ConsistencyAgentInput> {
  constructor(provider: ModelProvider) {
    super(provider, 0.3)
  }
  protected buildPrompt(state: ConsistencyAgentInput): import('../model/provider.js').Message[] {
    const chapterIndex = (state.chapterIndex ?? 0) + 1
    const existingForeshadows = state.foreshadowStack || []
    const activeForeshadows = existingForeshadows.filter(f => !f.fulfilledChapter)
    const overdueForeshadows = activeForeshadows.filter(
      f => chapterIndex > f.expectedFulfillChapter + 1
    )
    const mustFulfillForeshadows = activeForeshadows.filter(
      f => !f.fulfilledChapter && chapterIndex >= f.expectedFulfillChapter && chapterIndex <= f.expectedFulfillChapter + 1
    )

    const characterWhitelistSection = buildCharacterWhitelistSection({
      charactersList: state.charactersList,
      outlineCharacters: state.outlineCharacters,
      establishedCharacters: state.establishedCharacters,
    })

    const outlineAuthorizedFacts = (state.canonicalFacts ?? []).filter(
      f => f.establishedIn === chapterIndex && f.source === 'outline'
    )
    const outlineAuthorizedFactsSection = outlineAuthorizedFacts.length > 0
      ? `<outline_authorized_facts>
<mandatory>【本章大纲已授权的新事实】以下事实由本章大纲首次引入，已写入权威事实。本章内容中出现这些事实不属于"擅自发明"或"状态污染"，不得据此报 consistency error：</mandatory>
${outlineAuthorizedFacts.map(f => `  - [${f.subject}] ${f.attribute}: ${f.value}`).join('\n')}
</outline_authorized_facts>`
      : ''

    const foreshadowsSection = `<foreshadows>
  <active>
    ${activeForeshadows.length > 0
      ? activeForeshadows.map((f, i) => `  <item index="${i + 1}" created_at="${f.createdAtChapter ?? '?' }" expected="${f.expectedFulfillChapter}">${f.text}</item>`).join('\n')
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
</foreshadows>`

    const userContent = buildConsistencyUserPrompt(
      {
        characterWhitelistSection,
        outlineAuthorizedFactsSection,
        foreshadowsSection,
      },
      {
        chapterIndex,
        worldSetting: state.world || '（暂无世界观设定）',
        characterSetting: state.characters || '（暂无人物设定）',
        outline: state.outline || '（暂无大纲）',
        storyState: state.storyState || '（暂无状态记录）',
        chapterTimeAnchor: state.chapterPlan?.chapterTimeAnchor || state.chapterTimeAnchor || '（未指定，默认以本章自身时间线为准）',
        supersededFacts: state.supersededFacts || '（无）',
        contentToCheck: state.chapterContent || '（无内容）',
      },
    )

    return [this.systemMessage(buildConsistencySystemPrompt()), this.userMessage(userContent)]
  }

  protected parse(content: string): AgentOutput {
    return parseJsonFromLLM(content)
  }

  async processOutput(
    output: AgentOutput,
    canonicalFacts?: CanonicalFact[]
  ): Promise<Issue[]> {
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

    if (data.is_consistent === true) {
      return []
    }

    return normalizeIssues(data.issues, 'consistency', this.provider, {
      canonicalFacts,
      mapType: issue => {
        if (issue.aspect === 'outline') {
          return issue.type === 'missing_event' ? 'outline_violation' : 'outline_deviation'
        }
        return 'consistency'
      },
    })
  }
}
