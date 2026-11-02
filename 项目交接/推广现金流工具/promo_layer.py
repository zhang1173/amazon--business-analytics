"""推广杠杆层：把运营填的"推广阶段"翻译成引擎需要的逐日计划和 Coupon 活动。

一个阶段 = 一段日期 + 售价 + coupon + 广告假设（CPC、转化率、广告单占比）+ 单量或广告预算。
三种填法（mode）：
- orders：填每天单量，广告费 = 单量 × 广告单占比 × CPC ÷ 转化率
- ads：   填每天广告预算，广告单 = 预算 ÷ (CPC ÷ 转化率)，总单量 = 广告单 ÷ 广告单占比
- both：  单量和广告费都直接填（同事方案就是这种，CPC/转化率只用来对照）
数值可以写成 [起, 止]，表示在阶段内线性变化（比如 CPC 从 7 降到 3.4）。
"""
import math
from datetime import date, timedelta

from d08_adapter import commission, day, days, first, last, months

DEFAULT_COUPON_FEES = dict(fixed_fee=5.0, variable_rate=0.025, variable_cap=2000.0)


def interp(value, i, n):
    """阶段内第 i 天（0 起）的取值；value 是数或 [起, 止]。"""
    if isinstance(value, (list, tuple)):
        a, b = float(value[0]), float(value[-1])
        return a if n <= 1 else a + (b - a) * i / (n - 1)
    return float(value)


def expand_phases(promotion, horizon):
    """返回 {date: dict(qty, ads, price, coupon_pct, coupon_usage, phase)}，覆盖预测期每一天。"""
    start, end = first(horizon["start_month"]), last(horizon["end_month"])
    plan = {}
    for d in days(start, end):
        plan[d] = dict(qty=0.0, ads=0.0, price=None, coupon_pct=0.0, coupon_usage=0.0, phase=None,
                       cpc=None, cvr=None, ad_share=None)
    for ph in promotion.get("phases", []):
        a, b = day(ph["start"]), day(ph["end"])
        if a > b:
            raise ValueError(f"推广阶段 {ph.get('name')} 的开始日晚于结束日")
        if a < start or b > end:
            raise ValueError(f"推广阶段 {ph.get('name')} 超出预测区间 {start}~{end}")
        n = (b - a).days + 1
        mode = ph.get("mode", "orders")
        for i, d in enumerate(days(a, b)):
            row = plan[d]
            if row["phase"] is not None:
                raise ValueError(f"推广阶段日期重叠：{d}（{row['phase']} 与 {ph.get('name')}）")
            cpc = interp(ph["cpc"], i, n) if ph.get("cpc") is not None else None
            cvr = interp(ph["cvr"], i, n) if ph.get("cvr") is not None else None
            share = interp(ph.get("ad_share", 1.0), i, n)
            cpa = (cpc / cvr) if (cpc is not None and cvr) else None
            if mode == "orders":
                qty = _per_day(ph, "orders", i, n)
                if cpa is None:
                    raise ValueError(f"阶段 {ph.get('name')} 按单量填法需要 CPC 和转化率")
                ads = qty * share * cpa
            elif mode == "ads":
                ads = _per_day(ph, "ads", i, n)
                if cpa is None or share <= 0:
                    raise ValueError(f"阶段 {ph.get('name')} 按预算填法需要 CPC、转化率和广告单占比")
                qty = ads / cpa / share
            elif mode == "both":
                qty = _per_day(ph, "orders", i, n)
                ads = _per_day(ph, "ads", i, n)
            else:
                raise ValueError(f"阶段 {ph.get('name')} 的 mode 只能是 orders / ads / both")
            row.update(qty=qty, ads=ads, price=float(ph["price_usd"]),
                       coupon_pct=float(ph.get("coupon_pct", 0) or 0),
                       coupon_usage=float(ph.get("coupon_usage", 0) or 0),
                       phase=ph.get("name", f"{ph['start']}~{ph['end']}"), cpc=cpc, cvr=cvr, ad_share=share)
    # 没被阶段覆盖的日子：沿用最近一个阶段的售价（引擎要求每天有售价），单量广告为 0
    last_price = None
    for d in sorted(plan):
        if plan[d]["price"] is None:
            plan[d]["price"] = last_price
        else:
            last_price = plan[d]["price"]
    first_price = next((plan[d]["price"] for d in sorted(plan) if plan[d]["price"] is not None), None)
    for d in plan:
        if plan[d]["price"] is None:
            plan[d]["price"] = first_price or 19.99
    return plan


