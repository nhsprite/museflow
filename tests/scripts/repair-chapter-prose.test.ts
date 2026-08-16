import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { repairChapterProse } from '../../scripts/repair-chapter-prose.js'

function buildStoryMemory() {
  return {
    version: '3',
    lastChapterIndex: 2,
    entities: {
      characters: {
        'c-25': { id: 'c-25', name: '殷温娇', locationId: null, status: {}, introducedIn: 0 },
      },
      items: {},
      locations: { 'l-1': { id: 'l-1', name: '京城', introducedIn: 0 } },
      factions: {},
      plots: {},
    },
    events: [],
    foreshadows: {},
    beats: {},
    tasks: {},
  }
}

describe('repair-chapter-prose script', () => {
  let storyDir: string

  beforeEach(() => {
    storyDir = mkdtempSync(join(tmpdir(), 'museflow-repair-prose-'))
    mkdirSync(join(storyDir, 'chapters'), { recursive: true })
    writeFileSync(join(storyDir, 'story-memory.json'), JSON.stringify(buildStoryMemory()), 'utf-8')
  })

  afterEach(() => {
    rmSync(storyDir, { recursive: true, force: true })
  })

  it('rewrites chapters with mechanically removable residue and reports the rest', async () => {
    writeFileSync(
      join(storyDir, 'chapters', 'chapter_1.md'),
      `# 第1章 进京\n\n殷温娇（c-25）走入京城（l-1）。\n`,
      'utf-8'
    )
    writeFileSync(
      join(storyDir, 'chapters', 'chapter_2.md'),
      `=== STORY_EVENTS ===\n- character-location: c-25 -> l-1 @p1\n\n# 第2章 夜访\n\n夜色深沉。\n`,
      'utf-8'
    )
    // 裸标识符与章节自指不可机械移除：只报告，不改写。
    writeFileSync(
      join(storyDir, 'chapters', 'chapter_3.md'),
      `# 第3章 旧档\n\n他写下 c-25 的编号，行程仍止于第1章寅时起。\n`,
      'utf-8'
    )

    const results = await repairChapterProse(storyDir, false)

    const chapter1 = readFileSync(join(storyDir, 'chapters', 'chapter_1.md'), 'utf-8')
    expect(chapter1).toBe('# 第1章 进京\n\n殷温娇走入京城。\n')

    const chapter2 = readFileSync(join(storyDir, 'chapters', 'chapter_2.md'), 'utf-8')
    expect(chapter2).toBe('# 第2章 夜访\n\n夜色深沉。\n')

    const chapter3 = readFileSync(join(storyDir, 'chapters', 'chapter_3.md'), 'utf-8')
    expect(chapter3).toContain('c-25')
    expect(chapter3).toContain('第1章')

    const byChapter = new Map(results.map((r) => [r.chapterNumber, r]))
    expect(byChapter.get(1)?.changed).toBe(true)
    expect(byChapter.get(1)?.remainingIssues).toEqual([])
    expect(byChapter.get(2)?.changed).toBe(true)
    expect(byChapter.get(2)?.remainingIssues).toEqual([])
    expect(byChapter.get(3)?.changed).toBe(false)
    expect(byChapter.get(3)?.remainingIssues.map((i) => i.code)).toEqual([
      'prose.internal-identifier',
      'prose.chapter-self-reference',
    ])
  })

  it('dry-run reports without rewriting chapter files', async () => {
    const contaminated = `=== STORY_EVENTS ===\n- character-location: c-25 -> l-1 @p1\n\n# 第1章 进京\n\n夜色深沉。\n`
    writeFileSync(join(storyDir, 'chapters', 'chapter_1.md'), contaminated, 'utf-8')

    const results = await repairChapterProse(storyDir, true)

    expect(results[0]?.changed).toBe(true)
    expect(readFileSync(join(storyDir, 'chapters', 'chapter_1.md'), 'utf-8')).toBe(contaminated)
  })

  it('leaves clean chapters untouched', async () => {
    const clean = `# 第1章 进京\n\n殷温娇走入京城。\n`
    writeFileSync(join(storyDir, 'chapters', 'chapter_1.md'), clean, 'utf-8')

    const results = await repairChapterProse(storyDir, false)

    expect(results[0]?.changed).toBe(false)
    expect(results[0]?.remainingIssues).toEqual([])
    expect(readFileSync(join(storyDir, 'chapters', 'chapter_1.md'), 'utf-8')).toBe(clean)
  })
})
