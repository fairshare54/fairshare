// Create the FairShare badge account via the NEAR testnet helper faucet.
// Funds 10 testnet NEAR. Key is written ONLY to
// .testnet-fairshare-accounts.json (chmod 600, gitignored) under role
// "badge", BEFORE any network call that depends on it. NEVER print or
// commit that file.
// Run once: node scripts/create-badge-account.mjs
import fs from 'node:fs';
import { KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const HELPER = 'https://helper.testnet.near.org/account';
const OUT = new URL('../.testnet-fairshare-accounts.json', import.meta.url);

const ROLE = 'badge';
const ACCOUNT_ID = 'fairshare-badge.testnet';

async function rpcView(accountId) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'fairshare-badge-check',
      method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

if (out[ROLE]?.accountId === ACCOUNT_ID) {
  const check = await rpcView(ACCOUNT_ID);
  if (check.result) {
    console.log(`SKIP ${ACCOUNT_ID}: already created and key saved`);
    process.exit(0);
  }
}
const existing = await rpcView(ACCOUNT_ID);
if (existing.result) {
  throw new Error(
    `${ACCOUNT_ID} already exists onchain (balance ${existing.result.amount}); pick a fresh name — its key is not recoverable from here`
  );
}

const keyPair = KeyPair.fromRandom('ed25519');
const publicKey = keyPair.getPublicKey().toString();
out[ROLE] = { accountId: ACCOUNT_ID, publicKey, privateKey: keyPair.toString() };
saveProgress(out);
console.log(`creating ${ACCOUNT_ID} with ${publicKey} ...`);
let lastText = '';
for (let attempt = 1; attempt <= 3; attempt++) {
  const res = await fetch(HELPER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newAccountId: ACCOUNT_ID, newAccountPublicKey: publicKey }),
  });
  lastText = await res.text();
  console.log(`helper HTTP ${res.status} (attempt ${attempt}): ${lastText.slice(0, 200)}`);
  if (res.ok) break;
  await sleep(5000);
}
const verified = await waitVerified(ACCOUNT_ID);
if (!verified) {
  throw new Error(`account ${ACCOUNT_ID} not verified onchain after 90s (helper said: ${lastText.slice(0, 200)}). Key is saved in .testnet-fairshare-accounts.json — retry verification before reusing the name.`);
}
console.log(`VERIFIED ${ACCOUNT_ID}: balance ${verified.amount} yoctoNEAR`);
console.log('wrote .testnet-fairshare-accounts.json (chmod 600)');
