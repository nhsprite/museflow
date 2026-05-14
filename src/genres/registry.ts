import { existsSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { expandPath } from '../utils/paths.js'
import type { GenreSkill, GenreRegistryEntry } from '../types/genre.js'
import { createDefaultSkill, createFantasySkill, createXianxiaSkill, createSciFiSkill, createHorrorSkill, createMysterySkill, createUrbanSkill, createRomanceSkill } from './builtin/index.js'

let _registry: GenreRegistryEntry[] | null = null

export function getGenreRegistry(): GenreRegistryEntry[] {
  if (_registry) return _registry

  const builtin: GenreSkill[] = [
    createDefaultSkill(),
    createFantasySkill(),
    createXianxiaSkill(),
    createSciFiSkill(),
    createHorrorSkill(),
    createMysterySkill(),
    createUrbanSkill(),
    createRomanceSkill(),
  ]

  const entries: GenreRegistryEntry[] = builtin.map(skill => ({
    skill,
    source: 'builtin',
    path: '',
  }))

  const customDir = expandPath('~/.museflow/genres')
  if (existsSync(customDir)) {
    try {
      const customFiles = readdirSync(customDir).filter(f => f.endsWith('.json'))
      for (const file of customFiles) {
        try {
          const skill = JSON.parse(
            require('node:fs').readFileSync(join(customDir, file), 'utf-8')
          ) as GenreSkill
          const existing = entries.findIndex(e => e.skill.name === skill.name)
          if (existing >= 0) {
            entries[existing] = { skill, source: 'custom', path: join(customDir, file) }
          } else {
            entries.push({ skill, source: 'custom', path: join(customDir, file) })
          }
        } catch { /* skip invalid custom skill */ }
      }
    } catch { /* skip if custom dir unreadable */ }
  }

  _registry = entries
  return _registry
}

export function getGenreSkill(name: string): GenreSkill | null {
  const reg = getGenreRegistry()
  const entry = reg.find(e => e.skill.name === name)
  return entry?.skill ?? null
}

export function installCustomGenre(filePath: string): GenreSkill {
  const content = require('node:fs').readFileSync(filePath, 'utf-8')
  const skill = JSON.parse(content) as GenreSkill
  const customDir = expandPath('~/.museflow/genres')
  require('node:fs').mkdirSync(customDir, { recursive: true })
  const dest = join(customDir, `${skill.name}.json`)
  require('node:fs').writeFileSync(dest, content, 'utf-8')
  _registry = null
  return skill
}

export function uninstallCustomGenre(name: string): boolean {
  const reg = getGenreRegistry()
  const entry = reg.find(e => e.skill.name === name && e.source === 'custom')
  if (!entry) return false
  try {
    require('node:fs').unlinkSync(entry.path)
    _registry = null
    return true
  } catch {
    return false
  }
}
