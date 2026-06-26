import {
  WorldbuilderAgent,
  CharacterAgent,
  HighLevelOutlineAgent,
  ChapterAgent,
  ChapterPlannerAgent,
  QualityAgent,
  ForeshadowingAgent,
  HallucinationAgent,
  ConsistencyAgent,
  OutlineComplianceAgent,
  FixAgent,
  SummaryAgent,
} from '../agents/index.js'

let worldbuilderAgent: WorldbuilderAgent | null = null
let characterAgent: CharacterAgent | null = null
let highLevelOutlineAgent: HighLevelOutlineAgent | null = null
let chapterAgent: ChapterAgent | null = null
let chapterPlannerAgent: ChapterPlannerAgent | null = null
let qualityAgent: QualityAgent | null = null
let foreshadowingAgent: ForeshadowingAgent | null = null
let hallucinationAgent: HallucinationAgent | null = null
let consistencyAgent: ConsistencyAgent | null = null
let outlineComplianceAgent: OutlineComplianceAgent | null = null
let fixAgent: FixAgent | null = null
let summaryAgent: SummaryAgent | null = null

export function getWorldbuilderAgent(): WorldbuilderAgent {
  if (!worldbuilderAgent) worldbuilderAgent = new WorldbuilderAgent()
  return worldbuilderAgent
}

export function getCharacterAgent(): CharacterAgent {
  if (!characterAgent) characterAgent = new CharacterAgent()
  return characterAgent
}

export function getHighLevelOutlineAgent(): HighLevelOutlineAgent {
  if (!highLevelOutlineAgent) highLevelOutlineAgent = new HighLevelOutlineAgent()
  return highLevelOutlineAgent
}

export function getChapterAgent(): ChapterAgent {
  if (!chapterAgent) chapterAgent = new ChapterAgent()
  return chapterAgent
}

export function getChapterPlannerAgent(): ChapterPlannerAgent {
  if (!chapterPlannerAgent) chapterPlannerAgent = new ChapterPlannerAgent()
  return chapterPlannerAgent
}

export function getQualityAgent(): QualityAgent {
  if (!qualityAgent) qualityAgent = new QualityAgent()
  return qualityAgent
}

export function getForeshadowingAgent(): ForeshadowingAgent {
  if (!foreshadowingAgent) foreshadowingAgent = new ForeshadowingAgent()
  return foreshadowingAgent
}

export function getHallucinationAgent(): HallucinationAgent {
  if (!hallucinationAgent) hallucinationAgent = new HallucinationAgent()
  return hallucinationAgent
}

export function getConsistencyAgent(): ConsistencyAgent {
  if (!consistencyAgent) consistencyAgent = new ConsistencyAgent()
  return consistencyAgent
}

export function getOutlineComplianceAgent(): OutlineComplianceAgent {
  if (!outlineComplianceAgent) outlineComplianceAgent = new OutlineComplianceAgent()
  return outlineComplianceAgent
}

export function getFixAgent(): FixAgent {
  if (!fixAgent) fixAgent = new FixAgent()
  return fixAgent
}

export function getSummaryAgent(): SummaryAgent {
  if (!summaryAgent) summaryAgent = new SummaryAgent()
  return summaryAgent
}
