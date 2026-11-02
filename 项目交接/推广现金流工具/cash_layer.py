"""资金层：在同事引擎（产品层）外面加上定稿要求的东西。

引擎算的是产品本身的收付（销售回款、退款、仓储、广告、货款、头程）。
这一层补：起点现金、团队开支与付款日、一次性费用、关税、广告扣款时间（余额扣/信用卡）、
缺货停广告、每月可拨给团队的钱、工厂到期日余额、滚动借款指标、方案对比矩阵。
所有现金用人民币（CNY），平台指标用美元（USD）。
"""
import calendar
import copy
import csv
import json
import math
import os
from collections import defaultdict
from datetime import date, timedelta

from d08_adapter import simulate, payout, day, first, last, days, months, add_months, VERSION
import promo_layer

FIRST_RECEIPT_MIN_CNY = 100.0  # 首笔回款的最低金额口径
PLATFORM_KINDS = {"sales", "refund", "return_fee", "storage", "coupon_fixed", "coupon_variable"}


# ---------- 输入 ----------

def load_input(path):
    with open(path, encoding="utf-8") as f:
        inp = json.load(f)
    base = os.path.dirname(os.path.abspath(path))
    if not inp.get("release_distribution") and inp.get("release_distribution_csv"):
        inp["release_distribution"] = load_release_csv(os.path.join(base, inp["release_distribution_csv"]))
    return inp


def load_release_csv(path):
    rows = []
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            k_days = next(k for k in r if "天" in k or k.lower() == "days")
            k_w = next(k for k in r if k.startswith("权重") or k.lower() == "weight")
            rows.append(dict(days=int(float(r[k_days])), weight=float(r[k_w])))
    total = sum(r["weight"] for r in rows)
    for r in rows:
        r["weight"] /= total
    return rows


# ---------- 引擎参数 ----------

def build_engine_params(inp, months_rows, coupons):
    h, pr, inv, rep = inp["horizon"], inp["product"], inp["inventory"], inp["replenishment"]
    start = first(h["start_month"])
    shipments = []
    for s in inv.get("shipments", []):
        row = dict(id=s["id"], qty=int(s["qty"]), purchase_unit=float(s["purchase_unit_cny"]),
                   freight_unit=float(s["freight_unit_cny"]), mode=s.get("mode", "sea"), ship_date=s["ship_date"],
                   transit_days=int(s.get("transit_days", 30)),
                   purchase_months=int(s.get("purchase_months", rep["purchase_months"])),
                   freight_days=int(s.get("freight_days", rep["freight_days"])), confirmed=True, voided=False)
        if s.get("arrival_date"):
            row["actual_arrival_date"] = s["arrival_date"]
        if s.get("remaining_qty") is not None:
            row["remaining_qty"] = float(s["remaining_qty"])
            row["remaining_as_of"] = start.isoformat()
        for kind in ("purchase", "freight"):
            mode = s.get(kind + "_payment", "terms")
            row[kind + "_payment"] = mode
            if mode != "terms":
                row[kind + "_payment_date"] = s[kind + "_pay_date"]
        shipments.append(row)
    batches = []
    for b in inv.get("planned_batches", []):
        batches.append(dict(id=b["id"], kind="purchase", qty=int(b["qty"]), order_date=b["order_date"],
                            ship_date=b["ship_date"], arrival_date=b["arrival_date"],
                            purchase_unit=float(b["purchase_unit_cny"]), freight_unit=float(b["freight_unit_cny"]),
                            purchase_pay_date=b.get("purchase_pay_date") or add_months(day(b["ship_date"]), int(b.get("purchase_months", rep["purchase_months"]))).isoformat(),
                            freight_pay_date=b.get("freight_pay_date") or (day(b["ship_date"]) + timedelta(days=int(b.get("freight_days", rep["freight_days"])))).isoformat(),
                            confirmed=True))
    p = dict(schema_version=1, market="US", product_name=inp.get("product_name", "Y背三件套"),
             scenario_name=inp.get("scenario_name", ""), start_month=h["start_month"], end_month=h["end_month"],
             storage_end_month=h.get("storage_end_month", h["end_month"]), fx=float(pr["fx"]),
             purchase_unit=float(pr["purchase_unit_cny"]), air_freight=float(pr["air_freight_cny"]),
             sea_freight=float(pr["sea_freight_cny"]), production_days=int(rep["production_days"]),
             air_days=int(rep["air_days"]), sea_days=int(rep["sea_days"]), purchase_months=int(rep["purchase_months"]),
             freight_days=int(rep["freight_days"]), cover_days=int(rep["cover_days"]), safety_days=int(rep["safety_days"]),
             strategy=rep.get("strategy", "sea"), replenish_trigger=rep.get("trigger", "forecast"),
             shortage_mode=rep.get("shortage_mode", "lost"), opening_layers=[], batches=batches, shipments=shipments,
             opening_cash=[], historical_investment=None, gift_rate=float(pr.get("gift_rate", 0)),
             refund_rate=float(pr["refund_rate"]), sellable_rate=float(pr["sellable_rate"]),
             refund_lag=int(pr["refund_lag"]), return_lag=int(pr["return_lag"]), return_fee=float(pr["return_fee_usd"]),
             fba_standard=float(pr["fba_standard_usd"]), fba_low=float(pr.get("fba_low_usd", 0)),
             storage_unit=float(pr["storage_unit_usd_month"]), payout_anchor=h["payout_anchor"],
             stress_days=int(h.get("stress_days", 1)), bank_delay_days=int(h.get("bank_delay_days", 0)),
             stop_month="", clearance_rate=None, release_distribution=inp["release_distribution"],
             months=months_rows, pricing_mode="coupon_gross", coupons=coupons,
             coupon_low_fba_choice="", coupon_low_fba_evidence="", extra_expenses=[])
    if rep.get("reorder_qty"):
        p["reorder_qty"] = int(rep["reorder_qty"])
    return p


