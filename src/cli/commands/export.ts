import { getStory, initStoryDb } from '../../storage/database/dao/story.js'
import { getState } from '../../core/runner.js'
import { readChapterContent, listChapterFiles } from '../../storage/filesystem/writer.js'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import QRCode from 'qrcode'

interface ExportOptions {
  storyId: string
  format?: string
}

function hasChapterTitle(content: string, chapterNum: number): boolean {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  if (lines.length === 0) return false
  const firstLine = lines[0]
  if (!firstLine) return false
  return /^#{1,2}\s/.test(firstLine) || firstLine.includes(`第${chapterNum}章`) || firstLine.includes(`第 ${chapterNum} 章`)
}

function getLocalIp(): string | null {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue
    for (const info of net) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address
      }
    }
  }
  return null
}

async function startDownloadServer(filePath: string, fileName: string): Promise<{ url: string; server: ReturnType<typeof createServer> }> {
  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (req.url === `/${encodeURIComponent(fileName)}`) {
        try {
          const content = await readFile(filePath)
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
            'Content-Length': content.length,
          })
          res.end(content)
        } catch {
          res.writeHead(500)
          res.end('Error reading file')
        }
      } else {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    server.listen(0, '0.0.0.0', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const ip = getLocalIp() || 'localhost'
        const url = `http://${ip}:${address.port}/${encodeURIComponent(fileName)}`
        resolve({ url, server })
      } else {
        reject(new Error('Failed to get server address'))
      }
    })

    server.on('error', reject)
  })
}

export async function exportStory(storyId: string, _options: ExportOptions): Promise<void> {
  await initStoryDb()
  const story = getStory(storyId)
  if (!story) {
    console.error(`[MuseFlow] 错误: 故事 "${storyId}" 不存在`)
    process.exit(1)
  }

  const state = await getState(storyId)
  if (!state) {
    console.error('[MuseFlow] 错误: 无法获取故事状态')
    process.exit(1)
  }

  const storyDir = story.outputDir
  const exportDir = resolve('output')
  const chapterNumbers = await listChapterFiles(storyDir)

  if (chapterNumbers.length === 0) {
    console.error('[MuseFlow] 错误: 未找到章节文件')
    process.exit(1)
  }

  if (!existsSync(exportDir)) {
    await mkdir(exportDir, { recursive: true })
  }

  console.log(`[MuseFlow] 导出故事: ${story.title}`)
  console.log(`  章节数: ${chapterNumbers.length}/${state.totalChapters}`)

  const lines: string[] = []

  lines.push(story.title)
  lines.push('')
  lines.push(`简介: ${story.idea}`)
  lines.push(`题材: ${story.genre}`)
  lines.push(`章节数: ${chapterNumbers.length}`)
  lines.push('')
  lines.push('='.repeat(60))
  lines.push('')

  for (const chapterNum of chapterNumbers) {
    const content = await readChapterContent(storyDir, chapterNum)
    if (!content) continue

    const outlineItem = state.outline[chapterNum - 1]
    const chapterTitle = outlineItem?.title || `第${chapterNum}章`

    lines.push(`第 ${chapterNum} 章: ${chapterTitle}`)
    lines.push('')

    const trimmedContent = content.trim()
    if (!hasChapterTitle(trimmedContent, chapterNum)) {
      lines.push(`# 第${chapterNum}章 ${chapterTitle}`)
      lines.push('')
    }

    lines.push(trimmedContent)
    lines.push('')
    lines.push('='.repeat(60))
    lines.push('')
  }

  const fileName = `${story.title || 'story'}_${storyId.slice(0, 8)}.txt`
  const filePath = join(exportDir, fileName)
  await writeFile(filePath, lines.join('\n'), 'utf-8')

  const totalChars = lines.join('').length

  console.log(`\n[MuseFlow] 导出完成`)
  console.log(`  文件: ${filePath}`)
  console.log(`  章节: ${chapterNumbers.length} 章`)
  console.log(`  字数: 约 ${totalChars} 字符`)

  const { url, server } = await startDownloadServer(filePath, fileName)

  console.log(`\n[MuseFlow] 下载二维码`)
  console.log(`  下载链接: ${url}`)
  console.log(`\n请用手机扫描下方二维码下载文件`)
  console.log(`按 Ctrl+C 关闭下载服务器\n`)

  const qrTerminal = await QRCode.toString(url, { type: 'terminal', small: true })
  console.log(qrTerminal)

  process.on('SIGINT', () => {
    console.log('\n[MuseFlow] 关闭下载服务器')
    server.close()
    process.exit(0)
  })
}
