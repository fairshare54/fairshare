# FairShare round contract — BUILD LOG

Date: 2026-11-08. Testnet only, never mainnet. No private key is printed
or committed anywhere in this repo.

The first build and live demo used the earlier contract
`egbe-contract.testnet`; that deployment is kept as history at the end of
this log.

## What was built

`contract/` — Rust contract (`near-sdk` 5.5, resolves to 5.30.1), package
`fairshare-round` v0.1.0, in `contract/src/lib.rs` (single file, ~1900
lines including tests). Built wasm copied to `fairshare_round.wasm` at
this directory root for deploy convenience.

### Methods (exact interface — the site is built against these names)

- `new(owner_id: AccountId, dao_id: AccountId)` — init. Member role
  defaults to "council".
- `sync_dao_members()` — anyone may call it. Reads the DAO's `get_policy`
  live cross-contract and mirrors that role's group into the member set.
  The DAO is the source of truth; the local set is a synced mirror.
- `get_dao_role(account_id)` — change call (a view cannot make a
  cross-contract call). Reads the DAO's `get_policy` live; the callback
  stores and returns whether the account is in the role right now.
- `set_dao_id(dao_id)` — owner only; point the contract at another DAO.
- `set_member_role(role)` — owner only; change which DAO role holds the
  members (default "council").
- `add_member(member: AccountId)` — owner only, LOCAL-TESTING FALLBACK
  ONLY. Production membership comes from `sync_dao_members`; do not rely
  on this on a live deployment.
- `create_round(round_id: u64, envelope_yocto: U128)` — payable; attached
  deposit must equal the envelope exactly; only owner or DAO; deadline =
  creation + 7 days.
- `close_round(round_id: u64)` — owner only; lets a round settle early.
- `allocate(round_id: u64, allocations: Vec<{to, points, reason}>)` —
  caller must be a member (synced from the DAO role, or seeded via
  `add_member` in local testing only); validates total <= 100, no
  self-allocation, >= 3 distinct recipients, each allocation 1..=100
  points, every reason non-empty and <= 200 chars. Re-submission replaces
  the previous one before settlement. Rejected after close / settle /
  deadline.
- `settle_round(round_id: u64)` — after deadline or owner close; anyone
  may call. Deterministic scoring, reciprocity discount, 25% cap with
  water-filling redistribution, stores per-member payout + full
  explanation, transfers payouts, mints ownership units. Settling twice
  fails.
- `distribute_inflow(amount: U128)` — payable, attached == amount; splits
  the inflow pro-rata to ownership units; returns each share. (Stretch.)
- Views: `get_round(round_id)`, `get_allocations(round_id)`,
  `explain_payout(round_id, account_id)`, `get_payouts(round_id)`,
  `get_members()`, `get_standing(account_id)`, `get_params()`,
  `get_cached_dao_role(account_id)`, `get_dao_info()`,
  `get_units(account_id)`.

### DAO membership design (added 2026-11-08, phase 1)

- The contract stores `dao_id` (updatable by the owner) and `member_role`
  (default "council", updatable by the owner).
- `sync_dao_members` does a real cross-contract `get_policy` call on the
  DAO. Its callback parses the policy JSON generically
  (`serde_json::Value`, only `roles[].name` and `roles[].kind.Group[]`
  are read, so the contract never depends on the exact Sputnik Policy
  struct shape) and diff-syncs the local member set: members dropped
  from the role lose membership, members added gain it, standing is kept
  for re-added members. A failed DAO call leaves the set untouched.
- `get_dao_role` does the same live `get_policy` read for one account
  and caches the answer (`dao_role_cache`), which
  `get_cached_dao_role` reports together with the last sync time.
- `add_member` was KEPT as the local-testing fallback (the brief allowed
  keeping it, and all 24 original tests seed members through it). It is
  owner-only and documented in the code and README as testing-only; the
  live demo round used DAO sync, not `add_member`.

### Settlement math (deterministic, on-chain)

- Effective points: for each mutual pair, the smaller of the two
  allocations is the mutual portion; 50% of it is discounted from BOTH
  directions before scoring (integer division, floor).
