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

// ---- Live round 1, real onchain result (see ../demo-log.json) ----
// Scores and payouts are the contract record, copied exactly. The page
// also reads them live from the contract; these values are the fallback
// shown when the RPC cannot be reached, labelled as last verified state.
const LIVE_ROUND1 = {
  roundId: 1,
  envelopeYocto: "5000000000000000000000000",
  totalPayoutYocto: "4999999999999999999999997",
  totalScore: 130468,
  settleTx: "2MUqHsLbbMcZGsneNnBBTinUfPXXJwdoRnJjwzxhpJYu",
  members: [
    { id: "alice-fairshare.testnet", name: "Alice", score: 21904, payoutYocto: "839439556059723457092927" },
    { id: "bob-fairshare.testnet", name: "Bob", score: 16129, payoutYocto: "618120918539411963086733" },
    { id: "carol-fairshare.testnet", name: "Carol", score: 7569, payoutYocto: "290071128552595272403961" },
    { id: "dave-fairshare.testnet", name: "Dave", score: 29241, payoutYocto: "1120619615537909679001747" },
    { id: "erin-fairshare.testnet", name: "Erin", score: 24649, payoutYocto: "944637765582365024373792" },
    { id: "frank-fairshare.testnet", name: "Frank", score: 30976, payoutYocto: "1187111015727994604040837" },
  ],
  explanations: {
    "alice-fairshare.testnet": [
      { from: "Frank", points: 61, discount: 0, effective: 61, sqrt: 78 },
      { from: "Carol", points: 18, discount: 9, effective: 9, sqrt: 30 },
      { from: "Bob", points: 8, discount: 4, effective: 4, sqrt: 20 },
      { from: "Dave", points: 7, discount: 3, effective: 4, sqrt: 20 },
    ],
    "bob-fairshare.testnet": [
      { from: "Dave", points: 28, discount: 2, effective: 26, sqrt: 50 },
      { from: "Alice", points: 8, discount: 4, effective: 4, sqrt: 20 },
      { from: "Erin", points: 33, discount: 0, effective: 33, sqrt: 57 },
    ],
    "carol-fairshare.testnet": [
      { from: "Frank", points: 1, discount: 0, effective: 1, sqrt: 10 },
      { from: "Bob", points: 13, discount: 0, effective: 13, sqrt: 36 },
      { from: "Alice", points: 26, discount: 9, effective: 17, sqrt: 41 },
    ],
    "dave-fairshare.testnet": [
      { from: "Frank", points: 4, discount: 0, effective: 4, sqrt: 20 },
      { from: "Bob", points: 4, discount: 2, effective: 2, sqrt: 14 },
      { from: "Alice", points: 66, discount: 3, effective: 63, sqrt: 79 },
      { from: "Erin", points: 66, discount: 32, effective: 34, sqrt: 58 },
    ],
    "erin-fairshare.testnet": [
      { from: "Frank", points: 34, discount: 0, effective: 34, sqrt: 58 },
      { from: "Carol", points: 18, discount: 0, effective: 18, sqrt: 42 },
      { from: "Dave", points: 65, discount: 32, effective: 33, sqrt: 57 },
    ],
    "frank-fairshare.testnet": [
      { from: "Carol", points: 64, discount: 0, effective: 64, sqrt: 80 },
      { from: "Bob", points: 75, discount: 0, effective: 75, sqrt: 86 },
      { from: "Erin", points: 1, discount: 0, effective: 1, sqrt: 10 },
    ],
  },
};

function memberName(id) {
  const m = MEMBERS.find((x) => x.id === id);
  return m ? m.name : id;
}

