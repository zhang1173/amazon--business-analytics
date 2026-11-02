"""找到并载入同事的 D08 v1.7 引擎（产品层），不改它一行代码。

查找顺序：
1. 环境变量 ENGINE_DIR
2. 本工具目录下的 engine_d08/（私有复制件，不进公开仓库）
3. ../../参考资料/财务交接包_20261030_摘取/程序快照/（项目文件夹里的原快照）
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CANDIDATES = [
    os.environ.get("ENGINE_DIR"),
    os.path.join(HERE, "engine_d08"),
    os.path.join(HERE, "..", "..", "参考资料", "财务交接包_20261030_摘取", "程序快照"),
]
REQUIRED = ("engine.py", "planning.py", "goods.py", "goal_finance.py", "operations.py")


def locate():
    for d in CANDIDATES:
        if d and all(os.path.exists(os.path.join(d, f)) for f in REQUIRED):
            return os.path.abspath(d)
    raise FileNotFoundError(
        "找不到 D08 引擎（engine.py 等 5 个文件）。请把同事程序快照放到 engine_d08/，"
        "或设置环境变量 ENGINE_DIR 指向 程序快照 目录。查找过：" + "; ".join(str(c) for c in CANDIDATES))


ENGINE_DIR = locate()
if ENGINE_DIR not in sys.path:
    sys.path.insert(0, ENGINE_DIR)

import engine as d08  # noqa: E402  (同事引擎，原样使用)
from engine import Invalid, day, first, last, days, months, add_months, payout, commission  # noqa: E402,F401

simulate = d08.simulate
VERSION = d08.VERSION
