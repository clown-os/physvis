import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* HashRouter：兼容 GitHub Pages 子路径（/physvis/）与 dist 压缩包 file:// 本地打开 */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
