# FairShare — ownership you earn, not buy

FairShare is a NEAR Hackathon Social Money project: peer allocation of credit.
A Sputnik DAO funds a round, members give each other points for the work
they saw, and the contract settles payouts deterministically on-chain, with
every payout explainable giver by giver.

**Testnet only. Never mainnet. No private key is printed or committed
anywhere in this repo.**

Formerly named Egbe; renamed FairShare on 2026-11-08 because the name
should say what the work is.

## What is here

| Path | What it is |
|---|---|
| `site/index.html` + `site/app.js` | The single-page site. Plain HTML/JS, no build step. Simulated demo mode by default. |
| `contract/src/lib.rs` | The Rust contract (`near-sdk` 5.5), package `fairshare-round` v0.1.0, with 31 tests. |
| `contract/Cargo.toml`, `contract/Cargo.lock` | Contract manifest and lockfile. |
| `fairshare_round.wasm` | The built release WASM (484,794 bytes), copied here for deploy convenience. |
| `BUILD_LOG.md` | The contract builder's log: interface, math, tests, wasm. |
| `dao-log.json` | The Sputnik DAO creation record (deploy + init tx, council, config). |
| `hidden_files/dom_test.js` | A node DOM shim that exercises the site's buttons without a browser. |

## Run the site

Do X, see Y. From this directory:

```sh
cd site
python3 -m http.server 8000
```

Open `http://localhost:8000/`. The page loads in simulated demo mode:
a freezer cooperative round with 5 members, a 10 NEAR envelope, and the
allocations already in. Press **Settle this round** and the settlement
table appears; pick a member in **Explain my payout** to see their score
broken down by giver. Press **Run the ring vs honest comparison** in the
Attack Lab to see the collusion comparison.

No wallet is connected and nothing on the page can move funds. The live
mode section reads live state from the testnet contract (see Deploy below).

## Build and test the contract

```sh
cd contract
cargo test --lib        # 31 passed, 0 failed; takes ~60-80 s (the 200-round property test dominates)
cargo test --offline    # same suite, no network
```

Build the WASM (the command that works here; `cargo near build` refuses
without a TTY):

```sh
cargo build --target wasm32-unknown-unknown --release
cp target/wasm32-unknown-unknown/release/fairshare_round.wasm ../fairshare_round.wasm
```

## The demo loop, with example numbers

Demo round: Amina, Bola, Chidi, Dayo and Efe run one shared chest freezer.
Rental income lands in the treasury as a plain deposit. The envelope is
10 NEAR. Every member spends all 100 points across 3 recipients.

Settlement math (identical in the contract and in `site/app.js`):

- Effective points: for each mutual pair, the smaller of the two
  allocations is the mutual portion; 50% of it is discounted from BOTH
  directions, integer division, floor. Example: Amina gives Chidi 35 and
  Chidi gives Amina 40, so the discount is floor(35 / 2) = 17, and
  Chidi's gift to Amina counts as 40 - 17 = 23.
- Score = (sum over distinct givers of `isqrt(effective_points *
  giver_weight)`)^2. Giver weight is the giver's standing, which starts
  at 100 for everyone in this version.
- Payouts are proportional to score, capped at 25% of the envelope per
  member. Capped surplus is redistributed water-filling style to uncapped
  members. Whole-yocto division leaves a few yocto of dust in the
  contract.

Demo result (verified: the site's JS reproduces the contract's Rust
settlement exactly — see Verification below):

| Member | Score | Raw payout | Capped? | Payout |
|---|---|---|---|---|
| Amina | 16129 | 1.857 NEAR | No | 2.316 NEAR |
| Bola | 15876 | 1.828 NEAR | No | 2.279 NEAR |
| Chidi | 34596 | 3.984 NEAR | Yes | 2.500 NEAR |
| Dayo | 12996 | 1.496 NEAR | No | 1.866 NEAR |
| Efe | 7225 | 0.832 NEAR | No | 1.037 NEAR |

