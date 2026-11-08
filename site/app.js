// FairShare — peer allocation of credit. NEAR testnet only.
// Settlement math. This file mirrors the Rust contract in
// ../contract/src/lib.rs EXACTLY, including its integer arithmetic:
//   * discount on a mutual pair = floor(min(points) * 5000 / 10000),
//     taken off BOTH directions before scoring.
//   * sqrt contribution = isqrt(effective_points * giver_weight), where
//     giver_weight is the giver's standing, which starts at 100 and moves
//     at each settle: +2 per distinct giver, capped at +10 a round, -5
//     for submitting no allocations, clamped to [50, 200].
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
const BADGE_CONTRACT_ID = "fairshare-badge.testnet";

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
// LIVE_ROUND.md.
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

// ---- Live round 3, real onchain result ----
// First round settled under the standing rule. Total score 429829,
// payouts sum to the envelope minus 5 yocto. Ada capped at 1.250 NEAR.
// Settle tx 7ZbAQganvPJKGHsQkUGYXE56tdvqLm9UM1CGRwcCkMWG, runbook
// LIVE_ROUND.md.
const LIVE_ROUND3 = {
  roundId: 3,
  envelopeYocto: "5000000000000000000000000",
  totalPayoutYocto: "4999999999999999999999995",
  totalScore: 429829,
  settleTx: "7ZbAQganvPJKGHsQkUGYXE56tdvqLm9UM1CGRwcCkMWG",
  members: [
    { id: "ada-fairshare.testnet", name: "Ada", score: 272484, payoutYocto: "1250000000000000000000000", capped: true, standingBefore: 100, standingAfter: 110 },
    { id: "emeka-fairshare.testnet", name: "Emeka", score: 29241, payoutYocto: "696900123931488131176713", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "tunde-fairshare.testnet", name: "Tunde", score: 26244, payoutYocto: "625472687406654167593504", capped: false, standingBefore: 100, standingAfter: 95 },
    { id: "fatima-fairshare.testnet", name: "Fatima", score: 21316, payoutYocto: "508023769423877466713273", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "ibrahim-fairshare.testnet", name: "Ibrahim", score: 21316, payoutYocto: "508023769423877466713273", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "ngozi-fairshare.testnet", name: "Ngozi", score: 21316, payoutYocto: "508023769423877466713273", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "bob-fairshare.testnet", name: "Bob", score: 9604, payoutYocto: "228891925386888684101814", capped: false, standingBefore: 100, standingAfter: 104 },
    { id: "carol-fairshare.testnet", name: "Carol", score: 8464, payoutYocto: "201722329911976866122215", capped: false, standingBefore: 100, standingAfter: 104 },
    { id: "dave-fairshare.testnet", name: "Dave", score: 8464, payoutYocto: "201722329911976866122215", capped: false, standingBefore: 100, standingAfter: 104 },
    { id: "frank-fairshare.testnet", name: "Frank", score: 8464, payoutYocto: "201722329911976866122215", capped: false, standingBefore: 100, standingAfter: 104 },
    { id: "erin-fairshare.testnet", name: "Erin", score: 2916, payoutYocto: "69496965267406018621500", capped: false, standingBefore: 100, standingAfter: 102 },
    { id: "alice-fairshare.testnet", name: "Alice", score: 0, payoutYocto: "0", capped: false, standingBefore: 100, standingAfter: 100 },
  ],
};

// ---- Live round 4, real onchain result ----
// Six new members, 5 NEAR envelope, total score 117945, payouts sum to
// the envelope minus 3 yocto. No member hit the 25% cap; the highest raw
// share was 17.58%. Settle tx AXBjLUKBCBL4NcVAFhcQPRqEyEsSFA6cB4UtLMbKCWjR.
const LIVE_ROUND4 = {
  roundId: 4,
  envelopeYocto: "5000000000000000000000000",
  totalPayoutYocto: "4999999999999999999999997",
  totalScore: 117945,
  settleTx: "AXBjLUKBCBL4NcVAFhcQPRqEyEsSFA6cB4UtLMbKCWjR",
  members: [
    { id: "kemi-fairshare.testnet", name: "Kemi", score: 20736, payoutYocto: "879053796260969095764975", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "zainab-fairshare.testnet", name: "Zainab", score: 20736, payoutYocto: "879053796260969095764975", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "tobi-fairshare.testnet", name: "Tobi", score: 19881, payoutYocto: "842808088515833651278138", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "amara-fairshare.testnet", name: "Amara", score: 19600, payoutYocto: "830895756496672177709949", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "chidi-fairshare.testnet", name: "Chidi", score: 18496, payoutYocto: "784094281232777989740980", capped: false, standingBefore: 100, standingAfter: 106 },
    { id: "segun-fairshare.testnet", name: "Segun", score: 18496, payoutYocto: "784094281232777989740980", capped: false, standingBefore: 100, standingAfter: 106 },
  ],
};

// Standing after each settled round, from the round records. The standing
// rule went live with the fine tune, so rounds 1 and 2 left everyone at
// 100. Round 3 moved the 12 members then on the council; round 4 moved
// the six new members to 106 and cost the older twelve 5 each for
// submitting nothing. The six round 4 members joined at 100, and
// clearsite587.testnet joined after round 4 at 100.
const STANDINGS_HISTORY = [
  { id: "alice-fairshare.testnet", name: "Alice", after: { 2: 100, 3: 100, 4: 95 } },
  { id: "bob-fairshare.testnet", name: "Bob", after: { 2: 100, 3: 104, 4: 99 } },
  { id: "carol-fairshare.testnet", name: "Carol", after: { 2: 100, 3: 104, 4: 99 } },
  { id: "dave-fairshare.testnet", name: "Dave", after: { 2: 100, 3: 104, 4: 99 } },
  { id: "erin-fairshare.testnet", name: "Erin", after: { 2: 100, 3: 102, 4: 97 } },
  { id: "frank-fairshare.testnet", name: "Frank", after: { 2: 100, 3: 104, 4: 99 } },
  { id: "ada-fairshare.testnet", name: "Ada", after: { 2: 100, 3: 110, 4: 105 } },
  { id: "emeka-fairshare.testnet", name: "Emeka", after: { 2: 100, 3: 106, 4: 101 } },
  { id: "fatima-fairshare.testnet", name: "Fatima", after: { 2: 100, 3: 106, 4: 101 } },
  { id: "ibrahim-fairshare.testnet", name: "Ibrahim", after: { 2: 100, 3: 106, 4: 101 } },
  { id: "ngozi-fairshare.testnet", name: "Ngozi", after: { 2: 100, 3: 106, 4: 101 } },
  { id: "tunde-fairshare.testnet", name: "Tunde", after: { 2: 100, 3: 95, 4: 90 } },
];

