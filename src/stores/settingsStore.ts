// 全局设置（AI Provider 配置 / 播放偏好 / 校正提示模板）。
// 变更即持久化到 localStorage（版本化），读取失败回退默认。
// 注意：API Key 仅保存在本机浏览器 localStorage，提交/分享前请自行斟酌。
import { create } from 'zustand'
import type { ProviderConfig, ProviderId } from '../ai/types'
import { PROVIDER_DEFAULTS } from '../ai/types'
import { loadPersisted, savePersisted } from './persistence'

const KEY = 'settings'
const VERSION = 1

export interface SettingsState {
  activeProvider: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  /** 默认播放速度（倍速） */
  defaultSpeed: number
  /** 校正弹窗内置提示模板（发送给模型的修正指令前缀） */
  correctionTemplate: string
  /** 首次使用引导是否已展示 */
  introSeen: boolean
  /** 最近一次使用的示例题/模板 id（下次启动恢复现场） */
  lastSceneId?: string
  lastUserProblem?: string

  setActiveProvider: (id: ProviderId) => void
  setProvider: (id: ProviderId, partial: Partial<ProviderConfig>) => void
  setDefaultSpeed: (v: number) => void
  setCorrectionTemplate: (s: string) => void
  markIntroSeen: () => void
  setLastScene: (sceneId: string, problemText?: string) => void
}

const DEFAULT_TEMPLATE =
  '你是物理建模助手。用户指出上一步解析有误：{issue}。请重新按 JSON schema 输出修正后的完整题目解析结果，'
  + '只输出 JSON，不要多余文字。保持正确的物理关系（量纲、方向、单位）。'

function loadSettings(): Omit<SettingsState, keyof Pick<SettingsState, 'setActiveProvider' | 'setProvider' | 'setDefaultSpeed' | 'setCorrectionTemplate' | 'markIntroSeen' | 'setLastScene'>> {
  const saved = loadPersisted<{
    activeProvider?: ProviderId
    providers?: Partial<Record<ProviderId, ProviderConfig>>
    defaultSpeed?: number
    correctionTemplate?: string
    introSeen?: boolean
    lastSceneId?: string
    lastUserProblem?: string
  }>(KEY, VERSION)

  const providers = { ...PROVIDER_DEFAULTS }
  if (saved?.providers) {
    for (const id of Object.keys(PROVIDER_DEFAULTS) as ProviderId[]) {
      const p = saved.providers[id]
      if (p) providers[id] = { ...providers[id]!, ...p }
    }
  }
  return {
    activeProvider: saved?.activeProvider ?? 'mock',
    providers,
    defaultSpeed: saved?.defaultSpeed ?? 1,
    correctionTemplate: saved?.correctionTemplate ?? DEFAULT_TEMPLATE,
    introSeen: saved?.introSeen ?? false,
    lastSceneId: saved?.lastSceneId,
    lastUserProblem: saved?.lastUserProblem,
  }
}

function persist(get: () => SettingsState): void {
  const s = get()
  savePersisted(KEY, VERSION, {
    activeProvider: s.activeProvider,
    providers: s.providers,
    defaultSpeed: s.defaultSpeed,
    correctionTemplate: s.correctionTemplate,
    introSeen: s.introSeen,
    lastSceneId: s.lastSceneId,
    lastUserProblem: s.lastUserProblem,
  })
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...loadSettings(),

  setActiveProvider: (id) => {
    set({ activeProvider: id })
    persist(get)
  },
  setProvider: (id, partial) => {
    set((s) => ({ providers: { ...s.providers, [id]: { ...s.providers[id]!, ...partial } } }))
    persist(get)
  },
  setDefaultSpeed: (v) => {
    set({ defaultSpeed: v })
    persist(get)
  },
  setCorrectionTemplate: (s) => {
    set({ correctionTemplate: s })
    persist(get)
  },
  markIntroSeen: () => {
    set({ introSeen: true })
    persist(get)
  },
  setLastScene: (sceneId, problemText) => {
    set({ lastSceneId: sceneId, lastUserProblem: problemText })
    persist(get)
  },
}))
