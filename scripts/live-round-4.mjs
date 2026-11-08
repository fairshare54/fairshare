// Live round 4 on NEAR testnet — FairShare with a third set of members.
// Six fresh testnet accounts (a freezer cooperative crew, new names and new
// roles) are created via the helper faucet, added to the
// fairshare-dao.testnet council by REAL Sputnik proposals (proposed by the
// owner, voted by the existing council), synced into the contract, then
// round 4 is funded with a 5 NEAR envelope by a REAL DAO FunctionCall
// proposal to create_round. Only the 6 new members allocate their 100
// points; the 12 existing members take the -5 no-allocation standing
// penalty at settle, which is the live rule working as designed. The owner
// closes and settles, and every score and payout is verified onchain
// (explain_payout + balance deltas) against an independent integer model
// that replicates the contract exactly, including the water-filling cap.
// Testnet only. Uses ONLY accounts in .testnet-fairshare-accounts.json.
// Run: node scripts/live-round-4.mjs
// Writes demo-log-round4.json (tx hashes, scores, payouts, standings; NO keys).
// Resumable: every step first reads onchain state and skips work already done.
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../demo-log-round4.json', import.meta.url);

const DAO_ID = 'fairshare-dao.testnet';
const CONTRACT_ID = 'fairshare-contract.testnet';
const OWNER_ID = 'fairshare-owner.testnet';
const ROUND_ID = 4;
const ENVELOPE_YOCTO = 5_000_000_000_000_000_000_000_000n; // 5 NEAR
const BOND_YOCTO = 1_000_000_000_000_000_000_000_000n; // 1 NEAR proposal bond
const GAS_100 = 100_000_000_000_000n;
const GAS_150 = 150_000_000_000_000n;
const GAS_200 = 200_000_000_000_000n;

// Freezer cooperative crew, round 4 — six new people, new names, new roles.
// Previous names (never reused): round 1 demo alice, bob, carol, dave,
// erin, frank; rounds 2-3 crew ada, emeka, fatima, ibrahim, ngozi, tunde.
const CREW = [
  { role: 'chidi', accountId: 'chidi-fairshare.testnet', job: 'buys and hauls block ice for the freezers' },
  { role: 'amara', accountId: 'amara-fairshare.testnet', job: 'runs the market stall and serves customers' },
  { role: 'segun', accountId: 'segun-fairshare.testnet', job: 'keeps the ledger, receipts, and the books' },
  { role: 'kemi', accountId: 'kemi-fairshare.testnet', job: 'repairs freezers, scales, and lights' },
  { role: 'tobi', accountId: 'tobi-fairshare.testnet', job: 'night watch, guards the co-op overnight' },
  { role: 'zainab', accountId: 'zainab-fairshare.testnet', job: 'runs the delivery bike to customers' },
];
const DEMO_VOTERS = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map((r) => `${r}-fairshare.testnet`);
const OLD_CREW = ['ada', 'emeka', 'fatima', 'ibrahim', 'ngozi', 'tunde'].map((r) => `${r}-fairshare.testnet`);
// Threshold is a STRICT majority: floor(N/2)+1. Council grows 12 -> 18 as
// the new members join, so the needed approvals are 7, 7, 8, 8, 9, 9 for
// the six adds, then 10 for the funding proposal. Voters are tried in
// order and the loop stops on Approved.
const ALL_VOTERS = [...DEMO_VOTERS, ...OLD_CREW, ...CREW.map((c) => c.accountId)];

