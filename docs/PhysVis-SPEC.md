# PhysVis 技术规范文档（SPEC）

## 1. 技术选型

### 1.1 前端技术栈

| 技术 | 选型 | 理由 |
|------|------|------|
| 框架 | **React 18 + TypeScript** | 组件化开发利于维护复杂 UI（参数面板、图表、控制栏）；类型安全对物理计算接口至关重要 |
| 构建工具 | **Vite** | 冷启动快、HMR 极快，适合频繁调试 Canvas 渲染逻辑；生产构建产物小 |
| 渲染引擎 | **Canvas 2D API** | 2D 物理运动场景无需 WebGL 复杂度；Canvas 2D 满足 60fps 要求，且开发成本低、兼容性好 |
| 物理计算 | **自研纯 JS 物理引擎** | 高中物理场景封闭可控（匀变速、抛体、圆周、简谐），自研引擎可避免引入 Matter.js/Planck.js 等重型库的过度设计，同时保证数值精度与教学可控性 |
| 状态管理 | **Zustand** | 轻量、无样板代码，适合管理播放状态、参数、场景数据等跨组件状态 |
| 图表绘制 | **Chart.js** | v-t / x-t / a-t 图表需求标准，Chart.js 轻量、响应式，且支持外部程序控制高亮时刻 |
| UI 组件库 | **shadcn/ui + Tailwind CSS** | 快速搭建专业教学工具界面，主题可控，无需引入重型组件库 |
| 导出功能 | **gif.js + MediaRecorder API** | gif.js 纯前端生成 GIF；MediaRecorder 录制 Canvas 流为 MP4；零服务端依赖 |
| 路由 | **React Router v6** | 主界面 / 设置页 / 模板库 多页面切换 |

### 1.2 AI 解析层

| 技术 | 选型 | 理由 |
|------|------|------|
| AI 调用 | **用户端直接调用 API** | PRD 明确要求工具不存储、不中转 API Key；前端直接通过 HTTPS 调用各厂商 API，避免合规与隐私风险 |
| 多模型适配 | **统一抽象层 + Provider 插件** | 封装 OpenAI/Claude/DeepSeek/Gemini/Ollama 的 API 差异，统一输入输出接口 |
| Prompt 工程 | **结构化输出（JSON Mode / Function Calling）** | 强制 AI 返回标准化 JSON，降低解析失败率，便于人工校正 |

### 1.3 数据持久化

| 技术 | 选型 | 理由 |
|------|------|------|
| 本地存储 | **IndexedDB（via Dexie.js）** | 题目数据、收藏、校正模板需结构化查询；LocalStorage 容量与查询能力不足；Dexie.js 封装友好 |
| 分享链接 | **URL Search Params + LZString 压缩** | 将参数与题目文本压缩编码进 URL，无需服务端，他人打开即可复现 |

### 1.4 不引入后端服务的原因

PhysVis 定位为**纯前端开源工具**：
- AI 解析由用户自配 API Key，前端直调
- 数据存储在本地 IndexedDB
- 分享通过 URL 编码实现
- 导出通过浏览器原生 API 完成

此举消除服务器部署与运维成本，符合开源项目 "零后端" 原则，同时完全满足 PRD 中所有功能需求。

---

## 2. 数据模型设计

### 2.1 实体关系图（ER）

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   Problem   │──1:N──│  Simulation │──1:N──│   Object    │
│   (题目)    │       │   (模拟配置) │       │  (运动物体)  │
└─────────────┘       └─────────────┘       └─────────────┘
                                                        │
                                                        │ 1:N
                                                        ▼
                                               ┌─────────────┐
                                               │    Force    │
                                               │   (受力)     │
                                               └─────────────┘

┌─────────────┐       ┌─────────────┐
│   Template  │──1:N──│  Parameter  │
│   (模板)    │       │  (模板参数)  │
└─────────────┘       └─────────────┘

