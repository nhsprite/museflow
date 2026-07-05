#!/usr/bin/env node
import { Command } from 'commander'
import { start } from './commands/start.js'
import { write } from './commands/write.js'
import { rewrite } from './commands/rewrite.js'
import { cont } from './commands/continue.js'
import { status } from './commands/status.js'
import { info } from './commands/info.js'
import { config } from './commands/config.js'
import { genres } from './commands/genres.js'
import { exportStory } from './commands/export.js'
import { list } from './commands/list.js'
import { del } from './commands/delete.js'
import { adjustAct } from './commands/adjust-act.js'
import { registerMigrateMemoryCommand } from './commands/migrate-memory.js'
import { setDebugEnabled } from '../utils/logger.js'

const program = new Command()

program
  .name('museflow')
  .description('AI Native 长篇小说生成工具')
  .version('0.1.0')
  .option('-d, --debug', '显示 LLM 会话调试信息', false)
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts()
    if (opts.debug) {
      setDebugEnabled(true)
      process.env.MUSEFLOW_DEBUG = '1'
    }
  })

program
  .command('start')
  .description('开始一个新的故事（仅规划和创建）')
  .requiredOption('-i, --idea <text>', '故事简介')
  .requiredOption('-c, --chapters <number>', '章节数量', parseInt)
  .option('-g, --genre <name>', '题材类型', 'default')
  .option('-t, --title <text>', '故事标题（由 AI 自动生成，可不填）')
  .option('-p, --provider <name>', '模型协议 (openai|anthropic)', 'openai')
  .option('-y, --yes', '自动选择第一个标题选项（非交互模式）')
  .action(start)

program
  .command('write')
  .description('撰写故事正文（写完当前章后停止）')
  .argument('<story-id>', '故事ID')
  .action(write)

program
  .command('rewrite')
  .description('重写当前有问题的章节（彻底重写）')
  .argument('<story-id>', '故事ID')
  .option('-c, --chapter <number>', '指定要重写的章节编号')
  .allowExcessArguments(false)
  .action(rewrite)

program
  .command('continue')
  .description('继续一个未完成的故事')
  .argument('<story-id>', '故事ID')
  .option('-y, --yes', '自动确认重写请求')
  .option('-n, --no', '自动拒绝重写请求')
  .action(cont)

program
  .command('status')
  .description('查看故事进度')
  .argument('[story-id]', '故事ID')
  .action(status)

program
  .command('adjust-act')
  .description('手动调整幕边界')
  .argument('<story-id>', '故事ID')
  .requiredOption('--act <number>', '要调整的幕序号')
  .requiredOption('--end-chapter <number>', '新的结束章节')
  .action(adjustAct)

program
  .command('info')
  .description('查看故事详细信息')
  .argument('<story-id>', '故事ID（可选，当前故事）')
  .action(info)

program
  .command('config')
  .description('配置管理')
  .argument('[action]', '操作 (show|set|get)', 'show')
  .option('--provider <name>', '设置模型协议 (openai|anthropic)')
  .option('--model <name>', '设置模型名称')
  .option('--api-key <key>', '设置API密钥')
  .option('--base-url <url>', '设置API基础URL')
  .option('--auto-adjust-act-boundaries <boolean>', '自动调整幕边界 (true|false)')
  .action(config)

program
  .command('genres')
  .description('题材管理')
  .argument('[action]', '操作 (list|install|uninstall)', 'list')
  .argument('[name]', '题材名称')
  .option('--file <path>', '安装题材的文件路径')
  .action(genres)

program
  .command('export')
  .description('导出故事为 txt 文件')
  .argument('<story-id>', '故事ID')
  .action(exportStory)

program.command('list').description('列出所有书籍').alias('ls').action(list)

program
  .command('delete')
  .description('删除指定书籍')
  .argument('<story-id>', '故事ID')
  .option('-f, --force', '强制删除，不提示确认')
  .action(del)

registerMigrateMemoryCommand(program)

program.parse()
