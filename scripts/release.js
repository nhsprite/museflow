#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'
const PUBLISH_COMMAND = 'npm publish --access public'

function log(message) {
  console.log(`[release] ${message}`)
}

function success(message) {
  console.log(`${GREEN}[release] ✓ ${message}${RESET}`)
}

function error(message) {
  console.error(`${RED}[release] ✗ ${message}${RESET}`)
}

function warn(message) {
  console.warn(`${YELLOW}[release] ⚠ ${message}${RESET}`)
}

function run(command, options = {}) {
  log(`Running: ${command}`)
  return execSync(command, { stdio: 'inherit', ...options })
}

function parseArgs(argv) {
  const args = new Set(argv)
  return {
    yes: args.has('--yes') || args.has('-y'),
    provenance: args.has('--provenance'),
  }
}

function buildPublishCommand(options) {
  const args = [PUBLISH_COMMAND]
  if (options.provenance) {
    args.push('--provenance')
  }
  return args.join(' ')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  console.log('\n🚀 MuseFlow Release Script\n')

  const nodeVersion = process.version
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0])
  if (majorVersion < 20) {
    error(`Node.js >= 20 required, current: ${nodeVersion}`)
    process.exit(1)
  }
  success(`Node.js ${nodeVersion}`)

  try {
    execSync('npm whoami', { stdio: 'pipe' })
    success('npm login verified')
  } catch {
    error('Not logged in to npm. Run: npm login')
    process.exit(1)
  }

  try {
    execSync('npm view museflow --json', { stdio: 'pipe' })
    const pkg = JSON.parse(execSync('npm view museflow --json', { encoding: 'utf-8' }))
    warn(`Package exists (v${pkg.version}). This will be an update.`)
  } catch {
    success('Package name "museflow" is available')
  }

  console.log('')
  log('Step 1/4: TypeScript type check')
  try {
    run('npm run typecheck')
    success('Type check passed')
  } catch {
    error('Type check failed')
    process.exit(1)
  }

  console.log('')
  log('Step 2/4: Run test suite')
  try {
    run('npm test')
    success('All tests passed')
  } catch {
    error('Tests failed')
    process.exit(1)
  }

  console.log('')
  log('Step 3/4: Build TypeScript')
  try {
    run('npm run build')
    success('Build completed')
  } catch {
    error('Build failed')
    process.exit(1)
  }

  if (!existsSync('dist/cli/index.js')) {
    error('dist/cli/index.js not found after build')
    process.exit(1)
  }

  const fs = await import('node:fs')
  const firstLine = fs.readFileSync('dist/cli/index.js', 'utf-8').split('\n')[0]
  if (!firstLine.startsWith('#!/usr/bin/env node')) {
    error('Shebang missing in dist/cli/index.js')
    process.exit(1)
  }
  success('Shebang verified in dist/cli/index.js')

  console.log('')
  log('Step 4/4: Verify package contents')
  try {
    run('npm pack --dry-run')
    success('Package contents verified')
  } catch {
    error('Package verification failed')
    process.exit(1)
  }

  console.log('')
  console.log(`${GREEN}✓ All checks passed!${RESET}`)
  console.log('')
  log('Ready to publish. prepublishOnly will auto-build before upload.')
  console.log('')

  if (!options.yes) {
    const readline = await import('node:readline')
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    const answer = await new Promise((resolve) => {
      rl.question('Proceed with npm publish? [y/N] ', resolve)
    })
    rl.close()

    if (String(answer).toLowerCase().trim() !== 'y') {
      log('Publish cancelled')
      process.exit(0)
    }
  } else {
    log('Non-interactive publish confirmed by --yes')
  }

  console.log('')
  log('Publishing to npm...')
  try {
    run(buildPublishCommand(options))
    console.log('')
    success('🎉 Publish successful!')
    console.log('')
    log('Verify with: npm view museflow')
    log('Install with: npm install -g museflow')
  } catch {
    error('Publish failed')
    process.exit(1)
  }
}

main().catch((err) => {
  error(`Unexpected error: ${err.message}`)
  process.exit(1)
})
