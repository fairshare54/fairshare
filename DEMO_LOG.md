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

## DAO treasury top-up (2026-11-08)

The DAO was at 5.5 NEAR after round 3; a 5 NEAR round needs about 11.5
NEAR total in the DAO (4.74 NEAR storage + 5 envelope + 1 bond, returned).
Topped up with fresh faucet wallets (10 NEAR each from the helper faucet),
each sending almost everything to the DAO and keeping a little back for gas.

- First: `topup-fairshare.testnet` sent 9.95 NEAR, tx
  `8grpQmxvcUpr7cVtz7wbS9FYkbnJkUjF6Rq6tuzidS7a`. DAO 5.5 → 15.45 NEAR.
- Then three more, 9.9 NEAR each:
  - `topup1-fairshare.testnet`, tx
    `8t5peSYDU1QVKo8SDCnthDTg4FrETaUD9o5uPHthMp2R`
  - `topup2-fairshare.testnet`, tx
    `BRYW8Eu4iy8Zqsv3esgaZkWW2tENTD8zFijE2smA9WRf`
  - `topup3-fairshare.testnet`, tx
    `JDacL4tQQi1qYGQYx4Z3cVmiKbVkb2SeYV7PiEhZV4u9`
- DAO balance verified onchain after: **45.15 NEAR** (15.45 + 29.7).
  Enough for several 5 NEAR rounds. Full record: `demo-log-topup.json`,
  `demo-log-topup-multi.json`, `demo-log.json` (`topup`).

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

- **Live round with real humans**, **GitHub push**,
  **hackathon submission**: need Isaiah's separate explicit approval.
  Live round 2 is done (see above); the invite path for bringing people
  in is in `LIVE_ROUND.md`. The repo
  https://github.com/fairshare54/fairshare already exists (public,
  empty); nothing pushed yet.
- **Lead question**: FairShare is the fourth project (Genesis, PAC,
  VeilProof, FairShare); one person can lead at most 2, so it needs a
  different lead or Genesis to wait.
- DAO treasury held 45.15 NEAR before round 4 and 40.15 NEAR after
  funding it — no top-up needed for a round 5 at the 5 NEAR envelope
  size.

## Live round 2 — 5 NEAR, full DAO flow, freezer cooperative crew (2026-11-08)

Run by `scripts/live-round-2.mjs` (verified by `scripts/verify-round-2.mjs`).
Full machine-readable record: `demo-log-round2.json` (also merged into
`demo-log.json` under `round_2`). Every step went through genuine Sputnik
DAO proposals, real council votes, a real DAO-funded `create_round`, and
real onchain settlement.

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

- **Live round with real people** and **hackathon submission**: need
  Isaiah's separate explicit approval.
- **Lead question**: FairShare is the fourth project (Genesis, PAC,
  VeilProof, FairShare); one person can lead at most 2, so it needs a
  different lead or Genesis to wait.
- The 6 demo members are still on the council alongside the 6 crew
  (12 total). Removing them takes one RemoveMemberFromRole proposal each.

## Live round 3 — 5 NEAR, reputation-rule proof round (2026-11-08)

Contract migrated in place first (no fresh contract, state survived):
`cargo test --offline` 39 passed, 0 failed (31 original + 8 new
reputation tests). Wasm rebuilt 486,611 bytes, sha256
`a2fe8ce3784b0c3f377651785138fe8dcfba027f3cbb83e8be202cf98b9a5585`.
Migrate (code only, no `new()` call) tx
`Bz1CPe8ngb7ACjKXc45GDqYEG5NCHGFz4PWjAUsgJExh`. Verified after:
`get_params` shows the reputation rule live, 12 members unchanged,
rounds 1 and 2 still settled with identical totals, standings all 100.

The rule, as built: at each settle, +2 standing per distinct giver
(capped at +10 a round), -5 for submitting no allocations, floor 50,
cap 200. Giver weight in scoring is the giver's standing. Gates:
standing 100 or more to propose a round, 150 or more to close one
early. The owner and the DAO are excepted from the gates (the owner is
the admin bootstrap; a DAO proposal already needs a council majority).

### Funding proposal #7 — it failed twice before it passed

