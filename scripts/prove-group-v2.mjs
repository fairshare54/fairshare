// PROOF v2: create a self-serve FairShare group through the NEW flow —
// the registry deploys the round contract, so no browser key and no
// full-access grant is involved (Meteor blocks the old flow).
// Steps: (A) fresh creator account via faucet + top-up, (B) DAO through
// the Sputnik factory, (C) register in the registry (new contract id
// scheme), (D) deploy the round contract via the registry, (E) sync
// members, (F) fund round 1 by DAO proposal, (G) add 3 members, (H)
// allocate, (I) close + settle, (J) verify every payout against the
// contract maths, (K) negative check: the registry refuses to deploy
// prove-group's old-scheme contract. Testnet only. Uses ONLY accounts
// in .testnet-fairshare-accounts.json (the creator is created here and
// recorded there). Run: node scripts/prove-group-v2.mjs
// Writes prove-group-2-log.json (tx hashes, scores, payouts; NO keys).
// Resumable: every step first reads onchain state and skips work already done.
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const FACTORY_ID = 'sputnikv2.testnet';
const REGISTRY_ID = 'fairshare-registry.testnet';
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../prove-group-2-log.json', import.meta.url);

const GROUP_ID = 'prove-group-2';
const GROUP_NAME = 'Prove Group Two';
const TEMPLATE = 'cooperative';
const BADGE_URL = '';
const INVITE_CODE = 'prove-xyz789';
const DAO_ID = `${GROUP_ID}.${FACTORY_ID}`;
const CONTRACT_ID = `${GROUP_ID}-fairshare.${REGISTRY_ID}`;
const DAO_DEPOSIT_YOCTO = 10_500_000_000_000_000_000_000_000n; // 10.5 NEAR -> DAO treasury
const CONTRACT_FUND_YOCTO = 5_200_000_000_000_000_000_000_000n; // 5.2 NEAR -> contract, via the registry
const BOND_YOCTO = 1_000_000_000_000_000_000_000_000n; // 1 NEAR proposal bond
const ENVELOPE_YOCTO = 5_000_000_000_000_000_000_000_000n; // 5 NEAR round 1
const GAS_100 = 100_000_000_000_000n;
const GAS_150 = 150_000_000_000_000n;
const GAS_200 = 200_000_000_000_000n;

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
async function balance(accountId) {
  return BigInt((await (await near.account(accountId)).state()).amount);
}
async function accountExists(accountId) {
  try { await (await near.account(accountId)).state(); return true; } catch (_) { return false; }
}
async function view(contractId, method, args) {
  const a = await near.account(contractId);
  return a.viewFunction({ contractId, methodName: method, args });
}
async function call(signerId, contractId, method, args, { gas = GAS_100, deposit = 0n } = {}) {
  const signer = await near.account(signerId);
  const out = await signer.functionCall({ contractId, methodName: method, args, gas, attachedDeposit: deposit });
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

// ---------- Step A: creator account (faucet) + top-up ----------
// 10.5 (DAO) + 5.2 (contract) + 1 (register, mostly refunded) + 1 (bond,
// returned) = ~17.7 NEAR.
let creator = accounts['prove-creator-2'];
if (!creator) {
  const accountId = 'prove-creator-2.testnet';
  const kp = KeyPair.fromRandom('ed25519');
  creator = { accountId, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString() };
  accounts['prove-creator-2'] = creator;
  saveAccounts();
  await loadKey(creator);
  const res = await fetch(HELPER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.getPublicKey().toString() }) });
  console.log('faucet HTTP', res.status);
  if (!res.ok) throw new Error(`faucet rejected the new account (HTTP ${res.status}) — the helper rate-limits by IP; fund prove-creator-2.testnet from a demo account and rerun`);
  await poll(() => accountExists(accountId), (v) => v, `${accountId} onchain`, 180000);
  console.log(`creator ${accountId} funded by faucet`);
}
const creatorId = creator.accountId;
let creatorBal = await balance(creatorId);
console.log(`creator balance: ${Number(creatorBal) / 1e24} NEAR`);
let need = 2_000_000_000_000_000_000_000_000n; // ~2 NEAR for bonds + gas
if (!(await accountExists(DAO_ID))) need += DAO_DEPOSIT_YOCTO;
if (!(await accountExists(CONTRACT_ID))) need += CONTRACT_FUND_YOCTO;
if (creatorBal < need) {
  const shortfall = need - creatorBal;
  let remaining = shortfall;
  for (const donorId of ['bob-fairshare.testnet', 'carol-fairshare.testnet', 'emeka-fairshare.testnet', 'frank-fairshare.testnet', 'fatima-fairshare.testnet', 'ngozi-fairshare.testnet', 'erin-fairshare.testnet', 'tunde-fairshare.testnet']) {
    if (remaining <= 0n) break;
    const donorBal = await balance(donorId);
    const spare = donorBal - 200_000_000_000_000_000_000_000n; // keep 0.2 NEAR in the donor
    if (spare <= 0n) { console.log(`donor ${donorId} has no spare balance (${Number(donorBal) / 1e24} NEAR)`); continue; }
    const amount = spare < remaining ? spare : remaining;
    const donorAcct = await near.account(donorId);
    const topTx = await donorAcct.sendMoney(creatorId, amount);
    console.log(`topped creator up ${Number(amount) / 1e24} NEAR from ${donorId}: ${topTx.transaction.hash}`);
    txs[`topup_from_${donorId}`] = topTx.transaction.hash;
    remaining -= amount;
  }
  if (remaining > 0n) throw new Error(`creator is ${Number(remaining) / 1e24} NEAR short and no donor can cover it`);
  creatorBal = await balance(creatorId);
  console.log(`creator balance now: ${Number(creatorBal) / 1e24} NEAR`);
}

