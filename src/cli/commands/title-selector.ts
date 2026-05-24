import inquirer from 'inquirer'
import { createProvider } from '../../model/registry.js'
import { getGenreSkill } from '../../genres/registry.js'
import type { JsonSchema } from '../../model/provider.js'

export interface WorldDirection {
  cultivationSystem?: string
  coreConflict: string
  worldFeatures: string[]
}

export interface TitleOption {
  title: string
  worldDirection: WorldDirection
}

const TITLE_OPTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '书名，要新颖、有吸引力、符合题材' },
          worldDirection: {
            type: 'object',
            properties: {
              coreConflict: { type: 'string', description: '核心冲突描述' },
              worldFeatures: {
                type: 'array',
                items: { type: 'string' },
                description: '2-4个独特的世界观元素',
              },
              cultivationSystem: { type: 'string', description: '修炼/魔法体系（可选）' },
            },
            required: ['coreConflict', 'worldFeatures'],
          },
        },
        required: ['title', 'worldDirection'],
      },
      description: '3-5个不同的候选方案',
    },
  },
  required: ['options'],
}

const TITLE_SELECTION_PROMPT = `你是一位资深的书名策划师。根据以下故事概要，提供 3-5 个候选书名和对应的世界观方向。

故事概要：{idea}
总章节数：{totalChapters}
题材：{genre}

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

  const parsed = await provider.chatStructured!<{ options: TitleOption[] }>(
    messages,
    TITLE_OPTION_SCHEMA,
    0.8
  )

  if (!Array.isArray(parsed.options) || parsed.options.length < 3) {
    throw new Error('AI 返回的标题选项数量不足')
  }

  return parsed.options
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