- Score for a member = (sum over distinct givers of
  `isqrt(effective_points * giver_weight)`)^2. Giver weight is the
  giver's standing; every member starts at 100, and standing moves at
  each settle: +2 per distinct giver (capped at +10 a round), -5 for
  submitting no allocations, clamped to [50, 200]. Gates: standing 100
  or more to propose a round, 150 or more to close one early (owner
  and DAO excepted).
- Payouts are proportional to score, capped at 25% of the envelope per
  member. Capped surplus is redistributed water-filling style to
  uncapped members in score order; the payout sum never exceeds the
  envelope and integer-division dust stays in the contract.
- Ownership units (stretch): at each settle, existing units decay 10%
  (x9/10), then new units are minted equal to the payout share in basis
  points of the envelope (a capped 25% payout mints 2500 units). Units
  are non-transferable — there is no transfer method.

### Worked settlement example (verified by an independent Python model)

Envelope 100 NEAR, 6 members, no cap triggered. Scores (total 130468):

| member | score | payout (yocto) |
|---|---|---|
| alice | 21904 | 16788791121194469141858540 |
| bob | 16129 | 12362418370788239261734678 |
| carol | 7569 | 5801422571051905448079222 |
| dave | 29241 | 22412392310758193580034951 |
| erin | 24649 | 18892755311647300487475856 |
| frank | 30976 | 23742220314559892080816752 |

Payouts sum to envelope minus 1 yocto dust. Full contribution table is
in the `worked_example_settlement_math` test comment in `lib.rs`.

## Tests

`cargo test --offline` in `contract/`: **31 passed, 0 failed** (suite
takes ~60–80 s, dominated by the 200-round property test). 24 from the
first build, 7 new DAO membership tests:

- DAO: member can allocate after a policy sync; non-member cannot;
  role removal blocks allocation in a later round; live role check
  caches true/false; failed sync keeps the existing set; owner-only
  `set_dao_id` / `set_member_role` (and non-owner rejected).
- Validation: self-allocation, <3 recipients, >100 points, empty reason,
  reason >200 chars, 0 points, duplicate recipient, non-member — all
  rejected; re-submission replaces.
- Worked example above, exact scores + exact payouts + explanation
  spot-checks.
- Reciprocity: same 50 points one-way scores 4900, mutual scores 2500.
- 25% cap: an 8-member round where one member's raw share is 79.05%
  pays exactly 25 NEAR; others below cap; sum = envelope − 2 yocto.
- Double settle rejected; settle before deadline without close rejected;
  settle after deadline without close works; allocate after settle
  rejected; non-owner create/add-member rejected; wrong deposit rejected.
- Property (a): a 3-person collusion ring earns 3.506716981132075471
  NEAR each vs the same trio allocating honestly earning 15 NEAR each
  (capped). Note the model: outsiders give to members who give to them,
  so the ring starves itself of distinct givers while the honest trio is
  fed by six. With outsider behaviour held fixed, a ring that only feeds
  itself would capture more, not less — the anti-collusion property
  holds under reciprocal outsider behaviour, and the test documents that
  assumption.
- Property (b): 200 random rounds (deterministic LCG, fixed seed) —
  payout sums never exceed the envelope and no payout exceeds the cap.
- Stretch: units minted on settle (2500 / 2090 / 963 / 428 / 0),
  10% decay + re-mint on a second settle (a: 4750), `distribute_inflow`
  pro-rata (10 NEAR over 9997 units).

## Wasm

- Built with `cargo build --target wasm32-unknown-unknown --release`
  (offline). `cargo near build` was tried first but refuses without a
  TTY ("The input device is not a TTY"); no ABI file was generated.
- `fairshare_round.wasm`: **484,794 bytes** (release, `opt-level = "z"`,
  LTO). Zero build warnings. Larger than the first build's 414,082 bytes
  because of the DAO policy parsing and promise code. sha256
  `ac6216949e3e8bf6590d1dc580453d178341b4a13348c2f424e6b23b36c38e08`.

## What is real vs simulated

- Real: escrow (attached deposit == envelope), allocation validation,
  deterministic settlement math, cap + redistribution, payout transfers,
  stored explanations, ownership units + inflow distribution, AND DAO
  membership — `sync_dao_members` / `get_dao_role` read the Sputnik DAO
  `get_policy` live cross-contract; the demo round used that path, not
  `add_member`. All proven live on testnet (see below and DEMO_LOG.md).