# ---------- 运行 ----------

def run_scenario(inp):
    """跑一个方案：推广层 → 引擎 → 资金层。返回 dict（可直接写 JSON）。"""
    h, pr, rep = inp["horizon"], inp["product"], inp["replenishment"]
    plan = promo_layer.expand_phases(inp["promotion"], h)
    months_rows, coupons = promo_layer.build_months_and_coupons(plan, h, pr, inp["promotion"])
    p = build_engine_params(inp, months_rows, coupons)
    result = simulate(copy.deepcopy(p))
    ads_stopped_usd = 0.0
    if rep.get("stop_ads_when_out_of_stock", True):
        # 断货那天的广告白花：按"卖出 ÷ 计划"比例缩减，再跑一遍（库存不受广告影响，一遍即收敛）
        scale = {}
        for r in result["daily"]:
            if r["lost_qty"] > 1e-9 and r["planned"] > 0:
                scale[r["date"]] = r["sold"] / r["planned"]
        if scale:
            for m in p["months"]:
                for d in m["days"]:
                    if d["date"] in scale:
                        ads_stopped_usd += d["ads"] * (1 - scale[d["date"]])
                        d["ads"] = round(d["ads"] * scale[d["date"]], 4)
                m["ads"] = sum(d["ads"] for d in m["days"])
            result = simulate(copy.deepcopy(p))
    events = outer_events(inp, p, result)
    ledger = daily_ledger(events, float(inp["cash"].get("opening_cash_cny", 0) or 0), h, result)
    out = analyze(inp, p, result, events, ledger, plan)
    out["ads_stopped_for_stockout_usd"] = ads_stopped_usd
    out["engine_params"] = p
    out["engine_result"] = result
    return out


# ---------- 资金事件 ----------

