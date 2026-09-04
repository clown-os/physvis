// 二维向量运算（引擎与渲染共用，纯函数，无副作用）

export interface Vec2 {
  x: number
  y: number
}

export const vec = (x: number, y: number): Vec2 => ({ x, y })

export const vAdd = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const vSub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const vMul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const vDiv = (a: Vec2, s: number): Vec2 => ({ x: a.x / s, y: a.y / s })
export const vNeg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y })

export const vDot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const vCross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x

/** 模长的平方（避免开方） */
export const vLen2 = (a: Vec2): number => a.x * a.x + a.y * a.y
export const vLen = (a: Vec2): number => Math.hypot(a.x, a.y)
/** 两点距离 */
export const vDist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const vDist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** 单位向量（零向量返回 (1,0)） */
export const vNorm = (a: Vec2): Vec2 => {
  const l = vLen(a)
  return l < 1e-12 ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l }
}

/** 逆时针旋转 90°（y 向上坐标系下的"左法向"） */
export const vPerp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x })

export const vFromAngle = (rad: number): Vec2 => ({ x: Math.cos(rad), y: Math.sin(rad) })
export const vAngleOf = (a: Vec2): number => Math.atan2(a.y, a.x)

/** 把向量 b 投影到 a 上（返回沿 a 的分量，a 需非零） */
export const vProject = (a: Vec2, b: Vec2): Vec2 => {
  const l2 = vLen2(a)
  if (l2 < 1e-16) return { x: 0, y: 0 }
  const t = vDot(a, b) / l2
  return { x: a.x * t, y: a.y * t }
}

export const vRotate = (a: Vec2, rad: number): Vec2 => {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export const vClone = (a: Vec2): Vec2 => ({ x: a.x, y: a.y })
export const vZero: Vec2 = { x: 0, y: 0 }

/** 近似相等（物理引擎断言/测试用） */
export const vAlmostEq = (a: Vec2, b: Vec2, eps = 1e-9): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps
