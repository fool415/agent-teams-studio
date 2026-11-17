#!/usr/bin/env node

/**
 * AgentTeams Studio — Windows Native Desktop Build & Assembly Script
 * (1:1 CPA Desktop Benchmark)
 *
 * Steps:
 * 1. Build Vite web assets (`dist/`)
 * 2. Compile `desktop/AgentTeamsStudio.cs` -> `AgentTeamsStudio.exe` with csc.exe
 * 3. Assemble portable package in `dist-desktop/AgentTeamsStudio/`
 *    - `AgentTeamsStudio.exe`
 *    - `studio-core/` (`bin/`, `server/`, `dist/`, `package.json`)
 *    - `config.toml`, `theme-selection.json`, `portable-app.json`, `core-version.txt`
 *    - `agent-usage/`, `usage-records/`
 * 4. Create desktop shortcut (`~/Desktop/AgentTeams Studio.lnk`)
 * 5. Verify PE header (`MZ`) and artifact completeness if `--verify` is passed.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, '..')

const CSC_PATHS = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
]

function findCsc() {
  for (const p of CSC_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

function run(cmd, desc) {
  process.stdout.write(`\n[Build] ${desc}...\n> ${cmd}\n`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}

function createDesktopShortcut(targetExe, shortcutPath) {
  try {
    const script = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${shortcutPath.replace(/'/g, "''")}'); $s.TargetPath = '${targetExe.replace(/'/g, "''")}'; $s.WorkingDirectory = '${dirname(targetExe).replace(/'/g, "''")}'; $s.Description = 'AgentTeams Studio 桌面端控制中心'; $s.Save();`
    execSync(`powershell -NoProfile -Command "${script}"`, { stdio: 'ignore' })
    return existsSync(shortcutPath)
  } catch (err) {
    console.warn(`[Build] 创建桌面快捷方式跳过或警告: ${err.message}`)
    return false
  }
}

async function main() {
  const isVerify = process.argv.includes('--verify')
  console.log('🐾 [AgentTeams Studio] 启动 Windows 原生桌面端构建流水线...')

  // 1. Build web assets
  run('node ./node_modules/vite/bin/vite.js build', '构建 Vite 客户端静态资产')

  // 2. Find csc.exe & compile desktop host
  const csc = findCsc()
  if (!csc) {
    throw new Error('未找到 Microsoft .NET Framework csc.exe 编译器！')
  }

  const csSource = join(ROOT, 'desktop', 'AgentTeamsStudio.cs')
  const appIconPath = join(ROOT, 'desktop', 'app-icon.ico')
  const rootExe = join(ROOT, 'AgentTeamsStudio.exe')
  const webviewVendor = join(ROOT, 'desktop', 'webview2', 'vendor')
  const coreDll = join(webviewVendor, 'Microsoft.Web.WebView2.Core.dll')
  const winformsDll = join(webviewVendor, 'Microsoft.Web.WebView2.WinForms.dll')
  const loaderDll = join(webviewVendor, 'WebView2Loader.dll')

  for (const requiredDll of [coreDll, winformsDll, loaderDll]) {
    if (!existsSync(requiredDll)) {
      throw new Error(`缺少 WebView2 依赖库: ${requiredDll}`)
    }
  }

  const iconFlag = existsSync(appIconPath) ? `/win32icon:"${appIconPath}"` : ''
  run(
    `"${csc}" /target:winexe /platform:x64 /optimize ${iconFlag} /r:"${coreDll}" /r:"${winformsDll}" /out:"${rootExe}" "${csSource}"`,
    '编译 Windows 原生无黑框 WebView2 桌面宿主 AgentTeamsStudio.exe'
  )

  // Copy WebView2 runtime DLLs alongside root AgentTeamsStudio.exe
  for (const dllName of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']) {
    cpSync(join(webviewVendor, dllName), join(ROOT, dllName))
  }

  // 3. Assemble dist-desktop/AgentTeamsStudio/
  const distDesktop = join(ROOT, 'dist-desktop', 'AgentTeamsStudio')
  mkdirSync(distDesktop, { recursive: true })

  // Copy root exe & WebView2 dependencies
  const targetExe = join(distDesktop, 'AgentTeamsStudio.exe')
  cpSync(rootExe, targetExe)
  for (const dllName of ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll']) {
    cpSync(join(webviewVendor, dllName), join(distDesktop, dllName))
  }

  // Copy metadata & config
  const filesToCopy = ['config.toml', 'theme-selection.json', 'portable-app.json', 'core-version.txt']
  for (const f of filesToCopy) {
    const src = join(ROOT, f)
    if (existsSync(src)) {
      cpSync(src, join(distDesktop, f))
    }
  }

  // Ensure usage dirs
  mkdirSync(join(distDesktop, 'agent-usage'), { recursive: true })
  mkdirSync(join(distDesktop, 'usage-records'), { recursive: true })

  // Assemble studio-core/
  const studioCoreDir = join(distDesktop, 'studio-core')
  mkdirSync(studioCoreDir, { recursive: true })
  cpSync(join(ROOT, 'bin'), join(studioCoreDir, 'bin'), { recursive: true })
  cpSync(join(ROOT, 'server'), join(studioCoreDir, 'server'), { recursive: true })
  cpSync(join(ROOT, 'dist'), join(studioCoreDir, 'dist'), { recursive: true })
  mkdirSync(join(studioCoreDir, 'channels', 'cpa'), { recursive: true })
  for (const cpaFile of ['cpa-channel-manager.mjs', 'cpa-mcp-server.mjs', 'easycli_mcp_server.py', 'config.example.toml']) {
    const src = join(ROOT, 'channels', 'cpa', cpaFile)
    if (existsSync(src)) {
      cpSync(src, join(studioCoreDir, 'channels', 'cpa', cpaFile))
    }
  }
  mkdirSync(join(studioCoreDir, 'channels', 'qqbot'), { recursive: true })
  for (const qqFile of ['qq-gateway.mjs', 'qq-store.mjs', 'qq-remote-service.mjs']) {
    const src = join(ROOT, 'channels', 'qqbot', qqFile)
    if (existsSync(src)) {
      cpSync(src, join(studioCoreDir, 'channels', 'qqbot', qqFile))
    }
  }
  if (existsSync(join(ROOT, 'channels', 'grokbot'))) {
    cpSync(join(ROOT, 'channels', 'grokbot'), join(studioCoreDir, 'channels', 'grokbot'), { recursive: true })
  }
  if (existsSync(join(ROOT, 'integrations'))) {
    cpSync(join(ROOT, 'integrations'), join(studioCoreDir, 'integrations'), { recursive: true })
  }
  if (existsSync(join(ROOT, 'public'))) {
    cpSync(join(ROOT, 'public'), join(studioCoreDir, 'public'), { recursive: true })
  }
  if (existsSync(join(ROOT, 'docs', 'runbooks'))) {
    cpSync(join(ROOT, 'docs', 'runbooks'), join(studioCoreDir, 'docs', 'runbooks'), { recursive: true })
  }
  if (existsSync(join(ROOT, 'package.json'))) {
    cpSync(join(ROOT, 'package.json'), join(studioCoreDir, 'package.json'))
  }

  // 4. Create Desktop Shortcut
  const userHome = process.env.USERPROFILE || homedir()
  const desktopDir = join(userHome, 'Desktop')
  const shortcutPath = join(desktopDir, 'AgentTeams Studio.lnk')
  if (existsSync(desktopDir)) {
    const ok = createDesktopShortcut(targetExe, shortcutPath)
    if (ok) {
      console.log(`[Build] 桌面快捷方式已创建: ${shortcutPath}`)
    }
  }

  // 5. Verification
  console.log('\n======================================================')
  console.log('🎉 [AgentTeams Studio] 桌面端打包与产物组装完成！')
  console.log(`- 根目录二进制: ${rootExe}`)
  console.log(`- 独立便携目录: ${distDesktop}`)
  console.log('======================================================\n')

  if (isVerify) {
    console.log('🔍 [Verify] 开始执行 PE 头与产物完整性自检...')

    // Check PE header
    const buf = readFileSync(targetExe)
    const isMz = buf[0] === 0x4d && buf[1] === 0x5a
    if (!isMz) {
      throw new Error(`PE 校验失败：${targetExe} 不是标准的 MZ Windows 可执行文件！`)
    }
    console.log(`✅ PE 格式验证通过: MZ header confirmed (size: ${buf.length} bytes)`)

    // Check directory completeness
    const requiredItems = [
      'AgentTeamsStudio.exe',
      'Microsoft.Web.WebView2.Core.dll',
      'Microsoft.Web.WebView2.WinForms.dll',
      'WebView2Loader.dll',
      'config.toml',
      'portable-app.json',
      'core-version.txt',
      'agent-usage',
      'usage-records',
      'studio-core',
      'studio-core/bin/agent-teams-studio.mjs',
      'studio-core/server/index.mjs',
      'studio-core/channels/qqbot/qq-gateway.mjs',
      'studio-core/channels/qqbot/qq-store.mjs',
      'studio-core/channels/qqbot/qq-remote-service.mjs',
      'studio-core/dist/index.html',
    ]

    for (const item of requiredItems) {
      const p = join(distDesktop, item)
      if (!existsSync(p)) {
        throw new Error(`产物缺失验证失败: ${p}`)
      }
      console.log(`✅ 校验产物存在: ${item}`)
    }

    console.log('\n💎 [Verify] 全部 PE 头与便携式产物清单 100% 验证通过喵！🐾✨')
  }
}

main().catch((err) => {
  console.error('\n❌ [Build Error]:', err)
  process.exit(1)
})