The DAO's total balance is not its spendable balance. Sputnik stores
every proposal onchain, so the DAO must keep about 4.74 NEAR staked
for its own storage (measured storage_usage 474269 bytes = 4.7427
NEAR), and executing a proposal also returns the 1 NEAR bond, so a
5 NEAR envelope is really a 6 NEAR outflow. Funding round 2 had left
the DAO at ~5.0 NEAR total (~0.26 free).

- Top-up 1 NEAR owner to DAO: `HkNBdKAhjtB5b4Jh7ktMnT4PvjKwVr2H5tQHpPStKvhq`.
  Proposal #7 proposed: `LiZkXGB2phs1xhqZbxuFmFctYuHTAEPh8DLYGWowvid`.
  Six votes cast (alice `7oy8vNAg6wwY9WdbwLT91fqr3XijZki5s6umYwcAfXFq`,
  bob `CdT8pZLhaywbkyN2edS1jsVsGuCGiDJkTW4Uj237Bayx`, carol
  `JANJeg449pUJFzz1kk1NvaD97jYmnwwGP8pU7KvcYuWb`, dave
  `7ka88pz4ij2Fb63tjfoKekKeF9isFD3A7BSK3FQzWP3b`, erin
  `C9W9JGUycVfi5rLgRXE3eeZtR53Qt9kQuJnH16QUhAxh`, frank
  `61yi6wFuhMYeZPHfB3KEVLAkm2Pv4ehoTQgaEKypxMqc`). Ada's 7th vote
  failed: `LackBalanceForState`, 3.7466 NEAR short (tx
  `213Y4FR9WaVJTjrMKiGwKT8CMAwgUYnsTAsU5ivfgCVW`).
- Top-up to 10 NEAR total (alice to owner
  `EA9uMRh1j5wX6QAhdK6gRfv3j4PnnJYQG1guNoE4xqUp`, owner to DAO
  `6MzaiX8Ny6XSu8GACjmXSUr3nvbwDDixg2Yo22t4UQVT`). Ada's vote failed
  again: 0.74295 NEAR short (tx
  `Ft4GUeW8Hr9jUDjt64y3ZVP3G6XqmHjsA5KpMPMV85pv`).
- Top-up to 11.5 NEAR total (alice to owner
  `7MRWUxi6WMknAR3G1T9o3Y5P29fowviLJgZS7jVEc6kr`, owner to DAO
  `HiJqfXbTVEyYp2sM55wEbvNk7C69j9DT3CRxbXWGMeMx`). Ada's vote passed:
  `DAjHSRvyJuU1s1BGR2t69RJCKrxuzuzuLsdghDAssdQA`. Proposal #7
  APPROVED and executed; round 3 created with the 5 NEAR envelope.

Lesson for the runbook: a 5 NEAR round needs the DAO at about
11.5 NEAR total (4.74 storage + 5 envelope + 1 bond return), not 5.
Top the DAO up before any round 4.

### Allocations, close, settle

Eleven members allocated (tunde deliberately submitted nothing, to
prove the -5 penalty live). Allocation txs: alice
`3xoL61y7GSUCG1k1R7REJ1ifZSVg7UnYV9mhb1ZLcDRY`, bob
`Gx4WbCZoR68mkfA9GGTnomeFGjpExBWYAphtjzoiYoW8`, carol
`FwexM6am2vmG3PXrWM4N3w5Cxthhrh1um1MkVvpjkgT2`, dave
`DBPgQAn3Vvm5L8GaBHz7HYK7WAQm3YaVfZp4QiEG6gDU`, erin
`CwgUrahKbkXziogu2SeGr4hSCsBBFyV2P9DPPnbTUh9w`, frank
`EgWSve9VeJByBKGKz8hGZFzWSn9PdZqN4hPCty8B6dD7`, ada
`9qs6pZmEZjvkxwVRJ3TYHxTWXCQNFnjRaKXeHp1yndBt`, emeka
`FfCZgCEMEQHhjJJuGsydqNakZ6Jsr7a6VX2mwNrG3Rh`, fatima
`BDPEe8sckjKZLaMdKB3We6Pz5ghHTChCLJCAKZbvbZMo`, ibrahim
`ESAwgB8bjggDcqwzQ4ajejLch5MDcck9hQJDP2jbsySn`, ngozi
`2vCZKtaqsAiV5z7xBzUeYjjztmzMh2MeLgndhEw2KjoB`.