┌─────────────┐
│CorrectorPref│
│ (校正模板)   │
└─────────────┘
```

### 2.2 核心实体定义

#### `Problem` — 题目

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` (UUID) | 主键 |
| `title` | `string` | 用户自定义标题（默认识别第一行） |
| `rawText` | `string` | 原始题目文本 |
| `aiProvider` | `string` | 使用的 AI 模型标识，如 `openai/gpt-4o` |
| `aiRawResponse` | `string` | AI 原始返回（用于调试） |
| `parsedResult` | `ParsedResult` | 解析后的结构化结果 |
| `simulation` | `Simulation` | 关联的模拟配置 |
| `tags` | `string[]` | 标签（如 "力学", "斜面", "高考真题"） |
| `isFavorite` | `boolean` | 是否收藏 |
| `createdAt` | `number` | 时间戳 |
| `updatedAt` | `number` | 时间戳 |

#### `ParsedResult` — AI 解析结果（嵌入 Problem）

| 字段 | 类型 | 说明 |
|------|------|------|
| `motionType` | `enum` | 运动类型：`uniform_acceleration` / `free_fall` / `vertical_throw` / `horizontal_projectile` / `oblique_projectile` / `uniform_circular` / `simple_harmonic` |
| `objectCount` | `number` | 物体数量 |
| `confidence` | `number` | AI 置信度 0-1 |
| `timeRange` | `{ start: number; end: number }` | 模拟时间范围 |
| `gravity` | `number` | 重力加速度（默认 9.8） |
| `airResistanceEnabled` | `boolean` | 是否启用空气阻力 |
| `objects` | `ParsedObject[]` | 各物体初始条件 |

#### `ParsedObject` — 解析出的物体初始条件

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 物体标识 |
| `name` | `string` | 物体名称（如 "小球 A"） |
| `mass` | `number` | 质量 (kg) |
| `initialPosition` | `Vector2D` | 初始位置 `{ x, y }` |
| `initialVelocity` | `Vector2D` | 初速度 `{ x, y }` |
| `initialAcceleration` | `Vector2D` | 初始加速度 `{ x, y }` |
| `forces` | `Force[]` | 受力列表 |
| `constraints` | `Constraint[]` | 约束条件（如绳连接） |
| `elasticity` | `number` | 弹性系数（碰撞用） |

#### `Vector2D` — 二维向量

| 字段 | 类型 | 说明 |
|------|------|------|
| `x` | `number` | X 分量 |
| `y` | `number` | Y 分量 |

#### `Force` — 受力

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 力标识 |
| `type` | `enum` | 类型：`gravity` / `normal` / `friction` / `tension` / `applied` / `spring` / `centripetal` |
| `vector` | `Vector2D` | 力矢量（大小与方向） |
| `magnitude` | `number` | 力的大小 (N)，冗余存储便于显示 |
| `color` | `string` | 显示颜色（可覆盖默认值） |
| `visible` | `boolean` | 是否显示 |

#### `Constraint` — 约束条件

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `enum` | `rope` / `rod` / `surface` |
| `targetObjectId` | `string` | 关联物体 ID |
| `parameters` | `Record<string, number>` | 约束参数（如绳长、斜面倾角） |

#### `Simulation` — 模拟运行时配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` (UUID) | 主键 |
| `problemId` | `string` | 关联题目 |
| `timeStep` | `number` | 时间步长（默认 0.01s） |
| `playbackSpeed` | `number` | 播放倍率：0.25 / 0.5 / 1 / 2 / 4 |
| `isPlaying` | `boolean` | 播放状态 |
| `currentTime` | `number` | 当前模拟时刻 |
| `showTrajectory` | `boolean` | 显示轨迹残影 |
| `showGrid` | `boolean` | 显示网格 |
| `showAxes` | `boolean` | 显示坐标轴 |
| `showForces` | `boolean` | 显示全部受力 |
| `showNetForce` | `boolean` | 显示合力 |
| `showForceValues` | `boolean` | 显示力的数值 |
| `camera` | `CameraConfig` | 视图配置 |
| `objects` | `SimObject[]` | 运行时物体状态（深拷贝自 ParsedObject，支持用户修改） |

#### `SimObject` — 运行时物体（继承 ParsedObject，扩展可编辑字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| （继承 ParsedObject 全部字段） | | |
| `isLocked` | `boolean` | 参数是否锁定 |
| `color` | `string` | 渲染颜色 |
| `radius` | `number` | 渲染半径（质点用） |

