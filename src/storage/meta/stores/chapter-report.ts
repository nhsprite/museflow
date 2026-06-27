import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChapterReport } from '../../../types/chapter-report.js'

function getReportsDir(outputDir: string): string {
  return join(outputDir, 'reports')
}

function getChapterReportPath(outputDir: string, chapterIndex: number): string {
  return join(getReportsDir(outputDir), `chapter_${chapterIndex + 1}.report.json`)
}

function writeFileAtomic(path: string, data: string): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, data, 'utf-8')
  renameSync(tmpPath, path)
}

export function saveChapterReport(outputDir: string, report: ChapterReport): void {
  const reportsDir = getReportsDir(outputDir)
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true })
  }
  const path = getChapterReportPath(outputDir, report.chapterIndex)
  const data = JSON.stringify(report, null, 2)
  writeFileAtomic(path, data)
}

export function readChapterReport(outputDir: string, chapterIndex: number): ChapterReport | null {
  const path = getChapterReportPath(outputDir, chapterIndex)
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as ChapterReport
  } catch {
    return null
  }
}

export function listChapterReports(outputDir: string): ChapterReport[] {
  const reportsDir = getReportsDir(outputDir)
  if (!existsSync(reportsDir)) return []

  const reports: ChapterReport[] = []
  const files = readdirSync(reportsDir).filter(f => f.endsWith('.report.json'))
  for (const file of files) {
    const match = file.match(/^chapter_(\d+)\.report\.json$/)
    if (!match) continue
    const chapterIndex = parseInt(match[1]!, 10) - 1
    const report = readChapterReport(outputDir, chapterIndex)
    if (report) {
      reports.push(report)
    }
  }
  return reports.sort((a, b) => a.chapterIndex - b.chapterIndex)
}