def _per_day(ph, key, i, n):
    if ph.get(key + "_per_day") is not None:
        return interp(ph[key + "_per_day"], i, n)
    if ph.get(key + "_total") is not None:
        total = float(ph[key + "_total"])
        shape = ph.get(key + "_shape")  # 可选 [起权重, 止权重]，默认均匀
        if shape:
            w = [interp(shape, j, n) for j in range(n)]
            return total * w[i] / sum(w)
        return total / n
    raise ValueError(f"阶段 {ph.get('name')} 缺 {key}_per_day 或 {key}_total")


def round_with_carry(values):
    """把小数单量变成整数，累计舍入，总数不变。"""
    out, cum, prev = [], 0.0, 0
    for v in values:
        cum += v
        r = int(math.floor(cum + 0.5))
        out.append(r - prev)
        prev = r
    return out


def build_months_and_coupons(plan, horizon, product, promotion):
    """生成引擎的 months[]（daily 模式）和 coupons[]。"""
    fees = {k: promotion.get("coupon_" + k, v) for k, v in
            dict(fixed_fee_usd=DEFAULT_COUPON_FEES["fixed_fee"], variable_rate=DEFAULT_COUPON_FEES["variable_rate"],
                 variable_cap_usd=DEFAULT_COUPON_FEES["variable_cap"]).items()}
    fees_custom = (float(fees["fixed_fee_usd"]) != DEFAULT_COUPON_FEES["fixed_fee"] or float(fees["variable_rate"]) != DEFAULT_COUPON_FEES["variable_rate"]
                   or float(fees["variable_cap_usd"]) != DEFAULT_COUPON_FEES["variable_cap"])
    # 引擎规定：自定义 coupon 费用必须写来源；这里自动带上输入表里的备注
    fee_note = (promotion.get("coupon_fee_note") or "输入表自定义 coupon 费用（promotion.coupon_fixed_fee_usd / coupon_variable_rate / coupon_variable_cap_usd），来源待确认") if fees_custom else ""
    dates = sorted(plan)
    qtys = round_with_carry([plan[d]["qty"] for d in dates])
    peak = (day(product["peak_start"]), day(product["peak_end"])) if product.get("peak_start") and product.get("peak_end") else None
    rows_by_month = {}
    for d, q in zip(dates, qtys):
        r = plan[d]
        m = d.strftime("%Y-%m")
        in_peak = bool(peak and peak[0] <= d <= peak[1])
        fba = product.get("fba_peak_usd") if in_peak and product.get("fba_peak_usd") is not None else product["fba_standard_usd"]
        rows_by_month.setdefault(m, []).append(dict(
            date=d.isoformat(), qty=int(q), ads=round(float(r["ads"]), 4), price=round(float(r["price"]), 2),
            coupon_share=(r["coupon_usage"] if r["coupon_pct"] > 0 else None), fba_standard=float(fba)))
    months_rows = []
    for m in months(horizon["start_month"], horizon["end_month"]):
        drows = rows_by_month.get(m, [])
        storage = product["storage_unit_usd_month"]
        if product.get("storage_peak_usd_month") is not None and int(m[5:]) in (10, 11, 12):
            storage = product["storage_peak_usd_month"]
        months_rows.append(dict(month=m, mode="daily", qty=sum(x["qty"] for x in drows),
                                ads=sum(x["ads"] for x in drows), price=drows[0]["price"] if drows else 19.99,
                                price_lines=[], days=drows, storage_unit=float(storage),
                                pause_sales=False, pause_ads=False))
    # Coupon 活动：同一折扣连续的日子切成 ≤30 天一段（引擎规定单个活动最长 30 天、不重叠）
    coupons = []
    run_start, run_pct = None, 0.0
    def close(run_end):
        nonlocal run_start, run_pct
        if run_start is None or run_pct <= 0:
            run_start, run_pct = None, 0.0
            return
        a = run_start
        while a <= run_end:
            b = min(run_end, a + timedelta(days=29))
            coupons.append(dict(id=f"CP-{a.isoformat()}", name=f"Coupon {int(round(run_pct*100))}% {a}~{b}",
                                start=a.isoformat(), end=b.isoformat(), discount_type="percent", discount=run_pct,
                                fixed_fee=fees["fixed_fee_usd"], variable_rate=fees["variable_rate"],
                                variable_cap=fees["variable_cap_usd"], status="active", fee_note=fee_note))
            a = b + timedelta(days=1)
        run_start, run_pct = None, 0.0
    prev = None
    for d in dates:
        pct = plan[d]["coupon_pct"]
        if pct != run_pct:
            close(prev) if prev else None
            run_start, run_pct = (d, pct) if pct > 0 else (None, 0.0)
        prev = d
    close(prev)
    for c in coupons:
        if not 0.05 <= c["discount"] <= 0.5:
            raise ValueError("Coupon 折扣只接受 5%~50%（引擎规则）")
    return months_rows, coupons


