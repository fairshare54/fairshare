# FairShare — live round runbook

How a live FairShare round actually runs on NEAR testnet, written from the
round that already ran (live round 2, 2026-11-08). Testnet only. Never
mainnet. No private key is printed or committed anywhere in this repo.

**Live ids:** DAO `fairshare-dao.testnet`, contract
`fairshare-contract.testnet`, owner `fairshare-owner.testnet`.
Repo: https://github.com/fairshare54/fairshare

## What already ran

- **Round 1 (demo accounts):** 5 NEAR, 6 demo members (alice–frank),
  settled tx `2MUqHsLbbMcZGsneNnBBTinUfPXXJwdoRnJjwzxhpJYu`.
- **Round 2 (crew accounts):** 5 NEAR, 6 crew members (Ada, Emeka,
  Fatima, Ibrahim, Ngozi, Tunde), funded by a real DAO FunctionCall
  proposal, settled tx
  `6FsBf9r42Ji8afF8G6rebq2GqChmpUQW41cCpTuaodJF`. Full record:
  `DEMO_LOG.md` (live round 2 section) and `demo-log-round2.json`.
- **Honest label:** round 2's crew are fresh testnet accounts with
  personas, created and operated by scripts — NOT six real humans. Every
  step (proposals, votes, funding, settlement) was real and onchain, but
  a round with actual people still needs Isaiah to bring them. Section 5
  below is that path.

## 1. Getting a testnet account

A real person needs a testnet NEAR account with a little testnet NEAR for
gas (an allocate call costs about 0.0002 NEAR; 1 NEAR is far more than
enough for a whole round).