// Allocations: 100 points each, no self, >= 3 recipients, reasons are real work.
// Distinct givers per new member (from these edges): every new member gets
// points from exactly 3 distinct givers, so each gains +6 standing.
const ALLOCATIONS = {
  'chidi-fairshare.testnet': [
    { to: 'amara-fairshare.testnet', points: 40, reason: 'kept the stall stocked and the customers happy' },
    { to: 'segun-fairshare.testnet', points: 35, reason: 'balanced the ledger without a single error' },
    { to: 'kemi-fairshare.testnet', points: 25, reason: 'fixed the freezer fan before the ice melted' },
  ],
  'amara-fairshare.testnet': [
    { to: 'chidi-fairshare.testnet', points: 40, reason: 'hauled the block ice through the rain on time' },
    { to: 'zainab-fairshare.testnet', points: 35, reason: 'delivered every order before noon' },
    { to: 'tobi-fairshare.testnet', points: 25, reason: 'guarded the stall through the night' },
  ],
  'segun-fairshare.testnet': [
    { to: 'kemi-fairshare.testnet', points: 40, reason: 'repaired the scale the same morning it broke' },
    { to: 'chidi-fairshare.testnet', points: 30, reason: 'brought the ice in before the morning rush' },
    { to: 'amara-fairshare.testnet', points: 30, reason: 'sold out the stall by midday' },
  ],
  'kemi-fairshare.testnet': [
    { to: 'tobi-fairshare.testnet', points: 40, reason: 'stayed on watch and caught the faulty wiring' },
    { to: 'segun-fairshare.testnet', points: 30, reason: 'chased every receipt for the books' },
    { to: 'zainab-fairshare.testnet', points: 30, reason: 'ran the bike out twice in one day' },
  ],
  'tobi-fairshare.testnet': [
    { to: 'zainab-fairshare.testnet', points: 40, reason: 'delivered to the far customers without complaint' },
    { to: 'amara-fairshare.testnet', points: 30, reason: 'kept the stall tidy through the rush' },
    { to: 'chidi-fairshare.testnet', points: 30, reason: 'hauled extra ice when the freezer ran low' },
  ],
  'zainab-fairshare.testnet': [
    { to: 'tobi-fairshare.testnet', points: 35, reason: 'guarded the bikes and the stall all night' },
    { to: 'kemi-fairshare.testnet', points: 35, reason: 'fixed the bike brakes before the morning run' },
    { to: 'segun-fairshare.testnet', points: 30, reason: 'kept the delivery receipts in order' },
  ],
};
// Standings going in (verified live before the run): new members 100 each;
// demo + old crew as after round 3. After settle: new members 100 + 6 = 106
// each (3 distinct givers); the 12 existing members submitted nothing, -5.
const EXPECTED_STANDING_AFTER = {
  'chidi-fairshare.testnet': 106,
  'amara-fairshare.testnet': 106,
  'segun-fairshare.testnet': 106,
  'kemi-fairshare.testnet': 106,
  'tobi-fairshare.testnet': 106,
  'zainab-fairshare.testnet': 106,
  'alice-fairshare.testnet': 95,
  'bob-fairshare.testnet': 99,
  'carol-fairshare.testnet': 99,
  'dave-fairshare.testnet': 99,
  'erin-fairshare.testnet': 97,
  'frank-fairshare.testnet': 99,
  'ada-fairshare.testnet': 105,
  'emeka-fairshare.testnet': 101,
  'fatima-fairshare.testnet': 101,
  'ibrahim-fairshare.testnet': 101,
  'ngozi-fairshare.testnet': 101,
  'tunde-fairshare.testnet': 90,
};

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
function saveAccounts() {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 });
}

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
async function rpcViewAccount(accountId) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'r4-check', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } }),
  });
  return res.json();
}
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

// ---------- Step 0: create the 6 crew accounts via the helper faucet ----------
for (const { role, accountId } of CREW) {
  if (accounts[role]?.accountId === accountId) {
    const check = await rpcViewAccount(accountId);
    if (check.result) { console.log(`SKIP ${accountId}: already created and key saved`); continue; }
  }
  const existing = await rpcViewAccount(accountId);
  if (existing.result) throw new Error(`${accountId} already exists onchain — its key is not recoverable here; pick a fresh name`);
  const kp = KeyPair.fromRandom('ed25519');
  accounts[role] = { accountId, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString() };
  saveAccounts(); // key on disk BEFORE any network call that depends on it
  await loadKey(accounts[role]);
  console.log(`creating ${accountId} ...`);
  let lastText = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(HELPER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.getPublicKey().toString() }),
    });
    lastText = await res.text();
    console.log(`helper HTTP ${res.status} (attempt ${attempt}): ${lastText.slice(0, 200)}`);
    if (res.ok) break;
    await sleep(5000);
  }
  const verified = await poll(async () => (await rpcViewAccount(accountId)).result || null, (v) => v !== null, `${accountId} onchain`, 90000);
  console.log(`VERIFIED ${accountId}: balance ${verified.amount} yoctoNEAR`);
  txs[`create_account_${role}`] = 'helper-faucet';
  await sleep(1000);
}
const crewIds = CREW.map((c) => c.accountId);
const ALL_MEMBERS = [...DEMO_VOTERS, ...OLD_CREW, ...crewIds];

