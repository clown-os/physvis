// 参数面板：所有滑块/数值框直接作用于场景定义（apply → 同步重算 → 图表/画布联动）。
// 撤销/重做作用在定义快照上（Ctrl+Z/Y 见 Workspace）。
import { memo, useState } from 'react'
import type { ParamDef, ScenarioDefinition } from '../engine/types'
import { useSimulationStore } from '../stores/simulationStore'
import { useProblemStore } from '../stores/problemStore'
import { useUIStore } from '../stores/uiStore'
import { Button, fmtNum } from './ui'

const GROUP_NAME: Record<string, string> = { world: '环境 · 世界', field: '电磁场' }

function ParamRow({ p, def, objLabel }: { p: ParamDef; def: ScenarioDefinition; objLabel?: string }) {
  const value = p.read(def)
  const applyParam = useSimulationStore((s) => s.applyParam)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? fmtNum(value, p.step)

  const commitDraft = (): void => {
    if (draft === null) return
    const v = Number(draft)
    if (Number.isFinite(v)) applyParam(p, Math.min(p.max, Math.max(p.min, v)))
    setDraft(null)
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') commitDraft()
    if (e.key === 'Escape') setDraft(null)
  }

  return (
    <div className="group">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-slate-600">
          {objLabel ? <span className="mr-1 font-medium text-slate-700">{objLabel}</span> : null}
          {p.label}
        </span>
        <div className="flex items-center gap-1">
          <input
            aria-label={p.label}
            inputMode="decimal"
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={onKey}
            className="w-16 rounded border border-transparent bg-transparent px-1 py-0 text-right text-xs tabular-nums text-slate-800 transition-colors hover:border-slate-200 focus:border-blue-400 focus:bg-white focus:outline-none"
          />
          {p.unit && <span className="w-8 shrink-0 text-[10px] text-slate-400">{p.unit}</span>}
        </div>
      </div>
      <input
        type="range"
        aria-label={`${p.label} 滑块`}
        min={p.min}
        max={p.max}
        step={p.step}
        value={Math.min(p.max, Math.max(p.min, value))}
        onChange={(e) => {
          setDraft(null)
          applyParam(p, Number(e.target.value))
        }}
        className="mt-0.5 h-1.5 w-full accent-blue-600"
      />
    </div>
  )
}

export const ParamPanel = memo(function ParamPanel() {
  const def = useSimulationStore((s) => s.def)
  const params = useSimulationStore((s) => s.params)
  const canUndo = useSimulationStore((s) => s.past.length > 0)
  const canRedo = useSimulationStore((s) => s.future.length > 0)
  const undo = useSimulationStore((s) => s.undo)
  const redo = useSimulationStore((s) => s.redo)
  const resetParams = useSimulationStore((s) => s.resetParams)
  const lastSolveMs = useUIStore((s) => s.lastSolveMs)
  const notice = useProblemStore((s) => s.notice)
  const setNotice = useProblemStore((s) => s.setNotice)

  if (!def) {
    return (
      <p className="py-8 text-center text-xs text-slate-400">
        尚未载入场景 —— 输入题目解析、选一个示例题或模板开始
      </p>
    )
  }

  // 物体颜色与 label 查表
  const objInfo = new Map(def.objects.map((o) => [o.id, { label: o.label ?? o.id, color: o.color }]))
  // 分组：world 在前，其后按物体出现顺序
  const groups = new Map<string, ParamDef[]>()
  for (const p of params) {
    const key = p.group === 'world' ? 'world' : p.group
    const arr = groups.get(key)
    if (arr) arr.push(p)
    else groups.set(key, [p])
  }
  const groupOrder = ['world', ...def.objects.map((o) => o.id)].filter((g) => groups.has(g))

  return (
    <div className="space-y-4 px-1 py-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">参数调节</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" disabled={!canUndo} onClick={undo} title="撤销 (Ctrl+Z)">
            ↺ 撤销
          </Button>
          <Button variant="ghost" size="sm" disabled={!canRedo} onClick={redo} title="重做 (Ctrl+Y)">
            ↻ 重做
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!canUndo}
            onClick={resetParams}
            title="恢复该场景的原始参数"
          >
            复位
          </Button>
        </div>
      </div>

      {lastSolveMs > 0 && (
        <p className="text-right text-[10px] tabular-nums text-slate-300">重算耗时 {lastSolveMs.toFixed(1)} ms</p>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="mt-px">💡</span>
          <div className="flex-1 whitespace-pre-line leading-relaxed">{notice}</div>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)} className="text-amber-400 hover:text-amber-600">
            ✕
          </button>
        </div>
      )}

      {groupOrder.map((g) => {
        const items = groups.get(g)!
        const info = objInfo.get(g)
        return (
          <section key={g} className="space-y-3">
            <h4 className="flex items-center gap-1.5 border-b border-slate-100 pb-1 text-xs font-semibold text-slate-700">
              {info ? (
                <>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: info.color }} />
                  {info.label}
                  <span className="font-normal text-slate-400">({g})</span>
                </>
              ) : (
                GROUP_NAME[g] ?? g
              )}
            </h4>
            {items.map((p) => (
              <ParamRow key={p.key} p={p} def={def} />
            ))}
          </section>
        )
      })}
    </div>
  )
})