// Last verified totals for the home dashboard, used only when the live
// read fails. Total paid is the sum of the four settled rounds
// (4999999999999999999999997 + 4999999999999999999999997 +
// 4999999999999999999999995 + 4999999999999999999999997 yocto).
// DAO balance is the live total read 2026-11-08, 40.15 NEAR.
const HOME_DASHBOARD_FALLBACK = {
  totalPaidYocto: "19999999999999999999999986",
  members: 19,
  roundsSettled: 4,
  daoBalanceYocto: "40150000000000000000000000",
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
// weights is an optional map of member id to standing before the round;
// the contract scores each gift with the GIVER's standing, so a scenario
// with mixed standings passes them here. Without weights every giver
// weighs PARAMS.giverWeight (100), which is the standing every member
// starts at, so existing calls are unchanged.
function settle(allocations, memberIds, poolNear, weights) {
  const poolYocto = BigInt(poolNear) * YOCTO_PER_NEAR;
  const eff = effectivePoints(allocations);
  const weightOf = (id) => (weights && weights[id] !== undefined ? weights[id] : PARAMS.giverWeight);
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
      sqrt: isqrt(e * weightOf(a.from)),
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

// Standing after a settle, mirroring the contract exactly. A member who
// submitted gains +2 per distinct giver who gave them points this round,
// capped at +10 a round. A member who submitted nothing loses 5. Standing
// is clamped to [50, 200]. Scoring for this round uses the standings
// BEFORE this update, so callers pass the pre round map and get the post
// round map back.
function standingAfter(allocations, memberIds, standings) {
  const next = {};
  for (const id of memberIds) {
    const before = standings && standings[id] !== undefined ? standings[id] : PARAMS.giverWeight;
    const submitted = allocations.some((a) => a.from === id);
    const givers = [];
    for (const a of allocations) {
      if (a.to === id && givers.indexOf(a.from) < 0) givers.push(a.from);
    }
    const gain = Math.min(givers.length * 2, 10);
    const updated = submitted ? before + gain : before - 5;
    next[id] = Math.max(50, Math.min(200, updated));
  }
  return next;
}

// ---- Fairness Stress Test scenarios ----
// Five scenarios a judge can pick, each settled with the same settle()
// above, which is the contract maths. Six members, 5 NEAR envelope each.
// Ada, Ben, Cara, Dan, Eli, Fay are made up names for the simulation;
// the members, points, and standings are the scenario, not real people.
const STRESS_MEMBERS = ["ada", "ben", "cara", "dan", "eli", "fay"];
const STRESS_NAMES = { ada: "Ada", ben: "Ben", cara: "Cara", dan: "Dan", eli: "Eli", fay: "Fay" };
const STRESS_ENVELOPE_NEAR = 5;
const STRESS_SCENARIOS = [
  {
    id: "ring",
    title: "Three friends reward each other",
    blurb: "Ada, Ben, and Cara form a ring and point only at each other, 40 points each way. The other three did no work for the trio, so they give the trio only a token 1 point each and point at each other instead.",
    standings: { ada: 100, ben: 100, cara: 100, dan: 100, eli: 100, fay: 100 },
    allocations: [
      { from: "ada", to: "ben", points: 40, reason: "Ring giving" },
      { from: "ada", to: "cara", points: 40, reason: "Ring giving" },
      { from: "ada", to: "dan", points: 20, reason: "Third recipient, required" },
      { from: "ben", to: "ada", points: 40, reason: "Ring giving" },
      { from: "ben", to: "cara", points: 40, reason: "Ring giving" },
      { from: "ben", to: "eli", points: 20, reason: "Third recipient, required" },
      { from: "cara", to: "ada", points: 40, reason: "Ring giving" },
      { from: "cara", to: "ben", points: 40, reason: "Ring giving" },
      { from: "cara", to: "fay", points: 20, reason: "Third recipient, required" },
      { from: "dan", to: "eli", points: 49, reason: "Helped with a delivery" },
      { from: "dan", to: "fay", points: 50, reason: "Helped with a delivery" },
      { from: "dan", to: "ada", points: 1, reason: "Token point, no work done for me" },
      { from: "eli", to: "dan", points: 49, reason: "Helped with a delivery" },
      { from: "eli", to: "fay", points: 50, reason: "Helped with a delivery" },
      { from: "eli", to: "ben", points: 1, reason: "Token point, no work done for me" },
      { from: "fay", to: "dan", points: 50, reason: "Helped with a delivery" },
      { from: "fay", to: "eli", points: 49, reason: "Helped with a delivery" },
      { from: "fay", to: "cara", points: 1, reason: "Token point, no work done for me" },
    ],
  },
  {
    id: "popular",
    title: "A popular member receives from everyone",
    blurb: "Ada is the member everyone likes. All five others give Ada 40 points each. Ada gives back, but only 34, 33, and 33 points, to three of them.",
    standings: { ada: 100, ben: 100, cara: 100, dan: 100, eli: 100, fay: 100 },
    allocations: [
      { from: "ada", to: "ben", points: 34, reason: "Covered a shift" },
      { from: "ada", to: "cara", points: 33, reason: "Helped with stock" },
      { from: "ada", to: "dan", points: 33, reason: "Ran the stall" },
      { from: "ben", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "ben", to: "cara", points: 30, reason: "Helped with stock" },
      { from: "ben", to: "dan", points: 30, reason: "Ran the stall" },
      { from: "cara", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "cara", to: "ben", points: 30, reason: "Covered a shift" },
      { from: "cara", to: "eli", points: 30, reason: "Helped with a delivery" },
      { from: "dan", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "dan", to: "eli", points: 30, reason: "Helped with a delivery" },
      { from: "dan", to: "fay", points: 30, reason: "Kept the books" },
      { from: "eli", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "eli", to: "dan", points: 30, reason: "Ran the stall" },
      { from: "eli", to: "fay", points: 30, reason: "Kept the books" },
      { from: "fay", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "fay", to: "dan", points: 30, reason: "Ran the stall" },
      { from: "fay", to: "eli", points: 30, reason: "Helped with a delivery" },
    ],
  },
  {
    id: "newcomer",
    title: "A new member joins an established DAO",
    blurb: "Fay is new, standing 100. The five veterans stand at 160, so their gifts weigh more than hers. Fay did real work, and three veterans point at her. The question is whether a newcomer can earn a fair share at all.",
    standings: { ada: 160, ben: 160, cara: 160, dan: 160, eli: 160, fay: 100 },
    allocations: [
      { from: "ada", to: "ben", points: 40, reason: "Covered a shift" },
      { from: "ada", to: "cara", points: 30, reason: "Helped with stock" },
      { from: "ada", to: "fay", points: 30, reason: "Fay repaired the freezer" },
      { from: "ben", to: "ada", points: 40, reason: "Ran the stall" },
      { from: "ben", to: "cara", points: 30, reason: "Helped with stock" },
      { from: "ben", to: "dan", points: 30, reason: "Ran the stall" },
      { from: "cara", to: "ada", points: 40, reason: "Ran the stall" },
      { from: "cara", to: "ben", points: 30, reason: "Covered a shift" },
      { from: "cara", to: "eli", points: 30, reason: "Helped with a delivery" },
      { from: "dan", to: "ada", points: 40, reason: "Ran the stall" },
      { from: "dan", to: "eli", points: 30, reason: "Helped with a delivery" },
      { from: "dan", to: "fay", points: 30, reason: "Fay repaired the freezer" },
      { from: "eli", to: "ada", points: 40, reason: "Ran the stall" },
      { from: "eli", to: "dan", points: 30, reason: "Ran the stall" },
      { from: "eli", to: "fay", points: 30, reason: "Fay repaired the freezer" },
      { from: "fay", to: "ada", points: 40, reason: "Ada ran the stall" },
      { from: "fay", to: "ben", points: 30, reason: "Ben covered a shift" },
      { from: "fay", to: "cara", points: 30, reason: "Cara helped with stock" },
    ],
  },
  {
    id: "allcollude",
    title: "A group where everyone colludes",
    blurb: "All six members are in one ring. Everyone gives 40 points each way to two neighbours and 20 to a third. There is no honest member left in the round. This is the scenario the maths cannot fix, and the test says so.",
    standings: { ada: 100, ben: 100, cara: 100, dan: 100, eli: 100, fay: 100 },
    allocations: [
      { from: "ada", to: "ben", points: 40, reason: "Ring giving" },
      { from: "ada", to: "fay", points: 40, reason: "Ring giving" },
      { from: "ada", to: "cara", points: 20, reason: "Ring giving" },
      { from: "ben", to: "ada", points: 40, reason: "Ring giving" },
      { from: "ben", to: "cara", points: 40, reason: "Ring giving" },
      { from: "ben", to: "dan", points: 20, reason: "Ring giving" },
      { from: "cara", to: "ben", points: 40, reason: "Ring giving" },
      { from: "cara", to: "dan", points: 40, reason: "Ring giving" },
      { from: "cara", to: "eli", points: 20, reason: "Ring giving" },
      { from: "dan", to: "cara", points: 40, reason: "Ring giving" },
      { from: "dan", to: "eli", points: 40, reason: "Ring giving" },
      { from: "dan", to: "fay", points: 20, reason: "Ring giving" },
      { from: "eli", to: "dan", points: 40, reason: "Ring giving" },
      { from: "eli", to: "fay", points: 40, reason: "Ring giving" },
      { from: "eli", to: "ada", points: 20, reason: "Ring giving" },
      { from: "fay", to: "eli", points: 40, reason: "Ring giving" },
      { from: "fay", to: "ada", points: 40, reason: "Ring giving" },
      { from: "fay", to: "ben", points: 20, reason: "Ring giving" },
    ],
  },
  {
    id: "unpopular",
    title: "A productive member who is unpopular",
    blurb: "Fay does the real work, she repairs the freezers, but she is not liked. She receives only 70 points in total. Ada is popular and receives 200 points. Fay still gives generously to the others.",
    standings: { ada: 100, ben: 100, cara: 100, dan: 100, eli: 100, fay: 100 },
    allocations: [
      { from: "ada", to: "ben", points: 45, reason: "Covered a shift" },
      { from: "ada", to: "cara", points: 45, reason: "Helped with stock" },
      { from: "ada", to: "fay", points: 10, reason: "Fixed a light" },
      { from: "ben", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "ben", to: "cara", points: 30, reason: "Helped with stock" },
      { from: "ben", to: "dan", points: 30, reason: "Ran the stall" },
      { from: "cara", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "cara", to: "ben", points: 30, reason: "Covered a shift" },
      { from: "cara", to: "eli", points: 30, reason: "Helped with a delivery" },
      { from: "dan", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "dan", to: "eli", points: 30, reason: "Helped with a delivery" },
      { from: "dan", to: "fay", points: 30, reason: "Fay repaired the freezer" },
      { from: "eli", to: "ada", points: 40, reason: "Ada is the one everyone trusts" },
      { from: "eli", to: "dan", points: 30, reason: "Ran the stall" },
      { from: "eli", to: "fay", points: 30, reason: "Fay repaired the freezer" },
      { from: "fay", to: "ada", points: 40, reason: "Ada ran the stall" },
      { from: "fay", to: "ben", points: 30, reason: "Ben covered a shift" },
      { from: "fay", to: "cara", points: 30, reason: "Cara helped with stock" },
    ],
  },
];

function stressName(id) { return STRESS_NAMES[id] || id; }

function runStressScenario(scenarioId) {
  const sc = STRESS_SCENARIOS.find((s) => s.id === scenarioId) || STRESS_SCENARIOS[0];
  const r = settle(sc.allocations, STRESS_MEMBERS, STRESS_ENVELOPE_NEAR, sc.standings);
  const after = standingAfter(sc.allocations, STRESS_MEMBERS, sc.standings);
  const blurb = el("stressBlurb");
  if (blurb) blurb.textContent = sc.blurb;
  const pb = el("stressPatternBody");
  if (pb) pb.innerHTML = sc.allocations.map((a) =>
    "<tr><td>" + stressName(a.from) + "</td><td>" + stressName(a.to) +
    "</td><td>" + a.points + "</td><td>" + a.reason + "</td></tr>"
  ).join("");
  const rb = el("stressResultBody");
  if (rb) rb.innerHTML = STRESS_MEMBERS.map((id) => {
    const p = r.per[id];
    const received = sc.allocations.filter((a) => a.to === id).reduce((s, a) => s + a.points, 0);
    return "<tr><td>" + stressName(id) + "</td><td>" + p.givers.length +
      "</td><td>" + received + "</td><td>" + p.score +
      "</td><td>" + fmtYocto(p.rawPayoutYocto) + "</td><td>" + (p.capped ? "Yes, capped at " + fmtYocto(r.cap) : "No") +
      "</td><td><b>" + fmtYocto(p.payoutYocto) + "</b></td><td>" + sc.standings[id] + " to " + after[id] + "</td></tr>";
  }).join("");
  const verdict = el("stressVerdict");
  if (verdict) verdict.innerHTML = stressVerdict(sc, r, after);
  const res = el("stressResult");
  if (res) res.style.display = "block";
  return { scenario: sc, result: r, standingAfter: after };
}

// Verdicts are built from the computed numbers, so the words can never
// drift away from the maths. Each one names what the mechanism caught
// and where its limit is.
function stressVerdict(sc, r, after) {
  const pay = (id) => fmtYocto(r.per[id].payoutYocto);
  const raw = (id) => fmtYocto(r.per[id].rawPayoutYocto);
  const total = fmtYocto(r.totalPayoutYocto);
  const head = "<p><b>Scores add to " + r.totalScore + ". Payouts add to " + total +
    " NEAR of the 5.000 NEAR envelope, " + r.dustYocto.toString() +
    " yocto of dust stays in the contract. No payout passes the " + fmtYocto(r.cap) + " NEAR cap.</b></p>";
  if (sc.id === "ring") {
    return head + "<p><b>What the mechanism caught:</b> the ring trio earns " + pay("ada") +
      " NEAR each, while the honest three earn " + pay("dan") +
      " NEAR each. Every mutual 40 point gift inside the ring is cut by the reciprocity discount to 20 effective points, and the outsiders gave the trio only a token 1 point each, because the trio did no work for them. The ring earns less than half of what honest members earn in the same round.</p>" +
      "<p><b>The limit:</b> the ring still takes " + pay("ada") + " NEAR each. The mechanism taxes closed loop giving. It does not ban it. A ring that keeps its members fed at a low level can run forever.</p>";
  }
  if (sc.id === "popular") {
    const cappedIds = STRESS_MEMBERS.filter((id) => r.per[id].capped);
    const othersCapped = cappedIds.filter((id) => id !== "ada").map((id) => stressName(id) + " is capped too, at " + pay(id) + " NEAR").join("; ");
    const pct = (Number(r.per["ada"].rawPayoutYocto) / Number(r.poolYocto) * 100).toFixed(0);
    return head + "<p><b>What the mechanism caught:</b> Ada received 200 points from all five others, and her raw share is " + raw("ada") +
      " NEAR, " + pct + "% of the envelope. The 25% cap holds her at " + pay("ada") +
      " NEAR, and the surplus flows to the rest. " + (othersCapped ? othersCapped + ", after the surplus lands on them. " : "") +
      "Ada also gains the most standing, 100 to " + after["ada"] + ", because five distinct members pointed at her.</p>" +
      "<p><b>The limit:</b> popularity still pays the maximum allowed. The cap is a ceiling, not a cure. Ada earns the most in the round for being liked, not for doing the most work, and the square root only softens that, it does not remove it.</p>";
  }
  if (sc.id === "newcomer") {
    return head + "<p><b>What the mechanism caught:</b> Fay is new, standing 100, while the veterans stand at 160, so her gifts weigh less than theirs. Even so she earns " + pay("fay") +
      " NEAR, the second highest payout in the round, because three veterans recognised her work and pointed at her, and the cap on Ada pushes surplus down to her. Her standing rises 100 to " + after["fay"] + ".</p>" +
      "<p><b>The limit:</b> if no veteran points at the newcomer, she earns near zero, however good her work is. Standing compounds, so veterans keep an edge round after round. A newcomer is not locked out, but entry depends on being noticed, and that is decided by the people, not the maths.</p>";
  }
  if (sc.id === "allcollude") {
    return head + "<p><b>What the mechanism caught:</b> nothing. Everyone earns " + pay("ada") +
      " NEAR, an even split of the whole 5.000 NEAR envelope, and the ring keeps all of it. The reciprocity discount still cuts every mutual gift, 40 points to 20 effective, so every score is lower than honest one way giving would give, but scores only matter relative to each other, and here everyone is cut equally.</p>" +
      "<p><b>The limit, stated plainly:</b> when the whole round colludes, the maths cannot tell collusion from honesty. There is no honest member left to take the surplus, so nothing is redistributed away from the ring. Full collusion is stopped only by DAO curation, by who is allowed in, not by the settlement maths. Any peer allocation system that claims otherwise is hiding this.</p>";
  }
  return head + "<p><b>What the mechanism caught:</b> Fay did the real work and received only 70 points, while Ada received 200. Without the cap and the square root, Ada would take " + raw("ada") +
    " NEAR, over half the envelope. The cap holds her at " + pay("ada") +
    " NEAR, and Fay still earns " + pay("fay") +
    " NEAR, more than Dan and Eli, because her 70 points arrived from three distinct givers.</p>" +
    "<p><b>The limit:</b> points measure being liked, not work done. Fay earns less than Ada even though she did more of the work, and less than Ben and Cara, who gave her nothing. The mechanism softens popularity bias. It does not fix it. Judging work, rather than liking, is a human decision the contract cannot make.</p>";
}

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

// ---- Charts ----
// Plain HTML bars, no chart library: they must work offline and on a
// phone. Every value comes from the recorded onchain numbers above
// (LIVE_ROUND1 to LIVE_ROUND4), the standing records, or the stress
// test settle() results. Nothing here is invented.
// Payout bars scale to 1.500 NEAR, so the 1.250 NEAR cap sits at 83.3%
// of the track and is marked with a dashed tick in every row.
const PAYOUT_CHART_SCALE_NEAR = 1.5;
function payoutChartHtml(round) {
  const rows = round.members.map((m) => {
    const payout = BigInt(m.payoutYocto);
    const pct = (Number(payout) / 1e24 / PAYOUT_CHART_SCALE_NEAR) * 100;
    return "<div class=\"prow\" data-payout-yocto=\"" + m.payoutYocto + "\"><span class=\"pname\">" + m.name + "</span>" +
      "<span class=\"ptrack\"><i style=\"width:" + pct.toFixed(1) + "%\" class=\"" + (m.capped ? "capped" : "") + "\"></i><span class=\"captick\"></span></span>" +
      "<span class=\"pval\">" + fmtYocto(payout) + " NEAR" + (m.capped ? " · capped" : "") + "</span></div>";
  }).join("");
  return "<div class=\"pchart\" data-round=\"" + round.roundId + "\">" + rows + "</div>" +
    "<p class=\"muted\">Bars scale to 1.500 NEAR. The dashed line is the 1.250 NEAR cap, the most any member can take from a 5 NEAR envelope. A green bar that reaches the line was capped; the excess flowed to the members below the cap. Payouts in this round add to " + fmtYocto(BigInt(round.totalPayoutYocto)) + " NEAR.</p>";
}
function renderPayoutCharts() {
  const rounds = [LIVE_ROUND1, LIVE_ROUND2, LIVE_ROUND3, LIVE_ROUND4];
  for (const r of rounds) {
    const box = el("chartRound" + r.roundId);
    if (box) box.innerHTML = payoutChartHtml(r);
  }
}

// Standing across rounds 1 to 4, for the 12 members who were on the
// council for rounds 2, 3, and 4. The standing rule went live with the
// fine tune, so everyone stood at 100 after round 2; the chart shows
// after round 3 (teal) and after round 4 (amber) against the 100 line.
// The six round 4 members joined at 100 and stand at 106 after round 4;
// clearsite587.testnet joined after round 4 at 100.
function standingsChartHtml() {
  const min = 85, max = 115;
  const rows = STANDINGS_HISTORY.map((m) => {
    const w3 = ((m.after[3] - min) / (max - min)) * 100;
    const w4 = ((m.after[4] - min) / (max - min)) * 100;
    return "<div class=\"srow\" data-member=\"" + m.id + "\" data-after-r3=\"" + m.after[3] + "\" data-after-r4=\"" + m.after[4] + "\"><span class=\"pname\">" + m.name + "</span>" +
      "<span class=\"strack\"><span class=\"smark\"></span>" +
      "<span class=\"sbar r3\" style=\"width:" + w3.toFixed(1) + "%\"></span>" +
      "<span class=\"sbar r4\" style=\"width:" + w4.toFixed(1) + "%\"></span></span>" +
      "<span class=\"pval\">" + m.after[3] + " to " + m.after[4] + "</span></div>";
  }).join("");
  return "<div class=\"schart\">" + rows + "</div>" +
    "<p class=\"muted\">Teal: standing after round 3. Amber: standing after round 4. The dashed line is 100, the standing every member starts at. The six round 4 members joined at 100 and stand at 106 after round 4; clearsite587.testnet joined after round 4 at 100.</p>";
}
function renderStandingsChart() {
  const box = el("standingsChart");
  if (box) box.innerHTML = standingsChartHtml();
}

// Stress test comparison: highest and lowest payout in each of the five
// scenarios, computed here with the same settle() the scenario buttons
// use, so the chart can never disagree with the tables.
function stressCompareData() {
  return STRESS_SCENARIOS.map((sc) => {
    const r = settle(sc.allocations, STRESS_MEMBERS, STRESS_ENVELOPE_NEAR, sc.standings);
    let hi = null, lo = null;
    for (const id of STRESS_MEMBERS) {
      const p = r.per[id];
      if (!hi || p.payoutYocto > hi.payoutYocto) hi = { id: id, payoutYocto: p.payoutYocto };
      if (!lo || p.payoutYocto < lo.payoutYocto) lo = { id: id, payoutYocto: p.payoutYocto };
    }
    return { id: sc.id, title: sc.title, hi: hi, lo: lo };
  });
}
function stressCompareHtml() {
  const rows = stressCompareData().map((d) => {
    const hiPct = (Number(d.hi.payoutYocto) / 1e24 / PAYOUT_CHART_SCALE_NEAR) * 100;
    const loPct = (Number(d.lo.payoutYocto) / 1e24 / PAYOUT_CHART_SCALE_NEAR) * 100;
    return "<div class=\"cgroup\" data-scenario=\"" + d.id + "\" data-hi-yocto=\"" + d.hi.payoutYocto.toString() + "\" data-lo-yocto=\"" + d.lo.payoutYocto.toString() + "\">" +
      "<p><b>" + d.title + "</b></p>" +
      "<div class=\"crow\"><span class=\"cname\">Highest · " + stressName(d.hi.id) + "</span>" +
      "<span class=\"ctrack\"><i class=\"hi\" style=\"width:" + hiPct.toFixed(1) + "%\"></i></span>" +
      "<span class=\"cval\">" + fmtYocto(d.hi.payoutYocto) + " NEAR</span></div>" +
      "<div class=\"crow\"><span class=\"cname\">Lowest · " + stressName(d.lo.id) + "</span>" +
      "<span class=\"ctrack\"><i class=\"lo\" style=\"width:" + loPct.toFixed(1) + "%\"></i></span>" +
      "<span class=\"cval\">" + fmtYocto(d.lo.payoutYocto) + " NEAR</span></div></div>";
  }).join("");
  return rows + "<p class=\"muted\">Highest and lowest payout in each scenario, same 5 NEAR envelope, same contract maths. Bars scale to 1.500 NEAR. In the full collusion scenario the highest and the lowest are the same, 0.833 NEAR, because the ring keeps the whole envelope split evenly.</p>";
}
function renderStressCompare() {
  const box = el("stressCompare");
  if (box) box.innerHTML = stressCompareHtml();
}

// Home dashboard: totals read live from the contract and the DAO, with
// the last verified numbers as fallback when the read fails.
async function rpcAccountBalance(accountId) {
  for (const url of RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: "view_account", method: "query",
          params: { request_type: "view_account", account_id: accountId, finality: "final" },
        }),
      });
      if (!res.ok) throw new Error("RPC HTTP " + res.status);
      const d = await res.json();
      if (d.error) throw new Error("RPC error");
      return BigInt(d.result.amount);
    } catch (e) { /* try the next endpoint */ }
  }
  throw new Error("RPC read failed");
}
async function renderHomeDashboard() {
  const total = el("dashTotalPaid");
  if (!total) return; // only the home page has the dashboard
  const note = el("dashNote");
  try {
    let paid = 0n, settled = 0;
    for (let id = 1; id <= 4; id++) {
      const r = await contractView("get_round", { round_id: id });
      if (r && r.settled) { paid += BigInt(r.total_payout_yocto); settled++; }
    }
    const members = await contractView("get_members", {});
    const daoBal = await rpcAccountBalance(DAO_ID);
    total.textContent = fmtYocto(paid) + " NEAR";
    el("dashMembers").textContent = String(members.length);
    el("dashRounds").textContent = String(settled);
    el("dashDaoBalance").textContent = fmtYocto(daoBal) + " NEAR";
    if (note) note.textContent = "Read live from the contract and the DAO just now.";
  } catch (e) {
    total.textContent = fmtYocto(BigInt(HOME_DASHBOARD_FALLBACK.totalPaidYocto)) + " NEAR";
    el("dashMembers").textContent = String(HOME_DASHBOARD_FALLBACK.members);
    el("dashRounds").textContent = String(HOME_DASHBOARD_FALLBACK.roundsSettled);
    el("dashDaoBalance").textContent = fmtYocto(BigInt(HOME_DASHBOARD_FALLBACK.daoBalanceYocto)) + " NEAR";
    if (note) note.textContent = "The live read failed just now; these are the last verified numbers.";
  }
}

