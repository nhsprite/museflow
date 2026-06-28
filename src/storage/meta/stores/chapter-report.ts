import { join } from 'node:path'
import type { ChapterReport } from '../../../types/chapter-report.js'
import { writeFileAtomic, ensureDir } from '../../../utils/fs.js'

function getReportsDir(outputDir: string): string {
  return join(outputDir, 'reports')
}

function getChapterReportPath(outputDir: string, chapterIndex: number): string {
  return join(getReportsDir(outputDir), `chapter_${chapterIndex + 1}.report.json`)
}

export function saveChapterReport(outputDir: string, report: ChapterReport): void {
  const reportsDir = getReportsDir(outputDir)
  ensureDir(reportsDir)
  const path = getChapterReportPath(outputDir, report.chapterIndex)
  const data = JSON.stringify(report, null, 2)
  writeFileAtomic(path, data)
}


