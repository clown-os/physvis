// 应用路由：单页工作区（后续扩展页面的挂载点）。
import { Routes, Route, Navigate } from 'react-router'
import Workspace from './pages/Workspace'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Workspace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