// ---------- Sputnik proposal helpers ----------
// Current Sputnik v2 act_proposal signature (post #217): (id, action, proposal, memo).
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
async function councilGroup() {
  const pol = await daoView('get_policy', {});
  return pol.roles.find((r) => r.name === 'council')?.kind?.Group || [];
}
async function proposeAndApprove(description, kind) {
  const existing = await daoView('get_proposals', { from_index: 0, limit: 50 });
  const resumed = (existing || []).find((p) => p.description === description && p.status === 'InProgress');
  if (resumed) {
    console.log(`resuming existing proposal #${resumed.id} (${description})`);
    return voteUntilApproved(resumed.id, kind);
  }
  const ownerAvail = BigInt(await balance(OWNER_ID));
  if (ownerAvail < BOND_YOCTO + 100_000_000_000_000_000_000_000n) {
    const alice = await near.account('alice-fairshare.testnet');
    const topTx = await alice.sendMoney(OWNER_ID, 3_000_000_000_000_000_000_000_000n);
    console.log(`topped owner up 3 NEAR from alice: ${topTx.transaction.hash}`);
    txs.topup_owner = topTx.transaction.hash;
  }
  const nextId = await daoView('get_last_proposal_id', {});
  const proposeTx = await daoCall(OWNER_ID, 'add_proposal', { proposal: { description, kind } }, { gas: GAS_100, deposit: BOND_YOCTO });
  console.log(`proposed #${nextId} (${description}): ${proposeTx}`);
  return voteUntilApproved(nextId, kind, proposeTx);
}
async function voteUntilApproved(proposalId, kind, proposeTx) {
  const votes = [];
  // Only current council members may vote; re-read the group so a member
  // added by an earlier proposal in this run can vote on the next one.
  const council = await councilGroup();
  const voters = ALL_VOTERS.filter((v) => council.includes(v));
  const needed = Math.floor(council.length / 2) + 1;
  console.log(`  council ${council.length}, strict majority needs ${needed} approvals`);
  for (const voter of voters) {
    const p = await daoView('get_proposal', { id: proposalId });
    if (p.status === 'Approved') break;
    if (p.status !== 'InProgress') throw new Error(`proposal #${proposalId} in unexpected status ${p.status}`);
    if (p.votes && p.votes[voter]) { votes.push({ voter, tx: '(already voted)' }); continue; }
    const voteTx = await voteApprove(voter, proposalId, kind);
    votes.push({ voter, tx: voteTx });
    console.log(`  ${voter} VoteApprove #${proposalId}: ${voteTx}`);
    const after = await daoView('get_proposal', { id: proposalId });
    if (after.status === 'Approved') { console.log(`  proposal #${proposalId} APPROVED and executed`); break; }
  }
  const final = await poll(async () => daoView('get_proposal', { id: proposalId }),
    (p) => p.status === 'Approved' || p.status === 'Failed', `proposal #${proposalId} final`, 120000);
  if (final.status === 'Failed') throw new Error(`proposal #${proposalId} FAILED on execution`);
  return { id: proposalId, proposeTx, votes };
}

