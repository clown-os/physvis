// 物理引擎核心类型定义（纯类型，无运行时逻辑；引擎模块零 React / DOM 依赖）
import type { Vec2 } from './vec'

/* ============ 运动模式 ============ */

/**
 * 解析解（闭式）模式：运动方程可解析求值，采样零积分误差。
 * 分段的"事件后状态"（如落地静止）由 analytic.ts 的分段求值器处理。
 */
export type MotionMode =
  /** 匀变速运动（含平抛/斜抛/自由落体/竖直上抛/直线往返）：a 为常量加速度 */
  | { kind: 'kinematic'; a: Vec2; landOnGround: boolean }
  /** 匀速圆周运动：p(t) = center + r·(cos(ωt+φ), sin(ωt+φ)) */
  | { kind: 'circular'; center: Vec2; radius: number; omega: number; phi0: number }
  /** 简谐振动（弹簧振子，沿 axis 直线）：位移 s(t) = A·cos(ωt+φ) */
  | { kind: 'harmonic'; axis: Vec2; equilibrium: Vec2; amplitude: number; omega: number; phi0: number }
  /** 单摆（小角度近似）：θ(t) = θ0·cos(ωt+φ)，ω = √(g/L) */
  | {
      kind: 'pendulum'
      pivot: Vec2
      length: number
      theta0: number
      omega: number
      phi0?: number
      direction: 1 | -1
    }
  /**
   * 数值积分模式：存在非闭式外力（空气阻力、接触面摩擦、传送带、碰撞、约束等）。
   * 求解器：Velocity Verlet，固定 dt = 0.01s。
   */
  | { kind: 'numeric'; spec: NumericSpec }
  /** 静止质点（如悬挂支架等装饰物） */
  | { kind: 'static' }

/** 数值模式的额外环境交互 */
export interface NumericSpec {
  /** 线性空气阻力 F = -k·v（k = 阻尼系数 N·s/m） */
  drag?: { k: number }
  /** 接触面：地面（y = ground.y）、斜面/传送带平面或圆环内壁 */
  contact?: ContactFloor | ContactPlane | ContactCircle
  /**
   * 与另一物体的连接弹簧（成对力，双方均须数值模式）：
   * 对声明方施加 F = -k·(d - restLength)·(p_self - p_other)/d，等大反向自动守恒。
   */
  spring?: { otherId: string; k: number; restLength: number }
}

export interface ContactFloor {
  type: 'floor'
  /** 恢复系数 0~1（0 = 完全非弹性，1 = 完全弹性） */
  restitution: number
  /** 摩擦系数 μ（静/动合一，教学近似） */
  friction: number
}

/** 斜面（含传送带）接触：平面过原点，倾角 angle（0 = 水平），法向朝上 */
export interface ContactPlane {
  type: 'plane'
  /** 倾角，弧度（与 +x 夹角；0 = 水平面） */
  angle: number
  friction: number
  /** 传送带：沿平面 +u 方向的带速（m/s），undefined = 静止斜面 */
  beltSpeed?: number
  /**
   * 附在另一数值体上的动态平面（板块模型）：仅支持水平（angle=0）。
   * 平面位于锚体上表面（y = anchor.y + anchor.radius）并随锚体平移，
   * 带速 = 锚体沿面速度；摩擦力等大反向作用于锚体（动量守恒）。
   */
  anchorId?: string
}

/** 圆环内壁接触：物体约束在半径 radius 的圆内（球心距 ≤ radius - 物体半径） */
export interface ContactCircle {
  type: 'circle'
  /** 圆环圆心（世界坐标） */
  center: Vec2
  /** 环半径（内壁，m） */
  radius: number
  /** 恢复系数 0~1 */
  restitution: number
  /** 壁摩擦系数 μ（0 = 光滑，缺省 0） */
  friction?: number
}