Total score 86822. Payouts add to 10 NEAR minus 2 yocto of dust.
Chidi's raw share (3.984 NEAR) exceeds the 2.500 NEAR cap, so the excess
flows to the other four in proportion to score, which is why Amina's final
payout (2.316) is above her raw payout (1.857).

Explain example — Amina's score, giver by giver:

| From | Points | Discount | Effective | Root part |
|---|---|---|---|---|
| Bola | 40 | 20 | 20 | 44 |
| Chidi | 40 | 17 | 23 | 47 |
| Dayo | 25 | 12 | 13 | 36 |

Root parts add to 127; 127 squared is 16129. That is the whole
explanation: no hidden inputs.

Attack Lab (the contract property test
`property_collusion_ring_earns_less_than_honest`, same 9 people, same
60 NEAR envelope, run in the page with the same maths):

| | Ring trio, per person | Other six, per person |
|---|---|---|
| Ring round | 3.506 NEAR | 8.246 NEAR |
| Honest round | 15.000 NEAR (capped) | 2.499 NEAR |

Honest giving earns the trio 11.493 NEAR more per person than the ring
did. The mechanism is visible in the numbers: 100 points arriving from
2 givers scores 19600, the same 100 points arriving from 5 givers scores
48400, and the reciprocity discount cuts every mutual leg in the ring by
half of the shared amount.

## Contract interface (exact names — the site is built against these)

Init and rounds:

- `new(owner_id, dao_id)` — init. Sets the owner and the Sputnik DAO.
- `create_round(round_id, envelope_yocto)` — payable; the attached
  deposit must equal the envelope exactly; only the owner or the DAO may
  call it. Deadline is creation + 7 days. `round_id` is a number.
- `close_round(round_id)` — owner only; lets a round settle early.
- `allocate(round_id, allocations)` — caller must be a member. Each
  allocation is `{to, points, reason}`. Validates: total at most 100
  points, no self-allocation, at least 3 distinct recipients, each
  allocation 1 to 100 points, every reason non-empty and at most 200
  characters. One submission per member per round; resubmitting replaces
  the previous one before settlement. Rejected after close, settle, or
  deadline.
- `settle_round(round_id)` — only after the deadline or an owner close;
  anyone may call it. Computes scores, applies the discount and the cap,
  stores a full explanation per member, transfers each payout, and mints
  ownership units. Settling twice fails.
- `distribute_inflow(amount)` — payable, attached deposit must equal the
  amount; splits the inflow pro-rata to ownership units and returns each
  share. This is how freezer rent reaches members.

DAO membership (production path, live):

- `sync_dao_members()` — anyone may call it. Reads the DAO's `get_policy`
  live cross-contract and mirrors the configured role's group (default
  `council`) into the member set. The DAO is the source of truth; the
  local set is a synced mirror. Call it after the DAO council changes.
- `get_dao_role(account_id)` — a change call (a view cannot make a
  cross-contract call). Reads the DAO's `get_policy` live and the callback
  stores and returns whether the account is in the role right now.
- `set_dao_id(dao_id)` — owner only; point the contract at another DAO.
- `set_member_role(role)` — owner only; change which DAO role holds the
  members (default `council`).
- `add_member(member)` — owner only, local-testing fallback ONLY. Do not
  rely on it on a live deployment; production membership comes from
  `sync_dao_members`.

Views:

- `get_round(round_id)`, `get_allocations(round_id)`,
  `explain_payout(round_id, account_id)`, `get_payouts(round_id)`
- `get_members()` (no arguments), `get_standing(account_id)`,
  `get_units(account_id)`, `get_params()`
- `get_cached_dao_role(account_id)` — the last synced DAO membership
  state for an account (dao id, role, is_member, last live check,
  last sync time). `get_dao_info()` — dao id, role, member count,
  last sync time.

Ownership units (stretch, live in the contract): at each settle,
existing units decay 10% (x9/10), then new units are minted equal to the
payout share in basis points of the envelope (a capped 25% payout mints
2500 units). Units are non-transferable — there is no transfer method.

