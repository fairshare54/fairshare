# FairShare: ownership you earn, not buy

FairShare is a NEAR Hackathon Social Money project: peer allocation of credit.
A Sputnik DAO funds a round, members give each other points for the work
they saw, and the contract settles payouts deterministically on-chain, with
every payout explainable giver by giver.

**Launching on testnet. No private key is printed or committed anywhere in
this repo.**

## How it works

A round is one shared pot, funded by the DAO as a single envelope. Each
member gets 100 points and gives them to at least 3 other members, never to
themselves, with a reason for each gift.

Settlement is arithmetic anyone can repeat:

- Effective points: for each mutual pair, the smaller of the two gifts is
  the mutual portion, and 50% of it is discounted from both directions.
- Score: for each member, the square of the sum over distinct givers of the
  square root of effective points times giver standing. Standing starts at
  100 for everyone in this version.
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

## Live

- Site: https://fairshare-pi.vercel.app/
- Contract: `fairshare-contract.testnet`: https://testnet.nearblocks.io/address/fairshare-contract.testnet
- DAO: `fairshare-dao.testnet`: https://testnet.nearblocks.io/address/fairshare-dao.testnet

## Live rounds

| Round | Envelope | Total score | Paid out | Settle transaction |
|---|---|---|---|---|
| 1 | 5 NEAR | 130468 | 4.999 NEAR | `2MUqHsLbbMcZGsneNnBBTinUfPXXJwdoRnJjwzxhpJYu` |
| 2 | 5 NEAR | 125923 | 4.999 NEAR | `6FsBf9r42Ji8afF8G6rebq2GqChmpUQW41cCpTuaodJF` |

Payouts in each round add to the envelope minus 3 yocto of dust. Round 2
was the first live round where the 25% cap triggered: Ada and Ibrahim were
each capped at exactly 1.25 NEAR, and the surplus went to the rest. The DAO
council is now 12 members. Both rounds ran through real DAO proposals, with
test accounts, not real people yet.

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
discount 5000 bps, standing starting at 100.

The site also has a simulated try out and an Attack Lab that run the same
settlement maths in the browser. They move no funds.

## Honest limits

- Collusion is made costly, not impossible. The Attack Lab shows a closed
  ring earning less, but only under reciprocal outsider behaviour. If the
  whole round colludes, the maths cannot save it.
- Standing starts at 100 and never changes in this version. No rule to
  update standing was specified yet.
- The site has no wallet connected. Creating a round, allocating, and
  settling live are manual steps for now, not buttons on the page.
- Trezu was not verified to drive payouts. The contract pays by ordinary
  transfer from the round envelope.