/** 空间电磁场区域：rect 缺省 = 全空间；可叠加多区域（如质谱仪左电场右磁场） */
export interface FieldRegion {
  /** 矩形区域（世界坐标）；缺省覆盖全空间 */
  rect?: { minX: number; maxX: number; minY: number; maxY: number }
  /** 匀强电场（V/m） */
  electric?: Vec2
  /** 匀强磁场 Bz（T，垂直纸面，正 = 向外） */
  magnetic?: number
}

/* ============ 物体定义 ============ */

export interface ObjectDef {
  id: string
  label: string
  /** 初始位置（数值模式直接使用；解析模式内部由公式还原，保持一致） */
  p0: Vec2
  /** 初始速度（同上） */
  v0: Vec2
  mass: number
  /** 渲染半径（m），也是碰撞半径 */
  radius: number
  color: string
  motion: MotionMode
  /** 是否参与碰撞（设为 true 的两两物体之间做碰撞解析，同时强制数值模式；缺省 false） */
  collidable?: boolean
  /** 物体间碰撞恢复系数 0~1（默认 1 = 完全弹性，教学常用） */
  restitution?: number
  /** 恒定外力（N，如"水平拉力 5N"）——数值模式按 F=ma 参与，解析模式仅用于展示 */
  appliedForce?: Vec2
  /** 约束（绳/杆）关联 */
  constraints?: ConstraintLink[]
  /** 电荷量（C，可为负）；在场区域中受电场力 qE 与洛伦兹力 qv×B */
  charge?: number
  /** 渲染形状：缺省圆形；'rect' 用 radius 作半高、rectW 作宽度（板块等展示用） */
  shape?: 'circle' | 'rect'
  /** rect 形状宽度（m） */
  rectW?: number
}

export type ConstraintKind = 'rope' | 'rod'

/** 与另一物体的定长/松弛约束（两物体均须为数值模式） */
export interface ConstraintLink {
  kind: ConstraintKind
  /** 约束的另一端物体 id */
  otherId: string
  /** 约束长度（m） */
  length: number
}

/* ============ 场景定义 ============ */

export interface WorldSpec {
  /** 重力加速度矢量（默认 (0, -9.8)，y 向上） */
  gravity: Vec2
  /** 地面（y = groundY 的水平面），存在时做落地检测 */
  groundY?: number
  /** 空间电磁场区域（带电粒子场景）；缺省 = 无场 */
  fields?: FieldRegion[]
}

export interface ScenarioDefinition {
  templateId: string
  title?: string
  objects: ObjectDef[]
  world: WorldSpec
  /** 建议模拟时长（s，模拟域时间）；缺省由引擎按自然终止/默认 12s 决定 */
  duration?: number
  /** 分步解题讲解：time = 画面中该步骤发生的时刻（s，按时间升序） */
  solution?: SolutionStep[]
}

/** 讲解步骤（解题过程） */
export interface SolutionStep {
  /** 该步骤对应画面的时刻（s）；播放到此时刻时高亮 */
  time: number
  /** 步骤标题（如「① 竖直方向自由落体」） */
  title: string
  /** 讲解文字（简明中文） */
  text: string
  /** 关键公式（可空；纯文本，如 v = √(2gh)） */
  formula?: string
}

/* ============ 运行结果 ============ */

/** 每个物体一帧 6 个标量：[px, py, vx, vy, ax, ay]，跨步连续打包 */
export type TrackData = Float32Array

export interface ObjectTrack {
  id: string
  label: string
  color: string
  radius: number
  def: ObjectDef
  /** 求解模式标识（UI 徽标用） */
  mode: 'analytic' | 'numeric' | 'static'
  /** 是否已终止（落地静止/停稳），之后状态不再变化 */
  ended: boolean
  /** 打包帧数据：索引 = step*6 + [0..5] */
  data: TrackData
}

