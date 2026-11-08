# FairShare — testnet deploy + live demo round log

Date: 2026-11-08. Testnet only, never mainnet. No private key is printed
or committed anywhere. Keys live only in
`.testnet-fairshare-accounts.json` (chmod 600, gitignored) on this machine.

The first live demo ran under the earlier contract; its record is kept at
the end of this log.

## Accounts (all fresh, created via the testnet helper faucet, 10 NEAR each)

| role | account |
|---|---|
| contract | `fairshare-contract.testnet` |
| owner | `fairshare-owner.testnet` |
| DAO | `fairshare-dao.testnet` |
| members | `alice-fairshare.testnet`, `bob-fairshare.testnet`, `carol-fairshare.testnet`, `dave-fairshare.testnet`, `erin-fairshare.testnet`, `frank-fairshare.testnet` |

## Sputnik DAO

- DAO: `fairshare-dao.testnet`, name `fairshare`, council = the 6 demo
  members, default policy (everyone can add proposals, council 1/2 vote,
  1 NEAR proposal bond, 7-day proposal period).
- Deploy tx: `23KcWfmQD2cu6nBJkx1yAoWk8istBR75omCzXVfZUDnv` (FINAL)
- Init tx (`new`, default policy with the 6-member council):
  `DV39wdiRmhgLAwZ2TCtZncR8RVMhQQ8iPy7jHd2YyYug` (FINAL)
- Verified live: `get_policy` shows the council role group is exactly
  the 6 demo members; `get_config` name is `fairshare`.
- The DAO wasm was read on-chain from `genesis.sputnikv2.testnet`
  (469,723 bytes, sha256
  `6e3f1814d40769d8f57b9a7af689d22aaab96d3232cec4d861311829c1d2318f`),
  because the live testnet factory is `sputnikv2.testnet` and it only
  creates DAOs as its own subaccounts — it cannot create the top-level
  name `fairshare-dao.testnet`. Full record: `dao-log.json`.
- Note: `sputnik-dao.testnet` (the old factory name) exists on testnet
  but holds NO contract code; `sputnikv2.testnet` is the live factory
  (5,482 DAOs).

## Deploy

- Wasm: `fairshare_round.wasm`, 484,794 bytes, sha256
  `ac6216949e3e8bf6590d1dc580453d178341b4a13348c2f424e6b23b36c38e08`.
- Contract: `fairshare-contract.testnet`
- Deploy tx: `oSzFtcQUxoV6vYvQAnwEyJgfWcPSk2XYXyhMJw81zFx` (FINAL)
- Init tx (`new`, owner `fairshare-owner.testnet`, dao
  `fairshare-dao.testnet`):
  `CJfuyLv5J42iuBCMtx4EQh5Cb63BCNxDgTMupZuZHBL7` (FINAL)
- Verified live: `get_params` = 100 points, min 3 recipients, cap 2500
  bps, reciprocity 5000 bps, 7-day rounds, standing 100;
  `get_dao_info` = DAO `fairshare-dao.testnet`, role `council`,
  0 members before sync.
- Deploy choice recorded: a FRESH contract account was used instead of
  migrating `egbe-contract.testnet`, because the new contract state adds
  fields (`member_role`, `last_sync_ns`, `dao_role_cache`) and a migrate
  would have risked the old state; the demo round is re-run from scratch
  anyway. The old contract is left untouched.

## Live demo round 1 (5 NEAR envelope, DAO membership)

Membership came from the DAO council, not from `add_member`:
`sync_dao_members` (tx
`CihwgreGNAYuWyb6pRRbWRy6oUyHRwx5vPWJW3DEBJcs`) read the DAO's
`get_policy` live and synced all 6 members; `get_dao_info` after sync
shows 6 members, `last_sync_ns` set. A live one-off check via
`get_dao_role` (tx
`BN2XZU12x2mWvJNfy8WHecRLT48J5ehyrMisL7WD32vX`) confirmed alice and
cached `live_check: true`.

