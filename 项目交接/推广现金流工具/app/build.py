"""把 model.js、预设数据、ui.js 拼进 page.html，生成可发布的单文件网页。
用法：python3 build.py [输出路径]   （在 app/ 目录运行；预设数据来自 ../inputs/ 或工具目录 inputs/）"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.dirname(HERE) if os.path.exists(os.path.join(os.path.dirname(HERE), "cash_layer.py")) else os.path.join(os.path.dirname(HERE), "tool")
sys.path.insert(0, TOOL)
import cash_layer  # noqa: E402

PRESETS = [
    ("真数", "Y背真数（2026-11-01：现金 60 万、团队 7 万/月、账期 6 个月、关税 35% 估）", "Y背真数_20261101.json"),
    ("原表格", "原表格推广假设（$29.99 + 30% coupon、CPC 7→3.4、849 单上新）", "原表格推广假设.json"),
    ("同事方案", "同事 10-29 方案（$24.83 不开 coupon、团队 3 万示例、无起点现金）", "Y背默认.json"),
]
presets = {}
for key, label, fn in PRESETS:
    inp = cash_layer.load_input(os.path.join(TOOL, "inputs", fn))
    inp.pop("release_distribution_csv", None)
    presets[key] = dict(label=label, input=inp)
model = open(os.path.join(HERE, "model.js"), encoding="utf-8").read()
ui = open(os.path.join(HERE, "ui.js"), encoding="utf-8").read()
page = open(os.path.join(HERE, "page.html"), encoding="utf-8").read()
assert "</script" not in model and "</script" not in ui
data = "window.PRESETS = " + json.dumps(presets, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/") + ";"
out = page.replace("/*__MODEL__*/", model).replace("/*__DATA__*/", data).replace("/*__UI__*/", ui)
dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(HERE), "Y背推广现金流沙盘.html")
open(dest, "w", encoding="utf-8").write(out)
print("写出", dest, len(out.encode("utf-8")) // 1024, "KB")
