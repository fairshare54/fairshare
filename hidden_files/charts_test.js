// Charts test: payout bars sum to each round envelope, standings match
// the round records, the stress comparison matches the verified demo log,
// and the wallet points bar splits 100 correctly. Run: node hidden_files/charts_test.js
const els = {}; const listeners = {};
function mkEl(id) {
  return {
    innerHTML: "", textContent: "", style: {}, value: "amina", dataset: {},
    classList: { add() {}, remove() {} },
    addEventListener: (ev, fn) => { listeners[id + ":" + ev] = fn; },
    querySelectorAll: () => [],
  };
}
global.document = {
  getElementById: (id) => els[id] || (els[id] = mkEl(id)),
  addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") fn(); },
};
const app = require("/home/hatch/workspace/egbe/site/app.js");
const fs = require("fs");
const log = JSON.parse(fs.readFileSync("/home/hatch/workspace/egbe/demo-log.json", "utf8"));
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + " " + name + (detail !== undefined ? " — " + detail : ""));
  if (!ok) failures++;
}

// 1. Payout charts: every bar is one member, bars sum to the round total.
for (const r of [app.LIVE_ROUND1, app.LIVE_ROUND2, app.LIVE_ROUND3, app.LIVE_ROUND4]) {
  const html = app.payoutChartHtml(r);
  const amounts = [...html.matchAll(/data-payout-yocto="(\d+)"/g)].map((m) => BigInt(m[1]));
  const sum = amounts.reduce((s, x) => s + x, 0n);
  check("round " + r.roundId + " chart bars sum to total payout",
    sum.toString() === r.totalPayoutYocto,
    amounts.length + " bars, sum " + sum.toString());
  const cappedCount = r.members.filter((m) => m.capped).length;
  const cappedMarks = (html.match(/ · capped/g) || []).length;
  check("round " + r.roundId + " capped marks match the record",
    cappedMarks === cappedCount, cappedMarks + " marks, " + cappedCount + " capped in the record");
  check("round " + r.roundId + " chart has a cap tick per row",
    (html.match(/class="captick"/g) || []).length === r.members.length);
}

// 2. Standings chart: 12 members, after round 3 and after round 4 values
// match the round records (spot check Ada, Tunde, Alice).
const sh = app.standingsChartHtml();
check("standings chart has 12 member rows", (sh.match(/class="srow"/g) || []).length === 12);
function standingOf(name, round) {
  const row = sh.split("class=\"srow\"").find((s) => s.indexOf(">" + name + "<") >= 0);
  if (!row) return null;
  const m = row.match(new RegExp("data-after-r" + round + "=\"(\\d+)\""));
  return m ? Number(m[1]) : null;
}
check("standings Ada after R3 110, after R4 105",
  standingOf("Ada", 3) === 110 && standingOf("Ada", 4) === 105);
check("standings Tunde after R3 95, after R4 90",
  standingOf("Tunde", 3) === 95 && standingOf("Tunde", 4) === 90);
check("standings Alice after R3 100, after R4 95",
  standingOf("Alice", 3) === 100 && standingOf("Alice", 4) === 95);
check("standings chart names the round 4 joiners",
  sh.indexOf("six round 4 members joined at 100 and stand at 106") >= 0);

// 3. Stress comparison: highest and lowest per scenario match the
// independently verified demo log payouts.
const cmp = app.stressCompareData();
for (const c of cmp) {
  const pays = Object.values(log.stress_test.scenarios[c.id].payouts_near).map(Number);
  const hi = Math.max.apply(null, pays), lo = Math.min.apply(null, pays);
  const hiNear = Number(c.hi.payoutYocto) / 1e24;
  const loNear = Number(c.lo.payoutYocto) / 1e24;
  check("stress " + c.id + " highest/lowest match demo log",
    Math.abs(hiNear - hi) < 0.001 && Math.abs(loNear - lo) < 0.001,
    "hi " + hiNear.toFixed(3) + " vs " + hi.toFixed(3) + ", lo " + loNear.toFixed(3) + " vs " + lo.toFixed(3));
}
check("stress compare has all five scenarios", cmp.length === 5);

// 4. Home dashboard fallback totals.
check("home fallback total paid is the four round sum",
  app.HOME_DASHBOARD_FALLBACK.totalPaidYocto === "19999999999999999999999986");
check("home fallback members 19, rounds 4, DAO 40.150 NEAR",
  app.HOME_DASHBOARD_FALLBACK.members === 19 &&
  app.HOME_DASHBOARD_FALLBACK.roundsSettled === 4 &&
  app.HOME_DASHBOARD_FALLBACK.daoBalanceYocto === "40150000000000000000000000");

// 5. Wallet points bar splits 100 into assigned and unassigned.
const bar40 = app.walletPointsBarHtml(40);
check("wallet bar 40 assigned is 40% assigned, 60% unassigned",
  bar40.indexOf("width:40%") >= 0 && bar40.indexOf("width:60%") >= 0 &&
  bar40.indexOf("40 points assigned") >= 0 && bar40.indexOf("60 points unassigned") >= 0);
const bar0 = app.walletPointsBarHtml(0);
check("wallet bar 0 assigned is all unassigned",
  bar0.indexOf("width:0%") >= 0 && bar0.indexOf("width:100%") >= 0);
const bar150 = app.walletPointsBarHtml(150);
check("wallet bar clamps above 100", bar150.indexOf("100 points assigned") >= 0);

// 6. Charts rendered into the page containers on load.
app.renderPayoutCharts();
check("chartRound1 container filled", (els.chartRound1.innerHTML || "").indexOf("Frank") >= 0);
check("chartRound4 container filled", (els.chartRound4.innerHTML || "").indexOf("Kemi") >= 0);
app.renderStandingsChart();
check("standingsChart container filled", (els.standingsChart.innerHTML || "").indexOf("Ada") >= 0);
app.renderStressCompare();
check("stressCompare container filled", (els.stressCompare.innerHTML || "").indexOf("Three friends") >= 0);

console.log(failures === 0 ? "ALL CHART TESTS PASSED" : failures + " CHART TEST(S) FAILED");
process.exit(failures === 0 ? 0 : 1);
