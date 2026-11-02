/* 推广计划表 · 网页（第二代）
 * 只负责显示和输入；所有计算都在 PlanModel（model.js）。
 * 状态存在这台电脑的浏览器里（localStorage），可导出/导入方案文件。 */
(function () {
  'use strict';
  const M = window.PlanModel;
  const app = document.getElementById('app');
  const KEY = 'promo-plan-v2';
  const MINUS = '−';

  // ---------- 状态 ----------
  function defaultUi() {
    return { tab: 'plan', planId: 'o1', showFees: false, panel: null, qg: null, addTo: '', pasteText: '', cmpOff: [], confirm: null, renaming: false };
  }
  function defaultState() {
    return {
      v: 2, params: M.defaultParams(), batches: M.defaultBatches(),
      plans: [{ id: 'o1', kind: 'ops', name: '运营方案（Excel 11/7 起 11 天）', rows: M.excelSampleRows() }],
      gens: M.defaultGens(), actuals: {}, ui: defaultUi(),
    };
  }
  // 旧版日期框打字时会写进 1901 年这类错日期，读进来时去掉
  function okRow(r) { const n = r && M.parseDate(r.date); if (n == null) return false; const y = M.parts(n).y; return y >= 2020 && y <= 2100; }
  function normalize(s) {
    const d = defaultState();
    if (!s || s.v !== 2) return d;
    return {
      v: 2,
      params: Object.assign(M.defaultParams(), s.params || {}),
      batches: Array.isArray(s.batches) ? s.batches : d.batches,
      plans: Array.isArray(s.plans) ? s.plans.filter(p => p && Array.isArray(p.rows)).map(p => Object.assign({ kind: 'ops' }, p, { rows: p.rows.filter(okRow) })) : d.plans,
      gens: Array.isArray(s.gens) ? s.gens : d.gens,
      actuals: s.actuals && typeof s.actuals === 'object' ? s.actuals : {},
      ui: Object.assign(defaultUi(), s.ui || {}, { panel: null, confirm: null, renaming: false }),
    };
  }
  let state;
  try { state = normalize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { state = defaultState(); }
  const TABS = [['plan', '推广计划表'], ['summary', '汇总'], ['cash', '资金盘'], ['annual', '全年表'], ['compare', '方案对比'], ['params', '参数']];
  const h0 = (location.hash || '').replace('#', '');
  if (TABS.some(t => t[0] === h0)) state.ui.tab = h0;

  let ver = 0;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 2, params: state.params, batches: state.batches, plans: state.plans, gens: state.gens, actuals: state.actuals, ui: { tab: state.ui.tab, planId: state.ui.planId, showFees: state.ui.showFees, cmpOff: state.ui.cmpOff } })); } catch (e) { /* 存不了就算了 */ }
  }
  function commit() { ver++; save(); scheduleRender(); }

  // 撤销（只留最近一步）
  let undoSnap = null;
  function snapshot() { undoSnap = JSON.stringify({ params: state.params, batches: state.batches, plans: state.plans, gens: state.gens, actuals: state.actuals, planId: state.ui.planId }); }
  function undo() {
    if (!undoSnap) return;
    const s = JSON.parse(undoSnap); undoSnap = null;
    Object.assign(state, { params: s.params, batches: s.batches, plans: s.plans, gens: s.gens, actuals: s.actuals });
    state.ui.planId = s.planId; hideToast(); commit();
  }

  // ---------- 方案 ----------
  const genCache = new Map();
  function genRows(g) {
    const k = JSON.stringify(g);
    if (!genCache.has(k)) { if (genCache.size > 50) genCache.clear(); genCache.set(k, M.generateRows(g)); }
    return genCache.get(k);
  }
  function allPlans() {
    return state.plans.map(p => ({ id: p.id, kind: 'ops', name: p.name, rows: p.rows, src: p }))
      .concat(state.gens.map(g => ({ id: 'g:' + g.id, kind: 'tool', name: g.name, rows: genRows(g), gen: g })));
  }
  function curPlan() {
    const ps = allPlans();
    return ps.find(p => p.id === state.ui.planId) || ps[0] || null;
  }
  const calcCache = new Map();
  function calc(plan, horizonEnd) {
    const k = ver + '|' + plan.id + '|' + (horizonEnd || '');
    if (calcCache.has(k)) return calcCache.get(k);
    if (calcCache.size > 40) calcCache.clear();
    const P = horizonEnd ? Object.assign({}, state.params, { horizonEnd }) : state.params;
    const res = M.computePlan(plan.rows, P, state.batches);
    res.cmp = M.compareSummary(res, P, state.batches);
    calcCache.set(k, res);
    return res;
  }

  // ---------- 格式 ----------
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ok = x => x != null && typeof x === 'number' && isFinite(x);
  function signed(x, dp, body) { const r = Math.round(Math.abs(x) * Math.pow(10, dp)); return (x < 0 && r > 0 ? MINUS : '') + body; }
  function usd(x, dp) { if (!ok(x)) return ''; dp = dp == null ? 2 : dp; return signed(x, dp, '$' + (dp ? nf2 : nf0).format(Math.abs(x))); }
  function cny(x) { if (!ok(x)) return ''; return signed(x, 0, '¥' + nf0.format(Math.abs(x))); }
  function int(x) { if (!ok(x)) return ''; return signed(x, 0, nf0.format(Math.abs(x))); }
  function n1(x) { if (!ok(x)) return ''; return signed(x, 1, nf1.format(Math.abs(x))); }
  function pct(x, dp) { if (!ok(x)) return ''; dp = dp == null ? 1 : dp; return signed(x, dp + 2, (Math.abs(x) * 100).toFixed(dp) + '%'); }
  function wan(x) { if (!ok(x)) return ''; const a = Math.abs(x) / 10000; return signed(x, 1, '¥' + (a >= 100 ? nf0.format(a) : nf1.format(a)) + '万'); }
  const WD = ['', '一', '二', '三', '四', '五', '六', '日'];
  function fmt(t, v) {
    switch (t) {
      case 'usd': return usd(v); case 'usd0': return usd(v, 0); case 'cny': return cny(v); case 'int': return int(v); case 'num1': return n1(v);
      case 'pct': return pct(v, 1); case 'pct2': return pct(v, 2); case 'date': return ok(v) ? M.fmtDate(v) : (v || '');
      case 'month': return v ? M.monthLabel(v) : ''; case 'wd': return v ? '周' + WD[v] : '';
      case 'cover': return v ? v.status : '';
      default: return v == null ? '' : String(v);
    }
  }
  function iv(x, dp) { if (!ok(x)) return ''; return String(+x.toFixed(dp == null ? 4 : dp)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function parseNum(s) { const t = String(s == null ? '' : s).replace(/[$¥,%\s]/g, ''); if (t === '') return null; const x = parseFloat(t); return isFinite(x) ? x : null; }
  function parseDateLoose(s, yearHint) {
    const str = String(s == null ? '' : s).trim(); if (!str) return null;
    let n = M.parseDate(str);
    if (n == null) {
      const m = str.match(/^(\d{1,2})\s*[-\/.月]\s*(\d{1,2})\s*日?$/);
      if (m) { const mo = +m[1], d = +m[2]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) n = M.dn(yearHint || 2026, mo, d); }
    }
    if (n == null) return null;
    const p = M.parts(n);
    return p.y >= 2020 && p.y <= 2100 ? M.fmtDate(n) : null;
  }
  let yearHint = 2026;
  function parseTyped(t, s) {
    if (t === 'text') return String(s);
    if (t === 'date') return parseDateLoose(s, yearHint);
    if (t === 'list') { const a = String(s).split(/[^\d]+/).map(Number).filter(x => x >= 1 && x <= 31); return a.length ? a : null; }
    const x = parseNum(s); if (x == null) return null;
    if (t === 'pct') return x / 100;
    if (t === 'int') return Math.round(x);
    return x;
  }

  // ---------- 下载（导出） ----------
  let DL; // undefined = 还在问；null = 这里不能下载；对象 = 能下载；'blob' = 单独打开的网页
  if (!window.claude || typeof window.claude.use !== 'function') DL = 'blob';
  else {
    try { window.claude.use('downloads').then(ns => { DL = ns || null; scheduleRender(); }, () => { DL = null; scheduleRender(); }); } catch (e) { DL = null; }
  }
  const canSave = () => DL === 'blob' || (DL && typeof DL === 'object');
  async function saveFile(filename, data, mime) {
    if (DL === 'blob') {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      return true;
    }
    if (!DL || typeof DL !== 'object') { toast('这里不能下载文件'); return false; }
    try { await DL.save({ filename, data }); toast('已保存 ' + filename); return true; }
    catch (e) {
      const c = e && e.code;
      if (c === 'declined') return false;
      if (c === 'rate_limited') toast('上一个保存窗口还没关，稍后再点');
      else { toast('这里不能下载文件'); if (c !== 'too_large') { DL = null; scheduleRender(); } }
      return false;
    }
  }

  // ---------- 渲染调度（按住鼠标时不重画，免得点不中按钮） ----------
  let timer = null, pending = false, pointerDown = false;
  function scheduleRender() {
    pending = true;
    if (pointerDown || timer) return;
    timer = setTimeout(render, 0);
  }
  // 只在按住按钮时暂缓（下拉框、日期框、选文件会吃掉松开的事件，不能等）；最多等 600ms
  let holdT = null;
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest && e.target.closest('button, a[data-act], .chip');
    if (!t) return;
    pointerDown = true; clearTimeout(holdT); holdT = setTimeout(release, 600);
  }, true);
  const release = () => { clearTimeout(holdT); pointerDown = false; if (pending && !timer) timer = setTimeout(render, 0); };
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);

  let pendingFocus = null;
  function captureFocus() {
    const a = document.activeElement;
    if (!a || !a.dataset || !a.dataset.fk) return null;
    let s = null; try { s = a.selectionStart; } catch (e) { /* 日期框没有 */ }
    return { fk: a.dataset.fk, s };
  }
  function restoreFocus(f) {
    if (pendingFocus) { f = { fk: pendingFocus, s: null, all: true }; pendingFocus = null; }
    if (!f) return;
    const el = app.querySelector('[data-fk="' + CSS.escape(f.fk) + '"]');
    if (!el) return;
    el.focus({ preventScroll: true });
    try { if (f.all && el.select) el.select(); else if (f.s != null && el.setSelectionRange) el.setSelectionRange(f.s, f.s); } catch (e) { /* 忽略 */ }
  }
  function captureScroll() { const o = {}; app.querySelectorAll('[data-sk]').forEach(el => { o[el.dataset.sk] = [el.scrollLeft, el.scrollTop]; }); return o; }
  function restoreScroll(o) { app.querySelectorAll('[data-sk]').forEach(el => { const v = o[el.dataset.sk]; if (v) { el.scrollLeft = v[0]; el.scrollTop = v[1]; } }); }

  function render() {
    timer = null; pending = false;
    const f = captureFocus(); const sc = captureScroll();
    const tab = state.ui.tab;
    let body = '';
    try {
      body = tab === 'plan' ? viewPlan() : tab === 'summary' ? viewSummary() : tab === 'cash' ? viewCash() : tab === 'annual' ? viewAnnual() : tab === 'compare' ? viewCompare() : viewParams();
    } catch (e) {
      console.error(e);
      body = '<div class="card"><div class="bd">这一页算的时候出错了：' + esc(e.message) + '。可以到「参数」→「恢复默认」。</div></div>';
    }
    app.innerHTML = viewHeader() + '<main class="wrap">' + body + '</main>';
    restoreScroll(sc); restoreFocus(f);
    wireChart();
  }

  // ---------- 头部 ----------
  function viewHeader() {
    const P = state.params;
    const qty = state.batches.reduce((a, b) => a + (+b.qty || 0), 0);
    const seg = ['finance', 'sheet'].map(k => '<button data-act="preset" data-k="' + k + '" class="' + (P.preset === k ? 'on' : '') + '" title="' + (k === 'finance' ? 'FBA $6.50、退货 10% + $3、仓储 $0.11，货值按发货批次' : 'FBA $6.04、退货 8%、仓储 $0.09，货值 $8.51 + 头程 $1.12（对数用）') + '">' + M.PRESET_LABEL[k] + '</button>').join('');
    return '<header class="top"><div class="wrap"><div class="bar">'
      + '<div class="brand"><h1>推广计划表</h1><small>Y背三件套 · 发货批次 ' + int(qty) + ' 套 · 汇率 ' + esc(P.fx) + ' · 现金 ' + cny(P.cashStart) + '</small></div>'
      + '<div class="seg" role="group" aria-label="费率口径">' + seg + '</div>'
      + (P.preset !== 'finance' && P.preset !== 'sheet' ? '<span class="tag">费率已手改</span>' : '')
      + (canSave() ? '<button class="btn" data-act="exportXlsx">导出 Excel</button>' : '')
      + '</div><nav class="tabs">' + TABS.map(t => '<button data-act="tab" data-k="' + t[0] + '" class="' + (state.ui.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>').join('') + '</nav></div></header>';
  }

  // ---------- 方案选择条 ----------
  function planSelect() {
    const ps = allPlans(); const cur = curPlan();
    const opt = p => '<option value="' + esc(p.id) + '"' + (cur && p.id === cur.id ? ' selected' : '') + '>' + esc(p.name || '（没起名）') + '</option>';
    const ops = ps.filter(p => p.kind === 'ops'), tools = ps.filter(p => p.kind === 'tool');
    return '<select class="sel" data-f="planSel" data-fk="planSel" aria-label="选方案">'
      + (ops.length ? '<optgroup label="运营的方案">' + ops.map(opt).join('') + '</optgroup>' : '')
      + (tools.length ? '<optgroup label="工具出的方案">' + tools.map(opt).join('') + '</optgroup>' : '') + '</select>';
  }
  function planBar(withTools) {
    const p = curPlan();
    if (!p) return '<div class="card"><div class="bd">还没有方案。<button class="btn pri" data-act="newPlan">新建运营方案</button></div></div>';
    let h = '<div class="planbar"><label>方案</label>' + planSelect()
      + (p.kind === 'ops' ? '<span class="tag">运营的</span>' : '<span class="tag tool">工具出的</span>');
    if (withTools) {
      if (p.kind === 'ops') {
        if (state.ui.renaming) h += '<input class="sel" style="min-width:0;flex:1 1 160px;max-width:320px" data-f="planName" data-fk="planName" value="' + esc(p.name) + '" aria-label="方案名"><button class="btn" data-act="renameDone">好</button>';
        else h += '<button class="btn ghost" data-act="rename">改名</button>';
        h += '<span class="sp"></span><button class="btn" data-act="dupPlan">复制成新方案</button><button class="btn" data-act="newPlan">新建空白方案</button><button class="btn danger" data-act="delPlan">删除这套</button>';
      } else {
        h += '<span class="sp"></span><button class="btn" data-act="copyTool">复制成运营方案</button><button class="btn" data-act="tab" data-k="compare">去改这套的参数</button>';
      }
    }
    return h + '</div>';
  }

  function kpis(res) {
    const T = res.totals, c = res.cmp, fx = state.params.fx;
    const stock = res.soldOut != null ? ('卖完 / 断货 ' + M.shortDate(res.soldOut)) : ('剩 ' + int(res.stockEnd) + ' 套');
    const k = (l, v, s) => '<div class="kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + (s || '') + '</div></div>';
    return '<div class="kpis">'
      + k('天数 · 单量', int(res.rows.length) + ' 天', '实卖 ' + int(T.units) + ' 单' + (T.short > 0.5 ? '（计划 ' + int(T.unitsPlan) + '）' : ''))
      + k('销售额', usd(T.sales, 0), cny(T.sales * fx))
      + k('广告花费', usd(T.adSpend, 0), 'TACOS ' + pct(T.tacos))
      + k('净回款（已扣广告）', usd(T.net, 0), cny(T.net * fx))
      + k('订单毛利', usd(T.profit, 0), cny(T.profit * fx))
      + k('库存', res.soldOut != null ? M.shortDate(res.soldOut) : int(res.stockEnd), stock)
      + k('账上最低现金', cny(c.minBal), M.fmtDate(c.minDate) + ' · 资金盘')
      + '</div>';
  }

  // ---------- 表一：推广计划表 ----------
  const COLS = [
    { k: 'date', l: '日期', inp: 'date', t: 'date' },
    { k: 'weekday', l: '星期', t: 'wd' },
    { k: 'price', l: '前台售价 $', inp: 'num', t: 'usd' },
    { k: 'prime', l: 'prime %', inp: 'pct', t: 'pct', fee: 1 },
    { k: 'coupon', l: 'coupon %', inp: 'pct', t: 'pct' },
    { k: 'couponUse', l: 'coupon 使用率 %', inp: 'pct', t: 'pct', fee: 1 },
    { k: 'primeUse', l: 'prime 使用率 %', inp: 'pct', t: 'pct', fee: 1 },
    { k: 'minPrice', l: '最低成交价', t: 'usd', fee: 1 },
    { k: 'avgPrice', l: '成交均价', t: 'usd' },
    { k: 'unitPayback', l: '单价回款', t: 'usd' },
    { k: 'adSpend', l: '广告花费 $', inp: 'num', t: 'usd' },
    { k: 'cpc', l: 'CPC $', inp: 'num', t: 'usd' },
    { k: 'ctr', l: 'CTR %', inp: 'pct', t: 'pct2' },
    { k: 'cvr', l: 'CVR %', inp: 'pct', t: 'pct' },
    { k: 'cpa', l: 'CPA', t: 'usd' },
    { k: 'acos', l: 'ACOS', t: 'pct' },
    { k: 'tacos', l: 'TACOS', t: 'pct' },
    { k: 'units', l: '总单量', inp: 'num', t: 'int' },
    { k: 'adUnits', l: '广告单', t: 'num1' },
    { k: 'adShare', l: '广告单占比 %', inp: 'pct', t: 'pct' },
    { k: 'natural', l: '自然单', t: 'num1' },
    { k: 'naturalShare', l: '自然单占比', t: 'pct', fee: 1 },
    { k: 'couponUnits', l: '用券单量', t: 'num1', fee: 1 },
    { k: 'commission', l: '佣金', t: 'usd', fee: 1 },
    { k: 'fba', l: 'FBA', t: 'usd', fee: 1 },
    { k: 'returns', l: '退货损失', t: 'usd', fee: 1 },
    { k: 'storage', l: '仓储', t: 'usd', fee: 1 },
    { k: 'couponFee', l: 'coupon 费', t: 'usd', fee: 1 },
    { k: 'activity', l: '活动费用 $', inp: 'num', t: 'usd', fee: 1 },
    { k: 'goodsU', l: '货值 / 件', t: 'usd', fee: 1 },
    { k: 'freightU', l: '头程 / 件', t: 'usd', fee: 1 },
    { k: 'breakEvenCpa', l: '不垫钱 CPA', t: 'usd', fee: 1 },
    { k: 'payback', l: '回款（未扣广告）', t: 'usd', fee: 1 },
    { k: 'net', l: '净回款（已扣广告）', t: 'usd' },
    { k: 'payDate', l: '回款日期', t: 'date' },
    { k: 'payMonth', l: '回款月份', t: 'month', fee: 1 },
    { k: 'profit', l: '订单毛利', t: 'usd' },
    { k: 'sales', l: '总销售额', t: 'usd' },
    { k: 'stockLeft', l: '库存剩余', t: 'stock' },
  ];
  const SUM_KEYS = new Set(['adSpend', 'units', 'adUnits', 'natural', 'couponUnits', 'couponFee', 'activity', 'payback', 'net', 'profit', 'sales']);
  function footVal(k, T, rows) {
    if (SUM_KEYS.has(k)) return k === 'units' ? T.units : T[k] != null ? T[k] : rows.reduce((a, r) => a + (r[k] || 0), 0);
    const units = T.units;
    if (k === 'avgPrice') return units ? T.sales / units : null;
    if (k === 'unitPayback') return units ? T.payback / units : null;
    if (k === 'cpa') return T.adUnits ? T.adSpend / T.adUnits : null;
    if (k === 'acos') return T.acos; if (k === 'tacos') return T.tacos;
    if (k === 'adShare') return units ? T.adUnits / units : null;
    if (k === 'naturalShare') return units ? T.natural / units : null;
    return null;
  }

  function viewPlan() {
    const p = curPlan();
    if (!p) return planBar(true);
    const res = calc(p);
    const editable = p.kind === 'ops';
    const showFees = state.ui.showFees;
    const cols = COLS.filter(c => showFees || !c.fee);
    const byIdx = new Map(res.rows.map(r => [r.idx, r]));
    let h = '<div class="card"><div class="bd">' + planBar(true) + '</div></div>';
    if (!editable) h += '<div class="banner">这是工具按「方案对比 → 出方案」的参数自动生成的（' + esc(p.name) + '），这里只能看。想在它基础上改，点「复制成运营方案」；改它的参数去「方案对比」。改工具出的方案不影响运营的表。</div>';
    h += kpis(res);
    // 工具条
    let bar = '';
    if (editable) {
      bar += '<button class="btn" data-act="addDay" title="复制最后一行，日期加一天">加一天（复制上一行）</button>'
        + '<span class="row" style="gap:4px"><input type="text" inputmode="numeric" class="sel dt" placeholder="加到哪天，如 11-30" autocomplete="off" data-f="addTo" data-fk="addTo" value="' + esc(state.ui.addTo || '') + '" aria-label="加到哪天"><button class="btn" data-act="addTo">加到这天</button></span>'
        + '<button class="btn' + (state.ui.panel === 'gen' ? ' pri' : '') + '" data-act="panel" data-k="gen">快速生成（递增率）</button>'
        + '<button class="btn' + (state.ui.panel === 'paste' ? ' pri' : '') + '" data-act="panel" data-k="paste">从 Excel 粘贴</button>';
    }
    bar += '<span class="sp"></span><label class="chip"><input type="checkbox" data-act="toggleFees"' + (showFees ? ' checked' : '') + '> 显示费用明细</label>';
    h += '<div class="card"><div class="hd"><h2>推广计划表</h2><span class="sub">' + (editable ? '黄色格子是运营填的，其余自动算；回车跳到下一行' : '只读') + ' · 美元</span><span class="sp"></span><div class="row">' + bar + '</div></div>';
    if (editable && state.ui.panel === 'gen') h += '<div class="bd">' + viewQuickGen(p) + '</div>';
    if (editable && state.ui.panel === 'paste') h += '<div class="bd">' + viewPaste() + '</div>';
    if (!p.rows.length) {
      h += '<div class="bd"><p class="note">这套还没有数。可以「加一天」一行行填，用「快速生成（递增率）」一键铺开，或者从你的 Excel 整块粘进来。</p></div></div>';
      return h;
    }
    // 表格
    let th = '<tr>' + cols.map(c => '<th class="' + (c.k === 'date' ? 'stk l' : '') + '">' + c.l + '</th>').join('') + (editable ? '<th></th>' : '') + '</tr>';
    const order = p.rows.map((r, i) => ({ r, i, d: M.parseDate(r.date) })).sort((a, b) => (a.d == null ? 1e9 : a.d) - (b.d == null ? 1e9 : b.d) || a.i - b.i);
    let tb = '';
    for (const { r: raw, i } of order) {
      const r = byIdx.get(i) || {};
      tb += '<tr>';
      for (const c of cols) {
        const stk = c.k === 'date' ? ' stk' : '';
        if (c.k === 'stockLeft') {
          if (r.short > 1e-9) tb += '<td class="short" title="库存不够，计划 ' + int(r.unitsPlan) + ' 单只卖出 ' + int(r.units) + ' 单，少卖的不算回款">断货 · 少卖 ' + int(r.short) + '</td>';
          else if (r.units > 0 && r.stockLeft <= 1e-9) tb += '<td class="short">0 · 卖完</td>';
          else tb += '<td>' + int(r.stockLeft) + '</td>';
          continue;
        }
        if (editable && c.inp) {
          let val;
          if (c.inp === 'date') val = raw.date || '';
          else if (c.k === 'adSpend') val = iv(r.adSpend, 2);
          else if (c.inp === 'pct') val = iv(raw[c.k] * 100, 2);
          else val = iv(raw[c.k], c.k === 'units' ? 2 : 4);
          const ttl = c.k === 'adSpend' ? ' title="改广告花费会倒推广告单占比（= 广告花费 ÷ CPA ÷ 总单量），和 Excel 一样"' : (c.k === 'units' && r.short > 1e-9 ? ' title="计划 ' + int(r.unitsPlan) + '，库存只够 ' + int(r.units) + '"' : '');
          tb += '<td class="in' + stk + '"' + ttl + '><input ' + (c.inp === 'date' ? 'type="text" inputmode="numeric" class="dt" placeholder="2026-11-07" autocomplete="off"' : 'type="text" inputmode="decimal"') + ' data-f="row" data-i="' + i + '" data-k="' + c.k + '" data-fk="r' + i + '.' + c.k + '" value="' + esc(val) + '" aria-label="' + esc(c.l) + '"></td>';
        } else {
          let v = r[c.k];
          if (c.k === 'units') v = r.units;
          tb += '<td class="' + (c.k === 'date' ? 'l' : '') + stk + (c.k === 'weekday' ? ' mut' : '') + '">' + esc(fmt(c.t, v)) + '</td>';
        }
      }
      if (editable) tb += '<td><button class="x" data-act="delRow" data-i="' + i + '" title="删掉这一天" aria-label="删掉这一天">×</button></td>';
      tb += '</tr>';
    }
    const T = res.totals;
    let tf = '<tr>' + cols.map(c => {
      if (c.k === 'date') return '<td class="stk l">合计 ' + res.rows.length + ' 天</td>';
      const v = footVal(c.k, T, res.rows);
      return '<td>' + (v == null ? '' : esc(fmt(c.t === 'int' ? 'int' : c.t, v))) + '</td>';
    }).join('') + (editable ? '<td></td>' : '') + '</tr>';
    h += '<div class="tw tall" data-sk="plan"><table class="t"><thead>' + th + '</thead><tbody>' + tb + '</tbody><tfoot>' + tf + '</tfoot></table></div>';
    h += '<div class="bd"><p class="note">单价回款 = 成交均价 − 佣金 − FBA − 退货损失 − coupon 费 − 仓储（费用明细里能看每一项）。广告花费 = CPA × 广告单（CPA = CPC ÷ CVR），和你的 Excel 一样；直接改广告花费会倒推广告单占比。回款日期 = 下单 + ' + esc(state.params.payDays) + ' 天。订单毛利 = 净回款 − 单量 × 这批货的货值 + 头程。库存按「参数」里的发货批次表扣，卖完以后的单不算回款。CTR 只作参考，不参与计算。</p></div>';
    return h + '</div>';
  }

  // 快速生成（递增率）
  const GEN_FIELDS = [
    { k: 'start', l: '第一天', t: 'date' }, { k: 'days', l: '天数', t: 'int' },
    { k: 'price', l: '前台售价 $', t: 'num' }, { k: 'coupon', l: 'coupon %', t: 'pct' },
    { k: 'startUnits', l: '第 1 天单量', t: 'num' }, { k: 'capUnits', l: '封顶单量 / 天', t: 'num' },
    { k: 'rate1', l: '前段每天 ×', t: 'num' }, { k: 'rate1Days', l: '前段天数', t: 'int' },
    { k: 'rate2', l: '中段每天 ×', t: 'num' }, { k: 'rate2Days', l: '中段天数', t: 'int' },
    { k: 'rate3', l: '之后每天 ×', t: 'num' }, { k: 'cvr', l: 'CVR %', t: 'pct' },
    { k: 'cpcStart', l: 'CPC 起 $', t: 'num' }, { k: 'cpcEnd', l: 'CPC 终 $', t: 'num' },
    { k: 'adShareStart', l: '广告单占比 起 %', t: 'pct' }, { k: 'adShareEnd', l: '广告单占比 终 %', t: 'pct' },
    { k: 'rampDays', l: '几天降到终值', t: 'int' }, { k: 'ctr', l: 'CTR %', t: 'pct' },
  ];
  function genInputs(g, scope, idx) {
    return '<div class="grid">' + GEN_FIELDS.map(f => {
      const v = f.t === 'date' ? (g[f.k] || '') : f.t === 'pct' ? iv(g[f.k] * 100, 2) : iv(g[f.k], 4);
      return '<label class="f"><span>' + f.l + '</span><input class="y" ' + (f.t === 'date' ? 'type="text" inputmode="numeric" placeholder="2026-11-07" autocomplete="off"' : 'type="text" inputmode="decimal"') + ' data-f="' + scope + '" data-i="' + (idx == null ? '' : idx) + '" data-k="' + f.k + '" data-t="' + f.t + '" data-fk="' + scope + (idx == null ? '' : idx) + '.' + f.k + '" value="' + esc(v) + '"></label>';
    }).join('') + '</div>';
  }
  function genHint(g) {
    const rows = genRows(g);
    const units = rows.reduce((a, r) => a + r.units, 0);
    const cvr = +g.cvr || 0; const ad1 = cvr > 0 ? (+g.cpcStart || 0) / cvr * (+g.startUnits || 0) * (g.adShareStart == null ? 1 : +g.adShareStart) : 0;
    const last = rows.length ? rows[rows.length - 1] : null;
    return '共 ' + rows.length + ' 天、计划 ' + int(units) + ' 单；第 1 天广告约 ' + usd(ad1, 0) + (last ? '，最后一天 ' + int(last.units) + ' 单' : '');
  }
  function viewQuickGen(p) {
    if (!state.ui.qg) {
      const base = Object.assign({}, M.defaultGens()[1]);
      delete base.id; delete base.name;
      const last = p.rows.length ? Math.max(...p.rows.map(r => M.parseDate(r.date) || 0)) : null;
      base.start = last ? M.fmtDate(last + 1) : '2026-11-07';
      if (p.rows.length) { const lr = p.rows[p.rows.length - 1]; base.price = lr.price; base.coupon = lr.coupon; }
      state.ui.qg = base;
    }
    const g = state.ui.qg;
    return '<div class="panel"><div class="row"><b>快速生成（递增率）</b><span class="note">单量从第 1 天起每天乘倍率，到封顶为止；CPC、广告单占比在设定天数里从起值匀速变到终值。生成后每一格还能手改。</span></div>'
      + genInputs(g, 'qg', null)
      + '<div class="row"><span class="note">' + esc(genHint(g)) + '</span><span class="sp"></span>'
      + '<button class="btn" data-act="qgApply" data-k="append">接在后面</button><button class="btn pri" data-act="qgApply" data-k="replace">替换整张表</button><button class="btn ghost" data-act="panel" data-k="">收起</button></div></div>';
  }
  function viewPaste() {
    return '<div class="panel"><div class="row"><b>从 Excel 粘贴</b><span class="note">在你的《计划细节表》里选中按日那几行（从「日期」列开始整行选，带不带表头都行），复制，粘到下面。认得的列：日期、前台售价、prime、coupon、coupon 使用率、prime 使用率、广告花费、CPC、CTR、CVR、总单量、广告单占比、活动费用。</span></div>'
      + '<textarea class="paste" data-f="paste" data-fk="paste" placeholder="在这里粘贴（Ctrl+V / ⌘V）">' + esc(state.ui.pasteText || '') + '</textarea>'
      + '<div class="row"><span class="note" id="pasteInfo">' + esc(pasteInfo()) + '</span><span class="sp"></span><button class="btn" data-act="pasteApply" data-k="append">接在后面</button><button class="btn pri" data-act="pasteApply" data-k="replace">替换整张表</button><button class="btn ghost" data-act="panel" data-k="">收起</button></div></div>';
  }
  function pasteInfo() {
    const t = state.ui.pasteText || ''; if (!t.trim()) return '';
    const r = M.parsePaste(t);
    return '认出 ' + r.rows.length + ' 天' + (r.rows.length ? '（' + r.rows[0].date + ' 到 ' + r.rows[r.rows.length - 1].date + '）' : '') + (r.skipped ? '，跳过 ' + r.skipped + ' 行没有日期的' : '');
  }

  // ---------- 汇总 ----------
  const WEEK_COLS = [{ l: '周', k: 'key', t: 'text' }, { l: '单量', k: 'units', t: 'int' }, { l: '广告花费 $', k: 'adSpend', t: 'usd' }, { l: '回款（已扣广告）$', k: 'net', t: 'usd' }, { l: '利润 $', k: 'profit', t: 'usd' }, { l: '销售额 $', k: 'sales', t: 'usd' }];
  const MONTH_COLS = [
    { l: '推广月份', k: 'month', t: 'month' }, { l: '单量', k: 'units', t: 'int' }, { l: '日均单量', k: 'dailyAvg', t: 'num1' }, { l: '货值 $', k: 'goods', t: 'usd' }, { l: '头程 $', k: 'freight', t: 'usd' },
    { l: '广告花费 $', k: 'ad', t: 'usd' }, { l: '广告占比', k: 'tacos', t: 'pct' }, { l: '订单平台预估可回款 $', k: 'netByOrder', t: 'usd' }, { l: '预估该月周期回款 $', k: 'netByPay', t: 'usd' },
    { l: '利润 $', k: 'profit', t: 'usd' }, { l: '结算毛利 $', k: 'profitByPay', t: 'usd' }, { l: '毛利率（含广告）', k: 'margin', t: 'pct' }, { l: '销售额 $', k: 'sales', t: 'usd' }, { l: '销量增幅', k: 'growth', t: 'pct' }];
  const CASH_COLS = [
    { l: '月份', k: 'month', t: 'month' }, { l: '单量', k: 'units', t: 'int' }, { l: '日均单量', k: 'dailyAvg', t: 'num1' }, { l: '货值 $', k: 'goods', t: 'usd' },
    { l: '当月发货数量', k: 'shipQty', t: 'int' }, { l: '空运', k: 'air', t: 'int' }, { l: '海运', k: 'sea', t: 'int' }, { l: '当月发货货值 + 头程 $', k: 'shipCost', t: 'usd' },
    { l: '当月利润 $', k: 'profit', t: 'usd' }, { l: '当月结算利润 $（晚一月）', k: 'settleProfit', t: 'usd' }, { l: '当月预计回款 $', k: 'payback', t: 'usd' },
    { l: '回款流覆盖未来三个月货值头程', k: 'coverCash', t: 'cover' }, { l: '现金流利润覆盖未来三个月货值头程', k: 'coverProfit', t: 'cover' },
    { l: '预估利润现金流累计 $', k: 'cum', t: 'usd' }, { l: '结算利润累计 $', k: 'cumSettle', t: 'usd' }];
  function simpleTable(cols, rows, foot, sk, extra) {
    const th = '<tr>' + cols.map((c, j) => '<th class="' + (j === 0 ? 'stk l' : '') + '">' + c.l + '</th>').join('') + '</tr>';
    const td = (c, r, j) => {
      const v = r[c.k];
      const ttl = c.t === 'cover' && v && v.need != null ? ' title="' + (v.have != null ? '有 ' + esc(usd(v.have, 0)) + '，' : '') + '未来三个月要 ' + esc(usd(v.need, 0)) + '"' : '';
      return '<td class="' + (j === 0 ? 'stk l' : '') + '"' + ttl + '>' + esc(fmt(c.t, v)) + '</td>';
    };
    const tb = rows.map(r => '<tr' + (r._cls ? ' class="' + r._cls + '"' : '') + '>' + cols.map((c, j) => td(c, r, j)).join('') + '</tr>').join('');
    const tf = foot && foot.length ? foot.map(r => '<tr>' + cols.map((c, j) => td(c, r, j)).join('') + '</tr>').join('') : '';
    return '<div class="tw" data-sk="' + sk + '"><table class="t' + (extra ? ' ' + extra : '') + '"><thead>' + th + '</thead><tbody>' + tb + '</tbody>' + (tf ? '<tfoot>' + tf + '</tfoot>' : '') + '</table></div>';
  }
  function weekRows(res) { return res.weeks.map(w => ({ key: w.key, units: w.units, adSpend: w.adSpend, net: w.net, profit: w.profit, sales: w.sales })); }
  function weekFoot(res) { const T = res.totals; return [{ key: '合计', units: T.units, adSpend: T.adSpend, net: T.net, profit: T.profit, sales: T.sales }]; }
  function monthFoot(res) {
    const t = res.monthTotal, fx = state.params.fx;
    return [Object.assign({ month: '' }, t, { growth: null, _label: '合计' }), { _label: '折人民币（×' + fx + '）', netByOrder: t.netByOrder * fx, netByPay: t.netByPay * fx, profit: t.profit * fx, profitByPay: t.profitByPay * fx, sales: t.sales * fx, _cny: true }];
  }
  function monthTable(res) {
    const foot = monthFoot(res);
    const cols = MONTH_COLS;
    const th = '<tr>' + cols.map((c, j) => '<th class="' + (j === 0 ? 'stk l' : '') + '">' + c.l + '</th>').join('') + '</tr>';
    const tb = res.monthly.map(r => '<tr>' + cols.map((c, j) => '<td class="' + (j === 0 ? 'stk l' : '') + '">' + esc(fmt(c.t, r[c.k])) + '</td>').join('') + '</tr>').join('');
    const tf = foot.map(r => '<tr>' + cols.map((c, j) => {
      if (j === 0) return '<td class="stk l">' + esc(r._label) + '</td>';
      const v = r[c.k];
      return '<td>' + (v == null ? '' : esc(r._cny ? cny(v) : fmt(c.t, v))) + '</td>';
    }).join('') + '</tr>').join('');
    return '<div class="tw" data-sk="month"><table class="t"><thead>' + th + '</thead><tbody>' + tb + '</tbody><tfoot>' + tf + '</tfoot></table></div>';
  }
  function cashRows(res) {
    const rows = [];
    if (res.priorShip) rows.push({ month: '', _first: '之前发货（期初）', shipQty: res.priorShip.qty, air: res.priorShip.air, sea: res.priorShip.sea, shipCost: res.priorShip.cost, cum: -res.priorShip.cost, _cls: 'sub' });
    return rows.concat(res.cash);
  }
  function cashTable(res) {
    const rows = cashRows(res);
    const cols = CASH_COLS;
    const th = '<tr>' + cols.map((c, j) => '<th class="' + (j === 0 ? 'stk l' : '') + '">' + c.l + '</th>').join('') + '</tr>';
    const tb = rows.map(r => '<tr' + (r._cls ? ' class="' + r._cls + '"' : '') + '>' + cols.map((c, j) => {
      if (j === 0) return '<td class="stk l">' + esc(r._first || fmt('month', r.month)) + '</td>';
      const v = r[c.k];
      const ttl = c.t === 'cover' && v && v.need != null ? ' title="' + (v.have != null ? '有 ' + esc(usd(v.have, 0)) + '，' : '') + '未来三个月要 ' + esc(usd(v.need, 0)) + '"' : '';
      return '<td' + ttl + '>' + esc(fmt(c.t, v)) + '</td>';
    }).join('') + '</tr>').join('');
    const pj = res.project;
    return '<div class="tw" data-sk="cashflow"><table class="t"><thead>' + th + '</thead><tbody>' + tb + '</tbody></table></div>'
      + '<div class="bd"><p class="note"><b>项目汇总</b>：销售量 ' + int(pj.units) + ' · 总货值 ' + usd(pj.goods, 0) + '（已卖出部分）· 发货数量 ' + int(pj.shipQty) + '（空运 ' + int(pj.air) + ' / 海运 ' + int(pj.sea) + '）· 发货货值 + 头程 ' + usd(pj.shipCost, 0) + '（头程 ' + usd(pj.freight, 0) + '）。'
      + '货值头程按发货批次记在发货当月（这个月「欠下」的钱）；预估利润现金流累计 = 历月预计回款 − 历月发货货值头程，第一行是之前发出的批次。覆盖 = 到这个月为止累计的钱够不够未来三个月要发的货值头程；后面不满三个月显示「数据不足」，和你的 Excel 一样。把鼠标放在覆盖那格上能看到有多少、要多少。</p></div>';
  }
  function viewSummary() {
    const p = curPlan(); if (!p) return planBar(false);
    const res = calc(p);
    let h = '<div class="card"><div class="bd">' + planBar(false) + '</div></div>';
    h += '<div class="card"><div class="hd"><h2>周汇总</h2><span class="sub">按日表求和 · 美元</span></div>' + simpleTable(WEEK_COLS, weekRows(res), weekFoot(res), 'week') + '</div>';
    h += '<div class="card"><div class="hd"><h2>月份统计 · 运营视角</h2><span class="sub">美元；预估该月周期回款、结算毛利按回款日期归到到账月份（下单 + ' + esc(state.params.payDays) + ' 天）</span></div>' + monthTable(res) + '</div>';
    h += '<div class="card"><div class="hd"><h2>纯现金流</h2><span class="sub">美元 · 货值头程按发货批次</span></div>' + cashTable(res) + '</div>';
    return h;
  }

  // ---------- 资金盘 ----------
  const KIND = { sales: '回款到账', ad: '广告', fixed: '固定开支', goods: '货款到期', freight: '头程到期' };
  let chartData = null;
  function chartWidth() { const m = app.querySelector('main'); const w = m ? m.clientWidth : window.innerWidth; return Math.max(300, Math.min(1200, w - 60)); }
  function niceStep(span) { const raw = span / 4 || 1; const p = Math.pow(10, Math.floor(Math.log10(raw))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function cashChart(L) {
    const daily = L.daily; if (!daily.length) { chartData = null; return ''; }
    const W = chartWidth(), H = 250, ml = 62, mr = 14, mt = 18, mb = 26;
    const d0 = daily[0].d, d1 = daily[daily.length - 1].d;
    let lo = Math.min(0, ...daily.map(p => p.bal)), hi = Math.max(0, ...daily.map(p => p.bal));
    const step = niceStep(hi - lo); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi === lo) hi = lo + step;
    const x = d => ml + (d - d0) / Math.max(1, d1 - d0) * (W - ml - mr);
    const y = v => mt + (hi - v) / (hi - lo) * (H - mt - mb);
    let g = '';
    for (let v = lo; v <= hi + 1e-6; v += step) g += '<line class="gl" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="ax" x="' + (ml - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(wan(v)) + '</text>';
    let mk = M.monthKey(d0); const lastMk = M.monthKey(d1); let guard = 0;
    while (mk <= lastMk && guard++ < 60) {
      const [yy, mm] = mk.split('-').map(Number); const d = M.dn(yy, mm, 1);
      if (d >= d0) g += '<line class="tk" x1="' + x(d).toFixed(1) + '" x2="' + x(d).toFixed(1) + '" y1="' + (H - mb) + '" y2="' + (H - mb + 4) + '"/><text class="ax" x="' + (x(d) + 3).toFixed(1) + '" y="' + (H - 8) + '">' + (mm === 1 && W >= 640 ? yy + '年' : '') + mm + '月</text>';
      mk = M.nextMonthKey(mk);
    }
    if (lo < 0) g += '<line class="zl" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>';
    let path = 'M' + x(daily[0].d).toFixed(1) + ',' + y(daily[0].bal).toFixed(1);
    for (let i = 1; i < daily.length; i++) path += 'H' + x(daily[i].d).toFixed(1) + 'V' + y(daily[i].bal).toFixed(1);
    const mx = x(L.minDate), my = y(L.minBal);
    const lbl = '最低 ' + cny(L.minBal) + ' · ' + M.shortDate(L.minDate);
    const anchor = mx > W * 0.7 ? 'end' : mx < W * 0.3 ? 'start' : 'middle';
    const ly = my + (my > H - mb - 24 ? -10 : 18);
    chartData = { daily, d0, d1, ml, mr, W, H, mt, mb, x, y };
    return '<div class="chart" id="cashChart"><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="账上现金每天的余额">' + g
      + '<path class="ln" d="' + path + '"/><circle class="mn" cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="4.5"/>'
      + '<text class="lb" x="' + mx.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="' + anchor + '">' + esc(lbl) + '</text>'
      + '<line class="cx" id="cx" x1="0" x2="0" y1="' + mt + '" y2="' + (H - mb) + '" style="display:none"/><circle class="cd" id="cd" r="4" cx="0" cy="0" style="display:none"/>'
      + '<rect class="hit" x="' + ml + '" y="0" width="' + (W - ml - mr) + '" height="' + H + '"/></svg><div class="tip" id="tip" hidden></div></div>';
  }
  function wireChart() {
    const box = document.getElementById('cashChart'); if (!box || !chartData) return;
    const svg = box.querySelector('svg'), tip = box.querySelector('#tip'), cx = box.querySelector('#cx'), cd = box.querySelector('#cd');
    const C = chartData;
    const move = ev => {
      const rc = svg.getBoundingClientRect(); const sx = (ev.clientX - rc.left) / rc.width * C.W;
      const d = Math.round(C.d0 + (sx - C.ml) / (C.W - C.ml - C.mr) * Math.max(1, C.d1 - C.d0));
      const i = Math.max(0, Math.min(C.daily.length - 1, d - C.d0)); const p = C.daily[i];
      const px = C.x(p.d), py = C.y(p.bal);
      cx.setAttribute('x1', px); cx.setAttribute('x2', px); cx.style.display = '';
      cd.setAttribute('cx', px); cd.setAttribute('cy', py); cd.style.display = '';
      tip.hidden = false; tip.textContent = M.fmtDate(p.d) + ' · ' + cny(p.bal);
      tip.style.left = (px / C.W * rc.width) + 'px'; tip.style.top = (py / C.H * rc.height) + 'px';
    };
    const leave = () => { tip.hidden = true; cx.style.display = 'none'; cd.style.display = 'none'; };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move); svg.addEventListener('pointerleave', leave);
  }
  function viewCash() {
    const p = curPlan(); if (!p) return planBar(false);
    const res = calc(p); const L = res.ledger; const c = res.cmp; const P = state.params;
    let h = '<div class="card"><div class="bd">' + planBar(false) + '</div></div>';
    const mode = P.payoutMode === 'dod' ? 'dod' : 'auto';
    h += '<div class="card"><div class="hd"><h2>资金盘</h2><span class="sub">人民币 · 按天算 · 从 ' + esc(P.cashStartDate) + ' 账上 ' + cny(P.cashStart) + ' 起</span><span class="sp"></span>'
      + '<div class="seg" role="group" aria-label="回款口径"><button data-act="payout" data-k="auto" class="' + (mode === 'auto' ? 'on' : '') + '">口径 A · 自动结算</button><button data-act="payout" data-k="dod" class="' + (mode === 'dod' ? 'on' : '') + '">口径 B · 按需提现</button></div></div>';
    const k = (l, v, s) => '<div class="kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + (s || '') + '</div></div>';
    const fixedTxt = c.fixedShort.length ? c.fixedShort.map(x => M.shortDate(x.d) + ' 差 ' + cny(x.short)).join('；') : c.fixedCount + ' 次都够';
    const dueTxt = c.dueShort.length ? c.dueShort.map(x => M.shortDate(x.d) + ' ' + x.note.replace(/^.*\s/, '') + '差 ' + cny(x.short)).join('；') : (c.dueCount ? c.dueCount + ' 笔都够' : '没有到期的');
    h += '<div class="bd" style="display:flex;flex-direction:column;gap:12px"><div class="kpis">'
      + k('账上最低现金', cny(c.minBal), M.fmtDate(c.minDate))
      + k('算到 ' + M.fmtDate(L.end), cny(c.endBal), '期末现金')
      + k('15 号发薪够不够', c.fixedShort.length ? c.fixedShort.length + ' 次不够' : '都够', fixedTxt)
      + k('到期货款 / 头程那天', c.dueShort.length ? c.dueShort.length + ' 笔不够' : '都够', dueTxt)
      + '</div>' + cashChart(L)
      + '<p class="note">' + (mode === 'auto'
        ? '<b>口径 A</b>：每笔订单送达（下单 + ' + esc(P.deliveryDays) + ' 天）后再过 ' + esc(P.reserveDays) + ' 天释放，释放后的第一个结算日（' + (P.settleMode === 'every14' ? '从 ' + esc(P.settleAnchor) + ' 起每 14 天' : '每月 ' + esc((P.settleDays || []).join(' / ')) + ' 号') + '）把这期释放的钱扣掉这期的广告一起打款，' + esc(P.bankDays) + ' 天到账；这期广告比回款多时，差额当天走信用卡。'
        : '<b>口径 B</b>：释放后不等结算日，每天提现，' + esc(P.bankDays) + ' 天到账；广告按日表当天付。')
      + ' 固定开支每月 ' + esc(P.fixedDay) + ' 号付 ' + cny(P.fixedMonthly) + '；货款、头程按发货批次表的账期到期那天付。这些规则在「参数」里改。</p></div></div>';
    // 月表
    const MCOLS = [{ l: '月份', k: 'month', t: 'month' }, { l: '月初现金', k: 'open', t: 'cny' }, { l: '+ 回款到账', k: 'sales', t: 'cny' }, { l: MINUS + ' 广告', k: 'ad', t: 'cny' }, { l: MINUS + ' 固定开支', k: 'fixed', t: 'cny' }, { l: MINUS + ' 到期货款 / 头程', k: 'goods', t: 'cny' }, { l: '= 月末现金', k: 'close', t: 'cny' }, { l: '月内最低', k: 'min', t: 'cny' }, { l: '哪天', k: 'minDate', t: 'date' }];
    h += '<div class="card"><div class="hd"><h2>每月现金</h2><span class="sub">人民币</span></div>' + simpleTable(MCOLS, L.months, null, 'cashm') + '</div>';
    // 流水
    let bal = +P.cashStart || 0;
    const ev = L.events.map(e => { bal += e.amt; return { d: e.d, kind: KIND[e.kind] || e.kind, note: e.note, amt: e.amt, after: bal }; });
    const ECOLS = [{ l: '日期', k: 'd', t: 'date' }, { l: '事项', k: 'kind', t: 'text' }, { l: '说明', k: 'note', t: 'text' }, { l: '金额', k: 'amt', t: 'cny' }, { l: '之后余额', k: 'after', t: 'cny' }];
    h += '<div class="card"><div class="hd"><h2>每一笔进出</h2><span class="sub">' + ev.length + ' 笔</span></div>' + (ev.length ? simpleTable(ECOLS, ev, null, 'cashe', 'evt') : '<div class="bd note">没有进出。</div>') + '</div>';
    return h;
  }

  // ---------- 全年表 ----------
  const ACT = [['units', '实际单量', 'int', '单量偏差'], ['sales', '实际销售额 $', 'usd', '销售额偏差 $'], ['ad', '实际广告花费 $', 'usd', '广告花费偏差 $'], ['payback', '实际回款 $', 'usd', '回款偏差 $'], ['profit', '实际利润 $', 'usd', '利润偏差 $']];
  const ACT_PLAN = { units: 'units', sales: 'sales', ad: 'ad', payback: 'netByPay', profit: 'profit' };
  function annualRows(cols) {
    let prevAvg = null;
    const growth = cols.map(c => { const a = c.plan.dailyAvg; const g = prevAvg && a ? a / prevAvg - 1 : null; prevAvg = a || null; return g; });
    const B = state.batches.map(b => M.batchInfo(b, state.params)).filter(b => b.ship != null && b.qty > 0).sort((a, b) => a.ship - b.ship);
    const first = B[0];
    return [
      ['目标单量', cols.map(c => int(c.plan.units))],
      ['目标销售额 $', cols.map(c => usd(c.plan.sales, 0))],
      ['目标日均单量', cols.map(c => n1(c.plan.dailyAvg))],
      ['目标增幅', growth.map(g => pct(g))],
      ['目标广告花费 $', cols.map(c => usd(c.plan.ad, 0))],
      ['TACOS（广告占比）', cols.map(c => pct(c.plan.tacos))],
      ['货值 $', cols.map(c => usd(c.plan.goods, 0))],
      ['头程 $', cols.map(c => usd(c.plan.freight, 0))],
      ['回款 $', cols.map(c => usd(c.plan.netByPay, 0))],
      ['目标利润率', cols.map(c => pct(c.plan.margin))],
      ['目标利润 $', cols.map(c => usd(c.plan.profit, 0))],
      ['回款流覆盖三个月的货值头程', cols.map(c => c.cover ? c.cover.status : '')],
      ['现金流利润覆盖未来三个月的货值头程', cols.map(c => c.coverProfit ? c.coverProfit.status : '')],
      ['首批备货', cols.map((c, i) => i === 0 && first ? int(first.qty) + ' 套' : '')],
    ];
  }
  function viewAnnual() {
    const p = curPlan(); if (!p) return planBar(false);
    const res = calc(p);
    const cols = M.annual(res, state.actuals);
    let h = '<div class="card"><div class="bd">' + planBar(false) + '</div></div>';
    const head = '<tr><th class="stk l">指标</th>' + cols.map(c => '<th>' + esc(M.monthLabel(c.month)) + '</th>').join('') + '</tr>';
    let body = annualRows(cols).map(r => '<tr><td class="stk l">' + r[0] + '</td>' + r[1].map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('');
    body += '<tr class="grp"><td class="stk l" colspan="1"><b>实际</b>（月底填，美元）</td>' + cols.map(() => '<td></td>').join('') + '</tr>';
    for (const [k, l] of ACT) {
      body += '<tr><td class="stk l">' + l + '</td>' + cols.map(c => {
        const v = (state.actuals[c.month] || {})[k];
        return '<td class="in"><input type="text" inputmode="decimal" data-f="actual" data-m="' + c.month + '" data-k="' + k + '" data-fk="a' + c.month + k + '" value="' + esc(iv(v, 2)) + '" aria-label="' + esc(M.monthLabel(c.month) + l) + '"></td>';
      }).join('') + '</tr>';
    }
    body += '<tr class="grp"><td class="stk l"><b>偏差</b>（实际 ' + MINUS + ' 预估）</td>' + cols.map(() => '<td></td>').join('') + '</tr>';
    for (const [k, , t, dl] of ACT) {
      body += '<tr><td class="stk l">' + dl + '</td>' + cols.map(c => {
        const a = (state.actuals[c.month] || {})[k]; if (!ok(a)) return '<td class="mut"></td>';
        const pv = c.plan[ACT_PLAN[k]] || 0; const d = a - pv;
        return '<td>' + esc((t === 'int' ? int(d) : usd(d, 0)) + (pv ? '（' + pct(d / Math.abs(pv)) + '）' : '')) + '</td>';
      }).join('') + '</tr>';
    }
    h += '<div class="card"><div class="hd"><h2>全年汇总表</h2><span class="sub">预估全部从推广计划表汇上来 · 美元</span></div><div class="tw" data-sk="annual"><table class="t ann"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>'
      + '<div class="bd"><p class="note">列是月份，行是指标，和你的第三张截图一样。货值、头程按当月卖出的单量算（同 Excel 月份统计）；回款按回款月份归集，已扣广告；利润 = 净回款 ' + MINUS + ' 货值头程。下面「实际」那几行月底由你或运营填，偏差 = 实际 ' + MINUS + ' 预估（括号里是百分比）。实际数存在这台电脑的浏览器里，所有方案共用。</p></div></div>';
    return h;
  }

  // ---------- 方案对比 ----------
  function viewCompare() {
    const ps = allPlans();
    let h = '<div class="card"><div class="hd"><h2>出方案</h2><span class="sub">工具按下面的参数自动生成完整的推广计划表，和运营的方案互不影响</span><span class="sp"></span>'
      + '<button class="btn pri" data-act="genAll">出方案</button><button class="btn" data-act="genAdd">加一套</button><button class="btn ghost" data-act="genReset">恢复默认三套</button></div><div class="bd"><div class="gens">';
    state.gens.forEach((g, i) => {
      h += '<div class="gen"><div class="hd"><input data-f="genName" data-i="' + i + '" data-fk="gn' + i + '" value="' + esc(g.name) + '" aria-label="方案名"><span class="tag tool">工具出的</span></div>'
        + genInputs(g, 'gen', i)
        + '<div class="note">' + esc(genHint(g)) + '</div>'
        + '<div class="row"><button class="btn" data-act="openPlan" data-k="g:' + esc(g.id) + '">看按日表</button><button class="btn" data-act="copyGen" data-i="' + i + '">复制成运营方案</button><span class="sp"></span><button class="btn ghost danger" data-act="genDel" data-i="' + i + '">删掉</button></div></div>';
    });
    h += '</div></div></div>';
    // 并排表
    const off = new Set(state.ui.cmpOff || []);
    const chips = ps.map(p => '<label class="chip"><input type="checkbox" data-act="cmpToggle" data-k="' + esc(p.id) + '"' + (off.has(p.id) ? '' : ' checked') + '>' + esc(p.name) + (p.kind === 'tool' ? ' <span class="tag tool">工具</span>' : ' <span class="tag">运营</span>') + '</label>').join('');
    const sel = ps.filter(p => !off.has(p.id));
    h += '<div class="card"><div class="hd"><h2>方案对比</h2><span class="sub">同一批货、几种推法，只把账算出来摆在一起，选哪套由你定</span></div><div class="bd"><div class="chips">' + chips + '</div></div>';
    if (!sel.length) return h + '<div class="bd note">勾上要比的方案。</div></div>';
    // 统一算到同一天，期末现金才好比
    let end = null;
    if (!state.params.horizonEnd) { for (const p of sel) { const e = calc(p).ledger.end; if (end == null || e > end) end = e; } }
    const hz = end == null ? '' : M.fmtDate(end);
    const R = sel.map(p => ({ p, res: calc(p, hz) }));
    const fx = state.params.fx;
    const months = R[0].res.cmp.arrivals.map(a => a.month);
    const line = (l, f, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td class="k">' + l + '</td>' + R.map(x => '<td>' + f(x.res.cmp, x.res, x.p) + '</td>').join('') + '</tr>';
    let t = '<tr><th class="l" style="position:sticky;left:0;z-index:3">　</th>' + R.map(x => '<th class="pl"><a data-act="openPlan" data-k="' + esc(x.p.id) + '" title="打开它的按日表">' + esc(x.p.name) + '</a><br><span class="tag' + (x.p.kind === 'tool' ? ' tool' : '') + '">' + (x.p.kind === 'tool' ? '工具出的' : '运营的') + '</span></th>').join('') + '</tr>';
    let b = '';
    b += line('这批货货值 + 运费', c => cny(c.batchCostCny));
    b += line('推广天数 · 实卖单量', c => c.days + ' 天 · ' + int(c.units) + ' 单' + (c.short > 0.5 ? '<br><span class="mut">计划 ' + int(c.unitsPlan) + '</span>' : ''));
    b += line('销售额', c => usd(c.sales, 0) + '<br><span class="mut">' + cny(c.salesCny) + '</span>');
    b += line('推广花费合计', c => usd(c.ad, 0) + '<br><span class="mut">' + cny(c.adCny) + '</span>');
    b += line('TACOS（广告占销售额）', c => pct(c.tacos));
    b += line('回款合计（已扣广告）', c => usd(c.net, 0) + '<br><span class="mut">' + cny(c.netCny) + '</span>');
    b += '<tr><td class="k">回款什么时候来<br><span class="mut">亚马逊打款 ' + MINUS + ' 当期广告，按到账月</span></td>' + R.map(() => '<td></td>').join('') + '</tr>';
    months.forEach((mk, i) => { b += line(M.monthLabel(mk), c => cny(c.arrivals[i] ? c.arrivals[i].amt : 0), 'sub2'); });
    b += line('利润（结算口径）', c => usd(c.profit, 0) + '<br><span class="mut">' + cny(c.profitCny) + '</span>');
    b += line('卖完 / 断货日', c => c.soldOut != null ? M.fmtDate(c.soldOut) : '没卖完，剩 ' + int(c.stockEnd) + ' 套');
    b += line('账上最低现金（哪天）', c => cny(c.minBal) + '<br><span class="mut">' + M.fmtDate(c.minDate) + '</span>');
    b += line('15 号发薪够不够', c => c.fixedShort.length ? c.fixedShort.map(x => M.shortDate(x.d) + ' 差 ' + cny(x.short)).join('<br>') : c.fixedCount + ' 次都够');
    b += line('到期货款 / 头程那天够不够', c => c.dueShort.length ? c.dueShort.map(x => M.shortDate(x.d) + ' 差 ' + cny(x.short)).join('<br>') : (c.dueCount ? '够' : '没有到期的'));
    b += line('期末现金（' + (hz || '各自') + '）', c => cny(c.endBal));
    h += '<div class="tw" data-sk="cmp"><table class="t cmp"><thead>' + t + '</thead><tbody>' + b + '</tbody></table></div>';
    h += '<div class="bd"><p class="note">没有排名、没有推荐。点方案名打开它的按日表和汇总。资金盘按「参数」里的回款规则、固定开支、发货批次账期算，现金统一算到同一天，期末现金才能直接比。汇率 ' + esc(fx) + '。</p></div></div>';
    return h;
  }

  // ---------- 参数 ----------
  function pField(k, l, t, opts) {
    const P = state.params; const v = P[k];
    if (t === 'select') return '<label class="f"><span>' + l + '</span><select data-f="param" data-k="' + k + '" data-t="text" data-fk="p.' + k + '">' + opts.map(o => '<option value="' + o[0] + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label>';
    const val = t === 'pct' ? iv(v * 100, 3) : t === 'list' ? (v || []).join(', ') : t === 'date' || t === 'text' ? (v || '') : iv(v, 6);
    return '<label class="f"><span>' + l + '</span><input ' + (t === 'date' ? 'type="text" inputmode="numeric" placeholder="空着 = 自动" autocomplete="off"' : 'type="text"' + (t === 'text' || t === 'list' ? '' : ' inputmode="decimal"')) + ' data-f="param" data-k="' + k + '" data-t="' + t + '" data-fk="p.' + k + '" value="' + esc(val) + '"></label>';
  }
  const FEE_KEYS = new Set(['fba', 'returnRate', 'returnFee', 'storage', 'inbound', 'carrier', 'couponFeeRate', 'costMode', 'fixedGoods', 'fixedFreight']);
  const BATCH_COLS = [
    { k: 'name', l: '批次', t: 'text', w: 150 }, { k: 'qty', l: '数量（套）', t: 'num' }, { k: 'shipDate', l: '发货日', t: 'date' }, { k: 'arriveDate', l: '到货日', t: 'date' },
    { k: 'mode', l: '方式', t: 'mode' }, { k: 'goodsCny', l: '采购 元/套', t: 'num' }, { k: 'freightCny', l: '头程 元/套', t: 'num' },
    { k: 'goodsTermMonths', l: '采购账期（月）', t: 'num' }, { k: 'freightTermDays', l: '头程账期（天）', t: 'num' }];
  function viewParams() {
    const P = state.params;
    let h = '';
    h += '<div class="card"><div class="hd"><h2>费率</h2><span class="sub">现在用：' + esc(M.PRESET_LABEL[P.preset] || '手改过的') + '</span><span class="sp"></span>'
      + '<button class="btn" data-act="preset" data-k="finance">换成财务包口径</button><button class="btn" data-act="preset" data-k="sheet">换成原表格口径（对数用）</button></div><div class="bd" style="display:flex;flex-direction:column;gap:10px">'
      + '<div class="grid">' + pField('fba', 'FBA $ / 件', 'num') + pField('returnRate', '退货率 %', 'pct') + pField('returnFee', '退货处理费 $ / 件', 'num') + pField('storage', '仓储 $ / 件', 'num')
      + pField('couponFeeRate', 'coupon 手续费 %', 'pct') + pField('inbound', '入库配置费 $ / 件', 'num') + pField('carrier', '承运费 $ / 件', 'num') + pField('commMin', '佣金最低 $ / 件', 'num')
      + pField('costMode', '货值 + 头程按', 'select', [['batch', '发货批次表（每批自己的单价）'], ['fixed', '固定单价（原表格）']])
      + (P.costMode === 'fixed' ? pField('fixedGoods', '固定货值 $ / 件', 'num') + pField('fixedFreight', '固定头程 $ / 件', 'num') : '') + '</div>'
      + '<p class="note">佣金分档：售价 ≤ $15 收 5%、≤ $20 收 10%、> $20 收 17%，每件最低 ' + usd(P.commMin) + '（按 coupon / prime 四种成交价加权，同 Excel）。<b>财务包口径</b>：FBA $6.50、退货 10% + $3、仓储 $0.11（财务包自己标 FBA、仓储「待核」）。<b>原表格口径</b>：FBA $6.04、退货 8%、仓储 $0.09、货值 $8.51 + 头程 $1.12，只用来和你 Excel 对数。</p></div></div>';
    h += '<div class="card"><div class="hd"><h2>现金和固定开支</h2></div><div class="bd"><div class="grid">'
      + pField('cashStart', '账上现金 ¥', 'num') + pField('cashStartDate', '从哪天算', 'date') + pField('fixedMonthly', '固定开支 ¥ / 月', 'num') + pField('fixedDay', '每月几号付', 'int') + pField('fx', '汇率', 'num')
      + '</div></div></div>';
    h += '<div class="card"><div class="hd"><h2>回款规则</h2><span class="sub">查过亚马逊官方规则（DD+7、每 14 天结算）</span></div><div class="bd" style="display:flex;flex-direction:column;gap:10px"><div class="grid">'
      + pField('payDays', '日表回款日期 = 下单 + 天', 'int') + pField('deliveryDays', '送达 = 下单 + 天', 'int') + pField('reserveDays', '释放 = 送达 + 天', 'int') + pField('bankDays', '打款到账天数', 'int')
      + pField('payoutMode', '资金盘口径', 'select', [['auto', 'A · 自动结算（默认）'], ['dod', 'B · 按需提现']])
      + pField('settleMode', '结算日', 'select', [['monthly', '每月固定几号'], ['every14', '从某天起每 14 天']])
      + (P.settleMode === 'every14' ? pField('settleAnchor', '从哪天起', 'date') : pField('settleDays', '每月几号（逗号隔开）', 'list'))
      + pField('horizonEnd', '资金盘算到哪天（空 = 自动）', 'date')
      + '</div><p class="note">资金盘口径 A：订单送达后 ' + esc(P.reserveDays) + ' 天释放 → 之后第一个结算日打款（扣掉这期广告）→ ' + esc(P.bankDays) + ' 天到账。11 月 28 日结的是 11 月 5 日–11 月 19 日下的单。你后台「付款 → 付款控制面板」的「下次付款日期」是真的结算日，照它改。日表「回款日期」仍按你 Excel 的下单 + 25 天。</p></div></div>';
    // 批次表
    const bth = '<tr>' + BATCH_COLS.map(c => '<th class="l">' + c.l + '</th>').join('') + '<th>货款 ¥</th><th>头程 ¥</th><th>货款到期</th><th>头程到期</th><th></th></tr>';
    let bt = '';
    state.batches.forEach((b, i) => {
      const bi = M.batchInfo(b, P);
      bt += '<tr>' + BATCH_COLS.map(c => {
        if (c.t === 'mode') return '<td class="in"><select class="sel" data-f="batch" data-i="' + i + '" data-k="mode" data-t="text" data-fk="b' + i + '.mode">' + ['海运', '快船', '空运'].map(m => '<option' + (b.mode === m ? ' selected' : '') + '>' + m + '</option>').join('') + '</select></td>';
        const v = c.t === 'date' || c.t === 'text' ? (b[c.k] || '') : iv(b[c.k], 4);
        return '<td class="in"><input ' + (c.t === 'date' ? 'type="text" inputmode="numeric" placeholder="2026-12-01" autocomplete="off"' : 'type="text"' + (c.t === 'num' ? ' inputmode="decimal"' : '')) + (c.w ? ' style="min-width:' + c.w + 'px;text-align:left"' : '') + ' data-f="batch" data-i="' + i + '" data-k="' + c.k + '" data-t="' + c.t + '" data-fk="b' + i + '.' + c.k + '" value="' + esc(v) + '"></td>';
      }).join('') + '<td>' + cny(bi.goodsTotalCny) + '</td><td>' + cny(bi.freightTotalCny) + '</td><td>' + (bi.goodsDue != null ? M.fmtDate(bi.goodsDue) : '') + '</td><td>' + (bi.freightDue != null ? M.fmtDate(bi.freightDue) : '') + '</td>'
        + '<td><button class="x" data-act="delBatch" data-i="' + i + '" title="删掉这批" aria-label="删掉这批">×</button></td></tr>';
    });
    h += '<div class="card"><div class="hd"><h2>发货批次表</h2><span class="sub">库存 = 已到货数量 ' + MINUS + ' 累计单量；货款、头程按账期到期那天付</span><span class="sp"></span><button class="btn" data-act="addBatch">加一批（补货）</button></div>'
      + '<div class="tw" data-sk="batch"><table class="t"><thead>' + bth + '</thead><tbody>' + bt + '</tbody></table></div>';
    h += '<div class="bd"><p class="note">首批按财务包《Y背批次付款》：SHIP-7d45bc55 2,600 套，9/30 发、10/30 到，采购 55.5 + 头程 5 元 / 套，采购 6 个月、头程 60 天都从发货日起算。财务包建议的 3 批补货（57 + 7.9 元 / 套）财务自己标了「未确认执行」，没有预装，确定了在这里加一批。</p></div></div>';
    // 数据
    h += '<div class="card"><div class="hd"><h2>数据</h2></div><div class="bd" style="display:flex;flex-direction:column;gap:10px">'
      + '<p class="note">你填的东西只存在这台电脑的浏览器里。要给别人或换电脑，用「导出方案文件」带走，再在那边「导入方案文件」。</p><div class="row">'
      + (canSave() ? '<button class="btn" data-act="exportJson">导出方案文件</button>' : '')
      + '<label class="btn" style="display:inline-flex;align-items:center">导入方案文件<input type="file" accept=".json,application/json" data-act-change="importJson" hidden></label>'
      + (state.ui.confirm === 'reset' ? '<span class="note">把参数、批次、所有方案、实际数都恢复成默认？</span><button class="btn danger" data-act="resetAll">确定恢复</button><button class="btn ghost" data-act="cancelConfirm">取消</button>'
        : '<button class="btn ghost danger" data-act="askReset">恢复默认</button>')
      + '</div></div></div>';
    return h;
  }

  // ---------- 输入 ----------
  function rowAdShare(i, spend) {
    const p = curPlan(); const res = calc(p); const r = res.rows.find(x => x.idx === i); const raw = p.src.rows[i];
    if (!r) return;
    const units = r.units > 0 ? r.units : (+raw.units || 0);
    if (!(r.cpa > 0) || !(units > 0)) { toast('要先填 CPC、CVR 和总单量，才能按广告花费倒推广告单'); return; }
    let s = spend / (r.cpa * units);
    if (s > 1) { s = 1; toast('广告花费超过 总单量 × CPA（' + usd(r.cpa * units) + '），按广告单占比 100% 算'); }
    raw.adShare = Math.max(0, s);
  }
  function sortRows(p) { p.rows.sort((a, b) => (M.parseDate(a.date) || 0) - (M.parseDate(b.date) || 0)); }
  function applyChange(el) {
    const dv = M.parseDate(el.defaultValue); yearHint = dv != null ? M.parts(dv).y : 2026;
    const f = el.dataset.f; const v = el.value; const k = el.dataset.k; const i = el.dataset.i === '' || el.dataset.i == null ? null : +el.dataset.i;
    const p = curPlan();
    switch (f) {
      case 'planSel': state.ui.planId = v; state.ui.panel = null; state.ui.qg = null; state.ui.renaming = false; break;
      case 'planName': if (p && p.kind === 'ops') p.src.name = v.trim() || p.src.name; state.ui.renaming = false; break;
      case 'row': {
        if (!p || p.kind !== 'ops') return;
        const raw = p.src.rows[i]; if (!raw) return;
        if (k === 'date') { const d = parseTyped('date', v); if (!d) { scheduleRender(); return; } raw.date = d; break; }
        const col = COLS.find(c => c.k === k);
        const x = parseTyped(col.inp === 'pct' ? 'pct' : 'num', v);
        if (x == null) { scheduleRender(); return; }
        if (k === 'adSpend') { rowAdShare(i, x); break; }
        raw[k] = x; break;
      }
      case 'addTo': state.ui.addTo = parseDateLoose(v, yearHint) || v; return;
      case 'qg': { const t = el.dataset.t; const x = parseTyped(t, v); if (x == null) { scheduleRender(); return; } state.ui.qg[k] = x; scheduleRender(); return; }
      case 'gen': { const t = el.dataset.t; const x = parseTyped(t, v); if (x == null) { scheduleRender(); return; } state.gens[i][k] = x; break; }
      case 'genName': state.gens[i].name = v.trim() || state.gens[i].name; break;
      case 'param': {
        const t = el.dataset.t; const x = parseTyped(t === 'date' && v === '' ? 'text' : t, v);
        if (x == null) { scheduleRender(); return; }
        state.params[k] = x;
        if (FEE_KEYS.has(k)) state.params.preset = 'custom';
        break;
      }
      case 'batch': {
        const t = el.dataset.t; const x = t === 'text' ? v : parseTyped(t, v);
        if (x == null) { scheduleRender(); return; }
        state.batches[i][k] = x; break;
      }
      case 'actual': {
        const m = el.dataset.m; const x = parseNum(v);
        const o = state.actuals[m] || (state.actuals[m] = {});
        if (x == null) delete o[k]; else o[k] = x;
        if (!Object.keys(o).length) delete state.actuals[m];
        break;
      }
      default: return;
    }
    commit();
  }
  app.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset && el.dataset.actChange === 'importJson') { importJson(el); return; }
    if (!el.dataset || !el.dataset.f) return;
    applyChange(el);
  });

  app.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset && el.dataset.f === 'paste') { state.ui.pasteText = el.value; const n = document.getElementById('pasteInfo'); if (n) n.textContent = pasteInfo(); }
  });
  app.addEventListener('keydown', e => {
    const el = e.target;
    if (e.key !== 'Enter' || !el.dataset || el.tagName !== 'INPUT') return;
    if (el.dataset.f === 'row' || el.dataset.f === 'actual') {
      e.preventDefault();
      if (el.dataset.f === 'row') {
        const p = curPlan(); const order = p.rows.map((r, i) => ({ i, d: M.parseDate(r.date) || 0 })).sort((a, b) => a.d - b.d || a.i - b.i);
        const pos = order.findIndex(o => o.i === +el.dataset.i); const nx = order[pos + (e.shiftKey ? -1 : 1)];
        if (nx) pendingFocus = 'r' + nx.i + '.' + el.dataset.k;
      }
      if (el.value !== el.defaultValue) applyChange(el); else if (pendingFocus) { const t = pendingFocus; pendingFocus = null; const n = app.querySelector('[data-fk="' + CSS.escape(t) + '"]'); if (n) { n.focus(); n.select && n.select(); } }
    } else if (el.dataset.f === 'addTo') { e.preventDefault(); applyChange(el); ACTIONS.addTo(); }
    else if (el.dataset.f) { e.preventDefault(); el.blur(); }
  });

  // ---------- 按钮 ----------
  function blankRow(date) { return { date, price: 29.99, prime: 0, coupon: 0.3, couponUse: 0.8, primeUse: 0.9, cpc: 5, ctr: 0.01, cvr: 0.12, units: 10, adShare: 0.8, activity: 0 }; }
  function lastRow(p) { let best = null, bd = -1; p.rows.forEach(r => { const d = M.parseDate(r.date); if (d != null && d >= bd) { bd = d; best = r; } }); return best; }
  function newId(prefix) { return prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  const ACTIONS = {
    tab(el) { state.ui.tab = el.dataset.k; state.ui.confirm = null; try { history.replaceState(null, '', '#' + el.dataset.k); } catch (e) { location.hash = el.dataset.k; } window.scrollTo(0, 0); scheduleRender(); },
    preset(el) { const P = state.params; state.params = M.applyPreset(P, el.dataset.k); commit(); toast('已换成' + M.PRESET_LABEL[el.dataset.k]); },
    payout(el) { state.params.payoutMode = el.dataset.k; commit(); },
    toggleFees(el) { state.ui.showFees = el.checked; save(); scheduleRender(); },
    panel(el) { const k = el.dataset.k || null; state.ui.panel = state.ui.panel === k ? null : k; if (state.ui.panel !== 'gen') state.ui.qg = null; scheduleRender(); },
    addDay() {
      const p = curPlan(); if (!p || p.kind !== 'ops') return;
      const lr = lastRow(p.src);
      const r = lr ? Object.assign({}, lr, { date: M.fmtDate(M.parseDate(lr.date) + 1) }) : blankRow('2026-11-07');
      p.src.rows.push(r); pendingFocus = 'r' + (p.src.rows.length - 1) + '.units'; commit();
    },
    addTo() {
      const p = curPlan(); if (!p || p.kind !== 'ops') return;
      const to = M.parseDate(state.ui.addTo); if (to == null) { toast('先选要加到哪一天'); return; }
      let lr = lastRow(p.src); let d = lr ? M.parseDate(lr.date) : to - 1;
      if (!lr) lr = blankRow(M.fmtDate(to));
      if (to <= d) { toast('表里已经有到 ' + M.fmtDate(d) + ' 了'); return; }
      if (to - d > 400) { toast('一次最多加 400 天'); return; }
      let n = 0; while (d < to) { d++; p.src.rows.push(Object.assign({}, lr, { date: M.fmtDate(d) })); n++; }
      commit(); toast('加了 ' + n + ' 天，都复制了最后一行，改成你要的数');
    },
    qgApply(el) {
      const p = curPlan(); if (!p || p.kind !== 'ops') return;
      const rows = M.generateRows(state.ui.qg); if (!rows.length) { toast('天数或第一天没填对'); return; }
      snapshot();
      if (el.dataset.k === 'replace') p.src.rows = rows;
      else { const have = new Set(p.src.rows.map(r => r.date)); const add = rows.filter(r => !have.has(r.date)); p.src.rows = p.src.rows.concat(add); sortRows(p.src); }
      state.ui.panel = null; state.ui.qg = null; commit(); toast('生成了 ' + rows.length + ' 天', true);
    },
    pasteApply(el) {
      const p = curPlan(); if (!p || p.kind !== 'ops') return;
      const t = state.ui.pasteText || ''; const r = M.parsePaste(t);
      if (!r.rows.length) { toast('没认出带日期的行。要从「日期」那一列开始选。'); return; }
      snapshot();
      if (el.dataset.k === 'replace') p.src.rows = r.rows;
      else { const have = new Map(p.src.rows.map((x, i) => [x.date, i])); r.rows.forEach(x => { if (have.has(x.date)) p.src.rows[have.get(x.date)] = x; else p.src.rows.push(x); }); sortRows(p.src); }
      state.ui.panel = null; state.ui.pasteText = ''; commit(); toast('粘进来 ' + r.rows.length + ' 天', true);
    },
    delRow(el) { const p = curPlan(); if (!p || p.kind !== 'ops') return; snapshot(); p.src.rows.splice(+el.dataset.i, 1); commit(); toast('删掉了一天', true); },
    newPlan() { const id = newId('o'); state.plans.push({ id, kind: 'ops', name: '运营方案 ' + (state.plans.length + 1), rows: [] }); state.ui.planId = id; state.ui.tab = 'plan'; commit(); },
    dupPlan() { const p = curPlan(); if (!p) return; const id = newId('o'); state.plans.push({ id, kind: 'ops', name: p.name + '（复制）', rows: JSON.parse(JSON.stringify(p.rows)) }); state.ui.planId = id; commit(); toast('复制好了，改这一份不影响原来那份'); },
    copyTool() { const p = curPlan(); if (!p || p.kind !== 'tool') return; const id = newId('o'); state.plans.push({ id, kind: 'ops', name: p.name + '（运营改）', rows: JSON.parse(JSON.stringify(p.rows)) }); state.ui.planId = id; state.ui.tab = 'plan'; commit(); toast('已复制成运营方案，可以逐格改了'); },
    copyGen(el) { const g = state.gens[+el.dataset.i]; const id = newId('o'); state.plans.push({ id, kind: 'ops', name: g.name + '（运营改）', rows: JSON.parse(JSON.stringify(genRows(g))) }); state.ui.planId = id; state.ui.tab = 'plan'; commit(); toast('已复制成运营方案'); },
    delPlan() {
      const p = curPlan(); if (!p || p.kind !== 'ops') return; snapshot();
      state.plans = state.plans.filter(x => x.id !== p.id); const ps = allPlans(); state.ui.planId = ps.length ? ps[0].id : null; commit(); toast('删掉了「' + p.name + '」', true);
    },
    openPlan(el) { state.ui.planId = el.dataset.k; state.ui.tab = 'plan'; try { history.replaceState(null, '', '#plan'); } catch (e) { /* 忽略 */ } window.scrollTo(0, 0); scheduleRender(); },
    genAll() { state.ui.cmpOff = []; commit(); const t = app.querySelector('.cmp'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('已按参数出了 ' + state.gens.length + ' 套，参数一改会自动重算'); },
    genAdd() { const base = Object.assign({}, state.gens[state.gens.length - 1] || M.defaultGens()[1]); base.id = newId('t'); base.name = '方案 ' + (state.gens.length + 1); state.gens.push(base); commit(); },
    genDel(el) { snapshot(); const g = state.gens.splice(+el.dataset.i, 1)[0]; if (state.ui.planId === 'g:' + g.id) state.ui.planId = (allPlans()[0] || {}).id; commit(); toast('删掉了「' + g.name + '」', true); },
    genReset() { snapshot(); state.gens = M.defaultGens(); commit(); toast('恢复成默认三套', true); },
    cmpToggle(el) { const off = new Set(state.ui.cmpOff || []); if (el.checked) off.delete(el.dataset.k); else off.add(el.dataset.k); state.ui.cmpOff = [...off]; save(); scheduleRender(); },
    addBatch() { const lb = state.batches[state.batches.length - 1]; state.batches.push({ id: newId('b'), name: '补货 ' + state.batches.length, qty: 0, shipDate: '', arriveDate: '', mode: '海运', goodsCny: lb ? lb.goodsCny : 57, freightCny: lb ? lb.freightCny : 7.9, goodsTermMonths: 6, freightTermDays: 60 }); commit(); },
    delBatch(el) { snapshot(); state.batches.splice(+el.dataset.i, 1); commit(); toast('删掉了一批', true); },
    rename() { state.ui.renaming = true; pendingFocus = 'planName'; scheduleRender(); },
    renameDone() { state.ui.renaming = false; scheduleRender(); },
    askReset() { state.ui.confirm = 'reset'; scheduleRender(); },
    cancelConfirm() { state.ui.confirm = null; scheduleRender(); },
    resetAll() { snapshot(); const tab = state.ui.tab; state = defaultState(); state.ui.tab = tab; commit(); toast('已恢复默认', true); },
    exportJson() { const data = JSON.stringify({ v: 2, params: state.params, batches: state.batches, plans: state.plans, gens: state.gens, actuals: state.actuals }, null, 1); saveFile('推广计划表方案_' + today() + '.json', data, 'application/json'); },
    exportXlsx() { exportXlsx(); },
    undo() { undo(); },
  };
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const fn = ACTIONS[el.dataset.act]; if (!fn) return;
    if (el.tagName !== 'INPUT') e.preventDefault();
    fn(el, e);
  });
  function importJson(input) {
    const file = input.files && input.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const s = JSON.parse(rd.result);
        if (!s || s.v !== 2 || !Array.isArray(s.plans)) throw new Error('bad');
        snapshot(); const ui = state.ui; state = normalize(Object.assign({}, s, { ui })); state.ui.planId = (state.plans[0] || {}).id || ui.planId; commit(); toast('导入了 ' + state.plans.length + ' 套运营方案', true);
      } catch (e) { toast('这个文件不是本工具导出的方案文件'); }
    };
    rd.readAsText(file);
  }
  window.addEventListener('hashchange', () => { const t = location.hash.replace('#', ''); if (TABS.some(x => x[0] === t) && t !== state.ui.tab) { state.ui.tab = t; scheduleRender(); } });
  let resizeT = null;
  window.addEventListener('resize', () => { if (state.ui.tab !== 'cash') return; clearTimeout(resizeT); resizeT = setTimeout(scheduleRender, 150); });

  // ---------- 提示条 ----------
  let toastEl = null, toastT = null;
  function toast(msg, withUndo) {
    hideToast();
    toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status');
    toastEl.innerHTML = esc(msg) + (withUndo && undoSnap ? ' <button class="tbtn" data-act="undo">撤销</button>' : '');
    document.body.appendChild(toastEl);
    toastT = setTimeout(hideToast, withUndo ? 6000 : 3000);
  }
  function hideToast() { if (toastEl) { toastEl.remove(); toastEl = null; } clearTimeout(toastT); }
  function today() { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }

  // ---------- 导出 Excel ----------
  function cellOf(t, v) {
    if (v == null || (typeof v === 'number' && !isFinite(v))) return null;
    switch (t) {
      case 'date': return ok(v) ? M.fmtDate(v) : v;
      case 'month': return v ? M.monthLabel(v) : '';
      case 'wd': return v ? '周' + WD[v] : '';
      case 'cover': return v.status;
      case 'stock': return v;
      default: return v;
    }
  }
  const ZF = { usd: '#,##0.00', usd0: '#,##0', cny: '#,##0', int: '#,##0', num1: '#,##0.0', pct: '0.0%', pct2: '0.00%' };
  function sheetFrom(aoa, types, startRow) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (types) {
      for (let r = startRow; r < aoa.length; r++) for (let c = 0; c < types.length; c++) {
        const z = ZF[types[c]]; if (!z) continue;
        const ref = XLSX.utils.encode_cell({ r, c }); if (ws[ref] && ws[ref].t === 'n') ws[ref].z = z;
      }
    }
    ws['!cols'] = (aoa[startRow - 1] || aoa[0] || []).map(h => ({ wch: Math.max(8, Math.min(28, String(h == null ? '' : h).length * 2 + 2)) }));
    return ws;
  }
  function tableAoa(cols, rows, foot) {
    const aoa = [cols.map(c => c.l)];
    rows.forEach(r => aoa.push(cols.map((c, j) => j === 0 && r._first ? r._first : cellOf(c.t, r[c.k]))));
    (foot || []).forEach(r => aoa.push(cols.map((c, j) => j === 0 ? (r._label || r.key || '') : cellOf(c.t, r[c.k]))));
    return aoa;
  }
  function exportXlsx() {
    if (typeof XLSX === 'undefined') { exportCsv(); return; }
    const p = curPlan(); if (!p) { toast('没有方案可导出'); return; }
    const res = calc(p); const P = state.params; const wb = XLSX.utils.book_new();
    const add = (name, ws) => XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31));
    // 参数
    const pa = [['参数', '值'], ['费率口径', M.PRESET_LABEL[P.preset] || '手改过的'], ['佣金', '售价 ≤ $15 收 5%、≤ $20 收 10%、> $20 收 17%，每件最低 $' + P.commMin], ['FBA $/件', P.fba], ['退货率', P.returnRate], ['退货处理费 $/件', P.returnFee],
      ['仓储 $/件', P.storage], ['入库配置费 $/件', P.inbound], ['承运费 $/件', P.carrier], ['coupon 手续费', P.couponFeeRate], ['货值 + 头程按', P.costMode === 'fixed' ? '固定单价 $' + P.fixedGoods + ' + $' + P.fixedFreight : '发货批次表'],
      ['汇率', P.fx], ['账上现金 ¥', P.cashStart], ['从哪天算', P.cashStartDate], ['固定开支 ¥/月', P.fixedMonthly], ['每月几号付', P.fixedDay],
      ['日表回款日期 = 下单 + 天', P.payDays], ['送达 = 下单 + 天', P.deliveryDays], ['释放 = 送达 + 天', P.reserveDays], ['资金盘口径', P.payoutMode === 'dod' ? 'B 按需提现' : 'A 自动结算'],
      ['结算日', P.settleMode === 'every14' ? '从 ' + P.settleAnchor + ' 起每 14 天' : '每月 ' + (P.settleDays || []).join(' / ') + ' 号'], ['打款到账天数', P.bankDays], [], ['发货批次表']];
    pa.push(BATCH_COLS.map(c => c.l).concat(['货款 ¥', '头程 ¥', '货款到期', '头程到期']));
    state.batches.forEach(b => { const bi = M.batchInfo(b, P); pa.push(BATCH_COLS.map(c => b[c.k] == null ? '' : b[c.k]).concat([bi.goodsTotalCny, bi.freightTotalCny, bi.goodsDue != null ? M.fmtDate(bi.goodsDue) : '', bi.freightDue != null ? M.fmtDate(bi.freightDue) : ''])); });
    const wsP = XLSX.utils.aoa_to_sheet(pa); wsP['!cols'] = [{ wch: 26 }, { wch: 40 }]; add('参数', wsP);
    // 推广计划表
    const dc = COLS.map(c => c.k === 'stockLeft' ? Object.assign({}, c, { t: 'int' }) : c);
    const daily = [dc.map(c => c.l).concat(['断货少卖'])];
    res.rows.forEach(r => daily.push(dc.map(c => cellOf(c.t, r[c.k])).concat([r.short > 1e-9 ? r.short : null])));
    const T = res.totals;
    daily.push(dc.map(c => c.k === 'date' ? '合计' : footVal(c.k, T, res.rows)).concat([T.short || null]));
    add('推广计划表', sheetFrom(daily, dc.map(c => c.t), 1));
    add('周汇总', sheetFrom(tableAoa(WEEK_COLS, weekRows(res), weekFoot(res)), WEEK_COLS.map(c => c.t), 1));
    const mf = monthFoot(res);
    const ma = tableAoa(MONTH_COLS, res.monthly, [mf[0]]);
    ma.push(MONTH_COLS.map((c, j) => j === 0 ? mf[1]._label : mf[1][c.k] == null ? null : mf[1][c.k]));
    add('月份统计', sheetFrom(ma, MONTH_COLS.map(c => c.t), 1));
    add('纯现金流', sheetFrom(tableAoa(CASH_COLS, cashRows(res)), CASH_COLS.map(c => c.t), 1));
    // 资金盘
    const L = res.ledger;
    const ca = [['月份', '月初现金', '+ 回款到账', '− 广告', '− 固定开支', '− 到期货款/头程', '= 月末现金', '月内最低', '哪天']];
    L.months.forEach(m => ca.push([M.monthLabel(m.month), m.open, m.sales, m.ad, m.fixed, m.goods, m.close, m.min, M.fmtDate(m.minDate)]));
    ca.push([]); ca.push(['日期', '事项', '说明', '金额', '之后余额']);
    let bal = +P.cashStart || 0; L.events.forEach(e => { bal += e.amt; ca.push([M.fmtDate(e.d), KIND[e.kind] || e.kind, e.note, e.amt, bal]); });
    const wsC = XLSX.utils.aoa_to_sheet(ca); wsC['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    Object.keys(wsC).forEach(ref => { if (ref[0] !== '!' && wsC[ref].t === 'n') wsC[ref].z = '#,##0'; }); add('资金盘', wsC);
    // 全年
    const cols = M.annual(res, state.actuals);
    const an = [['指标'].concat(cols.map(c => M.monthLabel(c.month)))];
    let prevAvg = null;
    const growth = cols.map(c => { const a = c.plan.dailyAvg; const g = prevAvg && a ? a / prevAvg - 1 : null; prevAvg = a || null; return g; });
    const B = state.batches.map(b => M.batchInfo(b, P)).filter(b => b.ship != null && b.qty > 0).sort((a, b) => a.ship - b.ship);
    [['目标单量', c => c.plan.units], ['目标销售额 $', c => c.plan.sales], ['目标日均单量', c => c.plan.dailyAvg], ['目标增幅', (c, i) => growth[i]], ['目标广告花费 $', c => c.plan.ad], ['TACOS', c => c.plan.tacos],
      ['货值 $', c => c.plan.goods], ['头程 $', c => c.plan.freight], ['回款 $', c => c.plan.netByPay], ['目标利润率', c => c.plan.margin], ['目标利润 $', c => c.plan.profit],
      ['回款流覆盖三个月的货值头程', c => c.cover ? c.cover.status : ''], ['现金流利润覆盖未来三个月的货值头程', c => c.coverProfit ? c.coverProfit.status : ''], ['首批备货', (c, i) => i === 0 && B[0] ? B[0].qty : null]]
      .forEach(([l, f]) => an.push([l].concat(cols.map((c, i) => { const v = f(c, i); return ok(v) || typeof v === 'string' ? v : null; }))));
    ACT.forEach(([k, l]) => an.push([l].concat(cols.map(c => { const v = (state.actuals[c.month] || {})[k]; return ok(v) ? v : null; }))));
    ACT.forEach(([k, , , dl]) => an.push([dl].concat(cols.map(c => { const a = (state.actuals[c.month] || {})[k]; return ok(a) ? a - (c.plan[ACT_PLAN[k]] || 0) : null; }))));
    const wsA = XLSX.utils.aoa_to_sheet(an); wsA['!cols'] = [{ wch: 30 }].concat(cols.map(() => ({ wch: 12 })));
    an.forEach((row, r) => { const isPct = /增幅|TACOS|利润率/.test(row[0] || ''); for (let c = 1; c < row.length; c++) { const ref = XLSX.utils.encode_cell({ r, c }); if (wsA[ref] && wsA[ref].t === 'n') wsA[ref].z = isPct ? '0.0%' : '#,##0'; } });
    add('全年汇总表', wsA);
    // 方案对比（全部方案）
    const ps = allPlans(); let end = null;
    if (!P.horizonEnd) ps.forEach(x => { const e = calc(x).ledger.end; if (end == null || e > end) end = e; });
    const hz = end == null ? '' : M.fmtDate(end);
    const R = ps.map(x => ({ p: x, c: calc(x, hz).cmp }));
    const cm = [['', ...R.map(x => x.p.name + (x.p.kind === 'tool' ? '（工具出的）' : '（运营的）'))]];
    const rowc = (l, f) => cm.push([l].concat(R.map(x => f(x.c))));
    rowc('这批货货值 + 运费 ¥', c => c.batchCostCny); rowc('推广天数', c => c.days); rowc('实卖单量', c => c.units); rowc('销售额 $', c => c.sales); rowc('推广花费合计 $', c => c.ad); rowc('推广花费合计 ¥', c => c.adCny);
    rowc('TACOS', c => c.tacos); rowc('回款合计（已扣广告）$', c => c.net); rowc('回款合计（已扣广告）¥', c => c.netCny);
    (R[0] ? R[0].c.arrivals : []).forEach((a, i) => rowc(M.monthLabel(a.month) + '到账 ¥', c => c.arrivals[i] ? c.arrivals[i].amt : 0));
    rowc('利润（结算口径）$', c => c.profit); rowc('利润（结算口径）¥', c => c.profitCny); rowc('卖完 / 断货日', c => c.soldOut != null ? M.fmtDate(c.soldOut) : '没卖完，剩 ' + Math.round(c.stockEnd) + ' 套');
    rowc('账上最低现金 ¥', c => c.minBal); rowc('最低那天', c => M.fmtDate(c.minDate));
    rowc('15 号发薪够不够', c => c.fixedShort.length ? c.fixedShort.map(x => M.fmtDate(x.d) + ' 差 ' + Math.round(x.short)).join('；') : '都够');
    rowc('到期货款 / 头程那天够不够', c => c.dueShort.length ? c.dueShort.map(x => M.fmtDate(x.d) + ' 差 ' + Math.round(x.short)).join('；') : '够');
    rowc('期末现金 ¥（' + (hz || '各自') + '）', c => c.endBal);
    const wsM = XLSX.utils.aoa_to_sheet(cm); wsM['!cols'] = [{ wch: 26 }].concat(R.map(() => ({ wch: 20 })));
    cm.forEach((row, r) => { const isPct = row[0] === 'TACOS'; for (let c = 1; c < row.length; c++) { const ref = XLSX.utils.encode_cell({ r, c }); if (wsM[ref] && wsM[ref].t === 'n') wsM[ref].z = isPct ? '0.0%' : '#,##0'; } });
    add('方案对比', wsM);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const name = ('推广计划表_' + p.name + '_' + today()).replace(/[\\\/:*?"<>|\s]+/g, '_') + '.xlsx';
    saveFile(name, new Uint8Array(out), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }
  function exportCsv() {
    const p = curPlan(); if (!p) return; const res = calc(p);
    const lines = [COLS.map(c => c.l).join(',')].concat(res.rows.map(r => COLS.map(c => { const v = cellOf(c.t === 'stock' ? 'int' : c.t, r[c.k]); return v == null ? '' : '"' + String(v).replace(/"/g, '""') + '"'; }).join(',')));
    saveFile(('推广计划表_' + p.name + '_' + today()).replace(/[\\\/:*?"<>|\s]+/g, '_') + '.csv', '﻿' + lines.join('\n'), 'text/csv');
  }

  // 测试用
  window.__promo = { state: () => state, calc: id => calc(allPlans().find(p => p.id === id) || curPlan()), render };
  render();
})();
