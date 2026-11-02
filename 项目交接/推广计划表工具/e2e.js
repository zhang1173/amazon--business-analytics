const { chromium } = require('playwright');
const path = require('path');
// 用法：node e2e.js   （先 python3 build.py 出 build/ 里的网页；XLSX_LIB=本地 xlsx.full.min.js 路径，可选，没网时用）
const file = 'file://' + (process.env.PAGE || path.resolve(__dirname, 'build/推广计划表（可直接打开）.html'));
const shots = path.resolve(__dirname, 'shots'); require('fs').mkdirSync(shots, { recursive: true });
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const lib = process.env.XLSX_LIB;
  if (lib) await ctx.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ path: lib, contentType: 'application/javascript' }));
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(file);
  await page.waitForSelector('table.t');
  const xlsxLoaded = await page.evaluate(() => typeof XLSX !== 'undefined');
  console.log('XLSX loaded:', xlsxLoaded);
  // 切到原表格口径，对 Excel
  await page.click('header .seg button[data-k="sheet"]');
  await page.waitForTimeout(100);
  const r0 = await page.evaluate(() => { const r = window.__promo.calc('o1').rows[0]; return { net: r.net, profit: r.profit, cpa: r.cpa, sales: r.sales, payDate: r.payDate, unitPayback: r.unitPayback, adSpend: r.adSpend }; });
  ok(Math.abs(r0.net + 143.37) < 0.01, 'Excel 11/7 净回款 −143.37: ' + r0.net.toFixed(2));
  ok(Math.abs(r0.profit + 172.26) < 0.01, 'Excel 11/7 订单毛利 −172.26: ' + r0.profit.toFixed(2));
  ok(Math.abs(r0.unitPayback - 10.54) < 0.01, '单价回款 10.54: ' + r0.unitPayback.toFixed(4));
  ok(Math.abs(r0.adSpend - 175) < 0.01, '广告 175');
  const firstNet = await page.locator('table.t tbody tr').first().locator('td').nth(0).locator('input').inputValue();
  ok(firstNet === '2026-11-07', '第一行日期 ' + firstNet);
  const cellText = await page.locator('table.t tbody tr').first().innerText();
  ok(cellText.includes('−$143.37') && cellText.includes('2026-12-02') && cellText.includes('−$172.26'), '第一行显示净回款/回款日期/毛利');
  await page.screenshot({ path: shots + '/plan-sheet.png', fullPage: false });
  // 改单量（第 1 行 3 → 6）
  const units = page.locator('input[data-fk="r0.units"]');
  await units.fill('6'); await units.press('Enter'); await page.waitForTimeout(100);
  const u = await page.evaluate(() => window.__promo.state().plans[0].rows[0].units);
  ok(u === 6, '改单量生效 ' + u);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.fk);
  ok(focused === 'r1.units', '回车跳到下一行 ' + focused);
  // 改广告花费 → 倒推广告单占比（6 单 × CPA 58.33 = 350；改成 175 → 50%）
  const ad = page.locator('input[data-fk="r0.adSpend"]');
  await ad.fill('175'); await ad.press('Tab'); await page.waitForTimeout(150);
  const sh = await page.evaluate(() => window.__promo.state().plans[0].rows[0].adShare);
  ok(Math.abs(sh - 0.5) < 1e-6, '广告花费倒推占比 0.5: ' + sh);
  // 加一天
  await page.click('button[data-act="addDay"]'); await page.waitForTimeout(100);
  let n = await page.evaluate(() => window.__promo.state().plans[0].rows.length);
  ok(n === 12, '加一天后 12 行');
  // 加到某天
  await page.fill('input[data-f="addTo"]', '2026-11-25'); await page.locator('input[data-f="addTo"]').dispatchEvent('change');
  await page.click('button[data-act="addTo"]'); await page.waitForTimeout(100);
  n = await page.evaluate(() => window.__promo.state().plans[0].rows.length);
  ok(n === 19, '加到 11/25 后 19 行: ' + n);
  // 删一行 + 撤销
  await page.locator('button[data-act="delRow"]').last().click(); await page.waitForTimeout(100);
  n = await page.evaluate(() => window.__promo.state().plans[0].rows.length);
  ok(n === 18, '删一行 18');
  await page.click('.toast button[data-act="undo"]'); await page.waitForTimeout(100);
  n = await page.evaluate(() => window.__promo.state().plans[0].rows.length);
  ok(n === 19, '撤销后 19');
  // 快速生成：替换
  await page.click('button[data-act="panel"][data-k="gen"]'); await page.waitForTimeout(100);
  await page.fill('input[data-fk="qg.days"]', '30'); await page.locator('input[data-fk="qg.days"]').press('Tab'); await page.waitForTimeout(100);
  const hint = await page.locator('.panel .note').last().innerText();
  ok(hint.includes('共 30 天'), '生成提示 ' + hint);
  await page.click('button[data-act="qgApply"][data-k="replace"]'); await page.waitForTimeout(100);
  n = await page.evaluate(() => window.__promo.state().plans[0].rows.length);
  ok(n === 30, '替换成 30 天');
  // 粘贴（Excel 整行，含表头）
  await page.click('button[data-act="panel"][data-k="paste"]'); await page.waitForTimeout(100);
  const head = ['日期','月份','x','y','前台售价$','prime','coupon','coupon使用率','prime折扣使用率','最低价','均价','单价回款','广告花费$','CPC','CTR','CVR','CPA','ACOS','TACOS','总单量','广告单','广告单占比'];
  const line = (d, units) => ['2026/12/' + d,'2026年12月','','', '29.99','0%','30%','80%','90%','','','','', '5','1%','12%','','','', String(units),'','80%'].join('\t');
  const text = head.join('\t') + '\n' + line(1, 50) + '\n' + line(2, 60);
  await page.fill('textarea[data-f="paste"]', text); await page.waitForTimeout(50);
  const info = await page.locator('#pasteInfo').innerText();
  ok(info.includes('认出 2 天'), '粘贴识别 ' + info);
  await page.click('button[data-act="pasteApply"][data-k="append"]'); await page.waitForTimeout(100);
  const rows = await page.evaluate(() => window.__promo.state().plans[0].rows.filter(r => r.date === '2026-12-01' || r.date === '2026-12-02'));
  ok(rows.length === 2 && rows[0].date === '2026-12-01' && rows[1].units === 60 && Math.abs(rows[0].cvr - 0.12) < 1e-9 && Math.abs(rows[1].adShare - 0.8) < 1e-9, '粘贴进来的数 ' + JSON.stringify(rows[1]));
  // 费用明细
  await page.click('input[data-act="toggleFees"]'); await page.waitForTimeout(100);
  const ths = await page.locator('table.t thead th').count();
  ok(ths > 35, '费用明细列 ' + ths);
  await page.screenshot({ path: shots + '/plan-fees.png' });
  // 各 tab
  for (const t of ['summary', 'cash', 'annual', 'compare', 'params']) {
    await page.click('nav.tabs button[data-k="' + t + '"]'); await page.waitForTimeout(200);
    const txt = await page.locator('main').innerText();
    ok(!txt.includes('出错了'), 'tab ' + t + ' 正常');
    await page.screenshot({ path: shots + '/' + t + '.png', fullPage: true });
  }
  // 资金盘：切口径 B
  await page.click('nav.tabs button[data-k="cash"]'); await page.waitForTimeout(100);
  const minA = await page.locator('.kpi .v').first().innerText();
  await page.click('button[data-act="payout"][data-k="dod"]'); await page.waitForTimeout(150);
  const minB = await page.locator('.kpi .v').first().innerText();
  console.log('最低现金 A/B', minA, minB);
  await page.hover('#cashChart svg', { position: { x: 300, y: 100 } }); await page.waitForTimeout(50);
  ok(await page.locator('#tip').isVisible(), '图表悬停提示');
  await page.click('button[data-act="payout"][data-k="auto"]');
  // 方案对比：列数、改一个生成参数
  await page.click('nav.tabs button[data-k="compare"]'); await page.waitForTimeout(150);
  const cols = await page.locator('table.cmp thead th.pl').count();
  ok(cols === 4, '对比 4 列（运营 1 + 工具 3）: ' + cols);
  const before = await page.locator('table.cmp tbody tr').nth(2).innerText();
  await page.fill('input[data-fk="gen1.coupon"]', '20'); await page.locator('input[data-fk="gen1.coupon"]').press('Tab'); await page.waitForTimeout(150);
  const after = await page.locator('table.cmp tbody tr').nth(2).innerText();
  ok(before !== after, '改中速 coupon 后对比表变化');
  // 复制成运营方案
  await page.locator('button[data-act="copyGen"]').first().click(); await page.waitForTimeout(150);
  const tab = await page.evaluate(() => window.__promo.state().ui.tab);
  const nPlans = await page.evaluate(() => window.__promo.state().plans.length);
  ok(tab === 'plan' && nPlans === 2, '复制工具方案成运营方案');
  // 全年表：填实际
  await page.click('nav.tabs button[data-k="annual"]'); await page.waitForTimeout(150);
  const a = page.locator('table.ann input').first();
  await a.fill('500'); await a.press('Tab'); await page.waitForTimeout(150);
  const annTxt = await page.locator('table.ann').innerText();
  ok(/单量偏差[\s\S]*\(|（/.test(annTxt), '偏差行出现');
  // 参数：改汇率
  await page.click('nav.tabs button[data-k="params"]'); await page.waitForTimeout(150);
  await page.fill('input[data-fk="p.fx"]', '7'); await page.locator('input[data-fk="p.fx"]').press('Tab'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.__promo.state().params.fx === 7), '改汇率');
  // 导出 Excel
  if (xlsxLoaded) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('button[data-act="exportXlsx"]')]);
    const p = path.resolve(__dirname, 'shots', 'export.xlsx'); await dl.saveAs(p);
    console.log('导出文件', dl.suggestedFilename());
    const X = require(process.env.XLSX_PKG || 'xlsx');
    const wb = X.readFile(p);
    console.log('sheets:', wb.SheetNames.join(', '));
    const d = X.utils.sheet_to_json(wb.Sheets['推广计划表'], { header: 1 });
    console.log('推广计划表 rows', d.length, 'head', d[0].slice(0, 6).join('|'));
    const cm = X.utils.sheet_to_json(wb.Sheets['方案对比'], { header: 1 });
    console.log('方案对比 cols', cm[0].length, cm.slice(0, 4).map(r => r.slice(0, 3).join('|')).join(' / '));
    ok(wb.SheetNames.length === 8, '导出 8 张表');
  }
  // 刷新后数据还在
  await page.reload(); await page.waitForSelector('main');
  ok(await page.evaluate(() => window.__promo.state().params.fx === 7 && window.__promo.state().plans.length === 2), '刷新后数据保留');
  ok(errs.filter(e => !/ERR_TUNNEL|Failed to load resource/.test(e)).length === 0, '无报错 ' + errs.join(' | '));
  // 手机 + 深色
  const ph = await browser.newContext({ viewport: { width: 400, height: 860 }, colorScheme: 'dark' });
  const pp = await ph.newPage(); const errs2 = [];
  pp.on('pageerror', e => errs2.push(String(e)));
  await pp.goto(file + '#plan'); await pp.waitForSelector('table.t');
  const ow = await pp.evaluate(() => document.documentElement.scrollWidth);
  ok(ow <= 400, '手机不横向滚动 ' + ow);
  await pp.screenshot({ path: shots + '/phone-plan-dark.png' });
  for (const t of ['cash', 'compare']) { await pp.click('nav.tabs button[data-k="' + t + '"]'); await pp.waitForTimeout(200); const w = await pp.evaluate(() => document.documentElement.scrollWidth); ok(w <= 400, '手机 ' + t + ' 宽 ' + w); await pp.screenshot({ path: shots + '/phone-' + t + '-dark.png', fullPage: true }); }
  ok(errs2.length === 0, '手机无报错 ' + errs2.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASS');
})();