// Your dashboard: the connected member's own numbers. Standing and badge
// are read live; total payouts are the sum of this account's payouts in
// the four settled rounds, read live with get_payouts. When a round is
// open, the stacked bar shows the member's 100 points split into
// assigned and unassigned, from their current submission, and the list
// shows who they gave points to and why. The badge picture is shown
// with the badge line, as in the wallet panel.
function walletPointsBarHtml(assigned) {
  const a = Math.max(0, Math.min(100, assigned || 0));
  return "<div class=\"stackbar\" role=\"img\" aria-label=\"" + a + " of 100 points assigned\"><i class=\"assigned\" style=\"width:" + a + "%\"></i><i class=\"unassigned\" style=\"width:" + (100 - a) + "%\"></i></div>" +
    "<p class=\"muted\">" + a + " points assigned · " + (100 - a) + " points unassigned.</p>";
}
async function renderWalletDashboard() {
  const box = el("walletDashboard");
  if (!box || !walletAccountId) { if (box) box.style.display = "none"; return; }
  if (walletMembers.indexOf(walletAccountId) < 0 && walletMembersKnown) { box.style.display = "none"; return; }
  box.style.display = "block";
  let standing = "?";
  try { standing = await contractView("get_standing", { account_id: walletAccountId }); } catch (_) { /* keep ? */ }
  let badge = null;
  try { badge = await badgeView("get_badge", { account_id: walletAccountId }); } catch (_) { badge = null; }
  let total = 0n;
  const perRound = [];
  let payoutsOk = true;
  for (let id = 1; id <= 4; id++) {
    try {
      const ps = await contractView("get_payouts", { round_id: id });
      const mine = (ps || []).find((p) => p.account_id === walletAccountId);
      const y = mine ? BigInt(mine.payout_yocto) : 0n;
      perRound.push({ round: id, yocto: y });
      total += y;
    } catch (_) { payoutsOk = false; perRound.push({ round: id, yocto: null }); }
  }
  const open = walletOpenRound;
  let allocHtml = "";
  let assigned = 0;
  if (open) {
    let mine = [];
    try {
      const subs = await contractView("get_allocations", { round_id: open.id });
      const sub = (subs || []).find((s) => (s.account_id || s.member || s.giver) === walletAccountId);
      if (sub && sub.allocations) mine = sub.allocations;
    } catch (_) { /* no submission yet */ }
    assigned = mine.reduce((s, a) => s + (a.points || 0), 0);
    allocHtml = mine.length === 0
      ? "<p class=\"muted\">You have not assigned any points in round " + open.id + " yet. Use the allocate form below.</p>"
      : "<h3>Your allocations in round " + open.id + "</h3>" + mine.map((a) =>
        "<p><b>" + a.to + "</b> · " + a.points + " points · &ldquo;" + escapeHtml(a.reason || "") + "&rdquo;</p>"
      ).join("");
  }
  box.innerHTML = "<h3>Your dashboard</h3>" +
    (walletMembersKnown ? "" : "<p class=\"muted\">Membership could not be read just now, so these are best-effort numbers. Tap your profile button to try again.</p>") +
    "<p>Connected as <b>" + walletAccountId + "</b> · Standing <b>" + standing + "</b>" +
    (badge ? "<br><img src=\"/badge-3d.png\" alt=\"FairShare council badge\" style=\"width:80px;height:80px;margin-top:8px;border-radius:10px\"> Council badge, soulbound, standing <b>" + badge.standing + "</b> at mint." : "") + "</p>" +
    "<p>Total payouts across the settled rounds: <b>" + (payoutsOk ? fmtYocto(total) + " NEAR" : "could not be read just now") + "</b></p>" +
    (payoutsOk ? "<p class=\"muted\">" + perRound.map((r) => "Round " + r.round + ": " + fmtYocto(r.yocto) + " NEAR").join(" · ") + "</p>" : "") +
    (open
      ? "<h3>Your 100 points, round " + open.id + "</h3><div id=\"walletDashBar\">" + walletPointsBarHtml(assigned) + "</div>" + allocHtml
      : "<p class=\"muted\">No round is open right now, so no points are available to assign. Your standing, payouts, and badge above are current.</p>");
}
function updateWalletDashBar() {
  const bar = el("walletDashBar");
  if (bar) bar.innerHTML = walletPointsBarHtml(walletFormTotal());
}
function highlightWalletPanel() {
  const panel = el("walletPanel");
  if (!panel || !panel.style) return;
  panel.style.outline = "2px solid #e3a008";
  panel.style.outlineOffset = "2px";
  if (typeof setTimeout !== "undefined") {
    setTimeout(() => { panel.style.outline = ""; panel.style.outlineOffset = ""; }, 3000);
  }
}
function openDashboardFromHeader() {
  refreshWalletPanel();
  const panel = el("walletPanel");
  if (panel) {
    if (typeof panel.scrollIntoView === "function") panel.scrollIntoView();
    highlightWalletPanel();
  } else if (typeof window !== "undefined" && window.location) {
    window.location.href = "/rounds#walletPanel";
  }
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

// Live reads use two public testnet RPC endpoints. A phone on 4G drops a
// single request often enough that one failure must not kill a whole panel:
// try the primary first, then the fallback once. Only if both fail does
// the caller show its "could not read" message.
const RPC_ENDPOINTS = ["https://rpc.testnet.near.org", "https://rpc.testnet.fastnear.com"];
async function rpcViewCall(accountId, method, args) {
  let lastErr = null;
  for (const url of RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: method, method: "query",
          params: {
            request_type: "call_function",
            account_id: accountId,
            method_name: method,
            args_base64: btoa(JSON.stringify(args)),
            finality: "final",
          },
        }),
      });
      if (!res.ok) throw new Error("RPC HTTP " + res.status);
      const d = await res.json();
      if (d.error) throw new Error("RPC error");
      return JSON.parse(new TextDecoder().decode(new Uint8Array(d.result.result)));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("RPC read failed");
}

