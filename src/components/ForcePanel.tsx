// 受力分析面板：当前时刻各物体的力列表 + 视图开关。
// 时间读数按 1/20s 节流订阅（渲染层每帧已独立画力箭头，这里只是表格）。
import { memo } from 'react'
import { useSimulationStore } from '../stores/simulationStore'
import { useUIStore } from '../stores/uiStore'
import { deriveForces, FORCE_COLORS } from '../engine/forces'
import { type ForceKind, defaultViewOptions } from '../engine/types'
import { Switch, fmtNum } from './ui'

const KIND_LABEL: Record<ForceKind, string> = {
  gravity: '重力',
  normal: '支持力',
  friction: '摩擦力',
  tension: '拉力',
  applied: '恒定外力',
  spring: '弹力',
  centripetal: '向心力',
  drag: '空气阻力',
  electric: '电场力',
  magnetic: '洛伦兹力',
  net: '合力',
}

/** 方向角（°），0 = 东，逆时针 */
function dirLabel(fx: number, fy: number): string {
  const d = (Math.atan2(fy, fx) * 180) / Math.PI
  if (d > -22.5 && d <= 22.5) return '向右'
  if (d > 22.5 && d <= 67.5) return '右上'
  if (d > 67.5 && d <= 112.5) return '向上'
  if (d > 112.5 && d <= 157.5) return '左上'
  if (d > 157.5 || d <= -157.5) return '向左'
  if (d > -157.5 && d <= -112.5) return '左下'
  if (d > -112.5 && d <= -67.5) return '向下'
  return '右下'
}

export const ForcePanel = memo(function ForcePanel() {
  const result = useSimulationStore((s) => s.result)
  const simT = useSimulationStore((s) => Math.round(s.playback.simTime * 20) / 20)
  const view = useUIStore((s) => s.view)
  const setView = useUIStore((s) => s.setView)

  if (!result) {
    return (
      <p className="py-8 text-center text-xs text-slate-400">
        暂无受力数据 —— 运行一个场景后这里会列出各时刻的受力
      </p>
    )
  }

  const step = Math.min(result.steps - 1, Math.max(0, Math.round(simT / result.dt)))

  const toggles: Array<[keyof typeof defaultViewOptions, string, string]> = [
    ['showTrajectory', '轨迹', '显示运动轨迹残影'],
    ['showGrid', '网格', '背景参考网格'],
    ['showAxes', '坐标轴', '世界坐标轴'],
    ['showField', '场', '显示电场箭头/磁场符号背景'],
    ['showVectorsVelocity', '速度矢量', '显示速度矢量箭头'],
    ['showForces', '受力', '显示全部受力矢量'],
    ['showNetForce', '合力', '额外显示合力（虚线）'],
    ['showForceValues', '力值标签', '受力箭头上标注数值'],
  ]

  return (
    <div className="space-y-3 px-1 py-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">受力分析</h3>

      {/* 视图开关网格 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        {toggles.map(([key, label, hint]) => (
          <Switch key={key} checked={view[key]} onChange={(v) => setView({ [key]: v })} label={label} title={hint} />
        ))}
      </div>

      <p className="text-right text-[10px] tabular-nums text-slate-400">
        当前时刻 t = {simT.toFixed(2)} s
      </p>

      {/* 每物体力表 */}
      <div className="space-y-4">
        {result.order.map((id) => {
          const tr = result.tracks[id]!
          const forces = deriveForces(result, id, step)
          const netRow = forces.find((f) => f.kind === 'net')
          const body = forces.filter((f) => f.kind !== 'net')
          return (
            <section key={id}>
              <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tr.color }} />
                {tr.label}
                <span
                  className={`rounded px-1 py-px text-[10px] font-normal ${
                    tr.mode === 'analytic' ? 'bg-sky-50 text-sky-600' : tr.mode === 'numeric' ? 'bg-violet-50 text-violet-600' : 'bg-slate-100 text-slate-500'
                  }`}
                  title={tr.mode === 'analytic' ? '解析求解（闭式公式，无积分误差）' : tr.mode === 'numeric' ? '数值积分（Velocity Verlet）' : '静止'}
                >
                  {tr.mode === 'analytic' ? '解析' : tr.mode === 'numeric' ? '数值' : '静止'}
                </span>
              </h4>
              {body.length === 0 && (
                <p className="py-1 text-[11px] text-slate-400">
                  当前时刻没有受力（无重力/接触场景）
                </p>
              )}
              <ul className="space-y-0.5">
                {body.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[11px] text-slate-700 odd:bg-slate-50"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-sm" style={{ backgroundColor: FORCE_COLORS[f.kind] }} />
                    <span className="w-14 shrink-0 text-slate-500">{KIND_LABEL[f.kind]}</span>
                    <span className="flex-1 tabular-nums">
                      {fmtNum(f.magnitude, 0.01)} N
                      <span className="ml-1.5 text-[10px] text-slate-400">{dirLabel(f.f.x, f.f.y)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {netRow && netRow.magnitude > 1e-9 && (
                <p className="mt-1 flex items-center gap-2 border-t border-dashed border-slate-200 px-1.5 pt-1 text-[11px] text-slate-800">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-sm" style={{ backgroundColor: FORCE_COLORS.net }} />
                  <span className="w-14 shrink-0 font-medium">合力</span>
                  <span className="tabular-nums">
                    {fmtNum(netRow.magnitude, 0.01)} N
                    <span className="ml-1.5 text-[10px] text-slate-400">{dirLabel(netRow.f.x, netRow.f.y)}</span>
                  </span>
                </p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
})
