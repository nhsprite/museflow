import { deleteStory } from '../../storage/meta/stores/story.js'
import { requireStory } from '../utils/story-loader.js'

interface DeleteOptions {
  force?: boolean
}

export async function del(storyId: string, options?: DeleteOptions): Promise<void> {
  if (!storyId) {
    console.error('[MuseFlow] 错误: 请提供故事ID')
    console.log('用法: museflow delete <story-id>')
    process.exit(1)
  }

  const story = await requireStory(storyId)

  if (!options?.force) {
    console.log(`[MuseFlow] 即将删除书籍: ${story.title || '(未命名)'}`)
    console.log(`  ID: ${story.id}`)
    console.log(`  简介: ${story.synopsis || story.idea}`)
    console.log(`  路径: ${story.outputDir}`)
    console.log('')
    console.log('⚠️  此操作不可撤销！')
    console.log('使用 --force 参数跳过确认')
    return
  }

  const success = deleteStory(storyId)
  if (success) {
    console.log(`✅ 已删除书籍: ${story.title || '(未命名)'} (${story.id})`)
  } else {
    console.error(`[MuseFlow] 删除失败: ${storyId}`)
    process.exit(1)
  }
}