// Read-only live state straight from the contract. No wallet, no signing,
// no funds move. If the browser cannot reach the public RPC, the page
// says so plainly and keeps the last verified values, labelled as such.
async function fetchLiveState() {
  const box = el("liveState");
  const statsNote = el("statsNote");
  try {
    async function call(method, args) {
      return rpcViewCall(CONTRACT_ID, method, args);
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
      "Live state could not be read from this browser. The numbers on this page are the last verified onchain state: round 1, 5.000 NEAR envelope, 4.999 NEAR paid out, 19 members in the DAO. The contract is still live at " +
      CONTRACT_ID + "; read it with the command line check in the README.";
    if (statsNote) statsNote.textContent =
      "Numbers above are the last verified onchain state. The live read failed just now, so they were not refreshed.";
  }
}

// ---- Wallet connect (FastNEAR wallet 2.5.0, same pattern as the PAC site) ----
// The library opens a wallet selector, and on mobile it deep links into the
// installed Meteor app, where the account already lives. Testnet only.
// A connected member sees their standing here, and can allocate their 100
// points in an open round through the site with a signed allocate call.
// With no wallet connected, the page stays read only and the live stats
// above keep working exactly as before.
const NETWORK = "testnet";
const WALLET_GAS_100 = "100000000000000";
let walletAccountId = null;
let walletOpenRound = null;
let walletMembers = [];
let walletMembersKnown = false;

function fastnear() {
  if (typeof window.nearWallet === "undefined") {
    throw new Error("FastNear wallet library not loaded. Check the script tag.");
  }
  return window.nearWallet;
}
function currentAccountId(nw) {
  try {
    const id = nw.accountId({ network: NETWORK });
    return typeof id === "string" && id ? id : null;
  } catch (_) {
    return null;
  }
}
function getWalletAccountId() { return walletAccountId; }
function walletStatus(msg) {
  const s = el("walletStatus");
  if (s) s.textContent = msg;
}
async function contractView(method, args) {
  return rpcViewCall(CONTRACT_ID, method, args);
}
async function badgeView(method, args) {
  return rpcViewCall(BADGE_CONTRACT_ID, method, args);
}
// Council badges, read live from the badge contract. One call lists every
// badge; the standing is read from the badge description, where the mint
// recorded it. If the read fails, the panel keeps its static fallback.
async function refreshBadgePanel() {
  const list = el("badgeList");
  if (!list) return;
  try {
    const tokens = await badgeView("nft_tokens", { from_index: "0", limit: 100 });
    if (!tokens || tokens.length === 0) {
      list.innerHTML = "<p class=\"muted\">No badges minted yet.</p>";
      return;
    }
    list.innerHTML = tokens.map((t) => {
      const desc = (t.metadata && t.metadata.description) || "";
      const m = desc.match(/standing (\d+) at mint/);
      const standing = m ? m[1] : "?";
      return "<p><img src=\"/badge-3d.png\" alt=\"FairShare council badge\" style=\"width:40px;height:40px;vertical-align:middle;border-radius:8px;margin-right:8px\"> <b>" + t.owner_id + "</b> · Council badge, soulbound · standing " + standing + " at mint</p>";
    }).join("");
  } catch (e) {
    list.innerHTML = "<p class=\"muted\">Could not read the badges from the contract just now. 19 badges are minted on fairshare-badge.testnet; read them with the command line check in the README.</p>";
  }
}
async function initWallet() {
  if (typeof window === "undefined") return; // no browser, no wallet
  try {
    const nw = fastnear();
    const restored = await nw.restore({ network: NETWORK });
    const id = (restored && typeof restored.accountId === "string" && restored.accountId) || currentAccountId(nw);
    if (id) walletAccountId = id;
  } catch (e) { console.warn("wallet restore failed", e); }
  // Clean the wallet return params off the URL, keeping the page and
  // its query string.
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("transactionHashes")) {
      const hashes = params.get("transactionHashes").split(",");
      walletStatus("Allocation sent. Transaction " + hashes[0] + " is onchain; check it on Nearblocks.");
      window.history.replaceState({}, "", window.location.pathname + window.location.search + window.location.hash);
    }
  } catch (_) { /* ignore */ }
  refreshWalletBtn();
  refreshWalletPanel();
  refreshGovPanel();
}
function refreshWalletBtn() {
  const btn = el("connectBtn");
  if (!btn) return;
  let libOk = true;
  try { fastnear(); } catch (_) { libOk = false; }
  if (!libOk) { btn.textContent = "Wallet unavailable"; btn.disabled = true; return; }
  const id = walletAccountId;
  btn.textContent = id ? id : "Connect wallet";
  if (btn.title !== undefined) btn.title = id ? "Open your dashboard" : "";
  btn.disabled = false;
}
async function disconnectWallet() {
  try {
    const nw = fastnear();
    try { await nw.disconnect({ network: NETWORK }); } catch (_) { /* wallet already signed out */ }
  } catch (_) { /* library missing, clear local state anyway */ }
  walletAccountId = null; walletMembers = []; walletMembersKnown = false; walletOpenRound = null;
  refreshWalletBtn(); refreshWalletPanel(); refreshGovPanel();
}
async function toggleWallet() {
  let nw;
  try { nw = fastnear(); } catch (_) { walletStatus("Wallet library did not load. Check your connection and reload."); return; }
  // When connected, this button is the profile button: it opens the
  // member's dashboard. Disconnecting is done from the Disconnect button
  // in the wallet panel. When not connected, it starts the connect flow.
  if (walletAccountId) { openDashboardFromHeader(); return; }
  try {
    walletStatus("Opening wallet selector…");
    const result = await nw.connect({ network: NETWORK });
    const id = (result && typeof result.accountId === "string" && result.accountId) || currentAccountId(nw);
    if (typeof id !== "string" || !id) { walletStatus("Could not determine the connected account. Try again."); return; }
    walletAccountId = id;
    refreshWalletBtn();
    refreshWalletPanel();
    refreshGovPanel();
  } catch (e) { walletStatus("Wallet error: " + String(e.message).slice(0, 160)); }
}
async function walletCall(contractId, method, args, depositYocto, gas) {
  const nw = fastnear();
  return nw.sendTransaction({
    receiverId: contractId,
    network: NETWORK,
    actions: [{
      type: "FunctionCall",
      methodName: method,
      args: args,
      gas: (gas || WALLET_GAS_100).toString(),
      deposit: depositYocto.toString(),
    }],
  });
}

