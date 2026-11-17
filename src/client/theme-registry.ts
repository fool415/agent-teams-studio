/**
 * AgentTeams Studio — Apple 18 Liquid & Solid Glass + EasyCLIProxyAPI 18-Theme Engine.
 * 1:1 modeled after the "纯色与渐变" (Solid & Gradient) and "光影与风景" (Light & Scenery)
 * visual theme gallery cards and persisted in `theme-selection.json`.
 */

export type ThemeAppearance = 'dark' | 'light'
export type ThemeCategory = 'solid-gradient' | 'light-scenery'

export interface StudioThemePreset {
  readonly id: string
  readonly name: string
  readonly subtitle: string
  readonly category: ThemeCategory
  readonly appearance: ThemeAppearance
  readonly badge: string
  /** Outer thumbnail canvas background (CSS gradient / atmospheric scenery) */
  readonly outerBg: string
  /** Inner solid-glass card background in thumbnail */
  readonly innerCardBg: string
  /** Inner card text color */
  readonly innerTextColor: string
  /** Pill button color inside thumbnail card */
  readonly pillColor: string
  readonly previewColors: readonly [string, string, string]
}

export interface StudioFontPreset {
  readonly id: string
  readonly name: string
  readonly subtitle: string
  readonly badge: string
  readonly fontFamily: string
  readonly sampleText: string
}

export interface StudioUiScalePreset {
  readonly scale: number
  readonly label: string
  readonly desc: string
}

export interface ThemeSelectionState {
  readonly version: 1
  readonly selectedId: string
  readonly lastLightId: string
  readonly lastDarkId: string
  readonly fontFamilyId?: string
  readonly customFontFamily?: string
  readonly uiScale?: number
}

export const STUDIO_FONT_PRESETS: readonly StudioFontPreset[] = [
  {
    id: 'apple-sf',
    name: 'Apple SF & 苹方清晰体',
    subtitle: 'Apple 18 原生无衬线与中文字形配比，全屏大字号锐利通透',
    badge: '默认推荐',
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'PingFang SC', 'Segoe UI Variable Display', 'Microsoft YaHei UI', sans-serif",
    sampleText: '把喜欢的事，慢慢做好 · AgentTeams Studio',
  },
  {
    id: 'harmony-modern',
    name: 'HarmonyOS & 微软雅黑超清黑体',
    subtitle: '针对 Windows 2K/4K 大屏优化的饱满字重黑体，远距离极易辨识',
    badge: '大屏高对比',
    fontFamily:
      "'HarmonyOS Sans SC', 'MiSans', 'Microsoft YaHei UI', 'PingFang SC', 'Segoe UI', sans-serif",
    sampleText: '多智能体全屏指挥舱 · 清晰醒目零眯眼',
  },
  {
    id: 'rounded-vivid',
    name: '圆润元气体 (哈吉米灵动风)',
    subtitle: '柔和圆角笔触，兼具亲和力与高辨识度',
    badge: '哈吉米专属',
    fontFamily:
      "'YouYuan', 'STYuanti-SC-Regular', 'Hiragino Maru Gothic ProN', 'Microsoft YaHei UI', 'PingFang SC', sans-serif",
    sampleText: '哈吉米~ 灵动猫系高定工作台 🐾',
  },
  {
    id: 'songti-editorial',
    name: '人文书卷宋体 (杂志精读风)',
    subtitle: '典雅衬线笔锋，适合长篇架构文档、知识库与情报深读',
    badge: '人文书卷',
    fontFamily:
      "'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', 'SimSun', Georgia, serif",
    sampleText: '文档驱动开发 · 格物致知，知行合一',
  },
  {
    id: 'kaiti-calligraphy',
    name: '温润楷书体 (东方国风审美)',
    subtitle: '搭配雨窗青瓷、竹影午后等光影主题极具东方意境',
    badge: '东方雅韵',
    fontFamily:
      "'Kaiti SC', 'STKaiti', 'KaiTi', 'FangSong', 'PingFang SC', serif",
    sampleText: '雨过天青云破处，这般颜色做将来',
  },
  {
    id: 'jetbrains-geek',
    name: 'JetBrains Mono 极客等宽体',
    subtitle: '中英等宽极客终端感，看日志、Token 消耗与代码审查一目了然',
    badge: '极客终端',
    fontFamily:
      "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', 'Microsoft YaHei UI', monospace",
    sampleText: '0123456789 tok/s · git commit -m "v2.2"',
  },
] as const

