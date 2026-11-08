// Mint one FairShare soulbound council badge per DAO council member.
// Reads the member list LIVE from fairshare-contract.testnet
// (get_members) — never a hardcoded list — then each member's live
// standing (get_standing), and mints one badge per member with that
// standing. The owner (fairshare-owner.testnet) signs the mints.
// Idempotent: a member who already holds a badge (get_badge) is
// skipped, never re-minted. Never retries a landed tx without
// checking state first.
// Then verifies: nft_token + get_badge for every member, and that an
// onchain nft_transfer attempt from a member account FAILS (soulbound).
// Run: node scripts/mint-badges.mjs
// Appends per-member token id / standing / mint tx + verification to
// badge-log.json (NO keys).
// Testnet only.
import fs from 'node:fs';
import { connect, keyStores, KeyPair, utils } from 'near-api-js';

const ACCOUNTS_FILE = new URL('../.testnet-fairshare-accounts.json', import.meta.url);
const OUT = new URL('../badge-log.json', import.meta.url);

const ROUND_CONTRACT_ID = 'fairshare-contract.testnet';
const BADGE_CONTRACT_ID = 'fairshare-badge.testnet';
const OWNER_ID = 'fairshare-owner.testnet';
const MINT_DEPOSIT_YOCTO = 20_000_000_000_000_000_000_000n; // 0.02 NEAR (min 0.01)

const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
const owner = accounts.owner;
if (!owner || owner.accountId !== OWNER_ID) {
  throw new Error('owner account missing in .testnet-fairshare-accounts.json');
}

const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey('testnet', owner.accountId, KeyPair.fromString(owner.privateKey));

const near = await connect({
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.fastnear.com',
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore,
});
const ownerAccount = await near.account(owner.accountId);

// -- live member list + standings from the round contract -------------------
const members = await ownerAccount.viewFunction({
  contractId: ROUND_CONTRACT_ID,
  methodName: 'get_members',
  args: {},
});
console.log(`members live from ${ROUND_CONTRACT_ID}: ${members.length} — ${members.join(', ')}`);
if (!Array.isArray(members) || members.length === 0) throw new Error('no members returned');

const standings = {};
for (const m of members) {
  standings[m] = await ownerAccount.viewFunction({
    contractId: ROUND_CONTRACT_ID,
    methodName: 'get_standing',
    args: { account_id: m },
  });
}
console.log('standings live:', JSON.stringify(standings));

// -- mint one badge per member (skip anyone who already holds one) ---------
const results = [];
for (const member of [...members].sort()) {
  const tokenId = `badge-${member}`;
  const standing = standings[member];
  const existing = await ownerAccount.viewFunction({
    contractId: BADGE_CONTRACT_ID,
    methodName: 'get_badge',
    args: { account_id: member },
  });
  if (existing) {
    console.log(`SKIP ${member}: already holds ${existing.token_id} (standing ${existing.standing})`);
    results.push({ account_id: member, token_id: existing.token_id, standing_at_mint: existing.standing, mint_tx: null, status: 'already_minted_skipped' });
    continue;
  }
  console.log(`minting ${tokenId} for ${member} (standing ${standing}) ...`);
  const outcome = await ownerAccount.functionCall({
    contractId: BADGE_CONTRACT_ID,
    methodName: 'mint',
    args: { member, standing },
    gas: 100_000_000_000_000n,
    attachedDeposit: MINT_DEPOSIT_YOCTO,
  });
  console.log(`  mint tx: ${outcome.transaction.hash}`);
  results.push({ account_id: member, token_id: tokenId, standing_at_mint: standing, mint_tx: outcome.transaction.hash, status: 'minted' });
}

// -- verify: nft_token + get_badge for every member -------------------------
const verification = [];
for (const r of results) {
  const token = await ownerAccount.viewFunction({
    contractId: BADGE_CONTRACT_ID,
    methodName: 'nft_token',
    args: { token_id: r.token_id },
  });
  const badge = await ownerAccount.viewFunction({
    contractId: BADGE_CONTRACT_ID,
    methodName: 'get_badge',
    args: { account_id: r.account_id },
  });
  const ok =
    !!token &&
    token.owner_id === r.account_id &&
    token.token_id === r.token_id &&
    token.metadata?.title === 'FairShare Council Badge' &&
    typeof token.metadata?.description === 'string' &&
    token.metadata.description.includes(r.account_id) &&
    token.metadata.description.includes(String(r.standing_at_mint)) &&
    !!badge &&
    badge.token_id === r.token_id &&
    badge.owner_id === r.account_id &&
    badge.standing === r.standing_at_mint;
  console.log(`verify ${r.account_id}: ${ok ? 'OK' : 'MISMATCH'} (token owner ${token?.owner_id}, badge standing ${badge?.standing})`);
  verification.push({ account_id: r.account_id, token_id: r.token_id, nft_token_ok: ok, badge });
  if (!ok) throw new Error(`verification failed for ${r.account_id}`);
}

