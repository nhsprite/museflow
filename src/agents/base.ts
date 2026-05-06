import type { ModelProvider, Message } from '../model/provider.js'
import { createProvider } from '../model/registry.js'
import { getGenreSkill } from '../genres/registry.js'
import type { GenreSkill } from '../types/genre.js'
import type { WorldDirection } from '../types/story.js'
import type { Issue } from '../types/agent.js'
import type { ForeshadowItem } from '../graph/state.js'
import type { ChapterPlan } from './chapter-planner.js'

export abstract class BaseAgent {
  protected provider: ModelProvider
  protected temperature: number

  constructor(provider?: ModelProvider, temperature: number = 0.7) {
    this.provider = provider ?? createProvider()
    this.temperature = temperature
  }

  protected async chat(messages: Message[]): Promise<string> {
    return this.provider.chat(messages, this.temperature)
  }

  protected systemMessage(content: string): Message {
    return { role: 'system', content }
  }

  protected userMessage(content: string): Message {
    return { role: 'user', content }
  }

  protected assistantMessage(content: string): Message {
    return { role: 'assistant', content }
  }

  protected getGenre(genreName: string): GenreSkill | null {
    return getGenreSkill(genreName)
  }

  protected fillTemplate(template: string, vars: Record<string, string | number>): string {
    let result = template
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value))
    }
    return result
  }

  protected abstract buildPrompt(state: AgentState): Message[]

  async run(state: AgentState): Promise<AgentOutput> {
    const messages = this.buildPrompt(state)
    try {
      const content = await this.chat(messages)
      return this.parse(content)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  protected abstract parse(content: string): AgentOutput
}

export interface ParagraphFix {
  index: number
  content: string
  issues: Issue[]
}

export interface SentenceFix {
  paragraphIndex: number
  sentenceIndex: number
  original: string
  issue: Issue
}

export interface AgentState {
  idea: string
  genre: string
  totalChapters: number
  title?: string
  worldDirection?: WorldDirection
  world?: string
  characters?: string
  outline?: string
  previousChapters?: string
  chapterContent?: string
  chapterIndex?: number
  foreshadowStack?: ForeshadowItem[]
  chapterSummaries?: string[]
  chapterTitle?: string
  chapterSummary?: string
  timelineSnapshot?: string | null
  keyEventsTimeline?: string | null
  issues?: Issue[]
  paragraphFix?: {
    paragraphs: ParagraphFix[]
    context: string
  }
  sentenceFix?: {
    sentences: SentenceFix[]
    context: string
  }
  chapterPlan?: ChapterPlan
}

export interface AgentOutput {
  success: boolean
  content?: string
  data?: unknown
  error?: string
}