// 题目/AI 解析流程状态：输入题目 → 解析中 → 成功（含低置信校正）/ 失败。
// 真正的网络调用在 ai/ 层；本 store 只持有流程状态，组件/校正弹窗按状态渲染。
import { create } from 'zustand'
import type { AIParseError, ImageInput, ParsedResult } from '../ai/types'

export type ProblemSource = 'manual' | 'example' | 'template'

export interface CorrectionRound {
  /** 用户/系统反馈（发给模型的修正指令） */
  feedback: string
  /** 被校正的上一版解析结果 */
  before: ParsedResult | null
  at: number
}

export interface ProblemState {
  /** 当前题目原文 */
  text: string
  source: ProblemSource | null
  /** 上传的题目截图（识图建模：随 prompt 作为视觉输入发给模型） */
  images: ImageInput[]
  parsing: boolean
  error: AIParseError | null
  /** 最近一次成功解析 */
  parsed: ParsedResult | null
  /** 置信度 < 0.7 或解析失败 → 打开校正弹窗 */
  needsCorrection: boolean
  correctionRounds: CorrectionRound[]
  /** 场景落地提示（映射近似/假设，展示一次可关闭） */
  notice: string | null

  setText: (t: string, source?: ProblemSource) => void
  setImages: (imgs: ImageInput[]) => void
  setParsing: (v: boolean) => void
  resolveSuccess: (p: ParsedResult, needsCorrection: boolean) => void
  resolveFailure: (e: AIParseError) => void
  addCorrectionRound: (feedback: string, before: ParsedResult | null) => void
  resetFlow: () => void
  /** 校正完成后调用：关闭校正标记 */
  clearCorrection: () => void
  setNotice: (s: string | null) => void
}

export const useProblemStore = create<ProblemState>()((set) => ({
  text: '',
  source: null,
  images: [],
  parsing: false,
  error: null,
  parsed: null,
  needsCorrection: false,
  correctionRounds: [],
  notice: null,

  setText: (t, source = 'manual') => set({ text: t, source }),
  setImages: (images) => set({ images }),
  setParsing: (v) => set({ parsing: v, error: v ? null : undefined } as Partial<ProblemState>),
  resolveSuccess: (p, needsCorrection) =>
    set({ parsing: false, parsed: p, needsCorrection, error: null }),
  resolveFailure: (e) => set({ parsing: false, error: e, needsCorrection: true }),
  addCorrectionRound: (feedback, before) =>
    set((s) => ({
      correctionRounds: [...s.correctionRounds, { feedback, before, at: Date.now() }],
      needsCorrection: false,
    })),
  resetFlow: () =>
    set({ text: '', source: null, images: [], parsed: null, error: null, needsCorrection: false, correctionRounds: [], notice: null }),
  clearCorrection: () => set({ needsCorrection: false }),
  setNotice: (s) => set({ notice: s }),
}))