// ---------- Step B: DAO through the Sputnik factory ----------
if (!(await accountExists(DAO_ID))) {
  const daoArgs = { config: { name: GROUP_ID, purpose: `${GROUP_NAME} — a self-serve FairShare group (proof of the new registry-deploy flow)`, metadata: '' }, policy: [creatorId] };
  const argsB64 = Buffer.from(JSON.stringify(daoArgs)).toString('base64');
  txs.dao_create = await call(creatorId, FACTORY_ID, 'create', { name: GROUP_ID, args: argsB64 }, { gas: GAS_150, deposit: DAO_DEPOSIT_YOCTO });
  console.log(`DAO ${DAO_ID} created: ${txs.dao_create}`);
}
const policy = await poll(() => view(DAO_ID, 'get_policy', {}), (v) => Array.isArray(v?.roles), 'DAO policy', 120000);
const council = policy.roles.find((r) => r.name === 'council');
if (!(council?.kind?.Group || []).includes(creatorId)) throw new Error('DAO council does not include the creator');
console.log(`DAO balance: ${Number(await balance(DAO_ID)) / 1e24} NEAR`);

// ---------- Step C: register in the registry (new scheme) ----------
const existing = await view(REGISTRY_ID, 'get_group', { group_id: GROUP_ID });
if (!existing) {
  txs.register = await call(creatorId, REGISTRY_ID, 'register_group', {
    group_id: GROUP_ID, name: GROUP_NAME, template: TEMPLATE, badge_url: BADGE_URL,
    dao_id: DAO_ID, contract_id: CONTRACT_ID, creator: creatorId, invite_code: INVITE_CODE,
  }, { gas: GAS_100, deposit: 1_000_000_000_000_000_000_000_000n });
  console.log(`registered in ${REGISTRY_ID}: ${txs.register}`);
}
const group = await poll(() => view(REGISTRY_ID, 'get_group', { group_id: GROUP_ID }), (v) => v !== null, 'group in registry', 60000);
console.log('registry group:', JSON.stringify(group));
if (group.dao_id !== DAO_ID || group.contract_id !== CONTRACT_ID) throw new Error('registry record mismatch');
if (group.contract_id !== `${GROUP_ID}-fairshare.${REGISTRY_ID}`) throw new Error('registry record is not the new scheme');

