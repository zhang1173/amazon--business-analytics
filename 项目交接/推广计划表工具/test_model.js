// 对数：工具 vs 用户 Excel（原表格口径），再测资金盘规则与出方案
const M = require('./model.js');
const ref = require('./excel_ref.json');
let fails = 0, checks = 0;
function eq(name, a, b, tol) {
  checks++;
  tol = tol == null ? 1e-6 : tol;
  const ok = (a == null && b == null) || (typeof b === 'string' ? a === b : Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)));
  if (!ok) { fails++; console.log('FAIL', name, 'tool=', a, 'excel=', b); }
}
const P = M.applyPreset(M.defaultParams(), 'sheet');
const res = M.computePlan(M.excelSampleRows(), P, M.defaultBatches());
// 1. 每日 11 行 × 列
res.rows.forEach((r, i) => {
  const x = ref.rows[i];
  for (const k of Object.keys(x)) {
    if (k === 'payMonth') { eq(`row${i + 1}.${k}`, M.monthLabel(r.payMonth), x[k]); continue; }
    if (k === 'payDate') { eq(`row${i + 1}.${k}`, r.payDate === undefined ? null : M.fmtDate(r.payDate), x[k]); continue; }
    eq(`row${i + 1}.${k}`, r[k], x[k]);
  }
});
// 2. 周汇总
ref.week.forEach((w, i) => {
  const t = res.weeks[i];
  eq(`week${i}.key`, t.key, w.key);
  eq(`week${i}.units`, t.units, w.units); eq(`week${i}.ad`, t.adSpend, w.ad); eq(`week${i}.net`, t.net, w.net);
  eq(`week${i}.profit`, t.profit, w.profit); eq(`week${i}.sales`, t.sales, w.sales);
});
// 3. 月份统计
const m0 = res.monthly[0], m1 = res.monthly[1];
for (const k of Object.keys(ref.mon)) eq('month11.' + k, m0[k], ref.mon[k]);
eq('month12.netByPay', m1.netByPay, ref.mon2.netByPay); eq('month12.profitByPay', m1.profitByPay, ref.mon2.profitByPay);
// 4. 资金盘规则（方案稿第八节例子）：11/7 下单 → 11/9 送达、11/16 释放、11/28 结算、12/3 到账
const r0 = res.rows[0];
eq('deliver', M.fmtDate(r0.deliver), '2026-11-09'); eq('release', M.fmtDate(r0.release), '2026-11-16');
const S = M.settlementDates(P, M.dn(2026, 11, 1), M.dn(2026, 12, 31)).map(M.fmtDate);
eq('settle dates', S.join(','), '2026-11-14,2026-11-28,2026-12-14,2026-12-28');
const ev = res.ledger.events.filter(e => e.kind === 'sales');
// 原表 11 天广告大于回款：11/28 结算是负数 → 当天信用卡扣，不加到账天数
eq('negative settlement charged same day', M.fmtDate(ev[0].d), '2026-11-28');
// 广告很小时：11/28 结算为正 → +5 天 12/3 到账
const small = M.excelSampleRows().map(r => Object.assign({}, r, { cpc: 0.01 }));
const evS = M.computePlan(small, P, M.defaultBatches()).ledger.events.filter(e => e.kind === 'sales');
eq('positive settlement arrives +5', M.fmtDate(evS[0].d), '2026-12-03');
eq('first payout settle', M.fmtDate(ev[0].settle), '2026-11-28');
// 11/28 结算的是送达日 11/7–11/21 的订单 = 下单 11/5–11/19 → 这里 11/7–11/14 下单的 8 行 (释放 ≤ 11/28)
const gross1128 = res.rows.filter(r => r.release <= M.dn(2026, 11, 28)).reduce((a, r) => a + r.payback, 0);
eq('gross 11/28', ev[0].amt, gross1128 * P.fx, 1e-9);
// 按需提现口径
const P2 = Object.assign({}, P, { payoutMode: 'dod' });
const L2 = M.computePlan(M.excelSampleRows(), P2, M.defaultBatches()).ledger;
eq('dod first arrival', M.fmtDate(L2.events.find(e => e.kind === 'sales').d), '2026-11-21');
// 批次付款日
const bi = M.batchInfo(M.defaultBatches()[0], M.defaultParams());
eq('goods due', M.fmtDate(bi.goodsDue), '2027-03-30'); eq('freight due', M.fmtDate(bi.freightDue), '2026-11-29');
// 资金盘对账：期末 = 起点 + 全部事件
const L = res.ledger; const sumEv = L.events.reduce((a, e) => a + e.amt, 0);
eq('ledger closes', L.daily[L.daily.length - 1].bal, P.cashStart + sumEv, 1e-9);
eq('fixed count', L.checks.filter(c => c.kind === 'fixed').length, L.months.length);
// 5. 财务包口径：单价回款 ≈ $9.31，首批成本 60.5 元 / 6.8
const PF = M.defaultParams();
const rf = M.computePlan(M.excelSampleRows(), PF, M.defaultBatches());
eq('finance unitPayback', +rf.rows[0].unitPayback.toFixed(2), 9.31);
eq('finance unit cost', rf.rows[0].goodsU + rf.rows[0].freightU, 60.5 / 6.8);
// 6. 出方案：三套都能生成，高开会断货
const gens = M.defaultGens();
gens.forEach(g => { const rows = M.generateRows(g); eq(g.name + ' days', rows.length, g.days); });
const hi = M.computePlan(M.generateRows(gens[0]), PF, M.defaultBatches());
console.log('高开：卖完', hi.soldOut ? M.fmtDate(hi.soldOut) : '没卖完', '有效单量', hi.totals.units, '广告$', hi.totals.adSpend.toFixed(0), '最低现金', hi.ledger.minBal.toFixed(0), M.fmtDate(hi.ledger.minDate));
eq('high sells 2600', hi.totals.units, 2600);
// 7. 粘贴：Excel 整行（含表头）
const tsvHead = ['日期', '月份', '周数', '星期', '前台售价$', 'prime', 'coupon', 'coupon使用率', 'prime折扣使用率', '最低成交价', '平均成交价', '单价回款', '广告花费$', 'CPC', 'CTR', 'CVR', 'CPA', 'ACOS', 'TACOS', '总单量', '广告单', '广告单占比'].join('\t');
const tsv = tsvHead + '\n' + '2026/11/7\t2026年11月\t45\t6\t29.99\t\t30%\t80%\t90%\t20.99\t22.79\t10.54\t175\t7\t1%\t12%\t58.33\t256%\t256%\t3\t3\t100%';
const pp = M.parsePaste(tsv);
eq('paste rows', pp.rows.length, 1); eq('paste units', pp.rows[0].units, 3); eq('paste coupon', pp.rows[0].coupon, 0.3); eq('paste date', pp.rows[0].date, '2026-11-07');
const pp2 = M.parsePaste('2026-11-08\t29.99\t30%\t6.5\t1%\t12%\t6\t100%');
eq('paste app order', pp2.rows[0].cpc, 6.5);
console.log(`${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
