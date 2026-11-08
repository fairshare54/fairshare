// Live round 3 on NEAR testnet — FairShare reputation-rule proof round.
// Same 12 members as rounds 1+2 (6 demo + 6 crew). Round 3 is funded with a
// 5 NEAR envelope by a REAL DAO FunctionCall proposal to create_round.
// Eleven members allocate; tunde deliberately submits NOTHING, to prove the
// -5 no-allocation penalty live. The owner closes and settles, then the
// script verifies scores (independent integer model, standing weight 100
// for everyone going in), payouts, balances, AND the standing moves
// (+2 per distinct giver capped at +10, -5 for no submission, floor 50
// cap 200). It also proves both reputation gates live: a member at
// standing 100 cannot close a round early, and tunde at standing 95
// cannot propose a round afterwards.
// Testnet only. Uses ONLY accounts in .testnet-fairshare-accounts.json.
// Run: node scripts/live-round-3.mjs
// Writes demo-log-round3.json (tx hashes, scores, payouts, standings, gate
// proofs; NO keys). Resumable where the round-2 script's pattern allows.
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../demo-log-round3.json', import.meta.url);

const DAO_ID = 'fairshare-dao.testnet';
const CONTRACT_ID = 'fairshare-contract.testnet';
const OWNER_ID = 'fairshare-owner.testnet';
const ROUND_ID = 3;
const ENVELOPE_YOCTO = 5_000_000_000_000_000_000_000_000n; // 5 NEAR
const BOND_YOCTO = 1_000_000_000_000_000_000_000_000n; // 1 NEAR proposal bond
const GAS_100 = 100_000_000_000_000n;
const GAS_150 = 150_000_000_000_000n;
const GAS_200 = 200_000_000_000_000n;

// All 12 members. tunde submits nothing on purpose (penalty proof).
const DEMO = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map((r) => `${r}-fairshare.testnet`);
const CREW = ['ada', 'emeka', 'fatima', 'ibrahim', 'ngozi', 'tunde'].map((r) => `${r}-fairshare.testnet`);
const MEMBERS = [...DEMO, ...CREW];
const ALL_VOTERS = [...MEMBERS];

