// FairShare — peer allocation of credit. NEAR testnet only. Formerly Egbe.
// Settlement math. This file mirrors the Rust contract in
// ../contract/src/lib.rs EXACTLY, including its integer arithmetic:
//   * discount on a mutual pair = floor(min(points) * 5000 / 10000),
//     taken off BOTH directions before scoring.
//   * sqrt contribution = isqrt(effective_points * giver_weight), where
//     giver_weight is the giver's standing and starts at 100 for everyone.
//   * score = (sum of sqrt contributions over distinct givers) squared.
//   * payouts are whole yocto amounts: uncapped = score * envelope /
//     total_score with integer division, capped at 25% of the envelope,
//     surplus redistributed water filling style. A few yocto of dust
//     from integer division stays in the contract.
// If this file and the contract ever disagree, one of them is wrong until
// the three places (contract, site, README) are harmonised again.
//
// Rules (v1):
//   Each member gets 100 points per round and must name at least 3
//   recipients. Every allocation needs a short reason. No self allocation.
//   One submission per member per round; resubmitting replaces the old one.
//   A round settles only after its 7 day deadline or after the owner
//   closes it early. Settling twice fails.

// Deployed to NEAR testnet 2026-11-08 (see ../deploy-log.json and
// ../dao-log.json). Verified live by RPC view call: get_params matches
// the spec, members are synced from the Sputnik DAO council, and round 1
// is settled. NEVER put a mainnet contract id here. Testnet only.
const CONTRACT_ID = "fairshare-contract.testnet";
const DAO_ID = "fairshare-dao.testnet";

const PARAMS = {
  pointsPerMember: 100,
  minRecipients: 3,
  capBps: 2500,
  reciprocityDiscountBps: 5000,
  giverWeight: 100,
  roundDurationDays: 7,
};

const ENVELOPE_NEAR = 10;
const YOCTO_PER_NEAR = 10n ** 24n;

const MEMBERS = [
  { id: "amina", name: "Amina", role: "Hosts the freezer and keeps the log" },
  { id: "bola", name: "Bola", role: "Runs evening rentals" },
  { id: "chidi", name: "Chidi", role: "Collects rent and keeps the books" },
  { id: "dayo", name: "Dayo", role: "Cleans the freezer and handles ice" },
  { id: "efe", name: "Efe", role: "Runs the weekend market stall" },
];

// Seeded allocations for the simulated demo round. Every member spends all
// 100 points across at least 3 recipients. Reasons are short and plain.
const ALLOCATIONS = [
  { from: "amina", to: "bola", points: 40, reason: "Covered the evening rental shift" },
  { from: "amina", to: "chidi", points: 35, reason: "Collected rent and kept the books straight" },
  { from: "amina", to: "dayo", points: 25, reason: "Cleaned the freezer after a busy weekend" },
  { from: "bola", to: "amina", points: 40, reason: "Kept the freezer running all week" },
  { from: "bola", to: "chidi", points: 30, reason: "Collected rent and kept the books straight" },
  { from: "bola", to: "efe", points: 30, reason: "Ran the market stall in the rain" },
  { from: "chidi", to: "amina", points: 40, reason: "Kept the freezer running all week" },
  { from: "chidi", to: "bola", points: 35, reason: "Covered the evening rental shift" },
  { from: "chidi", to: "dayo", points: 25, reason: "Cleaned the freezer after a busy weekend" },
  { from: "dayo", to: "amina", points: 25, reason: "Kept the freezer running all week" },
  { from: "dayo", to: "chidi", points: 35, reason: "Collected rent and kept the books straight" },
  { from: "dayo", to: "efe", points: 40, reason: "Ran the market stall in the rain" },
  { from: "efe", to: "chidi", points: 35, reason: "Collected rent and kept the books straight" },
  { from: "efe", to: "bola", points: 30, reason: "Covered the evening rental shift" },
  { from: "efe", to: "dayo", points: 35, reason: "Cleaned the freezer after a busy weekend" },
];

