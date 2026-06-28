import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'

export function writeFileAtomic(path: string, data: string): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, data, 'utf-8')
  renameSync(tmpPath, path)
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}
