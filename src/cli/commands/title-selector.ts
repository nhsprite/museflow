import inquirer from 'inquirer'
import { createProvider } from '../../model/registry.js'
import { getGenreSkill } from '../../genres/registry.js'

export interface WorldDirection {
  cultivationSystem?: string
  coreConflict: string
  worldFeatures: string[]
}

export interface TitleOption {
  title: string
  worldDirection: WorldDirection
}

interface RawTitleOption {
  title?: unknown
  worldDirection?: {
    cultivationSystem?: unknown
    coreConflict?: unknown
    worldFeatures?: unknown[]
  }
}

const TITLE_SELECTION_PROMPT = `你是一位资深的书名策划师。根据以下故事概要，提供 3-5 个候选书名和对应的世界观方向。

故事概要：{idea}
总章节数：{totalChapters}
题材：{genre}

请以以下 JSON 格式返回：
[
  {
    "title": "书名1",
    "worldDirection": {
      "coreConflict": "核心冲突描述",
      "worldFeatures": ["特色1", "特色2", "特色3"]
    }
  },
  ...
]

要求：
- 书名要新颖、有吸引力、符合题材
- 世界观方向要各有特色，角度不同
- coreConflict 点出核心矛盾
- worldFeatures 列出 2-4 个独特的世界观元素
- 必须返回 3-5 个不同的候选方案
{conditionalCultivation}`

function getGenreConstraints(genre: string): string {
  const skill = getGenreSkill(genre)
  const displayName = skill?.displayName || genre

  if (skill?.constraints) {
    return `题材约束：这是${displayName}题材。${skill.constraints}`
  }

  return `题材约束：这是${displayName}题材，请确保世界观和冲突符合该题材的典型特征。`
}

function getConditionalCultivation(genre: string): string {
  if (genre === 'xianxia' || genre === 'fantasy') {
    return '- 每个候选方案可包含 cultivationSystem 字段描述修炼/魔法体系'
  }
  return ''
}

export async function generateTitleOptions(
  idea: string,
  genre: string,
  totalChapters: number
): Promise<TitleOption[]> {
  const provider = createProvider()
  const skill = getGenreSkill(genre)
  const displayName = skill?.displayName || genre

  const userContent = TITLE_SELECTION_PROMPT
    .replace('{idea}', idea)
    .replace('{totalChapters}', String(totalChapters))
    .replace('{genre}', `${genre}（${displayName}）`)
    .replace('{conditionalCultivation}', getConditionalCultivation(genre))

  const genreConstraint = getGenreConstraints(genre)

  const messages = [
    { role: 'system' as const, content: `你是一位资深的小说策划师，擅长起书名和构建世界观。\n\n${genreConstraint}` },
    { role: 'user' as const, content: userContent },
  ]

  const response = await provider.chat(messages, 0.8)

  let jsonStr = response.trim()

  const codeBlockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1]!.trim()
  }

  const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    throw new Error('无法从 AI 响应中解析标题选项')
  }

  let parsed: RawTitleOption[]
  try {
    parsed = JSON.parse(jsonMatch[0]) as RawTitleOption[]
  } catch {
    const cleaned = jsonMatch[0].replace(/"/g, '"').replace(/"/g, '"')
    parsed = JSON.parse(cleaned) as RawTitleOption[]
  }

  if (!Array.isArray(parsed) || parsed.length < 3) {
    throw new Error('AI 返回的标题选项数量不足')
  }

  return parsed.map((item: RawTitleOption): TitleOption => {
    const wd = item.worldDirection
    const worldDirection: WorldDirection = {
      coreConflict: String(wd?.coreConflict || ''),
      worldFeatures: Array.isArray(wd?.worldFeatures)
        ? wd.worldFeatures.map(String)
        : [],
    }
    if (wd?.cultivationSystem) {
      worldDirection.cultivationSystem = String(wd.cultivationSystem)
    }
    return {
      title: String(item.title || '未命名'),
      worldDirection,
    }
  })
}

export async function selectTitleOption(options: TitleOption[]): Promise<TitleOption> {
  const choices: Array<{ name: string; value: number } | InstanceType<typeof inquirer.Separator>> = [
    ...options.map((opt, index) => ({
      name: formatOptionForDisplay(opt, index + 1),
      value: index,
    })),
    new inquirer.Separator(),
    { name: '重新生成选项', value: -1 },
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const answer = await (inquirer.prompt as any)([
    {
      type: 'rawlist',
      name: 'selectedIndex',
      message: '请选择书名和世界观方向：',
      choices,
      pageSize: 10,
    },
  ])

  const selectedIndex = answer.selectedIndex as number

  if (selectedIndex === -1) {
    throw new Error('REGENERATE')
  }

  const selected = options[selectedIndex]
  if (!selected) {
    throw new Error('无效的选择')
  }

  return selected
}

function formatOptionForDisplay(option: TitleOption, number: number): string {
  const features = option.worldDirection.worldFeatures.join('、')
  const cultivation = option.worldDirection.cultivationSystem
  const cultivationLine = cultivation ? `修炼体系：${cultivation} | ` : ''
  return `${number}. ${option.title} | ${cultivationLine}核心冲突：${option.worldDirection.coreConflict} | 世界观特色：${features}`
}
