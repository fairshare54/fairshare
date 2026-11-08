// Live demo round on NEAR testnet for the FairShare round contract
// (DAO membership version).
// Uses ONLY the fresh FairShare demo accounts in .testnet-fairshare-accounts.json.
// Flow: sync members from the Sputnik DAO council (sync_dao_members, a live
// cross-contract get_policy read — no add_member seeding) -> owner creates
// round 1 with a 5 NEAR envelope -> each member allocates (the
// worked-example allocations from the contract tests) -> owner closes the
// round -> owner settles it -> verify scores/payouts via views and record
// member balances.
// Resumable: every step first reads onchain state and skips work that is
// already done; views are polled until the new state is visible, because
// the fastnear RPC can lag finality by a few seconds.
// Run: node scripts/demo-round.mjs
// Writes demo-log.json (tx hashes, scores, payouts, balances; NO keys).
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../demo-log.json', import.meta.url);
const CONTRACT_ID = 'fairshare-contract.testnet';
const OWNER_ID = 'fairshare-owner.testnet';
const DAO_ID = 'fairshare-dao.testnet';
const ROUND_ID = 1;
const ENVELOPE_YOCTO = 5_000_000_000_000_000_000_000_000n; // 5 NEAR

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const members = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map((r) => accounts[r]);
if (members.some((m) => !m)) throw new Error('demo member accounts missing');