def outer_events(inp, p, result):
    """引擎事件 + 关税 + 团队开支 + 一次性费用；广告按扣款方式改日期。全部 CNY。"""
    h, pr, inv, cash = inp["horizon"], inp["product"], inp["inventory"], inp["cash"]
    fx, anchor = p["fx"], day(p["payout_anchor"])
    start = first(h["start_month"])
    ads_cfg = inp["promotion"].get("ads_payment", {}) or {}
    mode = ads_cfg.get("mode", "daily")
    events = []
    for e in result["cash_events"]:
        e = dict(e)
        if e["kind"] == "ads":
            d = day(e["source_date"])
            if mode == "balance":
                e["date"] = (payout(d, anchor) + timedelta(days=p.get("bank_delay_days", 0))).isoformat()
            elif mode == "card":
                e["date"] = next_card_pay_date(d, int(ads_cfg.get("card_pay_day", 15)), int(ads_cfg.get("card_min_lag_days", 20))).isoformat()
            e["timing"] = {"daily": "花费当天", "balance": "下个结算打款日从余额扣", "card": "信用卡还款日"}[mode]
        events.append(e)
    # 关税：每批到货时按件交（可填 到货后几天）。起点前已到的批次默认已交。
    per_unit = float(pr.get("tariff_usd_per_unit", 0) or 0) * fx + float(pr.get("tariff_rate", 0) or 0) * 0  # 比例税按批次采购价算
    rate = float(pr.get("tariff_rate", 0) or 0)
    lag = int(pr.get("tariff_days_after_arrival", 0) or 0)
    if per_unit or rate:
        seen = set()
        rows = [dict(id=b["id"], qty=b["qty"], arrival=b["arrival_date"], unit=b["purchase_unit"])
                for b in result["batches"] if b["kind"] == "purchase"]
        for s in result["shipment_schedule"]:
            if day(s["arrival_date"]) < start:
                rows.append(dict(id=s["id"], qty=s["qty"], arrival=s["arrival_date"], unit=s["purchase_unit"], opening=True))
        for r in rows:
            if r["id"] in seen:
                continue
            seen.add(r["id"])
            when = day(r["arrival"]) + timedelta(days=lag)
            if r.get("opening"):
                if inv.get("tariff_paid_before_start", True):
                    continue
                when = max(when, start)
            amount = r["qty"] * (per_unit + rate * r["unit"])
            if when >= start and amount > 0:
                events.append(dict(kind="tariff", date=when.isoformat(), source_date=r["arrival"], stress_date=when.isoformat(),
                                   amount_cny=-amount, ref=r["id"]))
    # 团队固定开支：每月固定日
    tail_month = h["end_month"]
    for t in cash.get("team_expenses", []):
        amt = float(t.get("amount_cny", 0) or 0)
        if amt <= 0:
            continue
        m0 = t.get("start_month") or h["start_month"]
        m1 = t.get("end_month") or tail_month
        for m in months(m0, m1):
            y, mo = int(m[:4]), int(m[5:])
            dd = min(int(t.get("pay_day", 10)), calendar.monthrange(y, mo)[1])
            when = date(y, mo, dd)
            if when < start:
                continue
            events.append(dict(kind="team", date=when.isoformat(), source_date=when.isoformat(), stress_date=when.isoformat(),
                               amount_cny=-amt, ref=t.get("name", "团队开支")))
    for o in cash.get("one_off_expenses", []):
        amt = float(o.get("amount_cny", 0) or 0)
        if amt <= 0:
            continue
        when = day(o["date"])
        if when < start:
            continue
        events.append(dict(kind="one_off", date=when.isoformat(), source_date=when.isoformat(), stress_date=when.isoformat(),
                           amount_cny=-amt, ref=o.get("name", "一次性费用")))
    events.sort(key=lambda e: (e["date"], e["kind"], e.get("source_date", "")))
    return events


def next_card_pay_date(d, pay_day, min_lag):
    earliest = d + timedelta(days=min_lag)
    y, m = earliest.year, earliest.month
    for _ in range(3):
        cand = date(y, m, min(pay_day, calendar.monthrange(y, m)[1]))
        if cand >= earliest:
            return cand
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return cand


# ---------- 逐日账 ----------

