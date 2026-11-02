"""Excel 输入表：读（纯标准库，zipfile + xml）和写模板（需要 openpyxl，只在生成模板时用）。

输入表有 9 个页签：说明、参数、推广阶段、发货批次、计划补货批次、团队开支、一次性费用、回款分布、待确认。
读出来的结构和 inputs/*.json 完全一样，所以两种输入文件可以互换。
"""
import datetime as dt
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}

# 参数页：分组, 字段路径, 显示名, 单位, 说明
PARAMS = [
    ("方案", "scenario_name", "方案名称", "", "报告标题"),
    ("方案", "product_name", "产品", "", ""),
    ("时间", "horizon.start_month", "预测起月", "YYYY-MM", "现金和销售从这个月 1 号开始算"),
    ("时间", "horizon.end_month", "预测止月", "YYYY-MM", "推广阶段必须落在起止月内；货款到期晚于止月也会算进去"),
    ("时间", "horizon.storage_end_month", "仓储测算止月", "YYYY-MM", "一般和预测止月相同"),
    ("时间", "horizon.payout_anchor", "打款锚点日", "YYYY-MM-DD", "亚马逊 14 天一次打款，填最近一次打款日"),
    ("时间", "horizon.bank_delay_days", "打款到可用天数", "天", "平台打款到银行可用的延迟，默认 0"),
    ("时间", "horizon.stress_days", "慢回款压力测试天数", "天", "引擎的压力口径，默认 1"),
    ("产品", "product.fx", "汇率 CNY/USD", "", ""),
    ("产品", "product.purchase_unit_cny", "补货采购单价", "元/件", "第二批及以后的采购价；首批在发货批次页填"),
    ("产品", "product.sea_freight_cny", "海运头程单价", "元/件", ""),
    ("产品", "product.air_freight_cny", "空运头程单价", "元/件", ""),
    ("产品", "product.tariff_usd_per_unit", "关税 每件", "美元/件", "头程不包税时填；包税填 0。最优先确认"),
    ("产品", "product.tariff_rate", "关税 按采购价比例", "0~1", "和每件关税二选一或叠加"),
    ("产品", "product.tariff_days_after_arrival", "关税在到仓后几天付", "天", ""),
    ("产品", "product.fba_standard_usd", "FBA 配送费（淡季）", "美元/件", ""),
    ("产品", "product.fba_peak_usd", "FBA 配送费（旺季）", "美元/件", "空 = 不分淡旺季"),
    ("产品", "product.peak_start", "旺季起", "YYYY-MM-DD", ""),
    ("产品", "product.peak_end", "旺季止", "YYYY-MM-DD", ""),
    ("产品", "product.storage_unit_usd_month", "仓储费（淡季）", "美元/件/月", "按日末库存算"),
    ("产品", "product.storage_peak_usd_month", "仓储费（10–12 月）", "美元/件/月", "空 = 全年一样"),
    ("产品", "product.refund_rate", "退货率", "0~1", ""),
    ("产品", "product.sellable_rate", "退回可再售比例", "0~1", "可再售的按成本回库"),
    ("产品", "product.refund_lag", "退款滞后", "天", ""),
    ("产品", "product.return_lag", "退货回库滞后", "天", ""),
    ("产品", "product.return_fee_usd", "退货处理费", "美元/件", ""),
    ("产品", "product.gift_rate", "赠品比例", "0~1", "默认 0"),
    ("补货", "replenishment.strategy", "补货方式", "sea/air/hybrid/off", "off = 不自动补货"),
    ("补货", "replenishment.trigger", "补货触发", "forecast/sellout", "forecast = 按覆盖天数每周复核；sellout = 卖空再下单"),
    ("补货", "replenishment.production_days", "做货天数", "天", ""),
    ("补货", "replenishment.sea_days", "海运天数", "天", ""),
    ("补货", "replenishment.air_days", "空运天数", "天", ""),
    ("补货", "replenishment.cover_days", "正常覆盖天数", "天", "到货后要能卖多少天"),
    ("补货", "replenishment.safety_days", "安全缓冲天数", "天", ""),
    ("补货", "replenishment.purchase_months", "补货货款账期", "月", "从发货日起算；0 = 发货时付"),
    ("补货", "replenishment.freight_days", "补货头程账期", "天", "从发货日起算"),
    ("补货", "replenishment.stop_ads_when_out_of_stock", "断货时停广告", "是/否", ""),
    ("广告", "promotion.ads_payment.mode", "广告出账方式", "daily/balance/card", "daily 花费当天；balance 下个打款日从余额扣；card 信用卡还款日"),
    ("广告", "promotion.ads_payment.card_pay_day", "信用卡还款日", "每月几号", ""),
    ("广告", "promotion.ads_payment.card_min_lag_days", "刷卡到还款最少天数", "天", ""),
    ("广告", "promotion.default_coupon_usage", "方案对比用的 coupon 使用率", "0~1", ""),
    ("广告", "promotion.avg_stock_days", "每件账用的平均在库天数", "天", "只影响每件账里的仓储估算"),
    ("广告", "promotion.coupon_fixed_fee_usd", "Coupon 固定费", "美元/活动", ""),
    ("广告", "promotion.coupon_variable_rate", "Coupon 变动费率", "0~1", ""),
    ("广告", "promotion.coupon_variable_cap_usd", "Coupon 变动费上限", "美元/活动", ""),
    ("广告", "promotion.coupon_fee_note", "Coupon 费用来源备注", "文字", "改了 coupon 费用时写来源；不写会自动标“来源待确认”"),
    ("资金", "cash.opening_cash_cny", "起点现金", "元", "现在能周转的现金"),
    ("资金", "cash.cash_floor_cny", "现金底线", "元", "余额不能低于这个数；算可拨金额用"),
    ("资金", "inventory.tariff_paid_before_start", "起点前到货的关税已付", "是/否", ""),
    ("对比", "matrix.coupon_pcts", "方案对比 coupon 档", "逗号分隔", "例：0, 0.2, 0.3"),
    ("对比", "matrix.paces", "方案对比 推广节奏", "名=倍数，逗号分隔", "例：缓=0.5, 中=1, 快=1.5"),
    ("对比", "matrix.coupon_usage", "方案对比 coupon 使用率", "0~1", ""),
]

