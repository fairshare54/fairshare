// EXPERIMENT: create a Sputnik DAO through the live testnet factory
// sputnikv2.testnet, as the Create-your-DAO page will do from the browser.
// Caller: alice-fairshare.testnet (8.3 NEAR). Attach 5.5 NEAR.
// DAO: testgroup1.sputnikv2.testnet, council [alice], default policy.
// Verifies get_policy + get_config live. Writes exp-factory-create.json (NO keys).
import fs from 'node:fs';
import { connect, keyStores, KeyPair } from 'near-api-js';
const RPC = 'https://rpc.testnet.fastnear.com';
const FACTORY_ID = 'sputnikv2.testnet';
const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../exp-factory-create.json', import.meta.url);
const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const creator = accounts.alice;
const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', creator.accountId, KeyPair.fromString(creator.privateKey));
const near = await connect({ networkId: 'testnet', nodeUrl: RPC, walletUrl: 'https://testnet.mynearwallet.com/', helperUrl: 'https://helper.testnet.near.org', keyStore });
const daoName = 'testgroup1';
const daoId = `${daoName}.${FACTORY_ID}`;
const daoArgs = { config: { name: daoName, purpose: 'Experiment DAO for the FairShare self-serve groups build', metadata: '' }, policy: [creator.accountId] };
const argsB64 = Buffer.from(JSON.stringify(daoArgs)).toString('base64');
console.log('calling factory create for', daoId, 'with 5.5 NEAR attached ...');
const signer = await near.account(creator.accountId);
const out = await signer.functionCall({ contractId: FACTORY_ID, methodName: 'create', args: { name: daoName, args: argsB64 }, gas: 150_000_000_000_000n, attachedDeposit: 5_500_000_000_000_000_000_000_000n });
console.log('create tx:', out.transaction.hash);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dao = await near.account(daoId);
let policy;
for (let i = 0; i < 30; i++) {
  try { policy = await dao.viewFunction({ contractId: daoId, methodName: 'get_policy', args: {} }); if (policy?.roles) break; } catch (_) { /* not ready */ }
  await sleep(3000);
}
if (!policy?.roles) throw new Error('get_policy did not return roles');
console.log('get_policy roles:', JSON.stringify(policy.roles.map((r) => ({ name: r.name, kind: r.kind }))));
const council = policy.roles.find((r) => r.name === 'council');
if (JSON.stringify(council?.kind?.Group) !== JSON.stringify([creator.accountId])) throw new Error('council mismatch');
const config = await dao.viewFunction({ contractId: daoId, methodName: 'get_config', args: {} });
console.log('get_config:', JSON.stringify(config));
const bal = BigInt((await dao.state()).amount);
console.log('DAO balance:', Number(bal) / 1e24, 'NEAR');
fs.writeFileSync(OUT, JSON.stringify({ network: 'testnet', factory_id: FACTORY_ID, dao_id: daoId, creator: creator.accountId, attached_yocto: '5500000000000000000000000', create_tx: out.transaction.hash, council: council.kind.Group, config, dao_balance_yocto: bal.toString(), at: new Date().toISOString() }, null, 2) + '\n');
console.log('FACTORY CREATE OK:', daoId);
