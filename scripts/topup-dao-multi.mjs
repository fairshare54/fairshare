// Top up the FairShare DAO treasury, part 2 — MULTIPLE wallets.
// Creates THREE fresh accounts (topup1/2/3-fairshare.testnet) via the helper
// faucet (10 NEAR each), then sends 9.9 NEAR from each to
// fairshare-dao.testnet, keeping 0.1 NEAR back for gas.
// Context: a single top-up (topup-fairshare.testnet, 9.95 NEAR, tx
// 8grpQmxvcUpr7cVtz7wbS9FYkbnJkUjF6Rq6tuzidS7a) already took the DAO from
// 5.5 to 15.45 NEAR. These three add ~29.7 NEAR, leaving the DAO at
// ~45.15 NEAR — enough for several 5 NEAR rounds.
// Testnet only. Keys go ONLY in .testnet-fairshare-accounts.json (chmod 600,
// gitignored) — never printed.
// Run: node scripts/topup-dao-multi.mjs
// Writes demo-log-topup-multi.json (account ids, tx hashes, balances; NO keys).
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../demo-log-topup-multi.json', import.meta.url);

const DAO_ID = 'fairshare-dao.testnet';
const SEND_YOCTO = 9_900_000_000_000_000_000_000_000n; // 9.9 NEAR
const WALLETS = [
  { role: 'topup1', accountId: 'topup1-fairshare.testnet' },
  { role: 'topup2', accountId: 'topup2-fairshare.testnet' },
  { role: 'topup3', accountId: 'topup3-fairshare.testnet' },
];

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
    body: JSON.stringify({ jsonrpc: '2.0', id: 'topup-multi', method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: accountId } }),
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

const daoBefore = await balanceYocto(DAO_ID);
console.log(`DAO ${DAO_ID} balance before: ${daoBefore} yocto (${Number(daoBefore) / 1e24} NEAR)`);

const results = [];
let expectedDao = daoBefore;
for (const { role, accountId } of WALLETS) {
  if (accounts[role]?.accountId === accountId) {
    const check = await rpcViewAccount(accountId);
    if (!check.result) throw new Error(`${accountId} has a saved key but does not exist onchain — refusing to reuse`);
    console.log(`SKIP create ${accountId}: already created and key saved`);
  } else {
    const existing = await rpcViewAccount(accountId);
    if (existing.result) throw new Error(`${accountId} already exists onchain — its key is not recoverable here; pick a fresh name`);
    const kp = KeyPair.fromRandom('ed25519');
    accounts[role] = { accountId, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString() };
    saveAccounts(); // key on disk BEFORE any network call that depends on it
    await keyStore.setKey('testnet', accountId, kp);
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
  }
  await keyStore.setKey('testnet', accountId, KeyPair.fromString(accounts[role].privateKey));
  const before = await balanceYocto(accountId);
  console.log(`${accountId} balance before transfer: ${before} yocto (${Number(before) / 1e24} NEAR)`);
  const sender = await near.account(accountId);
  const out = await sender.sendMoney(DAO_ID, SEND_YOCTO);
  const tx = out.transaction.hash;
  console.log(`transfer ${Number(SEND_YOCTO) / 1e24} NEAR ${accountId} -> ${DAO_ID}: ${tx}`);
  expectedDao += SEND_YOCTO;
  const after = await balanceYocto(accountId);
  results.push({
    account_id: accountId,
    faucet_near: Number(before) / 1e24,
    sent_yocto: SEND_YOCTO.toString(),
    sent_near: Number(SEND_YOCTO) / 1e24,
    transfer_tx: tx,
    balance_after_yocto: after.toString(),
    balance_after_near: Number(after) / 1e24,
  });
  await sleep(1000);
}

const daoAfter = await poll(async () => balanceYocto(DAO_ID), (b) => b === expectedDao, 'DAO balance after', 120000);
console.log(`DAO balance after: ${daoAfter} yocto (${Number(daoAfter) / 1e24} NEAR)`);

const log = {
  network: 'testnet',
  dao_id: DAO_ID,
  faucet: 'helper.testnet.near.org (10 NEAR each)',
  wallets: results,
  total_sent_yocto: (SEND_YOCTO * BigInt(WALLETS.length)).toString(),
  total_sent_near: Number(SEND_YOCTO * BigInt(WALLETS.length)) / 1e24,
  dao_balance_before_yocto: daoBefore.toString(),
  dao_balance_after_yocto: daoAfter.toString(),
  dao_balance_before_near: Number(daoBefore) / 1e24,
  dao_balance_after_near: Number(daoAfter) / 1e24,
  demo_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('DAO MULTI TOP-UP OK: wrote demo-log-topup-multi.json');
