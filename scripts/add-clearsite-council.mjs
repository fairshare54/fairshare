// Add clearsite587.testnet (Isaiah's own testnet account, his phone wallet)
// to the fairshare-dao.testnet council by REAL Sputnik proposal, then sync
// into the FairShare contract. One proposal, owner proposes, council votes
// (strict majority: 10 of 18), sync, verify. Testnet only.
// Run: node scripts/add-clearsite-council.mjs
// Writes demo-log-add-clearsite.json (tx hashes; NO keys).
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../demo-log-add-clearsite.json', import.meta.url);

const DAO_ID = 'fairshare-dao.testnet';
const CONTRACT_ID = 'fairshare-contract.testnet';
const OWNER_ID = 'fairshare-owner.testnet';
const NEW_MEMBER = 'clearsite587.testnet';
const BOND_YOCTO = 1_000_000_000_000_000_000_000_000n; // 1 NEAR proposal bond
const GAS_100 = 100_000_000_000_000n;
const GAS_150 = 150_000_000_000_000n;

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const keyStore = new keyStores.InMemoryKeyStore();
const near = await connect({
  networkId: 'testnet',
  nodeUrl: RPC,
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore,
});
for (const a of Object.values(accounts)) if (a?.privateKey) await keyStore.setKey('testnet', a.accountId, KeyPair.fromString(a.privateKey));

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
async function councilGroup() {
  const pol = await daoView('get_policy', {});
  return pol.roles.find((r) => r.name === 'council')?.kind?.Group || [];
}

const txs = {};
let existingLog = {};
try { existingLog = JSON.parse(fs.readFileSync(OUT, 'utf8')); Object.assign(txs, existingLog.txs || {}); } catch { /* fresh */ }
function saveLog(extra) {
  fs.writeFileSync(OUT, JSON.stringify({ member: NEW_MEMBER, ...extra, txs }, null, 2) + '\n');
}

// ---------- Step 0: pre-checks ----------
const group0 = await councilGroup();
console.log(`council before: ${group0.length} members`);
if (group0.includes(NEW_MEMBER)) console.log(`${NEW_MEMBER} already on council — skipping proposal`);
const members0 = await contractView('get_members', {});
console.log(`contract members before: ${members0.length}`);

