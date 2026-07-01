import type { ModelProvider } from '../model/provider.js'
import {
  WorldbuilderAgent,
  CharacterAgent,
  StoryArcAgent,
  ChapterOutlineAgent,
  ChapterAgent,
  ChapterPlannerAgent,
  ForeshadowingAgent,
  ConsistencyAgent,
  FixAgent,
  SummaryAgent,
} from '../agents/index.js'

function makeAgentKey(provider: ModelProvider, name: string): string {
  return `${name}:${provider.constructor.name}`
}

const instances = new Map<string, unknown>()

function getAgentInstance<T>(
  provider: ModelProvider,
  key: string,
  ctor: new (provider: ModelProvider) => T,
): T {
  const fullKey = makeAgentKey(provider, key)
  let instance = instances.get(fullKey) as T | undefined
  if (!instance) {
    instance = new ctor(provider)
    instances.set(fullKey, instance)
  }
  return instance
}

export function getWorldbuilderAgent(provider: ModelProvider): WorldbuilderAgent {
  return getAgentInstance(provider, 'worldbuilder', WorldbuilderAgent)
}

export function getCharacterAgent(provider: ModelProvider): CharacterAgent {
  return getAgentInstance(provider, 'character', CharacterAgent)
}

export function getStoryArcAgent(provider: ModelProvider): StoryArcAgent {
  return getAgentInstance(provider, 'story-arc', StoryArcAgent)
}

export function getChapterOutlineAgent(provider: ModelProvider): ChapterOutlineAgent {
  return getAgentInstance(provider, 'chapter-outline', ChapterOutlineAgent)
}

export function getChapterAgent(provider: ModelProvider): ChapterAgent {
  return getAgentInstance(provider, 'chapter', ChapterAgent)
}

export function getChapterPlannerAgent(provider: ModelProvider): ChapterPlannerAgent {
  return getAgentInstance(provider, 'chapter-planner', ChapterPlannerAgent)
}

export function getForeshadowingAgent(provider: ModelProvider): ForeshadowingAgent {
  return getAgentInstance(provider, 'foreshadowing', ForeshadowingAgent)
}

export function getConsistencyAgent(provider: ModelProvider): ConsistencyAgent {
  return getAgentInstance(provider, 'consistency', ConsistencyAgent)
}

export function getFixAgent(provider: ModelProvider): FixAgent {
  return getAgentInstance(provider, 'fix', FixAgent)
}

export function getSummaryAgent(provider: ModelProvider): SummaryAgent {
  return getAgentInstance(provider, 'summary', SummaryAgent)
}