- Simulated / local-testing only: `add_member` (owner-seeded members,
  kept as a testing fallback); the site's simulated demo round and
  Attack Lab.
- Standing now moves at each settle (+2 per distinct giver capped at
  +10, -5 for no allocation, floor 50, cap 200) with gates on proposing
  (100+) and closing early (150+); proved live in round 3 (see DEMO_LOG.md).
- The repo https://github.com/fairshare54/fairshare is pushed (contract,
  site, logs); the live site is https://fairshare-pi.vercel.app/.

## Sputnik DAO — DONE 2026-11-08 (phase 2)

Full record: `dao-log.json`, `DEMO_LOG.md`.

- DAO: `fairshare-dao.testnet`, name `fairshare`, council = the 6 demo
  members, default policy (everyone can add proposals, council 1/2 vote,
  1 NEAR proposal bond, 7-day proposal period).
- Deploy tx `23KcWfmQD2cu6nBJkx1yAoWk8istBR75omCzXVfZUDnv`, init tx
  `DV39wdiRmhgLAwZ2TCtZncR8RVMhQQ8iPy7jHd2YyYug` — both FINAL.
- The DAO wasm was read on-chain from `genesis.sputnikv2.testnet`
  (469,723 bytes, sha256
  `6e3f1814d40769d8f57b9a7af689d22aaab96d3232cec4d861311829c1d2318f`),
  because the live testnet factory is `sputnikv2.testnet` and it only
  creates DAOs as its own subaccounts (`<name>.sputnikv2.testnet`) — it
  cannot create the top-level name `fairshare-dao.testnet`. Deploying the
  real Sputnik DAO v2 contract directly to the top-level account is the
  documented way to get that exact id.
- `get_policy` verified live: council role group is exactly the 6 demo
  members; `get_config` name is `fairshare`.

## Testnet deploy + live demo round — DONE 2026-11-08 (phase 2)

Full record: `DEMO_LOG.md`, `deploy-log.json`, `demo-log.json`.

- Contract: `fairshare-contract.testnet`; owner
  `fairshare-owner.testnet`; DAO `fairshare-dao.testnet`.
- Deploy tx `oSzFtcQUxoV6vYvQAnwEyJgfWcPSk2XYXyhMJw81zFx`, init tx
  `CJfuyLv5J42iuBCMtx4EQh5Cb63BCNxDgTMupZuZHBL7` — both FINAL.
  `get_params` and `get_dao_info` verified live.
- Demo round 1, 5 NEAR envelope, 6 demo members, membership from the
  DAO council via `sync_dao_members` (tx
  `CihwgreGNAYuWyb6pRRbWRy6oUyHRwx5vPWJW3DEBJcs`), live role check via
  `get_dao_role` (tx
  `BN2XZU12x2mWvJNfy8WHecRLT48J5ehyrMisL7WD32vX`, alice cached
  `live_check: true`). Settled: tx
  `2MUqHsLbbMcZGsneNnBBTinUfPXXJwdoRnJjwzxhpJYu` (FINAL). Scores matched
  the worked example exactly (total 130468); payouts summed to
  envelope minus 3 yocto; every member's balance rose by payout minus
  ~0.0002 NEAR gas — transfers verified onchain.
- Accounts were fresh, created via the testnet helper faucet (10 NEAR
  each); keys only in `.testnet-fairshare-accounts.json` (chmod 600,
  gitignored).
- fastnear RPC can lag finality a few seconds; the demo script polls
  views and is resumable/idempotent.

## What remains

- Live round 2 is done (crew accounts, full DAO flow — see DEMO_LOG.md
  and `LIVE_ROUND.md`). A live round with REAL HUMANS still needs
  Isaiah to bring 5–8 people; the runbook for it is `LIVE_ROUND.md`.
- GitHub push and hackathon submission — need Isaiah's separate
  explicit approval; not done here. Repo exists, empty.
- A live round with real people — needs Isaiah's approval.
- Lead question: FairShare is the fourth project (Genesis, PAC,
  VeilProof, FairShare); one person can lead at most 2, so it needs a
  different lead or Genesis to wait.