def daily_ledger(events, opening_cash, h, result):
    start = first(h["start_month"])
    tail = max([day(result["daily"][-1]["date"]), last(h["end_month"])] + [day(e["date"]) for e in events])
    by_day = defaultdict(lambda: defaultdict(float))
    for e in events:
        by_day[e["date"]][e["kind"]] += e["amount_cny"]
        by_day[e["date"]]["net"] += e["amount_cny"]
        by_day[e["date"]]["in" if e["amount_cny"] > 0 else "out"] += e["amount_cny"]
    rows, bal = [], opening_cash
    for d in days(start, tail):
        k = d.isoformat()
        x = by_day.get(k, {})
        opening = bal
        bal += x.get("net", 0.0)
        rows.append(dict(date=k, opening=opening, inflow=x.get("in", 0.0), outflow=x.get("out", 0.0),
                         net=x.get("net", 0.0), balance=bal, **{kk: v for kk, v in x.items() if kk not in ("net", "in", "out")}))
    return rows


# ---------- 分析 ----------

def analyze(inp, p, result, events, ledger, plan):
    h, cash_cfg, pr = inp["horizon"], inp["cash"], inp["product"]
    fx = p["fx"]
    floor = float(cash_cfg.get("cash_floor_cny", 0) or 0)
    opening_cash = float(cash_cfg.get("opening_cash_cny", 0) or 0)
    daily = result["daily"]
    by_date = {r["date"]: r for r in daily}
    bal = {r["date"]: r["balance"] for r in ledger}

    # 1. 现金最紧
    low = min(ledger, key=lambda r: r["balance"])
    first_neg = next((r["date"] for r in ledger if r["balance"] < floor - 1e-9), None)
    neg_days = sum(1 for r in ledger if r["balance"] < floor - 1e-9)
    # 2. 工厂到期
    factory = []
    for e in events:
        if e["kind"] in ("purchase", "freight", "tariff"):
            b = bal[e["date"]]
            factory.append(dict(date=e["date"], kind=e["kind"], ref=e.get("ref", ""), amount_cny=-e["amount_cny"],
                                balance_after=b, gap=max(0.0, floor - b), ok=b >= floor - 1e-9))
    # 3. 月度表
    month_keys = sorted({r["date"][:7] for r in ledger})
    eng_m = {r["month"]: r for r in result["monthly"]}
    # 经营贡献口径：引擎贡献（销售 − 平台费 − 广告 − 仓储 − 货值头程）再减卖出件的关税和当月一次性费用
    t_rate = float(pr.get("tariff_rate", 0) or 0)
    t_unit_cny = float(pr.get("tariff_usd_per_unit", 0) or 0) * fx
    tariff_sold_by_month = defaultdict(float)
    for al in result.get("fifo_allocations", []):
        if al.get("use") == "sales":
            tariff_sold_by_month[al["date"][:7]] += t_rate * al["purchase_cny"] + t_unit_cny * al["qty"]
    one_off_by_month = defaultdict(float)
    for e in events:
        if e["kind"] == "one_off":
            one_off_by_month[e["date"][:7]] += -e["amount_cny"]
    team_by_month = defaultdict(float)
    cash_by_month = defaultdict(lambda: defaultdict(float))
    for e in events:
        cash_by_month[e["date"][:7]][e["kind"]] += e["amount_cny"]
    monthly = []
    # 每月可拨：月末拨出后，以后每天余额都不低于底线
    min_suffix = {}
    run_min = math.inf
    for r in reversed(ledger):
        run_min = min(run_min, r["balance"])
        min_suffix[r["date"]] = run_min
    allocated = 0.0
    for m in month_keys:
        em = eng_m.get(m, {})
        c = cash_by_month[m]
        end_d = min(last(m), day(ledger[-1]["date"])).isoformat()
        month_rows = [r for r in ledger if r["date"].startswith(m)]
        alloc = max(0.0, min_suffix[end_d] - floor - allocated)
        allocated += alloc
        sold = em.get("sold", 0.0)
        contrib = em.get("contribution", 0.0) - tariff_sold_by_month.get(m, 0.0) - one_off_by_month.get(m, 0.0)
        monthly.append(dict(
            month=m, planned=em.get("planned", 0.0), sold=sold, lost=em.get("lost_qty", 0.0),
            revenue_usd=em.get("revenue", 0.0), ads_usd=em.get("ads", 0.0),
            tacos=(em.get("ads", 0.0) / em["revenue"]) if em.get("revenue") else None,
            platform_in_cny=sum(c.get(k, 0.0) for k in PLATFORM_KINDS),
            ads_cny=c.get("ads", 0.0), factory_cny=c.get("purchase", 0.0) + c.get("freight", 0.0), tariff_cny=c.get("tariff", 0.0),
            team_cny=c.get("team", 0.0) + c.get("one_off", 0.0), net_cny=sum(c.values()),
            end_balance=bal[end_d], min_balance=min(r["balance"] for r in month_rows),
            receivable_cny=em.get("receivable", 0.0), payable_cny=em.get("payable", 0.0),
            stock_end=em.get("stock", 0.0), contribution_cny=contrib, tariff_sold_cny=tariff_sold_by_month.get(m, 0.0),
            contribution_per_unit_cny=(contrib / sold) if sold else None,
            allocatable_cny=alloc, allocatable_cum_cny=allocated,
            team_covered=(contrib >= -(c.get("team", 0.0)) - 1e-9) if (c.get("team", 0.0) < 0) else None,
        ))
    # 4. 回款时间线（周）
    start = first(h["start_month"])
    weeks = []
    plat = [e for e in events if e["kind"] in PLATFORM_KINDS]
    # 首笔回款 = 平台当天净到账 ≥ ¥100 的第一天（忽略释放分布第 0 天桶带来的几分钱）
    plat_by_day = defaultdict(float)
    for e in plat:
        plat_by_day[e["date"]] += e["amount_cny"]
    first_receipt = next((d for d in sorted(plat_by_day) if plat_by_day[d] >= FIRST_RECEIPT_MIN_CNY), None)
    first_receipt_cny = plat_by_day.get(first_receipt, 0.0) if first_receipt else 0.0
    wk = start
    tail = day(ledger[-1]["date"])
    cum_in = 0.0
    while wk <= tail and len(weeks) < 60:
        we = wk + timedelta(days=6)
        a, b = wk.isoformat(), we.isoformat()
        got = sum(e["amount_cny"] for e in plat if a <= e["date"] <= b)
        receivable = sum(e["amount_cny"] for e in plat if e["source_date"] <= b < e["date"])
        sold = sum(by_date[r]["sold"] for r in by_date if a <= r <= b)
        cum_in += got
        weeks.append(dict(week_start=a, week_end=b, sold=sold, platform_net_cny=got, cumulative_cny=cum_in,
                          receivable_cny=receivable, balance_end=bal.get(b, bal[ledger[-1]["date"]])))
        wk = we + timedelta(days=1)
    # 5. 库存与补货
    stockout_days = [r for r in daily if r["lost_qty"] > 1e-9]
    stockout_first = stockout_days[0]["date"] if stockout_days else None
    lost_total = sum(r["lost_qty"] for r in daily)
    zero_first = next((r["date"] for r in daily if r["closing"] <= 1e-9 and r["planned"] > 0), None)
    replen = []
    for b in result["batches"]:
        if b["kind"] != "purchase":
            continue
        replen.append(dict(id=b["id"], qty=b["qty"], order_date=b.get("order_date"), ship_date=b["ship_date"],
                           arrival_date=b["arrival_date"], purchase_cny=b["qty"] * b["purchase_unit"],
                           freight_cny=b["qty"] * b["freight_unit"], purchase_pay_date=b["purchase_pay_date"],
                           freight_pay_date=b["freight_pay_date"], auto=b["id"].startswith(("AUTO-", "SELLOUT-"))))
    # 6. 推广
    ads_total = sum(r["ads_usd"] for r in daily)
    sold_total = sum(r["sold"] for r in daily)
    planned_total = sum(r["planned"] for r in daily)
    revenue_total = sum(r["revenue_usd"] for r in daily)
    active = [r["date"] for r in daily if r["ads_usd"] > 0 or r["planned"] > 0]
    promo_window = (active[0], active[-1], (day(active[-1]) - day(active[0])).days + 1) if active else None
    phases = []
    for ph in inp["promotion"].get("phases", []):
        dr = [plan[d] for d in plan if ph["start"] <= d.isoformat() <= ph["end"]]
        dw = [(d.isoformat(), float(plan[d]["qty"])) for d in plan if ph["start"] <= d.isoformat() <= ph["end"]]
        ue = promo_layer.unit_economics(ph, pr, fx, storage_days=int(inp["promotion"].get("avg_stock_days", 45)), day_weights=dw)
        q = sum(x["qty"] for x in dr)
        a = sum(x["ads"] for x in dr)
        ue.update(name=ph.get("name"), start=ph["start"], end=ph["end"], days=len(dr), planned_qty=q, planned_ads=a,
                  ad_per_unit=(a / q) if q else None, mode=ph.get("mode", "orders"))
        ue["remainder_after_planned_ads"] = ue["remainder_before_ads"] - (ue["ad_per_unit"] or 0)
        ue["within_cap"] = (ue["ad_per_unit"] or 0) <= ue["ad_cap_per_unit"] + 1e-9
        phases.append(ue)
    # 7. 反推（粗算）：到每笔工厂货款到期日前，至少要卖多少件才付得起
    #    必付 = 到期前所有不随销量变的支出（货款、头程、关税、团队、一次性）；每件拿回 = 平台净回款 − 广告 − 仓储
    reverse = None
    if phases and factory:
        wq = sum(x["planned_qty"] for x in phases) or 1
        per_unit_after = sum((x["platform_net"] - (x["ad_per_unit"] or 0) - x["storage"]) * x["planned_qty"] for x in phases) / wq * fx
        checkpoints = []
        for e in [f for f in factory if f["kind"] == "purchase"]:
            D = e["date"]
            must_pay = -sum(x["amount_cny"] for x in events if x["date"] <= D and x["kind"] in ("purchase", "freight", "tariff", "team", "one_off"))
            need = max(0.0, must_pay - opening_cash)
            units = need / per_unit_after if per_unit_after > 0 else None
            sold_by = sum(r["sold"] for r in daily if r["date"] <= D)
            checkpoints.append(dict(date=D, ref=e["ref"], must_pay_cny=must_pay, need_cny=need,
                                    units_needed=units, units_planned_sold=sold_by,
                                    ok=(units is not None and sold_by >= units)))
        reverse = dict(per_unit_after_ads_cny=per_unit_after, checkpoints=checkpoints)
    # 8. 现金最紧分两段：推广期（最后一个有单量/广告的日子之前）的低点，和期末（止月截断、库存未变现）
    if promo_window:
        promo_rows = [r for r in ledger if r["date"] <= promo_window[1]]
    else:
        promo_rows = ledger
    promo_low = min(promo_rows, key=lambda r: r["balance"])
    tariff_unit_cny = t_rate * float(pr["purchase_unit_cny"]) + t_unit_cny
    ending_stock = result["summary"]["ending_stock"]
    ending_stock_value = (daily[-1]["closing_cost"] if daily else 0.0) + ending_stock * tariff_unit_cny
    team_total = -sum(e["amount_cny"] for e in events if e["kind"] in ("team", "one_off"))
    total_contribution = sum(m["contribution_cny"] for m in monthly)
    summary = dict(
        scenario_name=inp.get("scenario_name", ""), engine_version=VERSION, fx=fx,
        opening_cash_cny=opening_cash, cash_floor_cny=floor,
        min_balance_cny=low["balance"], min_balance_date=low["date"], first_below_floor_date=first_neg, days_below_floor=neg_days,
        promo_low_cny=promo_low["balance"], promo_low_date=promo_low["date"],
        peak_funding_cny=max(0.0, floor - low["balance"]), ending_balance_cny=ledger[-1]["balance"], ending_date=ledger[-1]["date"],
        ending_stock_value_cny=ending_stock_value,
        factory_all_ok=all(f["ok"] for f in factory), factory_gap_max_cny=max([f["gap"] for f in factory] or [0.0]),
        factory_gap_max_date=(max(factory, key=lambda f: f["gap"])["date"] if factory and max(f["gap"] for f in factory) > 0 else None),
        factory_payments_cny=sum(f["amount_cny"] for f in factory if f["kind"] in ("purchase", "freight")),
        tariff_total_cny=sum(f["amount_cny"] for f in factory if f["kind"] == "tariff"),
        team_total_cny=team_total, allocatable_total_cny=allocated,
        ads_total_usd=ads_total, ads_total_cny=ads_total * fx, ads_per_sold_usd=(ads_total / sold_total) if sold_total else None,
        tacos=(ads_total / revenue_total) if revenue_total else None,
        sold_total=sold_total, planned_total=planned_total, lost_total=lost_total, revenue_total_usd=revenue_total,
        promo_window=promo_window, first_receipt_date=first_receipt, first_receipt_cny=first_receipt_cny,
        platform_receipts_cny=sum(e["amount_cny"] for e in plat), stockout_first=stockout_first, zero_stock_first=zero_first,
        ending_stock=ending_stock, total_contribution_cny=total_contribution,
        ad_cap_weighted_usd=(sum(x["ad_cap_per_unit"] * x["planned_qty"] for x in phases) / max(1, sum(x["planned_qty"] for x in phases))) if phases else None,
        ad_cap_weighted_no_credit_usd=(sum(x["ad_cap_no_credit"] * x["planned_qty"] for x in phases) / max(1, sum(x["planned_qty"] for x in phases))) if phases else None,
        ad_per_unit_planned_usd=(sum(x["planned_ads"] for x in phases) / max(1, sum(x["planned_qty"] for x in phases))) if phases else None,
        ads_payment_mode=(inp["promotion"].get("ads_payment", {}) or {}).get("mode", "daily"),
    )
    summary["ad_within_cap"] = (summary["ad_per_unit_planned_usd"] or 0) <= (summary["ad_cap_weighted_usd"] or 0) + 1e-9
    return dict(summary=summary, ledger=ledger, events=events, factory=factory, monthly=monthly, weeks=weeks,
                replenishment=replen, phases=phases, reverse=reverse, warnings=result["warnings"], flags=inp.get("flags", []))