function memberName(id) {
  const m = MEMBERS.find((x) => x.id === id);
  return m ? m.name : id;
}

// Integer square root (floor), same Newton iteration as the contract.
function isqrt(n) {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

// Format a yocto BigInt as NEAR with exactly 3 decimals.
function fmtYocto(yocto) {
  const whole = yocto / YOCTO_PER_NEAR;
  const frac = Number((yocto % YOCTO_PER_NEAR) * 1000n / YOCTO_PER_NEAR);
  return whole.toString() + "." + String(frac).padStart(3, "0");
}

function fmt(n, digits) {
  return n.toFixed(digits === undefined ? 3 : digits);
}

// Apply the reciprocity discount. Returns a map "from>to" -> effective points.
function effectivePoints(allocations) {
  const raw = {};
  for (const a of allocations) raw[a.from + ">" + a.to] = a.points;
  const eff = {};
  for (const a of allocations) {
    const back = raw[a.to + ">" + a.from] || 0;
    const mutual = Math.min(a.points, back);
    const discount = Math.floor((mutual * PARAMS.reciprocityDiscountBps) / 10000);
    eff[a.from + ">" + a.to] = a.points - discount;
  }
  return eff;
}

// Full settlement, mirroring settle_round in the contract. poolNear is a
// whole number of NEAR. Returns per member: score, giver breakdown,
// uncapped payout, capped flag, final payout (all payouts as yocto BigInt).
function settle(allocations, memberIds, poolNear) {
  const poolYocto = BigInt(poolNear) * YOCTO_PER_NEAR;
  const eff = effectivePoints(allocations);
  const per = {};
  for (const id of memberIds) {
    per[id] = { id, givers: [], score: 0, rawPayoutYocto: 0n, payoutYocto: 0n, capped: false };
  }
  for (const a of allocations) {
    const e = eff[a.from + ">" + a.to];
    const back = (allocations.find((x) => x.from === a.to && x.to === a.from) || {}).points || 0;
    const mutual = Math.min(a.points, back);
    const discount = Math.floor((mutual * PARAMS.reciprocityDiscountBps) / 10000);
    per[a.to].givers.push({
      from: a.from,
      points: a.points,
      mutual: back > 0 ? mutual : 0,
      discount,
      effective: e,
      sqrt: isqrt(e * PARAMS.giverWeight),
      reason: a.reason,
    });
  }
  let totalScore = 0;
  for (const id of memberIds) {
    const s = per[id].givers.reduce((sum, g) => sum + g.sqrt, 0);
    per[id].score = s * s;
    totalScore += per[id].score;
  }
  const cap = (poolYocto * BigInt(PARAMS.capBps)) / 10000n;
  for (const id of memberIds) {
    per[id].rawPayoutYocto = totalScore > 0
      ? (BigInt(per[id].score) * poolYocto) / BigInt(totalScore)
      : 0n;
  }
  // Cap with water filling redistribution, same loop as the contract.
  let remaining = poolYocto;
  let active = memberIds.filter((id) => per[id].score > 0);
  const done = {};
  while (active.length > 0) {
    const tot = active.reduce((sum, id) => sum + BigInt(per[id].score), 0n);
    const over = active.filter((id) => (BigInt(per[id].score) * remaining) / tot > cap);
    if (over.length === 0) {
      let spent = 0n;
      for (const id of active) {
        done[id] = (BigInt(per[id].score) * remaining) / tot;
        spent += done[id];
      }
      remaining -= spent;
      break;
    }
    for (const id of over) {
      done[id] = cap;
      per[id].capped = true;
      remaining -= cap;
    }
    active = active.filter((id) => !over.includes(id));
  }
  for (const id of memberIds) per[id].payoutYocto = done[id] || 0n;
  const totalPayoutYocto = memberIds.reduce((s, id) => s + per[id].payoutYocto, 0n);
  return { per, totalScore, cap, poolYocto, totalPayoutYocto, dustYocto: poolYocto - totalPayoutYocto };
}

// ---- Attack Lab scenarios ----
// These two rounds ARE the contract property test
// property_collusion_ring_earns_less_than_honest in ../contract/src/lib.rs,
// run here with the same integer maths. Same 9 people, same 60 NEAR
// envelope, two worlds. The trio is Ada, Ben, Cara. The other six are
// Dan, Eli, Fay, Gus, Hal, Ivy.
// Ring world: the trio helps only each other, so the other six point at
// each other, because the trio did no work for them. The trio still has
// to name 3 recipients, so each one spends 20 points on one outsider.
// Honest world: the trio helps distinct outsiders, and every outsider
// points back at the trio, so the trio is fed by six distinct givers.
// The lab also shows the pure maths underneath: the same 100 points score
// far more when they arrive from many distinct givers than from two.
const LAB_MEMBERS = ["ada", "ben", "cara", "dan", "eli", "fay", "gus", "hal", "ivy"];
const LAB_NAMES = {
  ada: "Ada", ben: "Ben", cara: "Cara", dan: "Dan", eli: "Eli",
  fay: "Fay", gus: "Gus", hal: "Hal", ivy: "Ivy",
};
const LAB_TRIO = ["ada", "ben", "cara"];
const LAB_ENVELOPE_NEAR = 60;

const LAB_RING = [
  { from: "ada", to: "ben", points: 40, reason: "Ring giving" },
  { from: "ada", to: "cara", points: 40, reason: "Ring giving" },
  { from: "ada", to: "dan", points: 20, reason: "Third recipient, required" },
  { from: "ben", to: "ada", points: 40, reason: "Ring giving" },
  { from: "ben", to: "cara", points: 40, reason: "Ring giving" },
  { from: "ben", to: "eli", points: 20, reason: "Third recipient, required" },
  { from: "cara", to: "ada", points: 40, reason: "Ring giving" },
  { from: "cara", to: "ben", points: 40, reason: "Ring giving" },
  { from: "cara", to: "fay", points: 20, reason: "Third recipient, required" },
  { from: "dan", to: "eli", points: 34, reason: "Helped with a delivery" },
  { from: "dan", to: "fay", points: 33, reason: "Helped with a delivery" },
  { from: "dan", to: "gus", points: 33, reason: "Helped with a delivery" },
  { from: "eli", to: "dan", points: 34, reason: "Helped with a delivery" },
  { from: "eli", to: "fay", points: 33, reason: "Helped with a delivery" },
  { from: "eli", to: "hal", points: 33, reason: "Helped with a delivery" },
  { from: "fay", to: "dan", points: 34, reason: "Helped with a delivery" },
  { from: "fay", to: "eli", points: 33, reason: "Helped with a delivery" },
  { from: "fay", to: "ivy", points: 33, reason: "Helped with a delivery" },
  { from: "gus", to: "dan", points: 34, reason: "Helped with a delivery" },
  { from: "gus", to: "eli", points: 33, reason: "Helped with a delivery" },
  { from: "gus", to: "hal", points: 33, reason: "Helped with a delivery" },
  { from: "hal", to: "dan", points: 34, reason: "Helped with a delivery" },
  { from: "hal", to: "eli", points: 33, reason: "Helped with a delivery" },
  { from: "hal", to: "gus", points: 33, reason: "Helped with a delivery" },
  { from: "ivy", to: "dan", points: 34, reason: "Helped with a delivery" },
  { from: "ivy", to: "eli", points: 33, reason: "Helped with a delivery" },
  { from: "ivy", to: "fay", points: 33, reason: "Helped with a delivery" },
];

const LAB_HONEST = [
  { from: "ada", to: "dan", points: 34, reason: "Ran the stall for Dan" },
  { from: "ada", to: "eli", points: 33, reason: "Covered a shift for Eli" },
  { from: "ada", to: "fay", points: 33, reason: "Helped Fay with stock" },
  { from: "ben", to: "gus", points: 34, reason: "Ran the stall for Gus" },
  { from: "ben", to: "hal", points: 33, reason: "Covered a shift for Hal" },
  { from: "ben", to: "ivy", points: 33, reason: "Helped Ivy with stock" },
  { from: "cara", to: "dan", points: 34, reason: "Covered a shift for Dan" },
  { from: "cara", to: "gus", points: 33, reason: "Helped Gus with stock" },
  { from: "cara", to: "hal", points: 33, reason: "Ran the stall for Hal" },
  { from: "dan", to: "ada", points: 34, reason: "Ada ran the stall" },
  { from: "dan", to: "ben", points: 33, reason: "Ben covered a shift" },
  { from: "dan", to: "cara", points: 33, reason: "Cara helped with stock" },
  { from: "eli", to: "ada", points: 34, reason: "Ada ran the stall" },
  { from: "eli", to: "ben", points: 33, reason: "Ben covered a shift" },
  { from: "eli", to: "cara", points: 33, reason: "Cara helped with stock" },
  { from: "fay", to: "ada", points: 34, reason: "Ada ran the stall" },
  { from: "fay", to: "ben", points: 33, reason: "Ben covered a shift" },
  { from: "fay", to: "cara", points: 33, reason: "Cara helped with stock" },
  { from: "gus", to: "ada", points: 34, reason: "Ada ran the stall" },
  { from: "gus", to: "ben", points: 33, reason: "Ben covered a shift" },
  { from: "gus", to: "cara", points: 33, reason: "Cara helped with stock" },
  { from: "hal", to: "ada", points: 34, reason: "Ada ran the stall" },
  { from: "hal", to: "ben", points: 33, reason: "Ben covered a shift" },
  { from: "hal", to: "cara", points: 33, reason: "Cara helped with stock" },
  { from: "ivy", to: "ada", points: 34, reason: "Ada ran the stall" },
  { from: "ivy", to: "ben", points: 33, reason: "Ben covered a shift" },
  { from: "ivy", to: "cara", points: 33, reason: "Cara helped with stock" },
];

// ---- Browser rendering ----
function el(id) { return document.getElementById(id); }

function renderMembers() {
  el("memberBody").innerHTML = MEMBERS.map((m) =>
    "<tr><td>" + m.name + "</td><td>" + m.role + "</td><td>100</td></tr>"
  ).join("");
  el("allocBody").innerHTML = ALLOCATIONS.map((a) =>
    "<tr><td>" + memberName(a.from) + "</td><td>" + memberName(a.to) +
    "</td><td>" + a.points + "</td><td>" + a.reason + "</td></tr>"
  ).join("");
}

function renderSettlement() {
  const r = settle(ALLOCATIONS, MEMBERS.map((m) => m.id), ENVELOPE_NEAR);
  el("settleBody").innerHTML = MEMBERS.map((m) => {
    const p = r.per[m.id];
    return "<tr><td>" + m.name + "</td><td>" + p.score +
      "</td><td>" + fmtYocto(p.rawPayoutYocto) + "</td><td>" + (p.capped ? "Yes, capped at " + fmtYocto(r.cap) : "No") +
      "</td><td><b>" + fmtYocto(p.payoutYocto) + "</b></td></tr>";
  }).join("");
  el("settleNote").textContent =
    "Envelope " + ENVELOPE_NEAR + ".000 NEAR. Scores add to " + r.totalScore +
    ". Payouts add to " + fmtYocto(r.totalPayoutYocto) + " NEAR, and " +
    r.dustYocto.toString() + " yocto of dust stays in the contract. Cap is " +
    fmtYocto(r.cap) + " NEAR per member. Values are cut to 3 decimals, so the rows can look 0.001 NEAR short of the total. This is the exact whole number maths the contract runs, not a rounded copy of it.";
  el("settleResult").style.display = "block";
  el("explainPanel").style.display = "block";
  el("explainSelect").innerHTML = MEMBERS.map((m) =>
    "<option value=\"" + m.id + "\">" + m.name + "</option>"
  ).join("");
  renderExplain();
}

function renderExplain() {
  const id = el("explainSelect").value || "amina";
  const r = settle(ALLOCATIONS, MEMBERS.map((m) => m.id), ENVELOPE_NEAR);
  const p = r.per[id];
  el("explainBody").innerHTML = p.givers.map((g) =>
    "<tr><td>" + memberName(g.from) + "</td><td>" + g.points +
    "</td><td>" + g.discount +
    "</td><td>" + g.effective + "</td><td>" + g.sqrt +
    "</td><td>" + g.reason + "</td></tr>"
  ).join("");
  const sqrtSum = p.givers.reduce((s, g) => s + g.sqrt, 0);
  el("explainNote").textContent =
    memberName(id) + ": root parts add to " + sqrtSum +
    ", squared gives score " + p.score + ". Raw payout " + fmtYocto(p.rawPayoutYocto) +
    " NEAR. " + (p.capped
      ? "Cap applies: payout is capped at " + fmtYocto(r.cap) + " NEAR, and the excess goes to the members still below the cap."
      : "Cap does not apply: payout stays below " + fmtYocto(r.cap) + " NEAR.") +
    " Final payout " + fmtYocto(p.payoutYocto) + " NEAR.";
}

function runAttackLab() {
  const ring = settle(LAB_RING, LAB_MEMBERS, LAB_ENVELOPE_NEAR);
  const honest = settle(LAB_HONEST, LAB_MEMBERS, LAB_ENVELOPE_NEAR);
  function rows(r) {
    return LAB_MEMBERS.map((id) => {
      const p = r.per[id];
      const tag = LAB_TRIO.includes(id) ? " (ring trio)" : "";
      return "<tr><td>" + LAB_NAMES[id] + tag + "</td><td>" + p.score +
        "</td><td>" + fmtYocto(p.payoutYocto) + "</td></tr>";
    }).join("");
  }
  el("labRingBody").innerHTML = rows(ring);
  el("labHonestBody").innerHTML = rows(honest);
  const avgYocto = (r, ids) => ids.reduce((s, id) => s + r.per[id].payoutYocto, 0n) / BigInt(ids.length);
  const others = LAB_MEMBERS.filter((id) => !LAB_TRIO.includes(id));
  const ringTrio = avgYocto(ring, LAB_TRIO), honestTrio = avgYocto(honest, LAB_TRIO);
  const ringOthers = avgYocto(ring, others), honestOthers = avgYocto(honest, others);
  // Pure maths demo with the contract's own integer roots: same 100 points,
  // two givers of 50 vs five givers of 20, giver weight 100.
  const two = Math.pow(2 * isqrt(50 * PARAMS.giverWeight), 2);
  const five = Math.pow(5 * isqrt(20 * PARAMS.giverWeight), 2);
  el("labVerdict").innerHTML =
    "<p><b>Ring round:</b> the trio earns " + fmtYocto(ringTrio) + " NEAR each on average, " +
    "while the other six earn " + fmtYocto(ringOthers) + " NEAR each. The ring earns less than the honest members in its own round.</p>" +
    "<p><b>Honest round:</b> the same three people earn " + fmtYocto(honestTrio) + " NEAR each on average, " +
    "while the other six earn " + fmtYocto(honestOthers) + " NEAR each. Honest giving earns the trio " +
    fmtYocto(honestTrio - ringTrio) + " NEAR more per person than the ring did. In the honest round the trio hits the 25% cap, so each one takes exactly 15 NEAR of the 60 NEAR envelope.</p>" +
    "<p><b>Why:</b> the square root rewards breadth. 100 points arriving from 2 givers scores " + two +
    ". The same 100 points arriving from 5 givers scores " + five +
    ". And the reciprocity discount cuts every mutual leg in the ring by half of the shared amount, so the loop keeps less of what it passes around.</p>" +
    "<p><b>Honest limit:</b> this is a simulation, not a proof that collusion is impossible. " +
    "If the whole round colludes, or if outsiders keep pointing at the ring anyway, the ring can still win. " +
    "The maths makes closed loop giving costly. It does not make it impossible.</p>";
  el("labResult").style.display = "block";
}

function renderLive() {
  el("liveContractId").textContent = CONTRACT_ID || "not deployed yet";
  if (CONTRACT_ID) {
    el("liveStatus").textContent =
      "Live mode is on. The page reads live state from " + CONTRACT_ID +
      " on NEAR testnet. The demo round below is still simulated; the live state is shown just under this line.";
    el("liveBadge").textContent = "ON";
    el("liveBadge").classList.add("live");
    el("modeLabel").textContent = "Live contract linked";
    // Browser only: the node DOM shim has no window, so this never runs there.
    if (typeof window !== "undefined") fetchLiveState();
  } else {
    el("liveStatus").textContent =
      "Live mode is off. No contract is linked yet, so the page runs in simulated demo mode only. Nothing here can move funds.";
  }
}

// Read-only live state straight from the contract. No wallet, no signing,
// no funds move. If the browser cannot reach the public RPC, the panel
// says so and the README has the command line check instead.
async function fetchLiveState() {
  const box = el("liveState");
  try {
    async function call(method, args) {
      const res = await fetch("https://rpc.testnet.near.org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: method, method: "query",
          params: {
            request_type: "call_function",
            account_id: CONTRACT_ID,
            method_name: method,
            args_base64: btoa(JSON.stringify(args)),
            finality: "final",
          },
        }),
      });
      const d = await res.json();
      if (d.error) throw new Error("RPC error");
      return JSON.parse(new TextDecoder().decode(new Uint8Array(d.result.result)));
    }
    const params = await call("get_params", {});
    const members = await call("get_members", {});
    const daoInfo = await call("get_dao_info", {});
    const round = await call("get_round", { round_id: 1 });
    const total = round ? fmtYocto(BigInt(round.total_payout_yocto)) : "0.000";
    const envelope = round ? fmtYocto(BigInt(round.envelope_yocto)) : "0.000";
    box.textContent =
      "Live state, read from the contract just now: " + params.points_per_member +
      " points per member · at least " + params.min_recipients +
      " recipients · cap " + (params.cap_bps / 100) + "% · discount " +
      (params.reciprocity_discount_bps / 100) + "% · standing starts at " +
      params.standing_start + " · " + members.length + " members. DAO " +
      daoInfo.dao_id + ", role " + daoInfo.member_role + ", synced " +
      daoInfo.member_count + " members. Round 1: envelope " +
      envelope + " NEAR, " + (round && round.settled
        ? "settled, paid out " + total + " NEAR."
        : "open.") +
      " Members: " + members.join(", ") + ".";
  } catch (e) {
    box.textContent =
      "Live state could not be read from this browser. The contract is still live at " +
      CONTRACT_ID + "; read it with the command line check in the README.";
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    renderMembers();
    renderLive();
    el("settleBtn").addEventListener("click", renderSettlement);
    el("explainSelect").addEventListener("change", renderExplain);
    el("labBtn").addEventListener("click", runAttackLab);
  });
}

if (typeof module !== "undefined") {
  module.exports = { PARAMS, MEMBERS, ALLOCATIONS, ENVELOPE_NEAR, settle, effectivePoints, isqrt, fmtYocto, LAB_MEMBERS, LAB_TRIO, LAB_RING, LAB_HONEST, LAB_ENVELOPE_NEAR };
}