- DAO treasury is nearly empty (0.2591 NEAR available) after funding
  round 2 — top it up before any round 3.

## History — first build (superseded, kept for the record)

- Contract `egbe-contract.testnet` (owner `egbe-owner.testnet`,
  planned DAO id `egbe-dao.testnet`, never created). Wasm
  414,082 bytes. Deploy tx
  `8MgasF8FP1Tv4YebR9Y2ks5RgwffkwnE6dNkmYgZaHy1`, init tx
  `E7pDbVrhm4sM3PYVStD4uLpgo9N9ah3yF7FvA46ABHkh`. Demo round 1 settled
  tx `DA2DciS2KXhcsinnHZParpDTRcvZBmgKB4PpKJLdiEMr`, same worked-example
  scores/payouts. Membership was owner-seeded (`add_member`);
  `get_dao_role` returned a stored note and made no live Sputnik call.
  That contract is left untouched on testnet.
- One burned name: `egbe-round.testnet` (key lost in the first script
  run before it was written to disk); the contract account was
  `egbe-contract.testnet` instead. Do not use `egbe-round.testnet`.
- Old keys remain in `.testnet-accounts.json` (chmod 600, gitignored);
  new keys are in `.testnet-fairshare-accounts.json`.

## Reputation rule — DONE 2026-11-08 (migrate + live round 3)

Full record: `migrate-log.json`, `demo-log-round3.json`, `DEMO_LOG.md`
(round 3 section), `scripts/migrate.mjs`, `scripts/live-round-3.mjs`.

- Rule, as built: at each settle, +2 standing per distinct giver who
  gave that member points that round (capped at +10), -5 for submitting
  no allocations that round, clamped to [50, 200]. Giver weight in
  scoring is the giver's standing, so reputation compounds. Gates:
  standing 100 or more to propose a round (`create_round`), 150 or
  more to close one early (`close_round`). The owner and the DAO are
  excepted from the gates: the owner is the admin bootstrap, and a DAO
  proposal already needs a council majority vote. `get_params` exposes
  the whole rule live. No state migration was needed: the standing map
  already existed, the state struct is unchanged, so the code was
  replaced in place with no `new()` call.
- Tests: `cargo test --offline` 39 passed, 0 failed (31 original + 8
  new: standing updates, gain cap, floor/cap, propose gate x2, close
  gate x3). Two old exact-value tests changed only because round 2+
  scoring now uses updated giver weights: the reciprocity mutual score
  is 2601 not 2500 (giver standing 106 after round 1), and the units
  test round 2 b units are 3949 not 3971 (round 2 share 2068 bps).
- Migrate tx `Bz1CPe8ngb7ACjKXc45GDqYEG5NCHGFz4PWjAUsgJExh`, wasm
  486,611 bytes, sha256
  `a2fe8ce3784b0c3f377651785138fe8dcfba027f3cbb83e8be202cf98b9a5585`.
  Verified after: `get_params` shows the rule, 12 members unchanged,
  rounds 1 and 2 still settled with identical totals, standings all 100.
- Live round 3: funded by DAO proposal #7 (5 NEAR), settled tx
  `7ZbAQganvPJKGHsQkUGYXE56tdvqLm9UM1CGRwcCkMWG`, total score 429829,
  payouts sum to envelope minus 5 yocto. Standings moved exactly per
  the rule (ada 100 to 110, tunde 100 to 95, rest as computed). Both
  gates proved live: member close at 100 rejected, member propose at
  95 rejected, no round 4 created.
- DAO funding lesson (round 3): the DAO's total balance is not its
  spendable balance. Sputnik stores every proposal onchain, so the DAO
  must keep about 4.74 NEAR staked for storage (measured storage_usage
  474269 bytes = 4.7427 NEAR), and executing a proposal also returns
  the 1 NEAR bond, so a 5 NEAR envelope is a 6 NEAR outflow. Proposal
  #7 failed twice (3.7466 short, then 0.74295 short) before the DAO was
  topped to 11.5 NEAR total and the 7th vote passed. A 5 NEAR round
  needs the DAO at about 11.5 NEAR total. Top up before any round 4.

