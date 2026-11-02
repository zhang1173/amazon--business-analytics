"""把一次运行结果写成一页 HTML 报告（纯标准库，内联 SVG 图）。"""
import html
import json
from datetime import date, timedelta

from d08_adapter import day


# ---------- 格式 ----------

def cny(v, signed=False):
    if v is None:
        return "—"
    s = "+" if (signed and v > 0) else ("−" if v < 0 else "")
    a = abs(v)
    if a >= 1e4:
        return f"{s}¥{a/1e4:,.1f}万"
    return f"{s}¥{a:,.0f}"


def usd(v, d=0):
    if v is None:
        return "—"
    s = "−" if v < 0 else ""
    return f"{s}${abs(v):,.{d}f}"


def num(v, d=0):
    if v is None:
        return "—"
    return f"{v:,.{d}f}"


def pct(v, d=1):
    return "—" if v is None else f"{v*100:.{d}f}%"


def esc(s):
    return html.escape(str(s)) if s is not None else ""


def pill(ok, yes="达标", no="不达标", warn=None):
    if ok is None:
        return f'<span class="pill neutral">{esc(warn or "—")}</span>'
    return f'<span class="pill {"good" if ok else "bad"}">{esc(yes if ok else no)}</span>'


def table(headers, rows, cls=""):
    th = "".join(f"<th>{esc(h)}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f'<div class="tablewrap"><table class="{cls}"><thead><tr>{th}</tr></thead><tbody>{body}</tbody></table></div>'


# ---------- SVG 折线 ----------

def line_chart(series, title, y_fmt, markers=(), shade=(), zero=True, ylabel=""):
    """series: [(date_iso, value)]；markers: [(date_iso, label, kind)]；shade: [(start, end)] 断货区间。"""
    if not series:
        return ""
    W, H, L, R, T, B = 960, 340, 72, 16, 28, 44
    xs = [day(d) for d, _ in series]
    ys = [v for _, v in series]
    x0, x1 = xs[0], xs[-1]
    span = max(1, (x1 - x0).days)
    lo, hi = min(ys + ([0] if zero else [])), max(ys + ([0] if zero else []))
    if hi == lo:
        hi = lo + 1
    pad = (hi - lo) * 0.08
    lo, hi = lo - pad, hi + pad
    def X(d): return L + (d - x0).days / span * (W - L - R)
    def Y(v): return T + (hi - v) / (hi - lo) * (H - T - B)
    # 刻度：取整洁的 y
    step = nice_step((hi - lo) / 5)
    ticks = []
    t = (lo // step) * step
    while t <= hi:
        if t >= lo:
            ticks.append(t)
        t += step
    grid = "".join(f'<line x1="{L}" y1="{Y(t):.1f}" x2="{W-R}" y2="{Y(t):.1f}" class="grid"/>'
                   f'<text x="{L-8}" y="{Y(t)+4:.1f}" class="tick" text-anchor="end">{esc(y_fmt(t))}</text>' for t in ticks)
    # 月份刻度
    mt = ""
    d = date(x0.year, x0.month, 1)
    while d <= x1:
        if d >= x0:
            mt += f'<line x1="{X(d):.1f}" y1="{T}" x2="{X(d):.1f}" y2="{H-B}" class="grid v"/><text x="{X(d)+3:.1f}" y="{H-B+16}" class="tick">{d.strftime("%y/%m")}</text>'
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    shades = "".join(f'<rect x="{X(day(a)):.1f}" y="{T}" width="{max(2, X(day(b))-X(day(a))):.1f}" height="{H-T-B}" class="shade"/>' for a, b in shade)
    zero_line = f'<line x1="{L}" y1="{Y(0):.1f}" x2="{W-R}" y2="{Y(0):.1f}" class="zero"/>' if zero and lo < 0 < hi else ""
    pts = " ".join(f"{X(d):.1f},{Y(v):.1f}" for d, v in zip(xs, ys))
    area = f"{X(xs[0]):.1f},{Y(max(lo, min(hi, 0))):.1f} {pts} {X(xs[-1]):.1f},{Y(max(lo, min(hi, 0))):.1f}"
    mk = ""
    last_x, row = -1e9, 0
    for md, label, kind in sorted(markers, key=lambda m: m[0]):
        dd = day(md)
        if not x0 <= dd <= x1:
            continue
        x = X(dd)
        row = (row + 1) % 4 if x - last_x < 120 else 0  # 挨得近的标签错行，避免重叠
        last_x = x
        mk += f'<line x1="{x:.1f}" y1="{T}" x2="{x:.1f}" y2="{H-B}" class="mark {kind}"/>'
        mk += f'<text x="{x+3:.1f}" y="{T+12+row*14}" class="marklabel {kind}">{esc(label)}</text>'
    # 最低点
    imin = ys.index(min(ys))
    low = f'<circle cx="{X(xs[imin]):.1f}" cy="{Y(ys[imin]):.1f}" r="5" class="dot low"/>' \
          f'<text x="{X(xs[imin]):.1f}" y="{Y(ys[imin])+18:.1f}" class="dotlabel" text-anchor="middle">最低 {esc(y_fmt(ys[imin]))} · {xs[imin].isoformat()}</text>'
    data = json.dumps([[d, round(v, 1)] for d, v in series])
    return f'''<figure class="chart" data-series='{esc(data)}' data-fmt="{ "cny" if y_fmt is cny else "num" }">
<figcaption>{esc(title)}</figcaption>
<svg viewBox="0 0 {W} {H}" role="img" aria-label="{esc(title)}" preserveAspectRatio="none">
{shades}{grid}{mt}{zero_line}
<polygon points="{area}" class="area"/>
<polyline points="{pts}" class="line"/>
{mk}{low}
<line class="cross" x1="0" y1="{T}" x2="0" y2="{H-B}" style="display:none"/>
<circle class="dot hover" r="5" style="display:none"/>
</svg><div class="tip" hidden></div></figure>'''


def nice_step(x):
    if x <= 0:
        return 1
    import math
    e = 10 ** math.floor(math.log10(x))
    for m in (1, 2, 2.5, 5, 10):
        if m * e >= x:
            return m * e
    return 10 * e


# ---------- 报告 ----------

CSS = r'''
/* 布局：单栏文档，摘要卡片在前，图表与表格在后；账本质感 */
:root{--bg:#f6f5f0;--surface:#ffffff;--fg:#1e201c;--muted:#67695f;--line:#e2e0d8;--accent:#1f6f8b;--accent-soft:#e3eef3;
 --good:#1c7a4a;--good-soft:#e2f2e8;--warn:#9a5b00;--warn-soft:#fbefd9;--bad:#b8322a;--bad-soft:#f9e3e0;--shade:#f2d5d0;
 --font-body:"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;
 --font-display:"Noto Serif SC","Songti SC","SimSun",Georgia,serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#15171a;--surface:#1e2125;--fg:#eceae3;--muted:#a3a59c;--line:#33373c;
 --accent:#6cb8d4;--accent-soft:#1d3440;--good:#5ccc8a;--good-soft:#1c3327;--warn:#e3a94a;--warn-soft:#3b2d14;--bad:#f07a6c;--bad-soft:#3f1f1c;--shade:#4a2a27;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#15171a;--surface:#1e2125;--fg:#eceae3;--muted:#a3a59c;--line:#33373c;
 --accent:#6cb8d4;--accent-soft:#1d3440;--good:#5ccc8a;--good-soft:#1c3327;--warn:#e3a94a;--warn-soft:#3b2d14;--bad:#f07a6c;--bad-soft:#3f1f1c;--shade:#4a2a27;color-scheme:dark}
html,body{background:var(--bg);color:var(--fg);font-family:var(--font-body);font-size:15px;line-height:1.55}
body{margin:0;padding-block:24px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
main{max-width:1080px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:32px}main>*{min-width:0}section{min-width:0}
h1,h2,h3{font-family:var(--font-display);font-weight:600;text-wrap:balance;margin:0}
h1{font-size:30px;line-height:1.2}h2{font-size:21px;border-bottom:1px solid var(--line);padding-bottom:6px;margin-bottom:14px}h3{font-size:16px;margin-bottom:8px}
.sub{color:var(--muted);font-size:13px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:14px 16px;display:grid;gap:6px;align-content:start;min-width:0}
.card .q{font-size:13px;color:var(--muted)}
.card .v{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.card .d{font-size:13px;color:var(--muted)}
.pill{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
.pill.good{background:var(--good-soft);color:var(--good)}.pill.bad{background:var(--bad-soft);color:var(--bad)}
.pill.warn{background:var(--warn-soft);color:var(--warn)}.pill.neutral{background:var(--accent-soft);color:var(--accent)}
.banner{background:var(--warn-soft);border-left:4px solid var(--warn);padding:10px 14px;border-radius:4px}
.banner.bad{background:var(--bad-soft);border-color:var(--bad)}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:6px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
th,td{padding:6px 10px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}th{color:var(--muted);font-weight:500;background:var(--bg)}
tr:last-child td{border-bottom:0}td.neg{color:var(--bad)}td.pos{color:var(--good)}
figure.chart{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 12px 6px;position:relative}
figure.chart svg{width:100%;height:auto;display:block;overflow:visible}
figcaption{font-size:13px;color:var(--muted);margin-bottom:4px}
.grid{stroke:var(--line);stroke-width:1}.grid.v{stroke-dasharray:none}
.tick{fill:var(--muted);font-size:12px;font-family:var(--font-body)}
.zero{stroke:var(--fg);stroke-width:1;opacity:.5}
.line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.area{fill:var(--accent);opacity:.08}
.shade{fill:var(--shade);opacity:.6}
.mark{stroke:var(--warn);stroke-width:1;stroke-dasharray:4 3}.mark.purchase{stroke:var(--bad)}.mark.team{stroke:var(--muted)}
.marklabel{fill:var(--muted);font-size:11px;font-family:var(--font-body)}
.dot{fill:var(--accent);stroke:var(--surface);stroke-width:2}.dot.low{fill:var(--bad)}
.dotlabel{fill:var(--fg);font-size:12px;font-family:var(--font-body)}
.cross{stroke:var(--muted);stroke-width:1}
.tip{position:absolute;pointer-events:none;background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:4px 8px;font-size:12px;box-shadow:0 2px 8px rgba(0,0,0,.12);white-space:nowrap}
ul{margin:0;padding-left:20px}li{margin:3px 0}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.note{font-size:13px;color:var(--muted)}
details summary{cursor:pointer;color:var(--accent)}
code{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;background:var(--accent-soft);padding:0 4px;border-radius:3px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
'''

JS = r'''
document.querySelectorAll('figure.chart').forEach(function(fig){
  var svg=fig.querySelector('svg'),data=JSON.parse(fig.dataset.series),fmt=fig.dataset.fmt,tip=fig.querySelector('.tip');
  var cross=svg.querySelector('.cross'),dot=svg.querySelector('.dot.hover'),poly=svg.querySelector('polyline');
  var pts=poly.getAttribute('points').trim().split(' ').map(function(p){var a=p.split(',');return [parseFloat(a[0]),parseFloat(a[1])]});
  function f(v){if(fmt==='cny'){var s=v<0?'−':'';v=Math.abs(v);return s+(v>=1e4?'¥'+(v/1e4).toFixed(1)+'万':'¥'+Math.round(v).toLocaleString())}return Math.round(v).toLocaleString()}
  function move(ev){var r=svg.getBoundingClientRect();var vb=svg.viewBox.baseVal;var x=(ev.clientX-r.left)/r.width*vb.width;
    var best=0,bd=1e9;for(var i=0;i<pts.length;i++){var d=Math.abs(pts[i][0]-x);if(d<bd){bd=d;best=i}}
    cross.setAttribute('x1',pts[best][0]);cross.setAttribute('x2',pts[best][0]);cross.style.display='';
    dot.setAttribute('cx',pts[best][0]);dot.setAttribute('cy',pts[best][1]);dot.style.display='';
    tip.hidden=false;tip.textContent=data[best][0]+'  '+f(data[best][1]);
    var fr=fig.getBoundingClientRect();var left=ev.clientX-fr.left+12;if(left+160>fr.width)left-=180;tip.style.left=left+'px';tip.style.top=(ev.clientY-fr.top-30)+'px';}
  svg.addEventListener('mousemove',move);svg.addEventListener('touchmove',function(e){move(e.touches[0])},{passive:true});
  svg.addEventListener('mouseleave',function(){cross.style.display='none';dot.style.display='none';tip.hidden=true});
});
'''


def render(out, matrix=None, sweep=None, input_path="", generated=""):
    s = out["summary"]
    fx = s["fx"]
    flags = out.get("flags", [])
    led = out["ledger"]
    daily = out["engine_result"]["daily"]
    cls = lambda v: "neg" if (v or 0) < 0 else ""

    # —— 六个问题
    cap_ok = s["ad_within_cap"]
    cards = [
        ("推广花多少？", f'{usd(s["ads_total_usd"])}', f'约 {cny(s["ads_total_cny"])}，每套 {usd(s["ad_per_unit_planned_usd"],2)}；每套上限 {usd(s["ad_cap_weighted_usd"],2)}（止损线，计可再售回库；不计回库 {usd(s["ad_cap_weighted_no_credit_usd"],2)}）',
         pill(cap_ok, "在上限内", "超过每套上限")),
        ("花多久？", f'{s["promo_window"][2]} 天' if s["promo_window"] else "—",
         f'{s["promo_window"][0]} 至 {s["promo_window"][1]}' if s["promo_window"] else "没有推广阶段",
         pill(s["stockout_first"] is None, "不断货", f'{s["stockout_first"]} 起断货、丢单 {num(s["lost_total"])} 件')),
        ("什么时候回款？", f'首笔 {s["first_receipt_date"] or "—"}',
         f'首笔 {cny(s["first_receipt_cny"])}（单日到账 ≥ ¥100 才算）；平台净到账合计 {cny(s["platform_receipts_cny"])}；回款高峰 {max(out["monthly"], key=lambda m: m["platform_in_cny"])["month"] if out["monthly"] else "—"}',
         '<span class="pill neutral">按 14 天打款日历</span>'),
        ("现金什么时候最紧？", cny(s["min_balance_cny"]), f'{s["min_balance_date"]}；推广期低点 {cny(s["promo_low_cny"])}（{s["promo_low_date"]}），期末 {cny(s["ending_balance_cny"])}（{s["ending_date"]}，止月截断，期末库存 {num(s["ending_stock"])} 件约 {cny(s["ending_stock_value_cny"])} 未变现）；低于底线 {s["days_below_floor"]} 天' + (f'，首次 {s["first_below_floor_date"]}' if s["first_below_floor_date"] else ""),
         pill(s["min_balance_cny"] >= s["cash_floor_cny"] - 1e-9, "全程不穿底", f'要垫 {cny(s["peak_funding_cny"])}')),
        ("工厂到期付得清吗？", f'{sum(1 for f in out["factory"] if f["ok"])} / {len(out["factory"])} 笔',
         f'货款头程合计 {cny(s["factory_payments_cny"])}；最多要垫 {cny(s["factory_gap_max_cny"])}' + (f'（{s["factory_gap_max_date"]} 那笔）' if s.get("factory_gap_max_date") else ""),
         pill(s["factory_all_ok"], "每笔都够", "有到期日不够")),
        ("团队能被供养吗？", cny(s["allocatable_total_cny"]) + " 可额外拨",
         f'已计入团队开支 {cny(s["team_total_cny"])}；期末余额 {cny(s["ending_balance_cny"])}（{s["ending_date"]}），期末库存 {num(s["ending_stock"])} 件',
         pill(s["ending_balance_cny"] >= s["cash_floor_cny"] - 1e-9 and s["factory_all_ok"], "开支能覆盖", "按现参数不能")),
    ]
    cards_html = "".join(f'<div class="card"><div class="q">{esc(q)}</div><div class="v">{esc(v)}</div><div class="d">{esc(d)}</div><div>{p}</div></div>' for q, v, d, p in cards)

    # —— 待确认
    flag_rows = [(f'<span class="pill {"bad" if "优先" in f.get("status","") else "warn"}">{esc(f.get("status",""))}</span>', esc(f.get("field", "")), esc(f.get("value", "")), esc(f.get("note", ""))) for f in flags]
    flags_html = table(["状态", "字段", "现在用的值", "说明"], flag_rows, "left") if flags else "<p class='note'>无</p>"

    # —— 图
    series = [(r["date"], r["balance"]) for r in led]
    markers = [(f["date"], ("货款" if f["kind"] == "purchase" else "头程" if f["kind"] == "freight" else "关税") + " " + cny(f["amount_cny"]), f["kind"]) for f in out["factory"]]
    shade = []
    cur = None
    for r in daily:
        if r["lost_qty"] > 1e-9:
            cur = cur or r["date"]
            last_d = r["date"]
        elif cur:
            shade.append((cur, last_d)); cur = None
    if cur:
        shade.append((cur, last_d))
    chart1 = line_chart(series, "账上余额（CNY，含团队开支；虚线 = 工厂货款/头程到期日；红色阴影 = 断货）", cny, markers, shade)
    chart2 = line_chart([(r["date"], r["closing"]) for r in daily], "可售库存（件）", lambda v: num(v), [(b["arrival_date"], f'到货 {num(b["qty"])}', "freight") for b in out["replenishment"]], shade, zero=False)

    # —— 月度表
    mrows = []
    for m in out["monthly"]:
        mrows.append([m["month"], num(m["sold"]), num(m["lost"]), usd(m["revenue_usd"]), usd(m["ads_usd"]), pct(m["tacos"]),
                      cny(m["platform_in_cny"]), f'<span class="{cls(m["ads_cny"])}">{cny(m["ads_cny"])}</span>',
                      f'<span class="{cls(m["factory_cny"]+m["tariff_cny"])}">{cny(m["factory_cny"]+m["tariff_cny"])}</span>',
                      f'<span class="{cls(m["team_cny"])}">{cny(m["team_cny"])}</span>',
                      f'<span class="{cls(m["end_balance"])}">{cny(m["end_balance"])}</span>', f'<span class="{cls(m["min_balance"])}">{cny(m["min_balance"])}</span>',
                      cny(m["receivable_cny"]), cny(m["payable_cny"]), cny(m["contribution_cny"]), cny(m["allocatable_cny"])])
    monthly_html = table(["月份", "卖出", "丢单", "销售额", "广告", "TACOS", "平台到账", "广告出账", "货款头程关税", "团队开支", "月末余额", "月内最低", "已下单未到账", "欠工厂未付", "经营贡献（含关税）", "可额外拨"], mrows)

    # —— 工厂到期
    frows = [[f["date"], {"purchase": "货款", "freight": "头程", "tariff": "关税"}[f["kind"]], esc(f["ref"]), cny(f["amount_cny"]),
              f'<span class="{cls(f["balance_after"])}">{cny(f["balance_after"])}</span>', cny(f["gap"]), pill(f["ok"], "够", "不够")] for f in out["factory"]]
    factory_html = table(["到期日", "项目", "批次", "金额", "付完后余额", "缺口", ""], frows)

    # —— 回款周表
    wrows = [[f'{w["week_start"]}~{w["week_end"][5:]}', num(w["sold"]), cny(w["platform_net_cny"]), cny(w["cumulative_cny"]), cny(w["receivable_cny"]), f'<span class="{cls(w["balance_end"])}">{cny(w["balance_end"])}</span>'] for w in out["weeks"][:26]]
    weeks_html = table(["周", "卖出", "本周平台净到账", "累计到账", "周末已下单未到账", "周末余额"], wrows)

    # —— 补货
    rrows = [[esc(b["id"]) + (" <span class='pill neutral'>引擎建议</span>" if b["auto"] else ""), num(b["qty"]), b["order_date"] or "—", b["ship_date"], b["arrival_date"], cny(b["purchase_cny"]), b["purchase_pay_date"], cny(b["freight_cny"]), b["freight_pay_date"]] for b in out["replenishment"]]
    replen_html = table(["批次", "数量", "下单", "发货", "到仓可售", "货款", "货款到期", "头程", "头程到期"], rrows) if rrows else "<p class='note'>没有补货批次。</p>"

    # —— 每件账
    prows = []
    for p in out["phases"]:
        prows.append([esc(p["name"]), f'{p["start"]}~{p["end"][5:]}', usd(p["price"], 2), pct(p["coupon_pct"], 0), usd(p["avg_price"], 2), usd(p["commission"], 2), usd(p["fba"], 2),
                      usd(p["refund"] + p["return_fee"], 2), usd(p["coupon_fee"], 2), usd(p["storage"], 2), usd(p["platform_net"], 2), usd(p["landed_usd"], 2), usd(p["sellable_credit"], 2),
                      usd(p["remainder_before_ads"], 2), f'<b>{usd(p["ad_cap_per_unit"], 2)}</b>', usd(p["ad_cap_no_credit"], 2), pct(p["tacos_cap"]), usd(p["ad_per_unit"], 2),
                      usd(p["planned_ad_per_unit"], 2) if p["planned_ad_per_unit"] is not None else "—", pill(p["within_cap"], "在上限内", "超上限")])
    phases_html = table(["阶段", "日期", "售价", "coupon", "平均成交价", "佣金", "FBA", "退货", "券费", "仓储", "平台净回款", "货值+头程+关税", "可再售回库", "扣广告前每件剩", "每件广告上限", "上限（不计回库）", "TACOS上限", "计划每件广告", "按CPC÷CVR×占比", ""], prows)

    rev = out.get("reverse")
    rev_html = ""
    if rev:
        rrows2 = [[c["date"], esc(c["ref"]), cny(c["must_pay_cny"]), cny(c["need_cny"]), num(c["units_needed"]), num(c["units_planned_sold"]), pill(c["ok"], "计划够", "计划不够")] for c in rev["checkpoints"]]
        rev_html = f'<h3>反推：到期前至少要卖多少件（粗算，不计回款滞后）</h3><p class="note">每卖一件拿回 {cny(rev["per_unit_after_ads_cny"])}（平台净回款 − 广告 − 仓储）；必付 = 到期前的货款、头程、关税、团队开支、一次性费用。</p>' + table(["货款到期日", "批次", "到期前必付合计", "扣起点现金后要靠销售拿回", "至少要卖", "计划到那天卖出", ""], rrows2)

    # —— 方案矩阵
    matrix_html = ""
    if matrix:
        mx = []
        for r in matrix:
            if not r.get("ok"):
                mx.append([pct(r["coupon_pct"], 0), r["pace"], f'<span class="pill bad">算不出：{esc(r.get("error",""))}</span>'] + ["—"] * 8)
                continue
            mx.append([pct(r["coupon_pct"], 0), f'{r["pace"]}（{r["pace_k"]}×）', usd(r["ads_total_usd"]), num(r["sold_total"]), num(r["lost_total"]),
                       f'{usd(r["ad_per_unit_planned_usd"],2)} / {usd(r["ad_cap_weighted_usd"],2)} ' + pill(r["ad_within_cap"], "内", "超"),
                       f'<span class="{cls(r["min_balance_cny"])}">{cny(r["min_balance_cny"])}</span><br><span class="note">{r["min_balance_date"]}</span>',
                       pill(r["factory_all_ok"], "都够", f'最多垫 {cny(r["factory_gap_max_cny"])}'), r["stockout_first"] or "不断货",
                       f'<span class="{cls(r["ending_balance_cny"])}">{cny(r["ending_balance_cny"])}</span>', cny(r["allocatable_total_cny"]), cny(r["total_contribution_cny"])])
        matrix_html = table(["coupon", "推广节奏", "广告合计", "卖出", "丢单", "每套广告 / 上限", "最低余额", "工厂到期", "断货", "期末余额", "可额外拨", "经营贡献"], mx)

    sweep_html = ""
    if sweep:
        labels = {"product.tariff_rate": "关税（按采购价比例）", "product.tariff_usd_per_unit": "关税（美元/件）", "cash.opening_cash_cny": "起点现金",
                  "product.fx": "汇率", "product.refund_rate": "退货率", "product.fba_standard_usd": "FBA 配送费"}
        field = sweep[0]["field"]
        sw = []
        for r in sweep:
            if not r.get("ok"):
                sw.append([esc(r["value"]), f'<span class="pill bad">算不出：{esc(r.get("error",""))}</span>'] + ["—"] * 6)
                continue
            v = r["value"]
            vs = pct(v, 0) if ("rate" in field and v <= 1) else (cny(v) if "cny" in field else num(v, 2))
            sw.append([vs, cny(r["tariff_total_cny"]) if "tariff" in field else "—",
                       f'{usd(r["ad_cap_weighted_usd"],2)} ' + pill(r["ad_within_cap"], "计划在内", "计划超上限"),
                       f'<span class="{cls(r["min_balance_cny"])}">{cny(r["min_balance_cny"])}</span><br><span class="note">{r["min_balance_date"]}</span>',
                       pill(r["factory_all_ok"], "都够", f'最多垫 {cny(r["factory_gap_max_cny"])}'),
                       f'<span class="{cls(r["ending_balance_cny"])}">{cny(r["ending_balance_cny"])}</span>', cny(r["allocatable_total_cny"]), cny(r["total_contribution_cny"])])
        sweep_html = f'<section><h2>敏感性：{esc(labels.get(field, field))} 不同取值</h2><p class="note">其余参数不动，只改这一个。</p>' + table([labels.get(field, field), "关税合计", "每件广告上限", "最低余额", "工厂到期", "期末余额", "可额外拨", "经营贡献"], sw) + "</section>"
    warn_html = "".join(f"<li>{esc(w)}</li>" for w in out["warnings"])
    stopped = out.get("ads_stopped_for_stockout_usd", 0)
    ads_mode = {"daily": "花费当天出钱", "balance": "下个结算打款日从亚马逊余额扣", "card": "信用卡还款日出钱"}.get(s["ads_payment_mode"], s["ads_payment_mode"])

    n_bad = sum(1 for f in flags if "优先" in f.get("status", ""))
    banner = f'<div class="banner{" bad" if n_bad else ""}"><b>这是用默认参数跑的结果，{len(flags)} 个参数待你确认</b>（其中 {n_bad} 个最优先）。数字会随真数变化，请先看最下面的待确认清单，再读结论。</div>' if flags else ""

    return f'''<title>{esc(s["scenario_name"].split("（")[0] or "推广现金流沙盘")}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600&display=swap">
<style>{CSS}</style>
<main>
<header>
<div class="eyebrow">推广 × 现金流 平衡工具 · 第一版</div>
<h1>{esc(s["scenario_name"])}</h1>
<p class="sub">生成 {esc(generated)} · 输入 {esc(input_path)} · 产品层引擎 {esc(s["engine_version"])} · 汇率 {fx} · 广告出账：{esc(ads_mode)} · 缺货按丢单{f"，断货期间停掉广告 {usd(stopped)}" if stopped else ""}</p>
</header>
{banner}
<section><h2>六个问题的答案</h2><div class="cards">{cards_html}</div>
<p class="note">口径：现金全部按人民币；"平台到账"= 销售净结算款（已扣佣金、FBA）− 退款 − 退货处理费 − 仓储 − coupon 费，按 TM 店铺历史释放分布 + 14 天打款日历落到日期；货款按工厂账期到期日付；"可额外拨"= 在已付团队固定开支之外，每月月末还能拿出而不让以后任何一天余额低于底线（{cny(s["cash_floor_cny"])}）的钱。</p></section>
<section><h2>账上余额与库存</h2>{chart1}<div style="height:12px"></div>{chart2}</section>
<section><h2>按月</h2>{monthly_html}<p class="note">"欠工厂未付"= 已发货但还没到付款日的货款和头程；"已下单未到账"= 已卖出但平台还没打款的净额。经营贡献是权责口径（不看钱什么时候到），用来判断"每月卖出 × 每件剩的钱 ≥ 团队开支"这个滚动条件。</p></section>
<section><h2>工厂到期日：那天钱够不够</h2>{factory_html}</section>
<section><h2>回款时间线（前 26 周）</h2>{weeks_html}</section>
<section><h2>库存与补货</h2><p class="note">补货由引擎按"覆盖天数 + 安全天数"每周一复核自动建议（海运）；标"引擎建议"的批次未经确认，但它们的货款和头程已按账期算进现金。</p>{replen_html}</section>
<section><h2>每件的账与止损线</h2><p class="note">每件广告上限 = 扣广告前每件剩的钱（团队一分不拿时）。超过上限，卖得越多亏得越多。"可再售回库"是退货里能再卖的那部分按成本回库（退货率 × 可再售率 × 货值），它把上限抬高 $0.7–0.9/件，所以同时给"不计回库"的保守上限，拿不准时按保守的看。FBA 和仓储按阶段日期落在旺季窗口的天数（按单量加权）取旺季价，和引擎同口径。"按 CPC÷CVR×占比"是用填的 CPC、转化率、广告单占比算出的每件广告，用来和计划广告对照。</p>{phases_html}{rev_html}</section>
<section><h2>方案对比：coupon 档 × 推广节奏</h2><p class="note">同一套参数，只改 coupon 和单量倍数（广告随比例变）。先挑"工厂到期都够、期末余额为正"的格子，再比可额外拨的钱。</p>{matrix_html or "<p class='note'>本次没有跑方案对比（加 --matrix）。</p>"}</section>
{sweep_html}
<section><h2>待确认的参数</h2>{flags_html}</section>
<section><h2>引擎提示</h2><ul class="note">{warn_html}</ul></section>
</main>
<script>{JS}</script>
'''
