import { select } from '@inquirer/prompts'
import { generateId } from '../../utils/id.js'
import { applyStateOverrides } from '../../core/runner.js'
import { BlockingConflictError, isBlockingConflictError } from '../../utils/errors.js'
import type { StateOverride } from '../../types/story-state.js'

export { isBlockingConflictError }

/**
 * 对 blocking 级别的大纲-权威事实冲突进行交互式作者裁决。
 *
 * 该函数是中立的：它不解析任何故事内容，只根据 Conflict 的通用字段
 * 生成 override / constraint / authorDecision，然后写回 checkpoint。
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
    process.exit(1)
  }

  const overrides: StateOverride[] = []
  const constraints: string[] = []
  const authorDecisions: Record<string, 'outline' | 'canonical'> = {}
  const chapterNumber = error.chapterIndex + 1

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
