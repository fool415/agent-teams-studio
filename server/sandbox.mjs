/**
 * Strict workspace path-boundary & tool sandbox for AgentTeams Studio autonomous execution.
 * Blocks path traversal, symlink escapes, .agent-teams internal state tampering, and outOfScope edits.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathMatchesScope } from './core/quality-gates.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const SCRAPLING_BRIDGE_PATH = join(MODULE_DIR, 'scrapling-bridge.py')
const PYTHON_CANDIDATES = [
  process.env.SCRAPLING_PYTHON,
  join(homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
  'python',
  'python3',
].filter(Boolean)

function resolvePythonExecutable() {
  for (const candidate of PYTHON_CANDIDATES) {
    if (candidate === 'python' || existsSync(candidate)) return candidate
  }
  return 'python'
}

function runScraplingBridge(payload, timeoutMs = 30000) {
  return new Promise((resolvePromise, rejectPromise) => {
    if (!existsSync(SCRAPLING_BRIDGE_PATH)) {
      rejectPromise(new Error(`Scrapling 桥接脚本不存在: ${SCRAPLING_BRIDGE_PATH}`))
      return
    }
    const pythonExe = resolvePythonExecutable()
    const child = spawn(pythonExe, [SCRAPLING_BRIDGE_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        // ignore kill error
      }
      rejectPromise(new Error(`scrapling_fetch 执行超时 (${timeoutMs}ms)`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectPromise(err)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const trimmed = stdout.trim()
      try {
        const parsed = trimmed ? JSON.parse(trimmed) : null
        if (parsed && typeof parsed === 'object') {
          if (parsed.ok) {
            resolvePromise(parsed)
          } else {
            rejectPromise(new Error(parsed.error || `scrapling_fetch 失败 (exit=${code})`))
          }
          return
        }
      } catch {
        // fall through to generic error
      }
      rejectPromise(
        new Error(
          `scrapling_fetch 输出解析失败 (exit=${code}): ${stderr.trim() || trimmed.slice(0, 300) || 'empty output'}`,
        ),
      )
    })

    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

const FORBIDDEN_WRITE_PREFIXES = ['.agent-teams', '.git', 'node_modules', 'secrets']

function normalizeRel(relPath) {
  return relPath.split(sep).join('/').replace(/^\.\/+/u, '')
}

function realpathThroughNearestAncestor(targetAbs) {
  const abs = resolve(targetAbs)
  const missing = []
  let probe = abs
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) break
    missing.unshift(probe.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
    probe = parent
  }
  const realBase = existsSync(probe) ? realpathSync(probe) : resolve(probe)
  return missing.length === 0 ? realBase : resolve(realBase, ...missing)
}

export function resolveSafeWorkspacePath(
  workspaceRoot,
  targetPath,
  { forWrite = false, outOfScope = [] } = {},
) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '' || targetPath.includes('\0')) {
    throw new Error('无效文件路径')
  }
  const realRoot = realpathSync(resolve(workspaceRoot))
  const trimmed = targetPath.trim()
  const candidate = isAbsolute(trimmed) ? resolve(trimmed) : resolve(realRoot, trimmed)
  const resolved = realpathThroughNearestAncestor(candidate)

  const relRaw = relative(realRoot, resolved)
  if (relRaw === '..' || relRaw.startsWith(`..${sep}`) || isAbsolute(relRaw)) {
    throw new Error(`安全拦截：禁止访问工作区外路径 (${targetPath})`)
  }
  const relPosix = normalizeRel(relRaw)

  if (forWrite) {
    if (relPosix === '' || relPosix === '.') {
      throw new Error('安全拦截：禁止直接覆写工作区根目录')
    }
    const baseName = relPosix.split('/').at(-1) || ''
    if (baseName === '.env' || baseName.startsWith('.env.')) {
      throw new Error(`安全拦截：禁止写入敏感环境文件 (${relPosix})`)
    }
    for (const prefix of FORBIDDEN_WRITE_PREFIXES) {
      if (relPosix === prefix || relPosix.startsWith(`${prefix}/`)) {
        throw new Error(`安全拦截：禁止修改受保护目录 (${prefix})`)
      }
    }
    for (const pattern of outOfScope) {
      if (pathMatchesScope(relPosix, String(pattern))) {
        throw new Error(`安全拦截：路径位于任务 outOfScope 范围 (${relPosix} matches ${pattern})`)
      }
    }
  }

  return { absPath: resolved, relPosix: relPosix || '.' }
}

function resolveBundledNpmCli() {
  const nodeDir = dirname(process.execPath)
  const candidates = [
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  return candidates.find((p) => existsSync(p)) || null
}

function rewriteCommandForWorkingNode(command) {
  const trimmed = command.trim()
  const npmCli = resolveBundledNpmCli()
  if (/^npm(\s|$)/i.test(trimmed) && npmCli) {
    const rest = trimmed.slice(3).trim()
    return `"${process.execPath}" "${npmCli}" ${rest}`.trim()
  }
  return trimmed
}

function killProcessTree(child) {
  if (!child || child.killed || !child.pid) return
  if (process.platform === 'win32') {
    try {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {})
      return
    } catch {
      // fall through
    }
  }
  try {
    child.kill('SIGTERM')
  } catch {}
}

function execCommandWithAbort(command, { cwd, timeoutMs = 25000, maxBuffer = 1024 * 1024, signal } = {}) {
  return new Promise((resolvePromise) => {
    if (signal?.aborted) {
      resolvePromise({ exitCode: 130, combinedOutput: '任务已取消，命令未执行' })
      return
    }
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const appendCapped = (prev, chunk) => {
      if (Buffer.byteLength(prev, 'utf8') >= maxBuffer) return prev
      return prev + chunk.toString('utf8')
    }
    const finish = (exitCode, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const combinedOutput = [stdout, stderr, extra].filter(Boolean).join('\n').trim()
      resolvePromise({ exitCode, combinedOutput })
    }
    const onAbort = () => {
      killProcessTree(child)
      finish(130, '命令已被用户取消')
    }
    const timer = setTimeout(() => {
      killProcessTree(child)
      finish(124, `命令执行超时 (${timeoutMs}ms)`)
    }, timeoutMs)

    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (chunk) => {
      stdout = appendCapped(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = appendCapped(stderr, chunk)
    })
    child.on('error', (err) => {
      finish(1, err instanceof Error ? err.message : String(err))
    })
    child.on('close', (code) => {
      finish(typeof code === 'number' ? code : 1)
    })
  })
}

export function createSandboxTools(workspaceRoot, { outOfScope = [], signal } = {}) {
  const realRoot = realpathSync(resolve(workspaceRoot))
  const changedPaths = new Set()
  const commandsRun = []

  const toolDefinitions = [
    {
      type: 'function',
      function: {
        name: 'list_dir',
        description: '列出工作区指定相对目录下的文件和子目录（禁止越界）。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作区路径，默认为 .' },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: '读取工作区内文本文件内容（最多返回前 8000 字符）。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作区文件路径' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: '写入工作区内文件（受限于 sandbox 与 outOfScope 白名单，禁止写入 .agent-teams 或 .env）。',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '相对工作区文件路径' },
            content: { type: 'string', description: '完整文件内容' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: '在工作区根目录执行验证或构建命令（如 node --test、npm run build 等）。',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的命令字符串' },
          },
          required: ['command'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'scrapling_fetch',
        description:
          '使用 Scrapling 引擎安全抓取外部公开网页/技术文档并转换为干净 Markdown（自动拦截内网/回环地址）。默认 fast 模式使用高匿 TLS 指纹；遇到反爬或 JS 动态渲染页面时切换 mode="stealth"。',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '要抓取的公开 http/https URL' },
            mode: {
              type: 'string',
              enum: ['fast', 'stealth'],
              description: 'fast（极速 TLS 伪装）或 stealth（无头隐身 Chrome 渲染），默认 fast',
            },
            cssSelector: {
              type: 'string',
              description: '可选 CSS 选择器，仅提取页面特定区域（如 main, article, .markdown-body）',
            },
            maxChars: {
              type: 'number',
              description: '返回正文最大字符数，默认 8000，上限 32000',
            },
          },
          required: ['url'],
        },
      },
    },
  ]

  async function executeTool(name, args = {}) {
    if (signal?.aborted) {
      throw new Error('任务已被用户取消')
    }
    if (name === 'list_dir') {
      const { absPath, relPosix } = resolveSafeWorkspacePath(realRoot, args.path || '.')
      if (!existsSync(absPath)) throw new Error(`目录不存在: ${relPosix}`)
      const items = readdirSync(absPath, { withFileTypes: true })
        .slice(0, 80)
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'dir' : 'file',
        }))
      return { path: relPosix, entries: items }
    }

    if (name === 'read_file') {
      const { absPath, relPosix } = resolveSafeWorkspacePath(realRoot, args.path)
      if (!existsSync(absPath)) throw new Error(`文件不存在: ${relPosix}`)
      const st = statSync(absPath)
      if (st.isDirectory()) throw new Error(`目标是目录而非文件: ${relPosix}`)
      const content = readFileSync(absPath, 'utf8')
      return {
        path: relPosix,
        bytes: Buffer.byteLength(content, 'utf8'),
        content: content.slice(0, 8000),
        truncated: content.length > 8000,
      }
    }

    if (name === 'write_file') {
      const { absPath, relPosix } = resolveSafeWorkspacePath(realRoot, args.path, {
        forWrite: true,
        outOfScope,
      })
      mkdirSync(dirname(absPath), { recursive: true })
      const realParent = realpathSync(dirname(absPath))
      const parentRel = relative(realRoot, realParent)
      if (parentRel === '..' || parentRel.startsWith(`..${sep}`) || isAbsolute(parentRel)) {
        throw new Error(`安全拦截：父目录符号链接越界 (${relPosix})`)
      }
      writeFileSync(absPath, String(args.content ?? ''), 'utf8')
      const actualPath = realpathSync(absPath)
      const actualRel = relative(realRoot, actualPath)
      if (actualRel === '..' || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) {
        throw new Error(`安全拦截：写入后符号链接越界 (${relPosix})`)
      }
      changedPaths.add(relPosix)
      return { ok: true, path: relPosix, bytes: Buffer.byteLength(String(args.content ?? ''), 'utf8') }
    }

    if (name === 'run_command') {
      const safeCwd = resolveSafeWorkspacePath(realRoot, '.').absPath
      const rawCommand = String(args.command ?? '').trim()
      if (rawCommand === '') throw new Error('command 不能为空')
      if (/(rm\s+-rf\s+\/|format\s+[a-z]:|del\s+\/s\s+\/q\s+C:\\)/i.test(rawCommand)) {
        throw new Error(`安全拦截：禁止执行高危系统命令`)
      }
      const actualCommand = rewriteCommandForWorkingNode(rawCommand)
      const { exitCode, combinedOutput } = await execCommandWithAbort(actualCommand, {
        cwd: safeCwd,
        timeoutMs: 25000,
        maxBuffer: 1024 * 1024,
        signal,
      })
      const evidence = combinedOutput.slice(0, 600) || `exit=${exitCode}`
      const record = {
        command: rawCommand,
        exitCode,
        status: exitCode === 0 ? 'passed' : 'failed',
        evidence,
      }
      commandsRun.push(record)
      return record
    }

    if (name === 'scrapling_fetch') {
      const rawUrl = String(args.url ?? '').trim()
      if (!rawUrl) throw new Error('url 不能为空')
      let parsed
      try {
        parsed = new URL(rawUrl)
      } catch {
        throw new Error(`无效 URL: ${rawUrl}`)
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`安全拦截：仅允许 http/https 协议 (${parsed.protocol})`)
      }
      const mode = args.mode === 'stealth' ? 'stealth' : 'fast'
      const cssSelector = typeof args.cssSelector === 'string' ? args.cssSelector.trim() : ''
      const maxChars = Number.isFinite(Number(args.maxChars)) ? Number(args.maxChars) : 8000
      return await runScraplingBridge({
        url: parsed.toString(),
        mode,
        cssSelector,
        maxChars,
      })
    }

    throw new Error(`未知沙箱工具: ${name}`)
  }

  return {
    toolDefinitions,
    executeTool,
    getChangedPaths: () => [...changedPaths],
    getCommandsRun: () => [...commandsRun],
  }
}
