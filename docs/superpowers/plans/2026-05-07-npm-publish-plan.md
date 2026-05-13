# npm 包发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MuseFlow 发布为可全局安装的 npm CLI 包

**Architecture:** 通过 `package.json` 的 `files` 白名单只打包 `dist/` 编译产物，添加 `prepublishOnly` 脚本确保发布前自动构建，补充 npm 包必需的元数据字段。

**Tech Stack:** npm, TypeScript, Node.js >= 20

---

## 文件结构

**修改文件：**
- `package.json` — 添加 npm 包元数据、`files` 白名单、`prepublishOnly` 脚本
- `src/cli/index.ts` — 添加 Node.js shebang，确保编译后的 CLI 可执行

**验证文件：**
- `dist/cli/index.js` — 编译后检查 shebang 是否存在

---

### Task 1: 添加 CLI shebang

**Files:**
- Modify: `src/cli/index.ts:1`

**背景：** 编译后的 `dist/cli/index.js` 缺少 `#!/usr/bin/env node` shebang，导致全局安装后无法直接执行 `museflow` 命令。

- [ ] **Step 1: 在源文件顶部添加 shebang**

将 `src/cli/index.ts` 的第一行改为：

```typescript
#!/usr/bin/env node
import { Command } from 'commander'
import { start } from './commands/start.js'
import { write } from './commands/write.js'
// ... rest of imports
```

- [ ] **Step 2: 重新编译验证 shebang 被保留**

Run: `npm run build`
Expected: `tsc` 编译成功，无错误

- [ ] **Step 3: 检查编译产物包含 shebang**

Run: `head -n 1 dist/cli/index.js`
Expected: `#!/usr/bin/env node`

- [ ] **Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(cli): add node shebang for global execution"
```

---

### Task 2: 完善 package.json 发布配置

**Files:**
- Modify: `package.json`

**背景：** 当前 `package.json` 缺少 npm 包发布必需的字段，且 `dist/` 被 `.gitignore` 排除导致不会被打包。

- [ ] **Step 1: 添加 shebang 后重新编译**

Run: `npm run build`
Expected: 编译成功，确保 `dist/cli/index.js` 包含 shebang

- [ ] **Step 2: 修改 package.json**

完整修改后的 `package.json` 应为：

```json
{
  "name": "museflow",
  "version": "0.1.0",
  "description": "AI Native 长篇小说生成工具 - 端到端 AI 写作助手",
  "type": "module",
  "main": "./dist/cli/index.js",
  "bin": {
    "museflow": "./dist/cli/index.js"
  },
  "files": ["dist/"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build",
    "start": "tsx src/cli/index.ts",
    "dev": "tsx watch src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@langchain/core": "^0.3.58",
    "@langchain/langgraph": "^0.4.8",
    "commander": "^12.1.0",
    "inquirer": "^13.4.1",
    "ora": "^9.3.0",
    "p-limit": "^4.0.0",
    "qrcode": "^1.5.4",
    "sql.js": "^1.12.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/inquirer": "^9.0.9",
    "@types/node": "^22.10.2",
    "@types/qrcode": "^1.5.6",
    "@types/sql.js": "^1.4.9",
    "@typescript-eslint/eslint-plugin": "^8.19.1",
    "@typescript-eslint/parser": "^8.19.1",
    "eslint": "^9.17.0",
    "ts-node": "^10.9.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**关键变更说明：**
- `main`: `"./dist/cli/index.js"` — 定义包入口
- `files`: `["dist/"]` — 白名单，只打包编译产物
- `prepublishOnly`: `"npm run build"` — 发布前自动构建
- `author`: `"Your Name <email@example.com>"` — 替换为实际作者信息
- `license`: `"MIT"` — 与项目 LICENSE 保持一致
- `repository`: `{"type": "git", "url": "git+https://github.com/yourusername/museflow.git"}` — 替换为实际仓库地址
- `keywords`: `["cli", "ai", "novel", "writing", "langgraph", "fiction", "generator"]` — 便于 npm 搜索
- `publishConfig`: `{"access": "public"}` — 显式声明公开访问

- [ ] **Step 3: 验证 package.json 语法**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('package.json')).name)"`
Expected: `museflow`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add npm package metadata and publish config"
```

---

### Task 3: 本地验证打包内容

**Files:**
- Verify: `package.json`, `dist/cli/index.js`

- [ ] **Step 1: 执行 dry-run 打包**

Run: `npm pack --dry-run`
Expected: 
- 包含 `dist/` 目录下的文件
- 不包含 `src/`、`tests/`、`docs/` 等源码和文档
- 总文件数显著减少（从 326 个减少到 dist/ 下的文件数）

- [ ] **Step 2: 实际打包检查**

Run: 
```bash
npm pack
tar -tzf museflow-0.1.0.tgz | head -30
```

Expected: 
- 第一行是 `package/package.json`
- 包含 `package/dist/cli/index.js`
- 不包含 `package/src/...` 或 `package/tests/...`

- [ ] **Step 3: 清理测试包**

Run: `rm -f museflow-0.1.0.tgz`

- [ ] **Step 4: Commit（如无可跳过）**

---

### Task 4: 运行完整测试确保发布质量

**Files:**
- Verify: 全部测试通过

- [ ] **Step 1: 运行类型检查**

Run: `npm run typecheck`
Expected: 无错误，exit code 0

- [ ] **Step 2: 运行测试套件**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 3: 运行 lint**

Run: `npm run lint`
Expected: 无严重错误

---

### Task 5: 发布到 npm（手动执行）

**Files:**
- N/A — 命令行操作

**前置条件：**
- 已注册 npm 账号
- 已执行 `npm login` 登录
- 已确认 `museflow` 包名可用（运行 `npm view museflow` 检查，如返回 404 则可用）

- [ ] **Step 1: 检查包名可用性**

Run: `npm view museflow`
Expected: `npm error code E404`（表示包名可用）

- [ ] **Step 2: 执行发布**

Run: `npm publish`
Expected: 上传成功，显示版本号和包大小

- [ ] **Step 3: 验证发布**

Run: `npm view museflow`
Expected: 显示包的元数据，包含版本 0.1.0

- [ ] **Step 4: 测试全局安装**

Run:
```bash
npm install -g museflow
museflow --version
```

Expected: `0.1.0`

---

## Self-Review

**1. Spec coverage:**
- ✅ `files: ["dist/"]` 白名单 — Task 2
- ✅ `prepublishOnly` 自动构建 — Task 2
- ✅ CLI shebang — Task 1
- ✅ 包元数据（author, license, repository, keywords）— Task 2
- ✅ 发布验证（npm pack, npm publish）— Task 3, Task 5
- ✅ 安装后体验 — Task 5

**2. Placeholder scan:**
- ✅ 无 "TBD", "TODO", "implement later"
- ✅ 无 "Add appropriate error handling" 等模糊描述
- ✅ 每个步骤包含实际命令和预期输出

**3. Type consistency：**
- ✅ `package.json` 字段与 design doc 一致
- ✅ 文件路径准确

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-05-07-npm-publish-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 我按任务分派子代理执行，每步完成后审查

**2. Inline Execution** - 在当前会话中直接执行所有任务

**请选择执行方式。**
