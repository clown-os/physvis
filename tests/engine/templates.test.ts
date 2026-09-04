// 场景模板冒烟测试：每个模板必须能实例化 + 引擎可解 + 事件/基本物理成立。
import { describe, expect, it } from 'vitest'
import { run, readTrack } from '../../src/engine/Engine'
import { listTemplates, instantiate } from '../../src/engine/scenarios'
import { EXAMPLE_PROBLEMS } from '../../src/examples/problems'

describe('模板实例化冒烟', () => {
  const templates = listTemplates()
  it('注册表含 P0 与 P1 模板', () => {
    expect(templates.length).toBeGreaterThanOrEqual(8)
    expect(listTemplates('p0').length).toBeGreaterThanOrEqual(5)
    expect(listTemplates('p1').length).toBeGreaterThanOrEqual(3)
  })

  it.each(templates.map((t) => [t.id, t.title] as const))('%s：实例化 + 引擎可解', (_id, _title) => {
    const inst = instantiate(_id)
    expect(inst).not.toBeNull()
    const r = run(inst!.def)
    expect(r.steps).toBeGreaterThan(10)
    expect(r.tracks).toBeDefined()
    expect(r.order.length).toBe(inst!.def.objects.length)
    // 每个物体轨道步数一致（统一网格）
    const sizes = new Set(r.order.map((id) => r.tracks[id]!.data.length))
    expect(sizes.size).toBe(1)
    // 无 NaN 采样
    for (const id of r.order) {
      const d = r.tracks[id]!.data
      for (let i = 0; i < d.length; i += 6) {
        expect(Number.isFinite(d[i]!)).toBe(true)
        expect(Number.isFinite(d[i + 1]!)).toBe(true)
      }
    }
  })
})

describe('示例题 → 模板实例物理验证', () => {
  it.each(
    EXAMPLE_PROBLEMS.filter((p) => p.templateId === 'collision' || p.templateId === 'pursuit'),
  )('$title（碰撞动量/追及事件）', (p) => {
    const inst = instantiate(p.templateId)!
    const def = p.values
      ? (() => {
          let d = inst.def
          for (const [k, v] of Object.entries(p.values!)) {
            const pp = inst.params.find((x) => x.key === k)
            if (pp) d = pp.apply(d, v)
          }
          return d
        })()
      : inst.def
    const r = run(def, { duration: 30 })

    if (p.templateId === 'collision') {
      // 动量守恒（1kg 球撞静止球：vA→0，vB→v0）
      const endA = readTrack(r.tracks.A!.data, r.steps - 1)
      const endB = readTrack(r.tracks.B!.data, r.steps - 1)
      const mA = def.objects.find((o) => o.id === 'A')!.mass
      const mB = def.objects.find((o) => o.id === 'B')!.mass
      const p0 = mA * 4 // B 静止，初动量贡献为 0
      const p1 = mA * endA.vx + mB * endB.vx
      expect(p1).toBeCloseTo(p0, 5)
      expect(r.events.some((e) => e.kind === 'collision')).toBe(true)
    }
    if (p.templateId === 'pursuit') {
      // 经典"追不上"题：无 meet 事件；速度相等时刻 t = v/a = 6s 距离最近
      const meet = r.events.find((e) => e.kind === 'meet')
      expect(meet).toBeUndefined()
      const idx6 = Math.round(6 / r.dt)
      const a = readTrack(r.tracks.A!.data, idx6)
      const b = readTrack(r.tracks.B!.data, idx6)
      const gap = b.x - a.x
      // 最近距离 ≈ 64 m（初始 100，A 走 72，B 走 36）
      expect(gap).toBeCloseTo(64, 0)
    }
  })
})
