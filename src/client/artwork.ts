/**
 * Shared artwork lookup for the activity panel and conversation cards:
 * - Gemini 形象：猫耳朵哈吉米少女 (/avatar-gemini.png)
 * - GPT 形象：白发龙角/恶魔羽翼少女 (/avatar-gpt.png)
 * - Captain：队长反重力高定图标 (/antigravity-icon-light.png)
 * @module dsh-agent-teams/client/artwork
 */

/** Gemini 专属形象：猫耳朵哈吉米 Q版少女 */
export const GEMINI_AVATAR = '/avatar-gemini.png'

/** GPT 专属形象：白色系龙角恶魔羽翼 Q版少女 */
export const GPT_AVATAR = '/avatar-gpt.png'

/** Captain artwork (Pearl Antigravity Neko Icon). */
export const LEAD_ART = '/antigravity-icon-light.png'

/** Artwork route prefix served by the plugin host half. */
export const ART_BASE = '/plugins/dsh-agent-teams/assets/'

/** Status action artwork per member activity. */
export const ACTION_ART: Record<'working' | 'idle' | 'unknown', string> = {
  working: `${ART_BASE}action-working-v2.png`,
  idle: `${ART_BASE}action-sleeping-v2.png`,
  unknown: `${ART_BASE}action-thinking-v2.png`,
}

/**
 * 判断是否属于 GPT 阵营成员
 */
export function isGptIdentity(name: string, role: string = '', modelOrProvider: string = ''): boolean {
  const combined = `${name} ${role} ${modelOrProvider}`.toLowerCase()
  return (
    combined.includes('gpt') ||
    combined.includes('cliproxyapi') ||
    combined.includes('openai') ||
    combined.includes('cpa') ||
    combined.includes('codex') ||
    combined.includes('sol') ||
    combined.includes('astra') ||
    combined.includes('terra')
  )
}

/**
 * 判断是否属于 Gemini 阵营成员
 */
export function isGeminiIdentity(name: string, role: string = '', modelOrProvider: string = ''): boolean {
  const combined = `${name} ${role} ${modelOrProvider}`.toLowerCase()
  return (
    combined.includes('gemini') ||
    combined.includes('google') ||
    combined.includes('antigravity') ||
    combined.includes('hajimi') ||
    combined.includes('哈吉米') ||
    combined.includes('hydrogen') ||
    combined.includes('argon')
  )
}

/**
 * Member artwork URL.
 * 严格按照用户需求匹配：
 * - 白色是 GPT 的（avatar-gpt.png）
 * - 猫耳朵是 Gemini 的（avatar-gemini.png）
 */
export function memberArtUrl(name: string, role: string = '', modelOrProvider: string = ''): string {
  // 1. 优先根据模型/路由/名称特征显式匹配 GPT
  if (isGptIdentity(name, role, modelOrProvider)) {
    return GPT_AVATAR
  }

  // 2. 优先根据模型/路由/名称特征显式匹配 Gemini
  if (isGeminiIdentity(name, role, modelOrProvider)) {
    return GEMINI_AVATAR
  }

  // 3. 按照团队角色常见分工智能映射
  const combined = `${name} ${role}`.toLowerCase()
  if (/engineer|backend|server|dev|impl|coder|后端|工程|代码|单测/.test(combined)) {
    return GPT_AVATAR
  }

  // 4. 默认回退至看板娘（猫耳朵哈吉米少女）
  return GEMINI_AVATAR
}