export const STUDIO_UI_SCALE_PRESETS: readonly StudioUiScalePreset[] = [
  { scale: 96, label: '96% 紧凑窗口', desc: '适合小尺寸笔记本分屏' },
  { scale: 102, label: '102% 标准放大', desc: '均衡窗口与常规显示器' },
  { scale: 108, label: '108% 舒适大字 (推荐)', desc: '默认全局加大按钮与字体' },
  { scale: 116, label: '116% 全屏超清', desc: '2K/4K 全屏一目了然' },
  { scale: 124, label: '124% 巨幕演示', desc: '超大按钮与特大号字重' },
] as const

export const STUDIO_THEME_PRESETS: readonly StudioThemePreset[] = [
  // ==================== 第一组：纯色与渐变 (Solid & Gradient · 9 款) ====================
  {
    id: 'clear-sky-glaze',
    name: '晴空琉璃',
    subtitle: 'Apple 18 冰蓝流光液态玻璃与高透白瓷固态内卡',
    category: 'solid-gradient',
    appearance: 'light',
    badge: '晴空琉璃',
    outerBg: 'linear-gradient(135deg, #cde4ff 0%, #e8f3ff 48%, #bad8fc 100%)',
    innerCardBg: 'rgba(255, 255, 255, 0.86)',
    innerTextColor: '#1e293b',
    pillColor: '#1d4d7a',
    previewColors: ['#cde4ff', '#1d4d7a', '#3b82f6'],
  },
  {
    id: 'warm-sand-light',
    name: '暖白奶油',
    subtitle: '温润奶油羊皮暖沙底色配焦糖琥珀固态玻璃',
    category: 'solid-gradient',
    appearance: 'light',
    badge: '暖白奶油',
    outerBg: 'linear-gradient(135deg, #efe4d2 0%, #f7f1e6 55%, #e8d8c0 100%)',
    innerCardBg: 'rgba(255, 252, 245, 0.90)',
    innerTextColor: '#291d12',
    pillColor: '#6f4e27',
    previewColors: ['#efe4d2', '#6f4e27', '#b86b1b'],
  },
  {
    id: 'sakura-pink',
    name: '樱花浅粉',
    subtitle: '春日柔粉冰晶液态玻璃配玫瑰绛紫点缀',
    category: 'solid-gradient',
    appearance: 'light',
    badge: '樱花浅粉',
    outerBg: 'linear-gradient(135deg, #f9dce4 0%, #fdf0f4 55%, #f5d0dc 100%)',
    innerCardBg: 'rgba(255, 250, 252, 0.90)',
    innerTextColor: '#3b1d2a',
    pillColor: '#883955',
    previewColors: ['#f9dce4', '#883955', '#ec4899'],
  },
  {
    id: 'sage-green',
    name: '鼠尾草绿',
    subtitle: '森系治愈草本青绿液态玻璃与温润白玉内卡',
    category: 'solid-gradient',
    appearance: 'light',
    badge: '鼠尾草绿',
    outerBg: 'linear-gradient(135deg, #dfe6d8 0%, #f2f6ee 55%, #d4dfd0 100%)',
    innerCardBg: 'rgba(252, 254, 249, 0.90)',
    innerTextColor: '#1e2e1e',
    pillColor: '#3f5e2a',
    previewColors: ['#dfe6d8', '#3f5e2a', '#16a34a'],
  },
  {
    id: 'blue-pink-aurora',
    name: '蓝粉流光',
    subtitle: '星云蓝与柔霞粉双色流光液态折射玻璃',
    category: 'solid-gradient',
    appearance: 'light',
    badge: '蓝粉流光',
    outerBg: 'linear-gradient(135deg, #dce5ff 0%, #ede6ff 50%, #fbd8ec 100%)',
    innerCardBg: 'rgba(252, 250, 255, 0.88)',
    innerTextColor: '#231f3a',
    pillColor: '#4c5196',
    previewColors: ['#dce5ff', '#4c5196', '#f472b6'],
  },
  {
    id: 'liquid-glass-dark',
    name: '深海夜幕',
    subtitle: 'Apple 18 旗舰深空海蓝液态玻璃与高光折射内卡',
    category: 'solid-gradient',
    appearance: 'dark',
    badge: '深海夜幕',
    outerBg: 'linear-gradient(135deg, #111c33 0%, #162440 55%, #0d1629 100%)',
    innerCardBg: 'rgba(32, 46, 72, 0.82)',
    innerTextColor: '#f1f5f9',
    pillColor: '#a8c7fa',
    previewColors: ['#111c33', '#5ac8fa', '#a8c7fa'],
  },
  {
    id: 'cupertino-frosted-light',
    name: '月光银灰',
    subtitle: '经典 Apple 原生银灰固态磨砂玻璃与静谧蓝调',
    category: 'solid-gradient',
    appearance: 'light',
    badge: '月光银灰',
    outerBg: 'linear-gradient(135deg, #e2e6ee 0%, #f1f4f9 55%, #dadfe8 100%)',
    innerCardBg: 'rgba(255, 255, 255, 0.92)',
    innerTextColor: '#1e293b',
    pillColor: '#475569',
    previewColors: ['#e2e6ee', '#475569', '#2563eb'],
  },
  {
    id: 'sunset-glow',
    name: '落日霞光',
    subtitle: '暮色暖橘与烟紫交织的通透晚霞折射玻璃',
    category: 'solid-gradient',
    appearance: 'light',
    badge: '落日霞光',
    outerBg: 'linear-gradient(135deg, #f3c6a5 0%, #e5b8b7 52%, #cdb4cf 100%)',
    innerCardBg: 'rgba(255, 248, 245, 0.88)',
    innerTextColor: '#361f1d',
    pillColor: '#853c33',
    previewColors: ['#f3c6a5', '#853c33', '#cdb4cf'],
  },
  {
    id: 'cpa-obsidian-dark',
    name: '黑金夜色',
    subtitle: '1:1 EasyCLIProxyAPI 曜石黑金高定深色固态玻璃',
    category: 'solid-gradient',
    appearance: 'dark',
    badge: '黑金夜色',
    outerBg: 'linear-gradient(135deg, #1c1915 0%, #26221c 55%, #14120f 100%)',
    innerCardBg: 'rgba(46, 41, 34, 0.86)',
    innerTextColor: '#fef3c7',
    pillColor: '#dfc07a',
    previewColors: ['#1c1915', '#dfc07a', '#f59e0b'],
  },

  // ==================== 第二组：光影与风景 (Light & Scenery · 9 款) ====================
  {
    id: 'rainy-celadon',
    name: '雨窗青瓷',
    subtitle: '江南烟雨青瓷水滴折射液态玻璃与半透白瓷内卡',
    category: 'light-scenery',
    appearance: 'light',
    badge: '雨窗青瓷',
    outerBg:
      'radial-gradient(circle at 20% 25%, rgba(255,255,255,0.55) 0%, transparent 35%), linear-gradient(135deg, #9ec0bd 0%, #cde2df 50%, #7fa8a4 100%)',
    innerCardBg: 'rgba(244, 251, 250, 0.86)',
    innerTextColor: '#132a28',
    pillColor: '#1f5c58',
    previewColors: ['#9ec0bd', '#1f5c58', '#0d9488'],
  },
  {
    id: 'bamboo-afternoon',
    name: '竹影午后',
    subtitle: '翠竹疏影暖阳斑驳光影与温润米白固态毛玻璃',
    category: 'light-scenery',
    appearance: 'light',
    badge: '竹影午后',
    outerBg:
      'radial-gradient(circle at 80% 20%, rgba(163, 184, 138, 0.45) 0%, transparent 45%), linear-gradient(135deg, #ebe6d8 0%, #f7f5ec 55%, #d6dec8 100%)',
    innerCardBg: 'rgba(255, 254, 248, 0.88)',
    innerTextColor: '#252e1d',
    pillColor: '#48612b',
    previewColors: ['#ebe6d8', '#48612b', '#65a30d'],
  },
  {
    id: 'morning-mist-lake',
    name: '晨雾湖光',
    subtitle: '破晓冰湖柔雾水波液态玻璃与晴空蓝调',
    category: 'light-scenery',
    appearance: 'light',
    badge: '晨雾湖光',
    outerBg:
      'radial-gradient(ellipse at 75% 15%, rgba(255, 247, 230, 0.6) 0%, transparent 50%), linear-gradient(135deg, #c2d6e8 0%, #e4eff8 52%, #cfdbe6 100%)',
    innerCardBg: 'rgba(250, 253, 255, 0.88)',
    innerTextColor: '#192a3b',
    pillColor: '#365870',
    previewColors: ['#c2d6e8', '#365870', '#0284c7'],
  },
  {
    id: 'apricot-breeze',
    name: '杏花微风',
    subtitle: '春日繁花暖粉焦外光斑与晶莹柔白玻璃内卡',
    category: 'light-scenery',
    appearance: 'light',
    badge: '杏花微风',
    outerBg:
      'radial-gradient(circle at 85% 20%, rgba(244, 162, 168, 0.5) 0%, transparent 45%), linear-gradient(135deg, #f6d5d8 0%, #fceef0 55%, #eec5cb 100%)',
    innerCardBg: 'rgba(255, 250, 251, 0.88)',
    innerTextColor: '#3b1c22',
    pillColor: '#82384c',
    previewColors: ['#f6d5d8', '#82384c', '#e11d48'],
  },
  {
    id: 'moonlight-veil',
    name: '月光轻纱',
    subtitle: '丝绸流光紫罗兰薄纱折射玻璃与静谧优雅内卡',
    category: 'light-scenery',
    appearance: 'light',
    badge: '月光轻纱',
    outerBg:
      'radial-gradient(circle at 25% 20%, rgba(255,255,255,0.65) 0%, transparent 45%), linear-gradient(135deg, #d8d4ec 0%, #efeafd 52%, #cbc4e4 100%)',
    innerCardBg: 'rgba(252, 250, 255, 0.88)',
    innerTextColor: '#271e3d',
    pillColor: '#5b437a',
    previewColors: ['#d8d4ec', '#5b437a', '#7c3aed'],
  },
  {
    id: 'sea-salt-shimmer',
    name: '海盐浮光',
    subtitle: '清透薄荷海浪波光折射液态玻璃与深海绿胶囊',
    category: 'light-scenery',
    appearance: 'light',
    badge: '海盐浮光',
    outerBg:
      'radial-gradient(circle at 75% 25%, rgba(255,255,255,0.55) 0%, transparent 40%), linear-gradient(135deg, #b5e5de 0%, #dff7f4 52%, #9ad8cf 100%)',
    innerCardBg: 'rgba(246, 254, 252, 0.88)',
    innerTextColor: '#11302b',
    pillColor: '#1b5e53',
    previewColors: ['#b5e5de', '#1b5e53', '#14b8a6'],
  },
  {
    id: 'amber-night-lamp',
    name: '琥珀夜灯',
    subtitle: '暖金壁炉光晕暗夜毛玻璃与摩卡深色固态内卡',
    category: 'light-scenery',
    appearance: 'dark',
    badge: '琥珀夜灯',
    outerBg:
      'radial-gradient(circle at 85% 22%, rgba(245, 158, 11, 0.42) 0%, transparent 48%), linear-gradient(135deg, #2b1d12 0%, #3d2919 52%, #1c130c 100%)',
    innerCardBg: 'rgba(58, 44, 34, 0.84)',
    innerTextColor: '#fef3c7',
    pillColor: '#e9b86b',
    previewColors: ['#2b1d12', '#e9b86b', '#d97706'],
  },
  {
    id: 'pine-dusk',
    name: '松林薄暮',
    subtitle: '北欧暮色苍松墨绿液态暗夜玻璃与薄荷绿点缀',
    category: 'light-scenery',
    appearance: 'dark',
    badge: '松林薄暮',
    outerBg:
      'radial-gradient(circle at 20% 20%, rgba(110, 231, 183, 0.18) 0%, transparent 48%), linear-gradient(135deg, #1d302a 0%, #284038 52%, #14221e 100%)',
    innerCardBg: 'rgba(42, 66, 58, 0.84)',
    innerTextColor: '#ecfdf5',
    pillColor: '#a7dbb8',
    previewColors: ['#1d302a', '#a7dbb8', '#10b981'],
  },
  {
    id: 'silent-snow',
    name: '雪落无声',
    subtitle: '冬日雾凇冰晶浅蓝白昼液态玻璃与深蓝灰胶囊',
    category: 'light-scenery',
    appearance: 'light',
    badge: '雪落无声',
    outerBg:
      'radial-gradient(circle at 20% 15%, rgba(186, 214, 242, 0.45) 0%, transparent 45%), linear-gradient(135deg, #dce6f2 0%, #f2f6fb 55%, #cfdceb 100%)',
    innerCardBg: 'rgba(255, 255, 255, 0.92)',
    innerTextColor: '#1e293b',
    pillColor: '#3a546b',
    previewColors: ['#dce6f2', '#3a546b', '#0284c7'],
  },
] as const

