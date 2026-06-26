import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type { AgentState } from '../../agents/base.js'
import {
  getWorldbuilderAgent,
  getCharacterAgent,
  getHighLevelOutlineAgent,
} from '../agent-factory.js'
import { generateId } from '../../utils/id.js'
import { saveCharacters } from '../../storage/database/dao/character.js'
import { saveWorld } from '../../storage/database/dao/world.js'
import { saveOutline } from '../../storage/database/dao/chapter.js'
import { writeOutlineContent, writeStoryBible } from '../../storage/filesystem/writer.js'
import { updateStoryTitle, renameStoryOutputDir } from '../../storage/database/dao/story.js'
import { getStoryOutputDirWithTitle } from '../../utils/paths.js'
import { charactersToString } from '../utils/characters.js'

export async function build_world(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getWorldbuilderAgent()
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
  }

  const output = await agent.run(agentState)
  const world = agent.processOutput(output, state.story.id)

  if (!world) {
    throw new Error('世界观生成失败，请检查 AI 输出或重试')
  }

  saveWorld(state.story.id, world.content)

  const existingTitle = state.story.title
  const aiGeneratedTitle = agent.extractTitle(output)

  if (!existingTitle || existingTitle.trim() === '') {
    if (!aiGeneratedTitle) {
      return { world, story: { ...state.story, title: state.story.title } }
    }

    updateStoryTitle(state.story.id, aiGeneratedTitle)
    const newOutputDir = getStoryOutputDirWithTitle(aiGeneratedTitle, state.story.id)
    renameStoryOutputDir(state.story.id, newOutputDir)

    return { world, story: { ...state.story, outputDir: newOutputDir, title: aiGeneratedTitle } }
  }

  logger.info(`[MuseFlow] 使用用户选择的书名：${existingTitle}`)
  return { world, story: { ...state.story, title: existingTitle } }
}

export async function create_characters(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const agent = getCharacterAgent()
  const worldContent = state.world?.content
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    title: state.story.title,
    ...(state.story.worldDirection ? { worldDirection: state.story.worldDirection } : {}),
    ...(worldContent ? { world: worldContent } : {}),
  }

  const maxRetries = 2
  let lastOutput: import('../../agents/base.js').AgentOutput | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      logger.warn(`[MuseFlow] 角色生成解析失败，第 ${attempt}/${maxRetries} 次重试...`)
    }

    const output = await agent.run(agentState)
    lastOutput = output
    const characters = agent.processOutput(output, state.story.id)

    if (characters.length > 0) {
      if (attempt > 0) {
        logger.info(`[MuseFlow] 角色生成重试成功，共创建 ${characters.length} 个人物`)
      }
      saveCharacters(state.story.id, characters)
      return { characters }
    }

    if (!output.success && output.content) {
      logger.warn(`[MuseFlow] 第 ${attempt + 1} 次角色生成原始输出（前 500 字符）：`)
      logger.warn(output.content.slice(0, 500))
    }
  }

  logger.error('[MuseFlow] 错误：角色生成失败，已达到最大重试次数')
  if (lastOutput?.content) {
    logger.error('[MuseFlow] 最后一次原始输出（前 1000 字符）：')
    logger.error(lastOutput.content.slice(0, 1000))
  }
  throw new Error('[MuseFlow] 错误：角色生成失败，请检查 AI 输出或重试')
}

export async function create_outline(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const worldContent = state.world?.content
  const agent = getHighLevelOutlineAgent()
  const agentState: AgentState = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
    title: state.story.title,
    ...(state.story.worldDirection ? { worldDirection: state.story.worldDirection } : {}),
    ...(worldContent ? { world: worldContent } : {}),
    characters: charactersToString(state.characters),
  }

  const maxRetries = 2
  let lastOutput: import('../../agents/base.js').AgentOutput | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      logger.warn(`[MuseFlow] 章节大纲解析失败，第 ${attempt}/${maxRetries} 次重试...`)
    }

    const output = await agent.run(agentState)
    lastOutput = output
    const chapters = (output.data as { chapters: ReducedGraphState['outline'] } | undefined)?.chapters ?? []

    if (chapters.length > 0) {
      if (attempt > 0) {
        logger.info(`[MuseFlow] 章节大纲重试成功，共生成 ${chapters.length} 章`)
      }
      saveOutline(state.story.id, chapters)
      await writeOutlineContent(state.story.outputDir, state.story.title, chapters)
      await writeStoryBible(
        state.story.outputDir,
        state.story,
        worldContent || '',
        state.characters,
        chapters,
      )
      return { outline: chapters }
    }

    if (!output.success && output.content) {
      logger.warn(`[MuseFlow] 第 ${attempt + 1} 次章节大纲原始输出（前 500 字符）：`)
      logger.warn(output.content.slice(0, 500))
    }
  }

  logger.error('[MuseFlow] 错误：章节大纲生成失败，已达到最大重试次数')
  if (lastOutput?.content) {
    logger.error('[MuseFlow] 最后一次原始输出（前 1000 字符）：')
    logger.error(lastOutput.content.slice(0, 1000))
  }
  throw new Error('[MuseFlow] 错误：章节大纲生成失败，请检查 AI 输出或重试')
}

export async function validate_outline(state: ReducedGraphState): Promise<Partial<ReducedGraphState>> {
  const outline = state.outline
  const issues: Array<import('../../types/agent.js').Issue> = []

  for (const item of outline) {
    if (!item) continue
    const eventCount = item.description.split(/[。；]/).filter(s => s.trim().length > 5).length
    if (eventCount > 5) {
      issues.push({
        id: generateId(),
        type: 'outline_density',
        severity: 'warning',
        description: `第${item.number}章大纲包含 ${eventCount} 个情节点，信息密度过高，建议拆分为2章或简化`,
        location: `第${item.number}章：${item.title}`,
      })
    }
  }

  const foreshadowPattern = /伏笔|铺垫|暗示|预示|留下悬念|日后|将来|未来/g
  const callbackPattern = /回收|兑现|揭晓|揭示|真相大白|终于明白/g
  for (let i = 0; i < outline.length; i++) {
    const item = outline[i]
    if (!item) continue
    const hasForeshadow = foreshadowPattern.test(item.description)
    const hasCallback = callbackPattern.test(item.description)
    if (hasForeshadow && hasCallback) {
      issues.push({
        id: generateId(),
        type: 'outline_foreshadow',
        severity: 'error',
        description: `第${item.number}章大纲同时包含"埋下伏笔"和"回收伏笔"的描述，这会导致伏笔在同一章被展示`,
        location: `第${item.number}章：${item.title}`,
      })
    }
  }

  if (issues.length > 0) {
    logger.warn(`\n[MuseFlow] 大纲校验发现 ${issues.length} 个问题：`)
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '❌' : '⚠️'
      logger.warn(`  ${icon} [${issue.type}] ${issue.description}`)
    }
    logger.warn('')
  }

  return { pendingIssues: [...state.pendingIssues, ...issues] }
}