PHASE_COLS = [("name", "阶段名"), ("start", "开始日"), ("end", "结束日"), ("mode", "填法 orders/ads/both"),
              ("orders_per_day", "每天单量"), ("orders_per_day_to", "每天单量(止)"), ("orders_total", "阶段总单量"),
              ("orders_shape", "单量形状 起:止"),
              ("ads_per_day", "每天广告 $"), ("ads_per_day_to", "每天广告 $(止)"), ("ads_total", "阶段总广告 $"), ("ads_shape", "广告形状 起:止"),
              ("price_usd", "前台售价 $"), ("coupon_pct", "coupon 折扣"), ("coupon_usage", "coupon 使用率"),
              ("cpc", "CPC $"), ("cpc_to", "CPC $(止)"), ("cvr", "转化率"), ("ad_share", "广告单占比"), ("ad_share_to", "广告单占比(止)")]
SHIP_COLS = [("id", "批次编号"), ("qty", "发货数量"), ("remaining_qty", "起点剩余"), ("purchase_unit_cny", "采购单价 元"), ("freight_unit_cny", "头程单价 元"),
             ("mode", "方式 sea/air"), ("ship_date", "发货日"), ("arrival_date", "到仓可售日"),
             ("purchase_payment", "货款 terms/paid/unpaid"), ("purchase_months", "货款账期 月"), ("purchase_pay_date", "货款付款日"),
             ("freight_payment", "头程 terms/paid/unpaid"), ("freight_days", "头程账期 天"), ("freight_pay_date", "头程付款日")]
