import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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
})