#### `CameraConfig` — 相机/视图配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `scale` | `number` | 像素/米比 |
| `offsetX` | `number` | 视口偏移 X |
| `offsetY` | `number` | 视口偏移 Y |
| `autoFit` | `boolean` | 自适应缩放 |

#### `Template` — 场景模板

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 模板标识（如 `inclined-plane`） |
| `name` | `string` | 模板名称 |
| `description` | `string` | 描述 |
| `category` | `string` | 分类 |
| `defaultParams` | `Record<string, number>` | 默认参数值 |
| `paramDefs` | `ParamDef[]` | 参数定义（用于生成面板） |
| `sceneConfig` | `Partial<Simulation>` | 预设场景配置 |

#### `ParamDef` — 参数定义

| 字段 | 类型 | 说明 |
|------|------|------|
| `key` | `string` | 参数键 |
| `label` | `string` | 显示标签 |
| `min` | `number` | 最小值 |
| `max` | `number` | 最大值 |
| `step` | `number` | 步进 |
| `unit` | `string` | 单位 |

#### `CorrectorPref` — 用户校正模板

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` (UUID) | 主键 |
| `name` | `string` | 模板名称 |
| `motionType` | `string` | 适用的运动类型 |
| `overrides` | `Partial<ParsedResult>` | 用户覆盖的字段 |
| `createdAt` | `number` | 时间戳 |

---

## 3. API 接口设计

> 注：PhysVis 无自有后端，以下 API 分为两类：
> - **内部服务层（Service）**：前端业务逻辑抽象，供 React 组件调用
> - **外部 AI 接口（Provider）**：用户自配 Key，前端直连各厂商 API

### 3.1 内部 Service API

#### 3.1.1 题目管理（ProblemService）

```typescript
// 创建/解析题目
POST /problems
Request: {
  rawText: string;
  aiProvider?: string;  // 如未指定使用默认配置
}
Response: {
  id: string;
  parsedResult: ParsedResult;
  simulation: Simulation;
}

// 获取题目详情
GET /problems/:id
Response: Problem

// 更新题目（人工校正后保存）
PUT /problems/:id
Request: {
  title?: string;
  parsedResult?: ParsedResult;
  simulation?: Partial<Simulation>;
  tags?: string[];
  isFavorite?: boolean;
}
Response: Problem

// 删除题目
DELETE /problems/:id
Response: { success: boolean }

// 列出题目（支持筛选）
GET /problems?tag=力学&isFavorite=true&page=1&pageSize=20
Response: {
  items: Problem[];
  total: number;
}

// 搜索题目
GET /problems/search?q=斜面
Response: Problem[]
```

#### 3.1.2 模拟控制（SimulationService）

```typescript
// 获取模拟状态
GET /simulations/:id
Response: Simulation

// 更新模拟参数
PATCH /simulations/:id
Request: {
  timeStep?: number;
  playbackSpeed?: number;
  showTrajectory?: boolean;
  // ... 其他可配置项
}
Response: Simulation

// 控制播放
POST /simulations/:id/control
Request: {
  action: "play" | "pause" | "reset" | "stepForward" | "stepBackward" | "seek";
  targetTime?: number;  // seek 时使用
}
Response: { currentTime: number; isPlaying: boolean }

// 实时调节物体参数（触发重算）
PUT /simulations/:id/objects/:objectId
Request: {
  mass?: number;
  initialVelocity?: Vector2D;
  initialPosition?: Vector2D;
  // ... 其他可编辑参数
}
Response: Simulation  // 返回重新计算后的完整状态

// 单步物理演算（逐帧前进/后退内部调用）
POST /simulations/:id/tick
Request: {
  direction: 1 | -1;
  count?: number;  // 步数，默认 1
}
Response: {
  objects: SimObject[];      // 更新后的状态
  currentTime: number;
  events?: PhysicsEvent[];   // 碰撞/相遇等事件
}
```

#### 3.1.3 模板管理（TemplateService）

```typescript
// 获取所有模板分类
GET /templates/categories
Response: { id: string; name: string; templates: Template[] }[]