export type PhysicsEventKind =
  | 'landing' // 落地（y = groundY）
  | 'apex' // 竖直方向最高点（vy 变号 +→-）
  | 'collision' // 两物体碰撞
  | 'meet' // 追及相遇（非碰撞物体位置重合）
  | 'ropeTaut' // 绳张紧
  | 'stop' // 物体停稳

export interface PhysicsEvent {
  kind: PhysicsEventKind
  /** 事件时刻（s） */
  time: number
  /** 所在步索引（取整后） */
  step: number
  objectId?: string
  objectBId?: string
  /** 碰撞/相遇时相对速率（m/s，展示用） */
  magnitude?: number
  label?: string
}

export interface EngineResult {
  /** 求解时间步长 dt（固定 0.01） */
  dt: number
  /** 总步数 */
  steps: number
  /** 总时长 = steps*dt */
  duration: number
  /** 是否自然结束（所有物体静止/落地；false 表示仍有运动被时长截断） */
  ended: boolean
  tracks: Record<string, ObjectTrack>
  order: string[]
  events: PhysicsEvent[]
  def: ScenarioDefinition
  /** 求解耗时（性能展示用） */
  solveMs: number
}

export interface RunOptions {
  /** 请求时长（s），默认由场景/自然终止决定；不传时至少覆盖到所有物体自然终止 */
  duration?: number
  dt?: number
  /** 强制全部物体数值积分（调试/测试用） */
  forceNumeric?: boolean
  /** 禁用自然终止提前截断（测试用） */
  disableAutoEnd?: boolean
}

/* ============ 参数面板元数据 ============ */

/**
 * 参数滑块/数值框定义。参数面板直接作用于场景定义：
 * 每次改动 apply() 产生新的 ScenarioDefinition（不可变），
 * 撤销/重做/持久化都以定义快照为单位（不存计算态）。
 */
export interface ParamDef {
  key: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  /** 所属分组：'world' 或物体 id */
  group: string
  /** 从当前场景读值（滑块位置/数值框） */
  read: (def: ScenarioDefinition) => number
  /** 以新值生成新场景定义（返回新对象，原 def 不被修改） */
  apply: (def: ScenarioDefinition, v: number) => ScenarioDefinition
}

/** 显示开关配置（跟随 SimViewOptions，非物理参数） */
export interface ViewOptions {
  showTrajectory: boolean
  showGrid: boolean
  showAxes: boolean
  showForces: boolean
  showNetForce: boolean
  showForceValues: boolean
  showVectorsVelocity: boolean
  autoFit: boolean
  showField: boolean
}

export const defaultViewOptions: ViewOptions = {
  showTrajectory: true,
  showGrid: true,
  showAxes: true,
  showForces: true,
  showNetForce: false,
  showForceValues: false,
  showVectorsVelocity: true,
  autoFit: true,
  showField: true,
}

/* ============ 受力展示 ============ */

export type ForceKind =
  | 'gravity'
  | 'normal'
  | 'friction'
  | 'tension'
  | 'applied'
  | 'spring'
  | 'centripetal'
  | 'drag'
  | 'electric'
  | 'magnetic'
  | 'net'

/** 某时刻某物体上的一支力（渲染层从 def + 轨迹状态推导，N） */
export interface ForceVec {
  kind: ForceKind
  /** 力矢量（N，世界坐标） */
  f: Vec2
  /** 大小（N，≥0） */
  magnitude: number
  /** 标签（含单位） */
  label: string
  /** 作用点（物体中心，世界坐标） */
  at: Vec2
}

/* ============ 物理常数 ============ */

export const DEFAULT_GRAVITY: Vec2 = { x: 0, y: -9.8 }
export const GRAVITY_MAG = 9.8
/** 引擎固定时间步长（s）——统一时间网格，保证图表/事件一致性 */
export const ENGINE_DT = 0.01
/** 单次求解的最大时长（s），防止异常参数导致死循环 */
export const MAX_SIM_SECONDS = 600