// ---- Live round 2, real onchain result, read from the contract 2026-11-08 ----
// Six new members, 5 NEAR envelope, total score 125923, payouts sum to
// the envelope minus 3 yocto. Two members hit the 25% cap and were paid
// exactly 1.250 NEAR each, with the excess flowing to the other four.
// Settle tx 6FsBf9r42Ji8afF8G6rebq2GqChmpUQW41cCpTuaodJF, runbook
// ~/workspace/egbe/LIVE_ROUND.md.
const LIVE_ROUND2 = {
  roundId: 2,
  envelopeYocto: "5000000000000000000000000",
  totalPayoutYocto: "4999999999999999999999997",
  totalScore: 125923,
  settleTx: "6FsBf9r42Ji8afF8G6rebq2GqChmpUQW41cCpTuaodJF",
  members: [
    { id: "ibrahim-fairshare.testnet", name: "Ibrahim", score: 36100, payoutYocto: "1250000000000000000000000", capped: true },
    { id: "fatima-fairshare.testnet", name: "Fatima", score: 17689, payoutYocto: "785005502893456882167074", capped: false },
    { id: "ada-fairshare.testnet", name: "Ada", score: 33489, payoutYocto: "1250000000000000000000000", capped: true },
    { id: "ngozi-fairshare.testnet", name: "Ngozi", score: 12321, payoutYocto: "546783470018106294600063", capped: false },
    { id: "tunde-fairshare.testnet", name: "Tunde", score: 6724, payoutYocto: "298398835516739446870451", capped: false },
    { id: "emeka-fairshare.testnet", name: "Emeka", score: 19600, payoutYocto: "869812191571697376362409", capped: false },
  ],
  explanations: {
    "ibrahim-fairshare.testnet": [
      { from: "Fatima", points: 30, discount: 12, effective: 18, sqrt: 42 },
      { from: "Ada", points: 20, discount: 0, effective: 20, sqrt: 44 },
      { from: "Ngozi", points: 25, discount: 0, effective: 25, sqrt: 50 },
      { from: "Tunde", points: 50, discount: 20, effective: 30, sqrt: 54 },
    ],
    "fatima-fairshare.testnet": [
      { from: "Ibrahim", points: 25, discount: 12, effective: 13, sqrt: 36 },
      { from: "Ada", points: 35, discount: 10, effective: 25, sqrt: 50 },
      { from: "Ngozi", points: 45, discount: 22, effective: 23, sqrt: 47 },
    ],
    "ada-fairshare.testnet": [
      { from: "Fatima", points: 20, discount: 10, effective: 10, sqrt: 31 },
      { from: "Ngozi", points: 30, discount: 0, effective: 30, sqrt: 54 },
      { from: "Tunde", points: 30, discount: 0, effective: 30, sqrt: 54 },
      { from: "Emeka", points: 40, discount: 20, effective: 20, sqrt: 44 },
    ],
    "ngozi-fairshare.testnet": [
      { from: "Fatima", points: 50, discount: 22, effective: 28, sqrt: 52 },
      { from: "Emeka", points: 35, discount: 0, effective: 35, sqrt: 59 },
    ],
    "tunde-fairshare.testnet": [
      { from: "Ibrahim", points: 40, discount: 20, effective: 20, sqrt: 44 },
      { from: "Emeka", points: 25, discount: 10, effective: 15, sqrt: 38 },
    ],
    "emeka-fairshare.testnet": [
      { from: "Ibrahim", points: 35, discount: 0, effective: 35, sqrt: 59 },
      { from: "Ada", points: 45, discount: 20, effective: 25, sqrt: 50 },
      { from: "Tunde", points: 20, discount: 10, effective: 10, sqrt: 31 },
    ],
  },
};

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

// ---- Browser rendering (every render guards for a missing element,
// because each page only carries the sections it uses) ----
function el(id) {
  if (typeof document === "undefined") return null;
  return document.getElementById(id);
}

function renderMembers() {
  const mb = el("memberBody");
  if (mb) mb.innerHTML = MEMBERS.map((m) =>
    "<tr><td>" + m.name + "</td><td>" + m.role + "</td><td>100</td></tr>"
  ).join("");
  const ab = el("allocBody");
  if (ab) ab.innerHTML = ALLOCATIONS.map((a) =>
    "<tr><td>" + memberName(a.from) + "</td><td>" + memberName(a.to) +
    "</td><td>" + a.points + "</td><td>" + a.reason + "</td></tr>"
  ).join("");
}