## Self-serve groups, 2026-11-08 (testnet only)

Authorised by Isaiah 2026-11-08 ~18:28 WAT: anyone can create their own
FairShare group from the site, no technical person, no mainnet parts,
no fee logic.

- Registry contract `fairshare-registry.testnet` (source
  `registry-contract/`, near-sdk 5.5, wasm 311,253 bytes, 11 unit tests
  pass). Deploy tx `AYHtQEMkk87vfDYwKwPwHBng2btbnh6BqCGXmCzytaxW`, init tx
  `2gkNKdvKyyuSkxh1gAiLtuQfCa4UaGJGhZcUSw9dEbvu`, owner
  fairshare-owner.testnet. It is only the directory: group metadata and
  invite codes, never group money. Methods: `register_group`,
  `update_badge` (only the group's DAO may call), `get_group`,
  `get_group_by_dao`, `get_group_by_contract`, `list_groups`,
  `group_count`, `get_owner`.
- Factory experiment: DAO `testgroup1.sputnikv2.testnet` created through
  `sputnikv2.testnet` `create` with 5.5 NEAR attached, tx
  `8qTu3SHJMLssufU6kHmpEZcZw4HBiMh4SqnvYjZjVucj` (log
  `exp-factory-create.json`).
- Storage is a minimum balance, not a deduction: deploying code does not
  reduce the account balance; the account must keep storage_usage x 1e19
  yocto locked. A DAO holding 5.5 NEAR can only spend ~0.1 NEAR. A 5 NEAR
  round needs ~11.5 NEAR total in the DAO. Per-group creator cost about
  17.7 testnet NEAR: 10.5 DAO treasury + 5.2 contract subaccount + 1
  register (mostly refunded) + 1 bond float (returned).
- Site: `site/create.html` + `site/create.js` (four-step flow, resumable
  across wallet redirects, progress in localStorage), `site/group.html`
  + `site/group.js` (members-only page: rounds, members, allocate form,
  start-a-round and propose-member forms, proposals with votes),
  `site/groups-common.js` (shared wallet/RPC/slug/invite helpers),
  `site/near-api-js.bundle.js` (near-api-js 5.1.1, esbuild 0.28.2;
  the build NEEDS `--define:global=window` and
  `--inject:./nearjs-shim.js`, see `nearjs-entry.js` — without them the
  bundle throws "global is not defined" / "process is not defined" and
  `window.nearApiJs` never appears; caught by the headless check).
  Home hero + nav on all four pages link to `/create`; `vercel.json`
  rewrites added for `/create`, `/group`, `/create.js`, `/group.js`,
  `/groups-common.js`, `/near-api-js.bundle.js`. Tests:
  `hidden_files/groups_test.js` passes (slugify, invite codes, fmtYocto,
  constants, every element id the page scripts look up, rewrites, nav
  links). Existing `dom_test.js` and `charts_test.js` still pass.
- Proof, `scripts/prove-group-instance.mjs`, log `prove-group-log.json`:
  group `prove-group`, DAO `prove-group.sputnikv2.testnet`, contract
  `prove-group-fairshare.prove-creator.testnet`, round 1 settled with
  total score 63301, four members paid exactly the 1.25 NEAR cap each
  (5 NEAR), standings 100 to 106 each. Full tx hashes in the log.
- Bugs the proof caught, all fixed in the script (the page flow does not
  share them, but the lesson stands): (1) `accountExists` called
  `.state()` on the Promise from `near.account()` instead of awaiting
  it, so it always returned false — this is why the first two proof runs
  "timed out waiting for the faucet account onchain" when the accounts
  had in fact landed. (2) Sputnik's default vote policy [1,2] needs
  STRICTLY more than half the council's weight: after the first member
  joins, one vote no longer passes an add — every current council member
  must vote. (3) A flat 17.7 NEAR top-up demand on resume is wrong once
  the deploys are done; the top-up is now need-based, drawing from the
  funder then alice.
- The group page's membership gating is app-level: onchain data is
  public by nature, so a determined reader can query the contract
  directly. The README and the page say so.
- Left out deliberately: mainnet parts, fee logic, round length (fixed
  at 7 days by the contract), badge changes need a DAO vote, no try-it
  group (Isaiah: the site would be too congested).
- Registry v2 — the Meteor fix, 2026-11-08. The first proof deployed
  the contract from the browser: the wallet created the contract
  subaccount and added a fresh browser keypair as a FullAccess key so
  near-api-js could deploy the code. Meteor blocks full-access grants
  from dapps (Approve greyed out), so Isaiah's create flow died at
  step 2 after his DAO was created. The fix removes the browser key
  entirely: the registry now deploys the contract itself.
  `registry-contract/src/lib.rs`: `deploy_group_contract(group_id)`
  loads the group, asserts the caller is the creator, derives the
  contract id as `<slug>-fairshare.fairshare-registry.testnet` (a
  subaccount of the registry — a contract can only deploy to its own
  subaccounts), asserts 5.2 NEAR attached, then one promise:
  create_account, transfer the deposit, deploy_contract (the round
  wasm embedded via `include_bytes!("../../fairshare_round.wasm")`,
  byte-identical to the live code on `fairshare-contract.testnet`),
  function_call `new` with owner = creator, dao = the group's DAO.
  The state struct is unchanged, so no migration and no init after
  the redeploy; verified both times (owner, group_count, prove-group
  record identical before/after). Deployed twice: v2 (tx
  `Fu1whEj1X7BKFVeC1H4nr7nNjE5Nm3rU5xBiNv66Guij`, code sha256
  `022623f4…b896eb31`), then a gas fix (tx
  `2ZDzhQuut2kv16x37QpyRXf6kkvg5x2ki42oh9yifvWk`, code sha256
  `2009db25…c99b`). The gas fix was needed because the first deploy
  attempt ran out of gas at 150 TGas prepaid: the promise's actions
  burn ~29 TGas, but the `new` call had 100 TGas attached, and the
  attached gas is reserved out of the outer call's prepaid gas. `new`
  actually burns 1.62 TGas, so the attachment is now 30 TGas; the
  whole deploy burns ~70 TGas across its receipts, so the page's
  150 TGas wallet call has ~2x headroom. All 16 registry unit tests
  pass. The old scheme is refused: deploying `prove-group` through
  the registry panics (verified live).
- Create page reworked for the new flow (`site/create.js`,
  `site/create.html`, `site/groups-common.js`): order is now dao ->
  register -> deploy -> sync; step 3 is a single `walletCall` to the
  registry's `deploy_group_contract` with 5.2 NEAR attached, 150 TGas;
  `contractIdFor` is now `<slug>-fairshare.fairshare-registry.testnet`
  with no creator argument; the browser deploy block, the contract key
  in localStorage, `walletTx` and `fetchContractCodeBase64` are gone;
  the done panel shows the contract id instead of a key to save; the
  near-api-js bundle script tag is removed from the page (nothing uses
  it now — the bundle file stays in the repo, still referenced by
  `vercel.json`). "How it works, in three steps" moved to the top of
  the page, right under the hero and before the costs panel and the
  form, with its step order reworded to match dao -> register ->
  deploy -> sync; the progress panel stays after the form (an earlier
  note to move it was corrected — Isaiah only asked for the how-it-works
  block to move). Script versions bumped to `?v=3`.
- Proof v2, `scripts/prove-group-v2.mjs`, log `prove-group-2-log.json`:
  fresh group `prove-group-2` through the new flow end to end — DAO
  created, registered, contract deployed by the registry with correct
  params (100 points, dao correct, owner proven by the creator closing
  the round at standing 100), membership synced, round 1 funded by DAO
  proposal #0 (5 NEAR), bob/carol/dave joined by vote, all four
  allocated, round closed and settled, total score 63301, every member
  paid exactly the 1.25 NEAR cap (5 NEAR), standings 100 to 106 each,
  integer model matched every score and payout. Tests:
  `hidden_files/groups_test.js` passes (new checks: registry
  subaccount id scheme, flow order, deploy through the registry, no
  AddKey/FullAccess/browser key/deploy helpers anywhere in the group
  pages, done panel shows the contract id, how-it-works before the
  costs panel and outside the form, progress panel still after the
  form). `dom_test.js` and `charts_test.js` still pass.
- The original FairShare group, `fairshare-contract.testnet`, round 5
  and `prove-group`'s contract are untouched by all of this.

## Create-flow UX, group-page speed, homepage directory — 2026-11-08
Isaiah's phone test of his own group (Football fans, created 2026-11-08
~20:50 WAT) found five issues; all fixed in the frontend only, no
contract change. `fairshare-dao.testnet`, `fairshare-contract.testnet`,
round 5, `prove-group` and `prove-group-2` untouched.