// 根据模板创建模拟
POST /templates/:id/instantiate
Request: {
  params: Record<string, number>;  // 用户填入的参数
}
Response: Simulation

// 获取模板参数定义
GET /templates/:id/param-defs
Response: ParamDef[]
```

#### 3.1.4 导出服务（ExportService）

```typescript
// 导出 GIF
POST /exports/gif
Request: {
  simulationId: string;
  resolution: "480p" | "720p" | "1080p";
  fps: number;
  duration?: number;  // 默认模拟全长
}
Response: {
  downloadUrl: string;  // Blob URL
  fileName: string;
}

// 导出 MP4
POST /exports/mp4
Request: {
  simulationId: string;
  resolution: "480p" | "720p" | "1080p";
  fps: number;
}
Response: {
  downloadUrl: string;
  fileName: string;
}

// 导出静态图
POST /exports/png
Request: {
  simulationId: string;
  time?: number;  // 指定时刻，默认当前帧
  width?: number;
  height?: number;
}
Response: {
  downloadUrl: string;
  fileName: string;
}

// 生成分享链接
POST /exports/share-link
Request: {
  simulationId: string;
}
Response: {
  shareUrl: string;  // 含编码参数的 URL
}
```

#### 3.1.5 校正模板（CorrectorService）

```typescript
// 保存校正模板
POST /corrector-prefs
Request: {
  name: string;
  motionType: string;
  overrides: Partial<ParsedResult>;
}
Response: CorrectorPref

// 列出校正模板
GET /corrector-prefs?motionType=斜抛
Response: CorrectorPref[]

// 应用校正模板到题目
POST /problems/:id/apply-corrector/:prefId
Response: Problem  // 返回已更新的题目
```

#### 3.1.6 设置（SettingsService）

```typescript
// 获取用户设置
GET /settings
Response: {
  defaultAiProvider: string;
  apiKeys: Record<string, string>;  // 加密存储
  defaultPlaybackSpeed: number;
  defaultTimeStep: number;
  theme: "light" | "dark";
}

// 更新设置
PUT /settings
Request: {
  defaultAiProvider?: string;
  apiKeys?: Record<string, string>;
  // ...
}
Response: Settings

// 验证 API Key
POST /settings/validate-key
Request: {
  provider: string;
  apiKey: string;
}
Response: { valid: boolean; error?: string }
```

### 3.2 外部 AI Provider 接口

统一封装层，将各厂商 API 差异屏蔽。

```typescript
// 统一请求结构
interface AIRequest {
  provider: "openai" | "claude" | "deepseek" | "gemini" | "ollama";
  apiKey: string;
  baseUrl?: string;  // 用于 Ollama 本地地址或其他自定义端点
  model?: string;    // 具体模型名
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature?: number;
  responseFormat?: { type: "json_object" };  // 要求 JSON 输出
}

// 统一响应结构
interface AIResponse {
  content: string;           // 原始文本
  parsedJson?: ParsedResult; // 尝试解析后的结果
  usage?: { prompt: number; completion: number };
  confidence?: number;       // 自定义：二次校验后的置信度
}

// Provider 工厂
POST /ai/parse
Request: AIRequest & { rawText: string }
Response: AIResponse
```

各 Provider 实际调用端点：

| Provider | 实际端点 | 说明 |
|----------|----------|------|
| OpenAI | `https://api.openai.com/v1/chat/completions` | 使用 `gpt-4o`，启用 `json_object` response_format |
| Claude | `https://api.anthropic.com/v1/messages` | 使用 `claude-3-5-sonnet-20241022`，要求 XML/JSON 标签包裹 |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | 兼容 OpenAI 格式 |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/models/...` | 使用 `gemini-1.5-pro` |
| Ollama | 用户自定义，如 `http://localhost:11434/api/chat` | 本地运行，零网络依赖 |

---

## 4. 项目目录结构