// Find the open round, if any: the highest round id that is neither closed
// nor settled. Returns null when no round is open.
async function findOpenRound() {
  for (let id = 20; id >= 1; id--) {
    try {
      const r = await contractView("get_round", { round_id: id });
      if (r && !r.closed && !r.settled) return r;
    } catch (_) { /* a missing round id is not an error */ }
  }
  return null;
}

function walletRowHtml(members, selected, points, reason) {
  const opts = members.map((m) =>
    "<option value=\"" + m + "\"" + (m === selected ? " selected" : "") + ">" + m + "</option>"
  ).join("");
  return "<div class=\"walletRow\"><select class=\"walletTo\" aria-label=\"Recipient\">" + opts + "</select> " +
    "<input type=\"number\" min=\"0\" max=\"100\" value=\"" + points +
    "\" class=\"walletPoints\" aria-label=\"Points\"> points " +
    "<input type=\"text\" maxlength=\"200\" value=\"" + String(reason || "").replace(/"/g, "&quot;") +
    "\" class=\"walletReason\" placeholder=\"Why do they deserve points?\" aria-label=\"Reason\"></div>";
}

function walletFormTotal() {
  const form = el("walletAllocateForm");
  if (!form || typeof form.querySelectorAll !== "function") return 0;
  return Array.from(form.querySelectorAll(".walletPoints"))
    .reduce((s, i) => s + (parseInt(i.value, 10) || 0), 0);
}

function walletUpdateTotal() {
  const s = el("walletTotal");
  if (s) s.textContent = "You have given " + walletFormTotal() + " of your 100 points.";
  updateWalletDashBar();
}

async function refreshWalletPanel() {
  const panel = el("walletPanel");
  if (!panel) return;
  const memberBox = el("walletMember");
  const allocBox = el("walletAllocate");
  if (!walletAccountId) {
    walletStatus("Connect your testnet wallet above to see your membership and standing, and to allocate in an open round.");
    if (memberBox) memberBox.style.display = "none";
    if (allocBox) allocBox.style.display = "none";
    return;
  }
  try {
    walletStatus("Reading your membership from the contract…");
    const members = await contractView("get_members", {});
    walletMembers = members || [];
    walletMembersKnown = true;
    const isMember = walletMembers.indexOf(walletAccountId) >= 0;
    const standing = await contractView("get_standing", { account_id: walletAccountId });
    let badge = null;
    if (isMember) {
      try { badge = await badgeView("get_badge", { account_id: walletAccountId }); } catch (_) { badge = null; }
    }
    if (memberBox) {
      memberBox.style.display = "block";
      memberBox.innerHTML = "Connected as <b>" + walletAccountId + "</b> · " +
        (isMember ? "Member of the DAO council" : "Not a member of the DAO council yet") +
        " · Standing <b>" + standing + "</b>" +
        (badge ? "<br><img src=\"/badge-3d.png\" alt=\"FairShare council badge\" style=\"width:120px;height:120px;margin-top:10px;border-radius:12px\"> Council badge, soulbound, standing <b>" + badge.standing + "</b> at mint." : "") +
        " <button id=\"walletDisconnect\" type=\"button\">Disconnect</button>";
      const d = el("walletDisconnect");
      if (d) d.addEventListener("click", disconnectWallet);
    }
    if (!isMember) {
      walletStatus("This account is not a member yet, so it cannot allocate. Membership comes from a DAO proposal; see the governance section below.");
      if (allocBox) allocBox.style.display = "none";
      renderWalletDashboard();
      return;
    }
    const open = await findOpenRound();
    walletOpenRound = open;
    if (!open) {
      walletStatus("No round is open right now. Your standing is " + standing + ". When a round opens, your allocate form appears here.");
      if (allocBox) allocBox.style.display = "none";
      renderWalletDashboard();
      return;
    }
    if (allocBox) {
      allocBox.style.display = "block";
      const title = el("walletRoundTitle");
      if (title) title.textContent = "Round " + open.id + " is open: " + fmtYocto(BigInt(open.envelope_yocto)) + " NEAR envelope. Give your 100 points to at least 3 members, with a reason for each.";
      const form = el("walletAllocateForm");
      if (form && !form.dataset.built) {
        const others = walletMembers.filter((m) => m !== walletAccountId);
        // Prefill from an existing submission, if this member already allocated.
        let mine = [];
        try {
          const subs = await contractView("get_allocations", { round_id: open.id });
          const sub = (subs || []).find((s) => (s.account_id || s.member || s.giver) === walletAccountId);
          if (sub && sub.allocations) mine = sub.allocations;
        } catch (_) { /* no submission yet */ }
        const rows = [];
        for (let i = 0; i < 3; i++) {
          const a = mine[i] || {};
          rows.push(walletRowHtml(others, a.to || others[i % others.length], a.points || 0, a.reason || ""));
        }
        form.innerHTML = rows.join("") +
          "<p><button id=\"walletAddRow\" type=\"button\">Add another recipient</button> " +
          "<button id=\"walletSubmit\" type=\"button\" class=\"primary\">Send my 100 points</button></p>" +
          "<p class=\"muted\" id=\"walletTotal\"></p>";
        form.dataset.built = "1";
        form.querySelectorAll(".walletPoints").forEach((i) => i.addEventListener("input", walletUpdateTotal));
        walletUpdateTotal();
        const add = el("walletAddRow");
        if (add) add.addEventListener("click", () => {
          const count = form.querySelectorAll(".walletRow").length;
          if (count >= 8) return;
          const others2 = walletMembers.filter((m) => m !== walletAccountId);
          const used = Array.from(form.querySelectorAll(".walletTo")).map((s) => s.value);
          const next = others2.find((m) => used.indexOf(m) < 0) || others2[0];
          const div = document.createElement("div");
          div.innerHTML = walletRowHtml(others2, next, 0, "");
          while (div.firstChild) form.insertBefore(div.firstChild, add.parentNode);
          form.querySelectorAll(".walletPoints").forEach((i) => { i.removeEventListener("input", walletUpdateTotal); i.addEventListener("input", walletUpdateTotal); });
          walletUpdateTotal();
        });
        const submit = el("walletSubmit");
        if (submit) submit.addEventListener("click", submitWalletAllocate);
        if (mine.length > 0) walletStatus("You already allocated in round " + open.id + ". Change the rows below and send again to replace your submission.");
        else walletStatus("Round " + open.id + " is open. Give your 100 points below and send them with your wallet.");
      }
    }
    renderWalletDashboard();
  } catch (e) {
    walletStatus("Could not read your membership just now: " + String(e.message).slice(0, 120) + " Tap your profile button to try again.");
    if (memberBox) {
      memberBox.style.display = "block";
      memberBox.innerHTML = "Connected as <b>" + walletAccountId + "</b> · membership could not be read just now." +
        " <button id=\"walletDisconnect\" type=\"button\">Disconnect</button>";
      const d = el("walletDisconnect");
      if (d) d.addEventListener("click", disconnectWallet);
    }
    renderWalletDashboard();
  }
}

async function submitWalletAllocate() {
  const form = el("walletAllocateForm");
  if (!form || !walletOpenRound || !walletAccountId) return;
  const allocations = [];
  let error = null;
  form.querySelectorAll(".walletRow").forEach((row) => {
    const to = row.querySelector(".walletTo").value;
    const points = parseInt(row.querySelector(".walletPoints").value, 10) || 0;
    const reason = row.querySelector(".walletReason").value.trim();
    if (points < 0 || points > 100) error = "Points for one member must be between 0 and 100.";
    if (points > 0) {
      if (!reason) error = "Every gift needs a reason. Add one for " + to + ".";
      if (to === walletAccountId) error = "You cannot give points to yourself.";
      allocations.push({ to: to, points: points, reason: reason });
    }
  });
  const seen = {};
  for (const a of allocations) {
    if (seen[a.to]) error = "Name each recipient only once.";
    seen[a.to] = true;
  }
  const total = allocations.reduce((s, a) => s + a.points, 0);
  if (!error && total !== 100) error = "You gave " + total + " points. Give exactly 100.";
  if (!error && allocations.length < PARAMS.minRecipients) error = "Name at least 3 recipients. You named " + allocations.length + ".";
  if (error) { walletStatus(error); return; }
  walletStatus("Opening your wallet to sign the allocate call for round " + walletOpenRound.id + "…");
  try {
    await walletCall(CONTRACT_ID, "allocate", { round_id: walletOpenRound.id, allocations: allocations }, "0");
    walletStatus("Sent to your wallet. Approve the call there; the page confirms it when you return.");
  } catch (e) {
    walletStatus("Wallet error: " + String(e.message).slice(0, 160));
  }
}

// Membership Integrity Monitor: recorded history, generated from
// demo-log.json on 2026-11-08. Live membership, standings, badges,
// and pending proposals are read from the chain when the page loads;
// this block is the recorded history the live read is checked against.
const MONITOR_THRESHOLD = 40; // flag a pair when each gave at least 40% of their points to the other
const MONITOR_SYNCS = [
  { tx: "CihwgreGNAYuWyb6pRRbWRy6oUyHRwx5vPWJW3DEBJcs", when: "2026-11-08 10:23 WAT", members: 6, note: "First sync, the 6 demo members" },
  { tx: "Ah87M1UuRdaXx6aHqKD1PdoMty9xysH7Tbyv1VKJ27jW", when: "2026-11-08 10:57 WAT", members: 12, note: "After proposals #0 to #5, the round 2 crew" },
  { tx: "8xekwzk8c9qFSvDSMVEDMAmynuCt3boTKG7kgB3U3mjw", when: "2026-11-08 12:42 WAT", members: 18, note: "After proposals #8 to #13, the round 4 crew" },
  { tx: "B92RYmbboLwazJzd5V7LS7en1w7UNy5Z92HRMhK3YvQF", when: "2026-11-08 13:07 WAT", members: 19, note: "After proposal #15, clearsite587.testnet" },
];
const MONITOR_ADDS = [
  { proposal: 0, member: "ada-fairshare.testnet", tx: "2u8eFs6gA8i8fawfXrkUdhNabhAC3DXDLbEb9TksVTGq" },
  { proposal: 1, member: "emeka-fairshare.testnet", tx: "H1ji1upA2BpJXXehvBSJeBdGBaLhSyRnnPUGG6e2GdyZ" },
  { proposal: 2, member: "fatima-fairshare.testnet", tx: "AXwZ3dL7hJTzkjFDVeFs1aMNgxYY8wJ6Z4ZDzwg2qYQQ" },
  { proposal: 3, member: "ibrahim-fairshare.testnet", tx: "CPhRFG4MSPDgomj4BJHquiS29wbpDmrtx6jrwsZ92awm" },
  { proposal: 4, member: "ngozi-fairshare.testnet", tx: "4t646jvECf7KtKZTftHs2NMMx1krJ4F63qtp91hAP7Cp" },
  { proposal: 5, member: "tunde-fairshare.testnet", tx: "EzTDjkY8WSCBbHXH1fyAbymYkJQVt1fTVMGJPnHAmcUp" },
  { proposal: 8, member: "chidi-fairshare.testnet", tx: "59GMPavYKdtpZE5ojfnbdVck8m3x5eSKeaeDWn8w2m3x" },
  { proposal: 9, member: "amara-fairshare.testnet", tx: "4sWyFWFxPfXNu3B6XbQgPE4eTnZ1zvGbcMGWYeSdW1LR" },
  { proposal: 10, member: "segun-fairshare.testnet", tx: "G8JRHXUgfSD3FZi8SS8HxAfhov3qxi3JcWqxAvwYoeNn" },
  { proposal: 11, member: "kemi-fairshare.testnet", tx: "HVxT35ryJhfDVHGDXji8gX3CjJtB8TBWUPSX4rSut6NH" },
  { proposal: 12, member: "tobi-fairshare.testnet", tx: "86Eq4QdkiwoWrjpUbKWqDpjUKi7tRKEYSfAtCtLPK5Py" },
  { proposal: 13, member: "zainab-fairshare.testnet", tx: "CsqEGAvSxQj61hDdPBvggSpWhMSTkzY2mmVwJv4RyxgC" },
  { proposal: 15, member: "clearsite587.testnet", tx: "8S89xddY1rahiPZvCRpUYyaNLvNCrZGQBfLsPTfZMMZ1" },
];
const MONITOR_REMOVALS = []; // no member has ever been removed from the council
const MONITOR_ACTIVITY = {
 "alice-fairshare.testnet": {
  "standing": 95,
  "rounds": {
   "1": "allocated",
   "2": "none",
   "3": "allocated",
   "4": "none"
  }
 },
 "bob-fairshare.testnet": {
  "standing": 99,
  "rounds": {
   "1": "allocated",
   "2": "none",
   "3": "allocated",
   "4": "none"
  }
 },
 "carol-fairshare.testnet": {
  "standing": 99,
  "rounds": {
   "1": "allocated",
   "2": "none",
   "3": "allocated",
   "4": "none"
  }
 },
 "dave-fairshare.testnet": {
  "standing": 99,
  "rounds": {
   "1": "allocated",
   "2": "none",
   "3": "allocated",
   "4": "none"
  }
 },
 "erin-fairshare.testnet": {
  "standing": 97,
  "rounds": {
   "1": "allocated",
   "2": "none",
   "3": "allocated",
   "4": "none"
  }
 },
 "frank-fairshare.testnet": {
  "standing": 99,
  "rounds": {
   "1": "allocated",
   "2": "none",
   "3": "allocated",
   "4": "none"
  }
 },
 "ada-fairshare.testnet": {
  "standing": 105,
  "rounds": {
   "1": "not member",
   "2": "allocated",
   "3": "allocated",
   "4": "none"
  }
 },
 "emeka-fairshare.testnet": {
  "standing": 101,
  "rounds": {
   "1": "not member",
   "2": "allocated",
   "3": "allocated",
   "4": "none"
  }
 },
 "fatima-fairshare.testnet": {
  "standing": 101,
  "rounds": {
   "1": "not member",
   "2": "allocated",
   "3": "allocated",
   "4": "none"
  }
 },
 "ibrahim-fairshare.testnet": {
  "standing": 101,
  "rounds": {
   "1": "not member",
   "2": "allocated",
   "3": "allocated",
   "4": "none"
  }
 },
 "ngozi-fairshare.testnet": {
  "standing": 101,
  "rounds": {
   "1": "not member",
   "2": "allocated",
   "3": "allocated",
   "4": "none"
  }
 },
 "tunde-fairshare.testnet": {
  "standing": 90,
  "rounds": {
   "1": "not member",
   "2": "allocated",
   "3": "none",
   "4": "none"
  }
 },
 "chidi-fairshare.testnet": {
  "standing": 106,
  "rounds": {
   "1": "not member",
   "2": "not member",
   "3": "not member",
   "4": "allocated"
  }
 },
 "amara-fairshare.testnet": {
  "standing": 106,
  "rounds": {
   "1": "not member",
   "2": "not member",
   "3": "not member",
   "4": "allocated"
  }
 },
 "segun-fairshare.testnet": {
  "standing": 106,
  "rounds": {
   "1": "not member",
   "2": "not member",
   "3": "not member",
   "4": "allocated"
  }
 },
 "kemi-fairshare.testnet": {
  "standing": 106,
  "rounds": {
   "1": "not member",
   "2": "not member",
   "3": "not member",
   "4": "allocated"
  }
 },
 "tobi-fairshare.testnet": {
  "standing": 106,
  "rounds": {
   "1": "not member",
   "2": "not member",
   "3": "not member",
   "4": "allocated"
  }
 },
 "zainab-fairshare.testnet": {
  "standing": 106,
  "rounds": {
   "1": "not member",
   "2": "not member",
   "3": "not member",
   "4": "allocated"
  }
 },
 "clearsite587.testnet": {
  "standing": 100,
  "rounds": {
   "1": "not member",
   "2": "not member",
   "3": "not member",
   "4": "not member"
  }
 }
};
const MONITOR_ALLOCATIONS = {
 "1": {
  "frank-fairshare.testnet": {
   "alice-fairshare.testnet": 61,
   "carol-fairshare.testnet": 1,
   "dave-fairshare.testnet": 4,
   "erin-fairshare.testnet": 34
  },
  "carol-fairshare.testnet": {
   "alice-fairshare.testnet": 18,
   "erin-fairshare.testnet": 18,
   "frank-fairshare.testnet": 64
  },
  "bob-fairshare.testnet": {
   "alice-fairshare.testnet": 8,
   "carol-fairshare.testnet": 13,
   "dave-fairshare.testnet": 4,
   "frank-fairshare.testnet": 75
  },
  "dave-fairshare.testnet": {
   "alice-fairshare.testnet": 7,
   "bob-fairshare.testnet": 28,
   "erin-fairshare.testnet": 65
  },
  "alice-fairshare.testnet": {
   "bob-fairshare.testnet": 8,
   "carol-fairshare.testnet": 26,
   "dave-fairshare.testnet": 66
  },
  "erin-fairshare.testnet": {
   "bob-fairshare.testnet": 33,
   "dave-fairshare.testnet": 66,
   "frank-fairshare.testnet": 1
  }
 },
 "2": {
  "ada-fairshare.testnet": {
   "emeka-fairshare.testnet": 45,
   "fatima-fairshare.testnet": 35,
   "ibrahim-fairshare.testnet": 20
  },
  "emeka-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "ngozi-fairshare.testnet": 35,
   "tunde-fairshare.testnet": 25
  },
  "fatima-fairshare.testnet": {
   "ngozi-fairshare.testnet": 50,
   "ibrahim-fairshare.testnet": 30,
   "ada-fairshare.testnet": 20
  },
  "ibrahim-fairshare.testnet": {
   "tunde-fairshare.testnet": 40,
   "emeka-fairshare.testnet": 35,
   "fatima-fairshare.testnet": 25
  },
  "ngozi-fairshare.testnet": {
   "fatima-fairshare.testnet": 45,
   "ada-fairshare.testnet": 30,
   "ibrahim-fairshare.testnet": 25
  },
  "tunde-fairshare.testnet": {
   "ibrahim-fairshare.testnet": 50,
   "ada-fairshare.testnet": 30,
   "emeka-fairshare.testnet": 20
  }
 },
 "3": {
  "alice-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "emeka-fairshare.testnet": 30,
   "frank-fairshare.testnet": 30
  },
  "bob-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "ibrahim-fairshare.testnet": 30,
   "carol-fairshare.testnet": 30
  },
  "carol-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "ngozi-fairshare.testnet": 30,
   "dave-fairshare.testnet": 30
  },
  "dave-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "fatima-fairshare.testnet": 30,
   "erin-fairshare.testnet": 30
  },
  "erin-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "tunde-fairshare.testnet": 30,
   "bob-fairshare.testnet": 30
  },
  "frank-fairshare.testnet": {
   "emeka-fairshare.testnet": 40,
   "ibrahim-fairshare.testnet": 30,
   "ngozi-fairshare.testnet": 30
  },
  "ada-fairshare.testnet": {
   "bob-fairshare.testnet": 40,
   "carol-fairshare.testnet": 30,
   "dave-fairshare.testnet": 30
  },
  "emeka-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "fatima-fairshare.testnet": 30,
   "tunde-fairshare.testnet": 30
  },
  "fatima-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "ibrahim-fairshare.testnet": 30,
   "ngozi-fairshare.testnet": 30
  },
  "ibrahim-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "tunde-fairshare.testnet": 30,
   "frank-fairshare.testnet": 30
  },
  "ngozi-fairshare.testnet": {
   "ada-fairshare.testnet": 40,
   "emeka-fairshare.testnet": 30,
   "fatima-fairshare.testnet": 30
  }
 },
 "4": {
  "chidi-fairshare.testnet": {
   "amara-fairshare.testnet": 40,
   "segun-fairshare.testnet": 35,
   "kemi-fairshare.testnet": 25
  },
  "amara-fairshare.testnet": {
   "chidi-fairshare.testnet": 40,
   "zainab-fairshare.testnet": 35,
   "tobi-fairshare.testnet": 25
  },
  "segun-fairshare.testnet": {
   "kemi-fairshare.testnet": 40,
   "chidi-fairshare.testnet": 30,
   "amara-fairshare.testnet": 30
  },
  "kemi-fairshare.testnet": {
   "tobi-fairshare.testnet": 40,
   "segun-fairshare.testnet": 30,
   "zainab-fairshare.testnet": 30
  },
  "tobi-fairshare.testnet": {
   "zainab-fairshare.testnet": 40,
   "amara-fairshare.testnet": 30,
   "chidi-fairshare.testnet": 30
  },
  "zainab-fairshare.testnet": {
   "tobi-fairshare.testnet": 35,
   "kemi-fairshare.testnet": 35,
   "segun-fairshare.testnet": 30
  }
 }
};