// Allocations: 100 points each, no self, >= 3 recipients, real work reasons.
// Distinct givers per member (from these edges): ada 9, emeka 3, frank 2,
// ibrahim 3, carol 2, ngozi 3, dave 2, fatima 3, erin 1, bob 2, tunde 3,
// alice 0. Expected standings after settle: ada 110 (cap), emeka 106,
// frank 104, ibrahim 106, carol 104, ngozi 106, dave 104, fatima 106,
// erin 102, bob 104, tunde 95 (-5, no submission), alice 100.
const ALLOCATIONS = {
  'alice-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'kept the temperature log perfect' },
    { to: 'emeka-fairshare.testnet', points: 30, reason: 'delivered the fish on time' },
    { to: 'frank-fairshare.testnet', points: 30, reason: 'kept the stall tidy' },
  ],
  'bob-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'logged every delivery' },
    { to: 'ibrahim-fairshare.testnet', points: 30, reason: 'fixed the generator' },
    { to: 'carol-fairshare.testnet', points: 30, reason: 'reviewed the round notes' },
  ],
  'carol-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'kept the books straight' },
    { to: 'ngozi-fairshare.testnet', points: 30, reason: 'negotiated the wholesale price' },
    { to: 'dave-fairshare.testnet', points: 30, reason: 'shared the freezer rota' },
  ],
  'dave-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'checked the temperature at night' },
    { to: 'fatima-fairshare.testnet', points: 30, reason: 'collected all the rent' },
    { to: 'erin-fairshare.testnet', points: 30, reason: 'tested the new lock' },
  ],
  'erin-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'hosted the freezer and kept the log' },
    { to: 'tunde-fairshare.testnet', points: 30, reason: 'guarded the stall overnight' },
    { to: 'bob-fairshare.testnet', points: 30, reason: 'paired on the stock count' },
  ],
  'frank-fairshare.testnet': [
    { to: 'emeka-fairshare.testnet', points: 40, reason: 'drove the night delivery' },
    { to: 'ibrahim-fairshare.testnet', points: 30, reason: 'repaired the freezer at midnight' },
    { to: 'ngozi-fairshare.testnet', points: 30, reason: 'found the cheaper ice supplier' },
  ],
  'ada-fairshare.testnet': [
    { to: 'bob-fairshare.testnet', points: 40, reason: 'kept the temperature log perfect' },
    { to: 'carol-fairshare.testnet', points: 30, reason: 'reviewed the round notes' },
    { to: 'dave-fairshare.testnet', points: 30, reason: 'shared the freezer rota' },
  ],
  'emeka-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'logged every delivery' },
    { to: 'fatima-fairshare.testnet', points: 30, reason: 'collected the rent on time' },
    { to: 'tunde-fairshare.testnet', points: 30, reason: 'helped load the van at dawn' },
  ],
  'fatima-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'kept the books straight' },
    { to: 'ibrahim-fairshare.testnet', points: 30, reason: 'repaired the lock the same day' },
    { to: 'ngozi-fairshare.testnet', points: 30, reason: 'negotiated the wholesale price down' },
  ],
  'ibrahim-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'hosted the freezer and kept the log' },
    { to: 'tunde-fairshare.testnet', points: 30, reason: 'guarded the stall overnight' },
    { to: 'frank-fairshare.testnet', points: 30, reason: 'kept the stall tidy' },
  ],
  'ngozi-fairshare.testnet': [
    { to: 'ada-fairshare.testnet', points: 40, reason: 'logged every delivery' },
    { to: 'emeka-fairshare.testnet', points: 30, reason: 'delivered the fish on time' },
    { to: 'fatima-fairshare.testnet', points: 30, reason: 'collected the rent on time' },
  ],
  // tunde-fairshare.testnet: NO submission, on purpose (penalty proof).
};
const EXPECTED_STANDING_AFTER = {
  'ada-fairshare.testnet': 110,
  'emeka-fairshare.testnet': 106,
  'frank-fairshare.testnet': 104,
  'ibrahim-fairshare.testnet': 106,
  'carol-fairshare.testnet': 104,
  'ngozi-fairshare.testnet': 106,
  'dave-fairshare.testnet': 104,
  'fatima-fairshare.testnet': 106,
  'erin-fairshare.testnet': 102,
  'bob-fairshare.testnet': 104,
  'tunde-fairshare.testnet': 95,
  'alice-fairshare.testnet': 100,
};

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));

