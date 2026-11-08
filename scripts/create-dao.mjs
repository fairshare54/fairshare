// Create the FairShare Sputnik DAO on NEAR testnet at fairshare-dao.testnet.
// Why not the Sputnik factory: the live testnet factory is
// sputnikv2.testnet and it only creates DAOs as its own subaccounts
// (<name>.sputnikv2.testnet) — it cannot create the top-level name
// fairshare-dao.testnet. So this script deploys the real Sputnik DAO v2
// contract directly: the wasm bytes are read on-chain via view_code from
// genesis.sputnikv2.testnet (a DAO created by that factory), then deployed
// to fairshare-dao.testnet and initialised with new() using the default
// policy (council = the 6 demo members).
// Uses ONLY the fresh FairShare accounts in .testnet-fairshare-accounts.json.
// Run: node scripts/create-dao.mjs
// Writes dao-log.json (tx hashes + verified policy; NO keys).
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { connect, keyStores, KeyPair } from 'near-api-js';

const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../dao-log.json', import.meta.url);

const DAO_ID = 'fairshare-dao.testnet';
// A DAO created by the live testnet Sputnik factory; its code is the
// factory's current default DAO code (hash checked below).
const WASM_SOURCE_DAO = 'genesis.sputnikv2.testnet';

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const dao = accounts.dao;
if (!dao || dao.accountId !== DAO_ID) {
  throw new Error('dao account missing in .testnet-fairshare-accounts.json');
}
const members = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map((r) => accounts[r].accountId);

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', dao.accountId, KeyPair.fromString(dao.privateKey));

const near = await connect({
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.fastnear.com',
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore,
});

// 1. Read the Sputnik DAO v2 wasm straight off the chain.
const provider = near.connection.provider;
const code = await provider.query({
  request_type: 'view_code',
  account_id: WASM_SOURCE_DAO,
  finality: 'final',
});
const wasm = Buffer.from(code.code_base64, 'base64');
const wasmSha256 = createHash('sha256').update(wasm).digest('hex');
console.log(`DAO wasm from ${WASM_SOURCE_DAO}: ${wasm.length} bytes, code hash ${code.hash}, sha256 ${wasmSha256}`);
if (wasm.length < 100_000) throw new Error('DAO wasm implausibly small — refusing to deploy');
if (!wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
  throw new Error('downloaded bytes are not a wasm module');
}

const account = await near.account(DAO_ID);

// 2. Deploy the DAO wasm to fairshare-dao.testnet.
console.log(`deploying ${wasm.length} bytes to ${DAO_ID} ...`);
const deployOutcome = await account.deployContract(wasm);
console.log('deploy tx:', deployOutcome.transaction.hash);

// 3. Initialise: default policy, council = the 6 demo members.
// VersionedPolicy is untagged: the Default variant serialises as a plain
// array of council account ids; new() upgrades it to the full default
// policy (everyone can add proposals, council 1/2 vote, 1 NEAR bonds,
// 7-day proposal period).
const initArgs = {
  config: {
    name: 'fairshare',
    purpose: 'FairShare demo DAO — peer allocation of credit (formerly Egbe)',
    metadata: '',
  },
  policy: members,
};
console.log(`calling new() with council ${members.join(', ')} ...`);
const initOutcome = await account.functionCall({
  contractId: DAO_ID,
  methodName: 'new',
  args: initArgs,
  gas: 100_000_000_000_000n,
  attachedDeposit: 0n,
});
console.log('init tx:', initOutcome.transaction.hash);

// 4. Verify live: get_policy must show a council role whose group is
// exactly the 6 demo members; get_config must name the DAO fairshare.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function viewPoll(methodName, args, pred, label, timeoutMs = 90000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await account.viewFunction({ contractId: DAO_ID, methodName, args });
    if (pred(last)) return last;
    await sleep(3000);
  }
  throw new Error(`timed out waiting for ${label}; last view: ${JSON.stringify(last)}`);
}
const policy = await viewPoll(
  'get_policy',
  {},
  (v) => Array.isArray(v?.roles),
  'get_policy'
);
console.log('get_policy:', JSON.stringify(policy).slice(0, 600));
const council = policy.roles.find((r) => r.name === 'council');
if (!council) throw new Error('no council role in DAO policy');
const group = council.kind?.Group;
if (!Array.isArray(group)) throw new Error('council role is not a Group');
const sortedGroup = [...group].sort();
const sortedMembers = [...members].sort();
if (JSON.stringify(sortedGroup) !== JSON.stringify(sortedMembers)) {
  throw new Error(`council group mismatch: got ${JSON.stringify(sortedGroup)}, expected ${JSON.stringify(sortedMembers)}`);
}
const config = await account.viewFunction({ contractId: DAO_ID, methodName: 'get_config', args: {} });
console.log('get_config:', JSON.stringify(config));
if (config.name !== 'fairshare') throw new Error('DAO config name mismatch');

const log = {
  network: 'testnet',
  dao_id: DAO_ID,
  dao_name: 'fairshare',
  wasm_source_dao: WASM_SOURCE_DAO,
  wasm_bytes: wasm.length,
  wasm_code_hash: code.hash,
  wasm_sha256: wasmSha256,
  deploy_tx: deployOutcome.transaction.hash,
  init_tx: initOutcome.transaction.hash,
  council: sortedGroup,
  config,
  created_at: new Date().toISOString(),
};
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log('DAO OK:', DAO_ID);
console.log('wrote dao-log.json');
