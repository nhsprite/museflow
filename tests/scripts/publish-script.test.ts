import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('npm publish script wiring', () => {
  it('exposes release as the local npm publish command', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      scripts?: Record<string, string>
    }

    expect(pkg.scripts?.release).toBe('node scripts/release.js')
    expect(pkg.scripts).not.toHaveProperty('publish:npm')
  })

  it('allows the release script to publish non-interactively with provenance', () => {
    const script = readFileSync('scripts/release.js', 'utf-8')

    expect(script).toContain('--yes')
    expect(script).toContain('--provenance')
    expect(script).toContain('npm publish --access public')
  })

  it('uses the shared publish script from GitHub Actions', () => {
    const workflow = readFileSync('.github/workflows/npm-publish.yml', 'utf-8')

    expect(workflow).toContain('npm run release -- --yes --provenance')
    expect(workflow).not.toContain('npm publish --access public --provenance')
  })
})
