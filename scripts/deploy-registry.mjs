// Deploy the FairShare group registry to NEAR testnet.
// Deploys the WASM to fairshare-registry.testnet, calls new() with owner
// fairshare-owner.testnet, then verifies get_owner and group_count.
// Uses ONLY the fresh FairShare accounts in .testnet-fairshare-accounts.json.
// Run: node scripts/deploy-registry.mjs
// Writes registry-deploy-log.json (tx hashes + verified state; NO keys).
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const WASM = new URL('../registry-contract/target/wasm32-unknown-unknown/release/fairshare_registry.wasm', import.meta.url);
const OUT = new URL('../registry-deploy-log.json', import.meta.url);

const REGISTRY_ID = 'fairshare-registry.testnet';
const OWNER_ID = 'fairshare-owner.testnet';

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const registry = accounts.registry;
if (!registry || registry.accountId !== REGISTRY_ID) {
  throw new Error('registry account missing in .testnet-fairshare-accounts.json');
}

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', registry.accountId, KeyPair.fromString(registry.privateKey));

const near = await connect({
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.fastnear.com',
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore,
});
const account = await near.account(registry.accountId);

const wasm = fs.readFileSync(WASM);
console.log(`deploying ${wasm.length} bytes to ${REGISTRY_ID} ...`);
const deployOutcome = await account.deployContract(wasm);
console.log('deploy tx:', deployOutcome.transaction.hash);

console.log(`calling new(owner=${OWNER_ID}) ...`);
const initOutcome = await account.functionCall({
  contractId: REGISTRY_ID,
  methodName: 'new',
  args: { owner_id: OWNER_ID },
  gas: 100_000_000_000_000n,
  attachedDeposit: 0n,
});
console.log('init tx:', initOutcome.transaction.hash);

const owner = await account.viewFunction({ contractId: REGISTRY_ID, methodName: 'get_owner', args: {} });
console.log('get_owner:', owner);
if (owner !== OWNER_ID) throw new Error('owner mismatch');
const count = await account.viewFunction({ contractId: REGISTRY_ID, methodName: 'group_count', args: {} });
console.log('group_count:', count);
if (count !== 0) throw new Error('group_count should be 0 before any group registers');
const groups = await account.viewFunction({ contractId: REGISTRY_ID, methodName: 'list_groups', args: { from_index: 0, limit: 10 } });
console.log('list_groups:', JSON.stringify(groups));
if (!Array.isArray(groups) || groups.length !== 0) throw new Error('list_groups should be empty');

const bal = BigInt((await account.state()).amount);
console.log(`registry balance after deploy: ${Number(bal) / 1e24} NEAR`);

const log = {
  network: 'testnet',
  registry_id: REGISTRY_ID,
  owner_id: OWNER_ID,
  wasm_bytes: wasm.length,
  wasm_sha256: (await import('node:crypto')).createHash('sha256').update(wasm).digest('hex'),
  deploy_tx: deployOutcome.transaction.hash,
  init_tx: initOutcome.transaction.hash,
  owner,
  group_count: count,
  registry_balance_yocto: bal.toString(),
  deployed_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('REGISTRY DEPLOY OK:', REGISTRY_ID);
console.log('wrote registry-deploy-log.json');
