// Deploy the FairShare round contract (DAO membership version) to NEAR testnet.
// Uses ONLY the fresh FairShare accounts in .testnet-fairshare-accounts.json.
// Deploys the WASM to fairshare-contract.testnet, calls new() with
// owner fairshare-owner.testnet and dao fairshare-dao.testnet (the real
// Sputnik DAO created by scripts/create-dao.mjs), then verifies get_params,
// get_dao_info and get_cached_dao_role.
// Run: node scripts/deploy.mjs
// Writes deploy-log.json (tx hashes + verified params; NO keys).
// The old Egbe deployment (egbe-contract.testnet) is left untouched and
// recorded in BUILD_LOG.md / DEMO_LOG.md history.
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const WASM = new URL('../fairshare_round.wasm', import.meta.url);
const OUT = new URL('../deploy-log.json', import.meta.url);

const CONTRACT_ID = 'fairshare-contract.testnet';
const OWNER_ID = 'fairshare-owner.testnet';
const DAO_ID = 'fairshare-dao.testnet';

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

const wasm = fs.readFileSync(WASM);
console.log(`deploying ${wasm.length} bytes to ${CONTRACT_ID} ...`);
const deployOutcome = await account.deployContract(wasm);
console.log('deploy tx:', deployOutcome.transaction.hash);

console.log(`calling new(owner=${OWNER_ID}, dao=${DAO_ID}) ...`);
const initOutcome = await account.functionCall({
  contractId: CONTRACT_ID,
  methodName: 'new',
  args: { owner_id: OWNER_ID, dao_id: DAO_ID },
  gas: 100_000_000_000_000n,
  attachedDeposit: 0n,
});
console.log('init tx:', initOutcome.transaction.hash);

const params = await account.viewFunction({
  contractId: CONTRACT_ID,
  methodName: 'get_params',
  args: {},
});
console.log('get_params:', JSON.stringify(params));
if (params.points_per_member !== 100) throw new Error('points_per_member mismatch');
if (params.min_recipients !== 3) throw new Error('min_recipients mismatch');
if (params.cap_bps !== 2500) throw new Error('cap_bps mismatch');
if (params.reciprocity_discount_bps !== 5000) throw new Error('reciprocity_discount_bps mismatch');
if (params.standing_start !== 100) throw new Error('standing_start mismatch');

const daoInfo = await account.viewFunction({
  contractId: CONTRACT_ID,
  methodName: 'get_dao_info',
  args: {},
});
console.log('get_dao_info:', JSON.stringify(daoInfo));
if (daoInfo.dao_id !== DAO_ID) throw new Error('dao_id mismatch');
if (daoInfo.member_role !== 'council') throw new Error('member_role mismatch');
if (daoInfo.member_count !== 0) throw new Error('member_count should be 0 before sync');
if (daoInfo.last_sync_ns !== 0) throw new Error('last_sync_ns should be 0 before sync');

const role = await account.viewFunction({
  contractId: CONTRACT_ID,
  methodName: 'get_cached_dao_role',
  args: { account_id: OWNER_ID },
});
console.log('get_cached_dao_role(owner):', JSON.stringify(role));
if (role.dao_id !== DAO_ID) throw new Error('cached dao_id mismatch');

const log = {
  network: 'testnet',
  contract_id: CONTRACT_ID,
  owner_id: OWNER_ID,
  dao_id: DAO_ID,
  wasm_bytes: wasm.length,
  wasm_sha256: (await import('node:crypto')).createHash('sha256').update(wasm).digest('hex'),
  deploy_tx: deployOutcome.transaction.hash,
  init_tx: initOutcome.transaction.hash,
  params,
  dao_info: daoInfo,
  deployed_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('DEPLOY OK:', CONTRACT_ID);
console.log('wrote deploy-log.json');