const keyStore = new keyStores.InMemoryKeyStore();
const near = await connect({
  networkId: 'testnet',
  nodeUrl: RPC,
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore,
});
async function loadKey(a) {
  await keyStore.setKey('testnet', a.accountId, KeyPair.fromString(a.privateKey));
}
for (const a of Object.values(accounts)) if (a?.privateKey) await loadKey(a);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function balance(accountId) {
  return (await (await near.account(accountId)).state()).amount;
}
async function daoView(method, args) {
  const a = await near.account(DAO_ID);
  return a.viewFunction({ contractId: DAO_ID, methodName: method, args });
}
async function contractView(method, args) {
  const a = await near.account(CONTRACT_ID);
  return a.viewFunction({ contractId: CONTRACT_ID, methodName: method, args });
}
async function daoCall(signerId, method, args, { gas = GAS_100, deposit = 0n } = {}) {
  const signer = await near.account(signerId);
  const out = await signer.functionCall({ contractId: DAO_ID, methodName: method, args, gas, attachedDeposit: deposit });
  return out.transaction.hash;
}
async function contractCall(signerId, method, args, { gas = GAS_100, deposit = 0n } = {}) {
  const signer = await near.account(signerId);
  const out = await signer.functionCall({ contractId: CONTRACT_ID, methodName: method, args, gas, attachedDeposit: deposit });
  return out.transaction.hash;
}
async function poll(fn, pred, label, timeoutMs = 120000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (pred(last)) return last;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${label}; last: ${JSON.stringify(last)}`);
}

const txs = {};
let existingLog = {};
try { existingLog = JSON.parse(fs.readFileSync(OUT, 'utf8')); Object.assign(txs, existingLog.txs || {}); } catch { /* fresh */ }

// ---------- Step 0: top up the DAO treasury so a 5 NEAR envelope is covered ----------
// LESSON from the first run: the DAO's TOTAL balance is not its spendable
// balance. Sputnik stores every proposal on-chain, so the DAO must keep
// ~4.74 NEAR staked for its own storage; only the balance above that is
// spendable. Funding round 2 left the DAO at ~5.0 NEAR total (~0.26 free),
// and a 1 NEAR top-up was not enough: the 7th vote on the funding
// proposal failed with LackBalanceForState (3.75 NEAR short). A second
// top-up to 10 NEAR total still failed (0.743 short): measured DAO
// storage_usage is 474269 bytes = 4.7427 NEAR minimum, AND execution also
// returns the 1 NEAR proposal bond, so the real outflow is 6 NEAR, not 5.
// 4.7427 + 6 = 10.7427, so the DAO needs ~11.5 NEAR total for a 5 NEAR
// envelope. Top up to 11.5 NEAR.
const DAO_MIN_TOTAL = 11_500_000_000_000_000_000_000_000n; // 11.5 NEAR
let daoBalance = BigInt(await balance(DAO_ID));
console.log(`DAO balance: ${daoBalance} yocto (${Number(daoBalance) / 1e24} NEAR)`);
if (daoBalance < DAO_MIN_TOTAL) {
  const need = DAO_MIN_TOTAL - daoBalance;
  const ownerBalBefore = BigInt(await balance(OWNER_ID));
  // Make sure the owner keeps ~1 NEAR for gas after funding the top-up.
  if (ownerBalBefore < need + 1_000_000_000_000_000_000_000_000n) {
    const shortfall = need + 1_000_000_000_000_000_000_000_000n - ownerBalBefore;
    const alice = await near.account('alice-fairshare.testnet');
    const topOwnerTx = await alice.sendMoney(OWNER_ID, shortfall);
    console.log(`topped owner up ${Number(shortfall) / 1e24} NEAR from alice: ${topOwnerTx.transaction.hash}`);
    txs.topup_owner = topOwnerTx.transaction.hash;
  }
  const owner = await near.account(OWNER_ID);
  const topTx = await owner.sendMoney(DAO_ID, need);
  txs.topup_dao = topTx.transaction.hash;
  console.log(`topped DAO up ${Number(need) / 1e24} NEAR from owner: ${txs.topup_dao}`);
  daoBalance = BigInt(await balance(DAO_ID));
  console.log(`DAO balance now: ${Number(daoBalance) / 1e24} NEAR`);
}
if (daoBalance < ENVELOPE_YOCTO) throw new Error('DAO treasury still cannot cover the 5 NEAR envelope');

// ---------- Step 1: fund round 3 — DAO FunctionCall proposal to create_round ----------
let actStyle = 'new';
async function voteApprove(voterId, proposalId, kind) {
  const argsNew = { id: proposalId, action: 'VoteApprove', proposal: kind, memo: null };
  const argsOld = { id: proposalId, action: 'VoteApprove', memo: null };
  try {
    if (actStyle === 'new') return await daoCall(voterId, 'act_proposal', argsNew, { gas: GAS_150 });
    return await daoCall(voterId, 'act_proposal', argsOld, { gas: GAS_150 });
  } catch (e) {
    const msg = String(e?.message || e);
    if (actStyle === 'new' && /argument|unknown|missing|deserialize|Invalid/i.test(msg)) {
      console.log(`act_proposal new-style rejected (${msg.slice(0, 120)}); falling back to old-style`);
      actStyle = 'old';
      return await daoCall(voterId, 'act_proposal', argsOld, { gas: GAS_150 });
    }
    throw e;
  }
}
async function voteUntilApproved(proposalId, kind, proposeTx) {
  for (const voter of ALL_VOTERS) {
    const p = await daoView('get_proposal', { id: proposalId });
    if (p.status === 'Approved') break;
    if (p.status !== 'InProgress') throw new Error(`proposal #${proposalId} in unexpected status ${p.status}`);
    if (p.votes && p.votes[voter]) continue;
    const voteTx = await voteApprove(voter, proposalId, kind);
    console.log(`  ${voter} VoteApprove #${proposalId}: ${voteTx}`);
    const after = await daoView('get_proposal', { id: proposalId });
    if (after.status === 'Approved') { console.log(`  proposal #${proposalId} APPROVED and executed`); break; }
  }
  const final = await poll(async () => daoView('get_proposal', { id: proposalId }),
    (p) => p.status === 'Approved' || p.status === 'Failed', `proposal #${proposalId} final`, 120000);
  if (final.status === 'Failed') throw new Error(`proposal #${proposalId} FAILED on execution`);
  return { id: proposalId, proposeTx };
}
async function proposeAndApprove(description, kind) {
  const existing = await daoView('get_proposals', { from_index: 0, limit: 50 });
  const resumed = (existing || []).find((p) => p.description === description && p.status === 'InProgress');
  if (resumed) {
    console.log(`resuming existing proposal #${resumed.id} (${description})`);
    return voteUntilApproved(resumed.id, kind);
  }
  const nextId = await daoView('get_last_proposal_id', {});
  const proposeTx = await daoCall(OWNER_ID, 'add_proposal', { proposal: { description, kind } }, { gas: GAS_100, deposit: BOND_YOCTO });
  console.log(`proposed #${nextId} (${description}): ${proposeTx}`);
  return voteUntilApproved(nextId, kind, proposeTx);
}