def _weighted_fees(ph, product, day_weights):
    """按阶段日期（可带权重）算平均 FBA 和月仓储单价：旺季窗口内用 fba_peak，10–12 月用 storage_peak（和引擎同口径）。"""
    fba_std = float(product["fba_standard_usd"])
    st_std = float(product["storage_unit_usd_month"])
    if day_weights is None and ph.get("start") and ph.get("end"):
        a, b = day(ph["start"]), day(ph["end"])
        day_weights = [(d.isoformat(), 1.0) for d in days(a, b)]
    if not day_weights or sum(w for _, w in day_weights) <= 0:
        if day_weights:
            day_weights = [(d, 1.0) for d, _ in day_weights]
        else:
            return fba_std, st_std
    peak = (day(product["peak_start"]), day(product["peak_end"])) if product.get("peak_start") and product.get("peak_end") else None
    fba_peak = product.get("fba_peak_usd")
    st_peak = product.get("storage_peak_usd_month")
    tw = fba_sum = st_sum = 0.0
    for d_iso, w in day_weights:
        d = day(d_iso)
        in_peak = bool(peak and peak[0] <= d <= peak[1])
        fba_sum += w * (float(fba_peak) if in_peak and fba_peak is not None else fba_std)
        st_sum += w * (float(st_peak) if st_peak is not None and d.month in (10, 11, 12) else st_std)
        tw += w
    return fba_sum / tw, st_sum / tw


def unit_economics(ph, product, fx, storage_days=45, day_weights=None):
    """一件货的账（美元）：按定稿口径 + 同事引擎的退款/佣金/coupon 公式。不含广告。
    day_weights=[(日期, 权重)] 用来按旺季窗口加权 FBA 和仓储；不给时按阶段 start~end 每天等权。"""
    P = float(ph["price_usd"])
    c = float(ph.get("coupon_pct", 0) or 0)
    u = float(ph.get("coupon_usage", 0) or 0) if c > 0 else 0.0
    N = P * (1 - c)
    rate_g, comm_g = commission(P)
    rate_n, comm_n = commission(N)
    fba_avg, storage_unit = _weighted_fees(ph, product, day_weights)
    fba = float(ph.get("fba_usd") or fba_avg)
    r, s = product["refund_rate"], product["sellable_rate"]
    landed_cny = float(ph.get("unit_cost_cny") or (product["purchase_unit_cny"] + product["sea_freight_cny"]))
    tariff = float(product.get("tariff_usd_per_unit", 0) or 0) + float(product.get("tariff_rate", 0) or 0) * product["purchase_unit_cny"] / fx
    landed_usd = landed_cny / fx + tariff
    avg_price = (1 - u) * P + u * N
    avg_comm = (1 - u) * comm_g + u * comm_n
    refund = (1 - u) * r * (P - comm_g + min(5, comm_g * .2)) + u * r * (N - comm_n + min(5, comm_n * .2))
    return_fee = r * product["return_fee_usd"]
    coupon_fee = u * N * float(ph.get("coupon_variable_rate", DEFAULT_COUPON_FEES["variable_rate"]))
    storage = storage_unit * storage_days / 30
    sellable_credit = r * s * landed_usd
    platform_net = avg_price - avg_comm - fba - refund - return_fee - coupon_fee
    remainder = platform_net - storage - landed_usd + sellable_credit
    cpa = (float(ph["cpc"] if not isinstance(ph["cpc"], list) else sum(ph["cpc"]) / 2) /
           float(ph["cvr"] if not isinstance(ph["cvr"], list) else sum(ph["cvr"]) / 2)) if ph.get("cpc") and ph.get("cvr") else None
    share = ph.get("ad_share", 1.0)
    share = float(share if not isinstance(share, list) else sum(share) / 2)
    planned_ad_per_unit = cpa * share if cpa else None
    return dict(price=P, coupon_pct=c, coupon_usage=u, net_price=N, avg_price=avg_price,
                commission=avg_comm, fba=fba, refund=refund, return_fee=return_fee, coupon_fee=coupon_fee,
                storage=storage, platform_net=platform_net, landed_usd=landed_usd, tariff_usd=tariff,
                sellable_credit=sellable_credit, remainder_before_ads=remainder,
                ad_cap_per_unit=max(0.0, remainder), tacos_cap=(max(0.0, remainder) / avg_price if avg_price else 0),
                ad_cap_no_credit=max(0.0, remainder - sellable_credit),
                tacos_cap_no_credit=(max(0.0, remainder - sellable_credit) / avg_price if avg_price else 0),
                cpa=cpa, ad_share=share, planned_ad_per_unit=planned_ad_per_unit,
                remainder_after_ads=(remainder - planned_ad_per_unit) if planned_ad_per_unit is not None else None)
