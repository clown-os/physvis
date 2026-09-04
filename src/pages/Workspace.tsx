// 工作区（单页应用主界面）：
// 左 = 画布（SimulationCanvas）+ 播放时间轴；右 = 问题输入 + 参数/受力/图表 Tab；
// 顶栏 = 场景名 + 示例题/模板库/设置入口；挂载时按需自动弹校正窗。
import { memo, useCallback, useEffect, useRef } from 'react'
import SimulationCanvas from '../render/SimulationCanvas'
import type { CanvasHandle } from '../render/SimulationCanvas'
import { Timeline } from '../components/Timeline'
import { ProblemInput } from '../components/ProblemInput'
import { ParamPanel } from '../components/ParamPanel'
import { ForcePanel } from '../components/ForcePanel'
import { ExplanationPanel } from '../components/ExplanationPanel'
import { MotionCharts } from '../components/charts/MotionCharts'
import { TemplateLibrary, ExamplePicker, type ExampleUse } from '../components/LibraryDialogs'
import { CorrectionModal } from '../components/CorrectionModal'
import { SettingsDialog } from '../components/SettingsDialog'
import { SegTabs } from '../components/ui'
import { useSimulationStore } from '../stores/simulationStore'
import { useUIStore } from '../stores/uiStore'
import { useProblemStore } from '../stores/problemStore'
import { useSettingsStore } from '../stores/settingsStore'
import { instantiate, applyValues, type TemplateInstance } from '../engine/scenarios'
import { EXAMPLE_PROBLEMS, type ExampleProblem } from '../examples/problems'
import { runParseFlow } from '../ai/flow'

function sceneFromTemplate(templateId: string): TemplateInstance | null {
  return instantiate(templateId)
}

function sceneFromExample(ex: ExampleProblem): TemplateInstance {
  const inst = instantiate(ex.templateId)!
  const def = ex.values ? applyValues(inst.def, inst.params, ex.values) : inst.def
  return { templateId: ex.templateId, title: ex.title, def, params: inst.params }
}

const INTRO = '输入一道物理题让 AI 建模并播放，或从右侧示例/模板直接开始；参数、受力、v-t/x-t/a-t 图表与动画实时联动。'

