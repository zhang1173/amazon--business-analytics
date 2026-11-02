#!/usr/bin/env python3
"""推广 × 现金流平衡工具 · 命令行入口

用法：
  python3 run.py inputs/Y背默认.json                 # 跑一个方案，结果写到 输出/<方案名>/
  python3 run.py inputs/Y背默认.json --matrix        # 再跑 coupon 档 × 推广节奏 的方案对比
  python3 run.py inputs/Y背默认.json --sweep product.tariff_rate=0,0.25,0.35,0.45   # 关税敏感性
  python3 run.py 输入表.xlsx --matrix                # 也可以直接读 Excel 输入表
  python3 run.py --template 输入表_模板.xlsx          # 生成一张空白输入表（需要 openpyxl）
"""
import argparse
import datetime as dt
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import cash_layer  # noqa: E402
import report_html  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description="推广 × 现金流平衡工具")
    ap.add_argument("input", nargs="?", help="输入文件：.json 或 .xlsx")
    ap.add_argument("--out", help="输出目录（默认 输出/<方案名>/）")
    ap.add_argument("--matrix", action="store_true", help="同时跑 coupon 档 × 推广节奏 方案对比")
    ap.add_argument("--sweep", help="敏感性：字段=取值列表，例 product.tariff_rate=0,0.25,0.35,0.45")
    ap.add_argument("--template", help="生成 Excel 输入表模板到这个路径，然后退出")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args(argv)
    if a.template:
        import xlsx_io
        src = a.input or os.path.join(HERE, "inputs", "Y背默认.json")
        xlsx_io.write_template(a.template, xlsx_io.read_input(src) if src.lower().endswith(".xlsx") else cash_layer.load_input(src))
        print("已生成输入表模板：", a.template)
        return 0
    if not a.input:
        ap.error("请给输入文件")
    if a.input.lower().endswith(".xlsx"):
        import xlsx_io
        inp = xlsx_io.read_input(a.input)
    else:
        inp = cash_layer.load_input(a.input)
    out = cash_layer.run_scenario(inp)
    matrix = cash_layer.scenario_matrix(inp) if a.matrix else None
    sweep = None
    if a.sweep:
        field, vals = a.sweep.split("=", 1)
        sweep = cash_layer.sensitivity(inp, field.strip(), [float(x) for x in vals.split(",") if x.strip()])
    name = (inp.get("scenario_name") or "方案").split("（")[0].replace("/", "-").replace(" ", "")
    out_dir = a.out or os.path.join(HERE, "输出", name)
    cash_layer.write_outputs(out, out_dir, matrix, sweep)
    html = report_html.render(out, matrix, sweep=sweep, input_path=os.path.basename(a.input), generated=dt.datetime.now().strftime("%Y-%m-%d %H:%M"))
    with open(os.path.join(out_dir, "报告.html"), "w", encoding="utf-8") as f:
        f.write("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"></head><body>" + html + "</body></html>")
    s = out["summary"]
    if not a.quiet:
        print(f"方案：{s['scenario_name']}")
        print(f"广告合计 ${s['ads_total_usd']:,.0f}（每套 ${s['ad_per_unit_planned_usd'] or 0:.2f}，上限 ${s['ad_cap_weighted_usd'] or 0:.2f}）；推广 {s['promo_window'][2] if s['promo_window'] else 0} 天")
        print(f"最低余额 ¥{s['min_balance_cny']:,.0f}（{s['min_balance_date']}）；工厂到期 {'都够' if s['factory_all_ok'] else '有缺口 ¥%s' % format(s['factory_gap_max_cny'], ',.0f')}")
        print(f"团队开支已计 ¥{s['team_total_cny']:,.0f}；可额外拨 ¥{s['allocatable_total_cny']:,.0f}；期末余额 ¥{s['ending_balance_cny']:,.0f}；断货 {s['stockout_first'] or '无'}")
        print("输出目录：", out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
