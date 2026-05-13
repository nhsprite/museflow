# npm 包发布设计

## 背景

MuseFlow 当前是一个本地运行的 CLI 工具，用户需要克隆仓库、安装依赖、手动编译后才能使用。为了降低使用门槛，需要将项目发布为可全局安装的 npm 包，用户只需运行 `npm install -g museflow` 即可使用。

## 现状分析

### 当前配置
- `package.json` 已配置 `bin: { "museflow": "./dist/cli/index.js" }`
- `dist/` 目录存在于本地，但列在 `.gitignore` 中
- 没有 `.npmignore` 文件
- 缺少 `author`、`repository`、`keywords` 等 npm 包元数据
- 缺少 `prepublishOnly` 脚本确保发布前构建

### 核心问题
1. `npm pack` 不会包含 `dist/`（因为 `.gitignore` 排除了它）
2. 发布的包会包含 326 个文件（源码 + 测试），体积过大
3. 没有自动化构建保障，可能发布过时的编译产物
4. 缺少必要的 npm 包元数据

## 设计目标

- 用户可通过 `npm install -g museflow` 全局安装
- 安装后可直接运行 `museflow <command>`
- 发布的包只包含必要的编译产物
- 发布流程简单可靠

## 方案

### 方案 A：最小化配置（选定方案）

仅修复发布必需的配置问题，快速上线。

**优点**：改动最小，最快可发布。  
**缺点**：缺少自动化，每次发布需手动操作。

### 方案 B：完整 npm 包规范（未选）

增加 CHANGELOG、CI 自动发布等工程化规范。因项目当前阶段不需要，暂不实施。

### 方案 C：Scoped 包（未选）

发布为 `@username/museflow`。因 `museflow` 包名可用，保持简单名称。

## 详细设计

### 1. package.json 修改

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
  "author": "Your Name <email@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/yourusername/museflow.git"
  },
  "keywords": ["cli", "ai", "novel", "writing", "langgraph", "fiction", "generator"],
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**关键字段说明**：

- **`files: ["dist/"]`**：白名单机制，只打包编译后的 `dist/` 目录，排除源码、测试、文档等
- **`prepublishOnly`**：在 `npm publish` 前自动执行 `npm run build`，确保发布的是最新编译产物
- **`main`**：定义包的入口点，当其他项目 `require('museflow')` 时使用
- **`publishConfig.access: "public"`**：如果是 scoped 包则必需；非 scoped 包默认就是 public，显式声明更安全
- **元数据**：`author`、`license`、`repository`、`keywords` 是 npm 包的标配，有助于搜索发现和包信息展示

### 2. Shebang 检查

需要验证 `dist/cli/index.js` 文件第一行是否包含 Node.js shebang：

```js
#!/usr/bin/env node
```

如果缺失，需要在 `src/cli/index.ts` 顶部添加该注释。TypeScript 编译器会将其保留在输出文件中。

验证方式：
```bash
head -n 1 dist/cli/index.js
```

### 3. 发布流程

```bash
# 1. 确保所有测试通过
npm test

# 2. 类型检查
npm run typecheck

# 3. 本地验证打包内容（确认只包含 dist/）
npm pack --dry-run

# 4. 实际打包并检查 tarball
npm pack
tar -tzf museflow-0.1.0.tgz

# 5. 登录 npm（如未登录）
npm login

# 6. 发布
npm publish
```

### 4. 用户安装体验

发布后，用户安装和使用方式：

```bash
# 全局安装
npm install -g museflow

# 验证安装
museflow --version
# 输出: 0.1.0

# 使用
museflow start --idea "一个少年获得修真能力后崛起为最强者的故事" --chapters 30 --genre xianxia
```

## 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| 包名 `museflow` 已被占用 | 中 | 高 | 先执行 `npm view museflow` 检查；如被占用，改用 scoped 包 `@yourname/museflow` |
| dist/ 缺少 shebang | 低 | 高 | 发布前检查 `head -n 1 dist/cli/index.js` |
| 构建产物过大 | 低 | 中 | `files` 白名单只包含 dist/，排除源码和依赖 |
| 用户 Node 版本低于 20 | 中 | 中 | `engines` 字段已声明要求，安装时会警告 |

## 后续迭代

- 添加 `CHANGELOG.md` 记录版本变更
- 设置 GitHub Actions 实现 tag 推送时自动发布
- 考虑添加 `postinstall` 脚本提示用户配置 API key
