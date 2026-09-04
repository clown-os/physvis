// 内置示例题：教材典型题，无 API Key 也能离线演示"解析 → （校正）→ 模拟"全流程。
// 每题的题干即 mock provider 的返回源（低置信题用于演示人工校正弹窗）。
import type { SolutionStep } from '../engine/types'

export interface ExampleProblem {
  id: string
  title: string
  category: string
  difficulty: 1 | 2 | 3
  /** 题干（学生粘贴的原始文本） */
  text: string
  /** 对应的场景模板 */
  templateId: string
  /** 应用到模板实例的参数（可选；缺省用模板默认值） */
  values?: Record<string, number>
  /** mock 解析的置信度（<0.7 强制演示校正弹窗） */
  mockConfidence?: number
  /** 解析要点（模拟弹窗展示） */
  hints: string[]
  /** 参考答案（解析要点文案） */
  answer: string
  /** 分步解题讲解（离线演示「会做题」；time 与该题实际仿真的现象时刻对齐） */
  solution?: SolutionStep[]
}

export const EXAMPLE_PROBLEMS: ExampleProblem[] = [
  {
    id: 'freefall_20m',
    title: '苹果落地',
    category: '自由落体',
    difficulty: 1,
    text: '一个苹果从距地面 20 m 的树枝上由静止开始下落，忽略空气阻力，g 取 9.8 m/s²。求：苹果落到地面所需的时间，以及落地前瞬间速度的大小。',
    templateId: 'freefall',
    values: { h: 20 },
    hints: ['自由落体 h = ½gt²', 'v = gt = √(2gh)'],
    answer: 't = √(2h/g) ≈ 2.02 s，v = √(2gh) ≈ 19.8 m/s',
  },
  {
    id: 'vthrow_15',
    title: '竖直上抛的最大高度',
    category: '竖直上抛',
    difficulty: 1,
    text: '以 15 m/s 的初速度将一小球竖直向上抛出（抛出点即地面），忽略空气阻力。求小球能到达的最大高度，以及从抛出到落回地面所用的总时间。',
    templateId: 'vthrow',
    values: { v0: 15 },
    mockConfidence: 0.62, // 演示：AI 解析歧义 → 需人工校正
    hints: ['最高点 v = 0：t = v₀/g', 'H = v₀²/(2g)', '上升与下落对称，总时间 t = 2v₀/g'],
    answer: 'H = v₀²/(2g) ≈ 11.5 m；t = 2v₀/g ≈ 3.06 s',
  },
  {
    id: 'projectile_h20',
    title: '平抛：平台边缘',
    category: '平抛运动',
    difficulty: 2,
    text: '从距地面高 20 m 的平台边缘，以 10 m/s 的水平速度抛出一小球。忽略空气阻力，求小球落地时间、水平射程与落地瞬间速度的大小。',
    templateId: 'projectile',
    values: { v0: 10, theta: 0, h: 20 },
    hints: ['竖直方向自由落体定时间：t = √(2h/g)', '水平匀速：R = v₀t', '落地速度 = √(v₀² + (gt)²)'],
    answer: 't ≈ 2.02 s；R ≈ 20.2 m；v ≈ 22.2 m/s',
  },
  {
    id: 'projectile_45',
    title: '斜抛最远射程',
    category: '斜抛运动',
    difficulty: 2,
    text: '从地面以 20 m/s 的初速度、45° 仰角斜抛一小球（出手点高度为 0）。忽略空气阻力，求小球飞行时间、水平射程与最大高度。',
    templateId: 'projectile',
    values: { v0: 20, theta: 45, h: 0 },
    hints: ['飞行时间由竖直分量定：t = 2v₀sinθ/g', '射程 R = v₀²sin2θ/g（45° 时最大）', 'H = (v₀sinθ)²/(2g)'],
    answer: 't ≈ 2.89 s；R ≈ 40.8 m；H ≈ 10.2 m',
  },
  {
    id: 'circular_r2',
    title: '转盘上的线速度',
    category: '匀速圆周运动',
    difficulty: 1,
    text: '物体在半径 2 m 的水平圆轨道上做匀速圆周运动，角速度 ω = 2 rad/s。求线速度大小与向心加速度大小。',
    templateId: 'circular',
    values: { r: 2, omega: 2 },
    hints: ['v = ωr', 'a = ω²r = v²/r，方向始终指向圆心'],
    answer: 'v = 4 m/s；a = 8 m/s²',
  },
  {
    id: 'shm_period',
    title: '弹簧振子的周期',
    category: '简谐运动',
    difficulty: 2,
    text: '水平弹簧振子做简谐运动，振幅 A = 1.2 m，圆频率 ω = 2.5 rad/s。求振动的周期，最大速度与最大加速度，并说明周期是否与振幅有关。',
    templateId: 'shm',
    values: { A: 1.2, omega: 2.5 },
    hints: ['T = 2π/ω', 'vmax = Aω（过平衡位置）', 'amax = Aω²（端点处）', '周期与振幅无关'],
    answer: 'T ≈ 2.51 s；vmax = 3 m/s；amax = 7.5 m/s²',
  },
  {
    id: 'pendulum_L3',
    title: '单摆的周期',
    category: '单摆',
    difficulty: 1,
    text: '单摆摆长 3 m，在重力加速度 9.8 m/s² 处做小角度摆动。求摆动周期。若摆长变为 4 倍，周期变为原来的几倍？',
    templateId: 'pendulum',
    values: { L: 3, theta0: 15 },
    hints: ['T = 2π√(L/g)', '周期与摆球质量、振幅（小角度内）无关'],
    answer: 'T ≈ 3.48 s；摆长 4 倍 → 周期 2 倍',
  },
  {
    id: 'incline_up',
    title: '斜面上滑与停下',
    category: '斜面',
    difficulty: 3,
    text: '倾角 30° 的粗糙斜面，动摩擦因数 μ = 0.7。物块以 4 m/s 的初速度沿斜面向上滑行，求上滑的加速度与最大滑行距离，并判断物块到达最高点后能否再滑下。',
    templateId: 'incline',
    values: { theta: 30, mu: 0.7, v0: -4 },
    hints: ['上滑时摩擦沿斜面向下：a = −g(sinθ + μcosθ)', 'μ > tanθ → 上到最高点后静摩擦可平衡，不再下滑'],
    answer: 'a = −g(sin30°+μcos30°) ≈ −10.8 m/s²；s = v₀²/(2|a|) ≈ 0.74 m；因 μ=0.7 > tan30°≈0.58，停住后不再下滑',
  },
  {
    id: 'collision_equal',
    title: '完全弹性碰撞',
    category: '动量守恒',
    difficulty: 2,
    text: '质量 1 kg 的小球 A 以 4 m/s 的速度与静止的质量 1 kg 小球 B 发生对心完全弹性碰撞。求碰后两球速度，并验证碰撞前后系统的总动量与总动能。',
    templateId: 'collision',
    values: { vA: 4, vB: 0, mA: 1, mB: 1, e: 1 },
    hints: ['等质量完全弹性对心碰撞：速度交换', '动量守恒 + e=1（动能守恒）'],
    answer: "v_A′ = 0，v_B′ = 4 m/s；系统动量恒为 4 kg·m/s，动能恒为 8 J",
  },
  {
    id: 'conveyor_accel',
    title: '传送带上的货物',
    category: '传送带',
    difficulty: 2,
    text: '水平传送带以 2 m/s 匀速转动，动摩擦因数 μ = 0.3。将一初速度为 0 的货物轻放在带左端，求货物加速到与传送带同速所需的时间与相对地面的位移。',
    templateId: 'conveyor',
    values: { belt: 2, mu: 0.3 },
    hints: ['加速期滑动摩擦 f = μmg，a = μg', 't = v/(μg)；s = v²/(2μg)', '同速后静摩擦，匀速直线运动'],
    answer: 'a = μg ≈ 2.94 m/s²；t ≈ 0.68 s；s ≈ 0.68 m',
  },
  {
    id: 'pursuit_catch',
    title: '追及能否追上',
    category: '追及相遇',
    difficulty: 3,
    text: 'A 以 12 m/s 匀速直线运动，在其前方 100 m 处 B 从静止开始以 2 m/s² 的加速度同向匀加速行驶。A 能否追上 B？若不能，速度相等时二者相距最近，求最近距离。',
    templateId: 'pursuit',
    values: { vA: 12, aB: 2, d0: 100 },
    mockConfidence: 0.55, // 演示：模型可能把"匀加速起点"物化错 → 校正
    hints: ['追及条件：x_A = x_B，即 12t = 100 + t²', '判别式 Δ = 12² − 4×100 < 0 → 不能追上', '速度相等时刻距离最近：t = v_A/a_B = 6 s'],
    answer: 'Δ < 0 不能追上；t = 6 s 时最近，最近距离 64 m',
  },
  {
    id: 'efield_deflect',
    title: '带电粒子类平抛偏转',
    category: '电磁场',
    difficulty: 3,
    text: '一质量为 0.02 kg、带电量 −2.0×10⁻⁵ C 的带电粒子以 4 m/s 的初速度沿水平方向进入竖直向下的匀强电场，场强 E = 1000 V/m，电场区域宽度 8 m。忽略重力。求粒子穿出电场时的竖直偏移量 y，以及穿出时速度方向与水平方向的夹角。',
    templateId: 'charged_efield',
    hints: ['a = qE/m（注意负号：q<0、E 向下 → 加速度向上）', '水平匀速：t = L/v₀ = 2 s', '类平抛：y = ½at²；tanθ = v_y/v_x'],
    answer: 'a = |q|E/m = 1 m/s²（向上）；y = ½·1·2² = 2 m；tanθ = 2/4 = 0.5 → θ ≈ 26.6°',
  },
  {
    id: 'bfield_circle',
    title: '带电粒子在磁场中的圆周运动',
    category: '电磁场',
    difficulty: 2,
    text: '一带正电的粒子，电荷量 q = 0.05 C，质量 m = 0.05 kg，以 v = 4 m/s 的速度垂直于磁场方向射入磁感应强度 B = 2 T 的匀强磁场（磁场方向垂直纸面向外）。忽略重力。求粒子做匀速圆周运动的轨道半径和运动周期。',
    templateId: 'charged_bfield',
    values: { v0: 4, B: 2, q: 0.05 },
    hints: ['洛伦兹力提供向心力：qvB = mv²/r', 'r = mv/(qB)', '周期 T = 2πm/(qB)，与速度无关'],
    answer: 'r = mv/(qB) = 0.05×4/(0.05×2) = 2 m；T = 2πm/(qB) = 2π×0.05/(0.05×2) = π ≈ 3.14 s',
  },
  {
    id: 'combo_eb',
    title: '电场加速后进入磁场',
    category: '电磁场',
    difficulty: 3,
    text: '一带电粒子，电荷量 q = 0.02 C，质量 m = 0.01 kg，从 x = −5.2 m 处由静止释放。在 x < 0 区域存在水平向右的匀强电场 E = 5 V/m，在 x > 0 区域存在垂直纸面向外的匀强磁场 B = 2 T。忽略重力。求粒子刚进入磁场时的速度大小，以及在磁场中做圆周运动的轨道半径。',
    templateId: 'charged_combo',
    mockConfidence: 0.62, // 演示：组合场区域划分易错 → 校正
    hints: ['电场中匀加速：a = qE/m = 10 m/s²', 'v = √(2as) = √(2×10×5.2) ≈ 10.2 m/s', '磁场中 r = mv/(qB)'],
    answer: 'v = √(2qEs/m) = √104 ≈ 10.2 m/s；r = mv/(qB) ≈ 0.01×10.2/(0.02×2) = 2.55 m',
  },
  {
    id: 'ring_top',
    title: '圆环内壁下滑',
    category: '圆环与竖直圆周',
    difficulty: 2,
    text: '一半径为 2.5 m 的光滑竖直圆环，小球套在环内。小球从环的最高点以 5 m/s 的初速度沿环面切线方向滑下（恰好贴壁不脱落）。忽略摩擦与空气阻力，g 取 9.8 m/s²。求小球第一次到达环的最低点时的速度大小。',
    templateId: 'ring_ball',
    values: { v0: 5, R: 2.5 },
    hints: ['贴壁条件：最高点 v₀²/R ≥ g（本例 25/2.5 = 10 > 9.8，可贴壁滑下）', '只有重力做功，机械能守恒', '高度差 2R：½mv₀² + mg·2R = ½mv² → v = √(v₀² + 4gR)'],
    answer: 'v = √(5² + 4×9.8×2.5) = √(25 + 98) ≈ 11.09 m/s',
  },
  {
    id: 'ring_collide',
    title: '圆槽内两球弹性碰撞',
    category: '圆环与竖直圆周',
    difficulty: 2,
    text: '光滑水平面上一半径 2.6 m 的圆形光滑凹槽内，两个完全相同的小球（质量均为 1 kg）分别以 2 m/s 相向滑行（A 向右、B 向左）。两球发生对心完全弹性碰撞。求碰撞后两球的速度。',
    templateId: 'ring_collision',
    values: { vA: 2, vB: -2, e: 1 },
    hints: ['等质量完全弹性对心碰撞：交换速度', '碰撞前后动量守恒、动能守恒', '碰后各自再与凹槽壁弹性碰撞，速率不变'],
    answer: 'v_A′ = −2 m/s（反向），v_B′ = 2 m/s（反向）；之后与槽壁弹性碰撞，速度方向周期性翻转',
  },
  {
    id: 'vcircle_rope_crit',
    title: '绳模型能否完整过顶',
    category: '圆环与竖直圆周',
    difficulty: 3,
    text: '一根长 1.8 m 的细绳一端固定，另一端系一个质量 0.5 kg 的小球。在最低点给小球 10 m/s 的水平初速度，g 取 9.8 m/s²。求：小球能否在竖直平面内做完整的圆周运动？若能，求小球到达最高点时的速度大小。',
    templateId: 'vcircle_rope',
    values: { v0: 10, L: 1.8 },
    hints: ['完整圆周条件（绳）：v₀ ≥ √(5gL)', '√(5gL) = √(5×9.8×1.8) = √88.2 ≈ 9.4 m/s < 10 m/s → 能', '机械能守恒：v_top² = v₀² − 4gL'],
    answer: '√(5gL) ≈ 9.39 m/s < v₀ = 10 m/s，能完整过顶；v_top = √(100 − 70.56) ≈ 5.43 m/s',
  },
  {
    id: 'vcircle_rod_force',
    title: '杆模型最高点受力',
    category: '圆环与竖直圆周',
    difficulty: 3,
    text: '一根长 1.8 m 的轻杆一端固定，另一端连接一个质量 1 kg 的小球，在竖直平面内转动。小球在最低点以 10 m/s 的速度开始运动，g 取 9.8 m/s²。求小球到达最高点时速度的大小，以及杆对球的作用力大小和方向。',
    templateId: 'vcircle_rod',
    values: { v0: 10, L: 1.8 },
    hints: ['机械能守恒：v_top² = v₀² − 4gL', '最高点：mg + F_杆 = mv²/L（F_杆向下为正）', 'mv²/L = 16.36 N > mg = 9.8 N → 杆对球压力（向下）'],
    answer: 'v_top = √(100 − 70.56) ≈ 5.43 m/s；F = mv²/L − mg ≈ 16.36 − 9.8 = 6.56 N，方向向下（杆压球）',
  },
  {
    id: 'spring_two',
    title: '双球弹簧振动的周期',
    category: '弹簧与板块',
    difficulty: 3,
    text: '两个质量均为 1 kg 的小球放在光滑水平面上，用一根劲度系数 k = 8 N/m 的轻弹簧连接，弹簧原长 2 m。初始时两球相距 3 m，由静止释放。求：系统振动的周期，以及两球相对速度的最大值。',
    templateId: 'spring_pair',
    values: { k: 8, d0: 3 },
    mockConfidence: 0.58, // 演示：约化质量概念易错 → 校正
    hints: ['约化质量 μ = m₁m₂/(m₁+m₂) = 0.5 kg', 'T = 2π√(μ/k)', '相对运动振幅 A = 3 − 2 = 1 m，ω = √(k/μ) = 4 rad/s，v_max = Aω'],
    answer: 'T = 2π√(0.5/8) = π/2 ≈ 1.57 s；质心不动，相对速度最大值 v = Aω = 1×4 = 4 m/s',
  },
  {
    id: 'board_slide',
    title: '物块在木板上滑动',
    category: '弹簧与板块',
    difficulty: 3,
    text: '质量 M = 2 kg 的长木板静止在动摩擦因数 μ₂ = 0.1 的粗糙水平地面上，木板长度足够长。质量 m = 1 kg 的小物块以 v₀ = 5 m/s 的初速度滑上木板左端，物块与木板间的动摩擦因数 μ₁ = 0.4，g 取 9.8 m/s²。求：经过多长时间物块与木板相对静止？此时二者的共同速度是多少？',
    templateId: 'board_block',
    values: { v0: 5, mu1: 0.4, mu2: 0.1, M: 2, m: 1 },
    hints: ['物块：a₁ = −μ₁g = −3.92 m/s²', '木板：a₂ = [μ₁mg − μ₂(M+m)g]/M = (3.92 − 2.94)/2 = 0.49 m/s²', '相对静止：v₀ − μ₁gt = a₂t → t = v₀/(μ₁g + a₂)；之后整体以 −μ₂g 减速直至停下'],
    answer: 't = 5/(3.92 + 0.49) ≈ 1.13 s；v_共 = a₂t ≈ 0.56 m/s；此后整体减速，最终停下',
  },
]