// The try out: the visitor allocates as Amina. The other four members
// keep their seeded allocations. Validation mirrors the contract:
// total at most 100 points, at least 3 distinct recipients, no self
// allocation, every reason non empty for a recipient who gets points.
function renderTryForm() {
  const form = el("tryForm");
  if (!form) return;
  const others = MEMBERS.filter((m) => m.id !== "amina");
  const seed = {};
  for (const a of ALLOCATIONS) if (a.from === "amina") seed[a.to] = a;
  form.innerHTML = others.map((m) => {
    const s = seed[m.id] || { points: 0, reason: "" };
    return "<div><label><b>" + m.name + "</b> (" + m.role + ")</label><br>" +
      "<input type=\"number\" min=\"0\" max=\"100\" value=\"" + s.points +
      "\" data-to=\"" + m.id + "\" class=\"tryPoints\" aria-label=\"Points for " + m.name + "\"> points " +
      "<input type=\"text\" maxlength=\"200\" value=\"" + s.reason.replace(/"/g, "&quot;") +
      "\" data-to=\"" + m.id + "\" class=\"tryReason\" placeholder=\"Why does " + m.name + " deserve points?\" aria-label=\"Reason for " + m.name + "\"></div>";
  }).join("");
  const update = () => {
    const status = el("tryStatus");
    if (!status || typeof form.querySelectorAll !== "function") return;
    const total = Array.from(form.querySelectorAll(".tryPoints"))
      .reduce((s, i) => s + (parseInt(i.value, 10) || 0), 0);
    status.textContent = total > 100
      ? "You have given " + total + " points. That is over 100. Take some back."
      : "You have " + (100 - total) + " points left to give.";
  };
  if (typeof form.querySelectorAll === "function") {
    form.querySelectorAll(".tryPoints").forEach((i) => i.addEventListener("input", update));
  }
  update();
}

function readTryAllocations() {
  const form = el("tryForm");
  if (!form || typeof form.querySelectorAll !== "function") return { allocations: ALLOCATIONS };
  const mine = [];
  let error = null;
  form.querySelectorAll(".tryPoints").forEach((input) => {
    const to = input.getAttribute("data-to");
    const points = parseInt(input.value, 10) || 0;
    const reasonInput = form.querySelector(".tryReason[data-to=\"" + to + "\"]");
    const reason = reasonInput ? reasonInput.value.trim() : "";
    if (points < 0 || points > 100) error = "Points for one member must be between 0 and 100.";
    if (points > 0) {
      if (!reason) error = "Every gift needs a reason. Add one for " + memberName(to) + ".";
      mine.push({ from: "amina", to, points, reason });
    }
  });
  const total = mine.reduce((s, a) => s + a.points, 0);
  if (!error && total > 100) error = "You gave " + total + " points. The most you can give is 100.";
  if (!error && mine.length < PARAMS.minRecipients) error = "Name at least 3 recipients. You named " + mine.length + ".";
  if (error) return { error };
  const rest = ALLOCATIONS.filter((a) => a.from !== "amina");
  return { allocations: rest.concat(mine) };
}

function renderSettlement() {
  const read = readTryAllocations();
  const status = el("tryStatus");
  if (read && read.error) {
    if (status) status.textContent = read.error;
    return;
  }
  const allocations = read ? read.allocations : ALLOCATIONS;
  const r = settle(allocations, MEMBERS.map((m) => m.id), ENVELOPE_NEAR);
  const body = el("settleBody");
  if (body) body.innerHTML = MEMBERS.map((m) => {
    const p = r.per[m.id];
    return "<tr><td>" + m.name + "</td><td>" + p.score +
      "</td><td>" + fmtYocto(p.rawPayoutYocto) + "</td><td>" + (p.capped ? "Yes, capped at " + fmtYocto(r.cap) : "No") +
      "</td><td><b>" + fmtYocto(p.payoutYocto) + "</b></td></tr>";
  }).join("");
  const note = el("settleNote");
  if (note) note.textContent =
    "Envelope " + ENVELOPE_NEAR + ".000 NEAR. Scores add to " + r.totalScore +
    ". Payouts add to " + fmtYocto(r.totalPayoutYocto) + " NEAR, and " +
    r.dustYocto.toString() + " yocto of dust stays in the contract. Cap is " +
    fmtYocto(r.cap) + " NEAR per member. Values are cut to 3 decimals, so the rows can look 0.001 NEAR short of the total. This is the exact whole number maths the contract runs, not a rounded copy of it.";
  const res = el("settleResult");
  if (res) res.style.display = "block";
  const panel = el("explainPanel");
  if (panel) panel.style.display = "block";
  const sel = el("explainSelect");
  if (sel) {
    sel.innerHTML = MEMBERS.map((m) =>
      "<option value=\"" + m.id + "\">" + m.name + "</option>"
    ).join("");
    renderExplain();
  }
  if (status) status.textContent = "Settled. Change your points and settle again to see how the result moves.";
}

function renderExplain() {
  const sel = el("explainSelect");
  if (!sel) return;
  const read = readTryAllocations();
  const allocations = read && !read.error && read.allocations ? read.allocations : ALLOCATIONS;
  const id = sel.value || "amina";
  const r = settle(allocations, MEMBERS.map((m) => m.id), ENVELOPE_NEAR);
  const p = r.per[id];
  const body = el("explainBody");
  if (body) body.innerHTML = p.givers.map((g) =>
    "<tr><td>" + memberName(g.from) + "</td><td>" + g.points +
    "</td><td>" + g.discount +
    "</td><td>" + g.effective + "</td><td>" + g.sqrt +
    "</td><td>" + g.reason + "</td></tr>"
  ).join("");
  const sqrtSum = p.givers.reduce((s, g) => s + g.sqrt, 0);
  const note = el("explainNote");
  if (note) note.textContent =
    memberName(id) + ": root parts add to " + sqrtSum +
    ", squared gives score " + p.score + ". Raw payout " + fmtYocto(p.rawPayoutYocto) +
    " NEAR. " + (p.capped
      ? "Cap applies: payout is capped at " + fmtYocto(r.cap) + " NEAR, and the excess goes to the members still below the cap."
      : "Cap does not apply: payout stays below " + fmtYocto(r.cap) + " NEAR.") +
    " Final payout " + fmtYocto(p.payoutYocto) + " NEAR.";
}

// ---- Live round 1, real onchain result ----
function renderLiveRound() {
  const body = el("liveRoundBody");
  if (!body) return;
  body.innerHTML = LIVE_ROUND1.members.map((m) => {
    const share = (m.score / LIVE_ROUND1.totalScore) * 100;
    return "<tr><td><a href=\"https://testnet.nearblocks.io/address/" + m.id + "\">" + m.name + "</a><br><span class=\"muted\">" + m.id + "</span></td>" +
      "<td>" + m.score + "</td>" +
      "<td><div class=\"bar\"><i style=\"width:" + share.toFixed(1) + "%\"></i></div>" + share.toFixed(2) + "%</td>" +
      "<td><b>" + fmtYocto(BigInt(m.payoutYocto)) + " NEAR</b></td></tr>";
  }).join("");
  const sel = el("liveExplainSelect");
  if (sel) {
    sel.innerHTML = LIVE_ROUND1.members.map((m) =>
      "<option value=\"" + m.id + "\">" + m.name + "</option>"
    ).join("");
    renderLiveExplain();
  }
}

function renderLiveExplain() {
  const sel = el("liveExplainSelect");
  if (!sel) return;
  const id = sel.value || LIVE_ROUND1.members[0].id;
  const m = LIVE_ROUND1.members.find((x) => x.id === id) || LIVE_ROUND1.members[0];
  const rows = LIVE_ROUND1.explanations[m.id] || [];
  const body = el("liveExplainBody");
  if (body) body.innerHTML = rows.map((g) =>
    "<tr><td>" + g.from + "</td><td>" + g.points + "</td><td>" + g.discount +
    "</td><td>" + g.effective + "</td><td>" + g.sqrt + "</td></tr>"
  ).join("");
  const sqrtSum = rows.reduce((s, g) => s + g.sqrt, 0);
  const note = el("liveExplainNote");
  if (note) note.textContent =
    m.name + ": root parts add to " + sqrtSum +
    ", squared gives score " + m.score + ". Payout " +
    fmtYocto(BigInt(m.payoutYocto)) + " NEAR. This explanation is the contract record for round 1, copied exactly from the onchain explain_payout result.";
}

// ---- Live round 2 ----
function renderLiveRound2() {
  const body = el("liveRound2Body");
  if (!body) return;
  body.innerHTML = LIVE_ROUND2.members.map((m) => {
    const share = (m.score / LIVE_ROUND2.totalScore) * 100;
    return "<tr><td><a href=\"https://testnet.nearblocks.io/address/" + m.id + "\">" + m.name + "</a><br><span class=\"muted\">" + m.id + "</span></td>" +
      "<td>" + m.score + "</td>" +
      "<td><div class=\"bar\"><i style=\"width:" + share.toFixed(1) + "%\"></i></div>" + share.toFixed(2) + "%</td>" +
      "<td>" + (m.capped ? "Yes, capped at 1.250" : "No") + "</td>" +
      "<td><b>" + fmtYocto(BigInt(m.payoutYocto)) + " NEAR</b></td></tr>";
  }).join("");
  const sel = el("liveExplain2Select");
  if (sel) {
    sel.innerHTML = LIVE_ROUND2.members.map((m) =>
      "<option value=\"" + m.id + "\">" + m.name + "</option>"
    ).join("");
    renderLiveExplain2();
  }
  const badge = el("round2Badge");
  if (badge) { badge.textContent = "SETTLED ONCHAIN"; badge.classList.add("live"); }
  const note = el("round2Note");
  if (note) note.textContent =
    "Round 2 settled onchain with a 5 NEAR envelope and 6 new members. Payouts add to 4.999 NEAR, 3 yocto of dust stays in the contract. Two members hit the 25% cap and were paid exactly 1.250 NEAR each, with the excess flowing to the other four. This is the cap working live, not in a test.";
}

function renderLiveExplain2() {
  const sel = el("liveExplain2Select");
  if (!sel) return;
  const id = sel.value || LIVE_ROUND2.members[0].id;
  const m = LIVE_ROUND2.members.find((x) => x.id === id) || LIVE_ROUND2.members[0];
  const rows = LIVE_ROUND2.explanations[m.id] || [];
  const body = el("liveExplain2Body");
  if (body) body.innerHTML = rows.map((g) =>
    "<tr><td>" + g.from + "</td><td>" + g.points + "</td><td>" + g.discount +
    "</td><td>" + g.effective + "</td><td>" + g.sqrt + "</td></tr>"
  ).join("");
  const sqrtSum = rows.reduce((s, g) => s + g.sqrt, 0);
  const note = el("liveExplain2Note");
  if (note) note.textContent =
    m.name + ": root parts add to " + sqrtSum +
    ", squared gives score " + m.score + ". " + (m.capped
      ? "Raw payout was above the 1.250 NEAR cap, so the payout is capped at 1.250 NEAR and the excess went to the members still below the cap."
      : "Payout " + fmtYocto(BigInt(m.payoutYocto)) + " NEAR.") +
    " This explanation is the contract record for round 2, copied exactly from the onchain explain_payout result.";
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
  const rb = el("labRingBody");
  if (rb) rb.innerHTML = rows(ring);
  const hb = el("labHonestBody");
  if (hb) hb.innerHTML = rows(honest);
  const avgYocto = (r, ids) => ids.reduce((s, id) => s + r.per[id].payoutYocto, 0n) / BigInt(ids.length);
  const others = LAB_MEMBERS.filter((id) => !LAB_TRIO.includes(id));
  const ringTrio = avgYocto(ring, LAB_TRIO), honestTrio = avgYocto(honest, LAB_TRIO);
  const ringOthers = avgYocto(ring, others), honestOthers = avgYocto(honest, others);
  // Pure maths demo with the contract's own integer roots: same 100 points,
  // two givers of 50 vs five givers of 20, giver weight 100.
  const two = Math.pow(2 * isqrt(50 * PARAMS.giverWeight), 2);
  const five = Math.pow(5 * isqrt(20 * PARAMS.giverWeight), 2);
  const verdict = el("labVerdict");
  if (verdict) verdict.innerHTML =
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
  const res = el("labResult");
  if (res) res.style.display = "block";
}

// Read-only live state straight from the contract. No wallet, no signing,
// no funds move. If the browser cannot reach the public RPC, the page
// says so plainly and keeps the last verified values, labelled as such.
async function fetchLiveState() {
  const box = el("liveState");
  const statsNote = el("statsNote");
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
    const round1 = await call("get_round", { round_id: 1 });
    let round2 = null;
    try { round2 = await call("get_round", { round_id: 2 }); } catch (e) { round2 = null; }
    const total = round1 ? fmtYocto(BigInt(round1.total_payout_yocto)) : "0.000";
    const envelope = round1 ? fmtYocto(BigInt(round1.envelope_yocto)) : "0.000";
    const sm = el("statMembers");
    if (sm) sm.textContent = String(members.length);
    const se = el("statEnvelope");
    if (se) se.textContent = envelope + " NEAR";
    const sp = el("statPaid");
    if (sp) sp.textContent = total + " NEAR";
    if (statsNote) statsNote.textContent =
      "Numbers above were read live from the contract just now.";
    if (box) box.textContent =
      "Live state, read from the contract just now: " + params.points_per_member +
      " points per member · at least " + params.min_recipients +
      " recipients · cap " + (params.cap_bps / 100) + "% · discount " +
      (params.reciprocity_discount_bps / 100) + "% · standing starts at " +
      params.standing_start + " · " + members.length + " members. DAO " +
      daoInfo.dao_id + ", role " + daoInfo.member_role + ", synced " +
      daoInfo.member_count + " members. Round 1: envelope " +
      envelope + " NEAR, " + (round1 && round1.settled
        ? "settled, paid out " + total + " NEAR."
        : "open.") +
      " Members: " + members.join(", ") + ".";
    const r2note = el("round2Note");
    const r2badge = el("round2Badge");
    if (round2 && !round2.settled) {
      if (r2badge) { r2badge.textContent = "OPEN"; r2badge.classList.add("live"); }
      if (r2note) r2note.textContent =
        "Round 2 is onchain: envelope " + fmtYocto(BigInt(round2.envelope_yocto)) +
        " NEAR, open, not settled yet.";
    }
  } catch (e) {
    if (box) box.textContent =
      "Live state could not be read from this browser. The numbers on this page are the last verified onchain state: round 1, 5.000 NEAR envelope, 4.999 NEAR paid out, 12 members in the DAO. The contract is still live at " +
      CONTRACT_ID + "; read it with the command line check in the README.";
    if (statsNote) statsNote.textContent =
      "Numbers above are the last verified onchain state. The live read failed just now, so they were not refreshed.";
  }
}

