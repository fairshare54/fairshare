# FairShare: ownership you earn, not buy

FairShare is a NEAR Hackathon Social Money project: peer allocation of credit.
A Sputnik DAO funds a round, members give each other points for the work
they saw, and the contract settles payouts deterministically on-chain, with
every payout explainable giver by giver.

**Launching on testnet. No private key is printed or committed anywhere in
this repo.**

Submitted to the NEAR Hackathon, Social Money track, lead Christian
(fairshare085@gmail.com), payout crist54.near. The lead also leads Public
Agent Coin (PAC), a memecoin arena. That is the lead's other hackathon
project.

## How it works

A round is one shared pot, funded by the DAO as a single envelope. Each
member gets 100 points and gives them to at least 3 other members, never to
themselves, with a reason for each gift.

Settlement is arithmetic anyone can repeat:

- Effective points: for each mutual pair, the smaller of the two gifts is
  the mutual portion, and 50% of it is discounted from both directions.
- Score: for each member, the square of the sum over distinct givers of the
  square root of effective points times giver standing. Standing starts at
  100 for everyone and moves at each settle: +2 per distinct giver who gave
  that member points, capped at +10 per round, and -5 for submitting no
  allocations that round. Standing is clamped between 50 and 200, so
  reputation compounds: members the group keeps recognising vote heavier.
  Running a round needs reputation: only the owner, the DAO, or a member
  with standing 100 or more may propose a round, and only the owner or a
  member with standing 150 or more may close one early.
- Payouts are proportional to score, capped at 25% of the envelope per
  member. Capped surplus is redistributed in water filling style to
  uncapped members. Division in whole yocto leaves a few yocto of dust in
  the contract.

Settling also mints ownership units equal to each payout share in basis
points of the envelope. Existing units decay 10% at each settle. Units
cannot be transferred. Rental income paid into the contract is shared pro
rata to units, so the group keeps earning from what it owns together.

Membership is a Sputnik DAO role, read live across contracts. The contract
mirrors the DAO council into its member set and checks one account live
against the DAO policy. The DAO is the source of truth.

### Membership Security and Sybil Resistance

FairShare does not grant membership merely because a wallet connects.

Membership is controlled through Sputnik DAO governance. A wallet must first be approved for the council role through a strict-majority proposal. Following approval, a synchronisation process updates the FairShare contract's authorised membership list. Only synchronised council members can participate in allocation.

The contract checks its synchronised member list on every allocation. It does not perform a live DAO role check during the allocation transaction.

When a wallet is removed from the Sputnik DAO council, its FairShare allocation permission remains active until the next successful membership synchronisation. The contract records the last synchronisation time, making this delay visible.

This creates a governance-controlled admission barrier against arbitrary wallet creation and unauthorised participation.

However, FairShare does not claim cryptographic proof of unique human identity. Multiple wallets controlled by one individual could still become members if the governing council approves them.

FairShare therefore uses **governance-based membership control rather than identity-based Sybil prevention**. Its security depends partly on the integrity of the council and its admission decisions.

#### Authorization Flow

1. A wallet connects to the application.
2. A Sputnik DAO proposal requests council admission.
3. Existing council members vote on the proposal.
4. Sputnik DAO enforces its own on-chain voting policy.
5. After approval, membership is synchronised with the FairShare contract.
6. The contract authorises the synchronised member to participate in allocations.
7. If a member is removed from the DAO, the next successful synchronisation removes their allocation permission.

## Live

- Site: https://fairshare-pi.vercel.app/
- Contract: `fairshare-contract.testnet`: https://testnet.nearblocks.io/address/fairshare-contract.testnet
- DAO: `fairshare-dao.testnet`: https://testnet.nearblocks.io/address/fairshare-dao.testnet
- Badge: `fairshare-badge.testnet`: https://testnet.nearblocks.io/address/fairshare-badge.testnet — 19 soulbound council badges, one per member, each carrying the member's standing at mint. Transfers are blocked in the contract.
- Membership Integrity Monitor: on the rounds page, next to governance. It reads the council live from the DAO, the member mirror live from the contract, and flags pairs who gave each other 40% or more of their points in a settled round. 19 members, DAO and contract in sync, 6 pairs flagged for review, no member ever removed.
- Trezu: the DAO is a standard Sputnik DAO that Trezu manages. Trezu
  production is mainnet only, so there is no live Trezu testnet payout;
  the local testnet view was verified instead (see `TREZU.md`): the
  Trezu frontend run locally shows all 8 DAO proposals Executed, all
  12 council members, and the 6 of 12 voting policy. Assets stay empty
  for testnet DAOs, as the Trezu README says.

