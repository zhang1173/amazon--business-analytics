const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const SRC = process.argv[2] || 'Y背推广现金流沙盘.html';
const wrap = html => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${html}</body></html>`;
const tmp = path.resolve('app/_wrapped.html'); fs.writeFileSync(tmp, wrap(fs.readFileSync(SRC, 'utf8')));
const DONE = () => !document.querySelector('#progress').classList.contains('on') && document.querySelector('#verdict .big') && document.querySelector('#verdict .big').textContent.length > 0;
async function waitDone(page) { await page.waitForFunction(DONE, null, { timeout: 40000 }); }
(async () => {
  const browser = await chromium.launch();
  for (const [name, vp, dark] of [['desktop', { width: 1280, height: 900 }, false], ['phone', { width: 400, height: 800 }, false], ['phonedark', { width: 400, height: 800 }, true]]) {
    const page = await browser.newPage({ viewport: vp, colorScheme: dark ? 'dark' : 'light' });
    const errors = []; page.on('pageerror', e => errors.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('file://' + tmp);
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
    await page.reload();
    const t0 = Date.now(); await waitDone(page).catch(() => errors.push('timeout waiting for compute'));
    const info = await page.evaluate(() => {
      const vis = el => !!(el && el.getClientRects().length && getComputedStyle(el).display !== 'none');
      return {
        scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
        sidebar: vis(document.querySelector('#sidebar')), bottomnav: vis(document.querySelector('#bottomnav')),
        verdict: document.querySelector('#verdict').innerText.replace(/\s+/g, ' ').slice(0, 300),
        kpis: document.querySelectorAll('.kpi').length, six: document.querySelectorAll('#six .row').length,
        charts: document.querySelectorAll('figure.chart svg').length, saved: document.querySelector('#saved').textContent,
        title: document.querySelector('#view-title').textContent, worker: typeof Worker,
      };
    });
    console.log(name, 'compute ms', Date.now() - t0, JSON.stringify(info, null, 1)); console.log('errors:', errors);
    const nav = name === 'desktop' ? '#sidebar' : '#bottomnav';
    await page.screenshot({ path: `app/shot_${name}_home.png`, fullPage: false });
    if (name === 'phonedark') { await page.screenshot({ path: `app/shot_${name}_home_full.png`, fullPage: true }); await page.click(nav + ' button[data-view=compare]'); await page.waitForTimeout(300); await page.screenshot({ path: `app/shot_${name}_compare.png` }); await page.close(); continue; }
    await page.screenshot({ path: `app/shot_${name}_home_full.png`, fullPage: true });
    // 填数字
    await page.click(nav + ' button[data-view=inputs]'); await page.waitForTimeout(200);
    console.log('inputs view:', await page.evaluate(() => ({ title: document.querySelector('#view-title').textContent, steps: document.querySelectorAll('#view-inputs .steps button').length, stepOn: document.querySelector('#view-inputs .step.on') && document.querySelector('#view-inputs .step.on').dataset.step, fields: document.querySelectorAll('#view-inputs .step.on input,#view-inputs .step.on select').length, scrollW: document.documentElement.scrollWidth })));
    await page.screenshot({ path: `app/shot_${name}_inputs.png`, fullPage: true });
    // 改现金 80 万
    await page.fill('input[data-path="cash.opening_cash_cny"]', '800000'); await page.waitForTimeout(400);
    await page.click(nav + ' button[data-view=home]'); await waitDone(page);
    console.log('after cash 800k:', await page.evaluate(() => document.querySelector('#verdict .big').textContent.replace(/\s+/g, ' ') + ' | ' + document.querySelector('.kpi .v').textContent));
    // 阶段卡片：第 4 步
    await page.click(nav + ' button[data-view=inputs]'); await page.click('#view-inputs .steps button[data-step="3"]'); await page.waitForTimeout(200);
    const phInfo = await page.evaluate(() => ({ phases: document.querySelectorAll('#phases .ph').length, inputs: document.querySelectorAll('#phases input').length, scrollW: document.documentElement.scrollWidth }));
    console.log('phase step:', JSON.stringify(phInfo));
    await page.screenshot({ path: `app/shot_${name}_phases.png`, fullPage: true });
    // 杠杆：推广节奏 ×0.5
    await page.click(nav + ' button[data-view=home]'); await waitDone(page);
    await page.evaluate(() => { const r = document.querySelector('#lever-pace'); r.value = '0.5'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(500); await waitDone(page);
    console.log('after pace 0.5:', await page.evaluate(() => document.querySelector('#lv-pace').textContent + ' | ' + document.querySelector('#verdict .big').textContent.replace(/\s+/g, ' ') + ' | ' + document.querySelector('.kpi .v').textContent));
    // 采用推荐
    const adopt = await page.$('button[data-act=adopt]'); if (adopt) { await adopt.click(); await page.waitForTimeout(500); await waitDone(page); console.log('after adopt:', await page.evaluate(() => document.querySelector('#lv-pace').textContent + ' | ' + document.querySelector('#verdict').innerText.replace(/\s+/g, ' ').slice(0, 260))); } else console.log('no adopt button');
    // 对比
    await page.click(nav + ' button[data-view=compare]'); await page.waitForTimeout(300);
    console.log('compare:', await page.evaluate(() => ({ title: document.querySelector('#view-title').textContent, tables: document.querySelectorAll('#view-compare table').length, rows: document.querySelectorAll('#view-compare table tbody tr').length, best: document.querySelectorAll('#view-compare tr.best').length, cur: document.querySelectorAll('#view-compare tr.cur').length, scrollW: document.documentElement.scrollWidth })));
    await page.screenshot({ path: `app/shot_${name}_compare.png`, fullPage: true });
    // 明细
    await page.click(nav + ' button[data-view=detail]'); await page.waitForTimeout(300);
    console.log('detail:', await page.evaluate(() => ({ secs: document.querySelectorAll('#view-detail details.sec').length, tables: document.querySelectorAll('#view-detail table').length, scrollW: document.documentElement.scrollWidth })));
    await page.evaluate(() => document.querySelectorAll('#view-detail details.sec').forEach(d => d.open = true));
    await page.screenshot({ path: `app/shot_${name}_detail.png`, fullPage: true });
    // 设置
    await page.click(nav + ' button[data-view=settings]'); await page.waitForTimeout(300);
    console.log('settings:', await page.evaluate(() => ({ preset: !!document.querySelector('#preset'), io: (document.querySelector('#io-text') || {}).value ? document.querySelector('#io-text').value.length : 0, scrollW: document.documentElement.scrollWidth })));
    await page.screenshot({ path: `app/shot_${name}_settings.png`, fullPage: true });
    // 恢复默认
    const reset = await page.$('button[data-act=reset-all]'); if (reset) { await reset.click(); await page.waitForTimeout(400); await page.click(nav + ' button[data-view=home]'); await waitDone(page); console.log('after reset:', await page.evaluate(() => document.querySelector('#lv-pace').textContent + ' | ' + document.querySelector('#verdict .big').textContent.replace(/\s+/g, ' ') + ' | ' + document.querySelector('.kpi .v').textContent)); }
    console.log('errors end:', errors);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('TEST FAIL', e); process.exit(1); });