// ---------- Step 1: propose AddMemberToRole ----------
const kind = { AddMemberToRole: { member_id: NEW_MEMBER, role: 'council' } };
const description = `Add ${NEW_MEMBER} to the FairShare council (Isaiah's account)`;
let proposalId;
let proposeTx = txs.propose_tx || null;
if (!group0.includes(NEW_MEMBER)) {
  const existing = await daoView('get_proposals', { from_index: 0, limit: 50 });
  const resumed = (existing || []).find((p) => p.description === description && p.status === 'InProgress');
  if (resumed) {
    console.log(`resuming existing proposal #${resumed.id}`);
    proposalId = resumed.id;
  } else {
    const ownerAvail = BigInt(await balance(OWNER_ID));
    if (ownerAvail < BOND_YOCTO + 100_000_000_000_000_000_000_000n) throw new Error(`owner balance too low for bond: ${ownerAvail}`);
    proposalId = await daoView('get_last_proposal_id', {});
    proposeTx = await daoCall(OWNER_ID, 'add_proposal', { proposal: { description, kind } }, { gas: GAS_100, deposit: BOND_YOCTO });
    console.log(`proposed #${proposalId}: ${proposeTx}`);
    txs.propose_tx = proposeTx;
    saveLog({ proposal_id: proposalId });
  }
  // ---------- Step 2: vote until Approved (strict majority: floor(N/2)+1) ----------
  const ALL_VOTERS = [
    'alice-fairshare.testnet', 'bob-fairshare.testnet', 'carol-fairshare.testnet',
    'dave-fairshare.testnet', 'erin-fairshare.testnet', 'frank-fairshare.testnet',
    'ada-fairshare.testnet', 'emeka-fairshare.testnet', 'fatima-fairshare.testnet',
    'ibrahim-fairshare.testnet', 'ngozi-fairshare.testnet', 'tunde-fairshare.testnet',
    'chidi-fairshare.testnet', 'amara-fairshare.testnet', 'segun-fairshare.testnet',
    'kemi-fairshare.testnet', 'tobi-fairshare.testnet', 'zainab-fairshare.testnet',
  ];
  const votes = txs.votes || [];
  const council = await councilGroup();
  const voters = ALL_VOTERS.filter((v) => council.includes(v));
  const needed = Math.floor(council.length / 2) + 1;
  console.log(`council ${council.length}, strict majority needs ${needed} approvals`);
  for (const voter of voters) {
    const p = await daoView('get_proposal', { id: proposalId });
    if (p.status === 'Approved') break;
    if (p.status !== 'InProgress') throw new Error(`proposal #${proposalId} in unexpected status ${p.status}`);
    if (p.votes && p.votes[voter]) { if (!votes.find((v) => v.voter === voter)) votes.push({ voter, tx: '(already voted)' }); continue; }
    const voteTx = await daoCall(voter, 'act_proposal', { id: proposalId, action: 'VoteApprove', proposal: kind, memo: null }, { gas: GAS_150 });
    votes.push({ voter, tx: voteTx });
    console.log(`  ${voter} VoteApprove #${proposalId}: ${voteTx}`);
    txs.votes = votes;
    saveLog({ proposal_id: proposalId });
    const after = await daoView('get_proposal', { id: proposalId });
    if (after.status === 'Approved') { console.log(`  proposal #${proposalId} APPROVED and executed`); break; }
  }
  const final = await poll(async () => daoView('get_proposal', { id: proposalId }),
    (p) => p.status === 'Approved' || p.status === 'Failed', `proposal #${proposalId} final`, 120000);
  if (final.status === 'Failed') throw new Error(`proposal #${proposalId} FAILED on execution`);
  console.log(`proposal #${proposalId} final status: ${final.status}, vote_counts: ${JSON.stringify(final.vote_counts)}`);
  await poll(councilGroup, (g) => g.includes(NEW_MEMBER), `${NEW_MEMBER} on council`, 120000);
  console.log(`${NEW_MEMBER} is now on the DAO council (proposal #${proposalId})`);
  txs.proposal_id = proposalId;
  saveLog({ proposal_id: proposalId });
} else {
  // Already on council: find the proposal that added it, if any.
  const existing = await daoView('get_proposals', { from_index: 0, limit: 50 });
  const found = (existing || []).find((p) => p.description === description);
  proposalId = found ? found.id : null;
  txs.proposal_id = proposalId;
}

// ---------- Step 3: sync DAO members into the contract ----------
const membersBefore = await contractView('get_members', {});
if (!membersBefore.includes(NEW_MEMBER)) {
  const syncTx = await contractCall(OWNER_ID, 'sync_dao_members', {}, { gas: GAS_100 });
  txs.sync_dao_members = syncTx;
  console.log(`sync_dao_members: ${syncTx}`);
  await poll(async () => contractView('get_members', {}),
    (m) => Array.isArray(m) && m.includes(NEW_MEMBER), `${NEW_MEMBER} in contract members`, 120000);
} else {
  console.log(`${NEW_MEMBER} already in contract members — skipping sync`);
}
const membersAfter = await contractView('get_members', {});
console.log(`contract members after: ${membersAfter.length}: ${membersAfter.join(', ')}`);
if (!membersAfter.includes(NEW_MEMBER)) throw new Error(`${NEW_MEMBER} missing from contract members after sync`);
const standing = await contractView('get_standing', { account_id: NEW_MEMBER });
console.log(`${NEW_MEMBER} standing: ${standing}`);
if (standing !== 100) throw new Error(`expected standing 100, got ${standing}`);
const daoInfo = await contractView('get_dao_info', {});
console.log('get_dao_info:', JSON.stringify(daoInfo));

saveLog({ proposal_id: proposalId, member_count: membersAfter.length, standing });
console.log('DONE: clearsite587.testnet is a DAO council member and a contract member with standing 100 — it can allocate in round 5.');