export const THEME_SELECTION_STORAGE_KEY = 'agent-teams-studio.theme-selection.v1'

export const DEFAULT_THEME_SELECTION: ThemeSelectionState = {
  version: 1,
  selectedId: 'clear-sky-glaze',
  lastLightId: 'clear-sky-glaze',
  lastDarkId: 'liquid-glass-dark',
  fontFamilyId: 'apple-sf',
  customFontFamily: '',
  uiScale: 108,
}

export function resolveFontPreset(id?: string | null): StudioFontPreset {
  if (!id) return STUDIO_FONT_PRESETS[0]
  return STUDIO_FONT_PRESETS.find((f) => f.id === id) ?? STUDIO_FONT_PRESETS[0]
}

export function resolveThemePreset(id?: string | null): StudioThemePreset {
  if (!id) return STUDIO_THEME_PRESETS[0]
  const aliases: Record<string, string> = {
    dark: 'cpa-obsidian-dark',
    light: 'clear-sky-glaze',
    'liquid-glass-light': 'clear-sky-glaze',
    'deep-sea-night': 'liquid-glass-dark',
    'black-gold-night': 'cpa-obsidian-dark',
    'moonlight-silver': 'cupertino-frosted-light',
    'hajimi-prism-dark': 'liquid-glass-dark',
  }
  const normalized = aliases[id] || id
  return STUDIO_THEME_PRESETS.find((t) => t.id === normalized) ?? STUDIO_THEME_PRESETS[0]
}