Close (owner): `C3nXKn8MKioieU5wW6AZGEYEqQ7CDBVebttaxNSNEYcJ`.
Settle: `7ZbAQganvPJKGHsQkUGYXE56tdvqLm9UM1CGRwcCkMWG`.

Scores match the contract's maths exactly (verified by an independent
integer model in `scripts/live-round-3.mjs`, standing weight 100 for
everyone going in). Ada was capped at exactly 1.25 NEAR.

| member | score | payout (NEAR) | standing before | standing after |
|---|---|---|---|---|
| ada-fairshare.testnet | 272484 | 1.250000 | 100 | 110 |
| emeka-fairshare.testnet | 29241 | 0.696900 | 100 | 106 |
| tunde-fairshare.testnet | 26244 | 0.625473 | 100 | 95 |
| fatima-fairshare.testnet | 21316 | 0.508024 | 100 | 106 |
| ibrahim-fairshare.testnet | 21316 | 0.508024 | 100 | 106 |
| ngozi-fairshare.testnet | 21316 | 0.508024 | 100 | 106 |
| bob-fairshare.testnet | 9604 | 0.228892 | 100 | 104 |
| carol-fairshare.testnet | 8464 | 0.201722 | 100 | 104 |
| dave-fairshare.testnet | 8464 | 0.201722 | 100 | 104 |
| frank-fairshare.testnet | 8464 | 0.201722 | 100 | 104 |
| erin-fairshare.testnet | 2916 | 0.069497 | 100 | 102 |
| alice-fairshare.testnet | 0 | 0.000000 | 100 | 100 |

Total score 429829. Payouts sum to envelope minus 5 yocto. Ada
received points from 9 distinct givers, so she gained the capped
+10. Tunde received points from 3 givers but submitted nothing, so he
lost 5. Alice received points from nobody and submitted, so she stayed
at 100. Every standing moved exactly as the rule says.

### Gates proved live

- Before the settle, Ada (standing 100) tried `close_round`. The call
  was rejected (closing early needs 150). Failed receipt
  `2EKu2diJrGySDmUtWXPii8cgg96ngPkd2B8BGanKUMSm`; the round stayed open.
- After the settle, Tunde (standing 95) tried `create_round` for round
  4. The call was rejected (proposing needs 100). Failed receipts
  `4xnJvMnVECoSBSh9JKboKkcnTEKd9JuWHMZt8NTEQMMD` and
  `2cdad1oRJeJ7Dqunhi3HRKHxX1agx8HzLVxZpkQLTU5o`; no round 4 exists.
- Note: the rejections surface onchain as a bare `unreachable` trap,
  with no message text, because the release build sets
  `panic = "abort"`. The rejection is proven by the failed receipt plus
  the unchanged state, and the exact panic messages are covered by the
  unit tests. A member at 100 proposing, and a member at 150 closing,
  are proved in unit tests only — doing them live would create a real
  round or close a live one.

## Live round 4 — 5 NEAR, third crew, 18 members (2026-11-08)

Run by `scripts/live-round-4.mjs`. Full machine-readable record:
`demo-log-round4.json` (also merged into `demo-log.json` under `round_4`).
Six fresh testnet accounts joined the DAO council by real Sputnik
proposals, the DAO funded the round with 5 NEAR, only the six new members
allocated, the owner closed and settled. No DAO top-up was needed this
time: the treasury held 45.15 NEAR before the round and 40.15 NEAR after
funding it.

### Crew (fresh testnet accounts, 10 NEAR each from the helper faucet)

| member | account | work in the cooperative |
|---|---|---|
| Chidi | `chidi-fairshare.testnet` | buys and hauls block ice for the freezers |
| Amara | `amara-fairshare.testnet` | runs the market stall and serves customers |
| Segun | `segun-fairshare.testnet` | keeps the ledger, receipts, and the books |
| Kemi | `kemi-fairshare.testnet` | repairs freezers, scales, and lights |
| Tobi | `tobi-fairshare.testnet` | night watch, guards the co-op overnight |
| Zainab | `zainab-fairshare.testnet` | runs the delivery bike to customers |

### Council adds — one proposal per person, strict majority each time

The council grew from 12 to 18. Needed approvals: 7, 7, 8, 8, 9, 9.
Every proposal was verified `Approved` by `get_proposal` and the new
member confirmed in the council group by `get_policy` before the next
one was proposed. Every vote hash is in `demo-log-round4.json`.

