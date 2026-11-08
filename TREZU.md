# Trezu and the FairShare DAO

Checked 2026-11-08. The FairShare DAO is a standard Sputnik DAO
(`fairshare-dao.testnet`, Sputnik v2 deployed directly to that account).
Trezu is the treasury app that manages Sputnik DAOs. This file records
exactly what Trezu can and cannot do with this DAO on testnet, with the
steps to see it yourself.

## What Trezu is here

Trezu (NEAR-DevHub/treasury26) is a treasury management platform for
NEAR DAOs. On mainnet it manages proposals, payments, assets and
activity for a DAO. The FairShare DAO is a plain Sputnik DAO, so it is
the kind of DAO Trezu manages: council members propose, vote and
execute through it, and the contract reads DAO membership live from it
(`sync_dao_members` calls the DAO `get_policy`).

## The honest limit

Trezu production is mainnet only. There is no testnet option in the
deployed app, and no live Trezu testnet payout exists. The Trezu repo
does have a deliberate dev only local route for viewing a testnet DAO,
and that route is what was verified below. Nothing here claims a
Trezu testnet payout, because there is not one.

## What was verified: the local testnet view works

The Trezu frontend was run locally with the mock backend from the
Trezu repo, and `fairshare-dao.testnet` was opened in it. The UI
shows the DAO with its real onchain data, read straight from testnet
RPC. No wallet was connected (Guest mode), nothing was signed, no
proposal was created or executed, no payout was attempted.

What loads:

- Requests, Executed tab: all 8 proposals, each Executed. #7 and #6
  are `create_round` on `fairshare-contract.testnet` (round 3 funding
  7/7, round 2 funding 7/7); #5 to #0 are Add Member to council
  (tunde 6/7, ngozi 6/7, ibrahim 5/7, fatima 5/7, emeka 4/7, ada 4/7).
  The default view correctly says there are no pending requests.
- Members: 12 council members (ada, alice, bob, carol, dave, emeka,
  erin, fatima, frank, ibrahim, ngozi, tunde), matching the onchain
  policy exactly.
- Settings, Voting: 6 of 12 threshold, 12 members, 7 day vote
  duration. Matches the onchain policy (threshold [1,2],
  proposal period 604800000000000 ns).
- Config: name `fairshare`, purpose `FairShare demo DAO — peer
  allocation of credit (formerly Egbe)`.

What stays empty, exactly as the Trezu README predicts:

- Assets and Total Balance: empty. The production endpoint
  `GET /api/user/assets?accountId=fairshare-dao.testnet` returns
  HTTP 500, because it looks the DAO up on mainnet, where it does not
  exist. There is no indexer for testnet DAOs.
- Recent Transactions: "Nothing to show yet". The `/assets` and
  `/activity` routes do not exist in this UI version (app 404).
- Execution transaction links: the mock answers 404 by design.

## How to reproduce it

```bash
# 1. Clone (once)
git clone https://github.com/NEAR-DevHub/treasury26
# HEAD checked: a6aaaf6742099069634a25fb20c4287a2852dd62

# 2. Install frontend deps (once; ~105 s)
cd treasury26/nt-fe
bun install

# 3. Start the mock backend (terminal 1)
bun run testnet:mock
# listens on http://127.0.0.1:8889

# 4. Start the frontend (terminal 2)
NEXT_PUBLIC_NEAR_NETWORK=testnet \
NEXT_PUBLIC_NEAR_RPC_URL=https://rpc.testnet.fastnear.com \
NEXT_PUBLIC_BACKEND_API_BASE=http://127.0.0.1:8889 \
bun run dev
# listens on http://localhost:3000

# 5. Open
# http://localhost:3000/fairshare-dao.testnet/requests
```

Reference: `treasury26/nt-fe/README.md`, section "Viewing a testnet
DAO locally (omni chain-signature proposals)", and the mock script
`treasury26/nt-fe/scripts/testnet-mock-backend.mjs`.

Note on the URL: the Trezu README example uses
`<dao>.sputnik-v2.testnet`. This DAO is a standalone account, not a
`sputnik-v2.testnet` subaccount, so the plain account id
`fairshare-dao.testnet` is the correct form, and it works.

## Sandbox only extra step

On a machine with direct internet, the steps above are enough. In
this sandbox, direct outbound HTTPS is blocked, and the mock backend
forwards some routes with raw `https.request` (no proxy, no timeout),
so those routes hung and the page stuck on "Loading...". The fix was
a small local proxy aware forwarder (`forward-shim.mjs`) plus the
mock's documented `MOCK_FORWARD_TARGET` env var, and stripping
`content-encoding` in the shim because `fetch()` already
decompresses. No Trezu repo files were modified. Skip this step on a
normal machine.

```bash
# terminal 0
NODE_USE_ENV_PROXY=1 node forward-shim.mjs   # listens on 127.0.0.1:8890
# terminal 1, instead of plain `bun run testnet:mock`:
MOCK_FORWARD_TARGET=http://127.0.0.1:8890 bun run testnet:mock
```

## Evidence

Full findings, screenshots and API responses from the check:
`trezu-check/FINDINGS.md`, `trezu-check/requests-executed.png` (best
single proof: all 8 proposals Executed), `trezu-check/members.png`,
`trezu-check/settings-voting.png`, `trezu-check/dashboard.png`,
`trezu-check/requests.png`, plus `trezu-check/policy.json`,
`trezu-check/config.json`, `trezu-check/proposals.json` and run logs.
The `trezu-check/treasury26/` clone is unmodified except `node_modules/`
and `.next/` build cache from `bun install` and `bun run dev`.

## What this means for the project

The treasury link is real and verifiable, with its limit stated
plainly: on mainnet, Trezu would manage this DAO end to end; on
testnet, the local view above is the way to see it. Funding rounds
still go through real DAO proposals (rounds 2 and 3 were funded that
way), and payouts still leave the contract by ordinary transfer from
the round envelope.