// ---------- Step K (negative, run before the real deploy): the registry
// must refuse to deploy prove-group's old-scheme contract. ----------
try {
  await call('prove-creator.testnet', REGISTRY_ID, 'deploy_group_contract', { group_id: 'prove-group' }, { gas: GAS_150, deposit: CONTRACT_FUND_YOCTO });
  throw new Error('deploy_group_contract accepted prove-group — the old-scheme guard is broken');
} catch (e) {
  if (/old contract scheme/.test(String(e?.message || e))) {
    console.log('negative check OK: registry refused prove-group (old contract scheme)');
  } else if (/accepted prove-group/.test(String(e?.message || e))) throw e;
  else console.log('negative check: deploy for prove-group failed as expected:', String(e.message).slice(0, 160));
}

// ---------- Step D: deploy the round contract via the registry ----------
// One wallet call; the registry creates its own subaccount, deploys the
// embedded FairShare code and calls new(owner=creator, dao=DAO). No
// browser key, no full-access grant.
if (!(await accountExists(CONTRACT_ID))) {
  txs.contract_deploy = await call(creatorId, REGISTRY_ID, 'deploy_group_contract', { group_id: GROUP_ID }, { gas: GAS_150, deposit: CONTRACT_FUND_YOCTO });
  console.log(`contract deployed by the registry: ${txs.contract_deploy}`);
  await poll(() => accountExists(CONTRACT_ID), (v) => v, 'contract account onchain', 120000);
}
const params = await poll(() => view(CONTRACT_ID, 'get_params', {}), (v) => v && v.points_per_member === 100, 'contract params', 120000);
console.log('get_params:', JSON.stringify(params));
if (params.points_per_member !== 100 || params.cap_bps !== 2500) throw new Error('params mismatch');
const daoInfo = await view(CONTRACT_ID, 'get_dao_info', {});
console.log('get_dao_info:', JSON.stringify(daoInfo));
if (daoInfo.dao_id !== DAO_ID) throw new Error('dao_id mismatch');
// The round contract has no get_owner view; the owner is proven below,
// when close_round succeeds from the creator at standing 100 — only
// the owner (or a member at standing 150+) may close a round early.

// ---------- Step E: sync DAO members into the contract ----------
let members = await view(CONTRACT_ID, 'get_members', {});
if (!members.includes(creatorId)) {
  txs.sync = await call(creatorId, CONTRACT_ID, 'sync_dao_members', {}, { gas: GAS_100 });
  console.log(`sync_dao_members: ${txs.sync}`);
  members = await poll(() => view(CONTRACT_ID, 'get_members', {}), (v) => v.includes(creatorId), 'creator synced', 60000);
}
console.log('contract members:', members.join(', '));