let round3 = await contractView('get_round', { round_id: ROUND_ID });
if (!round3) {
  const argsB64 = Buffer.from(JSON.stringify({ round_id: ROUND_ID, envelope_yocto: ENVELOPE_YOCTO.toString() })).toString('base64');
  const kind = { FunctionCall: { receiver_id: CONTRACT_ID, actions: [{ method_name: 'create_round', args: argsB64, deposit: ENVELOPE_YOCTO.toString(), gas: '100000000000000' }] } };
  const { id, proposeTx } = await proposeAndApprove('Fund FairShare live round 3 (reputation-rule proof): 5 NEAR envelope via create_round', kind);
  txs.fund_proposal = { proposal_id: id, propose_tx: proposeTx };
  round3 = await poll(async () => contractView('get_round', { round_id: ROUND_ID }),
    (r) => r !== null && r.envelope_yocto === ENVELOPE_YOCTO.toString(), 'round 3 created', 180000);
  console.log(`round 3 created by DAO proposal #${id}: ${JSON.stringify(round3)}`);
} else {
  console.log('round 3 already exists, skipped funding proposal');
}

// ---------- Step 2: sync DAO members into the contract ----------
const daoInfo = await contractView('get_dao_info', {});
console.log('get_dao_info:', JSON.stringify(daoInfo));
if (daoInfo.member_count !== 12) {
  txs.sync_dao_members = await contractCall(OWNER_ID, 'sync_dao_members', {}, { gas: GAS_100 });
  console.log(`sync_dao_members: ${txs.sync_dao_members}`);
  await poll(async () => contractView('get_dao_info', {}),
    (v) => v && v.member_count === 12, '12 members synced', 120000);
}
const members = await contractView('get_members', {});
console.log('contract members:', members.join(', '));
const standingsBefore = {};
for (const m of MEMBERS) {
  standingsBefore[m] = await contractView('get_standing', { account_id: m });
}
console.log('standings before round 3:', JSON.stringify(standingsBefore));

