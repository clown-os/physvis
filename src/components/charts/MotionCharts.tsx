// 联动图表：x-t / v-t / a-t（每物体分量 x 实线 + y 虚线，颜色跟随物体身份）。
// 时间游标是 DOM overlay（每帧读 Chart scale 像素 → transform 移动 div，零 canvas 重绘），
// 点击图表任意处 → 就近 0.01s 网格 → seek。
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import {
  Chart as ChartJS,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Legend,
  Tooltip,
  type ActiveElement,
  type ChartEvent,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import type { Chart, ChartDataset } from 'chart.js'
import type { EngineResult } from '../../engine/types'
import { ENGINE_DT } from '../../engine/types'
import { useSimulationStore } from '../../stores/simulationStore'
import { useSimulationLoop } from '../../render/useSimulationLoop'
import { trackSeries, type Quantity, type SeriesPoint } from './series'

ChartJS.register(LineController, LineElement, PointElement, LinearScale, Legend, Tooltip)
ChartJS.defaults.font.family = `-apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`
ChartJS.defaults.font.size = 11

interface Variant {
  title: string
  unit: string
  /** [x 分量物理量, y 分量物理量] —— 顺带决定图例分量名 */
  pair: [Quantity, Quantity]
  compLabel: [string, string]
}

const VARIANTS: Record<'position' | 'velocity' | 'accel', Variant> = {
  position: { title: '位置 (x-t)', unit: 'm', pair: ['px', 'py'], compLabel: ['x', 'y'] },
  velocity: { title: '速度 (v-t)', unit: 'm/s', pair: ['vx', 'vy'], compLabel: ['vx', 'vy'] },
  accel: { title: '加速度 (a-t)', unit: 'm/s²', pair: ['ax', 'ay'], compLabel: ['ax', 'ay'] },
}

/** 刻度/数值短格式化（图表空间小，不追求多余小数位） */
function fmt(v: number): string {
  const a = Math.abs(v)
  if (a !== 0 && a < 0.001) return v.toExponential(1)
  if (a >= 1000) return String(Math.round(v))
  return String(Number(v.toFixed(2)))
}

function tickFmt(v: number | string): string {
  const n = Number(v)
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n))
  return String(Number(n.toFixed(1)))
}

interface PlotProps {
  result: EngineResult
  variant: Variant
}

function Plot({ result, variant }: PlotProps) {
  const [chart, setChart] = useState<Chart<'line'> | null>(null)
  const lineRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLSpanElement>(null)

  // 时间游标：每帧把 overlay 移到当前 simTime 的像素位置（不重绘 canvas）。
  const onFrame = useCallback(
    (t: number) => {
      const el = lineRef.current
      const chip = chipRef.current
      const xs = chart?.scales.x
      if (!el || !chip) return
      if (chart && xs) el.style.transform = `translateX(${xs.getPixelForValue(t)}px)`
      chip.textContent = `t = ${t.toFixed(2)} s`
    },
    [chart],
  )
  useSimulationLoop(onFrame, !!chart)

  const maxT = result.duration

  const data = useMemo(() => {
    const ds: ChartDataset<'line', SeriesPoint[]>[] = []
    for (const id of result.order) {
      const tr = result.tracks[id]!
      const mk = (q: Quantity, label: string, dash: number[] | undefined): ChartDataset<'line', SeriesPoint[]> => ({
        label: `${tr.label}·${label}`,
        data: trackSeries(result, id, q),
        borderColor: tr.color,
        backgroundColor: tr.color,
        borderDash: dash,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0,
      })
      ds.push(mk(variant.pair[0], variant.compLabel[0], undefined))
      ds.push(mk(variant.pair[1], variant.compLabel[1], [6, 4]))
    }
    return { datasets: ds }
  }, [result, variant])

  const options = useMemo<Parameters<typeof Line>[0]['options']>(() => {
    const seekFromPixel = (_e: ChartEvent, _els: ActiveElement[], c: Chart<'line'>): void => {
      const xs = c.scales.x
      if (!xs) return
      const t = xs.getValueForPixel(_e.x ?? 0)
      if (t !== undefined && Number.isFinite(t)) {
        useSimulationStore.getState().seek(Math.round(t / ENGINE_DT) * ENGINE_DT)
      }
    }
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      onClick: seekFromPixel,
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: maxT,
          grid: { color: '#eef2f7' },
          border: { color: '#cbd5e1' },
          ticks: {
            color: '#64748b',
            maxTicksLimit: 8,
            callback: tickFmt,
          },
        },
        y: {
          type: 'linear',
          grid: { color: '#eef2f7' },
          border: { color: '#cbd5e1' },
          ticks: { color: '#64748b', maxTicksLimit: 6, callback: tickFmt },
        },
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: {
            color: '#475569',
            boxWidth: 14,
            boxHeight: 2,
            padding: 10,
            usePointStyle: false,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.92)',
          padding: { x: 10, y: 7 },
          cornerRadius: 6,
          titleColor: '#e2e8f0',
          bodyColor: '#f1f5f9',
          displayColors: true,
          boxWidth: 10,
          boxHeight: 10,
          callbacks: {
            title: (items) => `t = ${fmt(items[0]!.parsed.x ?? 0)} s`,
            label: (ctx) =>
              `${ctx.dataset.label} = ${fmt(ctx.parsed.y ?? 0)} ${variant.unit}`,
          },
        },
      },
    }
  }, [maxT, variant])

  return (
    <div className="relative h-44 rounded-lg border border-slate-200 bg-white px-2 pb-1 pt-2">
      <div className="pointer-events-none absolute inset-0 z-10">
        {/* 时间游标竖线（DOM transform，不触发 canvas 重绘） */}
        <div ref={lineRef} className="absolute inset-y-0 w-px bg-slate-400 opacity-70" style={{ left: 0 }} />
      </div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-600">
          {variant.title}
          <span className="ml-1 font-normal text-slate-400">{variant.unit}</span>
        </span>
        <span ref={chipRef} className="tabular-nums text-slate-500">
          t = 0.00 s
        </span>
      </div>
      <div className="relative h-[calc(100%-1.5rem)]">
        <Line
          ref={(inst) => setChart(inst ?? null)}
          data={data}
          options={options}
        />
      </div>
    </div>
  )
}

export const MotionCharts = memo(function MotionCharts() {
  const result = useSimulationStore((s) => s.result)
  if (!result || result.steps < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
        暂无模拟数据 —— 先输入一道题目开始模拟
      </div>
    )
  }
  return (
    <div className="space-y-3" data-testid="motion-charts">
      <Plot result={result} variant={VARIANTS.position} />
      <Plot result={result} variant={VARIANTS.velocity} />
      <Plot result={result} variant={VARIANTS.accel} />
      <p className="px-1 text-xs leading-relaxed text-slate-400">
        点击任意图表可把播放头跳到该时刻；实线 = x 分量，虚线 = y 分量。
      </p>
    </div>
  )
})
