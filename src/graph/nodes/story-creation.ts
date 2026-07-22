import { logger } from '../../utils/logger.js'
import type { ReducedGraphState } from '../state.js'
import type {
  WorldbuilderAgentInput,
  CharacterAgentInput,
  StoryArcAgentInput,
} from '../../agents/types.js'
import { getWorldbuilderAgent, getCharacterAgent, getStoryArcAgent } from '../agent-factory.js'
import { generateId } from '../../utils/id.js'
import { findMandatoryBeatById } from '../../utils/mandatory-beat-ids.js'
import { writeOutlineContent, writeStoryBible } from '../../storage/filesystem/writer.js'
import { updateStoryTitle, renameStoryOutputDir } from '../../storage/meta/stores/story.js'
import { getStoryOutputDirWithTitle } from '../../utils/paths.js'
import { charactersToString } from '../utils/characters.js'
import { createEmptyStoryMemory } from '../../story-memory/projector.js'
import type { RuntimeContext } from '../../core/context.js'
import { auditKeyBeatCoverage } from '../../core/beat-coverage.js'

export async function build_world(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const agent = getWorldbuilderAgent(context.provider)
  const agentState: WorldbuilderAgentInput = {
    idea: state.idea,
    genre: state.genre,
    totalChapters: state.totalChapters,
  }

  const output = await agent.run(agentState)
  const world = await agent.processOutput(output, state.story.id)

  if (!world) {
    throw new Error('世界观生成失败，请检查 AI 输出或重试')
  }

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

export async function create_characters(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const agent = getCharacterAgent(context.provider)
  const worldContent = state.world?.content
  const agentState: CharacterAgentInput = {
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
    const characters = await agent.processOutput(output, state.story.id)

    if (characters.length > 0) {
      if (attempt > 0) {
        logger.info(`[MuseFlow] 角色生成重试成功，共创建 ${characters.length} 个人物`)
      }
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

export async function create_outline(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  const worldContent = state.world?.content
  const agent = getStoryArcAgent(context.provider)
  const agentState: StoryArcAgentInput = {
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
      logger.warn(`[MuseFlow] 故事弧线解析失败，第 ${attempt}/${maxRetries} 次重试...`)
    }

    const output = await agent.run(agentState)
    lastOutput = output
    const storyArc = output.data as import('../../types/outline.js').StoryArc | undefined

    if (storyArc && storyArc.acts.length > 0) {
      if (attempt > 0) {
        logger.info(`[MuseFlow] 故事弧线重试成功，共 ${storyArc.acts.length} 幕`)
      }
      const emptyOutline: ReducedGraphState['outline'] = Array.from(
        { length: state.totalChapters },
        (_, i) => ({ number: i + 1, title: '', description: '' })
      )
      const initialActProgress: ReducedGraphState['actProgress'] = Object.fromEntries(
        storyArc.acts.map((act) => [act.index, { consumed: [], pending: [...act.mandatoryBeats] }])
      )
      await writeOutlineContent(state.story.outputDir, state.story.title, emptyOutline, storyArc)
      await writeStoryBible(
        state.story.outputDir,
        state.story,
        worldContent || '',
        state.characters,
        emptyOutline
      )
      return {
        storyArc,
        outline: emptyOutline,
        actProgress: initialActProgress,
        storyMemory: createEmptyStoryMemory(),
      }
    }

    if (!output.success && output.content) {
      logger.warn(`[MuseFlow] 第 ${attempt + 1} 次故事弧线原始输出（前 500 字符）：`)
      logger.warn(output.content.slice(0, 500))
    }
  }

  logger.error('[MuseFlow] 错误：故事弧线生成失败，已达到最大重试次数')
  if (lastOutput?.content) {
    logger.error('[MuseFlow] 最后一次原始输出（前 1000 字符）：')
    logger.error(lastOutput.content.slice(0, 1000))
  }
  throw new Error('[MuseFlow] 错误：故事弧线生成失败，请检查 AI 输出或重试')
}

export async function validate_outline(
  context: RuntimeContext,
  state: ReducedGraphState
): Promise<Partial<ReducedGraphState>> {
  let storyArc = state.storyArc
  const issues: Array<import('../../types/agent.js').Issue> = []

  if (!storyArc) {
    issues.push({
      id: generateId(),
      ruleId: 'story-arc.missing',
      type: 'outline_missing',
      severity: 'error',
      description: '故事弧线未生成',
      location: 'create_outline',
    })
    return { pendingIssues: [...state.pendingIssues, ...issues] }
  }

  if (storyArc.keyBeats.some((keyBeat) => keyBeat.coveredByMandatoryBeatId === undefined)) {
    const audit = await auditKeyBeatCoverage(storyArc, context.provider)
    storyArc = audit.storyArc
  }

  // 验证幕结构是否覆盖全部章节
  const sortedActs = [...storyArc.acts].sort((a, b) => a.startChapter - b.startChapter)
  let expectedStart = 1
  for (const act of sortedActs) {
    if (act.startChapter !== expectedStart) {
      issues.push({
        id: generateId(),
        ruleId: 'story-arc.gap',
        type: 'outline_gap',
        severity: 'error',
        description: `幕结构存在缺口：第 ${expectedStart} 章未落入任何一幕`,
        location: `第 ${act.index} 幕`,
      })
    }
    if (act.endChapter < act.startChapter) {
      issues.push({
        id: generateId(),
        ruleId: 'story-arc.range',
        type: 'outline_invalid',
        severity: 'error',
        description: `第 ${act.index} 幕的结束章节小于起始章节`,
        location: `第 ${act.index} 幕`,
      })
    }
    expectedStart = act.endChapter + 1
  }
  if (expectedStart - 1 !== state.totalChapters) {
    issues.push({
      id: generateId(),
      ruleId: 'story-arc.coverage',
      type: 'outline_coverage',
      severity: 'error',
      description: `幕结构未覆盖全部 ${state.totalChapters} 章，实际覆盖到第 ${expectedStart - 1} 章`,
      location: 'storyArc',
    })
  }

  // 验证每幕都有 mandatory beats
  for (const act of storyArc.acts) {
    if (act.mandatoryBeats.length === 0) {
      issues.push({
        id: generateId(),
        ruleId: 'story-arc.empty-beats',
        type: 'outline_empty_beats',
        severity: 'warning',
        description: `第 ${act.index} 幕「${act.title}」没有 mandatory beats，可能导致该幕缺乏叙事目标`,
        location: `第 ${act.index} 幕`,
      })
    }
  }

  // 验证 keyBeats 的 deadlineAct 在有效范围内
  for (const keyBeat of storyArc.keyBeats) {
    const maxAct = Math.max(...storyArc.acts.map((a) => a.index))
    if (keyBeat.deadlineAct < 1 || keyBeat.deadlineAct > maxAct) {
      issues.push({
        id: generateId(),
        ruleId: 'story-arc.invalid-deadline',
        type: 'outline_invalid_deadline',
        severity: 'warning',
        description: `关键情节点「${keyBeat.beat}」的截止幕 ${keyBeat.deadlineAct} 超出有效范围 1–${maxAct}`,
        location: 'keyBeats',
      })
    }
    if (keyBeat.coveredByMandatoryBeatId === undefined) {
      issues.push({
        id: generateId(),
        ruleId: 'story-arc.beat-coverage-missing',
        type: 'outline_invalid',
        severity: 'error',
        description: `关键情节点 ${keyBeat.id} 尚未声明是否由 mandatory beat 覆盖`,
        subject: keyBeat.id,
        location: 'keyBeats',
      })
    } else if (keyBeat.coveredByMandatoryBeatId !== null) {
      const coveredBy = findMandatoryBeatById(storyArc, keyBeat.coveredByMandatoryBeatId)
      if (!coveredBy || coveredBy.act.index > keyBeat.deadlineAct) {
        issues.push({
          id: generateId(),
          ruleId: 'story-arc.beat-coverage-invalid',
          type: 'outline_invalid',
          severity: 'error',
          description: `关键情节点 ${keyBeat.id} 的 coveredByMandatoryBeatId 无效：${keyBeat.coveredByMandatoryBeatId}`,
          subject: keyBeat.id,
          location: 'keyBeats',
        })
      }
    }
  }

  if (issues.length > 0) {
    logger.warn(`\n[MuseFlow] 故事弧线校验发现 ${issues.length} 个问题：`)
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '❌' : '⚠️'
      logger.warn(`  ${icon} [${issue.type}] ${issue.description}`)
    }
    logger.warn('')
  }

  return { storyArc, pendingIssues: [...state.pendingIssues, ...issues] }
}