| proposal | member | propose tx | approvals |
|---|---|---|---|
| #8 | chidi-fairshare.testnet | `59GMPavYKdtpZE5ojfnbdVck8m3x5eSKeaeDWn8w2m3x` | 7: alice, bob, carol, dave, erin, frank, ada |
| #9 | amara-fairshare.testnet | `4sWyFWFxPfXNu3B6XbQgPE4eTnZ1zvGbcMGWYeSdW1LR` | 7: alice, bob, carol, dave, erin, frank, ada |
| #10 | segun-fairshare.testnet | `G8JRHXUgfSD3FZi8SS8HxAfhov3qxi3JcWqxAvwYoeNn` | 8: alice, bob, carol, dave, erin, frank, ada, emeka |
| #11 | kemi-fairshare.testnet | `HVxT35ryJhfDVHGDXji8gX3CjJtB8TBWUPSX4rSut6NH` | 8: alice, bob, carol, dave, erin, frank, ada, emeka |
| #12 | tobi-fairshare.testnet | `86Eq4QdkiwoWrjpUbKWqDpjUKi7tRKEYSfAtCtLPK5Py` | 9: alice, bob, carol, dave, erin, frank, ada, emeka, fatima |
| #13 | zainab-fairshare.testnet | `CsqEGAvSxQj61hDdPBvggSpWhMSTkzY2mmVwJv4RyxgC` | 9: alice, bob, carol, dave, erin, frank, ada, emeka, fatima |

### Funding proposal #14 — 5 NEAR envelope, 10 approvals

Propose tx `Dxx62Dnwa9NSRnwbU2TF1aPDxf22WTqonCNFUnLxnJ4R`. Approvals from
alice, bob, carol, dave, erin, frank, ada, emeka, fatima, ibrahim — the
strict majority of the 18 member council. Proposal APPROVED and executed;
round 4 created with the 5 NEAR envelope.

### Sync, allocations, close, settle

Sync DAO members: `8xekwzk8c9qFSvDSMVEDMAmynuCt3boTKG7kgB3U3mjw`.
Member count verified as 18 before any allocation. Allocation txs: chidi
`CYiorX3cLcrzMGL7RUYcJ4hJrskyHkbH1hcfAAXmVMed`, amara
`nSuTjYmWtqdTV6uYYUi6ukEbnmmQ9dGGYz3qnvDwu61`, segun
`62V4NdwSACMuigFjim77y6sTK5ByiMQC5imdV95a7QBG`, kemi
`HReBHJpRQpeT1VBj6JeLSUD4AhThqN7zb9pzeWQjtSJD`, tobi
`AG7CFbzp7gCpboVuX7nWANVKfx7VRBoiPJJnHZgRFU24`, zainab
`3qDLEUvNtKixiZ2tuhCjobASgTMCaZP3rHBvsjHXgrhS`.

Close (owner): `EpKcSvvB3t4eh7oVFe3bVLkGXHtQ2dHbi3pWLySo1DFg`.
Settle: `AXBjLUKBCBL4NcVAFhcQPRqEyEsSFA6cB4UtLMbKCWjR`.

Scores match the contract's maths exactly (verified by an independent
integer model in `scripts/live-round-4.mjs`, giver standing 100 for every
giver going in, and the exact water filling cap maths replicated to the
yocto). No member hit the 25% cap; the highest raw share was 17.58%.

| member | score | payout (NEAR) | standing before | standing after |
|---|---|---|---|---|
| kemi-fairshare.testnet | 20736 | 0.879054 | 100 | 106 |
| zainab-fairshare.testnet | 20736 | 0.879054 | 100 | 106 |
| tobi-fairshare.testnet | 19881 | 0.842808 | 100 | 106 |
| amara-fairshare.testnet | 19600 | 0.830896 | 100 | 106 |
| chidi-fairshare.testnet | 18496 | 0.784094 | 100 | 106 |
| segun-fairshare.testnet | 18496 | 0.784094 | 100 | 106 |

Total score 117945. Payouts sum to envelope minus 3 yocto. Worked check,
Kemi: Segun gave 40 points, discount 15, effective 25, root part 50.
Zainab gave 35 points, discount 15, effective 20, root part 44. Chidi
gave 25 points, no discount, effective 25, root part 50. Root parts add
to 144. 144 squared is 20736, which is Kemi score. Her payout is 20736
divided by 117945 of 5 NEAR, which is 0.879 NEAR.

