// 场景模块聚合入口：import 本模块即完成模板副作用注册。
import './templates'
export * from './registry'
export type { ScenarioTemplate, TemplateInstance } from './registry'
export { EXAMPLE_PROBLEMS } from '../../examples/problems'
export type { ExampleProblem } from '../../examples/problems'
