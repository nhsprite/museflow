import type { ModelProvider, Message } from '../model/provider.js'
import { getGenreSkill } from '../genres/registry.js'
import type { GenreSkill } from '../types/genre.js'
import type { AgentInput, AgentOutput } from './types.js'
import { logger } from '../utils/logger.js'

export abstract class BaseAgent<TInput extends AgentInput> {
  protected provider: ModelProvider
  protected temperature: number

  constructor(provider: ModelProvider, temperature: number = 0.7) {
    this.provider = provider
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

  protected abstract buildPrompt(state: TInput): Message[]

  async run(state: TInput): Promise<AgentOutput> {
    const agentName = this.constructor.name.replace('Agent', '').toLowerCase()
    logger.debug(`[Agent] ${agentName} started`)
    const messages = this.buildPrompt(state)
    try {
      const content = await this.chat(messages)
      logger.debug(`[Agent] ${agentName} completed`)
      return this.parse(content)
    } catch (err) {
      logger.debug(
        `[Agent] ${agentName} failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  protected abstract parse(content: string): AgentOutput
}

export type { AgentOutput, ParagraphFix, SentenceFix, ChapterPlan } from './types.js'

/**
 * @deprecated Use the per-agent input types exported from `./types.js` instead.
 */
export type AgentState = import('./types.js').AgentState