BATCH_COLS = [("id", "批次编号"), ("qty", "数量"), ("order_date", "下单日"), ("ship_date", "发货日"), ("arrival_date", "到仓可售日"),
              ("purchase_unit_cny", "采购单价 元"), ("freight_unit_cny", "头程单价 元"), ("purchase_pay_date", "货款付款日"), ("freight_pay_date", "头程付款日")]
TEAM_COLS = [("name", "名称"), ("amount_cny", "每月金额 元"), ("pay_day", "每月几号付"), ("start_month", "起月"), ("end_month", "止月")]
ONEOFF_COLS = [("name", "名称"), ("amount_cny", "金额 元"), ("date", "日期")]
FLAG_COLS = [("status", "状态"), ("field", "字段"), ("value", "现在用的值"), ("note", "说明")]
DATE_KEYS = {"start", "end", "ship_date", "arrival_date", "purchase_pay_date", "freight_pay_date", "order_date", "date",
             "horizon.payout_anchor", "product.peak_start", "product.peak_end"}
MONTH_KEYS = {"start_month", "end_month", "horizon.start_month", "horizon.end_month", "horizon.storage_end_month"}


# ---------- 读 ----------

def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def read_workbook(path):
    """返回 {sheet名: [[cell,...], ...]}；数字为 float，其余为 str，空为 None。"""
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid_to_target = {r.get("Id"): r.get("Target") for r in rels}
        sheets = {}
        for sh in wb.find("m:sheets", NS):
            rid = sh.get("{%s}id" % NS["r"])
            target = rid_to_target[rid]
            target = target.lstrip("/") if target.startswith("/") else ("xl/" + target if not target.startswith("xl/") else target)
            root = ET.fromstring(z.read(target))
            rows = []
            for row in root.iter("{%s}row" % NS["m"]):
                cells = []
                for c in row.findall("m:c", NS):
                    idx = _col_index(c.get("r"))
                    while len(cells) < idx:
                        cells.append(None)
                    t = c.get("t")
                    v = c.find("m:v", NS)
                    if t == "s" and v is not None:
                        val = shared[int(v.text)]
                    elif t == "inlineStr":
                        val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                    elif t == "b" and v is not None:
                        val = v.text == "1"
                    elif v is not None and v.text not in (None, ""):
                        try:
                            val = float(v.text)
                        except ValueError:
                            val = v.text
                    else:
                        val = None
                    cells.append(val)
                rows.append(cells)
            sheets[sh.get("name")] = rows
    return sheets


def _serial_to_date(n):
    return (dt.date(1899, 12, 30) + dt.timedelta(days=int(n))).isoformat()


def _date(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return _serial_to_date(v)
    s = str(v).strip()
    m = re.match(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})", s)
    if m:
        return "%04d-%02d-%02d" % tuple(int(x) for x in m.groups())
    return s


