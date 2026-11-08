// Dump the site's Fairness Stress Test results to /tmp/stress_site.json
// for the independent Python model in hidden_files/stress_model.py.
// Run from the repo root: node hidden_files/stress_dump.js
const m = require("../site/app.js");
const fs = require("fs");
const out = {};
for (const sc of m.STRESS_SCENARIOS) {
  const r = m.settle(sc.allocations, m.STRESS_MEMBERS, m.STRESS_ENVELOPE_NEAR, sc.standings);
  const after = m.standingAfter(sc.allocations, m.STRESS_MEMBERS, sc.standings);
  out[sc.id] = {
    standings: sc.standings,
    allocations: sc.allocations,
    totalScore: r.totalScore,
    totalPayoutYocto: r.totalPayoutYocto.toString(),
    dustYocto: r.dustYocto.toString(),
    per: Object.fromEntries(Object.entries(r.per).map(([k, v]) => [k, {
      score: v.score,
      rawPayoutYocto: v.rawPayoutYocto.toString(),
      payoutYocto: v.payoutYocto.toString(),
      capped: v.capped,
    }])),
    standingAfter: after,
  };
}
fs.writeFileSync("/tmp/stress_site.json", JSON.stringify(out, null, 1));
console.log("wrote /tmp/stress_site.json for", Object.keys(out).join(", "));