// ---------- Step F: fund round 1 by DAO proposal ----------
let actStyle = 'new';
async function voteApprove(voterId, proposalId, kind) {
  const argsNew = { id: proposalId, action: 'VoteApprove', proposal: kind, memo: null };
  const argsOld = { id: proposalId, action: 'VoteApprove', memo: null };
  try {
    if (actStyle === 'new') return await call(voterId, DAO_ID, 'act_proposal', argsNew, { gas: GAS_150 });
    return await call(voterId, DAO_ID, 'act_proposal', argsOld, { gas: GAS_150 });
  } catch (e) {
    if (actStyle === 'new' && /argument|unknown|missing|deserialize|Invalid/i.test(String(e?.message || e))) {
      actStyle = 'old';
      return await call(voterId, DAO_ID, 'act_proposal', argsOld, { gas: GAS_150 });
    }
    throw e;
  }
}
let round1 = await view(CONTRACT_ID, 'get_round', { round_id: 1 });
if (!round1) {
  const argsB64 = Buffer.from(JSON.stringify({ round_id: 1, envelope_yocto: ENVELOPE_YOCTO.toString() })).toString('base64');
  const kind = { FunctionCall: { receiver_id: CONTRACT_ID, actions: [{ method_name: 'create_round', args: argsB64, deposit: ENVELOPE_YOCTO.toString(), gas: '100000000000000' }] } };
  const nextId = await view(DAO_ID, 'get_last_proposal_id', {});
  txs.fund_propose = await call(creatorId, DAO_ID, 'add_proposal', { proposal: { description: `Fund ${GROUP_NAME} round 1: 5 NEAR envelope via create_round`, kind } }, { gas: GAS_100, deposit: BOND_YOCTO });
  console.log(`fund proposal #${nextId}: ${txs.fund_propose}`);
  txs.fund_vote = await voteApprove(creatorId, nextId, kind);
  console.log(`creator voted (sole council member): ${txs.fund_vote}`);
  round1 = await poll(() => view(CONTRACT_ID, 'get_round', { round_id: 1 }), (r) => r !== null && r.envelope_yocto === ENVELOPE_YOCTO.toString(), 'round 1 created', 180000);
  console.log('round 1:', JSON.stringify(round1));
}

// ---------- Step G: add 3 members so allocation is possible ----------
const NEW_MEMBERS = ['bob-fairshare.testnet', 'carol-fairshare.testnet', 'dave-fairshare.testnet'];
for (const m of NEW_MEMBERS) {
  const pol = await view(DAO_ID, 'get_policy', {});
  const groupNow = pol.roles.find((r) => r.name === 'council')?.kind?.Group || [];
  if (groupNow.includes(m)) { console.log(`SKIP add ${m}: already on council`); continue; }
  const kind = { AddMemberToRole: { member_id: m, role: 'council' } };
  let proposalId;
  let proposeTx = null;
  const open = await view(DAO_ID, 'get_proposals', { from_index: 0, limit: 50 });
  const existingProp = (open || []).find((p) => p.status === 'InProgress' && p.kind?.AddMemberToRole?.member_id === m);
  if (existingProp) {
    proposalId = existingProp.id;
    console.log(`add ${m}: reusing open proposal #${proposalId}`);
  } else {
    proposalId = await view(DAO_ID, 'get_last_proposal_id', {});
    proposeTx = await call(creatorId, DAO_ID, 'add_proposal', { proposal: { description: `Add ${m} to the ${GROUP_NAME} council`, kind } }, { gas: GAS_100, deposit: BOND_YOCTO });
    console.log(`add ${m} proposal #${proposalId}: ${proposeTx}`);
  }
  const voted = {};
  const proposalsNow = await view(DAO_ID, 'get_proposals', { from_index: 0, limit: 50 });
  const mine = (proposalsNow || []).find((p) => p.id === proposalId);
  if (mine && mine.votes) Object.assign(voted, mine.votes);
  const councilNow = (await view(DAO_ID, 'get_policy', {})).roles.find((r) => r.name === 'council')?.kind?.Group || [];
  const voteTxs = [];
  for (const voter of councilNow) {
    if (voted[voter]) { console.log(`  ${voter} already voted`); continue; }
    const vt = await voteApprove(voter, proposalId, kind);
    voteTxs.push(vt);
    console.log(`  ${voter} voted: ${vt}`);
    const after = await view(DAO_ID, 'get_policy', {});
    if ((after.roles.find((r) => r.name === 'council')?.kind?.Group || []).includes(m)) break;
  }
  txs[`add_${m}`] = { proposal_id: proposalId, propose_tx: proposeTx, vote_tx: voteTxs };
  await poll(() => view(DAO_ID, 'get_policy', {}), (p) => (p.roles.find((r) => r.name === 'council')?.kind?.Group || []).includes(m), `${m} on council`, 120000);
  console.log(`  ${m} is on the council`);
}
txs.sync2 = await call(creatorId, CONTRACT_ID, 'sync_dao_members', {}, { gas: GAS_100 });
members = await poll(() => view(CONTRACT_ID, 'get_members', {}), (v) => v.length >= 4, '4 members synced', 60000);
console.log('contract members now:', members.join(', '));