export function readLocalThemeSelection(): ThemeSelectionState {
  try {
    const raw = window.localStorage.getItem(THEME_SELECTION_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const preset = resolveThemePreset(parsed?.selectedId)
      return {
        version: 1,
        selectedId: preset.id,
        lastLightId: resolveThemePreset(parsed?.lastLightId || 'clear-sky-glaze').id,
        lastDarkId: resolveThemePreset(parsed?.lastDarkId || 'liquid-glass-dark').id,
        fontFamilyId: String(parsed?.fontFamilyId || 'apple-sf'),
        customFontFamily: String(parsed?.customFontFamily || ''),
        uiScale: Number.isFinite(Number(parsed?.uiScale))
          ? Math.max(85, Math.min(140, Math.round(Number(parsed.uiScale))))
          : 108,
      }
    }
  } catch {}
  return { ...DEFAULT_THEME_SELECTION }
}

export function writeLocalThemeSelection(next: ThemeSelectionState): void {
  try {
    const preset = resolveThemePreset(next.selectedId)
    window.localStorage.setItem(THEME_SELECTION_STORAGE_KEY, JSON.stringify(next))
    window.localStorage.setItem('studio-theme', preset.appearance)
  } catch {}
}

export function selectThemeById(current: ThemeSelectionState, targetId: string): ThemeSelectionState {
  const preset = resolveThemePreset(targetId)
  return {
    ...current,
    version: 1,
    selectedId: preset.id,
    lastLightId: preset.appearance === 'light' ? preset.id : current.lastLightId,
    lastDarkId: preset.appearance === 'dark' ? preset.id : current.lastDarkId,
  }
}