// ---------- Step 1: add each crew member to the DAO council ----------
txs.add_member_proposals = txs.add_member_proposals || {};
for (const memberId of crewIds) {
  const group = await councilGroup();
  if (group.includes(memberId)) {
    console.log(`SKIP add ${memberId}: already on council`);
    continue;
  }
  const kind = { AddMemberToRole: { member_id: memberId, role: 'council' } };
  const { id, proposeTx, votes } = await proposeAndApprove(`Add ${memberId} to the FairShare council (live round 4 crew)`, kind);
  txs.add_member_proposals[memberId] = { proposal_id: id, propose_tx: proposeTx, votes };
  await poll(councilGroup, (g) => g.includes(memberId), `${memberId} on council`, 120000);
  console.log(`${memberId} is now on the DAO council (proposal #${id})`);
}

// ---------- Step 1b: DAO treasury check (round 3 lesson: needs ~11.5 NEAR total) ----------
const DAO_MIN_TOTAL = 11_500_000_000_000_000_000_000_000n; // 11.5 NEAR
let daoBalance = BigInt(await balance(DAO_ID));
console.log(`DAO balance: ${daoBalance} yocto (${Number(daoBalance) / 1e24} NEAR)`);
if (daoBalance < DAO_MIN_TOTAL) {
  const need = DAO_MIN_TOTAL - daoBalance;
  const owner = await near.account(OWNER_ID);
  const topTx = await owner.sendMoney(DAO_ID, need);
  txs.topup_dao = topTx.transaction.hash;
  console.log(`topped DAO up ${Number(need) / 1e24} NEAR from owner: ${txs.topup_dao}`);
  daoBalance = BigInt(await balance(DAO_ID));
  console.log(`DAO balance now: ${Number(daoBalance) / 1e24} NEAR`);
}
if (daoBalance < ENVELOPE_YOCTO) throw new Error('DAO treasury still cannot cover the 5 NEAR envelope');

// ---------- Step 2: fund round 4 — DAO FunctionCall proposal to create_round ----------
let round4 = await contractView('get_round', { round_id: ROUND_ID });
if (!round4) {
  const argsB64 = Buffer.from(JSON.stringify({ round_id: ROUND_ID, envelope_yocto: ENVELOPE_YOCTO.toString() })).toString('base64');
  const kind = { FunctionCall: { receiver_id: CONTRACT_ID, actions: [{ method_name: 'create_round', args: argsB64, deposit: ENVELOPE_YOCTO.toString(), gas: '100000000000000' }] } };
  const { id, proposeTx, votes } = await proposeAndApprove('Fund FairShare live round 4: 5 NEAR envelope via create_round', kind);
  txs.fund_proposal = { proposal_id: id, propose_tx: proposeTx, votes };
  round4 = await poll(async () => contractView('get_round', { round_id: ROUND_ID }),
    (r) => r !== null && r.envelope_yocto === ENVELOPE_YOCTO.toString(), 'round 4 created', 180000);
  console.log(`round 4 created by DAO proposal #${id}: ${JSON.stringify(round4)}`);
} else {
  console.log('round 4 already exists, skipped funding proposal');
}

// ---------- Step 3: sync DAO members into the contract ----------
const daoInfo = await contractView('get_dao_info', {});
console.log('get_dao_info before sync:', JSON.stringify(daoInfo));
if (daoInfo.member_count !== 18) {
  txs.sync_dao_members = await contractCall(OWNER_ID, 'sync_dao_members', {}, { gas: GAS_100 });
  console.log(`sync_dao_members: ${txs.sync_dao_members}`);
  await poll(async () => contractView('get_dao_info', {}),
    (v) => v && v.member_count === 18, '18 members synced', 120000);
}
const members = await contractView('get_members', {});
console.log('contract members:', members.join(', '));
for (const m of crewIds) {
  if (!members.includes(m)) throw new Error(`${m} missing from contract members after sync`);
}
const standingsBefore = {};
for (const m of ALL_MEMBERS) {
  standingsBefore[m] = await contractView('get_standing', { account_id: m });
}
console.log('standings before round 4:', JSON.stringify(standingsBefore));
for (const m of crewIds) {
  if (standingsBefore[m] !== 100) throw new Error(`new member ${m} does not start at standing 100 (got ${standingsBefore[m]})`);
}

