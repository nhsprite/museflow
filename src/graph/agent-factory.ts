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

const instances = new Map<string, unknown>()

function getAgentInstance<T>(key: string, ctor: new () => T): T {
  let instance = instances.get(key) as T | undefined
  if (!instance) {
    instance = new ctor()
    instances.set(key, instance)
  }
  return instance
}

export function getWorldbuilderAgent(): WorldbuilderAgent {
  return getAgentInstance('worldbuilder', WorldbuilderAgent)
}

export function getCharacterAgent(): CharacterAgent {
  return getAgentInstance('character', CharacterAgent)
}

export function getStoryArcAgent(): StoryArcAgent {
  return getAgentInstance('story-arc', StoryArcAgent)
}

export function getChapterOutlineAgent(): ChapterOutlineAgent {
  return getAgentInstance('chapter-outline', ChapterOutlineAgent)
}

export function getChapterAgent(): ChapterAgent {
  return getAgentInstance('chapter', ChapterAgent)
}

export function getChapterPlannerAgent(): ChapterPlannerAgent {
  return getAgentInstance('chapter-planner', ChapterPlannerAgent)
}

export function getForeshadowingAgent(): ForeshadowingAgent {
  return getAgentInstance('foreshadowing', ForeshadowingAgent)
}

export function getConsistencyAgent(): ConsistencyAgent {
  return getAgentInstance('consistency', ConsistencyAgent)
}

export function getFixAgent(): FixAgent {
  return getAgentInstance('fix', FixAgent)
}

export function getSummaryAgent(): SummaryAgent {
  return getAgentInstance('summary', SummaryAgent)
}