## Real vs simulated

**Real (contract code, tested):** escrow (attached deposit must equal the
envelope), allocation validation, deterministic settlement math, the 25%
cap with water-filling redistribution, payout transfers, stored payout
explanations, ownership units and inflow distribution, and DAO membership:
`sync_dao_members` reads the Sputnik DAO council live cross-contract and
`get_dao_role` checks a single account the same way. `cargo test --lib`:
31 passed, 0 failed, including a worked settlement example with exact
scores and exact payouts, a reciprocity check (same 50 points one-way
scores 4900, mutual scores 2500), a cap check (raw share 79.05% pays
exactly 25 NEAR), a 200-round property test (payout sums never exceed the
envelope, no payout exceeds the cap), the collusion property test above,
and 7 DAO membership tests (member can allocate after sync, non-member
cannot, role removal blocks allocation, live check caches, failed sync
keeps the old set, owner-only DAO settings).

**Simulated (site only):** the demo round members, allocations and
envelope; the Attack Lab rounds. Both are labelled SIMULATED on the page
and run the same integer maths as the contract — they are not live
rounds, and no funds move.

**Not yet live:** a live round with real people, the video, the GitHub
push, and the hackathon submission. The contract and the DAO ARE live on
testnet (see below); the demo on the site is still simulated, and the
live round 1 below was a demo round with test accounts, not a round with
real people.

**Live on testnet — verified 2026-11-08 ~10:25 WAT by RPC view calls:**
Sputnik DAO `fairshare-dao.testnet` (name `fairshare`, council = the 6
demo members, default policy: 1/2 vote, 1 NEAR proposal bond, 7-day
proposal period). DAO deploy transaction
`23KcWfmQD2cu6nBJkx1yAoWk8istBR75omCzXVfZUDnv`, init transaction
`DV39wdiRmhgLAwZ2TCtZncR8RVMhQQ8iPy7jHd2YyYug`. The DAO wasm was read
on-chain from `genesis.sputnikv2.testnet` (469,723 bytes, sha256
`6e3f1814d40769d8f57b9a7af689d22aaab96d3232cec4d861311829c1d2318f`),
because the live testnet factory is `sputnikv2.testnet` and it only
creates DAOs as its own subaccounts — it cannot create the top-level name
`fairshare-dao.testnet`. Full record in `dao-log.json`.

Contract `fairshare-contract.testnet`, owner `fairshare-owner.testnet`,
DAO `fairshare-dao.testnet`. Deploy transaction
`oSzFtcQUxoV6vYvQAnwEyJgfWcPSk2XYXyhMJw81zFx`, init transaction
`CJfuyLv5J42iuBCMtx4EQh5Cb63BCNxDgTMupZuZHBL7`, both confirmed
SuccessValue by RPC. Deployed 2026-11-08 ~10:23 WAT; full record in
`deploy-log.json`. The deployed WASM is the local `fairshare_round.wasm`
(484,794 bytes).

Live state read from the contract: `get_params` returns 100 points per
member, at least 3 recipients, cap 2500 bps, discount 5000 bps, round
604800000000000 ns (7 days), standing starts at 100. `get_dao_info`
returns DAO `fairshare-dao.testnet`, role `council`, 6 members, synced.
`sync_dao_members` transaction
`CihwgreGNAYuWyb6pRRbWRy6oUyHRwx5vPWJW3DEBJcs` pulled the 6 members
from the DAO council; `get_dao_role` transaction
`BN2XZU12x2mWvJNfy8WHecRLT48J5ehyrMisL7WD32vX` confirmed alice live,
cached as `live_check: true`. `get_members` returns the 6 demo members:
alice-fairshare, bob-fairshare, carol-fairshare, dave-fairshare,
erin-fairshare and frank-fairshare.testnet. Round 1 exists and is settled:
5 NEAR envelope, paid out 4.999 NEAR (3 yocto dust stayed in the
contract). Round 1 ran the worked example allocations from the contract
tests, so its payouts are the worked example scaled to 5 NEAR — Alice
0.839 NEAR (score 21904), Bob 0.618, Carol 0.290, Dave 1.121, Erin 0.945,
Frank 1.187. Every member's balance rose by their payout minus gas, so
the transfers really landed. `explain_payout` for Alice returns the exact
contribution table from the test comment (Frank 61 points, no discount,
root 78; Bob 8 points, discount 4, root 20). The site's live mode is wired
to this contract id and reads this state in the browser; see `site/app.js`
`CONTRACT_ID` and `fetchLiveState`.

