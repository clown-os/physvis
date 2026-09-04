// UI 状态（视图开关/工作区面板/弹窗），不参与物理计算。
// 渲染器相机状态刻意不放在这里：rAF 循环直改 mutable 相机对象，避免每帧 React 重渲染。
import { create } from 'zustand'
import type { ViewOptions } from '../engine/types'
import { defaultViewOptions } from '../engine/types'

export type WorkspaceTab = 'params' | 'forces' | 'charts' | 'explain'
export type DialogKind = 'correction' | 'templates' | 'examples' | 'settings' | null

export interface UIState {
  view: ViewOptions
  setView: (partial: Partial<ViewOptions>) => void
  /** 右侧面板当前 Tab */
  tab: WorkspaceTab
  setTab: (t: WorkspaceTab) => void
  /** 模态弹窗（校正 / 模板库 / 示例题 / 设置）；templates 与 examples 二选一展示 */
  dialog: DialogKind
  openDialog: (d: Exclude<DialogKind, null>) => void
  closeDialog: () => void
  /** 讲解模式：开启时画面慢放（与讲解步骤同步） */
  explain: boolean
  setExplain: (v: boolean) => void
  /** 高亮中的事件（点击时间轴标记/图表标记时设置，渲染层描边提示） */
  highlightEventIndex: number
  setHighlightEvent: (i: number) => void
  /** 求解徽标信息（引擎报告 solveMs 等；低频更新） */
  lastSolveMs: number
  setLastSolveMs: (ms: number) => void
}

export const useUIStore = create<UIState>()((set) => ({
  view: { ...defaultViewOptions },
  setView: (partial) => set((s) => ({ view: { ...s.view, ...partial } })),
  tab: 'params',
  setTab: (t) => set({ tab: t }),
  dialog: null,
  openDialog: (d) => set({ dialog: d }),
  closeDialog: () => set({ dialog: null }),
  explain: false,
  setExplain: (v) => set({ explain: v }),
  highlightEventIndex: -1,
  setHighlightEvent: (i) => set({ highlightEventIndex: i }),
  lastSolveMs: 0,
  setLastSolveMs: (ms) => set({ lastSolveMs: ms }),
}))