// ---- DAO governance, from this site ----
// Open proposals are read live from the DAO. A connected council member
// can vote on them and propose a new member, with signed calls to the
// DAO. Everyone else reads them. Testnet only. The DAO decides by
// strict majority: floor(council / 2) + 1 approvals. Proposing an
// AddMemberToRole costs a 1 NEAR bond, returned when approved.
// The act_proposal call carries the full proposal kind, which Sputnik
// v2 requires since its #217 change.
const DAO_BOND_YOCTO = "1000000000000000000000000";
const WALLET_GAS_150 = "150000000000000";
let govCouncil = [];
let govThreshold = 0;

async function daoView(method, args) {
  return rpcViewCall(DAO_ID, method, args);
}

function govKindLabel(kind) {
  if (!kind || typeof kind !== "object") return "Proposal";
  if (kind.AddMemberToRole) return "Add " + kind.AddMemberToRole.member_id + " to the council";
  if (kind.RemoveMemberFromRole) return "Remove " + kind.RemoveMemberFromRole.member_id + " from " + kind.RemoveMemberFromRole.role;
  if (kind.FunctionCall) {
    const f = kind.FunctionCall;
    const dep = f.deposit && f.deposit !== "0" ? " with " + fmtYocto(BigInt(f.deposit)) + " NEAR attached" : "";
    return "Call " + f.receiver_id + ", " + f.method_name + dep;
  }
  if (kind.Transfer) return "Transfer " + fmtYocto(BigInt(kind.Transfer.amount)) + " NEAR to " + kind.Transfer.receiver_id;
  if (kind.ChangePolicy) return "Change the DAO policy";
  if (kind.ChangeConfig) return "Change the DAO config";
  if (kind.SetStakingContract) return "Set the staking contract";
  if (kind.Bounty) return "Bounty: " + (kind.Bounty.description || "");
  if (kind.BountyDone) return "Mark a bounty done";
  if (kind.Vote) return "Vote on an earlier proposal";
  return Object.keys(kind)[0];
}