**Easy path (phone, no command line):**
1. Install Meteor Wallet (https://wallet.meteorwallet.app/) and switch it
   to **testnet**.
2. Create an account, e.g. `yourname.testnet`. Save the recovery phrase —
   losing it loses the account.
3. Get free testnet NEAR from the faucet: https://near-faucet.io
   (paste the account id; it sends testnet NEAR, usually 10 NEAR).
4. Send the account id (e.g. `yourname.testnet`) to Isaiah.

**Script path (what round 2 used):** `node
scripts/create-fairshare-accounts.mjs` creates accounts via the NEAR
testnet helper (`https://helper.testnet.near.org/account`), which funds
each new account with 10 testnet NEAR. The script writes each keypair to
`.testnet-fairshare-accounts.json` (chmod 600, gitignored) BEFORE the
network call that creates the account, so a crash can never lose a key
for a live account. Never print or commit that file.

## 2. Adding people to the DAO council

Membership comes from the DAO council role. The contract mirrors it with
`sync_dao_members()` — the DAO is the source of truth.

**Live DAO policy (verified by RPC `get_policy`, 2026-11-08):**
- Roles: `all` (Everyone — may `*:AddProposal`), `council` (the member
  group — may `*:Finalize`, `*:AddProposal`, `*:VoteApprove`,
  `*:VoteReject`, `*:VoteRemove`).
- Default vote policy: `RoleWeight`, quorum `0`, threshold `[1, 2]`.
- Proposal bond: **1 NEAR** (attached by the proposer, returned when the
  proposal finalises approved; a VoteRemove ("spam") vote forfeits it).
- Proposal period: **7 days** (`604800000000000` ns).
- **Threshold is a STRICT majority.** 6 of 12 council votes (exactly
  1/2) does NOT pass — proposal #6 needed a 7th vote. In general, with
  N council members you need floor(N/2) + 1 approvals.

**One proposal per person.** A proposal adds exactly one member:
kind `AddMemberToRole { member_id: "<new>.testnet", role: "council" }`.

**Who does what:**
- **Proposer:** anyone (role `all` can propose). In round 2 the owner
  proposed. Cost: 1 NEAR bond + ~0.0003 NEAR gas. Propose one person,
  vote it through, then propose the next — the bond is returned on
  approval, so only 1 NEAR is locked at a time.
- **Voters:** current council members. Each votes `VoteApprove` on the
  proposal. A vote costs ~0.0002 NEAR gas and needs no deposit.
- **Execution is automatic:** the moment the threshold vote lands, the
  proposal executes and the person joins the council. Check with
  `get_policy` (council group) — do not assume it from the vote count.

**Exact calls (near-api-js; see `scripts/live-round-2.mjs` for the
working code):**
- Propose: `add_proposal` on `fairshare-dao.testnet`, args
  `{ proposal: { description: "Add <id> to the FairShare council",
  kind: { AddMemberToRole: { member_id: "<id>", role: "council" } } } }`,
  attached deposit exactly 1 NEAR, gas 100 TGas. The new proposal id is
  the `get_last_proposal_id` value read before the call.
- Vote: `act_proposal` on `fairshare-dao.testnet`, args
  `{ id, action: "VoteApprove", proposal: <the same kind object>,
  memo: null }`, gas 150 TGas. **The kind must be included** — current
  Sputnik v2 (post-#217) rejects the old `(id, action, memo)` form.
- Read: `get_proposal({ id })` → `status` (`InProgress` / `Approved` /
  `Failed`), `vote_counts`, `votes`.

**Easiest UI alternative:** Astro DAO (https://app.astrodao.com) can
open `fairshare-dao.testnet`, create the AddMember proposal, and vote on
it in a browser with Meteor Wallet. The onchain flow is identical; the
script path above is what round 2 actually used and verified.

**After the council changes:** anyone calls `sync_dao_members()` on
`fairshare-contract.testnet` (gas 100 TGas, no deposit). Verify with
`get_dao_info` (member count) and `get_members()` — the new people must
appear before they can allocate.

## 3. Funding the round (the DAO pays)

Round 2 was funded by the DAO itself, not by the owner: a FunctionCall
proposal tells the DAO to call `create_round` on the contract with the
envelope attached.

- **Envelope:** 5 NEAR, like rounds 1 and 2. (The contract minimum is
  whatever the envelope is — there is no contract-side minimum; 5 NEAR
  is the agreed demo size.)
- **Proposal:** kind `FunctionCall { receiver_id:
  "fairshare-contract.testnet", actions: [{ method_name: "create_round",
  args: "<base64 of {\"round_id\": 2, \"envelope_yocto\":
  \"5000000000000000000000000\"}>", deposit: "5000000000000000000000000",
  gas: "100000000000000" }] }`. **Gas is a JSON string, not a number**
  — passing an integer fails deserialization and the proposal is never
  created (this happened once in round 2, tx
  `HkEZRVyuKooMui9yPDj2wDCfPcFKWon5BX2BBqu9jMBf`; only gas lost).
- **Money check BEFORE proposing:** the DAO pays the 5 NEAR from its own
  balance. After round 2 the DAO holds **0.2591 NEAR available** — it
  CANNOT fund another 5 NEAR round until it is topped up. Top it up with
  a plain transfer of testnet NEAR to `fairshare-dao.testnet` (from any
  faucet-funded account), or fund the round from the owner account
  instead (owner calls `create_round` directly with the envelope
  attached — only the owner or the DAO may call it).
- **Votes:** same as section 2 — strict majority of the council at vote
  time. With 12 on council, that is 7 approvals.
- **Verify:** `get_round({ round_id })` on the contract must show the
  envelope and `closed: false, settled: false`. The round deadline is
  creation + 7 days.

## 4. Allocating, closing, settling

**Allocating — the site CANNOT do this today.** The site's live mode
(`site/app.js`, `fetchLiveState`) is read-only: it reads `get_params`,
`get_members`, `get_round` from the contract. There is no wallet
connection and no allocate button. Each member allocates with a signed
call — `near-cli` or the script pattern in `scripts/live-round-2.mjs`.

Exact `near-cli` command (near-cli-rs, testnet, replace the values):

```sh
near contract call-function as-transaction fairshare-contract.testnet allocate \
  json-args '{"round_id": 2, "allocations": [
    {"to": "emeka-fairshare.testnet", "points": 45, "reason": "delivered the fish on time in the rain"},
    {"to": "fatima-fairshare.testnet", "points": 35, "reason": "collected all the rent this week"},
    {"to": "ibrahim-fairshare.testnet", "points": 20, "reason": "fixed the door seal before the thaw"}
  ]}' \
  prepaid-gas '100.0 TeraGas' attached-deposit '0 NEAR' \
  sign-as ada-fairshare.testnet network-config testnet sign-with-keychain send
```

Rules the contract enforces (a bad submission is rejected, nothing is
lost except gas): total at most 100 points, no self-allocation, at
least 3 distinct recipients, each allocation 1–100 points, every reason
non-empty and at most 200 characters. Re-submitting before settlement
replaces the previous submission. After close, settle, or the 7-day
deadline, allocating is rejected.

**Closing:** the owner calls `close_round({ round_id })` (gas 100 TGas)
to settle early instead of waiting 7 days. Anyone can call
`settle_round({ round_id })` after close or deadline (gas 200 TGas).
Settling twice fails.

**Reading your payout:** anyone can read (no signing, no gas) —
`explain_payout({ round_id, account_id })` on the contract returns the
score, the payout, and the giver-by-giver breakdown (each giver's
points, discount, effective points, and root part). `get_payouts({
round_id })` lists everyone. Check your own balance before and after:
it rises by payout minus ~0.0002 NEAR gas.

**Settlement maths (what the numbers mean):** for each mutual pair, the
smaller of the two allocations is the mutual portion and 50% of it is
discounted from BOTH directions. Score = (sum over distinct givers of
`isqrt(effective_points × standing)`)², standing starts at 100 for
everyone. Payouts are proportional to score, capped at 25% of the
envelope per member, capped surplus redistributed to uncapped members.
Round 2 is the proof the cap works: Ada and Ibrahim both capped at
exactly 1.25 NEAR.

## 5. A round with real humans (still to do)

1. Isaiah invites 5–8 people (copy-pasteable invite below) and collects
   their testnet account ids.
2. Each person creates a testnet account (section 1) — about 10 minutes,
   costs them nothing.
3. One AddMemberToRole proposal per person (section 2), voted by the
   current council. Note: the council is currently 12 (6 demo + 6 crew);
   the demo members can vote the new people in, and can later be removed
   with one RemoveMemberFromRole proposal each if the round should belong
   to the new people alone.
4. Top up the DAO treasury first (section 3) — a 5 NEAR round needs
   the DAO at about 11.5 NEAR total, not 5: Sputnik stores every
   proposal onchain, so the DAO must keep about 4.74 NEAR staked for
   storage, and executing a proposal also returns the 1 NEAR bond
   (round 3 funding failed twice before the DAO was topped to 11.5).
5. Fund the round by DAO FunctionCall proposal (section 3), round id 4,
   5 NEAR envelope unless Isaiah picks another amount.
6. `sync_dao_members`, then each person allocates (section 4), owner
   closes and settles, everyone reads `explain_payout`.

### Invite message (copy-paste)

> I am testing FairShare, a small project where a group shares money
> fairly. Each person in the group gives 100 points to the others for
> the work they saw, and a program on the NEAR testnet splits the money
> using those points. It is a test, so no real money moves anywhere.
>
> To join, please do this (about 10 minutes, free):
> 1. Install Meteor Wallet on your phone and switch it to testnet.
> 2. Create an account, for example yourname.testnet, and save the
>    recovery phrase.
> 3. Go to near-faucet.io, paste your account name, and collect the
>    free test money.
> 4. Send me your account name, for example yourname.testnet.
>
> That is all. I will add you to the group, and when the round opens
> you will split your 100 points between at least 3 people and write
> one short reason for each. The round takes a few days, and you can
> see exactly how your share was worked out afterwards.

## 6. What can go wrong

- **Proposal bond (1 NEAR):** the proposer attaches exactly 1 NEAR.
  Wrong amount → `ERR_MIN_BOND`, proposal never created. The bond is
  returned when the proposal finalises approved. A VoteRemove ("spam")
  outcome forfeits it.
- **Exactly half the votes is not enough.** Threshold is a strict
  majority — with 12 on council, 6 approvals leaves the proposal
  `InProgress` forever (until the 7-day period expires). Count
  floor(N/2) + 1 before assuming it passed, and always read
  `get_proposal` status.
- **ActionCall gas as a JSON integer** fails deserialization (round 2
  learned this). Gas and deposit are strings in proposal JSON.
- **Old `act_proposal` form fails.** Current Sputnik v2 requires the
  full proposal kind in the vote call.
- **DAO treasury.** A 5 NEAR round needs the DAO at about 11.5 NEAR
  total, not 5. Sputnik stores every proposal onchain, so the DAO must
  keep about 4.74 NEAR staked for storage (measured storage_usage
  474269 bytes = 4.7427 NEAR), and executing a funding proposal also
  returns the 1 NEAR bond — a 5 NEAR envelope is a 6 NEAR outflow.
  Round 3 funding failed twice (3.7466 short, then 0.74295 short)
  before the DAO was topped to 11.5 NEAR and the 7th vote passed.
  Top up first, and check the DAO total balance, not the free balance.
- **FastNEAR RPC lags finality by a few seconds.** After a FINAL
  transaction, a view can still return the old state. Poll views until
  the expected state appears; never re-send a transaction because a
  view looked stale.
- **Round deadline is 7 days from creation.** After it, nobody can
  allocate. The owner can close early any time; settling needs close or
  deadline.
- **Demo members are still on council (12 total).** They can vote but
  did not allocate in round 2. If a future round should be the new
  people's alone, remove them first (one proposal each).
- **Standing moves at each settle now.** +2 per distinct giver (cap
  +10 a round), -5 for submitting no allocations, floor 50, cap 200.
  Gates: standing 100 or more to propose a round, 150 or more to close
  one early (owner and DAO excepted). Proved live in round 3: ada 100
  to 110, tunde 100 to 95, member close at 100 rejected, member propose
  at 95 rejected.
- **The site cannot allocate.** Live mode is read-only (section 4).
  Do not tell people to allocate on the site until a wallet flow is
  built.