def _month(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return _serial_to_date(v)[:7]
    s = str(v).strip()
    m = re.match(r"(\d{4})[-/.](\d{1,2})", s)
    return "%04d-%02d" % (int(m.group(1)), int(m.group(2))) if m else s


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return int(v) if float(v).is_integer() else float(v)
    s = str(v).strip().replace(",", "").replace("¥", "").replace("$", "")
    if s.endswith("%"):
        return float(s[:-1]) / 100
    try:
        f = float(s)
        return int(f) if f.is_integer() else f
    except ValueError:
        return s


def _bool(v):
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in ("是", "true", "yes", "y", "1", "1.0")


def _table(rows, cols):
    """按表头名把一个页签读成 [dict]。第一行是表头。"""
    if not rows:
        return []
    header = [str(h).strip() if h is not None else "" for h in rows[0]]
    label_to_key = {label: key for key, label in cols}
    keys = [label_to_key.get(h) for h in header]
    out = []
    for r in rows[1:]:
        if not any(x not in (None, "") for x in r):
            continue
        d = {}
        for k, v in zip(keys, r):
            if k is None or v in (None, ""):
                continue
            d[k] = v
        if d:
            out.append(d)
    return out


def _set(d, path, value):
    parts = path.split(".")
    for p in parts[:-1]:
        d = d.setdefault(p, {})
    d[parts[-1]] = value


def _pair(row, key):
    """'每天单量' + '每天单量(止)' → 数或 [起, 止]。"""
    a, b = row.get(key), row.get(key + "_to")
    if a in (None, ""):
        return None
    a = _num(a)
    if b in (None, ""):
        return a
    return [a, _num(b)]


def _shape(v):
    if v in (None, ""):
        return None
    s = str(v).replace("：", ":").replace(",", ":")
    a, b = s.split(":")[:2]
    return [float(a), float(b)]


def read_input(path):
    sheets = read_workbook(path)
    inp = {}
    # 参数
    for r in sheets.get("参数", [])[1:]:
        if len(r) < 4 or not r[1]:
            continue
        key, val = str(r[1]).strip(), r[3]
        if val in (None, ""):
            continue
        if key in MONTH_KEYS:
            val = _month(val)
        elif key in DATE_KEYS:
            val = _date(val)
        elif key in ("replenishment.stop_ads_when_out_of_stock", "inventory.tariff_paid_before_start"):
            val = _bool(val)
        elif key == "matrix.coupon_pcts":
            val = [float(x) for x in re.split(r"[,，\s]+", str(val).strip()) if x]
        elif key == "matrix.paces":
            paces = {}
            for item in re.split(r"[,，]\s*", str(val).replace("＝", "=").replace("：", "=").replace(":", "=").strip()):
                if "=" in item:
                    n, k = item.split("=", 1)
                    paces[n.strip()] = float(k)
            val = paces
        elif key in ("scenario_name", "product_name", "replenishment.strategy", "replenishment.trigger", "promotion.ads_payment.mode"):
            val = str(val).strip()
        else:
            val = _num(val)
        _set(inp, key, val)
    # 推广阶段
    phases = []
    for r in _table(sheets.get("推广阶段", []), PHASE_COLS):
        ph = dict(name=str(r.get("name", "")), start=_date(r.get("start")), end=_date(r.get("end")),
                  mode=str(r.get("mode", "orders")).strip(), price_usd=_num(r.get("price_usd")),
                  coupon_pct=_num(r.get("coupon_pct")) or 0, coupon_usage=_num(r.get("coupon_usage")) or 0,
                  cvr=_num(r.get("cvr")))
        for k in ("orders_per_day", "ads_per_day", "cpc", "ad_share"):
            v = _pair(r, k)
            if v is not None:
                ph[k] = v
        for k in ("orders_total", "ads_total"):
            if r.get(k) not in (None, ""):
                ph[k] = _num(r[k])
        for k in ("orders_shape", "ads_shape"):
            v = _shape(r.get(k))
            if v:
                ph[k] = v
        phases.append(ph)
    inp.setdefault("promotion", {})["phases"] = phases
    # 发货批次
    ships = []
    for r in _table(sheets.get("发货批次", []), SHIP_COLS):
        s = dict(id=str(r["id"]), qty=_num(r["qty"]), purchase_unit_cny=_num(r["purchase_unit_cny"]), freight_unit_cny=_num(r["freight_unit_cny"]),
                 mode=str(r.get("mode", "sea")).strip(), ship_date=_date(r["ship_date"]))
        if r.get("remaining_qty") not in (None, ""):
            s["remaining_qty"] = _num(r["remaining_qty"])
        if r.get("arrival_date"):
            s["arrival_date"] = _date(r["arrival_date"])
        for kind in ("purchase", "freight"):
            s[kind + "_payment"] = str(r.get(kind + "_payment", "terms")).strip()
            if r.get(kind + "_pay_date"):
                s[kind + "_pay_date"] = _date(r[kind + "_pay_date"])
        if r.get("purchase_months") not in (None, ""):
            s["purchase_months"] = _num(r["purchase_months"])
        if r.get("freight_days") not in (None, ""):
            s["freight_days"] = _num(r["freight_days"])
        ships.append(s)
    inp.setdefault("inventory", {})["shipments"] = ships
    batches = []
    for r in _table(sheets.get("计划补货批次", []), BATCH_COLS):
        b = {k: (_date(v) if k in DATE_KEYS else _num(v) if k != "id" else str(v)) for k, v in r.items()}
        batches.append(b)
    inp["inventory"]["planned_batches"] = batches
    inp.setdefault("cash", {})["team_expenses"] = [
        dict(name=str(r.get("name", "团队开支")), amount_cny=_num(r.get("amount_cny")) or 0, pay_day=_num(r.get("pay_day")) or 10,
             start_month=_month(r.get("start_month")), end_month=_month(r.get("end_month")))
        for r in _table(sheets.get("团队开支", []), TEAM_COLS)]
    inp["cash"]["one_off_expenses"] = [dict(name=str(r.get("name", "")), amount_cny=_num(r.get("amount_cny")) or 0, date=_date(r.get("date")))
                                       for r in _table(sheets.get("一次性费用", []), ONEOFF_COLS)]
    dist = []
    for r in sheets.get("回款分布", [])[1:]:
        if len(r) >= 2 and r[0] not in (None, "") and r[1] not in (None, ""):
            dist.append(dict(days=int(float(r[0])), weight=float(r[1])))
    if dist:
        total = sum(x["weight"] for x in dist)
        for x in dist:
            x["weight"] /= total
        inp["release_distribution"] = dist
    inp["flags"] = [dict(status=str(r.get("status", "")), field=str(r.get("field", "")), value=str(r.get("value", "")), note=str(r.get("note", "")))
                    for r in _table(sheets.get("待确认", []), FLAG_COLS)]
    inp.setdefault("product", {})
    inp.setdefault("horizon", {})
    inp.setdefault("replenishment", {}).setdefault("shortage_mode", "lost")
    return inp


# ---------- 写模板 ----------

def _get(d, path):
    for p in path.split("."):
        if not isinstance(d, dict) or p not in d:
            return None
        d = d[p]
    return d


def write_template(path, inp):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    wb = Workbook()
    head = Font(bold=True)
    fill_head = PatternFill("solid", fgColor="E8EEF2")
    fill_flag = PatternFill("solid", fgColor="FFF2CC")
    fill_top = PatternFill("solid", fgColor="F8D7D3")
    flag_fields = {f.get("field", "").split("[")[0]: f.get("status", "") for f in inp.get("flags", [])}

    def sheet(title, headers, widths=None):
        ws = wb.create_sheet(title) if wb.worksheets and wb.worksheets[0].title != "Sheet" else wb.active
        ws.title = title
        ws.append(headers)
        for c in ws[1]:
            c.font, c.fill = head, fill_head
        ws.freeze_panes = "A2"
        for i, w in enumerate(widths or [], 1):
            ws.column_dimensions[get_column_letter(i)].width = w
        return ws

    ws = sheet("说明", ["推广 × 现金流 平衡工具 · 输入表"], [110])
    for line in [
        "1. 黄色行是待确认的参数，红色行最优先确认。填完就把状态改掉。",
        "2. 参数页只改“值”这一列；字段列是程序用的名字，不要改。",
        "3. 推广阶段：一行一个阶段，日期不能重叠。填法 orders = 填单量算广告；ads = 填广告预算算单量；both = 两个都填。",
        "   '每天单量' 和 '每天单量(止)' 都填表示阶段内线性变化；只填 '阶段总单量' 则按形状（起:止 权重）分配到每天。",
        "4. 发货批次：已发或已到的货。货款 terms = 按账期（发货日 + 账期月）；paid = 已付（填实际付款日，须早于预测起月）；unpaid = 未付（填预计付款日）。",
        "5. 团队开支：每月固定开支，按'每月几号付'出账。一次性费用：上新、拍摄、Vine 等。",
        "6. 回款分布：历史订单从下单到释放的天数分布（默认 TM 店铺 68,057 单），可换成本店铺数据。",
        "7. 运行：python3 run.py 输入表.xlsx --matrix ；结果在 输出/<方案名>/报告.html。",
        "口径：现金按人民币，货款按工厂账期到期日付，缺货按丢单，广告按所选出账方式，回款按释放分布 + 14 天打款日历。",
    ]:
        ws.append([line])
    ws = sheet("参数", ["分组", "字段（勿改）", "参数", "值", "单位", "状态", "说明"], [8, 42, 28, 24, 18, 12, 60])
    for group, key, label, unit, note in PARAMS:
        v = _get(inp, key)
        if key == "matrix.coupon_pcts" and isinstance(v, list):
            v = ", ".join(str(x) for x in v)
        elif key == "matrix.paces" and isinstance(v, dict):
            v = ", ".join(f"{k}={x}" for k, x in v.items())
        elif isinstance(v, bool):
            v = "是" if v else "否"
        status = flag_fields.get(key, "")
        ws.append([group, key, label, v, unit, status, note])
        if status:
            for c in ws[ws.max_row]:
                c.fill = fill_top if "优先" in status else fill_flag
    ws.column_dimensions["D"].alignment = Alignment(horizontal="left")
    ws = sheet("推广阶段", [l for _, l in PHASE_COLS], [26, 12, 12, 16] + [12] * 16)
    for ph in inp.get("promotion", {}).get("phases", []):
        row = []
        for key, _ in PHASE_COLS:
            if key.endswith("_to"):
                base = ph.get(key[:-3])
                row.append(base[1] if isinstance(base, list) else None)
            elif key.endswith("_shape"):
                v = ph.get(key)
                row.append(f"{v[0]}:{v[1]}" if v else None)
            else:
                v = ph.get(key)
                row.append(v[0] if isinstance(v, list) else v)
        ws.append(row)
    ws = sheet("发货批次", [l for _, l in SHIP_COLS], [12] * 14)
    for s in inp.get("inventory", {}).get("shipments", []):
        ws.append([s.get(k) for k, _ in SHIP_COLS])
    ws = sheet("计划补货批次", [l for _, l in BATCH_COLS], [16] + [12] * 8)
    for b in inp.get("inventory", {}).get("planned_batches", []):
        ws.append([b.get(k) for k, _ in BATCH_COLS])
    ws = sheet("团队开支", [l for _, l in TEAM_COLS], [30, 14, 12, 10, 10])
    for t in inp.get("cash", {}).get("team_expenses", []):
        ws.append([t.get(k) for k, _ in TEAM_COLS])
    ws = sheet("一次性费用", [l for _, l in ONEOFF_COLS], [30, 14, 12])
    for t in inp.get("cash", {}).get("one_off_expenses", []):
        ws.append([t.get(k) for k, _ in ONEOFF_COLS])
    ws = sheet("回款分布", ["释放天数", "权重"], [12, 22])
    for r in inp.get("release_distribution", []):
        ws.append([r["days"], r["weight"]])
    ws = sheet("待确认", [l for _, l in FLAG_COLS], [12, 44, 36, 70])
    for f in inp.get("flags", []):
        ws.append([f.get(k) for k, _ in FLAG_COLS])
        for c in ws[ws.max_row]:
            c.fill = fill_top if "优先" in f.get("status", "") else fill_flag
    wb.save(path)
    return path
