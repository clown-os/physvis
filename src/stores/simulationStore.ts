// 仿真核心状态：当前场景定义 + 引擎缓存（急切全量预计算）+ 播放状态 + 撤销/重做。
//
// 关键决策：
// - 参数变更 → 同步重算整个 EngineResult（1~5ms，远低于 500ms 验收线），不做惰性缓存；
// - 撤销/重做栈存放 SceneDefinition 快照（JSON 可序列化，不存 Float32Array 计算态），
//   每次切换快照时重算——确定性的引擎保证同一快照产生同一结果；
// - 播放 simTime 由渲染器 rAF 循环高频直写（每帧 setState），React 组件按需订阅。
import { create } from 'zustand'
import { run } from '../engine/Engine'
import type { EngineResult, ParamDef, ScenarioDefinition, SolutionStep } from '../engine/types'
import { ENGINE_DT } from '../engine/types'

export interface Playback {
  /** 当前播放时刻（s，与结果网格对齐） */
  simTime: number
  playing: boolean
  /** 播放速度倍率 */
  speed: number
  loop: boolean
}

/** 撤销栈容量（快照较小，50 步足够教学场景） */
const UNDO_LIMIT = 50

/**
 * 通用参数补全：为场景里每个物体附加「半径 r」滑块（模板/AI 场景通吃）。
 * 半径是渲染与接触的统一量：调大调小会实时改变碰撞/圆环自由半径/贴面偏移等物理行为。
 */
function withRadiusParams(def: ScenarioDefinition, params: ParamDef[]): ParamDef[] {
  const keys = new Set(params.map((p) => p.key))
  const extra: ParamDef[] = []
  for (const o of def.objects) {
    const key = `${o.id}.radius`
    if (keys.has(key)) continue
    extra.push({
      key,
      label: '半径 r',
      unit: 'm',
      min: 0.05,
      max: 2,
      step: 0.05,
      group: o.id,
      read: (d) => d.objects.find((x) => x.id === o.id)?.radius ?? 0.3,
      apply: (d, v) => ({
        ...d,
        objects: d.objects.map((x) => (x.id === o.id ? { ...x, radius: Math.max(0.03, v) } : x)),
      }),
    })
  }
  return [...params, ...extra]
}

export interface SimulationState {
  /** 加载时的原始场景（"恢复原始参数"目标） */
  originalDef: ScenarioDefinition | null
  /** 当前场景定义（参数编辑后的） */
  def: ScenarioDefinition | null
  /** 引擎计算结果（与 def 同步重建） */
  result: EngineResult | null
  /** 当前场景的参数面板定义（随场景加载） */
  params: ParamDef[]
  playback: Playback
  /** 场景定义变更计数（渲染层据此判定重建画布/图表） */
  configVersion: number
  /** 当前题目原文（手动输入/示例题；模板实例化为 null） */
  problemText: string | null
  /** 场景来源（用于 UI 展示与持久化恢复） */
  sceneId: string | null
  /** 分步解题讲解（与画面时间同步；AI 解析附带，示例题内置） */
  solution: SolutionStep[] | null

  past: ScenarioDefinition[]
  future: ScenarioDefinition[]

  loadScene: (
    def: ScenarioDefinition,
    params: ParamDef[],
    opts?: { sceneId?: string; problemText?: string | null; solution?: SolutionStep[] | null },
  ) => void
  applyParam: (p: ParamDef, v: number) => void
  resetParams: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
  setPlayback: (partial: Partial<Playback>) => void
  /** rAF 循环高频直写（不走 setPlayback 包装） */
  setSimTime: (t: number) => void
  seek: (t: number) => void
  /** 逐帧 ±ENGINE_DT */
  stepFrame: (dir: 1 | -1) => void
}

function compute(def: ScenarioDefinition): EngineResult {
  return run(def)
}

export const useSimulationStore = create<SimulationState>()((set, get) => {
  /**
   * 场景定义切换的统一提交：重算缓存 + 撤销栈维护 + simTime 钳制。
   * @param next 新定义；prevDef 进入 past 栈（null = 不压栈，如 loadScene）
   */
  const commit = (
    next: ScenarioDefinition,
    prevDef: ScenarioDefinition | null,
    opts: { future?: ScenarioDefinition[] } = {},
  ) => {
    const result = compute(next)
    set((s) => ({
      def: next,
      result,
      past: prevDef === null ? s.past : [...s.past.slice(-(UNDO_LIMIT - 1)), prevDef],
      future: opts.future ?? [],
      configVersion: s.configVersion + 1,
      playback: {
        ...s.playback,
        simTime: Math.max(0, Math.min(s.playback.simTime, result.duration)),
      },
    }))
  }

  return {
    originalDef: null,
    def: null,
    result: null,
    params: [],
    playback: { simTime: 0, playing: false, speed: 1, loop: false },
    configVersion: 0,
    problemText: null,
    sceneId: null,
    solution: null,
    past: [],
    future: [],

    loadScene: (def, params, opts) => {
      set((s) => ({
        originalDef: def,
        def,
        params: withRadiusParams(def, params),
        result: compute(def),
        past: [],
        future: [],
        configVersion: s.configVersion + 1,
        playback: { simTime: 0, playing: false, speed: s.playback.speed, loop: s.playback.loop },
        problemText: opts?.problemText ?? null,
        sceneId: opts?.sceneId ?? null,
        solution: opts?.solution ?? def.solution ?? null,
      }))
    },

    applyParam: (p, v) => {
      const { def } = get()
      if (!def) return
      const next = p.apply(def, v)
      if (next === def) return
      commit(next, def)
    },

    resetParams: () => {
      const { originalDef, def } = get()
      if (!originalDef || originalDef === def) return
      commit(originalDef, def)
    },

    undo: () => {
      const { past, def } = get()
      if (past.length === 0 || !def) return
      const prev = past[past.length - 1]!
      commit(prev, null, { future: [def, ...get().future] })
    },

    redo: () => {
      const { future, def } = get()
      if (future.length === 0 || !def) return
      const next = future[0]!
      commit(next, def, { future: future.slice(1) })
    },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  setPlayback: (partial) => {
    const r = get().result
    const simTime = partial.simTime
    set((s) => ({
      playback: {
        ...s.playback,
        ...partial,
        simTime:
          simTime !== undefined && r
            ? Math.max(0, Math.min(r.duration, simTime))
            : s.playback.simTime,
      },
    }))
  },

  setSimTime: (t) => {
    const r = get().result
    if (!r) return
    const clamped = Math.max(0, Math.min(r.duration, t))
    set((s) => ({ playback: { ...s.playback, simTime: clamped } }))
  },

  seek: (t) => get().setSimTime(t),

  stepFrame: (dir) => {
    const { playback, result } = get()
    if (!result) return
    const t = Math.max(0, Math.min(result.duration, playback.simTime + dir * ENGINE_DT))
    get().setSimTime(t)
  },
  }
})
