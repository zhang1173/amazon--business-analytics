/* 推广计划表 · 计算核心（第二代）
 * 公式照用户 Excel《Y三件套内衣计划细节表-运营填写》《推广计划汇总表》《目标汇总表》；
 * 资金盘按亚马逊 DD+7 延迟交易 + 每 14 天结算（见方案稿第八节）。
 * 纯函数，浏览器里是 window.PlanModel，node 里 require。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 日期：一律用"天号"（1970-01-01 起的天数，UTC） ----------
  const DAY = 86400000;
  function dn(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / DAY); }
  function parts(n) { const t = new Date(n * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() }; }
  function pad2(x) { return String(x).padStart(2, '0'); }
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number' && isFinite(v)) return (v > 20000 && v < 80000) ? Math.round(v) - 25569 : null; // Excel 序列号
    const s = String(v).trim();
    let m = s.match(/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?/);
    if (m) return dn(+m[1], +m[2], +m[3]);
    if (/^\d{5}(\.\d+)?$/.test(s)) return Math.round(parseFloat(s)) - 25569;
    return null;
  }
  function fmtDate(n) { const p = parts(n); return p.y + '-' + pad2(p.m) + '-' + pad2(p.d); }
  function shortDate(n) { const p = parts(n); return p.m + '/' + p.d; }
  function monthKey(n) { const p = parts(n); return p.y + '-' + pad2(p.m); }
  function monthLabel(key) { const a = key.split('-'); return a[0] + '年' + (+a[1]) + '月'; }
  function nextMonthKey(key, k) { k = k == null ? 1 : k; let [y, m] = key.split('-').map(Number); m += k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + pad2(m); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addMonths(n, k) { const p = parts(n); let y = p.y, m = p.m + k; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return dn(y, m, Math.min(p.d, daysInMonth(y, m))); }
  function weekday1(n) { return parts(n).wd + 1; }                       // Excel WEEKDAY(,1)：周日=1
  function weekday2(n) { const w = parts(n).wd; return w === 0 ? 7 : w; } // Excel WEEKDAY(,2)：周一=1
  function weeknum1(n) { const p = parts(n); const jan1 = dn(p.y, 1, 1); return Math.floor((n - jan1 + parts(jan1).wd) / 7) + 1; } // Excel WEEKNUM(,1)
  function weekKey(n) { const ws = n - weekday1(n) + 1; return parts(ws).y + '-W' + pad2(weeknum1(ws)); } // 同用户汇总表 A 列
  function monthsBetween(a, b) { const out = []; let k = a; let guard = 0; while (k <= b && guard++ < 600) { out.push(k); k = nextMonthKey(k); } return out; }
  function xround(x, dp) { const f = Math.pow(10, dp); return Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9) / f; } // Excel ROUND
  function num(v, dflt) { const x = typeof v === 'number' ? v : parseFloat(v); return isFinite(x) ? x : dflt; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- 参数 ----------
  const PRESETS = {
    finance: { fba: 6.50, returnRate: 0.10, returnFee: 3, storage: 0.11, inbound: 0, carrier: 0, couponFeeRate: 0.025, costMode: 'batch' },
    sheet:   { fba: 6.04, returnRate: 0.08, returnFee: 0, storage: 0.09, inbound: 0, carrier: 0, couponFeeRate: 0.025, costMode: 'fixed' },
  };
  const PRESET_LABEL = { finance: '财务包口径', sheet: '原表格口径' };
  function defaultParams() {
    return Object.assign({
      preset: 'finance',
      commMin: 0.30,
      commTiers: [{ upTo: 15, rate: 0.05 }, { upTo: 20, rate: 0.10 }, { upTo: null, rate: 0.17 }],
      fixedGoods: 8.507462686567164,   // 原表格：57 元 / 6.7
      fixedFreight: 1.1237960199005,   // 原表格：混发头程加权
      fx: 6.8,
      cashStart: 600000, cashStartDate: '2026-11-01',
      fixedMonthly: 70000, fixedDay: 15,
      payDays: 25,                       // 日表"回款日期" = 下单 + 25 天（同 Excel）
      deliveryDays: 2, reserveDays: 7,   // 资金盘：送达 + 7 天释放（DD+7）
      settleMode: 'monthly', settleDays: [14, 28], settleAnchor: '2026-11-02',
      bankDays: 5, payoutMode: 'auto',   // auto = 每 14 天自动结算；dod = 按需提现
      horizonEnd: '',
    }, PRESETS.finance);
  }
  function applyPreset(P, key) { return Object.assign({}, P, PRESETS[key], { preset: key }); }

  function defaultBatches() {
    return [{ id: 'b1', name: 'SHIP-7d45bc55 首批', qty: 2600, shipDate: '2026-09-30', arriveDate: '2026-10-30', mode: '海运',
      goodsCny: 55.5, freightCny: 5, goodsTermMonths: 6, freightTermDays: 60 }];
  }
  function batchInfo(b, P) {
    const ship = parseDate(b.shipDate);
    const arrive = parseDate(b.arriveDate);
    const qty = Math.max(0, num(b.qty, 0));
    const goodsCny = num(b.goodsCny, 0), freightCny = num(b.freightCny, 0);
    const fixed = P.costMode === 'fixed';
    return Object.assign({}, b, {
      qty, ship, arrive: arrive == null ? ship : arrive,
      goodsUsd: fixed ? P.fixedGoods : goodsCny / P.fx,
      freightUsd: fixed ? P.fixedFreight : freightCny / P.fx,
      goodsDue: ship == null ? null : addMonths(ship, num(b.goodsTermMonths, 0)),
      freightDue: ship == null ? null : ship + num(b.freightTermDays, 0),
      goodsTotalCny: qty * goodsCny, freightTotalCny: qty * freightCny,
      isAir: /空/.test(b.mode || ''),
    });
  }

  // ---------- 每日表（照 Excel 公式） ----------
  function commOn(p, P) {
    let rate = P.commTiers[P.commTiers.length - 1].rate;
    for (const t of P.commTiers) { if (t.upTo == null || p <= t.upTo) { rate = t.rate; break; } }
    return Math.max(P.commMin, xround(p * rate, 2));
  }
  function unitEconomics(r, P) {
    const E = num(r.price, 0), F = num(r.prime, 0), G = num(r.coupon, 0);
    const H = num(r.couponUse, 0.8), I = num(r.primeUse, 0.9);
    const minPrice = E * (1 - G) * (1 - F);                       // J
    const avgPrice = E * (1 - G * H) * (1 - F * I);               // K
    const commission = E > 0 ? (commOn(E * (1 - G) * (1 - F), P) * H * I + commOn(E * (1 - G), P) * H * (1 - I)
      + commOn(E * (1 - F), P) * (1 - H) * I + commOn(E, P) * (1 - H) * (1 - I)) : 0;  // Z
    const returns = avgPrice * P.returnRate + P.returnRate * P.returnFee; // AG（原表格 = K × 8%）
    const couponFeeUnit = G === 0 ? 0 : E * (1 - G) * (1 - F * I) * H * P.couponFeeRate; // AH ÷ T
    const feesUnit = commission + P.fba + returns + P.inbound + P.carrier + P.storage;
    return { E, F, G, H, I, minPrice, avgPrice, commission, returns, couponFeeUnit, feesUnit };
  }

  function computeRows(rows, P, batches) {
    const B = batches.map(b => batchInfo(b, P)).filter(b => b.ship != null && b.qty > 0).sort((a, b) => a.arrive - b.arrive);
    const lots = B.map(b => ({ b, left: b.qty }));
    const list = rows.map((r, idx) => ({ r, idx, d: parseDate(r.date) })).filter(x => x.d != null).sort((a, b) => a.d - b.d || a.idx - b.idx);
    const out = [];
    for (const { r, idx, d } of list) {
      const ue = unitEconomics(r, P);
      const unitsPlan = Math.max(0, num(r.units, 0));
      let avail = 0; for (const L of lots) if (L.b.arrive <= d) avail += L.left;
      const T = Math.min(unitsPlan, avail);
      let need = T, gSum = 0, fSum = 0;
      for (const L of lots) {
        if (need <= 1e-12) break;
        if (L.b.arrive > d || L.left <= 0) continue;
        const take = Math.min(need, L.left); L.left -= take; need -= take;
        gSum += take * L.b.goodsUsd; fSum += take * L.b.freightUsd;
      }
      let goodsU, freightU;
      if (P.costMode === 'fixed') { goodsU = P.fixedGoods; freightU = P.fixedFreight; }
      else if (T > 0) { goodsU = gSum / T; freightU = fSum / T; }
      else { const nx = lots.find(L => L.left > 0) || lots[lots.length - 1]; goodsU = nx ? nx.b.goodsUsd : 0; freightU = nx ? nx.b.freightUsd : 0; }
      let stockLeft = 0; for (const L of lots) if (L.b.arrive <= d) stockLeft += L.left;
      const cvr = num(r.cvr, 0), cpc = num(r.cpc, 0);
      const cpa = cvr > 0 ? cpc / cvr : 0;                         // Q
      const adShare = Math.min(1, Math.max(0, num(r.adShare, 1)));  // V
      const adUnits = T * adShare;                                  // U
      const adSpend = cpa * adUnits;                                // M = Q × U
      const sales = T * ue.avgPrice;                                // AO
      const couponFee = ue.couponFeeUnit * T;                       // AH
      const activity = num(r.activity, 0);                          // AI
      const payback = sales - couponFee - activity - ue.feesUnit * T; // AK
      const net = payback - adSpend;                                // AL
      const cogs = T * (goodsU + freightU);
      const profit = net - cogs;                                    // AN
      const unitPayback = T > 0 ? payback / T : ue.avgPrice - ue.couponFeeUnit - ue.feesUnit; // L
      const payDate = d + num(P.payDays, 25);                       // AM
      out.push({
        idx, d, date: fmtDate(d), month: monthKey(d), week: weeknum1(d), weekday: weekday2(d),
        price: ue.E, prime: ue.F, coupon: ue.G, couponUse: ue.H, primeUse: ue.I,
        minPrice: ue.minPrice, avgPrice: ue.avgPrice, unitPayback,
        adSpend, cpc, ctr: num(r.ctr, 0), cvr, cpa,
        acos: adUnits * ue.avgPrice ? adSpend / (adUnits * ue.avgPrice) : null,
        tacos: T * ue.avgPrice ? adSpend / (T * ue.avgPrice) : null,
        units: T, unitsPlan, short: unitsPlan - T, adUnits, adShare, natural: T - adUnits, naturalShare: 1 - adShare,
        couponUnits: ue.G === 0 ? 0 : T * ue.H,
        commission: ue.commission, fba: P.fba, inbound: P.inbound, carrier: P.carrier, storage: P.storage,
        goodsU, freightU, returns: ue.returns, couponFee, activity,
        breakEvenCpa: unitPayback, payback, net, payDate, payMonth: monthKey(payDate), profit, sales, cogs,
        goodsTotal: T * goodsU, freightTotal: T * freightU,
        stockLeft, deliver: d + num(P.deliveryDays, 2), release: d + num(P.deliveryDays, 2) + num(P.reserveDays, 7),
      });
    }
    return out;
  }

  // ---------- 汇总 ----------
  function sumBy(rows, keyFn, fields) {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) { const o = { key: k, n: 0 }; fields.forEach(f => o[f] = 0); m.set(k, o); }
      const o = m.get(k); o.n++; fields.forEach(f => o[f] += r[f] || 0);
    }
    return m;
  }

  function settlementDates(P, from, to) {
    const out = [];
    if (P.settleMode === 'every14') {
      const a = parseDate(P.settleAnchor) || from;
      let s = a + Math.ceil((from - a) / 14) * 14;
      for (; s <= to; s += 14) out.push(s);
    } else {
      const days = (P.settleDays && P.settleDays.length ? P.settleDays : [14, 28]).map(Number).filter(x => x >= 1 && x <= 31).sort((a, b) => a - b);
      for (const mk of monthsBetween(monthKey(from), monthKey(to))) {
        const [y, m] = mk.split('-').map(Number);
        for (const dd of days) { const s = dn(y, m, Math.min(dd, daysInMonth(y, m))); if (s >= from && s <= to && out[out.length - 1] !== s) out.push(s); }
      }
    }
    return out;
  }

  // 资金盘（人民币，按天）
  function ledger(rows, P, batches) {
    const fx = num(P.fx, 6.8);
    const start = parseDate(P.cashStartDate) || (rows.length ? rows[0].d : dn(2026, 11, 1));
    const ev = []; // {d, kind, amt, note}
    if (P.payoutMode === 'dod') {
      for (const r of rows) {
        if (r.payback) ev.push({ d: r.release + num(P.bankDays, 5), kind: 'sales', amt: r.payback * fx, note: '按需提现到账' });
        if (r.adSpend) ev.push({ d: r.d, kind: 'ad', amt: -r.adSpend * fx, note: '广告' });
      }
    } else if (rows.length) {
      const first = Math.min(rows[0].d, start);
      const last = Math.max(...rows.map(r => Math.max(r.release, r.d)));
      const S = settlementDates(P, first - 31, last + 40);
      let prev = -Infinity;
      for (const s of S) {
        let gross = 0, ads = 0;
        for (const r of rows) { if (r.release > prev && r.release <= s) gross += r.payback; if (r.d > prev && r.d <= s) ads += r.adSpend; }
        if (gross || ads) {
          const pd = gross - ads >= 0 ? s + num(P.bankDays, 5) : s;
          if (gross) ev.push({ d: pd, kind: 'sales', amt: gross * fx, settle: s, note: fmtDate(s) + ' 结算' });
          if (ads) ev.push({ d: pd, kind: 'ad', amt: -ads * fx, settle: s, note: fmtDate(s) + (gross - ads >= 0 ? ' 结算扣广告' : ' 结算不够扣，信用卡付广告') });
        }
        prev = s;
      }
    }
    for (const b0 of batches) {
      const b = batchInfo(b0, P);
      if (b.ship == null || !b.qty) continue;
      if (b.goodsTotalCny) ev.push({ d: b.goodsDue, kind: 'goods', amt: -b.goodsTotalCny, note: (b.name || '批次') + ' 货款' });
      if (b.freightTotalCny) ev.push({ d: b.freightDue, kind: 'freight', amt: -b.freightTotalCny, note: (b.name || '批次') + ' 头程' });
    }
    let end = parseDate(P.horizonEnd);
    if (end == null) {
      let mx = start;
      for (const e of ev) if (e.d > mx) mx = e.d;
      for (const r of rows) if (r.d > mx) mx = r.d;
      const p = parts(mx); end = dn(p.y, p.m, daysInMonth(p.y, p.m));
    }
    for (const mk of monthsBetween(monthKey(start), monthKey(end))) {
      const [y, m] = mk.split('-').map(Number);
      const d = dn(y, m, Math.min(num(P.fixedDay, 15), daysInMonth(y, m)));
      if (d >= start && d <= end && P.fixedMonthly) ev.push({ d, kind: 'fixed', amt: -num(P.fixedMonthly, 0), note: '固定开支' });
    }
    const inWin = ev.filter(e => e.d >= start && e.d <= end).sort((a, b) => a.d - b.d);
    const byDay = new Map();
    for (const e of inWin) { if (!byDay.has(e.d)) byDay.set(e.d, []); byDay.get(e.d).push(e); }
    let bal = num(P.cashStart, 0);
    const daily = []; const months = new Map();
    let minBal = Infinity, minDate = start;
    const checks = [];
    for (let d = start; d <= end; d++) {
      const mk = monthKey(d);
      if (!months.has(mk)) months.set(mk, { month: mk, open: bal, sales: 0, ad: 0, fixed: 0, goods: 0, close: 0, min: Infinity, minDate: d });
      const M = months.get(mk);
      const es = byDay.get(d) || [];
      for (const e of es) {
        bal += e.amt;
        if (e.kind === 'sales') M.sales += e.amt; else if (e.kind === 'ad') M.ad += e.amt;
        else if (e.kind === 'fixed') M.fixed += e.amt; else M.goods += e.amt;
      }
      for (const e of es) if (e.kind === 'fixed' || e.kind === 'goods' || e.kind === 'freight') checks.push({ d, kind: e.kind, note: e.note, amt: e.amt, after: bal });
      daily.push({ d, bal });
      if (bal < M.min) { M.min = bal; M.minDate = d; }
      if (bal < minBal) { minBal = bal; minDate = d; }
      M.close = bal;
    }
    // 结算日 → 到账月份（净额）
    const arrivals = new Map();
    for (const e of inWin) if (e.kind === 'sales' || e.kind === 'ad') arrivals.set(monthKey(e.d), (arrivals.get(monthKey(e.d)) || 0) + e.amt);
    return { start, end, events: inWin, daily, months: [...months.values()], minBal, minDate, checks, arrivals };
  }

  function computePlan(planRows, P, batches) {
    const rows = computeRows(planRows || [], P, batches);
    const BI = batches.map(b => batchInfo(b, P)).filter(b => b.ship != null && b.qty > 0);
    const F = ['units', 'adSpend', 'net', 'profit', 'sales', 'goodsTotal', 'freightTotal', 'payback', 'adUnits', 'natural', 'couponFee', 'short'];
    const weeks = [...sumBy(rows, r => weekKey(r.d), F).values()];
    const byOrder = sumBy(rows, r => r.month, F);
    const byPay = sumBy(rows, r => r.payMonth, ['net', 'profit']);
    const fallback = monthKey(parseDate(P.cashStartDate) || dn(2026, 11, 1));
    const firstMonth = rows.length ? rows[0].month : fallback;
    let lastMonth = firstMonth;
    for (const r of rows) { if (r.month > lastMonth) lastMonth = r.month; if (r.payMonth > lastMonth) lastMonth = r.payMonth; }
    for (const b of BI) { const mk = monthKey(b.ship); if (mk > lastMonth) lastMonth = mk; }
    const months = monthsBetween(firstMonth, lastMonth);
    // 月份统计-运营视角
    let prevUnits = null;
    const monthly = months.map(mk => {
      const o = byOrder.get(mk) || {}; const p = byPay.get(mk) || {};
      const units = o.units || 0, sales = o.sales || 0, ad = o.adSpend || 0;
      const row = {
        month: mk, units, days: o.n || 0, dailyAvg: o.n ? units / o.n : null,
        goods: o.goodsTotal || 0, freight: o.freightTotal || 0, ad, tacos: sales ? ad / sales : null,
        netByOrder: o.net || 0, netByPay: p.net || 0, profit: o.profit || 0, profitByPay: p.profit || 0,
        margin: sales ? (o.profit || 0) / sales : null, sales,
        growth: prevUnits ? units / prevUnits - 1 : null,
      };
      prevUnits = units; return row;
    });
    const tot = { units: 0, days: 0, goods: 0, freight: 0, ad: 0, netByOrder: 0, netByPay: 0, profit: 0, profitByPay: 0, sales: 0 };
    monthly.forEach(m => Object.keys(tot).forEach(k => tot[k] += m[k] || 0));
    tot.dailyAvg = tot.days ? tot.units / tot.days : null; tot.tacos = tot.sales ? tot.ad / tot.sales : null; tot.margin = tot.sales ? tot.profit / tot.sales : null;
    // 纯现金流算法（美元，同用户汇总表）
    const shipBy = new Map(); let priorShip = null;
    for (const b of BI) {
      const mk = monthKey(b.ship);
      const rec = { qty: b.qty, air: b.isAir ? b.qty : 0, sea: b.isAir ? 0 : b.qty, freight: b.qty * b.freightUsd, cost: b.qty * (b.goodsUsd + b.freightUsd) };
      const tgt = mk < firstMonth ? (priorShip = priorShip || { qty: 0, air: 0, sea: 0, freight: 0, cost: 0 }) : (shipBy.get(mk) || (shipBy.set(mk, { qty: 0, air: 0, sea: 0, freight: 0, cost: 0 }), shipBy.get(mk)));
      Object.keys(rec).forEach(k => tgt[k] += rec[k]);
    }
    let cumPay = priorShip ? -priorShip.cost : 0, cumShip = 0, cumSettle = 0;
    const cash = months.map(mk => {
      const m = monthly.find(x => x.month === mk);
      const s = shipBy.get(mk) || { qty: 0, air: 0, sea: 0, freight: 0, cost: 0 };
      cumPay += m.netByPay; cumShip += s.cost; cumSettle += m.profitByPay;
      return { month: mk, units: m.units, dailyAvg: m.dailyAvg, goods: m.goods, shipQty: s.qty, air: s.air, sea: s.sea, shipFreight: s.freight, shipCost: s.cost,
        profit: m.profit, settleProfit: m.profitByPay, payback: m.netByPay, cum: cumPay - cumShip, cumSettle };
    });
    cash.forEach((c, i) => {
      const nxt = cash.slice(i + 1, i + 4);
      const need = nxt.reduce((a, x) => a + x.shipCost, 0);
      if (nxt.length < 3) { c.coverCash = { status: '数据不足', need }; c.coverProfit = { status: '数据不足', need }; }
      else {
        c.coverCash = { status: c.cum >= need ? '已覆盖' : '未覆盖', have: c.cum, need };
        c.coverProfit = { status: c.cumSettle >= need ? '已覆盖' : '未覆盖', have: c.cumSettle, need };
      }
    });
    const project = {
      units: tot.units, goods: tot.goods, freight: BI.reduce((a, b) => a + b.qty * b.freightUsd, 0),
      shipCost: BI.reduce((a, b) => a + b.qty * (b.goodsUsd + b.freightUsd), 0),
      shipQty: BI.reduce((a, b) => a + b.qty, 0), air: BI.reduce((a, b) => a + (b.isAir ? b.qty : 0), 0), sea: BI.reduce((a, b) => a + (b.isAir ? 0 : b.qty), 0),
    };
    const L = ledger(rows, P, batches);
    // 合计
    const T = { units: 0, unitsPlan: 0, adSpend: 0, adUnits: 0, natural: 0, couponFee: 0, payback: 0, net: 0, profit: 0, sales: 0, cogs: 0, short: 0, activity: 0 };
    rows.forEach(r => Object.keys(T).forEach(k => T[k] += r[k] || 0));
    T.acos = T.adUnits && T.sales ? T.adSpend / (T.adUnits * (T.sales / T.units)) : null;
    T.tacos = T.sales ? T.adSpend / T.sales : null;
    let soldOut = null; for (const r of rows) { if (r.stockLeft <= 1e-9 && r.units > 0 || r.short > 1e-9) { soldOut = r.d; break; } }
    const stockEnd = rows.length ? rows[rows.length - 1].stockLeft : BI.reduce((a, b) => a + b.qty, 0);
    return { rows, weeks, months, monthly, monthTotal: tot, cash, priorShip, project, ledger: L, totals: T, soldOut, stockEnd, firstMonth };
  }

  // 全年汇总表：列 = 月份（从第一个月起至少 13 个月）
  function annual(res, actuals) {
    const first = res.firstMonth;
    let last = nextMonthKey(first, 12);
    if (res.months.length && res.months[res.months.length - 1] > last) last = res.months[res.months.length - 1];
    const cols = monthsBetween(first, last).map(mk => {
      const m = res.monthly.find(x => x.month === mk) || { units: 0, sales: 0, dailyAvg: null, ad: 0, tacos: null, goods: 0, freight: 0, netByPay: 0, margin: null, profit: 0, growth: null };
      const c = res.cash.find(x => x.month === mk);
      const a = (actuals || {})[mk] || {};
      return { month: mk, plan: m, cover: c ? c.coverCash : null, coverProfit: c ? c.coverProfit : null, actual: a };
    });
    return cols;
  }

  // 方案对比：只算账，不排名
  function compareSummary(res, P, batches) {
    const fx = num(P.fx, 6.8);
    const L = res.ledger;
    const batchCostCny = batches.map(b => batchInfo(b, P)).reduce((a, b) => a + b.goodsTotalCny + b.freightTotalCny, 0);
    const arrivals = [];
    const mk0 = monthKey(L.start);
    for (let i = 0; i < 4; i++) { const mk = nextMonthKey(mk0, i); arrivals.push({ month: mk, amt: L.arrivals.get(mk) || 0 }); }
    const fixedShort = L.checks.filter(c => c.kind === 'fixed' && c.after < 0).map(c => ({ d: c.d, short: -c.after }));
    const dueShort = L.checks.filter(c => c.kind !== 'fixed' && c.after < 0).map(c => ({ d: c.d, note: c.note, short: -c.after }));
    const dues = L.checks.filter(c => c.kind !== 'fixed');
    const T = res.totals;
    return {
      days: res.rows.length, units: T.units, unitsPlan: T.unitsPlan, sales: T.sales, salesCny: T.sales * fx,
      ad: T.adSpend, adCny: T.adSpend * fx, tacos: T.tacos, net: T.net, netCny: T.net * fx, profit: T.profit, profitCny: T.profit * fx,
      batchCostCny, arrivals, soldOut: res.soldOut, stockEnd: res.stockEnd, short: T.short,
      minBal: L.minBal, minDate: L.minDate, fixedShort, fixedCount: L.checks.filter(c => c.kind === 'fixed').length, dueShort, dueCount: dues.length,
      endBal: L.daily.length ? L.daily[L.daily.length - 1].bal : num(P.cashStart, 0), end: L.end,
    };
  }

  // ---------- 出方案：按参数生成一张推广计划表 ----------
  function defaultGens() {
    const base = { start: '2026-11-07', price: 29.99, prime: 0, couponUse: 0.8, primeUse: 0.9, ctr: 0.01 };
    return [
      Object.assign({ id: 't1', name: '高开猛打', days: 45, coupon: 0.30, startUnits: 5, rate1: 2, rate1Days: 4, rate2: 1.5, rate2Days: 4, rate3: 1.2, capUnits: 300,
        cpcStart: 7, cpcEnd: 3.5, cvr: 0.12, adShareStart: 1, adShareEnd: 0.6, rampDays: 14 }, base),
      Object.assign({ id: 't2', name: '中速', days: 60, coupon: 0.30, startUnits: 3, rate1: 1.5, rate1Days: 6, rate2: 1.3, rate2Days: 8, rate3: 1.1, capUnits: 150,
        cpcStart: 6, cpcEnd: 3.5, cvr: 0.12, adShareStart: 1, adShareEnd: 0.5, rampDays: 21 }, base),
      Object.assign({ id: 't3', name: '低开慢推', days: 75, coupon: 0.20, startUnits: 2, rate1: 1.3, rate1Days: 10, rate2: 1.15, rate2Days: 10, rate3: 1.05, capUnits: 80,
        cpcStart: 5, cpcEnd: 2.5, cvr: 0.12, adShareStart: 0.8, adShareEnd: 0.3, rampDays: 30 }, base),
    ];
  }
  function generateRows(g) {
    const start = parseDate(g.start); if (start == null) return [];
    const days = Math.max(0, Math.min(400, Math.round(num(g.days, 0))));
    const rows = []; let u = Math.max(0, num(g.startUnits, 0));
    const r1d = num(g.rate1Days, 0), r2d = num(g.rate2Days, 0), cap = num(g.capUnits, Infinity), ramp = num(g.rampDays, 1);
    for (let i = 0; i < days; i++) {
      if (i > 0) { const rate = i <= r1d ? num(g.rate1, 1) : (i <= r1d + r2d ? num(g.rate2, 1) : num(g.rate3, 1)); u = Math.min(cap, u * rate); }
      const t = ramp > 1 ? Math.min(1, i / (ramp - 1)) : 1;
      rows.push({ date: fmtDate(start + i), price: num(g.price, 0), prime: num(g.prime, 0), coupon: num(g.coupon, 0), couponUse: num(g.couponUse, 0.8), primeUse: num(g.primeUse, 0.9),
        cpc: xround(lerp(num(g.cpcStart, 0), num(g.cpcEnd, 0), t), 2), ctr: num(g.ctr, 0.01), cvr: num(g.cvr, 0),
        units: Math.round(u), adShare: xround(lerp(num(g.adShareStart, 1), num(g.adShareEnd, 1), t), 2), activity: 0 });
    }
    return rows;
  }

  // ---------- 从 Excel 粘贴 ----------
  const HEAD = { '日期': 'date', '前台售价$': 'price', '前台售价': 'price', '售价': 'price', 'prime': 'prime', 'coupon': 'coupon', 'coupon使用率': 'couponUse',
    'prime折扣使用率': 'primeUse', 'prime使用率': 'primeUse', 'CPC': 'cpc', 'CTR': 'ctr', 'CVR': 'cvr', '总单量': 'units', '广告单占比': 'adShare', '活动费用': 'activity',
    '广告花费$': 'adSpend', '广告花费': 'adSpend' };
  const EXCEL_POS = { 0: 'date', 4: 'price', 5: 'prime', 6: 'coupon', 7: 'couponUse', 8: 'primeUse', 12: 'adSpend', 13: 'cpc', 14: 'ctr', 15: 'cvr', 19: 'units', 21: 'adShare', 34: 'activity' };
  const APP_POS = { 0: 'date', 1: 'price', 2: 'coupon', 3: 'cpc', 4: 'ctr', 5: 'cvr', 6: 'units', 7: 'adShare' };
  const PCT = new Set(['prime', 'coupon', 'couponUse', 'primeUse', 'ctr', 'cvr', 'adShare']);
  function parseCell(field, s) {
    if (field === 'date') return parseDate(/^\d{5}(\.\d+)?$/.test(s) ? parseFloat(s) : s);
    let t = String(s).replace(/[$¥,\s]/g, ''); if (t === '') return null;
    const isPct = /%$/.test(t); t = t.replace(/%$/, '');
    let x = parseFloat(t); if (!isFinite(x)) return null;
    if (isPct) x /= 100; else if (PCT.has(field) && x > 1) x /= 100;
    return x;
  }
  function parsePaste(text, yearHint) {
    const lines = String(text || '').split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lines.length) return { rows: [], skipped: 0 };
    let map = null, startAt = 0;
    const first = lines[0].split('\t').map(s => s.trim());
    if (first.some(c => c === '日期' || c === '总单量')) {
      map = {}; first.forEach((c, i) => { if (HEAD[c]) map[i] = HEAD[c]; }); startAt = 1;
    }
    const rows = []; let skipped = 0;
    for (let li = startAt; li < lines.length; li++) {
      const cells = lines[li].split('\t');
      const pos = map || (cells.length >= 20 ? EXCEL_POS : APP_POS);
      const o = {};
      for (const k in pos) { const i = +k; if (i < cells.length) { const v = parseCell(pos[k], cells[i].trim()); if (v != null) o[pos[k]] = v; } }
      if (o.date == null) { skipped++; continue; }
      const r = { date: fmtDate(o.date), price: num(o.price, 29.99), prime: num(o.prime, 0), coupon: num(o.coupon, 0), couponUse: num(o.couponUse, 0.8), primeUse: num(o.primeUse, 0.9),
        cpc: num(o.cpc, 0), ctr: num(o.ctr, 0.01), cvr: num(o.cvr, 0), units: num(o.units, 0), adShare: num(o.adShare, NaN), activity: num(o.activity, 0) };
      if (!isFinite(r.adShare)) {
        const cpa = r.cvr > 0 ? r.cpc / r.cvr : 0;
        r.adShare = (o.adSpend != null && cpa > 0 && r.units > 0) ? Math.min(1, o.adSpend / (cpa * r.units)) : 1;
      }
      rows.push(r);
    }
    return { rows, skipped };
  }

  // 用户 Excel 里 11/7 起 11 天的原始输入（对数用）
  function excelSampleRows() {
    const cpc = [7, 6.5, 6, 5.5, 5, 4.5, 4, 3, 3.8, 3.6, 3.4];
    const units = [3, 6, 10, 20, 40, 60, 80, 100, 150, 180, 200];
    const share = [1, 1, 0.9, 0.9, 0.8, 0.8, 0.7, 0.7, 0.6, 0.6, 0.6];
    const s = dn(2026, 11, 7);
    return cpc.map((c, i) => ({ date: fmtDate(s + i), price: 29.99, prime: 0, coupon: 0.3, couponUse: 0.8, primeUse: 0.9, cpc: c, ctr: 0.01, cvr: 0.12, units: units[i], adShare: share[i], activity: 0 }));
  }

  return {
    dn, parts, parseDate, fmtDate, shortDate, monthKey, monthLabel, nextMonthKey, addMonths, weekday1, weekday2, weeknum1, weekKey, monthsBetween, xround, num,
    PRESETS, PRESET_LABEL, defaultParams, applyPreset, defaultBatches, batchInfo,
    unitEconomics, computeRows, computePlan, ledger, settlementDates, annual, compareSummary,
    defaultGens, generateRows, parsePaste, excelSampleRows,
  };
});
