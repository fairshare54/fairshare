// Create the FairShare registry account on NEAR testnet via the helper faucet.
// Uses the same pattern as the other FairShare accounts: key generated first,
// saved to .testnet-fairshare-accounts.json (chmod 600, gitignored), then the
// helper faucet creates the account. Run: node scripts/create-registry-account.mjs
// Writes nothing else. NO keys are printed.
import fs from 'node:fs';
import { KeyPair } from 'near-api-js';
const HELPER = 'https://helper.testnet.near.org/account';
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const accountId = 'fairshare-registry.testnet';
if (accounts.registry?.accountId === accountId) { console.log('already in file'); process.exit(0); }
const kp = KeyPair.fromRandom('ed25519');
accounts.registry = { accountId, publicKey: kp.getPublicKey().toString(), privateKey: kp.toString() };
fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 });
console.log('key saved, creating', accountId);
const res = await fetch(HELPER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: kp.getPublicKey().toString() }) });
console.log('helper HTTP', res.status, (await res.text()).slice(0, 200));