## Live rounds

| Round | Envelope | Total score | Paid out | Settle transaction |
|---|---|---|---|---|
| 1 | 5 NEAR | 130468 | 4.999 NEAR | `2MUqHsLbbMcZGsneNnBBTinUfPXXJwdoRnJjwzxhpJYu` |
| 2 | 5 NEAR | 125923 | 4.999 NEAR | `6FsBf9r42Ji8afF8G6rebq2GqChmpUQW41cCpTuaodJF` |
| 3 | 5 NEAR | 429829 | 4.999 NEAR | `7ZbAQganvPJKGHsQkUGYXE56tdvqLm9UM1CGRwcCkMWG` |
| 4 | 5 NEAR | 117945 | 4.999 NEAR | `AXBjLUKBCBL4NcVAFhcQPRqEyEsSFA6cB4UtLMbKCWjR` |

Payouts in each round add to the envelope minus a few yocto of dust (3 in
rounds 1, 2, and 4, 5 in round 3). Round 2 was the first live round where the
25% cap triggered: Ada and Ibrahim were each capped at exactly 1.25 NEAR,
and the surplus went to the rest. Round 3 was the reputation round: the
first settle under the standing rule. Ada received points from 9 distinct
givers and went from 100 to 110, the capped gain. Tunde submitted nothing
and went from 100 to 95, even though 3 members gave to him. Both gates
were proved live in round 3: Ada at 100 could not close the round early,
and Tunde at 95 could not propose a round afterwards. Round 4 added six
new members to the council, taking it from 12 to 18, and only the six new
members allocated. Each gained 6 standing, from 100 to 106, and the 12
existing members each lost 5 for submitting nothing. The DAO council is
now 19 members: clearsite587.testnet joined by proposal #15 after the
round, so the owner can allocate in round 5 from the site. All four rounds ran through real DAO proposals, with real
testnet wallets.

## How to verify it onchain

The contract id is `fairshare-contract.testnet`. Read its state with view
calls: `get_params`, `get_members`, `get_round`, `get_payouts`, and
`explain_payout` for the giver by giver breakdown of any member. Example,
read the round parameters:

```sh
curl -s https://rpc.testnet.near.org -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": "fairshare-params",
  "method": "query",
  "params": {"request_type": "call_function", "account_id": "fairshare-contract.testnet",
             "method_name": "get_params", "args_base64": "e30=",
             "finality": "final"}
}'
```

Expect 100 points per member, at least 3 recipients, cap 2500 bps,
discount 5000 bps, standing starting at 100, gain +2 per distinct giver
capped at +10 a round, -5 for no allocation, floor 50, cap 200, propose at
100, close early at 150.

The site also has an Attack Lab that runs the same settlement maths in the
browser. It moves no funds. The Lab now has a Fairness Stress Test with
five scenarios a judge can pick: three friends rewarding each other, a
popular member receiving from everyone, a new member joining an
established DAO, a whole round colluding, and a productive member who is
unpopular. Each scenario settles with the exact contract maths and shows
the allocation pattern, every payout, the standing change, and a verdict
on what the mechanism caught and where its limit is. The whole round
colluding scenario is the honest limit: the maths cannot stop it, only
DAO curation can.

## Honest limits

- Collusion is made costly, not impossible. The Attack Lab shows a closed
  ring earning less, but only under reciprocal outsider behaviour. If the
  whole round colludes, the maths cannot save it.
- Standing moves at each settle under the rule above, proved live in
  round 3, and the gates on proposing and closing are enforced onchain.
- The site has wallet connect on testnet. A connected member can
  allocate in an open round and can propose and vote on DAO proposals
  from the governance section of the rounds page. Creating a round and
  settling it live are still manual steps, not buttons on the page.
- Trezu manages the DAO, and the local testnet view was verified (see
  `TREZU.md`): all 8 proposals Executed, 12 council members, 6 of 12
  voting policy. Trezu production is mainnet only, so there is no live
  Trezu testnet payout, and none is claimed. The contract pays by
  ordinary transfer from the round envelope.