// ---------- Step H: allocate (each member gives 100 points) ----------
const ALLOCATIONS = {
  [creatorId]: [
    { to: 'bob-fairshare.testnet', points: 40, reason: 'led the proof of the new group flow' },
    { to: 'carol-fairshare.testnet', points: 35, reason: 'checked every step against the chain' },
    { to: 'dave-fairshare.testnet', points: 25, reason: 'kept the records straight' },
  ],
  'bob-fairshare.testnet': [
    { to: creatorId, points: 40, reason: 'created the group and funded it' },
    { to: 'carol-fairshare.testnet', points: 35, reason: 'reviewed the round maths' },
    { to: 'dave-fairshare.testnet', points: 25, reason: 'tested the invite link' },
  ],
  'carol-fairshare.testnet': [
    { to: creatorId, points: 40, reason: 'paid for the DAO and the contract' },
    { to: 'bob-fairshare.testnet', points: 30, reason: 'wrote the round checklist' },
    { to: 'dave-fairshare.testnet', points: 30, reason: 'kept the members in the loop' },
  ],
  'dave-fairshare.testnet': [
    { to: creatorId, points: 40, reason: 'set up the group page' },
    { to: 'bob-fairshare.testnet', points: 30, reason: 'ran the first allocation' },
    { to: 'carol-fairshare.testnet', points: 30, reason: 'double checked the payouts' },
  ],
};
txs.allocate = txs.allocate || {};
for (const [giver, allocs] of Object.entries(ALLOCATIONS)) {
  const subs = await view(CONTRACT_ID, 'get_allocations', { round_id: 1 });
  if ((subs || []).some((s) => s.giver === giver)) { console.log(`SKIP allocate ${giver}: already submitted`); continue; }
  txs.allocate[giver] = await call(giver, CONTRACT_ID, 'allocate', { round_id: 1, allocations: allocs }, { gas: GAS_100 });
  console.log(`allocate ${giver}: ${txs.allocate[giver]}`);
}
await poll(() => view(CONTRACT_ID, 'get_allocations', { round_id: 1 }), (v) => Array.isArray(v) && v.length >= 4, '4 allocation submissions', 120000);

// ---------- Step I: close + settle ----------
let roundNow = await view(CONTRACT_ID, 'get_round', { round_id: 1 });
if (!roundNow.closed && !roundNow.settled) {
  txs.close_round = await call(creatorId, CONTRACT_ID, 'close_round', { round_id: 1 });
  console.log(`close_round: ${txs.close_round}`);
  roundNow = await poll(() => view(CONTRACT_ID, 'get_round', { round_id: 1 }), (v) => v && v.closed, 'round 1 closed', 120000);
}
if (!roundNow.settled) {
  txs.settle_round = await call(creatorId, CONTRACT_ID, 'settle_round', { round_id: 1 }, { gas: GAS_200 });
  console.log(`settle_round: ${txs.settle_round}`);
  roundNow = await poll(() => view(CONTRACT_ID, 'get_round', { round_id: 1 }), (v) => v && v.settled, 'round 1 settled', 120000);
}
console.log('round 1 after settle:', JSON.stringify(roundNow));
if (!roundNow.settled) throw new Error('round 1 did not settle');

