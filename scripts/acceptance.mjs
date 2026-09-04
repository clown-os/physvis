// 浏览器验收（自动化冒烟，对应 README/PRD 验收清单的可自动化部分）。
// 用法：npm run dev 后执行 `npm run accept`（或 node scripts/acceptance.mjs [url]）
// 驱动本机 Edge（playwright-core + channel: msedge），零浏览器下载。
import { chromium } from 'playwright-core'

const BASE = process.argv[2] ?? 'http://localhost:5199/'
const results = []
const consoleErrors = []

function check(name, ok, extra = '') {
  results.push({ name, ok, extra })
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}${extra ? `  — ${extra}` : ''}`)
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // —— 1. 首屏 boot：自动载入首个内置示例 ——
  const header = page.locator('header p.truncate')
  await header.waitFor({ timeout: 8000 })
  const bootTitle = await header.textContent()
  check('启动引导自动载入示例场景', /自由落体/.test(bootTitle ?? ''), bootTitle ?? '')

  const canvasCount0 = await page.locator('canvas').count()
  check('画布 canvas 已渲染', canvasCount0 >= 1, `${canvasCount0} 个`)

  // —— 2. 逐帧前进：时间按 0.01 s 步进 ——
  const timeSpan = page.locator('.tabular-nums .font-medium').first()
  const t0 = await timeSpan.textContent()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '前进一帧 (0.01s)' }).click()
  const t1 = await timeSpan.textContent()
  check('逐帧前进 3 步 = 0.03 s', t1 === '0.03', `${t0} → ${t1}`)

  // —— 3. 播放推进 ——
  await page.getByRole('button', { name: '播放' }).click()
  await sleep(1200)
  await page.getByRole('button', { name: '暂停' }).click()
  const t2 = await timeSpan.textContent()
  check('播放后 simTime 前进', parseFloat(t2 ?? '0') > 0.3, `t=${t2}s`)
  await page.getByRole('button', { name: '回到开头' }).click()

  // —— 3b. 重播：拖到末尾后按「重播」应从 0 重新播放（regression：曾点了没反应） ——
  await page.locator('input[aria-label="时间轴"]').evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, el.max)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await sleep(200)
  check('拖到末尾后主键显示「重播」', (await page.locator('button', { hasText: '重播' }).count()) === 1)
  await page.locator('button', { hasText: '重播' }).first().click()
  await sleep(400)
  const tReplay = await timeSpan.textContent()
  const replayRunning = await page.getByRole('button', { name: '暂停' }).count()
  check('重播回到 0 重新播放', replayRunning === 1 && parseFloat(tReplay ?? '99') < 1, `t=${tReplay}s`)
  await page.getByRole('button', { name: '暂停' }).click()

  // —— 4. 示例题弹窗 + 「直接演示」载入（loadScene 自动复位 t=0） ——
  await page.getByRole('button', { name: '示例题', exact: true }).click()
  const exampleCard = page.locator('article', { hasText: '追及能否追上' })
  await exampleCard.waitFor({ timeout: 5000 })
  check('示例题弹窗：内置 20 题', (await page.locator('article').count()) >= 20)
  check(
    '示例题含 P2 电磁/圆环/板块类',
    (await page.locator('article', { hasText: '圆环内壁下滑' }).count()) >= 1 &&
      (await page.locator('article', { hasText: '带电粒子类平抛偏转' }).count()) >= 1,
  )
  await exampleCard.getByRole('button', { name: '直接演示' }).click()
  await sleep(300)
  const titleAfterExample = await header.textContent()
  check('「追及能否追上」直接演示载入', /追及/.test(titleAfterExample ?? ''), titleAfterExample ?? '')

  // —— 4b. 题目截图上传（识图建模）：缩略图出现并可移除 ——
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.locator('input[type="file"]').setInputFiles({ name: 't.png', mimeType: 'image/png', buffer: png })
  await sleep(250)
  check('上传题目截图后出现缩略图', (await page.locator('img[alt^="题目截图"]').count()) >= 1)
  await page.locator('button[title="移除这张截图"]').click()
  await sleep(150)
  check('截图可移除', (await page.locator('img[alt^="题目截图"]').count()) === 0)

  // —— 5. mock AI 解析（低置信 → 人工校正 → 接受） ——
  await page.getByRole('button', { name: '示例题', exact: true }).click()
  const vthrowCard = page.locator('article', { hasText: '竖直上抛的最大高度' })
  await vthrowCard.getByRole('button', { name: /AI 解析演示/ }).click()
  const modalTitle = page.getByRole('heading', { name: /AI 建议人工确认|AI 解析未通过/ })
  await modalTitle.waitFor({ timeout: 8000 })
  check('低置信解析弹出人工校正窗', true, (await modalTitle.textContent()) ?? '')
  const acceptBtn = page.getByRole('button', { name: /仍使用此结果/ })
  check('校正窗展示 AI 理解的要素表', (await page.locator('table').count()) >= 1)
  await acceptBtn.click()
  await modalTitle.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
  const titleAfterAccept = await header.textContent()
  check('接受后场景载入（竖直上抛）', /上抛/.test(titleAfterAccept ?? ''), titleAfterAccept ?? '')

  // —— 6. 参数面板：滑块存在 + 拖动即时重算（时长变化） ——
  await page.getByRole('tab', { name: /参数/ }).click()
  const slider = page.locator('input[type="range"]').first()
  await slider.waitFor({ timeout: 5000 })
  const timeRow = page.locator('span.w-28').first() // "0.00 / 3.06 s" 整行
  const before = await timeRow.textContent()
  // 拖「初速度 v₀」滑块到 8（原 15 → 时长必变）
  const v0Slider = page.locator('input[aria-label="初速度 v₀ 滑块"]')
  if ((await v0Slider.count()) > 0) {
    await v0Slider.first().evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, 8)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await sleep(300)
  } else {
    throw new Error('未找到初速度滑块（vthrow 场景应存在 v₀ 参数）')
  }
  const after = await timeRow.textContent()
  check('拖动初速度后时长即时更新', before !== after, `时长 ${before?.trim()} → ${after?.trim()}`)

  // —— 6b. 撤销/重做快捷键（焦点移出输入框，避免被键盘 handler 忽略） ——
  await page.locator('header h1').click()
  const durBeforeUndo = await timeRow.textContent()
  await page.keyboard.press('Control+z')
  await sleep(250)
  const durAfterUndo = await timeRow.textContent()
  check('Ctrl+Z 撤销参数改动', durBeforeUndo !== durAfterUndo, `${durBeforeUndo?.trim()} → ${durAfterUndo?.trim()}`)
  await page.keyboard.press('Control+y')
  await sleep(250)
  const durAfterRedo = await timeRow.textContent()
  check('Ctrl+Y 重做参数改动', durAfterUndo !== durAfterRedo, `${durAfterUndo?.trim()} → ${durAfterRedo?.trim()}`)

  // —— 7. 图表 Tab：三张联动图 canvas 渲染 ——
  await page.getByRole('tab', { name: /图表/ }).click()
  await sleep(800)
  const canvasCount1 = await page.locator('canvas').count()
  check('图表区渲染（主画布 + 3 图）', canvasCount1 >= canvasCount0 + 2, `${canvasCount0} → ${canvasCount1} 个 canvas`)

  // —— 8. 模板库 ——
  await page.getByRole('button', { name: '模板库', exact: true }).click()
  await page.getByText('场景模板库').waitFor({ timeout: 5000 })
  check('模板库分组含 P2 板块', (await page.getByText('P2 · 高考电磁场与综合模型').count()) >= 1)
  const libCard = page.locator('button', { hasText: '匀速圆周' }).first()
  await libCard.click()
  await sleep(300)
  const titleAfterLib = await header.textContent()
  check('模板库一键实例化（匀速圆周）', /圆周/.test(titleAfterLib ?? ''), titleAfterLib ?? '')

  // —— 8b. P2 模板实例化：带电粒子（电磁场）与竖直圆周（绳） ——
  await page.getByRole('button', { name: '模板库', exact: true }).click()
  const emCard = page.locator('button', { hasText: '带电粒子' }).first()
  await emCard.waitFor({ timeout: 5000 })
  await emCard.click()
  await sleep(300)
  const titleAfterEm = await header.textContent()
  check('P2 带电粒子模板实例化', /电场|磁场|带电/.test(titleAfterEm ?? ''), titleAfterEm ?? '')
  await page.getByRole('tab', { name: /受力/ }).click()
  const fieldToggle = page.locator('[role="switch"][title^="显示电场"]')
  check('受力面板有「场」开关（电场/磁场背景）', (await fieldToggle.count()) >= 1)
  await page.getByRole('button', { name: '模板库', exact: true }).click()
  const vcCard = page.locator('button', { hasText: '绳只能拉不能撑' }).first()
  await vcCard.waitFor({ timeout: 5000 })
  await vcCard.click()
  await sleep(300)
  const titleAfterVc = await header.textContent()
  check('P2 竖直圆周（绳）模板实例化', /绳|竖直圆周/.test(titleAfterVc ?? ''), titleAfterVc ?? '')
  // 默认 v₀=10 > √(5gL) 完整过顶 → 无事件；拖到 8（低于临界）→ 脱绳 → 绳张紧事件刻度
  const vcSlider = page.locator('input[aria-label="最低点速率 v₀ 滑块"]')
  if ((await vcSlider.count()) > 0) {
    await vcSlider.first().evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, 8)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await sleep(500)
  } else {
    throw new Error('未找到竖直圆周的最低点速率滑块')
  }
  const eventMarks = await page.locator('[aria-label^="跳转到事件"]').count()
  check('竖直圆周绳模型低于临界 → 绳张紧事件刻度', eventMarks >= 1, `事件刻度元素 ${eventMarks} 个`)

  // —— 8c. 讲解面板（步骤跳转 + 开关慢放）与半径滑块 ——
  await page.getByRole('button', { name: '示例题', exact: true }).click()
  await page.locator('article', { hasText: '追及能否追上' }).getByRole('button', { name: '直接演示' }).click()
  await sleep(300)
  await page.getByRole('tab', { name: /讲解/ }).click()
  const stepBtns = page.locator('button[title^="跳到该步骤时刻"]')
  check('讲解面板渲染分步讲解', (await stepBtns.count()) >= 2, `${await stepBtns.count()} 步`)
  await stepBtns.nth(2).click()
  await sleep(200)
  const tStep = parseFloat((await timeSpan.textContent()) ?? '0')
  check('点击讲解步骤跳转到对应时刻', tStep >= 5.9, `t=${tStep}s`)
  // 开讲解 → 慢放（0.35×）：800ms 实际推进约 0.28s
  await page.getByRole('button', { name: '回到开头' }).click()
  const explainSwitch = page.locator('[role="switch"]', { hasText: '讲解' }).first()
  await explainSwitch.click()
  await page.getByRole('button', { name: '播放' }).click()
  await sleep(800)
  await page.getByRole('button', { name: '暂停' }).click()
  const tSlow = parseFloat((await timeSpan.textContent()) ?? '99')
  check('讲解开启 → 画面慢放（0.35×）', tSlow > 0.05 && tSlow < 0.45, `800ms 实际推进 ${tSlow}s`)
  // 关讲解 → 恢复正常速度
  await explainSwitch.click()
  await page.getByRole('button', { name: '回到开头' }).click()
  await page.getByRole('button', { name: '播放' }).click()
  await sleep(800)
  await page.getByRole('button', { name: '暂停' }).click()
  const tFast = parseFloat((await timeSpan.textContent()) ?? '99')
  check('讲解关闭 → 恢复正常速度', tFast > 0.55, `800ms 实际推进 ${tFast}s`)
  // 半径滑块（每个物体一组）
  await page.getByRole('tab', { name: /参数/ }).click()
  const rSlider = page.locator('input[aria-label="半径 r 滑块"]').first()
  check('参数面板有小球半径滑块', (await rSlider.count()) >= 1)
  if ((await rSlider.count()) > 0) {
    const beforeR = await rSlider.inputValue()
    await rSlider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(el, 0.8)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await sleep(250)
    check('拖动半径滑块实时生效', beforeR !== (await rSlider.inputValue()), `半径 ${beforeR} → ${await rSlider.inputValue()}`)
  }

  // —— 9. 设置弹窗 ——
  await page.getByRole('button', { name: '⚙' }).click()
  await page.getByRole('heading', { name: '设置' }).waitFor({ timeout: 5000 })
  check('设置弹窗：mock 通道默认激活', (await page.locator('input[type="radio"]:checked').count()) >= 1)
  await page.keyboard.press('Escape')
  await sleep(200)
  check('Esc 关闭设置弹窗', (await page.getByRole('heading', { name: '设置' }).count()) === 0)

  // —— 运行时错误审计 ——
  check('全程无 console/page 运行时错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
} catch (e) {
  results.push({ name: '验收脚本异常中止', ok: false, extra: String(e) })
  console.log(`  ✘ 异常：${e}`)
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 项通过`)
process.exit(failed.length === 0 ? 0 : 1)
