// Top up the FairShare DAO treasury with testnet faucet NEAR.
// Creates ONE fresh account (topup-fairshare.testnet) via the helper faucet
// (10 NEAR), then sends 9.95 NEAR to fairshare-dao.testnet, keeping 0.05
// NEAR back for gas. DAO was 5.5 NEAR; after: ~15.45 NEAR, enough for a
// 5 NEAR round (needs ~11.5 NEAR total in the DAO).
// Testnet only. Key for the new account goes ONLY in
// .testnet-fairshare-accounts.json (chmod 600, gitignored) — never printed.
// Run: node scripts/topup-dao.mjs
// Writes demo-log-topup.json (account id, tx hash, before/after balances; NO keys).
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../demo-log-topup.json', import.meta.url);

const DAO_ID = 'fairshare-dao.testnet';
const TOPUP_ID = 'topup-fairshare.testnet';
const SEND_YOCTO = 9_950_000_000_000_000_000_000_000n; // 9.95 NEAR

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpcViewAccount(accountId) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'topup', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } }),
  });
  return res.json();
}
async function balanceYocto(accountId) {
  const v = await rpcViewAccount(accountId);
  if (!v.result) throw new Error(`no onchain account ${accountId}: ${JSON.stringify(v.error)}`);
  return BigInt(v.result.amount);
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

// ---------- Step 0: DAO balance before ----------
const daoBefore = await balanceYocto(DAO_ID);
console.log(`DAO ${DAO_ID} balance before: ${daoBefore} yocto (${Number(daoBefore) / 1e24} NEAR)`);

// ---------- Step 1: create the fresh top-up account via the helper faucet ----------
if (accounts.topup?.accountId === TOPUP_ID) {
  const check = await rpcViewAccount(TOPUP_ID);
  if (check.result) {
    console.log(`SKIP create ${TOPUP_ID}: already created and key saved`);
  } else {
    throw new Error(`${TOPUP_ID} has a saved key but does not exist onchain — refusing to reuse`);
  }
} else {
  const existing = await rpcViewAccount(TOPUP_ID);
  if (existing.result) throw new Error(`${TOPUP_ID} already exists onchain — its key is not recoverable here; pick a fresh name`);
  const kp = KeyPair.fromRandom('ed25519');
  accounts.topup = { accountId: TOPUP_ID, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString() };
  saveAccounts(); // key on disk BEFORE any network call that depends on it
  await keyStore.setKey('testnet', TOPUP_ID, kp);
  console.log(`creating ${TOPUP_ID} ...`);
  let lastText = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(HELPER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newAccountId: TOPUP_ID, newAccountPublicKey: kp.getPublicKey().toString() }),
    });
    lastText = await res.text();
    console.log(`helper HTTP ${res.status} (attempt ${attempt}): ${lastText.slice(0, 200)}`);
    if (res.ok) break;
    await sleep(5000);
  }
  const verified = await poll(async () => (await rpcViewAccount(TOPUP_ID)).result || null, (v) => v !== null, `${TOPUP_ID} onchain`, 90000);
  console.log(`VERIFIED ${TOPUP_ID}: balance ${verified.amount} yoctoNEAR`);
}
await keyStore.setKey('testnet', TOPUP_ID, KeyPair.fromString(accounts.topup.privateKey));
const topupBefore = await balanceYocto(TOPUP_ID);
console.log(`${TOPUP_ID} balance before transfer: ${topupBefore} yocto (${Number(topupBefore) / 1e24} NEAR)`);

// ---------- Step 2: send 9.95 NEAR to the DAO ----------
const sender = await near.account(TOPUP_ID);
const out = await sender.sendMoney(DAO_ID, SEND_YOCTO);
const transferTx = out.transaction.hash;
console.log(`transfer ${Number(SEND_YOCTO) / 1e24} NEAR ${TOPUP_ID} -> ${DAO_ID}: ${transferTx}`);

// ---------- Step 3: verify DAO balance after ----------
const daoAfter = await poll(async () => balanceYocto(DAO_ID), (b) => b === daoBefore + SEND_YOCTO, 'DAO balance after', 120000);
const topupAfter = await balanceYocto(TOPUP_ID);
console.log(`DAO balance after: ${daoAfter} yocto (${Number(daoAfter) / 1e24} NEAR)`);
console.log(`${TOPUP_ID} balance after: ${topupAfter} yocto (${Number(topupAfter) / 1e24} NEAR)`);

const log = {
  network: 'testnet',
  dao_id: DAO_ID,
  topup_account_id: TOPUP_ID,
  faucet: 'helper.testnet.near.org (10 NEAR)',
  sent_yocto: SEND_YOCTO.toString(),
  sent_near: Number(SEND_YOCTO) / 1e24,
  transfer_tx: transferTx,
  dao_balance_before_yocto: daoBefore.toString(),
  dao_balance_after_yocto: daoAfter.toString(),
  dao_balance_before_near: Number(daoBefore) / 1e24,
  dao_balance_after_near: Number(daoAfter) / 1e24,
  topup_balance_after_yocto: topupAfter.toString(),
  topup_balance_after_near: Number(topupAfter) / 1e24,
  demo_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('DAO TOP-UP OK: wrote demo-log-topup.json');