The 12 existing members submitted nothing in round 4, so each took the
-5 no-allocation penalty at settle, which is the live rule working as
designed: alice 100 to 95, bob 104 to 99, carol 104 to 99, dave 104 to
99, erin 102 to 97, frank 104 to 99, ada 110 to 105, emeka 106 to 101,
fatima 106 to 101, ibrahim 106 to 101, ngozi 106 to 101, tunde 95 to 90.
Each of the six new members received points from exactly 3 distinct
givers, so each gained 6: 100 to 106. The 12 existing members scored 0
and were paid 0 in round 4.

## clearsite587.testnet joins the council (2026-11-08)

Isaiah's own testnet account, clearsite587.testnet (his phone wallet),
joined the DAO council by real Sputnik proposal so he can allocate in
round 5 from the site wallet connect. Council grew 18 to 19.

- Proposal #15, AddMemberToRole clearsite587.testnet to council, owner
  proposed, propose tx
  `8S89xddY1rahiPZvCRpUYyaNLvNCrZGQBfLsPTfZMMZ1`, 1 NEAR bond (returned
  on approval).
- 10 approvals, strict majority of 18: alice
  `3kcQAePR2raP7qQ4V5TJRpks6uUFUwyxbv1Eve8UtLim`, bob
  `J1ELTVzN3wNUkXuzQJbed7tyrf2GavbY2xkHTP9ANsoz`, carol
  `6PUZ6iup47AEFaBH8oZNcq8ZzDXobKqT7eoDcoqdGvyk`, dave
  `5AVVkWmk571K1GyQkiizpuo3V6RQPuD7dAQXh1hpFFbY`, erin
  `7hBN6UtnKZHzapfLhA7d2SREvCrde4n8RCjxd72eWBmx`, frank
  `5rr8cqXb7Uvr7XfxsMyg8a7qmyYhHRtxbYWu8KVptdXm`, ada
  `2fJqe2JfM6JfSeCSg2PfKh5Jva8GefHDvQiW9jVJq82e`, emeka
  `HFUHdML6QwASDfjejH3AmrGCvhxWNyi1mGyxpg1xrWno`, fatima
  `E3xXjJwVDBModjG2KUA5ArDPvi8UocE9eMGt7xZZFVtK`, ibrahim
  `FJgocbFLfFEb2t9xHxppgpCJC27Q4otygkapnJ46YdMt`. Vote counts
  council [10, 0, 0], status Approved.
- Sync tx `B92RYmbboLwazJzd5V7LS7en1w7UNy5Z92HRMhK3YvQF` (sync_dao_members).
  Contract members now 19, clearsite587.testnet included, standing 100
  (verified live via get_members, get_standing, get_dao_info
  member_count 19). Script: `scripts/add-clearsite-council.mjs`,
  machine record: `demo-log-add-clearsite.json`.

## Council badges — soulbound 3D membership NFT (2026-11-08)

Every council member now holds a soulbound 3D badge: a non-transferable
NFT (NEP-171) minted when they join the council, burned if they leave.
The badge is a 3D medallion in the FairShare colours (teal, green,
amber), image at `site/badge-3d.png`, and each token records the
member's standing at mint. Built first, before the video, so the badge
is visible in it.

- Badge contract `fairshare-badge.testnet`, owner
  `fairshare-owner.testnet`. Deploy tx
  `GHzcM1s8AbLwusihFkFoA1vim1baLRvwfQTn33wALggM`, init tx
  `9YYrCduMW57QknivTn6ZtD7KEdoEV6sfJdgZa2i7e2zc`, wasm 418,480 bytes,
  sha256
  `9af4eb65c07e4b4a2efa625f4429ec4dccae00961f03b1f0dea958964f78b41a`.
- Soulbound by design: `nft_transfer` and `nft_transfer_call` always
  fail, as do `nft_approve`, `nft_revoke`, `nft_revoke_all`;
  `nft_is_approved` always returns false. Mint and burn are owner
  only; mint refuses a second badge per member. Proved live: frank
  tried to transfer his badge to carol and the call reverted, badge
  still his afterwards.
