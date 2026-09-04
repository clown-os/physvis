// README 演示截图生成（与 acceptance.mjs 同款方案：playwright-core + 本机 Edge）。
// 用法：npm run dev 后执行 `node scripts/screenshot.mjs [url] [outdir]`
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:5173/'
const OUT = process.argv[3] ?? 'docs/screenshots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.locator('header p.truncate').waitFor({ timeout: 8000 })

  // 1) 主界面：自由落体（首屏示例）+ 三张联动图表
  await page.getByRole('tab', { name: /图表/ }).click()
  await sleep(900)
  await page.screenshot({ path: `${OUT}/main.png` })

  // 2) 分步讲解：追及问题（步骤列表 + 高亮 + 慢放开关）
  await page.getByRole('button', { name: '示例题', exact: true }).click()
  await page.locator('article', { hasText: '追及能否追上' }).getByRole('button', { name: '直接演示' }).click()
  await sleep(300)
  await page.getByRole('tab', { name: /讲解/ }).click()
  await sleep(600)
  await page.screenshot({ path: `${OUT}/explanation.png` })

  // 3) 带电粒子在磁场中的运动 + 场提示层（优先磁场模板）
  await page.getByRole('button', { name: '模板库', exact: true }).click()
  const bfieldCard = page.locator('button', { hasText: '磁场' }).first()
  if ((await bfieldCard.count()) > 0) {
    await bfieldCard.click()
  } else {
    await page.locator('button', { hasText: '带电粒子' }).first().click()
  }
  await sleep(400)
  await page.getByRole('tab', { name: /受力/ }).click()
  const fieldSwitch = page.locator('[role="switch"][title^="显示"]').first()
  if ((await fieldSwitch.count()) > 0) await fieldSwitch.click()
  await sleep(500)
  await page.screenshot({ path: `${OUT}/em.png` })

  console.log(`截图完成 → ${OUT}/main.png explanation.png em.png`)
} finally {
  await browser.close()
}