# ---------- 方案对比 ----------

def scenario_matrix(inp):
    cfg = inp.get("matrix") or {}
    coupons = cfg.get("coupon_pcts", [0, 0.2, 0.3])
    paces = cfg.get("paces", {"缓": 0.5, "中": 1.0, "快": 1.5})
    usage = float(cfg.get("coupon_usage", inp["promotion"].get("default_coupon_usage", 0.8)))
    rows = []
    for cpct in coupons:
        for pname, k in paces.items():
            q = copy.deepcopy(inp)
            for ph in q["promotion"]["phases"]:
                ph["coupon_pct"] = cpct
                ph["coupon_usage"] = usage if cpct > 0 else 0
                mode = ph.get("mode", "orders")
                keys = {"orders": ("orders_per_day", "orders_total"), "ads": ("ads_per_day", "ads_total"),
                        "both": ("orders_per_day", "orders_total", "ads_per_day", "ads_total")}[mode]
                for key in keys:
                    if ph.get(key) is not None:
                        ph[key] = [v * k for v in ph[key]] if isinstance(ph[key], list) else ph[key] * k
            q["scenario_name"] = f"coupon {int(round(cpct*100))}% × {pname}推（{k}×）"
            try:
                r = run_scenario(q)
                s = r["summary"]
                rows.append(dict(coupon_pct=cpct, pace=pname, pace_k=k, ok=True, ads_total_usd=s["ads_total_usd"],
                                 sold_total=s["sold_total"], lost_total=s["lost_total"], min_balance_cny=s["min_balance_cny"],
                                 min_balance_date=s["min_balance_date"], factory_all_ok=s["factory_all_ok"],
                                 factory_gap_max_cny=s["factory_gap_max_cny"], ending_balance_cny=s["ending_balance_cny"],
                                 promo_low_cny=s["promo_low_cny"], promo_low_date=s["promo_low_date"],
                                 allocatable_total_cny=s["allocatable_total_cny"], stockout_first=s["stockout_first"],
                                 ad_per_unit_planned_usd=s["ad_per_unit_planned_usd"], ad_cap_weighted_usd=s["ad_cap_weighted_usd"],
                                 ad_within_cap=s["ad_within_cap"], total_contribution_cny=s["total_contribution_cny"],
                                 ending_stock=s["ending_stock"], ending_stock_value_cny=s["ending_stock_value_cny"], peak_funding_cny=s["peak_funding_cny"],
                                 n_replenish=sum(1 for b in r["replenishment"] if b["auto"])))
            except Exception as ex:  # 某格算不出来也不影响别的格
                rows.append(dict(coupon_pct=cpct, pace=pname, pace_k=k, ok=False, error=str(ex)))
    return rows