```
physvis/
├── public/
│   ├── favicon.ico
│   └── templates/                    # 内置场景模板 JSON
│       ├── inclined-plane.json
│       ├── spring-oscillator.json
│       ├── conveyor-belt.json
│       └── ...
│
├── src/
│   ├── main.tsx                      # 应用入口
│   ├── App.tsx                       # 根组件 + 路由
│   ├── index.css                     # Tailwind 入口
│   │
│   ├── components/                   # UI 组件
│   │   ├── layout/
│   │   │   ├── MainLayout.tsx        # 主布局（Canvas + 侧边栏）
│   │   │   ├── SettingsLayout.tsx    # 设置页布局
│   │   │   └── Header.tsx            # 顶部工具栏
│   │   ├── canvas/
│   │   │   ├── PhysicsCanvas.tsx     # 主 Canvas 容器
│   │   │   ├── GridRenderer.ts       # 网格绘制
│   │   │   ├── TrajectoryRenderer.ts # 轨迹绘制
│   │   │   ├── ForceRenderer.ts      # 受力矢量绘制
│   │   │   └── ObjectRenderer.ts     # 物体渲染（质点/刚体）
│   │   ├── controls/
│   │   │   ├── PlaybackControls.tsx  # 播放/暂停/速度控制
│   │   │   ├── Timeline.tsx          # 时间轴 + 帧控制
│   │   │   └── SeekBar.tsx           # 进度条
│   │   ├── panels/
│   │   │   ├── ParameterPanel.tsx    # 参数调节面板
│   │   │   ├── ForcePanel.tsx        # 受力显示控制
│   │   │   ├── ProblemPanel.tsx      # 题目文本展示
│   │   │   └── PropertiesPanel.tsx   # 物体属性面板
│   │   ├── charts/
│   │   │   ├── VTChart.tsx           # 速度-时间图
│   │   │   ├── XTChart.tsx           # 位移-时间图
│   │   │   ├── ATChart.tsx           # 加速度-时间图
│   │   │   └── ChartOverlay.tsx      # 图表联动高亮
│   │   ├── modals/
│   │   │   ├── AIConfigModal.tsx     # AI 配置弹窗
│   │   │   ├── ExportModal.tsx       # 导出设置弹窗
│   │   │   ├── CorrectionModal.tsx   # 人工校正弹窗
│   │   │   └── TemplatePicker.tsx    # 模板选择弹窗
│   │   └── ui/                       # shadcn/ui 原子组件
│   │       ├── button.tsx
│   │       ├── slider.tsx
│   │       ├── input.tsx
│   │       ├── select.tsx
│   │       └── ...
│   │
│   ├── hooks/                        # 自定义 Hooks
│   │   ├── useSimulation.ts          # 模拟核心控制
│   │   ├── usePhysicsEngine.ts       # 物理引擎桥接
│   │   ├── useAnimationLoop.ts       # requestAnimationFrame 管理
│   │   ├── useExport.ts              # 导出逻辑
│   │   └── useIndexedDB.ts           # 本地数据库操作
│   │
│   ├── stores/                       # Zustand 状态管理
│   │   ├── simulationStore.ts        # 模拟状态
│   │   ├── problemStore.ts           # 题目数据
│   │   ├── settingsStore.ts          # 用户设置
│   │   └── uiStore.ts                # UI 状态（面板展开/折叠等）
│   │
│   ├── engine/                       # 物理引擎核心（纯算法，无 React 依赖）
│   │   ├── index.ts                  # 引擎入口
│   │   ├── types.ts                  # 引擎类型定义
│   │   ├── solver.ts                 # 主求解器
│   │   ├── integrator.ts             # 数值积分器（Verlet / RK4）
│   │   ├── collisions.ts             # 碰撞检测与响应
│   │   ├── constraints.ts            # 约束求解（绳/杆/斜面）
│   │   ├── forces.ts                 # 力计算（重力/弹力/摩擦力等）
│   │   ├── motions/                  # 各运动类型特化求解
│   │   │   ├── uniformAcceleration.ts
│   │   │   ├── projectile.ts
│   │   │   ├── circular.ts
│   │   │   └── harmonic.ts
│   │   └── events.ts                 # 物理事件（碰撞/相遇/到达边界）
│   │
│   ├── services/                     # 业务 Service 层
│   │   ├── problemService.ts         # 题目 CRUD
│   │   ├── simulationService.ts      # 模拟控制
│   │   ├── templateService.ts        # 模板管理
│   │   ├── exportService.ts          # 导出功能
│   │   ├── correctorService.ts       # 校正模板
│   │   ├── settingsService.ts        # 设置管理
│   │   └── dbService.ts              # IndexedDB 封装（Dexie）
│   │
│   ├── ai/                           # AI 解析层
│   │   ├── index.ts                  # 统一调用入口
│   │   ├── providers/                # 各厂商适配器
│   │   │   ├── openai.ts
│   │   │   ├── claude.ts
│   │   │   ├── deepseek.ts
│   │   │   ├── gemini.ts
│   │   │   └── ollama.ts
│   │   ├── promptBuilder.ts          # Prompt 组装
│   │   ├── responseParser.ts         # 响应解析与校验
│   │   └── schemas/                  # AI 输出 JSON Schema
│   │       └── physics-schema.json
│   │
│   ├── templates/                    # 内置模板数据
│   │   ├── index.ts
│   │   └── definitions/
│   │       ├── inclinedPlane.ts
│   │       ├── springOscillator.ts
│   │       └── ...
│   │
│   ├── utils/                        # 工具函数
│   │   ├── vector2d.ts               # 二维向量运算
│   │   ├── canvas.ts                 # Canvas 坐标转换
│   │   ├── urlEncoder.ts             # 分享链接压缩/解压
│   │   ├── validators.ts             # 参数校验
│   │   ├── constants.ts              # 物理常数
│   │   └── helpers.ts                # 通用辅助
│   │
│   ├── types/                        # 全局类型定义
│   │   └── index.ts
│   │
│   └── assets/                       # 静态资源
│       └── icons/
│
├── tests/
│   ├── unit/                         # 单元测试
│   │   ├── engine/                   # 物理引擎测试
│   │   ├── vector2d.test.ts
│   │   └── ai-parser.test.ts
│   ├── integration/                  # 集成测试
│   └── e2e/                          # Playwright E2E 测试
│
├── docs/                             # 文档
│   ├── PRD.md                        # 产品需求文档
│   ├── SPEC.md                       # 本技术规范
│   └── CONTRIBUTING.md               # 贡献指南
│
├── .env.example                      # 环境变量示例（仅前端公开配置）
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── package.json
├── README.md
└── LICENSE
```