const keyStore = new keyStores.InMemoryKeyStore();
for (const a of [accounts.owner, ...members]) {
  await keyStore.setKey('testnet', a.accountId, KeyPair.fromString(a.privateKey));
}
const near = await connect({
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.fastnear.com',
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore,
});
const owner = await near.account(OWNER_ID);
const contract = await near.account(CONTRACT_ID);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function balance(accountId) {
  const a = await near.account(accountId);
  return (await a.state()).amount;
}
async function call(signer, methodName, args, { gas = 100_000_000_000_000n, deposit = 0n } = {}) {
  const outcome = await signer.functionCall({
    contractId: CONTRACT_ID,
    methodName,
    args,
    gas,
    attachedDeposit: deposit,
  });
  return outcome.transaction.hash;
}
async function view(methodName, args) {
  return contract.viewFunction({ contractId: CONTRACT_ID, methodName, args });
}
// Poll a view until `pred` holds (fastnear can lag finality a few seconds).
async function viewPoll(methodName, args, pred, label, timeoutMs = 90000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await view(methodName, args);
    if (pred(last)) return last;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${label}; last view: ${JSON.stringify(last)}`);
}

const txs = {};
let existingLog = {};
try {
  existingLog = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  Object.assign(txs, existingLog.txs || {});
} catch {
  // fresh run
}
const balancesBefore = {};
for (const m of members) balancesBefore[m.accountId] = await balance(m.accountId);
const contractBefore = await balance(CONTRACT_ID);
const ownerBefore = await balance(OWNER_ID);

// 1. Sync members from the DAO council — the production membership path.
//    This is a live cross-contract get_policy read on fairshare-dao.testnet;
//    no add_member seeding is used. Resumable: if 6 members are already
//    synced, skip the call.
const daoInfo0 = await view('get_dao_info', {});
console.log('get_dao_info before sync:', JSON.stringify(daoInfo0));
if (daoInfo0.member_count !== 6) {
  txs.sync_dao_members = await call(owner, 'sync_dao_members', {}, { gas: 100_000_000_000_000n });
  console.log(`sync_dao_members: ${txs.sync_dao_members}`);
  await viewPoll(
    'get_dao_info',
    {},
    (v) => v && v.member_count === 6,
    '6 members synced from DAO'
  );
} else {
  console.log('sync_dao_members: 6 members already synced, skipped');
}
const daoInfo = await view('get_dao_info', {});
console.log('get_dao_info after sync:', JSON.stringify(daoInfo));
if (daoInfo.dao_id !== DAO_ID) throw new Error('dao_id mismatch after sync');
if (daoInfo.last_sync_ns === 0) throw new Error('last_sync_ns is 0 — sync did not run');
const currentMembers = await viewPoll(
  'get_members',
  {},
  (v) => Array.isArray(v) && v.length === 6,
  '6 members'
);
for (const m of members) {
  if (!currentMembers.includes(m.accountId)) throw new Error(`${m.accountId} missing after DAO sync`);
  const role = await view('get_cached_dao_role', { account_id: m.accountId });
  if (!role.is_member) throw new Error(`${m.accountId} not a member in cached DAO role`);
}
console.log('members synced from DAO council:', currentMembers.join(', '));

// 1b. Live one-off role check via get_dao_role (change call, cross-contract
//     get_policy, result cached): alice must be a member, a stranger not.
txs.get_dao_role_alice = await call(owner, 'get_dao_role', { account_id: members[0].accountId });
console.log(`get_dao_role(alice): ${txs.get_dao_role_alice}`);
const aliceRole = await viewPoll(
  'get_cached_dao_role',
  { account_id: members[0].accountId },
  (v) => v && v.live_check === true,
  'alice live_check true'
);
console.log('alice live_check:', JSON.stringify(aliceRole.live_check));

// 2. Owner creates round 1 with a 5 NEAR envelope (skip if it exists).
let round0 = await view('get_round', { round_id: ROUND_ID });
if (!round0) {
  txs.create_round = await call(owner, 'create_round', {
    round_id: ROUND_ID,
    envelope_yocto: ENVELOPE_YOCTO.toString(),
  }, { deposit: ENVELOPE_YOCTO });
  console.log(`create_round: ${txs.create_round}`);
  round0 = await viewPoll(
    'get_round',
    { round_id: ROUND_ID },
    (v) => v !== null && v.envelope_yocto === ENVELOPE_YOCTO.toString(),
    'round 1 created'
  );
} else {
  console.log(`create_round: round 1 already exists (tx ${txs.create_round || 'from earlier run'}), skipped`);
}
console.log('get_round after create:', JSON.stringify(round0));

// 3. Each member allocates (worked-example allocations from the tests).
const ALLOCATIONS = {
  'alice-fairshare.testnet': [
    { to: 'dave-fairshare.testnet', points: 66, reason: 'ran the demo session' },
    { to: 'carol-fairshare.testnet', points: 26, reason: 'reviewed the round notes' },
    { to: 'bob-fairshare.testnet', points: 8, reason: 'answered my question' },
  ],
  'bob-fairshare.testnet': [
    { to: 'frank-fairshare.testnet', points: 75, reason: 'shipped the fix' },
    { to: 'carol-fairshare.testnet', points: 13, reason: 'helped debug' },
    { to: 'dave-fairshare.testnet', points: 4, reason: 'shared notes' },
    { to: 'alice-fairshare.testnet', points: 8, reason: 'paired with me' },
  ],
  'carol-fairshare.testnet': [
    { to: 'alice-fairshare.testnet', points: 18, reason: 'wrote the spec' },
    { to: 'frank-fairshare.testnet', points: 64, reason: 'built the prototype' },
    { to: 'erin-fairshare.testnet', points: 18, reason: 'tested the flow' },
  ],
  'dave-fairshare.testnet': [
    { to: 'alice-fairshare.testnet', points: 7, reason: 'reviewed my code' },
    { to: 'erin-fairshare.testnet', points: 65, reason: 'mentored me' },
    { to: 'bob-fairshare.testnet', points: 28, reason: 'co-wrote the doc' },
  ],
  'erin-fairshare.testnet': [
    { to: 'frank-fairshare.testnet', points: 1, reason: 'quick tip' },
    { to: 'bob-fairshare.testnet', points: 33, reason: 'designed the UI' },
    { to: 'dave-fairshare.testnet', points: 66, reason: 'led the round' },
  ],
  'frank-fairshare.testnet': [
    { to: 'alice-fairshare.testnet', points: 61, reason: 'organised everything' },
    { to: 'erin-fairshare.testnet', points: 34, reason: 'gave feedback' },
    { to: 'carol-fairshare.testnet', points: 1, reason: 'fixed a typo' },
    { to: 'dave-fairshare.testnet', points: 4, reason: 'shared a link' },
  ],
};
txs.allocate = txs.allocate || {};
for (const m of members) {
  const signer = await near.account(m.accountId);
  txs.allocate[m.accountId] = await call(signer, 'allocate', {
    round_id: ROUND_ID,
    allocations: ALLOCATIONS[m.accountId],
  });
  console.log(`allocate ${m.accountId}: ${txs.allocate[m.accountId]}`);
}
await viewPoll(
  'get_allocations',
  { round_id: ROUND_ID },
  (v) => Array.isArray(v) && v.length === 6,
  '6 allocation submissions'
);

// 4. Owner closes the round (instead of waiting 7 days).
let roundNow = await view('get_round', { round_id: ROUND_ID });
if (!roundNow.closed && !roundNow.settled) {
  txs.close_round = await call(owner, 'close_round', { round_id: ROUND_ID });
  console.log(`close_round: ${txs.close_round}`);
  roundNow = await viewPoll(
    'get_round',
    { round_id: ROUND_ID },
    (v) => v && v.closed,
    'round 1 closed'
  );
} else {
  console.log(`close_round: already closed/settled, skipped`);
}

// 5. Settle.
if (!roundNow.settled) {
  txs.settle_round = await call(owner, 'settle_round', { round_id: ROUND_ID }, { gas: 200_000_000_000_000n });
  console.log(`settle_round: ${txs.settle_round}`);
  roundNow = await viewPoll(
    'get_round',
    { round_id: ROUND_ID },
    (v) => v && v.settled,
    'round 1 settled'
  );
} else {
  console.log(`settle_round: already settled, skipped`);
}

// 6. Verify.
const round = roundNow;
console.log('get_round after settle:', JSON.stringify(round));
if (!round.settled) throw new Error('round did not settle');
const payouts = await view('get_payouts', { round_id: ROUND_ID });
const expectedScores = {
  'alice-fairshare.testnet': 21904,
  'bob-fairshare.testnet': 16129,
  'carol-fairshare.testnet': 7569,
  'dave-fairshare.testnet': 29241,
  'erin-fairshare.testnet': 24649,
  'frank-fairshare.testnet': 30976,
};
const explanations = {};
let payoutSum = 0n;
for (const m of members) {
  const e = await view('explain_payout', { round_id: ROUND_ID, account_id: m.accountId });
  explanations[m.accountId] = e;
  if (e.score !== expectedScores[m.accountId]) {
    throw new Error(`score mismatch for ${m.accountId}: got ${e.score}, expected ${expectedScores[m.accountId]}`);
  }
  const p = BigInt(e.payout_yocto);
  if (p > ENVELOPE_YOCTO / 4n) throw new Error(`payout for ${m.accountId} exceeds 25% cap`);
  payoutSum += p;
  console.log(`${m.accountId}: score ${e.score}, payout ${e.payout_yocto} yocto (${Number(p) / 1e24} NEAR)`);
}
if (payoutSum > ENVELOPE_YOCTO) throw new Error('payout sum exceeds envelope');
console.log(`payout sum: ${payoutSum} yocto; remainder in contract: ${ENVELOPE_YOCTO - payoutSum} yocto`);

const balancesAfter = {};
for (const m of members) balancesAfter[m.accountId] = await balance(m.accountId);
const contractAfter = await balance(CONTRACT_ID);
const ownerAfter = await balance(OWNER_ID);

const log = {
  network: 'testnet',
  contract_id: CONTRACT_ID,
  owner_id: OWNER_ID,
  dao_id: DAO_ID,
  round_id: ROUND_ID,
  envelope_yocto: ENVELOPE_YOCTO.toString(),
  txs,
  round,
  payouts,
  explanations,
  balances_before_yocto: { ...balancesBefore, contract: contractBefore, owner: ownerBefore },
  balances_after_yocto: { ...balancesAfter, contract: contractAfter, owner: ownerAfter },
  payout_sum_yocto: payoutSum.toString(),
  remainder_yocto: (ENVELOPE_YOCTO - payoutSum).toString(),
  demo_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('DEMO ROUND OK: round 1 settled on testnet (DAO membership)');
console.log('wrote demo-log.json');
