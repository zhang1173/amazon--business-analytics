"""工具自检：python3 -m unittest tests.test_tool  （在工具目录运行）"""
import copy
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import cash_layer  # noqa: E402
import promo_layer  # noqa: E402
import xlsx_io  # noqa: E402

DEFAULT = os.path.join(ROOT, "inputs", "Y背默认.json")


def load():
    return cash_layer.load_input(DEFAULT)


class PromoLayer(unittest.TestCase):
    def test_round_with_carry_keeps_total(self):
        vals = [4.73] * 30
        r = promo_layer.round_with_carry(vals)
        self.assertEqual(sum(r), 142)
        self.assertTrue(all(isinstance(x, int) for x in r))

    def test_orders_mode_derives_ads_from_cpc_cvr(self):
        inp = load()
        inp["promotion"]["phases"] = [dict(name="t", start="2026-11-01", end="2026-11-10", mode="orders",
                                           orders_per_day=100, price_usd=24.83, cpc=2.0, cvr=0.1, ad_share=0.5)]
        plan = promo_layer.expand_phases(inp["promotion"], inp["horizon"])
        d = plan[promo_layer.day("2026-11-01")]
        self.assertAlmostEqual(d["ads"], 100 * 0.5 * 2.0 / 0.1)  # 1000 美元/天

    def test_ads_mode_derives_orders(self):
        inp = load()
        inp["promotion"]["phases"] = [dict(name="t", start="2026-11-01", end="2026-11-10", mode="ads",
                                           ads_per_day=1000, price_usd=24.83, cpc=2.0, cvr=0.1, ad_share=0.5)]
        plan = promo_layer.expand_phases(inp["promotion"], inp["horizon"])
        self.assertAlmostEqual(plan[promo_layer.day("2026-11-05")]["qty"], 100)

    def test_coupon_split_into_30_day_activities(self):
        inp = load()
        inp["promotion"]["phases"] = [dict(name="t", start="2026-11-01", end="2027-01-15", mode="orders",
                                           orders_per_day=10, price_usd=29.99, coupon_pct=0.3, coupon_usage=0.8, cpc=2, cvr=0.1, ad_share=0.5)]
        plan = promo_layer.expand_phases(inp["promotion"], inp["horizon"])
        _, coupons = promo_layer.build_months_and_coupons(plan, inp["horizon"], inp["product"], inp["promotion"])
        self.assertEqual(len(coupons), 3)  # 76 天 → 30 + 30 + 16
        self.assertEqual(coupons[0]["start"], "2026-11-01")
        self.assertEqual(coupons[-1]["end"], "2027-01-15")

    def test_unit_economics_matches_finalized_doc_direction(self):
        # 定稿：$29.99 + 30% coupon 80% 使用 → 平均成交价 $22.79
        inp = load()
        ph = dict(price_usd=29.99, coupon_pct=0.3, coupon_usage=0.8, cpc=3.4, cvr=0.12, ad_share=0.6)
        ue = promo_layer.unit_economics(ph, inp["product"], 6.7)
        self.assertAlmostEqual(ue["avg_price"], 22.79, places=2)
        self.assertLess(ue["ad_cap_per_unit"], 3)  # 每件剩的钱很少
        self.assertGreater(ue["planned_ad_per_unit"], 15)  # CPC÷CVR×占比 = $17


    def test_peak_window_raises_fba_and_storage_in_unit_economics(self):
        inp = load()
        pr = dict(inp["product"], fba_peak_usd=6.63, peak_start="2026-11-07", peak_end="2027-01-14", storage_peak_usd_month=0.27)
        ph = dict(name="t", start="2026-11-07", end="2026-11-17", price_usd=24.83, cpc=3.4, cvr=0.12, ad_share=0.6)
        ue = promo_layer.unit_economics(ph, pr, 6.7)
        base = promo_layer.unit_economics(ph, inp["product"], 6.7)
        self.assertAlmostEqual(ue["fba"], 6.63)
        self.assertAlmostEqual(ue["storage"], 0.27 * 45 / 30)
        self.assertLess(ue["ad_cap_per_unit"], base["ad_cap_per_unit"] - 0.3)  # FBA +0.13、仓储 +0.24
        self.assertAlmostEqual(ue["ad_cap_no_credit"], max(0, ue["remainder_before_ads"] - ue["sellable_credit"]))

    def test_custom_coupon_fee_gets_fee_note(self):
        inp = load()
        inp["promotion"]["coupon_fixed_fee_usd"] = 6
        inp["promotion"]["phases"] = [dict(name="t", start="2026-11-01", end="2026-11-10", mode="orders",
                                           orders_per_day=10, price_usd=29.99, coupon_pct=0.3, coupon_usage=0.8, cpc=2, cvr=0.1, ad_share=0.5)]
        plan = promo_layer.expand_phases(inp["promotion"], inp["horizon"])
        _, coupons = promo_layer.build_months_and_coupons(plan, inp["horizon"], inp["product"], inp["promotion"])
        self.assertTrue(coupons[0]["fee_note"])
        out = cash_layer.run_scenario(inp)  # 引擎不再因缺来源报错
        self.assertGreater(out["summary"]["sold_total"], 0)


