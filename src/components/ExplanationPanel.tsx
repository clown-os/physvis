// 分步解题讲解面板：讲解随画面时间推进逐条高亮（点击某步可跳转到对应时刻）。
// 开关「讲解」：开启时画面按 EXPLAIN_SPEED 慢放（渲染循环生效），关闭恢复正常速度。
import { memo, useEffect, useRef } from 'react'
import { useSimulationStore } from '../stores/simulationStore'
import { useUIStore } from '../stores/uiStore'
import { EXPLAIN_SPEED } from '../render/useSimulationLoop'
import { Switch } from './ui'

export const ExplanationPanel = memo(function ExplanationPanel() {
  const solution = useSimulationStore((s) => s.solution)
  const simT = useSimulationStore((s) => Math.round(s.playback.simTime * 20) / 20)
  const seek = useSimulationStore((s) => s.seek)
  const explain = useUIStore((s) => s.explain)
  const setExplain = useUIStore((s) => s.setExplain)

  const activeRef = useRef<HTMLLIElement>(null)
  const activeIdx = solution
    ? solution.reduce((acc, st, i) => (simT >= st.time - 1e-9 ? i : acc), -1)
    : -1

  // 当前步骤自动滚入视野（步骤切换时）
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeIdx])

  if (!solution || solution.length === 0) {
    return (
      <div className="space-y-3 px-1 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">解题讲解</h3>
        <p className="py-8 text-center text-xs leading-relaxed text-slate-400">
          本场景暂无分步讲解。
          <br />
          用 AI 解析题目、或打开内置「示例题」（直接演示 / AI 解析演示）都会附带与画面同步的解题步骤。
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3 px-1 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">解题讲解</h3>

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div>
          <Switch checked={explain} onChange={setExplain} label="讲解" title="开启后画面慢放，讲解与画面同步" />
          <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
            开启 → 画面 {EXPLAIN_SPEED}× 慢放逐条讲解；关闭 → 正常速度
          </p>
        </div>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${explain ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
          {explain ? `慢放 ${EXPLAIN_SPEED}×` : '正常速度'}
        </span>
      </div>

      <ol className="space-y-2">
        {solution.map((st, i) => {
          const active = i === activeIdx
          const done = i < activeIdx
          return (
            <li key={i} ref={active ? activeRef : undefined}>
              <button
                type="button"
                onClick={() => seek(st.time)}
                title={`跳到该步骤时刻 t = ${st.time.toFixed(2)} s`}
                className={`block w-full rounded-lg border p-2.5 text-left transition-colors ${
                  active
                    ? 'border-blue-300 bg-blue-50/70 ring-1 ring-blue-200'
                    : done
                      ? 'border-slate-200 bg-white opacity-60 hover:opacity-90'
                      : 'border-slate-200 bg-white hover:border-blue-200'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-semibold ${active ? 'text-blue-700' : 'text-slate-700'}`}>
                    {active ? '▶ ' : ''}
                    {st.title}
                  </span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px text-[10px] tabular-nums text-slate-500">
                    t = {st.time.toFixed(2)} s
                  </span>
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-slate-600">{st.text}</span>
                {st.formula && (
                  <span className="mt-1.5 block rounded bg-slate-800 px-2 py-1 font-mono text-[11px] tracking-wide text-emerald-300">
                    {st.formula}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
})
