import { getGenreRegistry, installCustomGenre, uninstallCustomGenre } from '../../genres/registry.js'
import { getGenreSkill } from '../../genres/registry.js'

interface GenresOptions {
  file?: string
}

export async function genres(action: string, name?: string, options?: GenresOptions): Promise<void> {
  if (action === 'list') {
    const registry = getGenreRegistry()

    console.log('='.repeat(50))
    console.log('可用题材')
    console.log('='.repeat(50))
    console.log('')

    const builtin = registry.filter(e => e.source === 'builtin')
    const custom = registry.filter(e => e.source === 'custom')

    console.log(`内置题材 (${builtin.length}):`)
    for (const entry of builtin) {
      console.log(`  ${entry.skill.name.padEnd(12)} ${entry.skill.displayName}`)
      if (entry.skill.tropes.length > 0) {
        console.log(`               元素: ${entry.skill.tropes.slice(0, 3).join(', ')}${entry.skill.tropes.length > 3 ? '...' : ''}`)
      }
    }
    console.log('')

    if (custom.length > 0) {
      console.log(`自定义题材 (${custom.length}):`)
      for (const entry of custom) {
        console.log(`  ${entry.skill.name.padEnd(12)} ${entry.skill.displayName}`)
      }
      console.log('')
    } else {
      console.log('自定义题材: 无')
      console.log('使用 "museflow genres install <name>" 安装自定义题材')
      console.log('')
    }

    console.log('='.repeat(50))
    return
  }

  if (action === 'install') {
    if (!name) {
      console.error('[MuseFlow] 错误: 请提供题材名称')
      console.log('用法: museflow genres install <name> [--file <path>]')
      process.exit(1)
    }

    if (!options?.file) {
      console.error('[MuseFlow] 错误: 请提供题材文件路径')
      console.log('用法: museflow genres install <name> --file <path>')
      process.exit(1)
    }

    try {
      const skill = installCustomGenre(options.file)
      console.log(`[MuseFlow] 已安装题材: ${skill.displayName} (${skill.name})`)
    } catch (err) {
      console.error('[MuseFlow] 安装失败:', err instanceof Error ? err.message : String(err))
      process.exit(1)
    }
    return
  }

  if (action === 'uninstall') {
    if (!name) {
      console.error('[MuseFlow] 错误: 请提供题材名称')
      console.log('用法: museflow genres uninstall <name>')
      process.exit(1)
    }

    const skill = getGenreSkill(name)
    if (!skill) {
      console.error(`[MuseFlow] 错误: 题材 "${name}" 不存在`)
      process.exit(1)
    }

    const registry = getGenreRegistry()
    const entry = registry.find(e => e.skill.name === name)
    if (entry?.source !== 'custom') {
      console.error('[MuseFlow] 错误: 只能卸载自定义题材')
      process.exit(1)
    }

    const success = uninstallCustomGenre(name)
    if (success) {
      console.log(`[MuseFlow] 已卸载题材: ${name}`)
    } else {
      console.error('[MuseFlow] 卸载失败')
      process.exit(1)
    }
    return
  }

  if (action === 'info') {
    if (!name) {
      console.error('[MuseFlow] 错误: 请提供题材名称')
      console.log('用法: museflow genres info <name>')
      process.exit(1)
    }

    const skill = getGenreSkill(name)
    if (!skill) {
      console.error(`[MuseFlow] 错误: 题材 "${name}" 不存在`)
      process.exit(1)
    }

    const registry = getGenreRegistry()
    const entry = registry.find(e => e.skill.name === name)

    console.log('='.repeat(50))
    console.log(`题材详情: ${skill.displayName}`)
    console.log('='.repeat(50))
    console.log('')
    console.log(`名称: ${skill.name}`)
    console.log(`显示名称: ${skill.displayName}`)
    console.log(`版本: ${skill.version}`)
    console.log(`来源: ${entry?.source || 'unknown'}`)
    console.log('')

    if (skill.tropes.length > 0) {
      console.log('题材元素:')
      for (const trope of skill.tropes) {
        console.log(`  - ${trope}`)
      }
      console.log('')
    }

    console.log('世界观提示:')
    console.log(skill.worldbuildingPrompt.substring(0, 200) + '...')
    console.log('')
    console.log('大纲模板:')
    console.log(skill.outlineTemplate.substring(0, 200) + '...')
    console.log('')

    if (skill.chapterPromptSupplement) {
      console.log('章节补充:')
      console.log(skill.chapterPromptSupplement.substring(0, 200) + '...')
      console.log('')
    }

    console.log('='.repeat(50))
    return
  }

  console.error(`[MuseFlow] 错误: 未知的操作 "${action}"`)
  console.log('用法: museflow genres [list|install|uninstall|info]')
  process.exit(1)
}