export function toggleThemeAppearance(current: ThemeSelectionState): ThemeSelectionState {
  const currentPreset = resolveThemePreset(current.selectedId)
  const nextId =
    currentPreset.appearance === 'dark'
      ? current.lastLightId || 'clear-sky-glaze'
      : current.lastDarkId || 'liquid-glass-dark'
  return selectThemeById(current, nextId)
}

export function applyThemeToDocument(selection: ThemeSelectionState): StudioThemePreset {
  const preset = resolveThemePreset(selection.selectedId)
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', preset.appearance)
    document.documentElement.setAttribute('data-style-preset', preset.id)
    const root = document.documentElement.style
    root.setProperty('--at-bg-aurora', preset.outerBg)
    root.setProperty('--at-accent-primary', preset.pillColor)
    root.setProperty('--dsw-alias-state-business-primary', preset.pillColor)

    const fontPreset = resolveFontPreset(selection.fontFamilyId)
    const customFont = String(selection.customFontFamily || '').trim()
    const resolvedFontStack = customFont
      ? `'${customFont.replace(/['"]/gu, '')}', ${fontPreset.fontFamily}`
      : fontPreset.fontFamily
    root.setProperty('--at-font-family', resolvedFontStack)
    document.body.style.fontFamily = resolvedFontStack

    const scale = Number.isFinite(Number(selection.uiScale))
      ? Math.max(85, Math.min(140, Math.round(Number(selection.uiScale))))
      : 108
    root.setProperty('--at-ui-scale', String(scale / 100))
    ;(document.body.style as unknown as Record<string, string>).zoom = `${scale}%`
  }
  return preset
}
