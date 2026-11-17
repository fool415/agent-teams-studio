/**
 * Task-level Git Worktree isolation manager for AgentTeams Studio (inspired by T3 Code).
 * Enables concurrent agent tasks to edit and test inside isolated branches/worktrees,
 * inspect diffs, and safely merge back to the primary workspace.
 * Falls back gracefully when the workspace is not a Git repository.
 */

import { execFile as execFileCallback } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFileCallback)

function sanitizeSegment(raw, fallback = 'item') {
  const cleaned = String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return cleaned || fallback
}

async function runGit(cwd, args, { timeoutMs = 15000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    })
    return { ok: true, code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }
  } catch (err) {
    return {
      ok: false,
      code: typeof err?.code === 'number' ? err.code : 1,
      stdout: String(err?.stdout ?? ''),
      stderr: String(err?.stderr ?? err?.message ?? ''),
    }
  }
}

function assertWorktreePathInsideRoot(workspaceRoot, worktreePath) {
  const realRoot = realpathSync(resolve(workspaceRoot))
  const expectedParent = resolve(realRoot, '.agent-teams', 'worktrees')
  const candidate = resolve(worktreePath)
  const rel = relative(expectedParent, candidate)
  if (!rel || rel === '.' || rel === '..' || rel.startsWith(`..${sep}`) || rel.includes(':') || rel.startsWith(sep)) {
    throw new Error(`安全拦截：worktree 路径越界 (${worktreePath})`)
  }
  return candidate
}

export async function isGitRepo(workspaceRoot) {
  const absRoot = resolve(workspaceRoot)
  if (!existsSync(absRoot)) return false
  const res = await runGit(absRoot, ['rev-parse', '--is-inside-work-tree'])
  return res.ok && res.stdout.trim() === 'true'
}

export async function getCurrentBranch(workspaceRoot) {
  const res = await runGit(resolve(workspaceRoot), ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (!res.ok) return null
  const name = res.stdout.trim()
  return name && name !== 'HEAD' ? name : null
}

export async function hasCommits(workspaceRoot) {
  const res = await runGit(resolve(workspaceRoot), ['rev-parse', '--verify', 'HEAD'])
  return res.ok
}

export async function ensureTaskWorktree({ workspaceRoot, teamId, taskId }) {
  const absRoot = realpathSync(resolve(workspaceRoot))
  if (!(await isGitRepo(absRoot))) {
    return {
      isolated: false,
      worktreePath: absRoot,
      branch: null,
      reason: 'not-git-repo',
    }
  }

  if (!(await hasCommits(absRoot))) {
    return {
      isolated: false,
      worktreePath: absRoot,
      branch: null,
      reason: 'empty-git-repo-no-head',
    }
  }

  const safeTeam = sanitizeSegment(teamId, 'team')
  const safeTask = sanitizeSegment(taskId, 'task')
  const worktreesDir = join(absRoot, '.agent-teams', 'worktrees')
  mkdirSync(worktreesDir, { recursive: true })

  const worktreePath = assertWorktreePathInsideRoot(absRoot, join(worktreesDir, `${safeTeam}-${safeTask}`))
  const branch = `agent-teams/${safeTeam}/${safeTask}`
  const baseBranch = (await getCurrentBranch(absRoot)) || 'HEAD'

  if (existsSync(join(worktreePath, '.git'))) {
    return {
      isolated: true,
      reused: true,
      worktreePath,
      branch,
      baseBranch,
    }
  }

  const branchCheck = await runGit(absRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])
  const addArgs = branchCheck.ok
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, baseBranch]

  const addRes = await runGit(absRoot, addArgs)
  if (!addRes.ok) {
    throw new Error(`创建 Git Worktree 失败: ${addRes.stderr || addRes.stdout}`)
  }

  return {
    isolated: true,
    reused: false,
    worktreePath,
    branch,
    baseBranch,
  }
}

export async function inspectWorktreeDiff({ workspaceRoot, worktreePath, baseBranch = 'HEAD', maxDiffChars = 12000 }) {
  const absRoot = realpathSync(resolve(workspaceRoot))
  const safePath = assertWorktreePathInsideRoot(absRoot, worktreePath)
  if (!existsSync(safePath)) {
    return { ok: false, exists: false, statusShort: '', diffStat: '', diff: '', truncated: false }
  }

  const statusRes = await runGit(safePath, ['status', '--short'])
  const statRes = await runGit(safePath, ['diff', '--stat', baseBranch])
  const diffRes = await runGit(safePath, ['diff', baseBranch])
  const rawDiff = diffRes.ok ? diffRes.stdout : ''
  const limit = Math.max(500, Math.min(Number(maxDiffChars) || 12000, 40000))

  return {
    ok: true,
    exists: true,
    worktreePath: safePath,
    statusShort: statusRes.stdout.trim(),
    diffStat: statRes.stdout.trim(),
    diff: rawDiff.slice(0, limit),
    truncated: rawDiff.length > limit,
  }
}

export async function mergeTaskWorktree({ workspaceRoot, worktreePath, branch, commitMessage }) {
  const absRoot = realpathSync(resolve(workspaceRoot))
  const safePath = assertWorktreePathInsideRoot(absRoot, worktreePath)
  if (!existsSync(safePath)) {
    return { ok: false, error: 'worktree 不存在' }
  }

  const statusRes = await runGit(safePath, ['status', '--porcelain'])
  if (statusRes.ok && statusRes.stdout.trim() !== '') {
    const addRes = await runGit(safePath, ['add', '-A'])
    if (!addRes.ok) {
      return { ok: false, error: `worktree 暂存改动失败: ${addRes.stderr}` }
    }
    const msg = String(commitMessage || `chore(agent-teams): merge worktree ${branch}`).trim()
    const commitRes = await runGit(safePath, ['commit', '-m', msg])
    if (!commitRes.ok) {
      return { ok: false, error: `worktree 提交改动失败: ${commitRes.stderr || commitRes.stdout}` }
    }
  }

  const mergeRes = await runGit(absRoot, ['merge', '--no-ff', '--no-edit', branch])
  if (!mergeRes.ok) {
    await runGit(absRoot, ['merge', '--abort'])
    return {
      ok: false,
      conflict: true,
      error: `合并冲突，已自动中止合并: ${mergeRes.stderr || mergeRes.stdout}`,
    }
  }

  return {
    ok: true,
    conflict: false,
    branch,
    message: mergeRes.stdout.trim() || 'merged',
  }
}

export async function cleanupTaskWorktree({ workspaceRoot, worktreePath, branch }) {
  const absRoot = realpathSync(resolve(workspaceRoot))
  if (worktreePath) {
    const safePath = assertWorktreePathInsideRoot(absRoot, worktreePath)
    if (existsSync(safePath)) {
      await runGit(absRoot, ['worktree', 'remove', '--force', safePath])
    }
  }
  await runGit(absRoot, ['worktree', 'prune'])
  if (branch && branch.startsWith('agent-teams/')) {
    await runGit(absRoot, ['branch', '-D', branch])
  }
  return { ok: true }
}