Allocations are the worked-example allocations from the contract tests
(same points and reasons). Owner closed the round instead of waiting
7 days, then settled it.

| tx | hash |
|---|---|
| sync_dao_members | `CihwgreGNAYuWyb6pRRbWRy6oUyHRwx5vPWJW3DEBJcs` |
| get_dao_role alice | `BN2XZU12x2mWvJNfy8WHecRLT48J5ehyrMisL7WD32vX` |
| create_round (5 NEAR) | `4GUrEhckeFgBCUV718MMT3oPgaopt23drWqYkqhHhS9s` |
| allocate alice | `FZxTGruxNZu4DybTNJ98K9BwbMzZE3NMmWwnVMDxUcWz` |
| allocate bob | `EScw1tdxjT3sq8qkSXa7aQq8pppATGBiuhfayuhnHfQh` |
| allocate carol | `4yf6AvHZ9TDJPpVNGmhWxduCaPu1HZw5CXF3G3BPzGos` |
| allocate dave | `2jkq8fg1KPsKhJv7MKRigmfG5HXapV4E5oK9Q691HMob` |
| allocate erin | `F34bM2tPRwBHuxK2tKdMc2XokLcGPAP8J7yfRxWsLKyV` |
| allocate frank | `AZpaYbtioQDo8AP5uchvq4R5gBQkAWrR239kZm2v1EfM` |
| close_round | `65uRfwwNmUbxAtVB4H6YjBnrwfWXRsDV9GCkZj6HfzGV` |
| settle_round | `2MUqHsLbbMcZGsneNnBBTinUfPXXJwdoRnJjwzxhpJYu` (FINAL) |

### Settlement results (verified live via `explain_payout`)

Scores match the contract's worked example exactly (total 130468).
No cap triggered (max raw share 23.74% < 25%).

| member | score | payout (NEAR) | balance delta (NEAR) |
|---|---|---|---|
| alice-fairshare.testnet | 21904 | 0.8394395560597235 | +0.839205 (gas 0.000235) |
| bob-fairshare.testnet | 16129 | 0.6181209185394120 | +0.617885 (gas 0.000235) |
| carol-fairshare.testnet | 7569 | 0.2900711285525953 | +0.289836 (gas 0.000235) |
| dave-fairshare.testnet | 29241 | 1.1206196155379098 | +1.120385 (gas 0.000235) |
| erin-fairshare.testnet | 24649 | 0.9446377655823650 | +0.944403 (gas 0.000235) |
| frank-fairshare.testnet | 30976 | 1.1871110157279947 | +1.186875 (gas 0.000235) |

- Payout sum: 4,999,999,999,999,999,999,999,997 yocto (4.999... NEAR);
  remainder in the contract: 3 yocto.
- Every member's onchain balance rose by payout minus ~0.000235 NEAR
  of gas for their own `allocate` call — the transfers really landed.
- Contract balance: 9.9963 → 9.9963 NEAR (5 NEAR envelope in via
  `create_round`, exactly 5 NEAR out via settlement, 3 yocto dust left).
- Full machine-readable record (explanations, balances, all hashes):
  `demo-log.json`. Deploy record: `deploy-log.json`. DAO record:
  `dao-log.json`.

### Operational notes

- The fastnear RPC can lag finality by a few seconds: the first demo
  run saw `get_round` return null right after a FINAL `create_round`.
  `scripts/demo-round.mjs` now polls views until the expected state is
  visible and skips steps already done onchain, so it is safe to re-run.
- `near-api-js` prints "Retrying transaction ... with new nonce"
  warnings when the RPC is slow; the returned hashes are the final ones.

## What is NOT done (needs Isaiah or a follow-up)

- **Live round with real humans** (not test accounts), **GitHub push**,
  **hackathon submission**: need Isaiah's separate explicit approval.
  Live round 2 with a script-operated crew is done (see above); a round
  with actual people still needs Isaiah to bring them — see
  `LIVE_ROUND.md`. The repo
  https://github.com/fairshare54/fairshare already exists (public,
  empty); nothing pushed yet.