# ---------- 敏感性扫描：改一个参数，其余不动 ----------

def _set_path(d, path, value):
    parts = path.split(".")
    for k in parts[:-1]:
        d = d[k]
    d[parts[-1]] = value


def sensitivity(inp, field, values):
    """field 形如 product.tariff_rate；返回每个取值的关键结果。"""
    rows = []
    for v in values:
        q = copy.deepcopy(inp)
        _set_path(q, field, v)
        try:
            r = run_scenario(q)
            s = r["summary"]
            rows.append(dict(field=field, value=v, ok=True, ad_cap_weighted_usd=s["ad_cap_weighted_usd"],
                             ad_per_unit_planned_usd=s["ad_per_unit_planned_usd"], ad_within_cap=s["ad_within_cap"],
                             min_balance_cny=s["min_balance_cny"], min_balance_date=s["min_balance_date"],
                             factory_all_ok=s["factory_all_ok"], factory_gap_max_cny=s["factory_gap_max_cny"],
                             tariff_total_cny=s["tariff_total_cny"], ending_balance_cny=s["ending_balance_cny"],
                             allocatable_total_cny=s["allocatable_total_cny"], total_contribution_cny=s["total_contribution_cny"]))
        except Exception as ex:
            rows.append(dict(field=field, value=v, ok=False, error=str(ex)))
    return rows


