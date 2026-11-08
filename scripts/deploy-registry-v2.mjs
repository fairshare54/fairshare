// Deploy the new registry code (deploy_group_contract, new contract id
// scheme) over the live fairshare-registry.testnet state. The state
// struct is UNCHANGED, so no migration is needed and init is NEVER
// called afterwards. Snapshots get_owner / group_count / prove-group
// before and after and refuses to finish unless they are identical.
// Run: node scripts/deploy-registry-v2.mjs
// Testnet only. Key from .testnet-fairshare-accounts.json, never printed.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { connect, keyStores, KeyPair } from 'near-api-js';

const RPC = 'https://rpc.testnet.fastnear.com';
const REGISTRY_ID = 'fairshare-registry.testnet';
const WASM = new URL('../registry-contract/target/wasm32-unknown-unknown/release/fairshare_registry.wasm', import.meta.url);
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);

const wasm = fs.readFileSync(WASM);
const wasmHash = crypto.createHash('sha256').update(wasm).digest('hex');
console.log(`wasm: ${wasm.length} bytes, sha256 ${wasmHash}`);

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const registry = accounts['registry'];
if (!registry || registry.accountId !== REGISTRY_ID) throw new Error('no key for fairshare-registry.testnet in the accounts file');

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', REGISTRY_ID, KeyPair.fromString(registry.privateKey));
const near = await connect({ networkId: 'testnet', nodeUrl: RPC, walletUrl: 'https://testnet.mynearwallet.com/', helperUrl: 'https://helper.testnet.near.org', keyStore });

async function viewCode(accountId) {
  const raw = await near.connection.provider.query({ request_type: 'view_code', account_id: accountId, finality: 'final' });
  return Buffer.from(raw.code_base64, 'base64');
}
async function view(contractId, method, args) {
  const a = await near.account(contractId);
  return a.viewFunction({ contractId, methodName: method, args });
}

const beforeCode = await viewCode(REGISTRY_ID);
console.log(`code before: ${beforeCode.length} bytes, sha256 ${crypto.createHash('sha256').update(beforeCode).digest('hex')}`);
const ownerBefore = await view(REGISTRY_ID, 'get_owner', {});
const countBefore = await view(REGISTRY_ID, 'group_count', {});
const proveBefore = await view(REGISTRY_ID, 'get_group', { group_id: 'prove-group' });
console.log(`state before: owner ${ownerBefore}, group_count ${countBefore}, prove-group contract ${proveBefore?.contract_id}`);
if (beforeCode.length === wasm.length && crypto.createHash('sha256').update(beforeCode).digest('hex') === wasmHash) {
  console.log('live code already matches the new build; nothing to deploy');
} else {
  const acct = await near.account(REGISTRY_ID);
  const out = await acct.deployContract(wasm);
  console.log('deploy tx:', out.transaction.hash);
  await new Promise((r) => setTimeout(r, 3000));
}

const afterCode = await viewCode(REGISTRY_ID);
const afterHash = crypto.createHash('sha256').update(afterCode).digest('hex');
console.log(`code after: ${afterCode.length} bytes, sha256 ${afterHash}`);
if (afterHash !== wasmHash) throw new Error('live code does not match the new build after deploy');
const ownerAfter = await view(REGISTRY_ID, 'get_owner', {});
const countAfter = await view(REGISTRY_ID, 'group_count', {});
const proveAfter = await view(REGISTRY_ID, 'get_group', { group_id: 'prove-group' });
console.log(`state after: owner ${ownerAfter}, group_count ${countAfter}, prove-group contract ${proveAfter?.contract_id}`);
if (ownerAfter !== ownerBefore) throw new Error('get_owner CHANGED — state is damaged');
if (countAfter !== countBefore) throw new Error('group_count CHANGED — state is damaged');
if (JSON.stringify(proveAfter) !== JSON.stringify(proveBefore)) throw new Error('prove-group record CHANGED — state is damaged');
console.log('REGISTRY V2 DEPLOYED — code updated, state untouched, prove-group intact');