- **Lead question**: FairShare is the fourth project (Genesis, PAC,
  VeilProof, FairShare); one person can lead at most 2, so it needs a
  different lead or Genesis to wait.
- DAO treasury is nearly empty (0.2591 NEAR available) after funding
  round 2 — top it up before any round 3.

## Live round 2 — 5 NEAR, full DAO flow, freezer cooperative crew (2026-11-08)

Run by `scripts/live-round-2.mjs` (verified by `scripts/verify-round-2.mjs`).
Full machine-readable record: `demo-log-round2.json` (also merged into
`demo-log.json` under `round_2`). This is NOT a round with six real humans:
the six crew members are fresh testnet accounts with personas, created and
operated by scripts. What IS real: every step went through genuine Sputnik
DAO proposals, real council votes, a real DAO-funded `create_round`, and
real onchain settlement. A round with actual humans still needs Isaiah to
bring the people — see `LIVE_ROUND.md`.

### Crew (fresh testnet accounts, 10 NEAR each from the helper faucet)

| member | account | work in the cooperative |
|---|---|---|
| Ada | `ada-fairshare.testnet` | freezer temperature log and the books |
| Emeka | `emeka-fairshare.testnet` | delivery bike, collects fish from the jetty |
| Fatima | `fatima-fairshare.testnet` | collects stall rent, chases late payments |
| Ibrahim | `ibrahim-fairshare.testnet` | repairs the freezer and the generator |
| Ngozi | `ngozi-fairshare.testnet` | buys stock at wholesale, negotiates prices |
| Tunde | `tunde-fairshare.testnet` | night watch and cleaning, guards the stall |

Keys only in `.testnet-fairshare-accounts.json` (chmod 600, gitignored).

### What happened, step by step

1. **Six AddMemberToRole proposals (#0–#5)** — proposed by the owner
   (`fairshare-owner.testnet`, 1 NEAR bond each, returned on approval),
   voted by the existing 6-member demo council. Threshold is a STRICT
   majority: e.g. proposal #2 needed 5 of 7 votes, #4 needed 6 of 10.
   All six passed; council grew 6 → 12.
2. **Funding proposal #6 (FunctionCall)** — DAO calls `create_round` on
   `fairshare-contract.testnet` with round 2 and a 5 NEAR deposit.
   Proposed by the owner. First attempt FAILED onchain (tx
   `HkEZRVyuKooMui9yPDj2wDCfPcFKWon5BX2BBqu9jMBf`): the `ActionCall`
   `gas` field was passed as a JSON integer, Sputnik expects a string.
   No proposal was created; only gas was lost. Fixed and re-proposed as
   #6 (tx `BGBWhTQUM2D3MZQzRN6iAkTmDrT3CPTixYa5Wi5KA98K`). Six demo
   votes (exactly 1/2 of 12) did NOT pass — a 7th vote from Ada
   (`Cu4UqfKntuLtUyw5arqitXGfWfdYbMCM9aAPAFPy2AkQ`) approved it and
   round 2 was created with the 5 NEAR envelope. DAO balance after
   funding: 0.2591 NEAR available — the DAO is nearly empty now and
   needs a top-up before it can fund another round.
3. **`sync_dao_members`** (tx
   `Ah87M1UuRdaXx6aHqKD1PdoMty9xysH7Tbyv1VKJ27jW`) — contract members
   6 → 12, all six crew confirmed via `get_cached_dao_role`.
4. **Allocations** — each crew member spent all 100 points across 3
   recipients, reasons describing real work (see `demo-log-round2.json`).
5. **Close + settle** — owner closed (tx
   `4FBgHecs549qEiGshPCM8ZXjzdGsvT3dgR5PLNx3VEXG`) and settled (tx
   `6FsBf9r42Ji8afF8G6rebq2GqChmpUQW41cCpTuaodJF`) instead of waiting
   7 days.

### Settlement results (verified live via `explain_payout` + balances)

Scores match the contract's maths exactly (verified by an independent
integer model in `scripts/verify-round-2.mjs`). The 25% cap TRIGGERED
for the first time in a live round: Ada and Ibrahim both capped at
exactly 1.25 NEAR, the surplus redistributed to the others.