/* ============ 分步解题讲解（time 与该题实际仿真的现象时刻对齐，升序） ============ */

const SOLUTIONS: Record<string, SolutionStep[]> = {
  freefall_20m: [
    { time: 0, title: '① 由静止释放', text: '苹果从 20 m 高处由静止释放，只受重力，做自由落体运动。', formula: 'a = g = 9.8 m/s²' },
    { time: 2.02, title: '② 落地：时间与速度', text: '由位移公式解出落地时间，再用速度公式求落地速度；此后静止在地面。', formula: 't = √(2h/g) ≈ 2.02 s；v = gt ≈ 19.8 m/s' },
  ],
  vthrow_15: [
    { time: 0, title: '① 竖直上抛', text: '以 15 m/s 竖直上抛，只受重力，上升过程匀减速。', formula: 'v = v₀ − gt' },
    { time: 1.53, title: '② 最高点', text: '最高点速度为零：令 v=0 解出上升时间，再求最大高度。', formula: 't = v₀/g ≈ 1.53 s；H = v₀²/2g ≈ 11.5 m' },
    { time: 3.06, title: '③ 落回地面', text: '上升与下落完全对称，总时间是上升时间的两倍。', formula: 't总 = 2v₀/g ≈ 3.06 s' },
  ],
  projectile_h20: [
    { time: 0, title: '① 运动分解', text: '平抛运动分解为水平匀速直线 + 竖直自由落体，互不影响。', formula: 'vx = 10 m/s（不变）；ay = g' },
    { time: 2.02, title: '② 落地时间与射程', text: '落地时间由竖直方向决定；水平方向匀速求射程。', formula: 't = √(2h/g) ≈ 2.02 s；R = v₀t ≈ 20.2 m' },
    { time: 2.03, title: '③ 落地速度', text: '落地瞬间速度由水平、竖直两分量合成。', formula: 'v = √(v₀² + (gt)²) ≈ 22.2 m/s' },
  ],
  projectile_45: [
    { time: 0, title: '① 运动分解', text: '45° 斜抛：水平与竖直初速度分量相等，水平匀速、竖直上抛。', formula: 'vx₀ = vy₀ = 20·cos45° ≈ 14.14 m/s' },
    { time: 1.44, title: '② 最高点', text: '竖直速度减为零的时刻即为最高点。', formula: 't = vy₀/g ≈ 1.44 s；H = vy₀²/2g ≈ 10.2 m' },
    { time: 2.89, title: '③ 落回地面', text: '飞行时间为上升时间两倍；射程由水平匀速求得。', formula: 'T = 2vy₀/g ≈ 2.89 s；R = vx₀·T ≈ 40.8 m' },
  ],
  circular_r2: [
    { time: 0, title: '① 匀速圆周运动', text: '半径 2 m、角速度 2 rad/s，线速度与向心加速度大小恒定、方向时刻变化。', formula: 'v = ωr = 4 m/s；a = ω²r = 8 m/s²' },
    { time: 1.57, title: '② 转过半圈', text: '转过 π 弧度，速度方向正好反向。', formula: 't = π/ω ≈ 1.57 s' },
    { time: 3.14, title: '③ 整圈回到起点', text: '一个周期后回到初始位置，向心力始终指向圆心。', formula: 'T = 2π/ω = π ≈ 3.14 s' },
  ],
  shm_period: [
    { time: 0, title: '① 端点释放', text: '振子从最大位移处由静止出发：速度为零、加速度最大。', formula: 'amax = ω²A = 2.5²×1.2 = 7.5 m/s²' },
    { time: 0.63, title: '② 过平衡位置', text: '四分之一周期到达平衡位置，此处速度最大。', formula: 'T = 2π/ω ≈ 2.51 s；vmax = ωA = 3 m/s' },
    { time: 1.26, title: '③ 对侧端点', text: '半个周期到达对侧最大位移，加速度反向最大。', formula: 's = −A' },
    { time: 2.51, title: '④ 一个完整周期', text: '回到起点：周期只由 ω 决定，与振幅无关。', formula: 'T = 2π/ω ≈ 2.51 s' },
  ],
  pendulum_L3: [
    { time: 0, title: '① 小角度释放', text: '摆长 3 m、摆角 15°，从静止释放；小角度下单摆近似简谐。', formula: 'T = 2π√(L/g) = 2π√(3/9.8) ≈ 3.48 s' },
    { time: 0.87, title: '② 过最低点', text: '四分之一周期到达最低点，速度最大。', formula: 't = T/4 ≈ 0.87 s' },
    { time: 1.74, title: '③ 半周期', text: '半个周期到达对侧最高点，左右对称。', formula: 'θ = −θ₀' },
    { time: 3.48, title: '④ 一个周期', text: '回到出发点。周期与质量、振幅（小角度内）无关；摆长 4 倍 → 周期 2 倍。', formula: 'T ∝ √L' },
  ],
  incline_up: [
    { time: 0, title: '① 上滑减速', text: '沿斜面向上滑行：重力下滑分力与滑动摩擦同向，共同减速。', formula: 'a = g(sin30° + μcos30°) ≈ 10.8 m/s²' },
    { time: 0.37, title: '② 到达最高点停下', text: '速度减为零即到达最高点。', formula: 't = v₀/a ≈ 0.37 s；s = v₀²/2a ≈ 0.74 m' },
    { time: 0.4, title: '③ 不再下滑', text: 'μ = 0.7 > tan30° ≈ 0.58：最大静摩擦足以平衡重力分力，物块停在原处。', formula: 'μ > tanθ → 静摩擦平衡' },
  ],
  collision_equal: [
    { time: 0, title: '① 相向运动', text: 'A 以 4 m/s 向右滑行，B 静止，同一直线上。', formula: 'p总 = 1×4 = 4 kg·m/s' },
    { time: 1.74, title: '② 对心弹性碰撞', text: '等质量完全弹性对心碰撞：两球交换速度。', formula: 'v_A′ = 0；v_B′ = 4 m/s' },
    { time: 2.0, title: '③ 验证守恒', text: '碰撞前后系统总动量与总动能均不变。', formula: 'p = 4 kg·m/s；Ek = 8 J' },
  ],
  conveyor_accel: [
    { time: 0, title: '① 轻放上带', text: '货物初速为 0，与带相对滑动，滑动摩擦提供加速度。', formula: 'a = μg = 0.3×9.8 ≈ 2.94 m/s²' },
    { time: 0.68, title: '② 与带同速', text: '速度达到带速后相对滑动消失。', formula: 't = v/μg ≈ 0.68 s；s = v²/2μg ≈ 0.68 m' },
    { time: 1.5, title: '③ 匀速前进', text: '此后与传送带相对静止，随带匀速运动。', formula: 'v = 2 m/s 恒定' },
  ],
  pursuit_catch: [
    { time: 0, title: '① 追及方程', text: 'A 匀速 12 m/s；B 在 A 前 100 m 处从静止开始以 2 m/s² 匀加速。', formula: 'x_A = 12t；x_B = 100 + t²' },
    { time: 6, title: '② 速度相等时刻', text: '追及方程 12t = 100 + t² 判别式 Δ < 0 无解：A 追不上 B；等速时距离最近。', formula: 't = v_A/a_B = 6 s；Δx = 100 + 36 − 72 = 64 m' },
    { time: 8, title: '③ 距离再次拉大', text: '此后 B 速度超过 A，两者距离越来越大，A 永远追不上。', formula: 'x_B − x_A 单调增大' },
  ],
  efield_deflect: [
    { time: 0, title: '① 进入电场前', text: '粒子在无场区水平匀速飞向电场区域，不受力。', formula: 'vx = 4 m/s' },
    { time: 0.88, title: '② 进入电场偏转', text: '负电荷在竖直向下的电场中受向上的电场力，做类平抛运动。', formula: 'a = |q|E/m = 1 m/s²（向上）' },
    { time: 2.88, title: '③ 穿出电场', text: '水平匀速穿过宽 8 m 的区域，竖直方向匀加速偏移。', formula: 't = L/v₀ = 2 s；y = ½at² = 2 m；tanθ = 0.5 → θ ≈ 26.6°' },
  ],
  bfield_circle: [
    { time: 0, title: '① 进入磁场', text: '洛伦兹力始终与速度垂直，提供向心力，速率不变。', formula: 'qvB = mv²/r' },
    { time: 1.57, title: '② 半个圆周', text: '由洛伦兹力与向心力相等解出半径和周期。', formula: 'r = mv/qB = 2 m；T = 2πm/qB = π ≈ 3.14 s' },
    { time: 3.14, title: '③ 整圈回到入射点', text: '回到出发点：周期只由 q/m 与 B 决定，与速度无关。', formula: 'T = 2πm/qB' },
  ],
  combo_eb: [
    { time: 0, title: '① 电场中加速', text: '粒子从静止在匀强电场中匀加速直线运动。', formula: 'a = qE/m = 10 m/s²' },
    { time: 1.02, title: '② 进入磁场', text: '加速 5.2 m 后到达 x=0 进入磁场区域，电场力消失。', formula: 'v = √(2as) = √104 ≈ 10.2 m/s' },
    { time: 1.8, title: '③ 磁场中偏转', text: '洛伦兹力使粒子做匀速圆周运动。', formula: 'r = mv/qB ≈ 2.55 m' },
  ],
  ring_top: [
    { time: 0, title: '① 贴壁滑下', text: '最高点处 v₀²/R = 10 m/s² > g，小球紧贴环壁滑下；只有重力做功。', formula: '½mv₀² + mg·2R = ½mv²' },
    { time: 0.84, title: '② 到达最低点', text: '重力势能全部转化为动能增量。', formula: 'v = √(v₀² + 4gR) = √(25 + 98) ≈ 11.09 m/s' },
    { time: 1.88, title: '③ 荡向对侧', text: '继续沿环面上升，机械能守恒，上升到与释放点等高处再反向。', formula: 'h′ = h₀（对称）' },
  ],
  ring_collide: [
    { time: 0, title: '① 相向滑行', text: '两球在光滑圆槽内相向运动，系统总动量为零。', formula: 'p总 = m×2 + m×(−2) = 0' },
    { time: 0.34, title: '② 对心弹性碰撞', text: '等质量完全弹性对心碰撞：交换速度，各自反向。', formula: 'v_A′ = −2 m/s；v_B′ = 2 m/s' },
    { time: 2.34, title: '③ 撞壁折返再相遇', text: '碰后各自与槽壁弹性碰撞折返，每隔 2 s 再次对碰。', formula: '往返周期 = 2 s' },
  ],
  vcircle_rope_crit: [
    { time: 0, title: '① 最低点出发', text: '绳模型完整过顶的条件是绳始终张紧：最低点速度须满足 v₀ ≥ √(5gL)。', formula: '√(5gL) = √88.2 ≈ 9.39 m/s < 10 m/s → 能过顶' },
    { time: 0.72, title: '② 到达最高点', text: '机械能守恒求最高点速度。', formula: 'v_top² = v₀² − 4gL = 29.44 → v_top ≈ 5.43 m/s' },
    { time: 1.5, title: '③ 回到最低点', text: '半圈后速率恢复为 10 m/s，绳的拉力最大。', formula: 'v = 10 m/s' },
    { time: 3.0, title: '④ 完整一圈', text: '完整循环一周约 3 s，可不断循环下去。', formula: '机械能守恒' },
  ],
  vcircle_rod_force: [
    { time: 0, title: '① 最低点出发', text: '杆模型与绳不同：杆既能拉也能撑，过顶只需速度大于零。', formula: 'v₀ = 10 m/s' },
    { time: 0.72, title: '② 最高点：速度', text: '机械能守恒求最高点速度。', formula: 'v_top² = v₀² − 4gL = 29.44 → v_top ≈ 5.43 m/s' },
    { time: 0.74, title: '③ 最高点：杆的作用力', text: '向心力 mv²/L ≈ 16.36 N 大于重力 9.8 N，杆对球作用力向下（压球）。', formula: 'F = mv²/L − mg ≈ 6.56 N（向下）' },
    { time: 3.0, title: '④ 完整一圈', text: '完整循环一周约 3 s，杆的力在拉与压之间连续变化。', formula: '机械能守恒' },
  ],
  spring_two: [
    { time: 0, title: '① 由静止释放', text: '两球相距 3 m（弹簧伸长 1 m）由静止释放，弹簧拉力使它们相互靠近。', formula: '约化质量 μ = m₁m₂/(m₁+m₂) = 0.5 kg' },
    { time: 0.39, title: '② 回到原长', text: '四分之一周期回到原长 2 m，此时相对速度最大。', formula: 'ω = √(k/μ) = 4 rad/s；T = 2π/ω = π/2 ≈ 1.57 s' },
    { time: 0.79, title: '③ 最大压缩', text: '半个周期压缩到最近（相距 1 m），随后弹开。', formula: '相对振幅 A = 1 m；vmax相对 = Aω = 4 m/s' },
    { time: 1.57, title: '④ 一个周期', text: '回到初始位形。全过程质心不动、系统动量恒为零。', formula: 'T = 2π√(μ/k) ≈ 1.57 s' },
  ],
  board_slide: [
    { time: 0, title: '① 开始相对滑动', text: '物块滑上木板：物块受摩擦减速，木板受反作用加速，同时地面摩擦拖慢木板。', formula: 'a₁ = μ₁g = 3.92 m/s²；a₂ = [μ₁mg − μ₂(M+m)g]/M = 0.49 m/s²' },
    { time: 1.13, title: '② 相对静止', text: '两者速度相等后不再相对滑动，此后整体一起运动。', formula: 't = v₀/(μ₁g + a₂) ≈ 1.13 s；v共 ≈ 0.56 m/s' },
    { time: 1.76, title: '③ 整体停下', text: '地面摩擦使整体减速，最终静止。', formula: 'a = μ₂g = 0.98 m/s²' },
  ],
}

for (const ex of EXAMPLE_PROBLEMS) {
  const s = SOLUTIONS[ex.id]
  if (s) ex.solution = s
}
