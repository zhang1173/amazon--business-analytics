import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import cash_layer
for name in sys.argv[1:]:
    inp = cash_layer.load_input(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "inputs", f"{name}.json"))
    out = cash_layer.run_scenario(inp)
    mx = cash_layer.scenario_matrix(inp)
    led = out["ledger"]
    ev = {}
    for e in out["events"]:
        ev[e["kind"]] = round(ev.get(e["kind"], 0) + e["amount_cny"], 4)
    ref = dict(summary=out["summary"], factory=out["factory"], monthly=out["monthly"],
               ledger_tail=[[r["date"], round(r["balance"], 4)] for i, r in enumerate(led) if i % 15 == 0],
               replenishment=out["replenishment"], phases=out["phases"], n_events=len(out["events"]), events_by_kind=ev,
               matrix=mx, reverse=out["reverse"], weeks=out["weeks"][:8], input=inp)
    json.dump(ref, open(f"ref_{name}.json", "w", encoding="utf-8"), ensure_ascii=False, default=str)
    print("dumped", name, out["summary"]["min_balance_cny"])