const totalSupply = await ownerAccount.viewFunction({
  contractId: BADGE_CONTRACT_ID,
  methodName: 'get_total_supply',
  args: {},
});
console.log('get_total_supply after minting:', totalSupply);
if (totalSupply !== members.length) throw new Error(`total supply ${totalSupply} != member count ${members.length}`);

// -- soulbound check: a real onchain nft_transfer must FAIL -----------------
// Attempt from alice-fairshare.testnet (a key we hold) moving her own
// badge to bob. The call must revert; no token can move.
const transferMember = members.find((m) => accounts[Object.keys(accounts).find((k) => accounts[k].accountId === m)]);
if (!transferMember) throw new Error('no member account key available for the soulbound check');
const transferKey = Object.keys(accounts).find((k) => accounts[k].accountId === transferMember);
const transferKeyStore = new keyStores.InMemoryKeyStore();
await transferKeyStore.setKey('testnet', transferMember, KeyPair.fromString(accounts[transferKey].privateKey));
const transferNear = await connect({
  networkId: 'testnet',
  nodeUrl: 'https://rpc.testnet.fastnear.com',
  walletUrl: 'https://testnet.mynearwallet.com/',
  helperUrl: 'https://helper.testnet.near.org',
  keyStore: transferKeyStore,
});
const transferAccount = await transferNear.account(transferMember);
const receiver = members.find((m) => m !== transferMember);
let soulboundCheck;
try {
  const outcome = await transferAccount.functionCall({
    contractId: BADGE_CONTRACT_ID,
    methodName: 'nft_transfer',
    args: { receiver_id: receiver, token_id: `badge-${transferMember}`, memo: 'soulbound check' },
    gas: 100_000_000_000_000n,
    attachedDeposit: 1n,
  });
  soulboundCheck = {
    attempted_by: transferMember,
    token_id: `badge-${transferMember}`,
    receiver_id: receiver,
    outcome: 'UNEXPECTED_SUCCESS',
    tx_hash: outcome.transaction.hash,
    error: null,
  };
  console.log('SOULBOUND CHECK FAILED: transfer unexpectedly succeeded!', soulboundCheck);
} catch (err) {
  soulboundCheck = {
    attempted_by: transferMember,
    token_id: `badge-${transferMember}`,
    receiver_id: receiver,
    outcome: 'failed_as_expected',
    tx_hash: err?.transaction?.hash ?? null,
    error: String(err?.message ?? err).slice(0, 500),
  };
  console.log('SOULBOUND CHECK OK: transfer failed as expected:', soulboundCheck.error.slice(0, 200));
}
// The badge must still be with its owner after the failed transfer.
const stillThere = await ownerAccount.viewFunction({
  contractId: BADGE_CONTRACT_ID,
  methodName: 'get_badge',
  args: { account_id: transferMember },
});
if (!stillThere || stillThere.token_id !== `badge-${transferMember}`) {
  throw new Error('badge moved after the soulbound check — this must never happen');
}
if (soulboundCheck.outcome !== 'failed_as_expected') {
  throw new Error('soulbound check FAILED: nft_transfer did not revert');
}

// -- write log ----------------------------------------------------------------
let log = {};
try {
  log = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch {
  // fresh log (deploy step normally writes it first)
}
log.network = 'testnet';
log.contract_id = BADGE_CONTRACT_ID;
log.owner_id = OWNER_ID;
log.round_contract_id = ROUND_CONTRACT_ID;
log.members = results;
log.member_count = members.length;
log.standings_live = standings;
log.verification = verification;
log.total_supply_after_mint = totalSupply;
log.soulbound_transfer_check = soulboundCheck;
log.minted_at = new Date().toISOString();
fs.writeFileSync(OUT, JSON.stringify(log, null, 2) + '\n');
console.log(`MINT OK: ${results.filter((r) => r.status === 'minted').length} minted, ${results.filter((r) => r.status === 'already_minted_skipped').length} already held, total supply ${totalSupply}`);
console.log('wrote badge-log.json');
