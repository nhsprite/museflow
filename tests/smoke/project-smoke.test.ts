import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return listTypeScriptFiles(path)
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
    })
  )
  return nested.flat()
}

describe('project smoke test', () => {
  it('should load core modules without error', async () => {
    const mod = await import('../../src/types/story.ts')
    expect(mod).toBeDefined()
    expect(mod.STORY_STATUSES).toBeDefined()
  })

  it('keeps the README quick-start story example genre-neutral', async () => {
    const readme = await readFile(join(process.cwd(), 'README.md'), 'utf-8')
    const quickStartCommand = readme.match(/museflow start --idea .+/)?.[0] ?? ''

    expect(quickStartCommand).not.toMatch(/\b(xianxia|cultivation)\b/i)
    expect(quickStartCommand).toContain('--genre default')
  })

  it('keeps retired fixed narrative limits out of all source prompts', async () => {
    const repoRoot = process.cwd()
    const forbiddenPromptLimits = ['3-5 幕', '1–2 句描述（30–60 字）', '约 10% 以内']
    const sourceFiles = await listTypeScriptFiles(join(repoRoot, 'src'))
    const matches = (
      await Promise.all(
        sourceFiles.map(async (path) => {
          const source = await readFile(path, 'utf-8')
          return forbiddenPromptLimits
            .filter((snippet) => source.includes(snippet))
            .map((snippet) => `${relative(repoRoot, path)}: ${snippet}`)
        })
      )
    ).flat()

    expect(matches, `retired prompt limits found:\n${matches.join('\n')}`).toEqual([])
  })
})
