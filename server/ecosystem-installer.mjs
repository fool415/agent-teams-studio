/**
 * AgentTeams Studio Multi-Ecosystem Installer & Doctor (Antigravity + Codex + DSH + CPA).
 * Generated with EasyCLIProxyAPI (gpt-6.1-sol) and integrated into AgentTeams Studio.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { discoverLocalCpaInstall } from '../channels/cpa/cpa-channel-manager.mjs'

const exists = fs.existsSync
const pluginNames = ['agent-teams-studio', 'dsh-agent-teams']

const readJsonSafe = (file) => {
  if (!exists(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

const formatJson = (value) => `${JSON.stringify(value, null, 2)}\n`

export function inspectEcosystemStatus({
  projectRoot = process.cwd(),
  workspaceRoot = process.cwd(),
  homeDir = os.homedir(),
} = {}) {
  const geminiDir = path.join(homeDir, '.gemini')
  const codexDir = path.join(homeDir, '.codex')
  const configTomlPath = path.join(codexDir, 'config.toml')
  const toml = exists(configTomlPath) ? fs.readFileSync(configTomlPath, 'utf8') : ''
  const teamsDir = path.join(workspaceRoot, '.agent-teams')
  let teamsDirectoryExists = false
  try {
    teamsDirectoryExists = exists(teamsDir) && fs.statSync(teamsDir).isDirectory()
  } catch {
    teamsDirectoryExists = false
  }

  let codexCliInstalled = false
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which'
    codexCliInstalled = spawnSync(checkCmd, ['codex'], { stdio: 'ignore', windowsHide: true }).status === 0
  } catch {
    codexCliInstalled = false
  }

  return {
    antigravity: {
      geminiDir,
      studioPluginInstalled: exists(
        path.join(geminiDir, 'config', 'plugins', 'agent-teams-studio', 'plugin.json'),
      ),
      dshPluginInstalled: exists(
        path.join(geminiDir, 'config', 'plugins', 'dsh-agent-teams', 'plugin.json'),
      ),
      mcpConfigPath: path.join(geminiDir, 'config', 'mcp_config.json'),
    },
    codex: {
      codexDir,
      configTomlPath,
      mcpConfigured: /agent_teams_studio|agent-teams-studio/u.test(toml),
      skillInstalled: exists(path.join(codexDir, 'skills', 'agent-teams-studio', 'SKILL.md')),
      codexCliInstalled,
    },
    dsh: {
      teamsDir,
      installed: teamsDirectoryExists,
      bridgeInstalled: exists(path.join(teamsDir, '.studio-bridge.json')),
      activeTeamCount: teamsDirectoryExists
        ? fs
            .readdirSync(teamsDir, { withFileTypes: true })
            .filter(
              (entry) =>
                entry.isDirectory() &&
                !entry.name.startsWith('.') &&
                entry.name !== 'archive',
            ).length
        : 0,
    },
    cpa: discoverLocalCpaInstall({ projectRoot }),
  }
}

export function installEcosystemTargets({
  projectRoot = process.cwd(),
  workspaceRoot = process.cwd(),
  homeDir = os.homedir(),
  targets = ['antigravity', 'codex', 'dsh'],
  dryRun = false,
} = {}) {
  const resolvedProject = path.resolve(projectRoot)
  const resolvedWorkspace = path.resolve(workspaceRoot)
  const geminiDir = path.join(homeDir, '.gemini')
  const codexDir = path.join(homeDir, '.codex')

  const rawTargets = Array.isArray(targets) ? targets : [targets]
  const selected = [
    ...new Set(
      rawTargets.flatMap((t) =>
        t === 'all' ? ['antigravity', 'codex', 'dsh'] : [String(t).trim().toLowerCase()],
      ),
    ),
  ].filter((t) => ['antigravity', 'codex', 'dsh'].includes(t))

  if (selected.length === 0) {
    selected.push('antigravity', 'codex', 'dsh')
  }

  const actions = []
  const perform = (description, operation) => {
    actions.push(description)
    if (!dryRun) operation()
  }

  const writeText = (file, contents) =>
    perform(`Write ${file}`, () => {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, contents, 'utf8')
    })

  const studioMcpScript = path.join(resolvedProject, 'server', 'studio-mcp-server.mjs')
  const dshMcpScript = path.join(
    resolvedProject,
    'integrations',
    'plugins',
    'dsh-agent-teams',
    'server',
    'mcp-server.mjs',
  )
  const cpaMcpScript = path.join(resolvedProject, 'channels', 'cpa', 'cpa-mcp-server.mjs')

  const resolvedServers = {
    'agent-teams-studio': {
      command: process.execPath,
      args: [studioMcpScript],
      env: {
        STUDIO_PORT: '4317',
        STUDIO_MIRROR_PORT: '4318',
      },
    },
    'dsh-agent-teams': {
      command: process.execPath,
      args: [dshMcpScript],
      env: {},
    },
    'easycli-gpt': {
      command: process.execPath,
      args: [cpaMcpScript],
      env: {
        CPA_BASE_URL: 'http://127.0.0.1:8317/v1',
      },
    },
  }

  if (selected.includes('antigravity')) {
    for (const pluginName of pluginNames) {
      const source = path.join(resolvedProject, 'integrations', 'plugins', pluginName)
      if (!exists(path.join(source, 'plugin.json'))) continue
      const destination = path.join(geminiDir, 'config', 'plugins', pluginName)
      perform(`Sync plugin ${pluginName} -> ${destination}`, () => {
        fs.mkdirSync(path.dirname(destination), { recursive: true })
        fs.cpSync(source, destination, { recursive: true, force: true })
      })

      const pluginMcp =
        pluginName === 'agent-teams-studio'
          ? {
              mcpServers: {
                'agent-teams-studio': resolvedServers['agent-teams-studio'],
                'easycli-gpt': resolvedServers['easycli-gpt'],
              },
            }
          : {
              mcpServers: {
                'dsh-agent-teams': {
                  command: process.execPath,
                  args: [path.join(destination, 'server', 'mcp-server.mjs')],
                  env: {},
                },
              },
            }
      writeText(path.join(destination, 'mcp_config.json'), formatJson(pluginMcp))
    }

    const globalMcpPath = path.join(geminiDir, 'config', 'mcp_config.json')
    const currentMcp = readJsonSafe(globalMcpPath)
    writeText(
      globalMcpPath,
      formatJson({
        ...currentMcp,
        mcpServers: {
          ...(currentMcp.mcpServers || {}),
          ...resolvedServers,
        },
      }),
    )
  }

  if (selected.includes('codex')) {
    const skillSrc = [
      path.join(resolvedProject, 'integrations', 'codex', 'skills', 'agent-teams-studio', 'SKILL.md'),
      path.join(
        resolvedProject,
        'integrations',
        'plugins',
        'agent-teams-studio',
        'skills',
        'studio',
        'SKILL.md',
      ),
    ].find(exists)

    if (skillSrc) {
      writeText(
        path.join(codexDir, 'skills', 'agent-teams-studio', 'SKILL.md'),
        fs.readFileSync(skillSrc, 'utf8'),
      )
    }

    const dshSkillSrc = path.join(
      resolvedProject,
      'integrations',
      'plugins',
      'dsh-agent-teams',
      'skills',
      'agent-teams',
      'SKILL.md',
    )
    if (exists(dshSkillSrc)) {
      writeText(
        path.join(codexDir, 'skills', 'agent-teams', 'SKILL.md'),
        fs.readFileSync(dshSkillSrc, 'utf8'),
      )
    }

    const configTomlPath = path.join(codexDir, 'config.toml')
    const previous = exists(configTomlPath) ? fs.readFileSync(configTomlPath, 'utf8') : ''
    const beginMarker = '# --- BEGIN AGENT-TEAMS-STUDIO ---'
    const endMarker = '# --- END AGENT-TEAMS-STUDIO ---'
    const blocks = Object.entries(resolvedServers).map(([name, server]) => {
      const tomlKey = name.replaceAll('-', '_')
      return `[mcp_servers.${tomlKey}]\ncommand = ${JSON.stringify(server.command)}\nargs = ${JSON.stringify(server.args)}`
    })
    const cleaned = previous.replace(
      /# --- BEGIN AGENT-TEAMS-STUDIO ---[\s\S]*?# --- END AGENT-TEAMS-STUDIO ---\r?\n?/gu,
      '',
    )
    const nextToml = `${cleaned.trimEnd()}\n\n${beginMarker}\n${blocks.join('\n\n')}\n${endMarker}\n`.replace(
      /^\n+/u,
      '',
    )
    writeText(configTomlPath, nextToml)
  }

  if (selected.includes('dsh')) {
    const bridgePath = path.join(resolvedWorkspace, '.agent-teams', '.studio-bridge.json')
    writeText(
      bridgePath,
      formatJson({
        bridge: 'agent-teams-studio',
        version: '2.0.0',
        projectRoot: resolvedProject,
        workspaceRoot: resolvedWorkspace,
        updatedAt: new Date().toISOString(),
        endpoints: {
          studioWeb: 'http://127.0.0.1:4317',
          dshPluginRest: 'http://127.0.0.1:4317/plugins/dsh-agent-teams',
          cpaGateway: 'http://127.0.0.1:8317/v1',
        },
      }),
    )
  }

  return {
    ok: true,
    dryRun,
    targets: selected,
    actions,
    status: inspectEcosystemStatus({ projectRoot: resolvedProject, workspaceRoot: resolvedWorkspace, homeDir }),
  }
}