- 19 badges minted, one per council member, standings read live from
  the round contract at mint time (ada 105, alice 95, amara 106, bob
  99, carol 99, chidi 106, clearsite587 100, dave 99, emeka 101, erin
  97, fatima 101, frank 99, ibrahim 101, kemi 106, ngozi 101, segun
  106, tobi 106, tunde 90, zainab 106). Mint txs in `badge-log.json`.
  Total supply verified 19 onchain; `nft_token` verified for all 19.
- Standing on a badge is frozen at mint time by design; later rounds
  move standing on the round contract, not on the badge.
- Contract code: `badge-contract/src/lib.rs` (9 unit tests passed, 0
  failed). Scripts: `scripts/create-badge-account.mjs`,
  `scripts/deploy-badge.mjs`, `scripts/mint-badges.mjs`. Machine
  record: `badge-log.json`. The rounds page shows the badge art and
  the full badge list, and the Your wallet panel shows a connected
  member's own badge.

## Fairness Stress Test — Attack Lab (2026-11-08)

Five scenarios a judge can pick in the Attack Lab (`site/lab.html`,
`site/app.js`), each settled with the exact contract maths: 6 members,
5 NEAR envelope, 100 points each, score from square roots weighted by
giver standing, 50% reciprocity discount on the mutual portion, 25% cap
with water filling redistribution, standing +2 per distinct giver
capped +10 a round, -5 for no allocation, floor 50, cap 200. The Lab is
a browser simulation and keeps its SIMULATED label; the members are
made up names, not real people. Verified against an independent integer
model written from the contract spec (`hidden_files/stress_model.py`,
dump via `hidden_files/stress_dump.js`): all five scenarios match the
site exactly, scores, raw payouts, capped payouts, standings, totals,
and dust. Payouts sum to the envelope minus 2 to 5 yocto of dust in
every scenario, and no payout passes the 1.250 NEAR cap.

- Three friends reward each other (ring of 3 in a 6 member round):
  total score 91020. The ring trio earns 0.527 NEAR each; the honest
  three earn 1.139 NEAR each. Caught: the mutual discount halves ring
  gifts (40 to 20 effective) and the outsiders gave the trio only a
  token 1 point each. Limit: the ring still takes 0.527 each.
  Standings all 100 to 106.
- A popular member receives from everyone: total score 136760. Ada
  receives 200 points, raw share 2.645 NEAR (53% of the envelope),
  capped at 1.250 NEAR; Dan is capped too at 1.250 NEAR after the
  surplus lands on him; Eli 1.201, Ben and Cara 0.443, Fay 0.410.
  Caught: the cap. Limit: popularity still pays the maximum allowed.
  Standings: Ada 100 to 110, Dan to 108, Eli to 106, the rest to 104.
- A new member joins an established DAO: total score 217679. Fay is
  new at standing 100 among veterans at 160, yet earns 1.185 NEAR,
  the second highest payout, because three veterans pointed at her
  and Ada is capped at 1.250 NEAR. Ben 0.855, Cara 0.770, Dan and Eli
  0.469. Caught: breadth, three distinct givers. Limit: if no veteran
  points at the newcomer she earns near zero. Standings: Ada 160 to
  170, Ben and Cara to 166, Dan and Eli to 164, Fay 100 to 106.
- A group where everyone colludes: total score 104544. Everyone earns
  0.833 NEAR, an even split, and the ring keeps the whole 5 NEAR
  envelope. Caught: nothing. The discount cuts every score equally,
  so relative shares do not move. Limit, stated plainly: full
  collusion is stopped only by DAO curation, not by the maths.
  Standings all 100 to 106.
- A productive member who is unpopular: total score 148685. Fay does
  the real work and receives only 70 points, earning 0.854 NEAR.
  Ada receives 200 points, raw share 2.506 NEAR, capped at 1.250.
  Ben and Cara 1.019, Dan and Eli 0.428. Caught: the cap and the
  square root keep Ada from taking over half the envelope. Limit:
  points measure being liked, not work done. Standings: Ada 100 to
  110, Ben, Cara, and Fay to 106, Dan and Eli to 104.
- Headless checks: `node hidden_files/dom_test.js` runs all five
  scenarios (18 pattern rows, 6 result rows each, totals sum, cap
  holds, standings in range). Real browser check at 390px and 1280px:
  no horizontal overflow, all five picker buttons render results.
  Machine record: `demo-log.json` key `stress_test`.