// ---------- Step 3: GATE PROOF 1 — a member at standing 100 cannot close early ----------
let roundNow = await contractView('get_round', { round_id: ROUND_ID });
if (!roundNow.closed && !roundNow.settled && !txs.gate_close_rejected) {
  try {
    const badTx = await contractCall('ada-fairshare.testnet', 'close_round', { round_id: ROUND_ID });
    throw new Error(`GATE FAILURE: member close_round succeeded unexpectedly: ${badTx}`);
  } catch (e) {
    if (/GATE FAILURE/.test(String(e.message))) throw e;
    console.log(`GATE PROOF 1 OK: close_round as ada (standing 100) rejected: ${String(e.message).slice(0, 160)}`);
    txs.gate_close_rejected = String(e.message).slice(0, 300);
  }
  roundNow = await contractView('get_round', { round_id: ROUND_ID });
  if (roundNow.closed) throw new Error('round 3 closed despite rejected member close — gate broken');
}

// ---------- Step 4: allocations (11 members; tunde deliberately skips) ----------
const balancesBefore = {};
for (const m of MEMBERS) balancesBefore[m] = await balance(m);
txs.allocate = txs.allocate || {};
const existingAllocs = await contractView('get_allocations', { round_id: ROUND_ID });
const alreadyAllocated = new Set((existingAllocs || []).map((a) => a.account_id || a.member || a.giver).filter(Boolean));
for (const m of Object.keys(ALLOCATIONS)) {
  if (alreadyAllocated.has(m)) { console.log(`SKIP allocate ${m}: already submitted`); continue; }
  txs.allocate[m] = await contractCall(m, 'allocate', { round_id: ROUND_ID, allocations: ALLOCATIONS[m] }, { gas: GAS_100 });
  console.log(`allocate ${m}: ${txs.allocate[m]}`);
}
await poll(async () => contractView('get_allocations', { round_id: ROUND_ID }),
  (v) => Array.isArray(v) && v.length >= 11, '11 allocation submissions', 120000);
console.log('tunde deliberately submitted nothing (penalty proof)');

// ---------- Step 5: owner closes and settles ----------
roundNow = await contractView('get_round', { round_id: ROUND_ID });
if (!roundNow.closed && !roundNow.settled) {
  txs.close_round = await contractCall(OWNER_ID, 'close_round', { round_id: ROUND_ID });
  console.log(`close_round (owner): ${txs.close_round}`);
  roundNow = await poll(async () => contractView('get_round', { round_id: ROUND_ID }), (v) => v && v.closed, 'round 3 closed', 120000);
}
if (!roundNow.settled) {
  txs.settle_round = await contractCall(OWNER_ID, 'settle_round', { round_id: ROUND_ID }, { gas: GAS_200 });
  console.log(`settle_round: ${txs.settle_round}`);
  roundNow = await poll(async () => contractView('get_round', { round_id: ROUND_ID }), (v) => v && v.settled, 'round 3 settled', 120000);
}
console.log('get_round after settle:', JSON.stringify(roundNow));
if (!roundNow.settled) throw new Error('round 3 did not settle');