function renderLive() {
  const cid = el("liveContractId");
  if (cid) cid.textContent = CONTRACT_ID || "not deployed yet";
  const badge = el("liveBadge");
  if (CONTRACT_ID && typeof window !== "undefined") fetchLiveState();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    renderMembers();
    renderTryForm();
    renderLiveRound();
    renderLiveRound2();
    renderLive();
    const settleBtn = el("settleBtn");
    if (settleBtn) settleBtn.addEventListener("click", renderSettlement);
    const explainSel = el("explainSelect");
    if (explainSel) explainSel.addEventListener("change", renderExplain);
    const liveSel = el("liveExplainSelect");
    if (liveSel) liveSel.addEventListener("change", renderLiveExplain);
    const liveSel2 = el("liveExplain2Select");
    if (liveSel2) liveSel2.addEventListener("change", renderLiveExplain2);
    const labBtn = el("labBtn");
    if (labBtn) labBtn.addEventListener("click", runAttackLab);
  });
}

if (typeof module !== "undefined") {
  module.exports = { PARAMS, MEMBERS, ALLOCATIONS, ENVELOPE_NEAR, settle, effectivePoints, isqrt, fmtYocto, LAB_MEMBERS, LAB_TRIO, LAB_RING, LAB_HONEST, LAB_ENVELOPE_NEAR, LIVE_ROUND1, LIVE_ROUND2, CONTRACT_ID, DAO_ID };
}
