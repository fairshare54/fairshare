// Migrate the FairShare round contract IN PLACE to the reputation-rule build.
// Deploys the new WASM to fairshare-contract.testnet WITHOUT calling new():
// the state struct is unchanged (the standing map already existed), so the
// existing state — 12 members, rounds 1 and 2 settled, payout history,
// ownership units — survives the code upgrade. Calling new() again would
// fail (already initialized) and must never be done here.
// Then verifies: get_params shows the reputation rule, members still 12,
// rounds 1 and 2 still settled with unchanged total payouts.
// Run: node scripts/migrate.mjs
// Writes migrate-log.json (tx hash + verified state; NO keys).
// Testnet only. Uses ONLY the contract key in .testnet-fairshare-accounts.json.
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const WASM = new URL('../fairshare_round.wasm', import.meta.url);
const OUT = new URL('../migrate-log.json', import.meta.url);

const CONTRACT_ID = 'fairshare-contract.testnet';

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const contract = accounts.contract;
if (!contract || contract.accountId !== CONTRACT_ID) {
  throw new Error('contract account missing in .testnet-fairshare-accounts.json');
}

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', contract.accountId, KeyPair.fromString(contract.privateKey));

const near = await connect({
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.fastnear.com',
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore,
});
const account = await near.account(contract.accountId);

// State BEFORE the code swap, to compare afterwards.
const before = {
  params: await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_params', args: {} }),
  members: await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_members', args: {} }),
  round1: await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_round', args: { round_id: 1 } }),
  round2: await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_round', args: { round_id: 2 } }),
};
console.log('BEFORE params:', JSON.stringify(before.params));
console.log('BEFORE members:', before.members.length, before.members.join(', '));
console.log('BEFORE round1 settled:', before.round1.settled, 'total:', before.round1.total_payout_yocto);
console.log('BEFORE round2 settled:', before.round2.settled, 'total:', before.round2.total_payout_yocto);
const standingsBefore = {};
for (const m of before.members) {
  standingsBefore[m] = await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_standing', args: { account_id: m } });
}
console.log('BEFORE standings:', JSON.stringify(standingsBefore));

const wasm = fs.readFileSync(WASM);
console.log(`deploying ${wasm.length} bytes to ${CONTRACT_ID} (code only, no init) ...`);
const deployOutcome = await account.deployContract(wasm);
console.log('migrate (deploy) tx:', deployOutcome.transaction.hash);

// State AFTER the code swap.
const after = {
  params: await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_params', args: {} }),
  members: await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_members', args: {} }),
  round1: await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_round', args: { round_id: 1 } }),
  round2: await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_round', args: { round_id: 2 } }),
};
console.log('AFTER params:', JSON.stringify(after.params));
console.log('AFTER members:', after.members.length);
console.log('AFTER round1 settled:', after.round1.settled, 'total:', after.round1.total_payout_yocto);
console.log('AFTER round2 settled:', after.round2.settled, 'total:', after.round2.total_payout_yocto);

if (after.params.standing_gain_per_giver !== 2) throw new Error('reputation rule missing: standing_gain_per_giver');
if (after.params.standing_gain_cap_per_round !== 10) throw new Error('reputation rule missing: standing_gain_cap_per_round');
if (after.params.standing_no_alloc_penalty !== 5) throw new Error('reputation rule missing: standing_no_alloc_penalty');
if (after.params.standing_floor !== 50) throw new Error('reputation rule missing: standing_floor');
if (after.params.standing_cap !== 200) throw new Error('reputation rule missing: standing_cap');
if (after.params.propose_min_standing !== 100) throw new Error('reputation rule missing: propose_min_standing');
if (after.params.close_min_standing !== 150) throw new Error('reputation rule missing: close_min_standing');
if (JSON.stringify(after.members) !== JSON.stringify(before.members)) throw new Error('member set changed across migrate');
if (!after.round1.settled || after.round1.total_payout_yocto !== before.round1.total_payout_yocto) throw new Error('round 1 changed across migrate');
if (!after.round2.settled || after.round2.total_payout_yocto !== before.round2.total_payout_yocto) throw new Error('round 2 changed across migrate');
const standingsAfter = {};
for (const m of after.members) {
  standingsAfter[m] = await account.viewFunction({ contractId: CONTRACT_ID, methodName: 'get_standing', args: { account_id: m } });
}
if (JSON.stringify(standingsAfter) !== JSON.stringify(standingsBefore)) throw new Error('standings changed across migrate');
console.log('AFTER standings:', JSON.stringify(standingsAfter));

const log = {
  network: 'testnet',
  contract_id: CONTRACT_ID,
  change: 'reputation rule: standing updates at settle (+2 per distinct giver, cap +10, -5 no allocation, floor 50 cap 200); gates: propose >= 100, close early >= 150',
  wasm_bytes: wasm.length,
  wasm_sha256: (await import('node:crypto')).createHash('sha256').update(wasm).digest('hex'),
  migrate_tx: deployOutcome.transaction.hash,
  before: { params: before.params, members: before.members, round1: before.round1, round2: before.round2, standings: standingsBefore },
  after: { params: after.params, members: after.members, round1: after.round1, round2: after.round2, standings: standingsAfter },
  migrated_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('MIGRATE OK:', CONTRACT_ID);
console.log('wrote migrate-log.json');