- Create button silence: tapping "Create my group" showed nothing
  while the wallet prompt was prepared. Both it and "Continue creating"
  now disable themselves and show a CSS border spinner synchronously,
  in the same tick as the tap, before any await; the label is restored
  on failure and the button stays disabled while the completion
  redirect is pending. (`site/create.js` `setBusy`, `site/create.html`
  `.spinner`, `create.js?v=4`.)
- No landing after completion: the page stayed on /create. `showDone`
  now takes the creator to their group page
  (`/group?id=<slug>&invite=<code>`) 1.5 seconds after the "Your group
  is live" panel appears, and the progress panel does the same when a
  reload lands on an already-finished flow. The group page now shows
  the invite link itself in the members panel (`#groupInviteLink`),
  not only behind the copy button. (`site/group.js?v=4`,
  `site/group.html`.)
- Balance warning overstated the cost when resuming: it claimed the
  full 17.7 NEAR even with the DAO step done. `remainingNeedYocto`
  counts only the steps not yet done onchain (DAO treasury, 1 NEAR
  register, 5.2 NEAR contract); the balance line and the create gate
  both use it, so Isaiah's 7.466 NEAR against 6.2 NEAR remaining shows
  no top-up warning.
- Group page slow load: about 66 sequential view calls on load
  (rounds 1..20 scanned three times over, plus Governance calling
  both scans again), at ~4 seconds a call from here. One shared scan
  per load now (`scanGroupRounds` in `site/group.js`): get_round 1..20
  in parallel via `Promise.all`, cached, shared by the Rounds panel,
  the allocate form and Governance; per-round payouts/allocations also
  in parallel. The setup reads (contract existence, member set, DAO
  policy) go out together too, as do the per-member standing reads.
  Every fetch in `rpcViewCall` and `rpcAccountBalance`
  (`site/groups-common.js`, and the same pattern in `site/app.js`)
  now times out after 10 seconds via AbortController and fails over to
  the next endpoint instead of hanging. Empty states kept verbatim:
  "No rounds yet. A council member can propose the first one below."
  and "No open proposals right now." (`groups-common.js?v=4`.)
