import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { getStoryOutputDir } from '../../src/utils/paths.ts'

describe('story output paths', () => {
  it('builds title-based directories from normalized titles and stable short ids', () => {
    expect(getStoryOutputDir('story_mo3pbj1sabcdef', 'Hello 世界!!! / test')).toBe(
      join(process.cwd(), 'books', 'hello-世界-test-mo3pbj'),
    )
  })

  it('falls back to untitled when the title is missing or normalizes to blank', () => {
    expect(getStoryOutputDir('story_mo3pbj1sabcdef')).toBe(
      join(process.cwd(), 'books', 'untitled-mo3pbj'),
    )

    expect(getStoryOutputDir('story_mo3pbj1sabcdef', '!!!///***')).toBe(
      join(process.cwd(), 'books', 'untitled-mo3pbj'),
    )
  })
})