// ---------- Step J: verify payouts ----------
function isqrt(n) {
  if (n < 0n) throw new Error('isqrt of negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
const ALL = [creatorId, ...NEW_MEMBERS];
const orig = {};
for (const [giver, allocs] of Object.entries(ALLOCATIONS)) { orig[giver] = {}; for (const a of allocs) orig[giver][a.to] = a.points; }
const eff = {};
for (const [giver, allocs] of Object.entries(ALLOCATIONS)) {
  eff[giver] = {};
  for (const a of allocs) {
    const rev = (orig[a.to] && orig[a.to][giver]) || 0;
    eff[giver][a.to] = a.points - Math.floor(Math.min(a.points, rev) / 2);
  }
}
const scores = {};
for (const m of ALL) {
  let rootSum = 0n;
  for (const giver of ALL) {
    const pts = (eff[giver] && eff[giver][m]) || 0;
    if (pts > 0) rootSum += isqrt(BigInt(pts) * 100n);
  }
  scores[m] = rootSum * rootSum;
}
const cap = ENVELOPE_YOCTO / 4n;
const totalScore = Object.values(scores).reduce((a, b) => a + b, 0n);
const payouts = {};
for (const m of ALL) payouts[m] = 0n;
if (totalScore > 0n) {
  let remaining = ENVELOPE_YOCTO;
  let active = ALL.filter((m) => scores[m] > 0n);
  while (active.length > 0) {
    const tot = active.reduce((a, m) => a + scores[m], 0n);
    const over = active.filter((m) => (scores[m] * remaining) / tot > cap);
    if (over.length === 0) { for (const m of active) payouts[m] = (scores[m] * remaining) / tot; break; }
    for (const m of over) { payouts[m] = cap; active = active.filter((x) => x !== m); remaining -= cap; }
  }
}
let payoutSum = 0n;
for (const m of ALL) {
  const e = await view(CONTRACT_ID, 'explain_payout', { round_id: 1, account_id: m });
  if (BigInt(e.score) !== scores[m]) throw new Error(`score mismatch ${m}: got ${e.score}, expected ${scores[m]}`);
  if (BigInt(e.payout_yocto) !== payouts[m]) throw new Error(`payout mismatch ${m}: got ${e.payout_yocto}, expected ${payouts[m]}`);
  payoutSum += BigInt(e.payout_yocto);
  console.log(`${m}: score ${e.score}, payout ${Number(BigInt(e.payout_yocto)) / 1e24} NEAR, capped ${e.cap_applied}`);
}
console.log(`payout sum: ${Number(payoutSum) / 1e24} NEAR; total score: ${totalScore}`);
const standings = {};
for (const m of ALL) standings[m] = await view(CONTRACT_ID, 'get_standing', { account_id: m });
console.log('standings after settle:', JSON.stringify(standings));
const daoBalAfter = await balance(DAO_ID);
const creatorBalAfter = await balance(creatorId);
const contractBalAfter = await balance(CONTRACT_ID);

const log = {
  network: 'testnet',
  group_id: GROUP_ID,
  group_name: GROUP_NAME,
  template: TEMPLATE,
  invite_code: INVITE_CODE,
  dao_id: DAO_ID,
  contract_id: CONTRACT_ID,
  creator: creatorId,
  registry_id: REGISTRY_ID,
  envelope_yocto: ENVELOPE_YOCTO.toString(),
  txs,
  round: roundNow,
  expected_scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v.toString()])),
  expected_payouts_yocto: Object.fromEntries(Object.entries(payouts).map(([k, v]) => [k, v.toString()])),
  total_score: totalScore.toString(),
  payout_sum_yocto: payoutSum.toString(),
  standings_after: standings,
  dao_balance_after_yocto: daoBalAfter.toString(),
  creator_balance_after_yocto: creatorBalAfter.toString(),
  contract_balance_after_yocto: contractBalAfter.toString(),
  group_page: `https://fairshare-pi.vercel.app/group?id=${GROUP_ID}&invite=${INVITE_CODE}`,
  proved_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('PROOF V2 OK: self-serve group created through the registry deploy, funded, allocated and settled on testnet');
console.log('wrote prove-group-2-log.json');
