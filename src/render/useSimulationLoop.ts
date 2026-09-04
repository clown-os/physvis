// 模块级单例 rAF 循环（StrictMode 双挂载安全）：
// - 有订阅者才运行，无订阅者自动停止；
// - 循环内推进 simTime（simTime += realDt × speed，delta 钳制 ≤100ms）；
// - 到末尾：loop → 回绕；否则停在末尾并暂停；
// - 订阅回调每帧执行（渲染路径零 React 重渲染——回调内读 store.getState()）。
import { useEffect } from 'react'
import { useSimulationStore } from '../stores/simulationStore'
import { useUIStore } from '../stores/uiStore'

export type FrameFn = (simTime: number, realDt: number) => void

/** 讲解模式下的画面慢放倍率（开讲解 → 慢放，关 → 恢复正常速度） */
export const EXPLAIN_SPEED = 0.35

const subs = new Set<FrameFn>()
let rafId = 0
let lastTs: number | null = null

function frame(ts: number): void {
  const realDt = lastTs === null ? 0 : Math.min(0.1, (ts - lastTs) / 1000)
  lastTs = ts

  const store = useSimulationStore.getState()
  const { playback, result } = store
  if (playback.playing && result && realDt > 0) {
    // 讲解开启且有讲解步骤 → 慢放；否则按用户设定速度
    const ui = useUIStore.getState()
    const slow = ui.explain && (store.solution?.length ?? 0) > 0
    const speed = slow ? EXPLAIN_SPEED : playback.speed
    let t = playback.simTime + realDt * speed
    if (t >= result.duration) {
      if (playback.loop) {
        t %= result.duration
      } else {
        t = result.duration
        useSimulationStore.getState().setPlayback({ playing: false })
      }
    }
    useSimulationStore.getState().setSimTime(t)
  }

  const st = useSimulationStore.getState()
  for (const fn of subs) fn(st.playback.simTime, realDt)

  rafId = requestAnimationFrame(frame)
}

function start(): void {
  if (rafId !== 0) return
  lastTs = null
  rafId = requestAnimationFrame(frame)
}

function stop(): void {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId)
    rafId = 0
    lastTs = null
  }
}

/** 订阅 rAF 循环；组件卸载时自动退订，最后一个退订者停止循环 */
export function useSimulationLoop(onFrame: FrameFn, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    subs.add(onFrame)
    start()
    return () => {
      subs.delete(onFrame)
      if (subs.size === 0) stop()
    }
  }, [onFrame, enabled])
}