class CashLayer(unittest.TestCase):
    def test_factory_gap_is_max_not_sum(self):
        out = cash_layer.run_scenario(load())
        gaps = [f["gap"] for f in out["factory"]]
        self.assertAlmostEqual(out["summary"]["factory_gap_max_cny"], max(gaps))
        self.assertLess(out["summary"]["factory_gap_max_cny"], sum(gaps))
        self.assertAlmostEqual(out["summary"]["factory_gap_max_cny"], out["summary"]["peak_funding_cny"], delta=5000)

    def test_first_receipt_ignores_cents(self):
        out = cash_layer.run_scenario(load())
        self.assertEqual(out["summary"]["first_receipt_date"], "2026-11-16")
        self.assertGreaterEqual(out["summary"]["first_receipt_cny"], 100)

    def test_promo_low_and_ending_split(self):
        out = cash_layer.run_scenario(load())
        s = out["summary"]
        self.assertLessEqual(s["promo_low_date"], s["promo_window"][1])
        self.assertGreaterEqual(s["promo_low_cny"], s["min_balance_cny"])
        self.assertGreater(s["ending_stock_value_cny"], 0)

    def test_contribution_includes_tariff_and_one_off(self):
        inp = load()
        base = cash_layer.run_scenario(inp)["summary"]["total_contribution_cny"]
        q = copy.deepcopy(inp)
        q["product"]["tariff_rate"] = 0.2
        with_t = cash_layer.run_scenario(q)["summary"]["total_contribution_cny"]
        self.assertLess(with_t, base - 1000)
        q2 = copy.deepcopy(inp)
        q2["cash"]["one_off_expenses"] = [dict(name="样品", amount_cny=5000, date="2026-12-10")]
        with_o = cash_layer.run_scenario(q2)["summary"]["total_contribution_cny"]
        self.assertAlmostEqual(with_o, base - 5000, delta=1)

    def test_default_runs_and_matches_colleague_tail_cash(self):
        out = cash_layer.run_scenario(load())
        s = out["summary"]
        # 同事保存方案尾期全项目现金 ¥75,609（不含团队开支）；我们加了 ¥240,000 团队开支
        self.assertAlmostEqual(s["ending_balance_cny"] + s["team_total_cny"], 75609, delta=1500)
        self.assertAlmostEqual(s["ads_total_usd"], 21851.85, delta=1)
        self.assertEqual(s["lost_total"], 0)

    def test_ledger_is_conserved(self):
        out = cash_layer.run_scenario(load())
        total = sum(e["amount_cny"] for e in out["events"])
        self.assertAlmostEqual(out["ledger"][-1]["balance"], out["summary"]["opening_cash_cny"] + total, places=4)

    def test_opening_cash_shifts_balance(self):
        inp = load()
        a = cash_layer.run_scenario(inp)["summary"]["min_balance_cny"]
        inp["cash"]["opening_cash_cny"] = 100000
        b = cash_layer.run_scenario(inp)["summary"]["min_balance_cny"]
        self.assertAlmostEqual(b - a, 100000, places=4)

    def test_team_expense_lands_on_pay_day(self):
        inp = load()
        inp["cash"]["team_expenses"] = [dict(name="x", amount_cny=1000, pay_day=31, start_month="2026-11", end_month="2026-12")]
        out = cash_layer.run_scenario(inp)
        days = sorted(e["date"] for e in out["events"] if e["kind"] == "team")
        self.assertEqual(days, ["2026-11-30", "2026-12-31"])  # 11 月没有 31 号，落到月末

    def test_ads_payment_modes_shift_dates_not_amounts(self):
        inp = load()
        base = cash_layer.run_scenario(inp)
        base_ads = sum(e["amount_cny"] for e in base["events"] if e["kind"] == "ads")
        for mode in ("balance", "card"):
            q = copy.deepcopy(inp)
            q["promotion"]["ads_payment"]["mode"] = mode
            out = cash_layer.run_scenario(q)
            self.assertAlmostEqual(sum(e["amount_cny"] for e in out["events"] if e["kind"] == "ads"), base_ads, places=4)
            for e in out["events"]:
                if e["kind"] == "ads":
                    self.assertGreaterEqual(e["date"], e["source_date"])
        q = copy.deepcopy(inp)
        q["promotion"]["ads_payment"] = dict(mode="card", card_pay_day=15, card_min_lag_days=20)
        out = cash_layer.run_scenario(q)
        e = next(e for e in out["events"] if e["kind"] == "ads" and e["source_date"] == "2026-11-01")
        self.assertEqual(e["date"], "2026-12-15")

    def test_tariff_adds_outflow_at_arrival(self):
        inp = load()
        inp["product"]["tariff_usd_per_unit"] = 2.0
        out = cash_layer.run_scenario(inp)
        t = [e for e in out["events"] if e["kind"] == "tariff"]
        self.assertTrue(t)
        qty = sum(b["qty"] for b in out["replenishment"])
        self.assertAlmostEqual(-sum(e["amount_cny"] for e in t), qty * 2.0 * inp["product"]["fx"], places=2)

    def test_stockout_lost_and_ads_stopped(self):
        inp = cash_layer.load_input(os.path.join(ROOT, "inputs", "原表格推广假设.json"))
        out = cash_layer.run_scenario(inp)
        self.assertIsNotNone(out["summary"]["stockout_first"])
        self.assertGreater(out["summary"]["lost_total"], 0)
        self.assertGreater(out["ads_stopped_for_stockout_usd"], 0)
        inp["replenishment"]["stop_ads_when_out_of_stock"] = False
        out2 = cash_layer.run_scenario(inp)
        self.assertGreater(out2["summary"]["ads_total_usd"], out["summary"]["ads_total_usd"])

    def test_allocatable_never_breaks_floor(self):
        inp = load()
        inp["cash"]["opening_cash_cny"] = 1500000  # 给足现金，看每月可拨是否合理
        out = cash_layer.run_scenario(inp)
        total = sum(m["allocatable_cny"] for m in out["monthly"])
        floor = inp["cash"]["cash_floor_cny"]
        # 全部拨完后，余额最低点仍不低于底线
        self.assertGreaterEqual(min(r["balance"] for r in out["ledger"]) - total, floor - 1e-6)
        self.assertGreater(total, 0)

    def test_matrix_shape(self):
        inp = load()
        inp["matrix"] = dict(coupon_pcts=[0, 0.2], paces={"中": 1.0})
        m = cash_layer.scenario_matrix(inp)
        self.assertEqual(len(m), 2)
        self.assertTrue(all(r["ok"] for r in m))
        self.assertLess(m[1]["min_balance_cny"], m[0]["min_balance_cny"])  # 开 coupon 现金更差


class XlsxIO(unittest.TestCase):
    def test_roundtrip_template(self):
        path = os.path.join(ROOT, "inputs", "输入表_Y背默认.xlsx")
        if not os.path.exists(path):
            self.skipTest("模板不存在")
        inp = xlsx_io.read_input(path)
        a = cash_layer.run_scenario(inp)["summary"]
        b = cash_layer.run_scenario(load())["summary"]
        self.assertAlmostEqual(a["min_balance_cny"], b["min_balance_cny"], places=2)
        self.assertAlmostEqual(a["ads_total_usd"], b["ads_total_usd"], places=2)


if __name__ == "__main__":
    unittest.main()
