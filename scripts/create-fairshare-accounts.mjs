// Create the fresh FairShare testnet accounts via the NEAR testnet helper faucet.
// No other project's wallets, keys, or funds are involved: the helper funds
// each new account with 10 testnet NEAR.
// Run once: node scripts/create-fairshare-accounts.mjs
// Keys are written ONLY to .testnet-fairshare-accounts.json (chmod 600, gitignored).
// NEVER print or commit that file.
// The old Egbe demo accounts (alice-egbe.testnet etc.) are NOT reused: the
// project was renamed FairShare, so the demo members get fresh -fairshare
// accounts. The old file .testnet-accounts.json is left untouched as the
// record of the Egbe deployment.
import fs from 'node:fs';
import { KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const OUT = new URL('../.testnet-fairshare-accounts.json', import.meta.url);

const ACCOUNTS = [
  { role: 'contract', accountId: 'fairshare-contract.testnet' },
  { role: 'owner', accountId: 'fairshare-owner.testnet' },
  { role: 'dao', accountId: 'fairshare-dao.testnet' },
  { role: 'alice', accountId: 'alice-fairshare.testnet' },
  { role: 'bob', accountId: 'bob-fairshare.testnet' },
  { role: 'carol', accountId: 'carol-fairshare.testnet' },
  { role: 'dave', accountId: 'dave-fairshare.testnet' },
  { role: 'erin', accountId: 'erin-fairshare.testnet' },
  { role: 'frank', accountId: 'frank-fairshare.testnet' },
];

async function rpcView(accountId) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'fairshare-check',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Persist one account's keypair to disk BEFORE any network call that
// depends on it, so a crash can never lose a key for a live account.
function saveProgress(out) {
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
}

async function waitVerified(accountId, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const check = await rpcView(accountId);
    if (check.result) return check.result;
    await sleep(5000);
  }
  return null;
}

const out = {};
try {
  Object.assign(out, JSON.parse(fs.readFileSync(OUT, 'utf8')));
} catch {
  // fresh file
}
for (const { role, accountId } of ACCOUNTS) {
  if (out[role]?.accountId === accountId) {
    const check = await rpcView(accountId);
    if (check.result) {
      console.log(`SKIP ${accountId}: already created and key saved`);
      continue;
    }
  }
  const existing = await rpcView(accountId);
  if (existing.result) {
    throw new Error(
      `${accountId} already exists onchain (balance ${existing.result.amount}); pick a fresh name — its key is not recoverable from here`
    );
  }
  const keyPair = KeyPair.fromRandom('ed25519');
  const publicKey = keyPair.getPublicKey().toString();
  out[role] = { accountId, publicKey, privateKey: keyPair.toString() };
  saveProgress(out);
  console.log(`creating ${accountId} with ${publicKey} ...`);
  let lastText = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(HELPER, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
    });
    lastText = await res.text();
    console.log(`helper HTTP ${res.status} (attempt ${attempt}): ${lastText.slice(0, 200)}`);
    if (res.ok) break;
    await sleep(5000);
  }
  const verified = await waitVerified(accountId);
  if (!verified) {
    throw new Error(`account ${accountId} not verified onchain after 90s (helper said: ${lastText.slice(0, 200)}). Key is saved in .testnet-fairshare-accounts.json — retry verification before reusing the name.`);
  }
  console.log(`VERIFIED ${accountId}: balance ${verified.amount} yoctoNEAR`);
  await sleep(1000);
}

saveProgress(out);
console.log('wrote .testnet-fairshare-accounts.json (chmod 600)');