- Homepage directory: Football fans was only reachable through its
  invite link. The home page now has a Groups section
  (`site/index.html`, `site/app.js?v=10`) listing every registered
  group from `list_groups` (one fetch per load) with name, template
  and creator, each linking to its group page. With a wallet
  connected, "My DAO group" comes first: a group counts when the
  account is the creator, in the contract's `get_members`, or on the
  DAO council (`get_policy`, council role) — the DAO list is the
  source of truth, so a member sees the group as soon as their join
  is approved, before the next membership sync. Membership checks run
  in parallel and are cached per load. Unconnected visitors see all
  groups with a note to connect to see which are theirs; an empty
  registry shows "No groups yet. Be the first to start one." The
  directory lives in `app.js` (not `groups-common.js`, whose top-level
  names collide with `app.js` and would break the homepage).
- Tests: `hidden_files/groups_test.js` passes (138 checks, new
  sections 4e–4g: spinner, redirect, remaining cost, parallel scan,
  fetch timeout, directory). New harnesses drive the real page
  scripts with stubbed DOM/wallet/RPC:
  `hidden_files/create_flow_test.js` passes (31 checks: spinner
  synchronous on both buttons, four wallet calls in order, redirect
  to the group page, remaining 6.200 NEAR on resume, group page scan
  exactly 20 parallel calls, both empty states, invite link shown);
  `hidden_files/home_directory_test.js` passes (16 checks: creator
  and DAO-council membership, parallel checks, cached list,
  unconnected and empty states). `dom_test.js` and `charts_test.js`
  still pass.