function govIsCouncilMember() {
  return !!walletAccountId && govCouncil.indexOf(walletAccountId) >= 0;
}

async function refreshGovPanel() {
  const list = el("govProposals");
  if (!list) return;
  const status = el("govStatus");
  const form = el("govPropose");
  try {
    if (status) status.textContent = "Reading open proposals from the DAO…";
    const policy = await daoView("get_policy", {});
    const councilRole = (policy.roles || []).find((r) => r.name === "council");
    govCouncil = (councilRole && councilRole.kind && councilRole.kind.Group) || [];
    govThreshold = Math.floor(govCouncil.length / 2) + 1;
    const proposals = await daoView("get_proposals", { from_index: 0, limit: 50 });
    const open = (proposals || []).filter((p) => p.status === "InProgress");
    const total = (proposals || []).length;
    if (open.length === 0) {
      list.innerHTML = "<p class=\"muted\">No open proposals right now. " + total +
        " proposals have run so far, and every one of them was decided by the council.</p>";
    } else {
      list.innerHTML = open.map((p) => {
        const counts = (p.vote_counts && p.vote_counts.council) || [0, 0, 0];
        const approve = counts[0] || 0;
        const reject = counts[1] || 0;
        const myVote = walletAccountId && p.votes ? p.votes[walletAccountId] : null;
        let actions = "";
        if (govIsCouncilMember()) {
          if (myVote) {
            actions = "<p class=\"muted\">You voted " + myVote + " on this proposal.</p>";
          } else {
            actions = "<p><button type=\"button\" data-gov-vote=\"VoteApprove\" data-gov-id=\"" + p.id +
              "\">Approve</button> <button type=\"button\" data-gov-vote=\"VoteReject\" data-gov-id=\"" + p.id +
              "\">Reject</button></p>";
          }
        } else if (walletAccountId) {
          actions = "<p class=\"muted\">Only council members can vote. This account is not on the council.</p>";
        } else {
          actions = "<p class=\"muted\">Connect your wallet above to vote. Only council members can vote.</p>";
        }
        return "<div class=\"govProp\"><h3>Proposal #" + p.id + " · " + govKindLabel(p.kind) + "</h3>" +
          "<p class=\"muted\">" + escapeHtml(p.description || "") + " · Proposed by " + p.proposer + "</p>" +
          "<p><span class=\"votes\">" + approve + " approve · " + reject + " reject</span> · Needs " +
          govThreshold + " approvals out of " + govCouncil.length + " council members</p>" +
          actions + "</div>";
      }).join("");
      list.querySelectorAll("[data-gov-vote]").forEach((b) =>
        b.addEventListener("click", () => govVote(
          parseInt(b.getAttribute("data-gov-id"), 10),
          b.getAttribute("data-gov-vote"),
          open.find((p) => p.id === parseInt(b.getAttribute("data-gov-id"), 10))
        ))
      );
    }
    if (status) status.textContent = open.length === 0
      ? "No open proposals. The list above is fresh from the DAO."
      : open.length + " open proposal" + (open.length > 1 ? "s" : "") + ", fresh from the DAO. Threshold is " + govThreshold + " approvals.";
    if (form) form.style.display = govIsCouncilMember() ? "block" : "none";
  } catch (e) {
    if (status) status.textContent = "Could not read proposals just now: " + String(e.message).slice(0, 120) + ". Reload to try again.";
    if (form) form.style.display = "none";
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function govVote(proposalId, action, proposal) {
  const status = el("govStatus");
  if (!proposal || !walletAccountId) return;
  if (status) status.textContent = "Opening your wallet to sign the " + (action === "VoteApprove" ? "Approve" : "Reject") + " vote on proposal #" + proposalId + "…";
  try {
    await walletCall(DAO_ID, "act_proposal", { id: proposalId, action: action, proposal: proposal.kind, memo: null }, "0", WALLET_GAS_150);
    if (status) status.textContent = "Sent to your wallet. Approve the call there; the list refreshes when you return.";
    setTimeout(refreshGovPanel, 3000);
  } catch (e) {
    if (status) status.textContent = "Wallet error: " + String(e.message).slice(0, 160);
  }
}

async function govProposeAdd() {
  const input = el("govNewMember");
  const result = el("govProposeResult");
  if (!input || !walletAccountId) return;
  const id = input.value.trim();
  if (!/^[a-z0-9._-]+\.testnet$/.test(id)) {
    if (result) result.textContent = "That does not look like a testnet account. Use the full name, like newmember.testnet.";
    return;
  }
  if (govCouncil.indexOf(id) >= 0) {
    if (result) result.textContent = id + " is already on the council.";
    return;
  }
  const kind = { AddMemberToRole: { member_id: id, role: "council" } };
  const description = "Add " + id + " to the FairShare council";
  const status = el("govStatus");
  if (status) status.textContent = "Opening your wallet to sign the proposal. The 1 NEAR bond is attached and returned when the council approves.";
  try {
    await walletCall(DAO_ID, "add_proposal", { proposal: { description: description, kind: kind } }, DAO_BOND_YOCTO, WALLET_GAS_100);
    if (result) result.textContent = "Sent to your wallet. Approve the call there; the new proposal appears in the list above when you return.";
    setTimeout(refreshGovPanel, 3000);
  } catch (e) {
    if (result) result.textContent = "Wallet error: " + String(e.message).slice(0, 160);
  }
}

// ---- Membership Integrity Monitor ----
// Membership is the one thing a bad actor can game without touching the
// settlement maths: join twice, or join with friends and vote each other
// in. This panel shows who is on the council, how they got there, whether
// the contract mirror matches the DAO, what each member actually did in
// the settled rounds, and which pairs gave each other a large share of
// their points. Live membership, standings, badges, and pending proposals
// are read from the chain. Syncs, adds, removals, activity, and the
// allocations behind the warnings are recorded history from demo-log.json,
// labelled as such. A warning is a prompt for a human to look, not proof
// of collusion: in a 100 point round with 3 recipients, 40 points to one
// person is common, and the contract discount already cut every mutual
// leg in half at settle.
function monitorShort(id) {
  return id.replace("-fairshare.testnet", "").replace(".testnet", "");
}
function monitorMutualPairs() {
  const flagged = [];
  for (const round of Object.keys(MONITOR_ALLOCATIONS).map(Number).sort((a, b) => a - b)) {
    const alloc = MONITOR_ALLOCATIONS[String(round)];
    for (const a of Object.keys(alloc)) {
      const totalA = Object.values(alloc[a]).reduce((s, p) => s + p, 0);
      for (const b of Object.keys(alloc[a])) {
        if (!(b in alloc) || !(a in alloc[b]) || a >= b) continue;
        const totalB = Object.values(alloc[b]).reduce((s, p) => s + p, 0);
        const aToB = alloc[a][b];
        const bToA = alloc[b][a];
        const shareA = Math.round(100 * aToB / totalA);
        const shareB = Math.round(100 * bToA / totalB);
        if (shareA >= MONITOR_THRESHOLD && shareB >= MONITOR_THRESHOLD) {
          flagged.push({ round: round, a: a, b: b, aToB: aToB, bToA: bToA, shareA: shareA, shareB: shareB });
        }
      }
    }
  }
  return flagged;
}
function renderMonitorStatic() {
  const sync = el("monitorSync");
  if (sync) {
    const last = MONITOR_SYNCS[MONITOR_SYNCS.length - 1];
    sync.innerHTML = "<p>Last successful synchronisation, from the recorded history: <code>" +
      last.tx + "</code> · " + last.when + " · " + last.members +
      " members after the sync · " + last.note + ".</p>" +
      "<p class=\"muted\">This is recorded history from the project log, not a live chain read. " +
      "The live DAO versus contract comparison is directly above.</p>" +
      "<p class=\"muted\">Earlier syncs: " + MONITOR_SYNCS.slice(0, -1).map((s) =>
        s.when + ", " + s.members + " members, <code>" + s.tx.slice(0, 12) + "…</code>").join(" · ") + ".</p>";
  }
  const hist = el("monitorHistory");
  if (hist) {
    const adds = MONITOR_ADDS.slice().reverse().map((a) =>
      "<tr><td>#" + a.proposal + "</td><td>" + monitorShort(a.member) + "</td><td><code>" +
      a.tx + "</code></td></tr>").join("");
    hist.innerHTML = "<table><thead><tr><th>Proposal</th><th>Admitted</th><th>Propose transaction</th></tr></thead><tbody>" +
      adds + "</tbody></table>" +
      (MONITOR_REMOVALS.length === 0
        ? "<p class=\"muted\">No member has been removed from the council. Every admission above was a DAO proposal passed by strict majority.</p>"
        : "<p>Removed: " + MONITOR_REMOVALS.map((r) => r.member + " (#" + r.proposal + ")").join(", ") + ".</p>");
  }
  const act = el("monitorActivity");
  if (act) {
    const rows = Object.keys(MONITOR_ACTIVITY).map((id) => {
      const m = MONITOR_ACTIVITY[id];
      const cell = (r) => m.rounds[String(r)] === "allocated" ? "Allocated"
        : m.rounds[String(r)] === "not member" ? "<span class=\"muted\">Not a member</span>" : "None";
      return "<tr><td>" + monitorShort(id) + "<br><span class=\"muted\">" + id +
        "</span></td><td>" + cell(1) + "</td><td>" + cell(2) + "</td><td>" + cell(3) +
        "</td><td>" + cell(4) + "</td><td>" + m.standing + "</td></tr>";
    }).join("");
    act.innerHTML = "<table><thead><tr><th>Member</th><th>Round 1</th><th>Round 2</th><th>Round 3</th><th>Round 4</th><th>Standing</th></tr></thead><tbody>" +
      rows + "</tbody></table>" +
      "<p class=\"muted\">Allocated means the member submitted points in that round. None means they were a member and submitted nothing, which cost them 5 standing. Not a member means they had not joined yet. Standing is the live value after round 4.</p>";
  }
  const warn = el("monitorWarnings");
  if (warn) {
    const pairs = monitorMutualPairs();
    if (pairs.length === 0) {
      warn.innerHTML = "<p>No pair of members gave each other " + MONITOR_THRESHOLD +
        "% or more of their points in any settled round. Nothing crosses the warning threshold.</p>";
    } else {
      warn.innerHTML = "<p>A pair is flagged when each member gave at least " + MONITOR_THRESHOLD +
        "% of their points to the other in the same round. The contract discount already cut each mutual leg in half at settle, so the flag is about the pattern, not the payout.</p>" +
        pairs.map((p) => "<p><b>Round " + p.round + ":</b> " + monitorShort(p.a) + " gave " +
          p.aToB + " points (" + p.shareA + "% of what they gave) to " + monitorShort(p.b) +
          ", who gave " + p.bToA + " points (" + p.shareB + "%) back. " +
          "Flagged for review, not proof of collusion.</p>").join("");
    }
  }
}
async function refreshMonitorPanel() {
  const line = el("monitorSyncLine");
  const membersBox = el("monitorMembers");
  const pendingBox = el("monitorPending");
  try {
    const policy = await daoView("get_policy", {});
    const councilRole = (policy.roles || []).find((r) => r.name === "council");
    const council = (councilRole && councilRole.kind && councilRole.kind.Group) || [];
    const members = await contractView("get_members", {});
    const inSync = council.length === members.length &&
      council.every((m) => members.indexOf(m) >= 0);
    const standings = {};
    await Promise.all(members.map(async (m) => {
      try { standings[m] = await contractView("get_standing", { account_id: m }); }
      catch (_) { standings[m] = "?"; }
    }));
    let badgeOwners = {};
    try {
      const tokens = await badgeView("nft_tokens", { from_index: "0", limit: 100 });
      for (const t of tokens || []) badgeOwners[t.owner_id] = true;
    } catch (_) { badgeOwners = null; }
    const proposals = await daoView("get_proposals", { from_index: 0, limit: 50 });
    const open = (proposals || []).filter((p) => p.status === "InProgress");
    const pendingAdds = open.filter((p) => p.kind && p.kind.AddMemberToRole);
    const threshold = Math.floor(council.length / 2) + 1;
    if (line) line.textContent = inSync
      ? "Live just now: the DAO council and the contract mirror agree, " + council.length +
        " members each. In sync."
      : "Live just now: OUT OF SYNC. The DAO council has " + council.length +
        " members and the contract mirror has " + members.length +
        ". Run sync_dao_members to fix it.";
    if (membersBox) {
      membersBox.innerHTML = "<table><thead><tr><th>Member</th><th>Standing</th><th>Badge</th></tr></thead><tbody>" +
        members.map((m) => "<tr><td>" + monitorShort(m) + "<br><span class=\"muted\">" + m +
          "</span></td><td>" + standings[m] + "</td><td>" +
          (badgeOwners === null ? "Unknown" : (badgeOwners[m] ? "Yes, soulbound" : "No")) +
          "</td></tr>").join("") + "</tbody></table>" +
        "<p class=\"muted\">Read live from the DAO policy and the contract just now. Standing is the live value; the badge column says whether the member holds a soulbound council badge.</p>";
    }
    if (pendingBox) {
      pendingBox.innerHTML = pendingAdds.length === 0
        ? "<p>No admission proposal is open right now. " + (proposals || []).length +
          " proposals have run so far, and every one of them was decided by the council.</p>"
        : pendingAdds.map((p) => {
          const counts = (p.vote_counts && p.vote_counts.council) || [0, 0, 0];
          return "<p><b>Proposal #" + p.id + ":</b> add " + p.kind.AddMemberToRole.member_id +
            " to the council · Proposed by " + p.proposer + " · " + (counts[0] || 0) +
            " approve, " + (counts[1] || 0) + " reject · Needs " + threshold + " approvals.</p>";
        }).join("");
    }
  } catch (e) {
    if (line) line.textContent = "Could not read the DAO and the contract just now. Last verified state: 19 members, DAO and contract in sync, last sync " +
      MONITOR_SYNCS[MONITOR_SYNCS.length - 1].tx + " on " +
      MONITOR_SYNCS[MONITOR_SYNCS.length - 1].when + ".";
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
    renderPayoutCharts();
    renderStandingsChart();
    renderStressCompare();
    renderHomeDashboard();
    renderLive();
    initWallet();
    refreshGovPanel();
    refreshBadgePanel();
    renderMonitorStatic();
    refreshMonitorPanel();
    if (typeof window !== "undefined" && window.location && window.location.hash === "#walletPanel") {
      const p = el("walletPanel");
      if (p) {
        if (typeof p.scrollIntoView === "function") p.scrollIntoView();
        highlightWalletPanel();
      }
    }
    const govBtn = el("govProposeBtn");
    if (govBtn) govBtn.addEventListener("click", govProposeAdd);
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
    for (const sc of STRESS_SCENARIOS) {
      const b = el("stressBtn-" + sc.id);
      if (b) b.addEventListener("click", () => runStressScenario(sc.id));
    }
  });
}

if (typeof module !== "undefined") {
  module.exports = { PARAMS, MEMBERS, ALLOCATIONS, ENVELOPE_NEAR, settle, effectivePoints, isqrt, fmtYocto, LAB_MEMBERS, LAB_TRIO, LAB_RING, LAB_HONEST, LAB_ENVELOPE_NEAR, LIVE_ROUND1, LIVE_ROUND2, LIVE_ROUND3, LIVE_ROUND4, STANDINGS_HISTORY, HOME_DASHBOARD_FALLBACK, CONTRACT_ID, DAO_ID, standingAfter, STRESS_MEMBERS, STRESS_NAMES, STRESS_SCENARIOS, STRESS_ENVELOPE_NEAR, runStressScenario, MONITOR_THRESHOLD, MONITOR_SYNCS, MONITOR_ADDS, MONITOR_REMOVALS, MONITOR_ACTIVITY, MONITOR_ALLOCATIONS, monitorMutualPairs, renderMonitorStatic, RPC_ENDPOINTS, rpcViewCall, payoutChartHtml, renderPayoutCharts, standingsChartHtml, renderStandingsChart, stressCompareData, stressCompareHtml, renderStressCompare, walletPointsBarHtml, renderWalletDashboard, openDashboardFromHeader, highlightWalletPanel, renderHomeDashboard, rpcAccountBalance };
}
