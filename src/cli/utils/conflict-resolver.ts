import { select } from '@inquirer/prompts'
import { generateId } from '../../utils/id.js'
import { applyStateOverrides, applyOutlineRevision } from '../../core/runner.js'
import { BlockingConflictError, isBlockingConflictError } from '../../utils/errors.js'
import type { StateOverride } from '../../types/story-state.js'

export { isBlockingConflictError }

/**
 * 对 blocking 级别的大纲-权威事实冲突进行交互式作者裁决。
 *
 * 该函数是中立的：它不解析任何故事内容，只根据 Conflict 的通用字段
 * 生成 override / constraint / authorDecision，或采纳系统生成的修订大纲。
 */
export async function resolveBlockingConflicts(
  storyId: string,
  error: BlockingConflictError
): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error('[MuseFlow] 检测到阻断性冲突，但当前不是交互式终端，无法请求裁决。')
    console.error('冲突列表：')
    for (const conflict of error.conflicts) {
      console.error(`  - [${conflict.severity}] ${conflict.description}`)
    }
    if (error.proposal) {
      console.error('\n系统建议的修订大纲（当前环境非交互式，无法直接采纳）：')
      console.error(error.proposal.revisedDescription)
    }
    process.exit(1)
  }

  const chapterNumber = error.chapterIndex + 1

  // 如果系统已生成修订建议，优先提供“采纳建议”这一中性选项。
  if (error.proposal) {
    console.log('\n[MuseFlow] 系统检测到本章大纲与权威事实存在冲突，并生成了一条修订建议：')
    console.log(`\n建议大纲：\n${error.proposal.revisedDescription}\n`)
    console.log(`说明：${error.proposal.explanation}\n`)

    const proposalDecision = await select<'adopt' | 'manual' | 'abort'>({
      message: '请选择处理方式：',
      choices: [
        { name: '采纳系统修订大纲（同步更新 outline.md）', value: 'adopt' },
        { name: '手动裁决每个冲突', value: 'manual' },
        { name: '退出，稍后手动处理', value: 'abort' },
      ],
    })

    if (proposalDecision === 'abort') {
      console.log('[MuseFlow] 已取消，未做任何修改。')
      process.exit(0)
    }

    if (proposalDecision === 'adopt') {
      await applyOutlineRevision(storyId, error.chapterIndex, error.proposal.revisedDescription)
      console.log('[MuseFlow] 已采纳系统修订大纲，将重新尝试撰写本章。')
      return
    }
  }

  const overrides: StateOverride[] = []
  const constraints: string[] = []
  const authorDecisions: Record<string, 'outline' | 'canonical'> = {}

  for (const conflict of error.conflicts) {
    const decision = await select<'outline' | 'canonical' | 'abort'>({
      message: `第 ${chapterNumber} 章冲突：${conflict.description}`,
      choices: [
        { name: '以本章大纲为准（覆盖权威事实）', value: 'outline' },
        { name: '以权威事实为准（约束本章大纲）', value: 'canonical' },
        { name: '退出，稍后手动处理', value: 'abort' },
      ],
    })

    if (decision === 'abort') {
      console.log('[MuseFlow] 已取消，未做任何修改。')
      process.exit(0)
    }

    authorDecisions[conflict.id] = decision

    if (decision === 'outline') {
      const override: StateOverride = {
        id: generateId('override'),
        subject: conflict.subject,
        attribute: conflict.attribute,
        oldValue: conflict.oldValue,
        newValue: conflict.newValue,
        reason: `作者裁决：第 ${chapterNumber} 章大纲覆盖此前权威事实（${conflict.attribute}）`,
        source: 'author',
        chapterIndex: error.chapterIndex,
        createdAt: Date.now(),
      }
      overrides.push(override)
    } else {
      const constraint =
        `[author-decision-canonical] 冲突ID: ${conflict.id} | ` +
        `主题：${conflict.subject}（${conflict.attribute}） | ` +
        `本章必须遵循权威事实：${conflict.oldValue}，不得执行与之矛盾的大纲内容。`
      constraints.push(constraint)
    }
  }

  await applyStateOverrides(storyId, overrides, constraints, authorDecisions)
  console.log('[MuseFlow] 作者裁决已保存，将重新尝试撰写本章。')
}
