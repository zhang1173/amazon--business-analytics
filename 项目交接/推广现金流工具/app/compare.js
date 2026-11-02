const fs = require('fs');
const PC = require('./model.js');
const names = process.argv.slice(2);
let bad = 0;
function near(a, b, tol) { if (a == null && b == null) return true; if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol; return JSON.stringify(a) === JSON.stringify(b); }
function cmp(label, a, b, tol = 0.01) { if (!near(a, b, tol)) { bad++; console.log('DIFF', label, 'js=', JSON.stringify(a), 'py=', JSON.stringify(b)); } }
for (const n of names) {
  const ref = JSON.parse(fs.readFileSync(n, 'utf8'));
  console.log('=== ' + n);
  let out;
  try { out = PC.runScenario(ref.input); } catch (e) { console.log('ERROR', e.stack); bad++; continue; }
  const s = out.summary, ps = ref.summary;
  for (const k of Object.keys(ps)) { if (k === 'scenario_name' || k === 'engine_version') continue; cmp('summary.' + k, s[k], ps[k], 0.01); }
  cmp('factory.len', out.factory.length, ref.factory.length);
  ref.factory.forEach((f, i) => { const g = out.factory[i] || {}; cmp(`factory[${i}].date`, g.date, f.date); cmp(`factory[${i}].kind`, g.kind, f.kind); cmp(`factory[${i}].ref`, g.ref, f.ref); cmp(`factory[${i}].amount`, g.amount_cny, f.amount_cny); cmp(`factory[${i}].balance_after`, g.balance_after, f.balance_after); cmp(`factory[${i}].ok`, g.ok, f.ok); });
  cmp('monthly.len', out.monthly.length, ref.monthly.length);
  ref.monthly.forEach((m, i) => { const g = out.monthly[i] || {}; for (const k of Object.keys(m)) cmp(`monthly[${i}].${k}`, g[k], m[k], 0.02); });
  const led = new Map(out.ledger.map(r => [r.date, r.balance]));
  ref.ledger_tail.forEach(([d, b]) => cmp('ledger ' + d, led.get(d), b, 0.01));
  cmp('replenishment.len', out.replenishment.length, ref.replenishment.length);
  ref.replenishment.forEach((r, i) => { const g = out.replenishment[i] || {}; for (const k of Object.keys(r)) cmp(`replenishment[${i}].${k}`, g[k], r[k], 0.01); });
  cmp('phases.len', out.phases.length, ref.phases.length);
  ref.phases.forEach((p, i) => { const g = out.phases[i] || {}; for (const k of Object.keys(p)) cmp(`phases[${i}].${k}`, g[k], p[k], 0.0001); });
  cmp('n_events', out.events.length, ref.n_events);
  const byKind = {}; for (const e of out.events) byKind[e.kind] = (byKind[e.kind] || 0) + e.amount_cny;
  for (const k of Object.keys(ref.events_by_kind)) cmp('events_by_kind.' + k, Math.round(byKind[k] * 10000) / 10000, ref.events_by_kind[k], 0.01);
  for (const k of Object.keys(byKind)) if (!(k in ref.events_by_kind)) cmp('events_by_kind.extra.' + k, byKind[k], 0);
  let mx; try { mx = PC.scenarioMatrix(ref.input); } catch (e) { console.log('MATRIX ERROR', e.stack); bad++; continue; }
  cmp('matrix.len', mx.length, ref.matrix.length);
  ref.matrix.forEach((m, i) => { const g = mx[i] || {}; for (const k of Object.keys(m)) cmp(`matrix[${i}].${k}`, g[k], m[k], 0.02); });
}
console.log(bad ? `FAILED with ${bad} diffs` : 'ALL MATCH');