Earlier deployment (Egbe, superseded): contract `egbe-contract.testnet`,
owner `egbe-owner.testnet`, deploy tx
`8MgasF8FP1Tv4YebR9Y2ks5RgwffkwnE6dNkmYgZaHy1`, init tx
`E7pDbVrhm4sM3PYVStD4uLpgo9N9ah3yF7FvA46ABHkh`, demo round 1 settled tx
`DA2DciS2KXhcsinnHZParpDTRcvZBmgKB4PpKJLdiEMr`. That contract used
owner-seeded members and no DAO; it is left untouched on testnet as
history. The burned name `egbe-round.testnet` holds 10 NEAR with no
code and no known key — do not use it.

**Trezu:** Trezu was NOT verified to drive payouts. The contract pays by
ordinary Transfer from the round envelope, and the fallback for DAO
payouts is ordinary Transfer proposals. No Trezu step is claimed anywhere
on the site or in this README.

**Membership:** production membership is a Sputnik DAO role read
cross-contract, and it is live: `sync_dao_members` mirrors the DAO
council into the member set and `get_dao_role` checks one account live.
`add_member` remains only as a local-testing fallback.

**Standing:** stored and readable, starts at 100 for everyone, and never
changes in this version. No standing-update rule was specified.

## Known limitations, stated plainly

- Peer allocation is not new. Coordinape did a version of it, and square
  root weighting comes from quadratic funding. FairShare adds deterministic
  on-chain settlement, an explainable payout, a cap, and DAO membership
  read live from a Sputnik role.
- Collusion is made costly, not impossible. The Attack Lab shows a closed
  ring earning less — but only under reciprocal outsider behaviour: in
  the ring round the trio does no work for the outsiders, so the
  outsiders point at each other; in the honest round the trio helps
  outsiders, so the outsiders point back at them. With outsider
  behaviour held fixed, a ring that only feeds itself would capture
  more, not less. If the whole round colludes, the maths cannot save it.
- Popularity bias remains. Well liked members attract points. The cap
  and the square root soften it. They do not remove it.
- Sybil resistance comes from DAO member curation. The contract cannot
  tell a real member from a second account. The DAO decides who is a
  member.
- Sputnik decides approval by proposal kind and role, never by amount.
  A small proposal from the wrong role still fails, and a large proposal
  from the right role still passes.
- The contract cannot see physical work. It never claims to verify that
  a freezer was cleaned or a stall was run. It settles what members said
  about each other, nothing more.
- Whole-number division leaves a few yocto in the contract after each
  settle. That dust stays there.
- The site's live mode has no wallet connection wired. Connecting a
  wallet, creating a round, allocating and settling live are manual steps
  for the live round, not buttons on this page yet.

## Deploy (done 2026-11-08 — record kept here)

The contract is deployed to testnet at `fairshare-contract.testnet` and
the DAO at `fairshare-dao.testnet` (see the live record in Real vs
Simulated above, and `deploy-log.json` / `dao-log.json`).
Repeating a deploy, if one is ever needed, is testnet only, from a
funded testnet account:

```sh
# 1. Create fresh testnet accounts: node scripts/create-fairshare-accounts.mjs
# 2. Create the DAO: node scripts/create-dao.mjs
# 3. Deploy the contract: node scripts/deploy.mjs
# 4. Run the demo round: node scripts/demo-round.mjs
# 5. Set CONTRACT_ID in site/app.js to the deployed contract id.
# 6. Verify from the command line with view calls (no signing):
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": "fairshare-params",
  "method": "query",
  "params": {"request_type": "call_function", "account_id": "<CONTRACT_ID>",
             "method_name": "get_params", "args_base64": "e30=",
             "finality": "final"}
}'
#    Expect points_per_member 100, min_recipients 3, cap_bps 2500,
#    reciprocity_discount_bps 5000, standing_start 100.
# 7. Open the site and confirm the live mode section shows the contract id.
```

Do not sign a deploy, init, or round transaction from this repo without
Isaiah's explicit approval for that transaction, with the exact preview
shown first.

## Verification performed (2026-11-08)

- Site JS settlement math checked against the contract's own test
  vectors in `lib.rs`: the worked example (all 6 scores, all 6 payouts,
  total score 130468, 1 yocto dust), the reciprocity test (4900 one-way,
  2500 mutual), and the cap test (score 254016, exactly 25 NEAR, all 7
  other payouts, 2 yocto dust) — all reproduced exactly, to the yocto.
- The contract's collusion property test values reproduced exactly in
  the site JS: ring trio 3506716981132075471698113 yocto each, honest
  trio exactly 15 NEAR each.
- Contract suite run here: `cargo test --lib`, 31 passed, 0 failed
  (24 from the first build + 7 new DAO membership tests).
  (One failure was found and fixed during the first build: the property
  test asserted a ring payout of 3501431801055011303692539 yocto from a
  Python model that used float square roots; the Rust code and the JS
  reimplementation both give 3506716981132075471698113, and the literal
  was corrected to that value.)
- Site exercised without a browser via a node DOM shim
  (`hidden_files/dom_test.js`): members render (5 rows), allocations
  render (15 rows), Settle renders 5 payout rows with the note above,
  Explain renders 3 giver rows for Amina, Attack Lab renders 9 rows per
  round with the verdict above, and the live badge reads ON with the
  contract id. The live state fetch was run from the site's own code
  path in node and returned the live params, 6 members, and round 1
  settled at 5.000 NEAR envelope / 4.999 NEAR paid out.
- Live contract + DAO verified by RPC view calls 2026-11-08: DAO wasm
  read on-chain from `genesis.sputnikv2.testnet`; DAO deploy and init
  transactions both SuccessValue; `get_policy` shows the council role
  with exactly the 6 demo members; contract wasm matches the local
  build; deploy and init transactions both SuccessValue; `get_params`,
  `get_dao_info`, `get_cached_dao_role`, `get_members`, `get_round(1)`,
  `get_allocations(1)`, `get_payouts(1)`, `explain_payout(1, alice)`,
  `get_units(alice)` all read back as recorded in Real vs Simulated
  above. The demo round's member balances rose by payout minus gas.
- Site served over local HTTP and fetched (index 200, app.js 200).
- Visible copy scanned for hyphens/dashes: none in the page text.

## What remains

- Site live mode is wired to `fairshare-contract.testnet` and reads live
  state in the browser (`get_params`, `get_members`, `get_round(1)`),
  verified from the site's own code path in node. No wallet is
  connected; the page still cannot move funds.
- Live round 1 is settled (demo round with DAO membership, 5 NEAR). The
  next live round with real people needs Isaiah's separate approval and
  real member wallets — members are currently the six demo accounts, who
  are the DAO council.
- Video, GitHub push, and hackathon submission. All need Isaiah's
  separate explicit approval. The GitHub repo
  https://github.com/fairshare54/fairshare already exists (public,
  empty) — nothing has been pushed to it yet.
- Lead question: Genesis, PAC and VeilProof are already submitted and one
  person can lead at most 2 projects, so FairShare needs a different lead
  or Genesis to wait. That decision belongs to Isaiah.
