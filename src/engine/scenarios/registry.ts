// 场景模板注册表：模板 = 参数化场景工厂（教科书演示用）。
// 每个模板 create() 返回一个全新实例：{ def, params }——
// def 是可序列化的 ScenarioDefinition（唯一事实源），
// params 是参数面板元数据（ParamDef：read 从 def 读当前值，apply 返回新 def）。
import type { ScenarioDefinition, ParamDef } from '../types'

export interface ScenarioTemplate {
  id: string
  title: string
  emoji: string
  /** 教材章节位（P0=核心教学场景，P1=进阶模板，P2=高考电磁场与综合模型） */
  category: 'p0' | 'p1' | 'p2'
  description: string
  /** 新建一个模板实例（每次调用返回独立对象，可反复实例化） */
  create: () => { def: ScenarioDefinition; params: ParamDef[] }
}

export interface TemplateInstance {
  templateId: string
  title: string
  def: ScenarioDefinition
  params: ParamDef[]
}

const templates = new Map<string, ScenarioTemplate>()

export function registerTemplate(t: ScenarioTemplate): void {
  templates.set(t.id, t)
}

export function getTemplate(id: string): ScenarioTemplate | undefined {
  return templates.get(id)
}

export function listTemplates(category?: 'p0' | 'p1' | 'p2'): ScenarioTemplate[] {
  const all = [...templates.values()]
  return (category ? all.filter((t) => t.category === category) : all).sort(
    (a, b) => a.title.localeCompare(b.title, 'zh'),
  )
}

export function instantiate(templateId: string): TemplateInstance | null {
  const t = templates.get(templateId)
  if (!t) return null
  const { def, params } = t.create()
  return {
    templateId,
    title: def.title ?? t.title,
    def: { ...def, templateId, title: def.title ?? t.title },
    params,
  }
}

/** 按 key→value 链式应用参数（示例题/持久化恢复用）；未知 key 忽略 */
export function applyValues(
  def: ScenarioDefinition,
  params: ParamDef[],
  values: Record<string, number>,
): ScenarioDefinition {
  let d = def
  for (const [k, v] of Object.entries(values)) {
    const p = params.find((pp) => pp.key === k)
    if (p) d = p.apply(d, v)
  }
  return d
}
