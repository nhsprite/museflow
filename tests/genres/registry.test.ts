import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let customDir: string

vi.mock('../../src/utils/paths.js', () => ({
  expandPath: vi.fn((path: string) => {
    if (path === '~/.museflow/genres') return customDir
    return path
  }),
  getOutputsDir: vi.fn(() => join(process.cwd(), 'books')),
  getStoryOutputDir: vi.fn((id: string, title?: string) => join(process.cwd(), 'books', `${title || 'untitled'}-${id}`)),
  getStoryOutputDirWithTitle: vi.fn((title: string, storyId: string) => join(process.cwd(), 'books', `${title}_${storyId}`)),
  getChapterFilePath: vi.fn((outputDir: string, chapterNumber: number) => join(outputDir, 'chapters', `chapter_${chapterNumber}.md`)),
  getGlobalConfigFilePath: vi.fn(() => join(process.cwd(), '.museflow', 'config.json')),
  getProjectConfigFilePath: vi.fn(() => join(process.cwd(), '.museflow', 'config.json')),
}))

describe('genre registry', () => {
  beforeEach(async () => {
    customDir = join(process.cwd(), 'tests', 'tmp', `genres-${Date.now()}`)
    mkdirSync(customDir, { recursive: true })
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(customDir, { recursive: true, force: true })
  })

  async function loadRegistry() {
    return await import('../../src/genres/registry.js')
  }

  it('returns 8 builtin genres', async () => {
    const { getGenreRegistry } = await loadRegistry()
    const registry = getGenreRegistry()

    expect(registry).toHaveLength(8)
    expect(registry.every(e => e.source === 'builtin')).toBe(true)
    expect(registry.map(e => e.skill.name).sort()).toEqual([
      'default',
      'fantasy',
      'horror',
      'mystery',
      'romance',
      'scifi',
      'urban',
      'xianxia',
    ])
  })

  it('loads custom skills from mocked genres directory', async () => {
    writeFileSync(
      join(customDir, 'custom.json'),
      JSON.stringify({
        name: 'custom',
        displayName: 'Custom',
        version: '1.0.0',
        worldbuildingPrompt: 'custom prompt',
        chapterPromptSupplement: '',
        tropes: [],
      }),
      'utf-8',
    )

    const { getGenreRegistry } = await loadRegistry()
    const registry = getGenreRegistry()

    expect(registry).toHaveLength(9)
    const custom = registry.find(e => e.skill.name === 'custom')
    expect(custom).toBeDefined()
    expect(custom!.source).toBe('custom')
    expect(custom!.path).toBe(join(customDir, 'custom.json'))
  })

  it('custom skill overrides builtin skill with same name', async () => {
    writeFileSync(
      join(customDir, 'default.json'),
      JSON.stringify({
        name: 'default',
        displayName: 'Overridden Default',
        version: '2.0.0',
        worldbuildingPrompt: 'overridden prompt',
        chapterPromptSupplement: '',
        tropes: [],
      }),
      'utf-8',
    )

    const { getGenreRegistry } = await loadRegistry()
    const registry = getGenreRegistry()

    const defaultEntry = registry.find(e => e.skill.name === 'default')
    expect(defaultEntry).toBeDefined()
    expect(defaultEntry!.source).toBe('custom')
    expect(defaultEntry!.skill.displayName).toBe('Overridden Default')
  })

  it('skips invalid custom skill files without throwing', async () => {
    writeFileSync(join(customDir, 'invalid.json'), 'not valid json', 'utf-8')
    writeFileSync(
      join(customDir, 'valid.json'),
      JSON.stringify({
        name: 'valid',
        displayName: 'Valid',
        version: '1.0.0',
        worldbuildingPrompt: 'valid prompt',
        chapterPromptSupplement: '',
        tropes: [],
      }),
      'utf-8',
    )

    const { getGenreRegistry } = await loadRegistry()
    const registry = getGenreRegistry()

    expect(registry.some(e => e.skill.name === 'valid')).toBe(true)
    expect(registry.some(e => e.skill.name === 'invalid')).toBe(false)
  })

  it('returns null when custom directory does not exist', async () => {
    rmSync(customDir, { recursive: true, force: true })

    const { getGenreRegistry } = await loadRegistry()
    const registry = getGenreRegistry()

    expect(registry).toHaveLength(8)
  })

  it('getGenreSkill returns builtin or custom skill', async () => {
    writeFileSync(
      join(customDir, 'custom.json'),
      JSON.stringify({
        name: 'custom',
        displayName: 'Custom',
        version: '1.0.0',
        worldbuildingPrompt: 'custom prompt',
        chapterPromptSupplement: '',
        tropes: [],
      }),
      'utf-8',
    )

    const { getGenreSkill } = await loadRegistry()

    expect(getGenreSkill('default')?.displayName).toBe('默认（通用）')
    expect(getGenreSkill('custom')?.displayName).toBe('Custom')
    expect(getGenreSkill('nonexistent')).toBeNull()
  })

  it('installCustomGenre writes skill file and invalidates cache', async () => {
    const sourceFile = join(customDir, 'source.json')
    writeFileSync(
      sourceFile,
      JSON.stringify({
        name: 'installed',
        displayName: 'Installed',
        version: '1.0.0',
        worldbuildingPrompt: 'installed prompt',
        chapterPromptSupplement: '',
        tropes: [],
      }),
      'utf-8',
    )

    const { installCustomGenre, getGenreRegistry } = await loadRegistry()
    const skill = installCustomGenre(sourceFile)

    expect(skill.name).toBe('installed')
    expect(existsSync(join(customDir, 'installed.json'))).toBe(true)

    const registry = getGenreRegistry()
    expect(registry.some(e => e.skill.name === 'installed' && e.source === 'custom')).toBe(true)
  })

  it('uninstallCustomGenre deletes custom skill file and invalidates cache', async () => {
    writeFileSync(
      join(customDir, 'removable.json'),
      JSON.stringify({
        name: 'removable',
        displayName: 'Removable',
        version: '1.0.0',
        worldbuildingPrompt: 'removable prompt',
        chapterPromptSupplement: '',
        tropes: [],
      }),
      'utf-8',
    )

    const { uninstallCustomGenre, getGenreRegistry } = await loadRegistry()
    const firstRegistry = getGenreRegistry()
    expect(firstRegistry.some(e => e.skill.name === 'removable')).toBe(true)

    const result = uninstallCustomGenre('removable')

    expect(result).toBe(true)
    expect(existsSync(join(customDir, 'removable.json'))).toBe(false)

    const secondRegistry = getGenreRegistry()
    expect(secondRegistry.some(e => e.skill.name === 'removable')).toBe(false)
  })

  it('uninstallCustomGenre returns false for builtin skill', async () => {
    const { uninstallCustomGenre } = await loadRegistry()
    const result = uninstallCustomGenre('default')
    expect(result).toBe(false)
  })

  it('uninstallCustomGenre returns false for non-existent skill', async () => {
    const { uninstallCustomGenre } = await loadRegistry()
    const result = uninstallCustomGenre('missing')
    expect(result).toBe(false)
  })
})