| member | score | payout (NEAR) | capped? | balance after (NEAR) |
|---|---|---|---|---|
| ada-fairshare.testnet | 33489 | 1.250000 | yes | 11.2492 |
| emeka-fairshare.testnet | 19600 | 0.869812 | no | 10.8696 |
| fatima-fairshare.testnet | 17689 | 0.785006 | no | 10.7848 |
| ibrahim-fairshare.testnet | 36100 | 1.250000 | yes | 11.2498 |
| ngozi-fairshare.testnet | 12321 | 0.546783 | no | 10.5465 |
| tunde-fairshare.testnet | 6724 | 0.298399 | no | 10.2982 |

Total score 125923. Payouts sum to envelope minus 3 yocto. Every
member's balance is 10 NEAR (faucet start) + payout − gas (under
0.001 NEAR each), so the transfers really landed.

### Two bugs found and fixed during this run

- **ActionCall gas must be a JSON string** in Sputnik FunctionCall
  proposals (`"100000000000000"`, not `100000000000000`). The contract
  deserializes `gas` as a string (near-sdk U64). One failed proposal
  attempt, fixed in `scripts/live-round-2.mjs`.
- **`act_proposal` takes the full proposal kind** in current Sputnik v2
  (post-#217): `(id, action, proposal, memo)`. The old `(id, action,
  memo)` form fails. The script tries new-style first and falls back to
  old-style only on an argument error. New-style worked on the live DAO.
- **Verification-model bug (script only, not the contract):** the
  expected-score model discounted mutual points in place, so the second
  leg of a pair used the already-discounted value and over-scored Ada
  (36481 vs the contract's correct 33489). Fixed to compute discounts
  from a snapshot of the original points; `scripts/verify-round-2.mjs`
  re-verified every score exactly.

### What is NOT done (needs Isaiah or a follow-up)

- **Live round with real people**, **GitHub push**, **hackathon
  submission**: need Isaiah's separate explicit approval. The repo
  https://github.com/fairshare54/fairshare already exists (public,
  empty); nothing pushed yet.
- **Lead question**: FairShare is the fourth project (Genesis, PAC,
  VeilProof, FairShare); one person can lead at most 2, so it needs a
  different lead or Genesis to wait.
- DAO treasury is nearly empty (0.2591 NEAR available) after funding
  round 2 — top it up before any round 3.
- The 6 demo members are still on the council alongside the 6 crew
  (12 total). They did not allocate in round 2, but they can still vote.
  Removing them takes one RemoveMemberFromRole proposal each.

## History — first live demo (superseded, kept for the record)

- Contract `egbe-contract.testnet`, owner `egbe-owner.testnet`,
  planned DAO `egbe-dao.testnet` (never created).
- Deploy tx `8MgasF8FP1Tv4YebR9Y2ks5RgwffkwnE6dNkmYgZaHy1`, init tx
  `E7pDbVrhm4sM3PYVStD4uLpgo9N9ah3yF7FvA46ABHkh`.
- Demo round 1, 5 NEAR, 6 demo members (alice-egbe .. frank-egbe),
  settled tx `DA2DciS2KXhcsinnHZParpDTRcvZBmgKB4PpKJLdiEMr`, same
  worked-example scores (total 130468), payouts summed to envelope
  minus 3 yocto. Membership was owner-seeded (`add_member`); no DAO.
- Burned name: `egbe-round.testnet` was created by the helper on
  2026-11-08 but its keypair was lost when the first account script died
  on a too-fast finality check before writing the file. Nobody holds its
  key; do not use that name.
