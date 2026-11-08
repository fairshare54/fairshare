// Deploy the FairShare soulbound badge contract (NEP-171, transfers
// disabled by design) to NEAR testnet.
// Deploys the WASM to fairshare-badge.testnet (the badge account deploys
// its own contract), calls new() with owner fairshare-owner.testnet, then
// verifies get_owner, get_total_supply and nft_metadata live.
// Run: node scripts/deploy-badge.mjs
// Writes badge-log.json (deploy + init tx hashes, NO keys). The mint
// step (scripts/mint-badges.mjs) appends to the same log.
// Testnet only. Uses ONLY the badge key in .testnet-fairshare-accounts.json.
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';

const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const WASM = new URL('../badge-contract/target/wasm32-unknown-unknown/release/fairshare_badge.wasm', import.meta.url);
const OUT = new URL('../badge-log.json', import.meta.url);

const CONTRACT_ID = 'fairshare-badge.testnet';
const OWNER_ID = 'fairshare-owner.testnet';

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const badge = accounts.badge;
if (!badge || badge.accountId !== CONTRACT_ID) {
  throw new Error('badge account missing in .testnet-fairshare-accounts.json — run scripts/create-badge-account.mjs first');
}

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', badge.accountId, KeyPair.fromString(badge.privateKey));

const near = await connect({
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.fastnear.com',
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore,
});
const account = await near.account(badge.accountId);

const wasm = fs.readFileSync(WASM);
console.log(`deploying ${wasm.length} bytes to ${CONTRACT_ID} ...`);
const deployOutcome = await account.deployContract(wasm);
console.log('deploy tx:', deployOutcome.transaction.hash);

console.log(`calling new(owner=${OWNER_ID}) ...`);
const initOutcome = await account.functionCall({
  contractId: CONTRACT_ID,
  methodName: 'new',
  args: { owner_id: OWNER_ID },
  gas: 100_000_000_000_000n,
  attachedDeposit: 0n,
});
console.log('init tx:', initOutcome.transaction.hash);

const owner = await account.viewFunction({
  contractId: CONTRACT_ID,
  methodName: 'get_owner',
  args: {},
});
console.log('get_owner:', JSON.stringify(owner));
if (owner !== OWNER_ID) throw new Error('owner mismatch');

const totalSupply = await account.viewFunction({
  contractId: CONTRACT_ID,
  methodName: 'get_total_supply',
  args: {},
});
console.log('get_total_supply:', JSON.stringify(totalSupply));
if (totalSupply !== 0) throw new Error('total supply should be 0 before minting');

const metadata = await account.viewFunction({
  contractId: CONTRACT_ID,
  methodName: 'nft_metadata',
  args: {},
});
console.log('nft_metadata:', JSON.stringify(metadata));
if (metadata.spec !== 'nft-1.0.0') throw new Error('spec mismatch');
if (metadata.name !== 'FairShare Council Badge') throw new Error('name mismatch');

let log = {};
try {
  log = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch {
  // fresh log
}
log.network = 'testnet';
log.contract_id = CONTRACT_ID;
log.owner_id = OWNER_ID;
log.wasm_bytes = wasm.length;
log.wasm_sha256 = (await import('node:crypto')).createHash('sha256').update(wasm).digest('hex');
log.deploy_tx = deployOutcome.transaction.hash;
log.init_tx = initOutcome.transaction.hash;
log.owner_verified = owner;
log.total_supply_at_deploy = totalSupply;
log.nft_metadata = metadata;
log.deployed_at = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('DEPLOY OK:', CONTRACT_ID);
console.log('wrote badge-log.json');
