/**
 * Extensible Knowledge Manuals & Custom Workspace Widgets Store.
 * Generated with EasyCLIProxyAPI (gpt-6.1-sol) and integrated into AgentTeams Studio.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const filePath = (root) => join(resolve(root || process.cwd()), '.agent-teams', 'custom-extensions.json')
const text = (value) => (typeof value === 'string' ? value : '')
const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})
const array = (value) => (Array.isArray(value) ? value : [])
const strings = (value) =>
  array(value)
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
const records = (value) => array(value).filter((v) => v && typeof v === 'object' && !Array.isArray(v))
const fields = (value, keys) => Object.fromEntries(keys.map((key) => [key, text(value[key])]))

function normalizeManual(value) {
  const input = object(value)
  const id = text(input.id).trim() || `custom-kb-${randomUUID().slice(0, 8)}`
  return {
    id,
    title: text(input.title).trim() || '未命名扩展知识库',
    subtitle: text(input.subtitle).trim() || '用户自定义可扩展知识与 SOP 模块',
    version: text(input.version).trim() || 'v1.0',
    category: text(input.category).trim() || '自定义扩展',
    scopeLabel: text(input.scopeLabel).trim() || '全局工作区智能体共享',
    isCustom: true,
    triggerKeywords: strings(input.triggerKeywords),
    specs: records(input.specs).map((spec) => ({
      label: text(spec.label).trim() || '指标项',
      value: text(spec.value).trim() || '—',
      ...(typeof spec.badge === 'string' && spec.badge.trim() ? { badge: spec.badge.trim() } : {}),
    })),
    sopCards: records(input.sopCards).map((card, idx) => ({
      id: text(card.id).trim() || `sop-${idx + 1}`,
      icon: text(card.icon).trim() || '⚡',
      symptom: text(card.symptom).trim() || '标准执行卡片',
      quickPrompt: text(card.quickPrompt).trim() || text(card.symptom).trim() || '执行该 SOP 任务',
      steps: strings(card.steps),
      relatedCommands: strings(card.relatedCommands ?? card.commands),
    })),
    rawMarkdown: text(input.rawMarkdown),
    updatedAt: text(input.updatedAt) || new Date().toISOString(),
  }
}

function normalizeWidget(value) {
  const input = object(value)
  const id = text(input.id).trim() || `widget-${randomUUID().slice(0, 8)}`
  return {
    id,
    title: text(input.title).trim() || '自定义快捷模块',
    category: text(input.category).trim() || 'Worktree / 审批扩展',
    icon: text(input.icon).trim() || '🧩',
    description: text(input.description).trim() || '',
    actionType: ['quick-command', 'link', 'note'].includes(input.actionType)
      ? input.actionType
      : 'quick-command',
    payload: text(input.payload).trim(),
    tags: strings(input.tags),
    fields: records(input.fields).map((field) => fields(field, ['label', 'value'])),
    updatedAt: text(input.updatedAt) || new Date().toISOString(),
  }
}

export function listCustomExtensions(workspaceRoot = process.cwd()) {
  const target = filePath(workspaceRoot)
  if (!existsSync(target)) {
    return { manuals: [], widgets: [] }
  }
  try {
    const source = readFileSync(target, 'utf8')
    const data = object(JSON.parse(source))
    return {
      manuals: records(data.manuals).map(normalizeManual),
      widgets: records(data.widgets).map(normalizeWidget),
    }
  } catch {
    return { manuals: [], widgets: [] }
  }
}

function persist(root, data) {
  const target = filePath(root)
  const temporary = `${target}.${randomUUID()}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  try {
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    renameSync(temporary, target)
  } finally {
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {}
  }
}

function save(root, key, value, normalize) {
  const data = listCustomExtensions(root)
  const input = object(value)
  const id = text(input.id).trim() || `${key === 'manuals' ? 'custom-kb' : 'widget'}-${randomUUID().slice(0, 8)}`
  const index = data[key].findIndex((item) => item.id === id)
  const saved = normalize({
    ...(index >= 0 ? data[key][index] : {}),
    ...input,
    id,
    updatedAt: new Date().toISOString(),
  })
  if (index < 0) data[key].push(saved)
  else data[key][index] = saved
  persist(root, data)
  return saved
}

function remove(root, key, id) {
  const data = listCustomExtensions(root)
  const index = data[key].findIndex((item) => item.id === id)
  if (index < 0) return false
  data[key].splice(index, 1)
  persist(root, data)
  return true
}

export const saveCustomManual = (root, input) => save(root, 'manuals', input, normalizeManual)
export const deleteCustomManual = (root, id) => remove(root, 'manuals', id)
export const saveCustomWidget = (root, input) => save(root, 'widgets', input, normalizeWidget)
export const deleteCustomWidget = (root, id) => remove(root, 'widgets', id)

export function buildCustomManualPrompt(workspaceRoot, taskText, explicitIds = []) {
  const query = text(taskText).toLowerCase()
  const idSet = new Set(Array.isArray(explicitIds) ? explicitIds : [])
  const { manuals } = listCustomExtensions(workspaceRoot)
  const matches = manuals.filter(
    (manual) =>
      idSet.has(manual.id) ||
      manual.triggerKeywords.some((kw) => kw && query.includes(kw.toLowerCase())),
  )
  if (matches.length === 0) return ''
  return matches
    .map((m) => {
      const specsLines = m.specs.map((s) => `- **${s.label}**: ${s.value}${s.badge ? ` (${s.badge})` : ''}`).join('\n')
      const sopLines = m.sopCards
        .map((c) => `- [${c.symptom}]: ${c.steps.join(' -> ')} ${c.relatedCommands?.length ? `(命令: ${c.relatedCommands.join('; ')})` : ''}`)
        .join('\n')
      return [
        `\n【已挂载用户扩展知识库：${m.title} (${m.version})】`,
        specsLines ? `核心规格指标：\n${specsLines}` : '',
        sopLines ? `标准 SOP 流程：\n${sopLines}` : '',
        m.rawMarkdown ? `详细说明：\n${m.rawMarkdown}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n\n')
}