// ---------- Step 6: verify scores (standing weight 100 for everyone going in) ----------
function isqrt(n) {
  if (n < 0n) throw new Error('isqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
function expectedScores() {
  const orig = {};
  for (const [giver, allocs] of Object.entries(ALLOCATIONS)) {
    orig[giver] = {};
    for (const a of allocs) orig[giver][a.to] = a.points;
  }
  const eff = {};
  for (const [giver, allocs] of Object.entries(ALLOCATIONS)) {
    eff[giver] = {};
    for (const a of allocs) {
      const rev = (orig[a.to] && orig[a.to][giver]) || 0;
      eff[giver][a.to] = a.points - Math.floor(Math.min(a.points, rev) / 2);
    }
  }
  const scores = {};
  for (const m of MEMBERS) {
    let rootSum = 0n;
    for (const [giver, allocs] of Object.entries(ALLOCATIONS)) {
      const pts = (eff[giver] && eff[giver][m]) || 0;
      if (pts > 0) rootSum += isqrt(BigInt(pts) * 100n);
    }
    scores[m] = rootSum * rootSum;
  }
  return { scores, eff };
}
const { scores: expected, eff } = expectedScores();
const payouts = await contractView('get_payouts', { round_id: ROUND_ID });
const explanations = {};
let payoutSum = 0n;
const balancesAfter = {};
for (const m of MEMBERS) {
  const e = await contractView('explain_payout', { round_id: ROUND_ID, account_id: m });
  explanations[m] = e;
  if (BigInt(e.score) !== expected[m]) throw new Error(`score mismatch for ${m}: got ${e.score}, expected ${expected[m]}`);
  const p = BigInt(e.payout_yocto);
  if (p > ENVELOPE_YOCTO / 4n) throw new Error(`payout for ${m} exceeds 25% cap`);
  payoutSum += p;
  balancesAfter[m] = await balance(m);
  const delta = BigInt(balancesAfter[m]) - BigInt(balancesBefore[m]);
  console.log(`${m}: score ${e.score}, payout ${Number(p) / 1e24} NEAR, balance delta ${delta} yocto`);
  if (delta <= 0n && p > 0n) throw new Error(`balance did not rise for ${m}`);
  if (delta > p) throw new Error(`balance delta exceeds payout for ${m}`);
}
if (payoutSum > ENVELOPE_YOCTO) throw new Error('payout sum exceeds envelope');
console.log(`payout sum: ${payoutSum} yocto; remainder in contract: ${ENVELOPE_YOCTO - payoutSum} yocto`);

// ---------- Step 7: verify standings moved exactly per the rule ----------
const standingsAfter = {};
for (const m of MEMBERS) {
  standingsAfter[m] = await contractView('get_standing', { account_id: m });
  console.log(`standing ${m}: ${standingsBefore[m]} -> ${standingsAfter[m]} (expected ${EXPECTED_STANDING_AFTER[m]})`);
  if (standingsAfter[m] !== EXPECTED_STANDING_AFTER[m]) {
    throw new Error(`standing mismatch for ${m}: got ${standingsAfter[m]}, expected ${EXPECTED_STANDING_AFTER[m]}`);
  }
}

// ---------- Step 8: GATE PROOF 2 — tunde at standing 95 cannot propose a round ----------
try {
  const badTx = await contractCall('tunde-fairshare.testnet', 'create_round', { round_id: 4, envelope_yocto: '100000000000000000000000' }, { gas: GAS_100, deposit: 100_000_000_000_000_000_000_000n });
  throw new Error(`GATE FAILURE: low-standing create_round succeeded unexpectedly: ${badTx}`);
} catch (e) {
  if (/GATE FAILURE/.test(String(e.message))) throw e;
  console.log(`GATE PROOF 2 OK: create_round as tunde (standing 95) rejected: ${String(e.message).slice(0, 160)}`);
  txs.gate_create_rejected = String(e.message).slice(0, 300);
}
const round4 = await contractView('get_round', { round_id: 4 });
if (round4) throw new Error('round 4 exists despite rejected low-standing create — gate broken');
console.log('GATE PROOF 2 confirmed: round 4 does not exist');

const log = {
  network: 'testnet',
  contract_id: CONTRACT_ID,
  owner_id: OWNER_ID,
  dao_id: DAO_ID,
  round_id: ROUND_ID,
  envelope_yocto: ENVELOPE_YOCTO.toString(),
  allocations: ALLOCATIONS,
  effective_points: eff,
  expected_scores: Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v.toString()])),
  expected_standing_after: EXPECTED_STANDING_AFTER,
  txs,
  round: roundNow,
  payouts,
  explanations,
  standings_before: standingsBefore,
  standings_after: standingsAfter,
  balances_before_yocto: balancesBefore,
  balances_after_yocto: balancesAfter,
  payout_sum_yocto: payoutSum.toString(),
  remainder_yocto: (ENVELOPE_YOCTO - payoutSum).toString(),
  demo_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('LIVE ROUND 3 OK: reputation rule proven on testnet');
console.log('wrote demo-log-round3.json');
