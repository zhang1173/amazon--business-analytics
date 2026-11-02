(function () {
  'use strict';
  const PC = window.PromoCash, PRESETS = window.PRESETS;
  const STORE_KEY = 'ybei-promo-cash-v3';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d) => (v == null || isNaN(v)) ? '—' : (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const cny = (v, d) => (v == null || isNaN(v)) ? '—' : (v < 0 ? '−' : '') + '¥' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: d || 0 });
  const wan = v => (v == null || isNaN(v)) ? '—' : (v < 0 ? '−' : '') + '¥' + (Math.abs(v) / 10000).toLocaleString('en-US', { maximumFractionDigits: 1 }) + '万';
  const usd = (v, d) => (v == null || isNaN(v)) ? '—' : (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const pct = (v, d) => (v == null || isNaN(v)) ? '—' : (v * 100).toLocaleString('en-US', { maximumFractionDigits: d || 0 }) + '%';
  const pill = (ok, yes, no, cls) => `<span class="pill ${ok ? 'good' : (cls || 'bad')}">${esc(ok ? yes : no)}</span>`;
  const clone = x => JSON.parse(JSON.stringify(x));
  const md = s => (s || '').slice(5).replace('-', '/');
  function getP(o, path) { for (const k of path.split('.')) { if (o == null) return undefined; o = o[k]; } return o; }
  function setP(o, path, v) { const ks = path.split('.'); for (let i = 0; i < ks.length - 1; i++) { const k = ks[i]; if (o[k] == null) o[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[k]; } o[ks[ks.length - 1]] = v; }

  // ---------- 状态 ----------
  const state = { presetKey: null, input: null, levers: { pace: 1, coupon: null }, res: {}, gen: 0, busy: false, error: null, view: 'home', step: 0 };
  const presetKeys = Object.keys(PRESETS);
  function normalizeInput(inp, presetKey) {
    inp.cash = inp.cash || {};
    if (!inp.cash.team_expenses || !inp.cash.team_expenses.length) inp.cash.team_expenses = [{ name: '团队固定开支（人员 + 场地）', amount_cny: 0, pay_day: 15, start_month: inp.horizon.start_month, end_month: inp.horizon.end_month }];
    inp.cash.one_off_expenses = inp.cash.one_off_expenses || [];
    inp.matrix = inp.matrix || {};
    if (!inp.matrix.pace_list) inp.matrix.pace_list = [0.5, 0.75, 1, 1.5, 2];
    if (!inp.matrix.coupon_pcts) inp.matrix.coupon_pcts = [0, 0.2, 0.3];
    if (inp.matrix.coupon_usage == null) inp.matrix.coupon_usage = inp.promotion.default_coupon_usage ?? 0.8;
    inp.promotion.ads_payment = inp.promotion.ads_payment || { mode: 'daily', card_pay_day: 15, card_min_lag_days: 20 };
    if (!inp.release_distribution || !inp.release_distribution.length) inp.release_distribution = PRESETS[presetKey || presetKeys[0]].input.release_distribution;
    return inp;
  }
  function loadPreset(key) { state.presetKey = key; state.input = normalizeInput(clone(PRESETS[key].input), key); state.levers = { pace: 1, coupon: null }; }
  function restore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const o = JSON.parse(raw); if (o && o.input && o.input.promotion && o.input.cash && PRESETS[o.presetKey]) { state.presetKey = o.presetKey; state.input = normalizeInput(o.input, o.presetKey); state.levers = o.levers || { pace: 1, coupon: null }; return true; } }
    } catch (e) { /* 本地存储不可用 */ }
    return false;
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ presetKey: state.presetKey, input: state.input, levers: state.levers })); $('#saved').textContent = '已自动保存'; } catch (e) { $('#saved').textContent = ''; } }
  function effectiveInput() { const l = state.levers; if (Math.abs(l.pace - 1) < 1e-9 && l.coupon == null) return clone(state.input); return PC.applyVariant(state.input, l.coupon, l.pace, +(state.input.matrix.coupon_usage ?? 0.8)); }
  function currentCoupon() { return state.levers.coupon != null ? state.levers.coupon : ((state.input.promotion.phases[0] || {}).coupon_pct || 0); }

  // ---------- 输入项定义（分步） ----------
  const F = (path, label, o) => Object.assign({ path, label, type: 'number' }, o || {});
  const STEPS = [
    { id: 'cash', title: '钱和团队', lead: '现在手上有多少钱、每月要付多少给团队。', fields: [
      F('cash.opening_cash_cny', '现在手上现金', { unit: '元', step: 10000 }),
      F('cash.cash_floor_cny', '账上至少要留', { unit: '元', step: 10000, help: '低于这个数就算缺口，填 0 = 不能负' }),
      F('cash.team_expenses.0.amount_cny', '团队固定开支', { unit: '元/月', step: 1000, help: '人员 + 场地' }),
      F('cash.team_expenses.0.pay_day', '发薪日', { unit: '号', int: true, min: 1, max: 31 }),
    ], adv: [
      F('cash.team_expenses.0.start_month', '开支从哪个月起', { type: 'month' }),
      F('cash.team_expenses.0.end_month', '到哪个月', { type: 'month' }),
    ], extra: 'oneoff' },
    { id: 'goods', title: '货、账期、关税', lead: '首批货还剩多少、工厂什么时候要钱、关税多少。', fields: [
      F('inventory.shipments.0.remaining_qty', '首批还剩可卖', { unit: '件', int: true }),
      F('inventory.shipments.0.purchase_unit_cny', '首批采购单价', { unit: '元/件', step: 0.5 }),
      F('inventory.shipments.0.freight_unit_cny', '首批头程', { unit: '元/件', step: 0.5, help: '不含关税' }),
      F('inventory.shipments.0.ship_date', '首批出厂发货日', { type: 'date', help: '账期从这天起算' }),
      F('inventory.shipments.0.arrival_date', '首批到仓可售日', { type: 'date' }),
      F('inventory.shipments.0.purchase_months', '货款账期', { unit: '个月', int: true }),
      F('inventory.shipments.0.freight_days', '头程账期', { unit: '天', int: true }),
      F('inventory.shipments.0.purchase_payment', '首批货款', { type: 'select', options: [['terms', '按账期到期付'], ['paid', '已经付了'], ['unpaid', '不用付']] }),
      F('inventory.shipments.0.freight_payment', '首批头程费', { type: 'select', options: [['terms', '按账期到期付'], ['paid', '已经付了'], ['unpaid', '不用付']] }),
      F('product.tariff_rate', '关税', { unit: '%', pct: true, step: 1, help: '按采购价的比例，最优先向货代确认' }),
      F('inventory.tariff_paid_before_start', '首批关税已经付了', { type: 'bool' }),
      F('product.fx', '汇率', { unit: '元/美元', step: 0.01 }),
    ], adv: [
      F('product.tariff_usd_per_unit', '关税另加', { unit: '美元/件', step: 0.1 }),
      F('product.tariff_days_after_arrival', '关税付款时点', { unit: '天', int: true, min: -60, max: 180, help: '到货后几天付，负数 = 到货前' }),
      F('inventory.shipments.0.mode', '首批运输方式', { type: 'select', options: [['sea', '海运'], ['air', '空运']] }),
    ] },
    { id: 'replen', title: '补货', lead: '卖得快时自动按这些条件下单补货。', fields: [
      F('product.purchase_unit_cny', '补货采购单价', { unit: '元/件', step: 0.5 }),
      F('product.sea_freight_cny', '补货海运头程', { unit: '元/件', step: 0.5 }),
      F('replenishment.production_days', '工厂做货', { unit: '天', int: true }),
      F('replenishment.sea_days', '海运在途', { unit: '天', int: true }),
      F('replenishment.purchase_months', '补货货款账期', { unit: '个月', int: true }),
      F('replenishment.freight_days', '补货头程账期', { unit: '天', int: true }),
      F('replenishment.cover_days', '每次补多少天的量', { unit: '天', int: true }),
      F('replenishment.safety_days', '安全库存', { unit: '天', int: true }),
    ], adv: [
      F('replenishment.strategy', '补货方式', { type: 'select', options: [['sea', '海运'], ['air', '空运']] }),
      F('product.air_freight_cny', '空运头程', { unit: '元/件', step: 0.5 }),
      F('replenishment.air_days', '空运在途', { unit: '天', int: true }),
      F('replenishment.stop_ads_when_out_of_stock', '断货当天停广告', { type: 'bool' }),
    ] },
    { id: 'promo', title: '推广计划', lead: '分阶段填：卖多快（每天单量）、花多少（每天广告）、卖多久（起止日期）。', fields: [
      F('horizon.start_month', '预测从', { type: 'month' }),
      F('horizon.end_month', '预测到', { type: 'month', help: '推广阶段都要在这个区间里' }),
      F('promotion.ads_payment.mode', '广告怎么出钱', { type: 'select', options: [['daily', '花费当天出'], ['balance', '下个打款日从余额扣'], ['card', '信用卡还款日出']] }),
    ], adv: [
      F('promotion.ads_payment.card_pay_day', '信用卡还款日', { unit: '号', int: true, min: 1, max: 31 }),
      F('promotion.ads_payment.card_min_lag_days', '信用卡最短账期', { unit: '天', int: true }),
      F('horizon.payout_anchor', '亚马逊打款锚点日', { type: 'date', help: '任一打款日即可，每 14 天一次' }),
      F('horizon.bank_delay_days', '打款到账延迟', { unit: '天', int: true }),
    ], extra: 'phases' },
    { id: 'fees', title: '平台费用', lead: '亚马逊收的费和退货，默认按同事方案，可以不改。', fields: [
      F('product.fba_standard_usd', 'FBA 配送费', { unit: '美元/件', step: 0.01 }),
      F('product.storage_unit_usd_month', '仓储费', { unit: '美元/件/月', step: 0.01 }),
      F('product.refund_rate', '退货率', { unit: '%', pct: true, step: 1 }),
      F('product.sellable_rate', '退货里能再卖的', { unit: '%', pct: true, step: 5 }),
      F('product.return_fee_usd', '退货处理费', { unit: '美元/件', step: 0.1 }),
    ], adv: [
      F('product.fba_peak_usd', '旺季 FBA', { unit: '美元/件', step: 0.01, nullable: true, help: '留空 = 同平时' }),
      F('product.peak_start', '旺季从', { type: 'date', nullable: true }),
      F('product.peak_end', '旺季到', { type: 'date', nullable: true }),
      F('product.storage_peak_usd_month', '10–12 月仓储费', { unit: '美元/件/月', step: 0.01, nullable: true, help: '留空 = 同平时' }),
      F('product.refund_lag', '退款滞后', { unit: '天', int: true }),
      F('product.return_lag', '退货回库滞后', { unit: '天', int: true }),
      F('promotion.avg_stock_days', '每件账用的在库天数', { unit: '天', int: true }),
      F('promotion.coupon_fixed_fee_usd', 'Coupon 固定费', { unit: '美元/活动', step: 1 }),
      F('promotion.coupon_variable_rate', 'Coupon 变动费', { unit: '%', pct: true, step: 0.5 }),
      F('promotion.coupon_variable_cap_usd', 'Coupon 变动费封顶', { unit: '美元/活动', step: 100 }),
      F('promotion.coupon_fee_note', 'Coupon 费用来源', { type: 'text', help: '改了 coupon 费用时写来源' }),
      F('horizon.stress_days', '压力测试提前出账', { unit: '天', int: true }),
      F('matrix.pace_list', '对比用的节奏档', { type: 'list', help: '倍数，逗号分开' }),
      F('matrix.coupon_pcts', '对比用的 coupon 档', { type: 'list', pct: true, help: '%，逗号分开，0 = 不开' }),
      F('matrix.coupon_usage', 'coupon 使用率', { unit: '%', pct: true, step: 5 }),
    ] },
  ];
  const ONEOFF_COLS = [['name', '名目', 'text'], ['amount_cny', '金额（元）', 'number'], ['date', '日期', 'date']];

  // ---------- 推广阶段：显示 ↔ 存储 ----------
  function nDays(ph) { return Math.max(1, PC.toDay(ph.end) - PC.toDay(ph.start) + 1); }
  function perDayEnds(ph, key) {
    const pd = ph[key + '_per_day'], tot = ph[key + '_total'];
    if (pd != null) return Array.isArray(pd) ? [+pd[0], +pd[pd.length - 1]] : [+pd, +pd];
    if (tot != null) {
      const n = nDays(ph), shape = ph[key + '_shape'];
      if (!shape || n === 1) return [tot / n, tot / n];
      const s0 = +shape[0], s1 = +shape[shape.length - 1];
      let sw = 0; for (let i = 0; i < n; i++) sw += s0 + (s1 - s0) * i / (n - 1);
      return [tot * s0 / sw, tot * s1 / sw];
    }
    return null;
  }
  const mid = v => v == null ? null : (Array.isArray(v) ? (+v[0] + +v[v.length - 1]) / 2 : +v);
  function normalizePhase(ph) {
    for (const key of ['orders', 'ads']) { const ends = perDayEnds(ph, key); delete ph[key + '_total']; delete ph[key + '_shape']; if (ends) ph[key + '_per_day'] = ends; else delete ph[key + '_per_day']; }
    for (const k of ['cpc', 'cvr', 'ad_share']) if (Array.isArray(ph[k])) ph[k] = mid(ph[k]);
    ph._norm = true;
  }
  function setMode(ph) { const o = ph.orders_per_day != null, a = ph.ads_per_day != null; ph.mode = o && a ? 'both' : o ? 'orders' : 'ads'; }
  const PH_FIELDS = [['price_usd', '售价', '$'], ['coupon_pct', 'coupon', '%'], ['coupon_usage', '用券率', '%'], ['o0', '每天单量 从', '单'], ['o1', '到', '单'], ['a0', '每天广告 从', '$'], ['a1', '到', '$'], ['cpc', 'CPC', '$'], ['cvr', '转化率', '%'], ['ad_share', '广告单占比', '%']];
  function phaseCell(ph, key) {
    const o = perDayEnds(ph, 'orders'), a = perDayEnds(ph, 'ads'), r2 = v => v == null ? '' : Math.round(v * 100) / 100;
    switch (key) {
      case 'price_usd': return ph.price_usd; case 'coupon_pct': return r2((ph.coupon_pct || 0) * 100); case 'coupon_usage': return r2((ph.coupon_usage == null ? 0.8 : ph.coupon_usage) * 100);
      case 'o0': return o ? r2(o[0]) : ''; case 'o1': return o ? r2(o[1]) : ''; case 'a0': return a ? r2(a[0]) : ''; case 'a1': return a ? r2(a[1]) : '';
      case 'cpc': return ph.cpc == null ? '' : r2(mid(ph.cpc)); case 'cvr': return ph.cvr == null ? '' : r2(mid(ph.cvr) * 100); case 'ad_share': return ph.ad_share == null ? '' : r2(mid(ph.ad_share) * 100);
    }
    return '';
  }
  function phaseEdit(ph, key, raw) {
    if (!ph._norm) normalizePhase(ph);
    const v = raw === '' ? null : +raw;
    const setEnd = (k, i, val) => { const cur = ph[k + '_per_day'] ? ph[k + '_per_day'].slice() : [null, null]; cur[i] = val; if (cur[0] == null && cur[1] == null) delete ph[k + '_per_day']; else ph[k + '_per_day'] = [cur[0] == null ? cur[1] : cur[0], cur[1] == null ? cur[0] : cur[1]]; };
    switch (key) {
      case 'name': ph.name = raw; break;
      case 'start': case 'end': if (raw) ph[key] = raw; break;
      case 'price_usd': if (v != null) ph.price_usd = v; break;
      case 'coupon_pct': ph.coupon_pct = (v || 0) / 100; break;
      case 'coupon_usage': ph.coupon_usage = (v == null ? 80 : v) / 100; break;
      case 'o0': setEnd('orders', 0, v); break; case 'o1': setEnd('orders', 1, v); break; case 'a0': setEnd('ads', 0, v); break; case 'a1': setEnd('ads', 1, v); break;
      case 'cpc': if (v == null) delete ph.cpc; else ph.cpc = v; break;
      case 'cvr': if (v == null) delete ph.cvr; else ph.cvr = v / 100; break;
      case 'ad_share': if (v == null) delete ph.ad_share; else ph.ad_share = v / 100; break;
    }
    setMode(ph);
  }
  function phaseProblems(inp) {
    const out = [];
    const hs = PC.toDay(inp.horizon.start_month + '-01'), he = PC.toDay(inp.horizon.end_month + '-01');
    const phs = inp.promotion.phases || [];
    if (!phs.length) out.push('至少要有一个推广阶段。');
    const sorted = phs.map((p, i) => [p, i]).sort((x, y) => PC.toDay(x[0].start || '2000-01-01') - PC.toDay(y[0].start || '2000-01-01'));
    for (let j = 0; j < sorted.length; j++) {
      const [p, i] = sorted[j], nm = p.name || ('第 ' + (i + 1) + ' 个阶段');
      if (!p.start || !p.end) { out.push(nm + '：开始和结束日期要填。'); continue; }
      if (PC.toDay(p.start) > PC.toDay(p.end)) out.push(nm + '：开始日晚于结束日。');
      if (PC.toDay(p.start) < hs || PC.toDay(p.end) > he + 31) out.push(nm + '：超出预测区间 ' + inp.horizon.start_month + ' ~ ' + inp.horizon.end_month + '。');
      if (j > 0 && PC.toDay(p.start) <= PC.toDay(sorted[j - 1][0].end)) out.push(nm + '：和"' + (sorted[j - 1][0].name || '上一阶段') + '"日期重叠。');
      if (!(p.price_usd > 0)) out.push(nm + '：售价要大于 0。');
      const o = perDayEnds(p, 'orders'), a = perDayEnds(p, 'ads');
      if (!o && !a) out.push(nm + '：每天单量和每天广告至少填一个。');
      if ((!o || !a) && !(p.cpc > 0 && p.cvr > 0)) out.push(nm + '：只填了单量或广告其中一个，就需要 CPC 和转化率来算另一个。');
      if (!o && a && !(p.ad_share > 0)) out.push(nm + '：按广告预算反推单量需要广告单占比 > 0。');
      if (p.coupon_pct > 0 && (p.coupon_pct < 0.05 || p.coupon_pct > 0.5)) out.push(nm + '：coupon 只接受 5%~50%。');
    }
    return out;
  }

  // ---------- 输入区渲染 ----------
  function isChanged(path, v) { const base = PRESETS[state.presetKey] && getP(PRESETS[state.presetKey].input, path); return JSON.stringify(v == null ? null : v) !== JSON.stringify(base == null ? null : base); }
  function fieldHtml(f) {
    const v = getP(state.input, f.path);
    const cls = 'f' + (isChanged(f.path, v) ? ' changed' : '');
    const help = f.help ? `<span class="u">${esc(f.help)}</span>` : '';
    const label = `<span>${esc(f.label)}</span>`;
    if (f.type === 'select') return `<label class="${cls}">${label}<select data-path="${f.path}">${f.options.map(([val, lab]) => `<option value="${esc(val)}"${String(v) === String(val) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>${help}</label>`;
    if (f.type === 'bool') return `<label class="${cls} chk"><input type="checkbox" data-path="${f.path}" data-kind="bool"${v ? ' checked' : ''}><span>${esc(f.label)}</span></label>`;
    if (f.type === 'list') { const shown = (v || []).map(x => f.pct ? Math.round(x * 1000) / 10 : x).join(', '); return `<label class="${cls}">${label}<input type="text" data-path="${f.path}" data-kind="list${f.pct ? '-pct' : ''}" value="${esc(shown)}">${help}</label>`; }
    if (f.type === 'month' || f.type === 'date' || f.type === 'text') return `<label class="${cls}">${label}<input type="${f.type}" data-path="${f.path}" data-kind="${f.type}${f.nullable ? '-null' : ''}" value="${esc(v == null ? '' : v)}">${help}</label>`;
    const shown = v == null ? '' : (f.pct ? Math.round(v * 10000) / 100 : v);
    const inp = `<input type="number" inputmode="decimal" step="${f.step || (f.int ? 1 : 'any')}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''} data-path="${f.path}" data-kind="${f.pct ? 'pct' : f.int ? 'int' : 'num'}${f.nullable ? '-null' : ''}" value="${esc(shown)}">`;
    return `<label class="${cls}">${label}${f.unit ? `<span class="wrap-in">${inp}<span class="suffix">${esc(f.unit)}</span></span>` : inp}${help}</label>`;
  }
  function phasesHtml() {
    const phs = state.input.promotion.phases || [];
    const cell = (i, ph, k, l, u) => `<label class="f"><span>${esc(l)}</span><span class="wrap-in"><input type="number" inputmode="decimal" step="any" data-ph="${i}" data-key="${k}" value="${esc(phaseCell(ph, k))}"><span class="suffix">${esc(u)}</span></span></label>`;
    const grp = (i, ph, keys, cls) => `<div class="${cls}">${keys.map(k => { const f = PH_FIELDS.find(x => x[0] === k); return cell(i, ph, f[0], f[1], f[2]); }).join('')}</div>`;
    const cards = phs.map((ph, i) => `<div class="ph"><div class="hd"><input type="text" data-ph="${i}" data-key="name" value="${esc(ph.name || '')}" placeholder="阶段名"><button type="button" class="sm" data-act="del-ph" data-ph="${i}" title="删掉这个阶段">删除</button></div>
      <div class="dates"><input type="date" data-ph="${i}" data-key="start" value="${esc(ph.start || '')}"><span class="muted">→</span><input type="date" data-ph="${i}" data-key="end" value="${esc(ph.end || '')}"></div>
      <div class="rows">${grp(i, ph, ['price_usd', 'coupon_pct', 'coupon_usage'], 'r3')}${grp(i, ph, ['o0', 'o1'], 'r2')}${grp(i, ph, ['a0', 'a1'], 'r2')}${grp(i, ph, ['cpc', 'cvr', 'ad_share'], 'r3')}</div></div>`).join('');
    const probs = phaseProblems(state.input);
    return `${cards}<div class="rowbtns" style="margin-top:12px"><button type="button" class="sm" data-act="add-ph">＋ 加一个阶段</button><span class="muted xs">"每天单量"或"每天广告"留空一个，就用 CPC、转化率、广告单占比自动算另一个；"从…到…"是这一段里每天的量线性变化。</span></div>${probs.length ? `<div class="err">${probs.map(esc).join('<br>')}</div>` : ''}`;
  }
  function oneoffHtml() {
    const rows = state.input.cash.one_off_expenses || [];
    const body = rows.map((r, i) => '<tr>' + ONEOFF_COLS.map(([k, lab, t]) => `<td><input type="${t}" data-oo="${i}" data-key="${k}" value="${esc(r[k] == null ? '' : r[k])}" placeholder="${esc(lab)}"></td>`).join('') + `<td><button type="button" class="sm" data-act="del-oo" data-oo="${i}">删除</button></td></tr>`).join('');
    return `<details class="more"${rows.length ? ' open' : ''}><summary>一次性费用（样品、认证、Vine 等）${rows.length ? '：' + rows.length + ' 笔' : ''}</summary><div class="oo"><table><tbody>${body}</tbody></table></div><button type="button" class="sm" data-act="add-oo" style="margin-top:8px">＋ 加一笔</button></details>`;
  }
  function renderInputs() {
    const steps = STEPS.map((g, i) => `<button type="button" data-step="${i}" class="${i === state.step ? 'on' : ''}"><span class="n">${i + 1}</span>${esc(g.title)}</button>`).join('');
    const bodies = STEPS.map((g, i) => `<div class="step ${i === state.step ? 'on' : ''}" data-step="${i}"><div class="card"><div class="hd"><h2>${i + 1}. ${esc(g.title)}</h2></div><p class="lead">${esc(g.lead)}</p>
      ${g.fields.length ? `<div class="form">${g.fields.map(fieldHtml).join('')}</div>` : ''}
      ${g.extra === 'phases' ? `<div id="phases" style="margin-top:14px">${phasesHtml()}</div>` : ''}
      ${g.adv && g.adv.length ? `<details class="more"><summary>更多参数</summary><div class="form">${g.adv.map(fieldHtml).join('')}</div></details>` : ''}
      ${g.extra === 'oneoff' ? `<div id="oneoff">${oneoffHtml()}</div>` : ''}
      <div class="stepnav"><button type="button" data-act="prev" ${i === 0 ? 'disabled' : ''}>上一步</button>${i < STEPS.length - 1 ? `<button type="button" class="primary" data-act="next">下一步</button>` : `<button type="button" class="primary" data-act="finish">看方案</button>`}</div></div></div>`).join('');
    $('#view-inputs').innerHTML = `<div class="steps">${steps}</div>${bodies}`;
  }
  function showStep(i) { state.step = Math.max(0, Math.min(STEPS.length - 1, i)); $$('#view-inputs .steps button').forEach(b => b.classList.toggle('on', +b.dataset.step === state.step)); $$('#view-inputs .step').forEach(s => s.classList.toggle('on', +s.dataset.step === state.step)); window.scrollTo({ top: 0 }); }
  function refreshPhases() { const box = $('#phases'); if (box) box.innerHTML = phasesHtml(); }

  function onInput(e) {
    const el = e.target; if (!el || !el.dataset) return;
    if (el.dataset.ph != null && el.dataset.key) {
      const ph = state.input.promotion.phases[+el.dataset.ph]; if (!ph) return;
      phaseEdit(ph, el.dataset.key, el.value);
      if (e.type === 'change' && (el.dataset.key === 'start' || el.dataset.key === 'end')) refreshPhases();
      else { const probs = phaseProblems(state.input); const err = $('#phases .err'); if (probs.length) { if (err) err.innerHTML = probs.map(esc).join('<br>'); else $('#phases').insertAdjacentHTML('beforeend', `<div class="err">${probs.map(esc).join('<br>')}</div>`); } else if (err) err.remove(); }
      schedule(); return;
    }
    if (el.dataset.oo != null && el.dataset.key) { const r = state.input.cash.one_off_expenses[+el.dataset.oo]; if (!r) return; r[el.dataset.key] = el.dataset.key === 'amount_cny' ? +el.value : el.value; schedule(); return; }
    if (el.dataset.lever) { onLever(el); return; }
    const path = el.dataset.path; if (!path) return;
    const kind = el.dataset.kind || '';
    let v;
    if (el.tagName === 'SELECT') v = el.value;
    else if (kind === 'bool') v = el.checked;
    else if (kind.startsWith('list')) { v = el.value.split(/[,，\s]+/).filter(x => x !== '').map(Number).filter(x => !isNaN(x)); if (kind === 'list-pct') v = v.map(x => x / 100); }
    else if (kind.startsWith('month') || kind.startsWith('date') || kind.startsWith('text')) { v = el.value; if (v === '' && kind.endsWith('-null')) v = null; else if (v === '' && !kind.startsWith('text')) return; }
    else { if (el.value === '') { if (kind.endsWith('-null')) v = null; else return; } else { v = +el.value; if (isNaN(v)) return; if (kind.startsWith('pct')) v = v / 100; if (kind.startsWith('int')) v = Math.round(v); } }
    if (v === 'true') v = true; if (v === 'false') v = false;
    setP(state.input, path, v);
    if (path === 'scenario_name') { $('#scn-name').textContent = v; save(); return; }
    if (path === 'horizon.start_month' || path === 'horizon.end_month') { const t = state.input.cash.team_expenses[0]; if (t) { if (path === 'horizon.start_month' && t.start_month < v) t.start_month = v; if (path === 'horizon.end_month' && t.end_month > v) t.end_month = v; } refreshPhases(); }
    const lab = el.closest('.f'); if (lab) lab.classList.toggle('changed', isChanged(path, v));
    if (path === 'product.tariff_rate') syncLeverUI();
    schedule();
  }
  function onClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.view) { setView(b.dataset.view); return; }
    if (b.dataset.step != null && b.closest('.steps')) { showStep(+b.dataset.step); return; }
    if (act === 'prev') showStep(state.step - 1);
    else if (act === 'next') showStep(state.step + 1);
    else if (act === 'finish') setView('home');
    else if (act === 'go-inputs') { setView('inputs'); showStep(+(b.dataset.step || 0)); }
    else if (act === 'add-ph') {
      const phs = state.input.promotion.phases; const lastPh = phs[phs.length - 1];
      const startD = lastPh ? PC.toDay(lastPh.end) + 1 : PC.toDay(state.input.horizon.start_month + '-01');
      const endD = Math.min(startD + 29, PC.toDay(state.input.horizon.end_month + '-01') + 27);
      const np = { name: '阶段 ' + (phs.length + 1), start: PC.toISO(startD), end: PC.toISO(Math.max(startD, endD)), mode: 'orders', price_usd: lastPh ? +lastPh.price_usd : 24.83, coupon_pct: lastPh ? (lastPh.coupon_pct || 0) : 0, coupon_usage: lastPh ? (lastPh.coupon_usage ?? 0.8) : 0.8, cpc: lastPh ? (mid(lastPh.cpc) ?? 3.4) : 3.4, cvr: lastPh ? (mid(lastPh.cvr) ?? 0.12) : 0.12, ad_share: lastPh ? (mid(lastPh.ad_share) ?? 0.6) : 0.6, _norm: true };
      const o = lastPh ? perDayEnds(lastPh, 'orders') : null; np.orders_per_day = o ? [o[1], o[1]] : [50, 50];
      const a = lastPh ? perDayEnds(lastPh, 'ads') : null; if (a) { np.ads_per_day = [a[1], a[1]]; np.mode = 'both'; }
      phs.push(np); refreshPhases(); schedule();
    } else if (act === 'del-ph') { state.input.promotion.phases.splice(+b.dataset.ph, 1); refreshPhases(); schedule(); }
    else if (act === 'add-oo') { state.input.cash.one_off_expenses.push({ name: '', amount_cny: 0, date: state.input.horizon.start_month + '-15' }); $('#oneoff').innerHTML = oneoffHtml(); }
    else if (act === 'del-oo') { state.input.cash.one_off_expenses.splice(+b.dataset.oo, 1); $('#oneoff').innerHTML = oneoffHtml(); schedule(); }
    else if (act === 'adopt') { const rec = state.res.rec; if (rec && rec.best) { state.levers = { pace: rec.best.pace_k, coupon: rec.best.coupon_pct }; syncLeverUI(); schedule(); toast('已把推荐方案调到杠杆上'); setView('home'); } }
    else if (act === 'reset-levers') { state.levers = { pace: 1, coupon: null }; syncLeverUI(); schedule(); }
    else if (act === 'coupon') { state.levers.coupon = b.dataset.val === 'base' ? null : +b.dataset.val; syncLeverUI(); schedule(); }
    else if (act === 'copy-sum') copyText(summaryText());
    else if (act === 'reset-all') { try { localStorage.removeItem(STORE_KEY); } catch (err) { } loadPreset($('#preset') ? $('#preset').value : presetKeys[0]); renderInputs(); renderSettings(); $('#scn-name').textContent = state.input.scenario_name || ''; schedule(); toast('已恢复默认'); }
    else if (act === 'io-copy') copyText($('#io-text').value);
    else if (act === 'io-apply') { try { importJson($('#io-text').value); $('#io-msg').textContent = '已导入'; toast('已导入参数'); } catch (err) { $('#io-msg').textContent = '导入失败：' + (err.message || err); } }
    else if (act === 'io-refresh') { $('#io-text').value = exportJson(); }
  }
  function onLever(el) {
    if (el.dataset.lever === 'pace') { state.levers.pace = Math.round(+el.value * 100) / 100; $('#lv-pace').textContent = '×' + state.levers.pace; }
    else if (el.dataset.lever === 'tariff') { setP(state.input, 'product.tariff_rate', Math.round(+el.value) / 100); $('#lv-tariff').textContent = pct(state.input.product.tariff_rate); const f = $('#view-inputs input[data-path="product.tariff_rate"]'); if (f) { f.value = Math.round(+el.value); const lab = f.closest('.f'); if (lab) lab.classList.toggle('changed', isChanged('product.tariff_rate', state.input.product.tariff_rate)); } }
    schedule();
  }
  function syncLeverUI() {
    const p = $('#lever-pace'); if (!p) return;
    p.value = state.levers.pace; $('#lv-pace').textContent = '×' + state.levers.pace;
    const t = $('#lever-tariff'); t.value = Math.round((state.input.product.tariff_rate || 0) * 100); $('#lv-tariff').textContent = pct(state.input.product.tariff_rate || 0);
    $$('#coupon-seg button').forEach(b => b.classList.toggle('on', b.dataset.val === (state.levers.coupon == null ? 'base' : String(state.levers.coupon))));
  }

  // ---------- 计算（Worker，失败则主线程） ----------
  const GLUE = `
self.onmessage=function(e){var m=e.data,PC=self.PromoCash,g=m.gen,base=m.base,eff=m.eff,own=null;
try{own=PC.runScenario(eff);self.postMessage({gen:g,part:'main',ok:true,data:slim(own)})}catch(err){self.postMessage({gen:g,part:'main',ok:false,error:String(err&&err.message||err)});return}
try{var rec=PC.recommend(base,null);rec.needs=PC.needsFor(eff,own);rec.own_feasible=PC.feasible(own.summary,+(eff.cash.cash_floor_cny||0));self.postMessage({gen:g,part:'recommend',ok:true,data:rec})}catch(err){self.postMessage({gen:g,part:'recommend',ok:false,error:String(err&&err.message||err)})}
try{self.postMessage({gen:g,part:'sweep',ok:true,data:PC.sensitivity(eff,'product.tariff_rate',[0,.1,.2,.35,.45,.55])})}catch(err){self.postMessage({gen:g,part:'sweep',ok:false,error:String(err&&err.message||err)})}};
function slim(o){return {summary:o.summary,ledger:o.ledger.map(function(r){return [r.date,r.balance]}),factory:o.factory,monthly:o.monthly,weeks:o.weeks,replenishment:o.replenishment,phases:o.phases,reverse:o.reverse,warnings:o.warnings,flags:o.flags,ads_stopped:o.ads_stopped_for_stockout_usd,daily:o.engine_result.daily.map(function(r){return [r.date,r.closing,r.lost_qty,r.sold,r.ads_usd]})}}`;
  let worker = null;
  function makeWorker() {
    try { const w = new Worker(URL.createObjectURL(new Blob([$('#model-script').textContent + '\n' + GLUE], { type: 'text/javascript' }))); w.onmessage = e => handle(e.data); w.onerror = () => { worker = null; computeInline(state.gen); }; return w; } catch (e) { return null; }
  }
  function slimInline(o) { return { summary: o.summary, ledger: o.ledger.map(r => [r.date, r.balance]), factory: o.factory, monthly: o.monthly, weeks: o.weeks, replenishment: o.replenishment, phases: o.phases, reverse: o.reverse, warnings: o.warnings, flags: o.flags, ads_stopped: o.ads_stopped_for_stockout_usd, daily: o.engine_result.daily.map(r => [r.date, r.closing, r.lost_qty, r.sold, r.ads_usd]) }; }
  function computeInline(g) {
    const base = clone(state.input), eff = effectiveInput(); let own = null;
    try { own = PC.runScenario(eff); handle({ gen: g, part: 'main', ok: true, data: slimInline(own) }); } catch (err) { handle({ gen: g, part: 'main', ok: false, error: String(err && err.message || err) }); return; }
    setTimeout(() => { if (g !== state.gen) return; try { const rec = PC.recommend(base, null); rec.needs = PC.needsFor(eff, own); rec.own_feasible = PC.feasible(own.summary, +(eff.cash.cash_floor_cny || 0)); handle({ gen: g, part: 'recommend', ok: true, data: rec }); } catch (err) { handle({ gen: g, part: 'recommend', ok: false, error: String(err && err.message || err) }); }
      setTimeout(() => { if (g !== state.gen) return; try { handle({ gen: g, part: 'sweep', ok: true, data: PC.sensitivity(eff, 'product.tariff_rate', [0, .1, .2, .35, .45, .55]) }); } catch (err) { handle({ gen: g, part: 'sweep', ok: false, error: String(err && err.message || err) }); } }, 30); }, 30);
  }
  let timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(compute, 300); }
  function compute() {
    save();
    const probs = phaseProblems(state.input);
    if (probs.length) { state.error = probs[0]; state.busy = false; renderStatus(); return; }
    state.gen++; state.busy = true; state.error = null; state.res.rec = null; state.res.recError = null; state.res.sweep = null; renderStatus();
    if (worker === null) worker = makeWorker();
    if (worker) worker.postMessage({ gen: state.gen, base: state.input, eff: effectiveInput() }); else computeInline(state.gen);
  }
  function handle(msg) {
    if (msg.gen !== state.gen) return;
    if (msg.part === 'main') { if (!msg.ok) { state.busy = false; state.error = msg.error; renderStatus(); return; } state.res.main = msg.data; renderHome(); renderDetail(); renderCompare(); }
    else if (msg.part === 'recommend') { state.res.rec = msg.ok ? msg.data : null; state.res.recError = msg.ok ? null : msg.error; renderVerdict(); renderCompare(); }
    else if (msg.part === 'sweep') { state.busy = false; state.res.sweep = msg.ok ? msg.data : null; renderCompare(); renderStatus(); }
  }
  function renderStatus() {
    $('#progress').classList.toggle('on', state.busy);
    const st = $('#status'); if (!st) return;
    if (state.error) st.innerHTML = `<div class="err">算不出：${esc(state.error)}${state.res.main ? '　下面是上一次能算的结果。' : ''} <button type="button" class="sm" data-act="go-inputs" data-step="3">去改推广计划</button></div>`;
    else st.innerHTML = '';
  }

  // ---------- 总览 ----------
  function renderHome() {
    const m = state.res.main; const v = $('#view-home');
    if (!m) { v.innerHTML = '<div id="status"></div><div class="card hero-empty">计算中…</div>'; renderStatus(); return; }
    const s = m.summary, floor = s.cash_floor_cny;
    const nOk = m.factory.filter(f => f.ok).length;
    const kpi = (l, val, sub, cls) => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls || ''}">${val}</div><div class="s">${sub}</div></div>`;
    const kpis = [
      kpi('最低余额', cny(s.min_balance_cny), s.min_balance_date, s.min_balance_cny < floor ? 'neg' : 'pos'),
      kpi('期末余额', cny(s.ending_balance_cny), `${s.ending_date}，另有库存约 ${cny(s.ending_stock_value_cny)}`, s.ending_balance_cny < floor ? 'neg' : ''),
      kpi('到期付款够的笔数', `${nOk}/${m.factory.length}`, s.factory_all_ok ? '货款、头程、关税每笔都够' : `最多要垫 ${cny(s.factory_gap_max_cny)}`, s.factory_all_ok ? 'pos' : 'neg'),
      kpi('可额外拨给团队', cny(s.allocatable_total_cny), `团队 ${cny(s.team_total_cny)} 已计入`),
      kpi('广告合计', usd(s.ads_total_usd), `每件 ${usd(s.ad_per_unit_planned_usd, 2)}，上限 ${usd(s.ad_cap_weighted_usd, 2)}`, s.ad_within_cap ? '' : 'neg'),
      kpi('首笔回款', s.first_receipt_date ? md(s.first_receipt_date) : '—', `${cny(s.first_receipt_cny)}；合计到账 ${cny(s.platform_receipts_cny)}`),
    ].join('');
    const cpts = (state.input.matrix.coupon_pcts || [0, .2, .3]);
    const segs = [['base', '按阶段表']].concat(cpts.map(c => [String(c), c > 0 ? pct(c) : '不开'])).map(([val, lab]) => `<button type="button" data-act="coupon" data-val="${val}" class="${val === (state.levers.coupon == null ? 'base' : String(state.levers.coupon)) ? 'on' : ''}">${lab}</button>`).join('');
    v.innerHTML = `<div id="status"></div><div class="card verdict" id="verdict"></div>
      <div class="card"><div class="hd"><h2>三个杠杆</h2><button type="button" class="sm ghost" data-act="reset-levers">复位</button></div>
        <div class="levers">
          <div class="lever"><div class="l"><span>推广节奏（每天单量和广告同比例）</span><b id="lv-pace">×${state.levers.pace}</b></div><input type="range" id="lever-pace" data-lever="pace" min="0.25" max="2" step="0.05" value="${state.levers.pace}"></div>
          <div class="lever"><div class="l"><span>coupon</span></div><div class="seg" id="coupon-seg">${segs}</div></div>
          <div class="lever"><div class="l"><span>关税（按采购价）</span><b id="lv-tariff">${pct(state.input.product.tariff_rate || 0)}</b></div><input type="range" id="lever-tariff" data-lever="tariff" min="0" max="60" step="1" value="${Math.round((state.input.product.tariff_rate || 0) * 100)}"></div>
        </div></div>
      <div class="kpis" style="margin-top:14px">${kpis}</div>
      <div class="grid two" style="margin-top:14px"><div class="card"><figure class="chart" id="c1"></figure></div><div class="card"><figure class="chart" id="c2"></figure></div></div>
      <div class="card"><div class="hd"><h2>六个问题</h2></div><div class="qa" id="six"></div></div>`;
    renderVerdict(); renderSix(m); renderCharts(m); renderStatus();
  }
  function renderVerdict() {
    const box = $('#verdict'); const m = state.res.main; if (!box || !m) return;
    const s = m.summary, floor = s.cash_floor_cny, rec = state.res.rec;
    const ownOk = s.factory_all_ok && s.min_balance_cny >= floor - 1e-9;
    const lv = state.levers; const leverTxt = (Math.abs(lv.pace - 1) > 1e-9 || lv.coupon != null) ? `（当前杠杆：节奏 ×${lv.pace}${lv.coupon == null ? '' : lv.coupon > 0 ? '、coupon ' + pct(lv.coupon) : '、不开 coupon'}）` : '';
    box.className = 'card verdict ' + (ownOk ? 'ok' : 'no');
    let html = `<div class="big">${ownOk ? '这个方案走得通' : '这个方案走不通'} ${pill(ownOk, '工厂每笔都够、全程不穿底', '最紧时要垫 ' + cny(s.peak_funding_cny))}</div>
      <div class="sum">${s.promo_window ? `推广 ${s.promo_window[0]} 至 ${s.promo_window[1]}（${s.promo_window[2]} 天），卖 ${num(s.sold_total)} 件，广告 ${usd(s.ads_total_usd)}；首笔回款 ${s.first_receipt_date || '—'}，推广期最低 ${cny(s.promo_low_cny)}（${s.promo_low_date}），付完货款后 ${cny(s.ending_balance_cny)}。` : '没有推广阶段。'}${leverTxt}</div>`;
    if (!s.ad_within_cap && m.phases.length) { const p = m.phases[0]; html += `<div class="capwarn">每件广告 ${usd(s.ad_per_unit_planned_usd, 2)} 超过上限 ${usd(s.ad_cap_weighted_usd, 2)}：售价 ${usd(p.price, 2)} 一件平台净回款 ${usd(p.platform_net, 2)}，减货值头程关税 ${usd(p.landed_usd, 2)}（其中关税 ${usd(p.tariff_usd, 2)}）和仓储 ${usd(p.storage, 2)}，扣广告前只剩 ${usd(p.remainder_before_ads, 2)}。卖得越多亏得越多：先把关税问清楚，若关税属实，要么提价、要么把每件广告压到上限内。</div>`; }
    if (rec && rec.needs) { const n = rec.needs, items = [`现金再多 <b>${cny(n.cash_more_cny)}</b>（${cny(s.opening_cash_cny)} → ${cny(s.opening_cash_cny + n.cash_more_cny)}）`]; if (n.tariff_rate_max != null) items.push(`或关税不超过 <b>${pct(n.tariff_rate_max, 1)}</b>（现在 ${pct(state.input.product.tariff_rate || 0)}）`); else if ((state.input.product.tariff_rate || 0) > 0) items.push('关税就算是 0 也不够'); if (n.team_monthly_max != null) items.push(`或团队开支压到 <b>${cny(n.team_monthly_max)}</b>/月以内（现在 ${cny(getP(state.input, 'cash.team_expenses.0.amount_cny'))}）`); else if ((getP(state.input, 'cash.team_expenses.0.amount_cny') || 0) > 0) items.push('团队开支就算是 0 也不够'); html += `<div class="needs"><b>要走得通，其他不动的话：</b>${items.map(x => '<div>· ' + x + '</div>').join('')}</div>`; }
    if (!rec) html += `<div class="muted small">${state.res.recError ? '推荐方案算不出：' + esc(state.res.recError) : '正在比较各种节奏和 coupon…'}</div>`;
    else if (rec.best) {
      const b = rec.best; const same = Math.abs(b.pace_k - lv.pace) < 1e-9 && Math.abs((b.coupon_pct || 0) - currentCoupon()) < 1e-9;
      const label = `节奏 ×${b.pace_k}${b.coupon_pct > 0 ? '、coupon ' + pct(b.coupon_pct) : '、不开 coupon'}`;
      html += `<div class="act">${rec.mode === 'feasible' ? `<span class="pill good">推荐</span> <span>${esc(label)}：${rec.feasible_count} 个可行组合里期末最好（${cny(b.ending_balance_cny)} + 库存约 ${cny(b.ending_stock_value_cny)}）</span>` : `<span class="pill warn">没有可行组合</span> <span>最少要垫钱的是 ${esc(label)}：垫 ${cny(b.peak_funding_cny)}</span>`}${same ? ' <span class="pill info">就是当前</span>' : ` <button type="button" class="primary sm" data-act="adopt">用这个</button>`} <button type="button" class="sm" data-view="compare">看全部对比</button></div>`;
      if (!s.ad_within_cap) html += `<div class="muted xs">现在每件扣完广告是亏的，推荐只会往"少卖"走；先把关税、售价、每件广告定下来再比节奏才有意义。</div>`;
    }
    box.innerHTML = html;
  }
  function renderSix(m) {
    const s = m.summary, floor = s.cash_floor_cny;
    const peakMonth = m.monthly.length ? m.monthly.reduce((a, b) => b.platform_in_cny > a.platform_in_cny ? b : a) : null;
    const covered = m.monthly.filter(x => x.team_covered === true).map(x => x.month);
    const allocMonths = m.monthly.filter(x => x.allocatable_cny > 0.5);
    const ph0 = m.phases[0]; const perUnit = ph0 ? ph0.remainder_before_ads - (s.ad_per_unit_planned_usd || 0) : null;
    const rows = [
      ['推多快、推多久？', s.promo_window ? `<b>${s.promo_window[2]} 天</b>，${s.promo_window[0]} 至 ${s.promo_window[1]}，计划卖 ${num(s.planned_total)} 件，实际卖出 ${num(s.sold_total)} 件，补货 ${m.replenishment.length} 批` : '没有推广阶段', pill(!s.stockout_first, '不断货', `${s.stockout_first || ''} 起断货、丢单 ${num(s.lost_total)} 件`)],
      ['广告花多少？每件赚不赚？', `广告 <b>${usd(s.ads_total_usd)}</b>（约 ${cny(s.ads_total_cny)}），每件 ${usd(s.ad_per_unit_planned_usd, 2)}；每件上限 ${usd(s.ad_cap_weighted_usd, 2)}（不计退货回库 ${usd(s.ad_cap_weighted_no_credit_usd, 2)}）` + (perUnit != null ? `；扣完广告每件${perUnit >= 0 ? '剩' : '亏'} ${usd(Math.abs(perUnit), 2)}` : ''), pill(s.ad_within_cap, '在上限内', '超过每件上限')],
      ['什么时候回款？', `首笔 <b>${s.first_receipt_date || '—'}</b>（${cny(s.first_receipt_cny)}）；回款最多的月份 ${peakMonth ? peakMonth.month + '（' + cny(peakMonth.platform_in_cny) + '）' : '—'}；合计到账 ${cny(s.platform_receipts_cny)}`, '<span class="pill info">按 14 天打款日历</span>'],
      ['现金什么时候最紧？', `推广期低点 <b>${cny(s.promo_low_cny)}</b>（${s.promo_low_date}）；全程最低 ${cny(s.min_balance_cny)}（${s.min_balance_date}）；期末 ${cny(s.ending_balance_cny)}，还有 ${num(s.ending_stock)} 件库存约 ${cny(s.ending_stock_value_cny)} 没变现` + (s.days_below_floor ? `；低于底线 ${s.days_below_floor} 天，首次 ${s.first_below_floor_date}` : ''), pill(s.min_balance_cny >= floor - 1e-9, '全程不穿底', `要垫 ${cny(s.peak_funding_cny)}`)],
      ['货款、头程、关税付得清吗？', `<b>${m.factory.filter(f => f.ok).length} / ${m.factory.length} 笔</b>够；货款头程合计 ${cny(s.factory_payments_cny)}，关税 ${cny(s.tariff_total_cny)}` + (s.factory_all_ok ? '' : `；最多要垫 ${cny(s.factory_gap_max_cny)}（${s.factory_gap_max_date}）`), pill(s.factory_all_ok, '每笔都够', '有到期日不够')],
      ['团队养得起吗？', `可额外拨 <b>${cny(s.allocatable_total_cny)}</b>；团队开支 ${cny(s.team_total_cny)} 已计入；` + (covered.length ? `经营贡献够付当月开支的月份：${covered.join('、')}` : '没有一个月的经营贡献够付当月开支') + (allocMonths.length ? `；可额外拨：${allocMonths.map(x => x.month + ' ' + cny(x.allocatable_cny)).join('、')}` : ''), pill(s.ending_balance_cny >= floor - 1e-9 && s.factory_all_ok, '开支能覆盖', '按现参数不能')],
    ];
    $('#six').innerHTML = rows.map(([q, a, p], i) => `<div class="row"><div class="n">${i + 1}</div><div><div class="q">${esc(q)} ${p}</div><div class="a">${a}</div></div></div>`).join('');
  }
  function renderCharts(m) {
    const s = m.summary; const shade = []; let cur = null, lastD = null;
    for (const [d, , lost] of m.daily) { if (lost > 1e-9) { cur = cur || d; lastD = d; } else if (cur) { shade.push([cur, lastD]); cur = null; } }
    if (cur) shade.push([cur, lastD]);
    const c1 = $('#c1'), c2 = $('#c2'); if (!c1 || !c2) return;
    lineChart(c1, m.ledger, { caption: '账上余额（元，含团队开支）· 虚线 = 货款 / 头程 / 关税到期 · 红线 = 底线 · 红色阴影 = 断货', fmt: v => cny(v), markers: m.factory.map(f => [f.date, (f.kind === 'purchase' ? '货款 ' : f.kind === 'freight' ? '头程 ' : '关税 ') + wan(f.amount_cny).replace('¥', ''), f.kind, f.amount_cny]), shade, floor: s.cash_floor_cny, zero: true });
    lineChart(c2, m.daily.map(r => [r[0], r[1]]), { caption: '可售库存（件）· 虚线 = 补货到仓', fmt: v => num(v), markers: m.replenishment.map(b => [b.arrival_date, '到货 ' + num(b.qty), 'freight', b.qty]), shade, zero: false });
  }

  // ---------- 方案对比 ----------
  function renderCompare() {
    const v = $('#view-compare'); const rec = state.res.rec, m = state.res.main, sw = state.res.sweep;
    if (!m) { v.innerHTML = '<div class="card hero-empty">计算中…</div>'; return; }
    const cls = x => (x || 0) < 0 ? 'neg' : '';
    let mx = '';
    if (!rec) mx = `<p class="muted small">${state.res.recError ? '算不出：' + esc(state.res.recError) : '正在比较各种节奏和 coupon…'}</p>`;
    else {
      const curC = currentCoupon();
      const rows = rec.rows.map(r => {
        if (!r.ok) return [pct(r.coupon_pct), r.pace, `<span class="pill bad">算不出：${esc(r.error || '')}</span>`, '—', '—', '—', '—', '—', '—', '—'];
        const x = [r.coupon_pct > 0 ? pct(r.coupon_pct) : '不开', r.pace, usd(r.ads_total_usd), num(r.sold_total) + (r.lost_total > 0 ? ` <span class="pill warn">丢 ${num(r.lost_total)}</span>` : ''), `${usd(r.ad_per_unit_planned_usd, 2)} / ${usd(r.ad_cap_weighted_usd, 2)}`, `<td class="${cls(r.min_balance_cny)}">${cny(r.min_balance_cny)}<br><span class="muted xs">${r.min_balance_date}</span>`, pill(r.factory_all_ok, '都够', '最多垫 ' + cny(r.factory_gap_max_cny)), `<td class="${cls(r.ending_balance_cny)}">${cny(r.ending_balance_cny)}`, cny(r.ending_stock_value_cny), cny(r.allocatable_total_cny)];
        x._cls = (rec.best && r === rec.best ? 'best ' : '') + (Math.abs(r.pace_k - state.levers.pace) < 1e-9 && Math.abs(r.coupon_pct - curC) < 1e-9 ? 'cur' : '');
        return x;
      });
      mx = `<p class="lead">节奏 = 把你填的每天单量和广告同比例缩放；coupon 用券率按"平台费用 → 更多参数"。高亮行 = 推荐，加粗行 = 当前杠杆。</p>` + table(['coupon', '节奏', '广告合计', '卖出', '每件广告 / 上限', '最低余额', '到期付款', '期末余额', '期末库存货值', '可额外拨'], rows);
    }
    let sweep = '';
    if (!sw) sweep = '<p class="muted small">计算中…</p>';
    else { const cur = +(state.input.product.tariff_rate || 0); sweep = `<p class="lead">其余参数不动，只改关税（按采购价比例）。</p>` + table(['关税', '关税合计', '每件广告上限', '最低余额', '到期付款', '期末余额', '经营贡献'], sw.map(r => r.ok ? [pct(r.value) + (Math.abs(r.value - cur) < 1e-9 ? ' <span class="pill info">现在</span>' : ''), cny(r.tariff_total_cny), `${usd(r.ad_cap_weighted_usd, 2)} ` + pill(r.ad_within_cap, '计划在内', '超上限'), `<td class="${cls(r.min_balance_cny)}">${cny(r.min_balance_cny)}<br><span class="muted xs">${r.min_balance_date}</span>`, pill(r.factory_all_ok, '都够', '最多垫 ' + cny(r.factory_gap_max_cny)), `<td class="${cls(r.ending_balance_cny)}">${cny(r.ending_balance_cny)}`, `<td class="${cls(r.total_contribution_cny)}">${cny(r.total_contribution_cny)}`] : [pct(r.value), '<span class="pill bad">算不出</span>', '—', '—', '—', '—', '—'])); }
    const b = rec && rec.best;
    const same = b && Math.abs(b.pace_k - state.levers.pace) < 1e-9 && Math.abs((b.coupon_pct || 0) - currentCoupon()) < 1e-9;
    v.innerHTML = `<div class="card"><div class="hd"><h2>推荐</h2>${b && !same ? '<button type="button" class="primary sm" data-act="adopt">用这个方案</button>' : ''}</div>
      ${b ? `<p>${rec.mode === 'feasible' ? `<span class="pill good">可行</span> 节奏 ×${b.pace_k}${b.coupon_pct > 0 ? '、coupon ' + pct(b.coupon_pct) : '、不开 coupon'}：${rec.feasible_count} 个可行组合里期末最好。最低 ${cny(b.min_balance_cny)}（${b.min_balance_date}），期末 ${cny(b.ending_balance_cny)} + 库存约 ${cny(b.ending_stock_value_cny)}，广告 ${usd(b.ads_total_usd)}，卖 ${num(b.sold_total)} 件，可额外拨 ${cny(b.allocatable_total_cny)}。` : `<span class="pill warn">没有可行组合</span> 最少要垫钱的是节奏 ×${b.pace_k}${b.coupon_pct > 0 ? '、coupon ' + pct(b.coupon_pct) : '、不开 coupon'}：垫 ${cny(b.peak_funding_cny)}（${b.min_balance_date}），期末 ${cny(b.ending_balance_cny)} + 库存约 ${cny(b.ending_stock_value_cny)}，广告 ${usd(b.ads_total_usd)}，卖 ${num(b.sold_total)} 件。`}${same ? ' <span class="pill info">就是当前</span>' : ''}</p>` : `<p class="muted small">${rec ? '没有一个组合能算出来。' : '计算中…'}</p>`}
      <p class="muted xs" style="margin-top:8px">规则：在 coupon 档 × 节奏档里找"货款头程关税每笔都够付 + 全程不低于底线"的组合，按"期末余额 + 期末库存货值"取最好；都不可行时取最少要垫的。</p></div>
      <div class="card"><div class="hd"><h2>各种节奏 × coupon</h2></div>${mx}</div>
      <div class="card"><div class="hd"><h2>关税敏感性</h2></div>${sweep}</div>`;
  }

  // ---------- 明细 ----------
  function renderDetail() {
    const v = $('#view-detail'); const m = state.res.main; if (!m) { v.innerHTML = '<div class="card hero-empty">计算中…</div>'; return; }
    const cls = x => (x || 0) < 0 ? 'neg' : '';
    const mrows = m.monthly.map(x => [x.month, num(x.sold), num(x.lost), usd(x.revenue_usd), usd(x.ads_usd), cny(x.platform_in_cny), `<td class="${cls(x.ads_cny)}">${cny(x.ads_cny)}`, `<td class="${cls(x.factory_cny + x.tariff_cny)}">${cny(x.factory_cny + x.tariff_cny)}`, `<td class="${cls(x.team_cny)}">${cny(x.team_cny)}`, `<td class="${cls(x.end_balance)}">${cny(x.end_balance)}`, `<td class="${cls(x.min_balance)}">${cny(x.min_balance)}`, cny(x.payable_cny), `<td class="${cls(x.contribution_cny)}">${cny(x.contribution_cny)}`, cny(x.allocatable_cny)]);
    const frows = m.factory.map(f => [f.date, { purchase: '货款', freight: '头程', tariff: '关税' }[f.kind], esc(f.ref), cny(f.amount_cny), `<td class="${cls(f.balance_after)}">${cny(f.balance_after)}`, cny(f.gap), pill(f.ok, '够', '不够')]);
    const prows = m.phases.map(p => [esc(p.name), `${p.start}~${p.end.slice(5)}`, usd(p.price, 2), pct(p.coupon_pct), usd(p.avg_price, 2), usd(p.commission, 2), usd(p.fba, 2), usd(p.refund + p.return_fee, 2), usd(p.coupon_fee, 2), usd(p.storage, 2), usd(p.platform_net, 2), usd(p.landed_usd, 2), usd(p.sellable_credit, 2), `<td class="${cls(p.remainder_before_ads)}">${usd(p.remainder_before_ads, 2)}`, `<b>${usd(p.ad_cap_per_unit, 2)}</b>`, usd(p.ad_cap_no_credit, 2), usd(p.ad_per_unit, 2), pill(p.within_cap, '在上限内', '超上限')]);
    const rrows = m.replenishment.map(b => [esc(b.id) + (b.auto ? ' <span class="pill info">自动</span>' : ''), num(b.qty), b.order_date || '—', b.ship_date, b.arrival_date, cny(b.purchase_cny), b.purchase_pay_date, cny(b.freight_cny), b.freight_pay_date]);
    const wrows = m.weeks.slice(0, 26).map(w => [`${w.week_start}~${w.week_end.slice(5)}`, num(w.sold), cny(w.platform_net_cny), cny(w.cumulative_cny), cny(w.receivable_cny), `<td class="${cls(w.balance_end)}">${cny(w.balance_end)}`]);
    const rev = m.reverse; const revRows = rev ? rev.checkpoints.map(c => [c.date, esc(c.ref), cny(c.must_pay_cny), cny(c.need_cny), num(c.units_needed), num(c.units_planned_sold), pill(c.ok, '计划够', '计划不够')]) : [];
    const base = PRESETS[state.presetKey].input;
    const FLAG_PATHS = { 'inventory.shipments[SHIP-1].remaining_qty': 'inventory.shipments.0.remaining_qty', 'inventory.shipments[SHIP-1].freight_payment': 'inventory.shipments.0.freight_payment' };
    const flags = (m.flags || []).map(f => { const p = FLAG_PATHS[f.field] || f.field; const simple = /^[\w.]+$/.test(p) && getP(base, p) !== undefined; const changed = simple && JSON.stringify(getP(state.input, p)) !== JSON.stringify(getP(base, p)); const st = changed ? '<span class="pill good">已改</span>' : `<span class="pill ${/优先/.test(f.status || '') ? 'bad' : /说明/.test(f.status || '') ? 'info' : 'warn'}">${esc(f.status || '')}</span>`; return `<li>${st} <b>${esc(f.value || '')}</b> <span class="muted small">${esc(f.note || '')}</span></li>`; });
    v.innerHTML = `${sec('待确认的参数', `<p class="lead">默认值里拿不准的地方。你改过的会标"已改"。</p><ul class="plain flags">${flags.join('') || '<li class="muted">无</li>'}</ul>`, true)}
      ${sec('按月', table(['月份', '卖出', '丢单', '销售额', '广告', '平台到账', '广告出账', '货款头程关税', '团队开支', '月末余额', '月内最低', '欠工厂未付', '经营贡献（含关税）', '可额外拨'], mrows))}
      ${sec('到期付款：每一笔付不付得出', table(['到期日', '项目', '批次', '金额', '付完后余额', '缺口', ''], frows))}
      ${sec('每件的账与止损线', `<p class="lead">每件广告上限 = 扣广告前每件剩的钱。"可再售回库"是退货里能再卖的部分按成本回库，它把上限抬高，所以同时给不计回库的保守值。</p>` + table(['阶段', '日期', '售价', 'coupon', '平均成交价', '佣金', 'FBA', '退货', '券费', '仓储', '平台净回款', '货值+头程+关税', '可再售回库', '扣广告前每件剩', '每件广告上限', '上限（不计回库）', '计划每件广告', ''], prows) + (rev ? `<h3 style="margin:14px 0 6px">反推：到每笔货款到期前至少要卖多少件（粗算）</h3><p class="lead">每卖一件拿回 ${cny(rev.per_unit_after_ads_cny)}（平台净回款 − 广告 − 仓储）。</p>` + table(['货款到期日', '批次', '到期前必付合计', '扣起点现金后要靠销售', '至少要卖', '计划到那天卖出', ''], revRows) : ''))}
      ${sec('回款时间线（周）', table(['周', '卖出', '本周平台净到账', '累计到账', '周末已下单未到账', '周末余额'], wrows))}
      ${sec('补货批次', rrows.length ? table(['批次', '数量', '下单', '发货', '到仓可售', '货款', '货款到期', '头程', '头程到期'], rrows) : '<p class="muted small">没有补货。</p>')}
      ${sec('口径', `<ul class="plain small muted">
        <li>现金按人民币，平台按美元，一条汇率。货款、头程按工厂账期到期日出账；关税按采购价比例（或每件美元）在到货前后指定天数付。工厂付款只支持整批按账期 / 已付 / 不付。</li>
        <li>回款：净结算款按 TM 店铺历史释放分布落到释放日，再按 14 天打款日历到账；退款、退货处理费、仓储、coupon 费同样走打款日历。首笔回款 = 单日到账 ≥ ¥100 的第一天。</li>
        <li>广告出账三选一：花费当天 / 下个打款日从余额扣 / 信用卡还款日。缺货按丢单，断货当天广告停掉。</li>
        <li>每件广告上限 = 扣广告前每件剩的钱（团队一分不拿时）；FBA、仓储按旺季窗口加权。经营贡献 = 销售 − 平台费 − 广告 − 仓储 − 货值头程 − 卖出件的关税 − 一次性费用。</li>
        <li>没算的：入库配置费、库龄附加费、Vine 等上新费用（可填一次性费用）、店铺其他产品共用余额、预留金。只是预测，不是到账承诺。${m.ads_stopped ? ' 断货期间停掉的广告 ' + usd(m.ads_stopped) + '。' : ''}${m.warnings.map(esc).join(' ')}</li></ul>`)}`;
  }
  function sec(title, inner, open) { return `<details class="sec"${open ? ' open' : ''}><summary>${esc(title)}</summary><div class="body">${inner}</div></details>`; }
  function table(head, rows) {
    const tr = r => '<tr' + (r._cls ? ` class="${r._cls}"` : '') + '>' + r.map(c => String(c).startsWith('<td') ? c + '</td>' : `<td>${c}</td>`).join('') + '</tr>';
    return `<div class="tablewrap"><table class="data"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`;
  }

  // ---------- 设置 ----------
  function renderSettings() {
    const v = $('#view-settings');
    v.innerHTML = `<div class="card"><div class="hd"><h2>方案</h2></div><div class="form">
        <label class="f"><span>方案名</span><input type="text" data-path="scenario_name" data-kind="text" value="${esc(state.input.scenario_name || '')}"></label>
        <label class="f"><span>载入预设</span><select class="sel" id="preset">${presetKeys.map(k => `<option value="${esc(k)}"${k === state.presetKey ? ' selected' : ''}>${esc(PRESETS[k].label)}</option>`).join('')}</select><span class="u">换预设会覆盖现在填的数</span></label></div>
        <div class="rowbtns" style="margin-top:14px"><button type="button" data-act="reset-all">恢复默认</button><button type="button" data-act="copy-sum">复制方案摘要</button></div></div>
      <div class="card"><div class="hd"><h2>导出 / 导入参数</h2><button type="button" class="sm ghost" data-act="io-refresh">刷新</button></div><p class="lead">所有参数（JSON）。复制保存，或粘贴别人发你的参数后点"导入"。</p><textarea id="io-text" spellcheck="false">${esc(exportJson())}</textarea><div class="rowbtns" style="margin-top:8px"><button type="button" data-act="io-copy">复制</button><button type="button" class="primary" data-act="io-apply">导入</button><span class="muted small" id="io-msg"></span></div></div>
      <div class="card"><div class="hd"><h2>关于</h2></div><p class="small muted">推广 × 现金流平衡沙盘。产品层沿用同事 D08 v1.7 引擎的口径（回款释放分布、FIFO 成本、退款、仓储、coupon 费），加推广杠杆层和资金层；网页里的计算和 Python 版逐项对照一致。参数自动保存在这台设备的浏览器里，不会上传。只是预测，不是到账承诺。</p></div>`;
    $('#preset').addEventListener('change', e => { loadPreset(e.target.value); renderInputs(); renderSettings(); $('#scn-name').textContent = state.input.scenario_name || ''; schedule(); toast('已载入预设'); });
  }
  function exportJson() { const o = clone(state.input); delete o.release_distribution; for (const ph of o.promotion.phases) delete ph._norm; o._levers = state.levers; return JSON.stringify(o, null, 1); }
  function importJson(txt) { const o = JSON.parse(txt); if (!o || !o.promotion || !o.cash || !o.product || !o.horizon) throw new Error('缺 promotion / cash / product / horizon'); if (o._levers) { state.levers = { pace: +o._levers.pace || 1, coupon: o._levers.coupon == null ? null : +o._levers.coupon }; delete o._levers; } state.input = normalizeInput(o, state.presetKey); renderInputs(); $('#scn-name').textContent = state.input.scenario_name || ''; schedule(); }

  // ---------- 折线图 ----------
  function lineChart(fig, series, o) {
    if (!series || !series.length) { fig.innerHTML = `<figcaption>${esc(o.caption)}</figcaption><p class="muted small">没有数据</p>`; return; }
    const W = Math.max(300, fig.clientWidth || 500), H = 240, padL = 60, padR = 14, padT = 30, padB = 28;
    const n = series.length, xs = i => padL + (W - padL - padR) * (n === 1 ? 0 : i / (n - 1));
    let lo = Math.min(...series.map(r => r[1])), hi = Math.max(...series.map(r => r[1]));
    if (o.zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); } if (o.floor != null) { lo = Math.min(lo, o.floor); hi = Math.max(hi, o.floor); }
    if (hi === lo) hi = lo + 1; const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
    const ys = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
    const idx = new Map(series.map((r, i) => [r[0], i]));
    const nearest = d => { if (idx.has(d)) return idx.get(d); let best = 0; for (let i = 0; i < n; i++) if (series[i][0] <= d) best = i; return best; };
    let g = '';
    for (let t = 0; t <= 4; t++) { const vv = lo + (hi - lo) * t / 4, y = ys(vv); g += `<line class="gridl" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/><text class="tick" x="${padL - 6}" y="${y + 4}" text-anchor="end">${esc(short(vv))}</text>`; }
    const monthIdx = []; let lastM = ''; series.forEach((r, i) => { const mth = r[0].slice(0, 7); if (mth !== lastM) { lastM = mth; monthIdx.push([i, mth]); } });
    const stepM = monthIdx.length > 1 ? Math.max(1, Math.ceil(40 / ((W - padL - padR) / Math.max(1, (n - 1)) * Math.max(1, (monthIdx[monthIdx.length - 1][0] - monthIdx[0][0]) / Math.max(1, monthIdx.length - 1))))) : 1;
    monthIdx.forEach(([i, mth], j) => { if (j % stepM === 0) g += `<text class="tick" x="${xs(i)}" y="${H - padB + 16}" text-anchor="${i === 0 ? 'start' : 'middle'}">${mth.slice(2).replace('-', '/')}</text>`; });
    for (const [a, b] of (o.shade || [])) { const i0 = nearest(a), i1 = nearest(b); g += `<rect class="shade" x="${xs(i0)}" y="${padT}" width="${Math.max(2, xs(i1) - xs(i0))}" height="${H - padT - padB}"/>`; }
    if (o.zero && lo < 0 && hi > 0) g += `<line class="zero" x1="${padL}" x2="${W - padR}" y1="${ys(0)}" y2="${ys(0)}"/>`;
    if (o.floor != null && o.floor !== 0) g += `<line class="floorline" x1="${padL}" x2="${W - padR}" y1="${ys(o.floor)}" y2="${ys(o.floor)}"/>`;
    const pts = series.map((r, i) => `${xs(i).toFixed(1)},${ys(r[1]).toFixed(1)}`);
    const base0 = ys(Math.max(lo, Math.min(0, hi)));
    g += `<path class="area" d="M${pts[0]} L${pts.join(' L')} L${xs(n - 1).toFixed(1)},${base0.toFixed(1)} L${xs(0).toFixed(1)},${base0.toFixed(1)} Z"/><path class="line" d="M${pts.join(' L')}"/>`;
    // 标记线全画；标签最多两行，先放金额大的，放不下的只留线（悬停仍可看余额）
    const marks = (o.markers || []).filter(mk => idx.has(mk[0]) || (PC.toDay(mk[0]) <= PC.toDay(series[n - 1][0]) && PC.toDay(mk[0]) >= PC.toDay(series[0][0]))).map(mk => ({ mk, x: xs(nearest(mk[0])) }));
    marks.forEach(({ mk, x }) => { g += `<line class="mark ${esc(mk[2] || '')}" x1="${x}" x2="${x}" y1="${padT - 2}" y2="${H - padB}"/>`; });
    const placed = [[], []];
    marks.slice().sort((a, b) => (b.mk[3] || 0) - (a.mk[3] || 0)).forEach(({ mk, x }) => {
      const wEst = [...mk[1]].reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? 10 : 5.5), 0) + 4;
      let x0 = x + 3, anchor = 'start'; if (x0 + wEst > W - 2) { x0 = x - 3; anchor = 'end'; }
      const lo0 = anchor === 'start' ? x0 : x0 - wEst, hi0 = lo0 + wEst;
      for (let row = 0; row < placed.length; row++) { if (placed[row].some(([a, b]) => lo0 < b + 6 && hi0 > a - 6)) continue; placed[row].push([lo0, hi0]); g += `<text class="marklabel" x="${x0}" y="${padT - 18 + row * 10}" text-anchor="${anchor}">${esc(mk[1])}</text>`; break; }
    });
    let li = 0; for (let i = 1; i < n; i++) if (series[i][1] < series[li][1]) li = i;
    const lx = xs(li), ly = ys(series[li][1]), anchor = li > n * 0.7 ? 'end' : 'start';
    g += `<circle class="dot low" cx="${lx}" cy="${ly}" r="4"/><text class="dotlabel" x="${lx + (anchor === 'end' ? -8 : 8)}" y="${Math.min(H - padB - 4, ly + 16)}" text-anchor="${anchor}">最低 ${esc(o.fmt(series[li][1]))} · ${series[li][0]}</text>`;
    g += `<line class="cross" data-cx x1="0" x2="0" y1="${padT}" y2="${H - padB}" style="display:none"/><circle class="dot" data-cd r="4" style="display:none"/>`;
    fig.innerHTML = `<figcaption>${esc(o.caption)}</figcaption><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.caption)}">${g}<rect x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" fill="transparent" data-hit/></svg><div class="tip" style="display:none"></div>`;
    const svg = fig.querySelector('svg'), tip = fig.querySelector('.tip'), cx = fig.querySelector('[data-cx]'), cd = fig.querySelector('[data-cd]'), hit = fig.querySelector('[data-hit]');
    const move = ev => { const pt = ev.touches ? ev.touches[0] : ev; const rect = svg.getBoundingClientRect(); const sx = (pt.clientX - rect.left) * W / rect.width; const i = Math.max(0, Math.min(n - 1, Math.round((sx - padL) / (W - padL - padR) * (n - 1)))); const x = xs(i), y = ys(series[i][1]); cx.setAttribute('x1', x); cx.setAttribute('x2', x); cx.style.display = ''; cd.setAttribute('cx', x); cd.setAttribute('cy', y); cd.style.display = ''; tip.style.display = ''; tip.textContent = `${series[i][0]} · ${o.fmt(series[i][1])}`; const fr = fig.getBoundingClientRect(); let left = (x * rect.width / W) + (rect.left - fr.left) + 10; if (left + tip.offsetWidth > fr.width - 8) left -= tip.offsetWidth + 20; tip.style.left = left + 'px'; tip.style.top = ((y * rect.height / H) + (rect.top - fr.top) - 30) + 'px'; };
    const leave = () => { cx.style.display = 'none'; cd.style.display = 'none'; tip.style.display = 'none'; };
    hit.addEventListener('mousemove', move); hit.addEventListener('touchmove', move, { passive: true }); hit.addEventListener('touchstart', move, { passive: true }); hit.addEventListener('mouseleave', leave);
  }
  function short(v) { const a = Math.abs(v), sg = v < 0 ? '−' : ''; if (a >= 1e4) return sg + (a / 1e4).toLocaleString('en-US', { maximumFractionDigits: a >= 1e6 ? 0 : 1 }) + '万'; return sg + a.toLocaleString('en-US', { maximumFractionDigits: 0 }); }

  // ---------- 摘要 / 复制 / 提示 / 导航 ----------
  function summaryText() {
    const m = state.res.main; if (!m) return '';
    const s = m.summary, rec = state.res.rec, L = [];
    L.push(`【${state.input.scenario_name || 'Y背推广现金流沙盘'}】`);
    L.push(`起点现金 ${cny(s.opening_cash_cny)}；团队 ${cny(getP(state.input, 'cash.team_expenses.0.amount_cny'))}/月（${getP(state.input, 'cash.team_expenses.0.pay_day')} 号）；关税按采购价 ${pct(state.input.product.tariff_rate || 0)}；汇率 ${s.fx}；杠杆：节奏 ×${state.levers.pace}${state.levers.coupon == null ? '' : state.levers.coupon > 0 ? '、coupon ' + pct(state.levers.coupon) : '、不开 coupon'}`);
    L.push(`推广 ${s.promo_window ? s.promo_window[0] + '~' + s.promo_window[1] + '（' + s.promo_window[2] + ' 天）' : '—'}，卖 ${num(s.sold_total)} 件，广告 ${usd(s.ads_total_usd)}（每件 ${usd(s.ad_per_unit_planned_usd, 2)}，上限 ${usd(s.ad_cap_weighted_usd, 2)}）${s.stockout_first ? '，' + s.stockout_first + ' 起断货' : ''}`);
    L.push(`首笔回款 ${s.first_receipt_date || '—'}；推广期最低 ${cny(s.promo_low_cny)}（${s.promo_low_date}）；全程最低 ${cny(s.min_balance_cny)}（${s.min_balance_date}）；期末 ${cny(s.ending_balance_cny)} + 库存约 ${cny(s.ending_stock_value_cny)}`);
    L.push(`到期付款 ${m.factory.filter(f => f.ok).length}/${m.factory.length} 笔够${s.factory_all_ok ? '' : '，最多要垫 ' + cny(s.factory_gap_max_cny)}；团队开支 ${cny(s.team_total_cny)} 已计入，可额外拨 ${cny(s.allocatable_total_cny)}`);
    if (rec && rec.best) { const b = rec.best; L.push(`推荐：节奏 ×${b.pace_k}${b.coupon_pct > 0 ? '、coupon ' + pct(b.coupon_pct) : '、不开 coupon'}（${rec.mode === 'feasible' ? '可行' : '最少要垫 ' + cny(b.peak_funding_cny)}）：最低 ${cny(b.min_balance_cny)}，期末 ${cny(b.ending_balance_cny)}，广告 ${usd(b.ads_total_usd)}`); }
    if (rec && rec.needs) { const n = rec.needs; L.push(`要走得通：现金再多 ${cny(n.cash_more_cny)}` + (n.tariff_rate_max != null ? `，或关税 ≤ ${pct(n.tariff_rate_max, 1)}` : '') + (n.team_monthly_max != null ? `，或团队开支 ≤ ${cny(n.team_monthly_max)}/月` : '')); }
    L.push('（预测，不是到账承诺；由 Y背推广现金流沙盘 生成）');
    return L.join('\n');
  }
  function copyText(text) {
    const ok = () => toast('已复制');
    const fail = () => { setView('settings'); const ta = $('#io-text'); ta.value = text; ta.focus(); ta.select(); toast('复制失败，已选中文字，请手动复制'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fail); else fail();
  }
  let toastT = null; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800); }
  const TITLES = { home: '总览', inputs: '填数字', compare: '方案对比', detail: '明细', settings: '设置' };
  function setView(name) { state.view = name; $$('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + name)); $$('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === name)); $('#view-title').textContent = TITLES[name] || ''; window.scrollTo({ top: 0 }); if (name === 'home' && state.res.main) renderCharts(state.res.main); if (name === 'settings') { const ta = $('#io-text'); if (ta) ta.value = exportJson(); } }

  // ---------- 启动 ----------
  function init() {
    if (!restore()) loadPreset(presetKeys[0]);
    renderInputs(); renderSettings(); renderHome();
    $('#scn-name').textContent = state.input.scenario_name || '';
    document.addEventListener('input', onInput); document.addEventListener('change', onInput); document.addEventListener('click', onClick);
    $('#btn-copy').addEventListener('click', () => copyText(summaryText()));
    let rt = null; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (state.res.main && state.view === 'home') renderCharts(state.res.main); }, 200); });
    compute();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