// ---------- Step 4: each new crew member allocates ----------
const balancesBefore = {};
for (const m of crewIds) balancesBefore[m] = await balance(m);
txs.allocate = txs.allocate || {};
const existingAllocs = await contractView('get_allocations', { round_id: ROUND_ID });
const alreadyAllocated = new Set((existingAllocs || []).map((a) => a.account_id || a.member || a.giver).filter(Boolean));
for (const m of crewIds) {
  if (alreadyAllocated.has(m)) { console.log(`SKIP allocate ${m}: already submitted`); continue; }
  txs.allocate[m] = await contractCall(m, 'allocate', { round_id: ROUND_ID, allocations: ALLOCATIONS[m] }, { gas: GAS_100 });
  console.log(`allocate ${m}: ${txs.allocate[m]}`);
}
await poll(async () => contractView('get_allocations', { round_id: ROUND_ID }),
  (v) => Array.isArray(v) && v.length >= 6, '6 allocation submissions', 120000);

// ---------- Step 5: close and settle ----------
let roundNow = await contractView('get_round', { round_id: ROUND_ID });
if (!roundNow.closed && !roundNow.settled) {
  txs.close_round = await contractCall(OWNER_ID, 'close_round', { round_id: ROUND_ID });
  console.log(`close_round: ${txs.close_round}`);
  roundNow = await poll(async () => contractView('get_round', { round_id: ROUND_ID }), (v) => v && v.closed, 'round 4 closed', 120000);
}
if (!roundNow.settled) {
  txs.settle_round = await contractCall(OWNER_ID, 'settle_round', { round_id: ROUND_ID }, { gas: GAS_200 });
  console.log(`settle_round: ${txs.settle_round}`);
  roundNow = await poll(async () => contractView('get_round', { round_id: ROUND_ID }), (v) => v && v.settled, 'round 4 settled', 120000);
}
console.log('get_round after settle:', JSON.stringify(roundNow));
if (!roundNow.settled) throw new Error('round 4 did not settle');