---

## 5. 关键设计决策补充

### 5.1 物理引擎数值方案

- **积分器**：采用 **Velocity Verlet** 算法，兼顾精度与稳定性，满足高中物理教学误差要求
- **碰撞检测**：AABB + 圆形碰撞检测（高中场景物体形态简单，无需 SAT/GJK）
- **时间步长固定**：固定 Δt = 0.01s，播放时通过跳帧或插值实现变速播放，保证物理一致性

### 5.2 Canvas 渲染管线

```
[物理引擎计算] → [坐标转换（米→像素）] → [分层渲染]
                                              ├─ 背景层（网格/坐标轴）
                                              ├─ 轨迹层（残影）
                                              ├─ 物体层（质点/刚体）
                                              ├─ 受力层（矢量箭头）
                                              └─ 标注层（数值/标签）
```

### 5.3 AI 解析容错策略

1. **多层校验**：AI 返回 → JSON Schema 校验 → 物理合理性校验（如质量 > 0，速度在合理范围）
2. **置信度阈值**：confidence < 0.7 时强制进入人工校正流程
3. **Fallback**：AI 连续失败 3 次后，自动切换为用户手动输入模式

### 5.4 性能目标

| 指标 | 目标值 | 验证方式 |
|------|--------|----------|
| Canvas 帧率 | ≥ 60fps | Chrome DevTools Performance |
| 参数调节响应 | < 500ms | 从滑块释放到画面更新 |
| AI 解析响应 | < 10s | 标准网络环境 |
| 导出 1080p GIF | < 30s | 5 秒模拟时长 |
| IndexedDB 查询 | < 100ms | 1000 条题目 |

---

*文档版本：v1.0*  
*基于 PRD PhysVis — 高中物理运动可视化教学工具*