# ---------- 输出 ----------

def write_outputs(out, out_dir, matrix=None, sweep=None):
    os.makedirs(out_dir, exist_ok=True)
    def w(name, rows, fields=None):
        if not rows:
            return
        fields = fields or list(rows[0].keys())
        with open(os.path.join(out_dir, name), "w", encoding="utf-8-sig", newline="") as f:
            wr = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            wr.writeheader()
            for r in rows:
                wr.writerow({k: (round(v, 2) if isinstance(v, float) else v) for k, v in r.items()})
    w("逐日资金.csv", out["ledger"], ["date", "opening", "inflow", "outflow", "net", "balance", "sales", "refund", "return_fee",
                                      "storage", "coupon_fixed", "coupon_variable", "ads", "purchase", "freight", "tariff", "team", "one_off"])
    w("月度.csv", out["monthly"])
    w("现金事件.csv", out["events"], ["date", "kind", "amount_cny", "source_date", "ref", "timing"])
    w("工厂到期.csv", out["factory"])
    w("回款周表.csv", out["weeks"])
    w("补货批次.csv", out["replenishment"])
    w("推广阶段每件账.csv", out["phases"])
    if matrix:
        w("方案对比.csv", matrix)
    if sweep:
        w("敏感性.csv", sweep)
    slim = {k: v for k, v in out.items() if k not in ("engine_result", "engine_params", "ledger", "events")}
    slim["matrix"] = matrix
    slim["sweep"] = sweep
    with open(os.path.join(out_dir, "结果摘要.json"), "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False, indent=1, default=str)
    with open(os.path.join(out_dir, "引擎输入.json"), "w", encoding="utf-8") as f:
        json.dump(out["engine_params"], f, ensure_ascii=False, indent=1)
