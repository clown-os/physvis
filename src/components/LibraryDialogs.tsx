// 模板库 + 示例题两个选择弹窗：一键实例化（不经 AI），随时开始演示。
import { listTemplates } from '../engine/scenarios'
import { EXAMPLE_PROBLEMS } from '../examples/problems'
import type { ExampleProblem } from '../examples/problems'
import { Modal, cx } from './ui'

export type TemplateUse = (templateId: string) => void
export type ExampleUse = (ex: ExampleProblem, mode: 'instant' | 'ai') => void

const CAT_TITLE: Record<string, string> = {
  自由落体: '🕐 匀变速·落体',
  竖直上抛: '🕐 匀变速·落体',
  平抛斜抛: '🕐 匀变速·落体',
  匀变速直线: '🕐 匀变速·落体',
  匀速圆周: '🔄 曲线运动',
  简谐运动: '📈 振动',
  单摆: '📈 振动',
  斜面: '📐 接触与摩擦',
  传送带: '📐 接触与摩擦',
  碰撞: '💥 多物体',
  追及相遇: '💥 多物体',
  电磁场: '⚡ 电磁场',
  圆环与竖直圆周: '⭕ 圆环与竖直圆周',
  弹簧与板块: '🧱 弹簧与板块',
}

export function TemplateLibrary({ onClose, onUse }: { onClose: () => void; onUse: TemplateUse }) {
  const p0 = listTemplates('p0')
  const p1 = listTemplates('p1')
  const p2 = listTemplates('p2')
  const Card = ({ t }: { t: (typeof p2)[number] }) => (
    <button
      type="button"
      onClick={() => onUse(t.id)}
      className="flex flex-col items-start gap-1 rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40"
    >
      <span className="text-lg leading-none">{t.emoji}</span>
      <span className="text-sm font-medium text-slate-800">{t.title}</span>
      <span className="text-[11px] leading-relaxed text-slate-500">{t.description}</span>
    </button>
  )
  const Section = ({ badge, items }: { badge: string; items: ReturnType<typeof listTemplates> }) => (
    <section>
      <h4 className="mb-2 text-xs font-semibold text-slate-500">{badge}</h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{items.map((t) => <Card key={t.id} t={t} />)}</div>
    </section>
  )
  return (
    <Modal
      title="场景模板库"
      subtitle="教科书核心演示场景：一键生成，之后可在右侧参数面板任意调节"
      onClose={onClose}
      wide
      footer={
        <span className="text-[11px] text-slate-400">
          P0 = 核心教学场景 · P1 = 进阶模板（碰撞/追及/摩擦） · P2 = 高考电磁场与综合模型
        </span>
      }
    >
      <div className="space-y-5">
        <Section badge="📖 P0 · 核心教学场景（匀变速 / 曲线 / 振动）" items={p0} />
        <Section badge="🔧 P1 · 进阶模板（接触摩擦 / 多物体）" items={p1} />
        <Section badge="⚡ P2 · 高考电磁场与综合模型（带电粒子 / 圆环 / 竖直圆周 / 板块）" items={p2} />
      </div>
    </Modal>
  )
}

export function ExamplePicker({ onClose, onUse }: { onClose: () => void; onUse: ExampleUse }) {
  const groups = new Map<string, ExampleProblem[]>()
  for (const ex of EXAMPLE_PROBLEMS) {
    const cat = CAT_TITLE[ex.category] ?? ex.category
    const arr = groups.get(cat)
    if (arr) arr.push(ex)
    else groups.set(cat, [ex])
  }
  return (
    <Modal
      title="内置示例题"
      subtitle="与模板库不同：这里是完整「题干 + 参考答案」。mock 通道可离线演示 AI 解析流程"
      onClose={onClose}
      wide
    >
      <div className="space-y-5">
        {[...groups.entries()].map(([cat, items]) => (
          <section key={cat}>
            <h4 className="mb-2 text-xs font-semibold text-slate-500">{cat}</h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {items.map((ex) => (
                <article key={ex.id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h5 className="text-sm font-medium text-slate-800">{ex.title}</h5>
                    <span className="text-[10px] tracking-wider text-amber-500">
                      {'★'.repeat(ex.difficulty)}
                      <span className="text-slate-200">{'★'.repeat(3 - ex.difficulty)}</span>
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">{ex.text}</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onUse(ex, 'instant')}
                      className="rounded-md bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-700"
                    >
                      ▶ 直接演示
                    </button>
                    <button
                      type="button"
                      onClick={() => onUse(ex, 'ai')}
                      title="把题干喂给 AI 通道解析（本地演示模式也支持；低置信题会弹出人工校正窗口）"
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
                    >
                      ⚡ AI 解析演示
                    </button>
                    <span
                      className={cx(
                        'ml-auto text-[10px]',
                        ex.mockConfidence !== undefined && ex.mockConfidence < 0.7
                          ? 'rounded bg-amber-50 px-1.5 py-px text-amber-600'
                          : 'text-slate-300',
                      )}
                      title={ex.answer}
                    >
                      {ex.mockConfidence !== undefined && ex.mockConfidence < 0.7 ? '演示人工校正' : ''}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  )
}