// ---------- Step 6: verify — expected scores and payouts from the contract maths ----------
// Score: (sum over distinct givers of isqrt(effective_points * giver_standing))^2.
// Giver standing is the pre-settle standing; every giver here is a new
// member at 100. Effective points: mutual portion discounted 50% (floor)
// from BOTH directions, computed from a snapshot of the original points.
// Payouts: proportional to score, capped at 25% of the envelope, capped
// surplus redistributed water-filling style — replicated exactly from
// contract/src/lib.rs settle_round (integer division, truncation).
function isqrt(n) {
  if (n < 0n) throw new Error('isqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
function expectedModel() {
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
  for (const m of crewIds) {
    let rootSum = 0n;
    for (const [giver, allocs] of Object.entries(ALLOCATIONS)) {
      const pts = (eff[giver] && eff[giver][m]) || 0;
      if (pts > 0) rootSum += isqrt(BigInt(pts) * 100n);
    }
    scores[m] = rootSum * rootSum;
  }
  // Water-filling, exactly as the contract does it.
  const cap = ENVELOPE_YOCTO / 4n;
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0n);
  const uncapped = {};
  for (const m of crewIds) uncapped[m] = totalScore === 0n ? 0n : (scores[m] * ENVELOPE_YOCTO) / totalScore;
  const payouts = {};
  for (const m of crewIds) payouts[m] = 0n;
  if (totalScore > 0n) {
    let remaining = ENVELOPE_YOCTO;
    let active = crewIds.filter((m) => scores[m] > 0n);
    while (active.length > 0) {
      const tot = active.reduce((a, m) => a + scores[m], 0n);
      const over = active.filter((m) => (scores[m] * remaining) / tot > cap);
      if (over.length === 0) {
        for (const m of active) payouts[m] = (scores[m] * remaining) / tot;
        break;
      }
      for (const m of over) {
        payouts[m] = cap;
        active = active.filter((x) => x !== m);
        remaining -= cap;
      }
    }
  }
  return { scores, eff, uncapped, payouts, totalScore, cap };
}
const { scores: expected, eff, uncapped, payouts: expectedPayouts, totalScore, cap } = expectedModel();
console.log('expected scores:', JSON.stringify(Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v.toString()]))));
console.log('expected payouts:', JSON.stringify(Object.fromEntries(Object.entries(expectedPayouts).map(([k, v]) => [k, v.toString()]))));
const payouts = await contractView('get_payouts', { round_id: ROUND_ID });
const explanations = {};
let payoutSum = 0n;
const balancesAfter = {};
for (const m of crewIds) {
  const e = await contractView('explain_payout', { round_id: ROUND_ID, account_id: m });
  explanations[m] = e;
  if (BigInt(e.score) !== expected[m]) throw new Error(`score mismatch for ${m}: got ${e.score}, expected ${expected[m]}`);
  if (BigInt(e.payout_yocto) !== expectedPayouts[m]) throw new Error(`payout mismatch for ${m}: got ${e.payout_yocto}, expected ${expectedPayouts[m]}`);
  if (BigInt(e.uncapped_payout_yocto) !== uncapped[m]) throw new Error(`uncapped payout mismatch for ${m}: got ${e.uncapped_payout_yocto}, expected ${uncapped[m]}`);
  const p = BigInt(e.payout_yocto);
  if (p > cap) throw new Error(`payout for ${m} exceeds 25% cap`);
  payoutSum += p;
  balancesAfter[m] = await balance(m);
  const delta = BigInt(balancesAfter[m]) - BigInt(balancesBefore[m]);
  console.log(`${m}: score ${e.score}, payout ${Number(p) / 1e24} NEAR, capped ${e.cap_applied}, balance delta ${delta} yocto`);
  if (delta <= 0n && p > 0n) throw new Error(`balance did not rise for ${m}`);
  if (delta > p) throw new Error(`balance delta exceeds payout for ${m}`);
}
if (payoutSum > ENVELOPE_YOCTO) throw new Error('payout sum exceeds envelope');
console.log(`payout sum: ${payoutSum} yocto; remainder in contract: ${ENVELOPE_YOCTO - payoutSum} yocto`);
// The 12 existing members received no allocations and submitted nothing:
// their payouts must be exactly 0.
for (const m of [...DEMO_VOTERS, ...OLD_CREW]) {
  const e = await contractView('explain_payout', { round_id: ROUND_ID, account_id: m });
  if (BigInt(e.score) !== 0n || BigInt(e.payout_yocto) !== 0n) {
    throw new Error(`existing member ${m} unexpectedly scored/paid in round 4: ${JSON.stringify(e)}`);
  }
}

// ---------- Step 7: verify standings moved exactly per the rule ----------
const standingsAfter = {};
for (const m of ALL_MEMBERS) {
  standingsAfter[m] = await contractView('get_standing', { account_id: m });
  console.log(`standing ${m}: ${standingsBefore[m]} -> ${standingsAfter[m]} (expected ${EXPECTED_STANDING_AFTER[m]})`);
  if (standingsAfter[m] !== EXPECTED_STANDING_AFTER[m]) {
    throw new Error(`standing mismatch for ${m}: got ${standingsAfter[m]}, expected ${EXPECTED_STANDING_AFTER[m]}`);
  }
}

const daoBalanceAfter = BigInt(await balance(DAO_ID));
const log = {
  network: 'testnet',
  contract_id: CONTRACT_ID,
  owner_id: OWNER_ID,
  dao_id: DAO_ID,
  round_id: ROUND_ID,
  envelope_yocto: ENVELOPE_YOCTO.toString(),
  crew: CREW,
  allocations: ALLOCATIONS,
  effective_points: eff,
  expected_scores: Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, v.toString()])),
  expected_payouts_yocto: Object.fromEntries(Object.entries(expectedPayouts).map(([k, v]) => [k, v.toString()])),
  uncapped_payouts_yocto: Object.fromEntries(Object.entries(uncapped).map(([k, v]) => [k, v.toString()])),
  total_score: totalScore.toString(),
  cap_yocto: cap.toString(),
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
  dao_balance_after_yocto: daoBalanceAfter.toString(),
  demo_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('LIVE ROUND 4 OK: settled on testnet with a real crew via DAO proposals');
console.log('wrote demo-log-round4.json');