const WorkspaceInner = memo(function WorkspaceInner() {
  const def = useSimulationStore((s) => s.def)
  const loadScene = useSimulationStore((s) => s.loadScene)
  const setLastScene = useSettingsStore((s) => s.setLastScene)
  const introSeen = useSettingsStore((s) => s.introSeen)
  const markIntroSeen = useSettingsStore((s) => s.markIntroSeen)

  const tab = useUIStore((s) => s.tab)
  const setTab = useUIStore((s) => s.setTab)
  const dialog = useUIStore((s) => s.dialog)
  const openDialog = useUIStore((s) => s.openDialog)
  const closeDialog = useUIStore((s) => s.closeDialog)
  const needsCorrection = useProblemStore((s) => s.needsCorrection)
  const parsing = useProblemStore((s) => s.parsing)
  const resetFlow = useProblemStore((s) => s.resetFlow)

  const canvasHandle = useRef<CanvasHandle | null>(null)
  const booted = useRef(false)

  /**
   * 启动引导（整个应用生命周期只跑一次）：
   * 优先恢复上次会话的场景（模板/示例），否则载入首个内置示例题开箱即演示。
   */
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    const sim = useSimulationStore.getState()
    if (sim.def || sim.result) return // 场景已被（测试等）外部载入
    const problem = useProblemStore.getState()
    const last = useSettingsStore.getState().lastSceneId
    if (last) {
      const ex = EXAMPLE_PROBLEMS.find((e) => e.id === last)
      const inst = ex ? sceneFromExample(ex) : instantiate(last)
      if (inst) {
        sim.loadScene(inst.def, inst.params, {
          sceneId: ex?.id ?? last,
          problemText: ex?.text ?? null,
          solution: ex?.solution ?? null,
        })
        if (ex) problem.setText(ex.text, 'example')
        else problem.resetFlow()
        return
      }
    }
    const first = EXAMPLE_PROBLEMS[0]!
    const inst = sceneFromExample(first)
    sim.loadScene(inst.def, inst.params, { sceneId: first.id, problemText: first.text, solution: first.solution ?? null })
    problem.setText(first.text, 'example')
    useSettingsStore.getState().setLastScene(first.id, first.text)
  }, [])

  // —— 解析完成但置信不足 / 解析失败 → 弹校正窗（用户关闭即放弃，不会重复弹出） ——
  useEffect(() => {
    const ui = useUIStore.getState()
    if (
      useProblemStore.getState().needsCorrection &&
      !useProblemStore.getState().parsing &&
      ui.dialog !== 'correction'
    ) {
      openDialog('correction')
    }
  }, [needsCorrection, parsing, openDialog])

  // —— Ctrl+Z / Ctrl+Y 撤销重做（输入框中不拦截） ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        useSimulationStore.getState().undo()
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault()
        useSimulationStore.getState().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // —— 场景载入 helpers（供弹窗使用） ——
  const loadTemplate = useCallback(
    (templateId: string) => {
      const inst = sceneFromTemplate(templateId)
      if (!inst) return
      loadScene(inst.def, inst.params, { sceneId: templateId, problemText: null })
      setLastScene(templateId)
      resetFlow()
      closeDialog()
      setTab('params')
    },
    [loadScene, setLastScene, resetFlow, closeDialog, setTab],
  )

  const useExample: ExampleUse = useCallback(
    (ex, mode) => {
      const st = useSimulationStore.getState()
      if (mode === 'instant') {
        const inst = sceneFromExample(ex)
        st.loadScene(inst.def, inst.params, { sceneId: ex.id, problemText: ex.text, solution: ex.solution ?? null })
        useProblemStore.getState().setText(ex.text, 'example')
        setLastScene(ex.id, ex.text)
      } else {
        // AI 解析演示：以 mock 为主的离线通道也能全流程
        useProblemStore.getState().setText(ex.text, 'example')
      }
      closeDialog()
      if (mode === 'ai') void runParseFlow()
    },
    [setLastScene, closeDialog],
  )

  const sceneTitle = def?.title ?? 'PhysVis · 高中物理运动可视化'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ============ 顶栏 ============ */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 shadow-sm">
        <div className="flex items-baseline gap-2">
          <h1 className="text-[15px] font-bold tracking-tight text-slate-800">
            Phys<span className="text-blue-600">Vis</span>
          </h1>
          <span className="hidden text-[10px] font-medium uppercase tracking-widest text-slate-300 lg:inline">
            高中物理 · 运动可视化
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-slate-600">{sceneTitle}</p>
        </div>
        <nav className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            title="复位视角（双击画布亦可）"
            onClick={() => canvasHandle.current?.resetView()}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            ⌖ 视角复位
          </button>
          <button type="button" onClick={() => openDialog('examples')} className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
            示例题
          </button>
          <button type="button" onClick={() => openDialog('templates')} className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
            模板库
          </button>
          <button type="button" onClick={() => openDialog('settings')} title="AI 通道与 Key 配置" className="rounded-md px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            ⚙
          </button>
        </nav>
      </header>

      {/* ============ 首次引导横幅 ============ */}
      {!introSeen && (
        <div className="flex items-center gap-2 border-b border-blue-100 bg-blue-50/70 px-4 py-1.5 text-[11px] text-blue-700">
          <span className="flex-1">{INTRO}</span>
          <button
            type="button"
            onClick={() => markIntroSeen()}
            className="shrink-0 rounded px-1.5 py-0.5 text-blue-500 hover:bg-blue-100"
          >
            知道了
          </button>
        </div>
      )}

      {/* ============ 主体 ============ */}
      <main className="flex min-h-0 flex-1 gap-3 p-3">
        {/* 左：画布 + 时间轴 */}
        <section className="flex min-w-0 flex-[3] flex-col gap-2">
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-sm">
            <SimulationCanvas onReady={(h) => (canvasHandle.current = h)} />
          </div>
          <Timeline />
        </section>

        {/* 右：输入 + Tab 面板 */}
        <aside className="flex w-[24.5rem] shrink-0 flex-col gap-2 xl:w-[27rem]">
          <ProblemInput />
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="px-3 pt-2.5">
              <SegTabs
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: 'params', label: '⚙ 参数', hint: '场景参数实时调节（支持 Ctrl+Z/Y）' },
                  { id: 'forces', label: '🪃 受力分析', hint: '当前时刻受力分解与视图开关' },
                  { id: 'charts', label: '📈 图表', hint: 'x-t / v-t / a-t 联动（点击可跳转播放头）' },
                  { id: 'explain', label: '📖 讲解', hint: '分步解题讲解与画面同步（可开慢放）' },
                ]}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {tab === 'params' && <ParamPanel />}
              {tab === 'forces' && <ForcePanel />}
              {tab === 'charts' && <MotionCharts />}
              {tab === 'explain' && <ExplanationPanel />}
            </div>
          </div>
          <p className="px-1 text-center text-[10px] leading-relaxed text-slate-300">
            滚轮缩放 · 拖拽平移 · 双击复位视角 · 参数撤销 Ctrl+Z
          </p>
        </aside>
      </main>

      {/* ============ 弹窗 ============ */}
      {dialog === 'examples' && <ExamplePicker onClose={closeDialog} onUse={useExample} />}
      {dialog === 'templates' && <TemplateLibrary onClose={closeDialog} onUse={loadTemplate} />}
      {dialog === 'correction' && <CorrectionModal onClose={closeDialog} />}
      {dialog === 'settings' && <SettingsDialog onClose={closeDialog} />}
    </div>
  )
})

export default function Workspace(): React.JSX.Element {
  return <WorkspaceInner />
}