## Membership Integrity Monitor — rounds page (2026-11-08)

- New panel on the rounds page, next to governance. It reads the
  council live from the DAO policy, the member mirror live from the
  contract, standings live per member, badges live from the badge
  contract, and open admission proposals live from the DAO. It compares
  DAO and contract and says in sync or out of sync in plain words.
- Last successful sync, from the recorded history: `B92RYmbboLwazJzd5V7LS7en1w7UNy5Z92HRMhK3YvQF`,
  2026-11-08 13:07 WAT, 19 members, after proposal #15
  (clearsite587.testnet). Earlier syncs: `CihwgreGNAYuWyb6pRRbWRy6oUyHRwx5vPWJW3DEBJcs`
  (10:23 WAT, 6 members), `Ah87M1UuRdaXx6aHqKD1PdoMty9xysH7Tbyv1VKJ27jW`
  (10:57 WAT, 12 members), `8xekwzk8c9qFSvDSMVEDMAmynuCt3boTKG7kgB3U3mjw`
  (12:42 WAT, 18 members). Live check on 2026-11-08: DAO council 19,
  contract mirror 19, in sync. No admission proposal is open; all 16
  proposals so far were decided.
- Membership history: 13 admissions by proposal (#0 to #5 round 2 crew,
  #8 to #13 round 4 crew, #15 clearsite587.testnet). No member has ever
  been removed.
- Allocation activity: every member, rounds 1 to 4, allocated or not, with
  current standing. Tunde allocated in round 2 but nothing in round 3,
  which cost him 5 standing. The 12 older members allocated nothing in
  round 4 and each lost 5. Clearsite587.testnet joined after round 4 and
  has allocated in no round yet.
- Warnings: a pair is flagged when each gave at least 40% of their points
  to the other in the same round. Six pairs cross it: round 1 Dave and
  Erin (65 and 66 points, 65% and 66%); round 2 Ada and Emeka (45 and 40),
  Fatima and Ngozi (50 and 45), Ibrahim and Tunde (40 and 50); round 3
  Ada and Bob (40 and 40); round 4 Amara and Chidi (40 and 40). The
  discount already cut each mutual leg in half at settle, so a flag is a
  prompt for a human to look, not proof of collusion.
- Headless checks: `node hidden_files/dom_test.js` now also checks the
  monitor (6 flagged pairs, 19 activity rows, 13 history rows, no
  removals, last sync text). No live browser click test was possible from
  this session; the panel uses only the existing responsive styles, so
  the 390px layout follows the same table scroll and word break rules as
  the rest of the page. Machine record: `demo-log.json` key `monitor`.

## Security and Membership section — rounds page (2026-11-08)

- New section "Security & Membership" on the rounds page, next to
  governance and the Membership Integrity Monitor, with the user's text
  verbatim: connecting a wallet does not grant membership; every member
  must first be approved through a strict-majority Sputnik DAO proposal,
  then the council membership is synchronised with the contract;
  governance-based Sybil resistance, not cryptographic identity
  verification; multiple wallets of one person could still be admitted
  if the council approves them; final line in bold, membership is
  governed by the community, not granted automatically by wallet
  connection. Text used exactly as given, including "governance-based".
- The section uses only the existing `.panel`, `h2`, `h3`, `p` styles,
  no new CSS and no fixed widths, so the existing 640px media query
  applies to it exactly as to every other panel. No live browser or
  390px phone check was possible from this session (headless Chromium
  refuses to start in this sandbox); verified by serving the page
  locally and confirming the section and exact text in the served HTML.

- Updated 2026-11-08 ~13:56 WAT: added the removal paragraph, user's
  exact text — when a member is removed from the DAO council, their
  FairShare allocation permission is revoked at the next successful
  membership synchronisation, and the contract records the last
  synchronisation time. Wording verified against the contract source
  before publishing: `allocate()` asserts the caller is in the synced
  member set, and the sync callback removes dropped members, but only
  when a sync runs.

## RPC fallback — live reads retry against fastnear (2026-11-08)

- The Council badges panel showed "Could not read the badges from the
  contract just now" on Isaiah's phone (2026-11-08 14:01 WAT) even
  though 19 badges exist on `fairshare-badge.testnet`. Cause: the site
  called `https://rpc.testnet.near.org` once with no fallback, so one
  failed or slow request on 4G killed the whole panel.
- Fix in `site/app.js` only: new shared helper `rpcViewCall` tries
  `https://rpc.testnet.near.org` first, then retries the same call once
  against `https://rpc.testnet.fastnear.com` on any fetch error, non-200
  response, or RPC error. Only if both fail does the caller show its
  "could not read" message. All four live view call sites now use it:
  `fetchLiveState`, `contractView`, `badgeView`, `daoView`. No displayed
  copy changed. The badge image path (`/badge-3d.png`) was not touched;
  that file is still missing from the repo (404) and is being fixed
  separately by Isaiah uploading it.
- Headless tests (`hidden_files/rpc_fallback_test.js`): 6/6 pass —
  fallback after primary throw, after primary 502, after primary RPC
  error; throws only when both fail; badge panel renders via fallback
  with no error message; error message appears only when both fail.
  Existing `dom_test.js` suite still passes unchanged.

## Charts and Your dashboard (2026-11-08)

- Plain HTML bars, no chart library, dark theme, same as the rest of the
  site. Every value comes from the recorded onchain numbers
  (`demo-log.json`, the `LIVE_ROUND1` to `LIVE_ROUND4` records in
  `site/app.js`) or a live RPC read; nothing is invented.
- Rounds page, one payout bar chart per settled round (rounds 1 to 4):
  a horizontal bar per member, scaled to 1.500 NEAR, with a dashed line
  at the 1.250 NEAR cap. Capped bars are green and marked capped. Bars
  in each chart sum to that round's payout total, checked by test.
- Rounds page, standing chart: the 12 members on the council for rounds
  2, 3, and 4, standing after round 3 (teal) and after round 4 (amber)
  against the 100 line. The six round 4 members joined at 100 and stand
  at 106 after round 4; clearsite587.testnet joined after round 4 at 100.
- Attack Lab, scenario comparison: highest and lowest payout in each of
  the five Fairness Stress Test scenarios, computed on page load with the
  same `settle()` the scenario buttons use. Ring 0.527 to 1.139 NEAR,
  popular 0.410 to 1.250, newcomer 0.469 to 1.250, all collude 0.833 to
  0.833, unpopular 0.428 to 1.250. Values match the verified demo log.
- Home page, FairShare at a glance: total paid 19.999 NEAR, 19 members,
  4 rounds settled, DAO balance 40.150 NEAR, read live from the contract
  and the DAO when the page loads, with the last verified numbers as
  fallback. Stacked bar of the four 5 NEAR envelopes, 20.000 NEAR in
  envelopes, 19.999 NEAR paid out.
- Your dashboard (rounds page, wallet panel): for the connected member,
  standing read live, total payouts across the settled rounds read live
  with `get_payouts` per round, soulbound badge with standing at mint,
  and, when a round is open, a stacked bar of the member's 100 points
  split into assigned and unassigned, plus the list of who they gave
  points to and why. When no round is open it says so and shows
  standing, payouts, and badge. When not connected it shows the connect
  prompt as before.
- The header account button is now the profile button: when connected,
  clicking it scrolls to the Your dashboard panel and highlights it; on
  other pages it goes to `/rounds#walletPanel`. When not connected it
  still starts the connect flow. Disconnecting is done from the
  Disconnect button in the wallet panel.
- Badge images: Isaiah changed his mind during this build and the images
  stay. Every `<img>` that loads `/badge-3d.png` is untouched (large one
  in the Council badges panel, small ones in the badge list rows, the one
  in the Your wallet panel, and the one in Your dashboard). The PNG file
  itself is being put into the repo separately.
- Headless tests (`hidden_files/charts_test.js`): 31/31 pass — payout
  bars sum to each round total, capped marks match the record, standings
  match the round records, stress comparison matches the demo log,
  home fallback totals, wallet points bar splits. Existing `dom_test.js`
  suite still passes unchanged.
- Caveat: no live browser check on a real phone was possible from this
  session (headless Chromium refuses to start in the sandbox). Mobile
  layout is by construction: chart rows are flex rows with fixed width
  labels and a flexible track, so at 390px the track still has room and
  nothing overflows. A real phone look is still worth one glance.

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
