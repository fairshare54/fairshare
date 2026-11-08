# FairShare site research — what the closest real products do

Researched 2026-11-08. Structure and patterns only. No copy text, branding,
or images were taken from any of these products.

## Coordinape — peer allocation (closest use case)

- What it was: a tool for peer allocated compensation in DAOs, 2021 to 2025
  (app closed 2025; the site that remains is a memorial). A team formed a
  circle, each epoch every member got a budget of GIVE (100 by default),
  allocated it to peers whose work they valued, with an optional note.
  No self allocation. At epoch close each member's share of the reward
  pool was GIVE received divided by total GIVE allocated.
- Scale claimed: more than 50 million GIVE carried, 500+ DAOs at peak.
- Hero pattern: one plain sentence about who decides pay ("the people
  doing the work decide who gets paid, not a manager"), then the circle
  and epoch flow in three steps, then live numbers (circles, GIVE moved).
- How it proved payouts: CoVaults, on chain payment distribution; the
  epoch result was a table of GIVE received and share of the pool.
- Honest about limits: the team said openly the model "could be gamed
  and had blind spots" and worked best where a circle had already built
  trust.
- Borrow: the circle and epoch framing; the plain hero; the allocation
  table as proof; stating the gaming limit in plain sight.
- Do NOT copy: linear proportional payout (FairShare uses square root
  weighting, a cap, and a reciprocity discount, which is the whole
  point); the GIVE token itself; the memorial tone.

## Gitcoin and Allo Protocol — quadratic funding rounds

- What it is: rounds with a matching pool put up by sponsors. The crowd
  donates to projects they value and the pool is split so the number of
  distinct contributors matters far more than the size of any one cheque:
  a grant's match grows with the square of the sum of the square roots
  of its donations.
- Round structure: application, selection, voting, payment, each stage
  timestamped. Allo is the modular contract layer behind it: pool
  capital, allocate through a pluggable strategy, recipient registry,
  flexible payout logic.
- Hero pattern: the mechanism in one line ("small donations count more
  than big ones"), then the live round card (pool size, contributors,
  time left), then a browseable list of projects with amounts raised.
- How it proves payouts: matching is computed off chain and settled on
  chain; results are public per project.
- Sybil answer: Gitcoin Passport proof of personhood, later
  connection oriented cluster matching that discounts tightly clustered
  groups.
- Borrow: the live round card with pool, contributors, and status; the
  four stage timeline; showing the maths in one line with a worked
  example; naming the Sybil defence explicitly.
- Do NOT copy: donor facing fundraising (FairShare splits an existing
  envelope among members, it does not raise from donors); the matching
  pool framing; Passport style identity (FairShare Sybil defence is DAO
  member curation).

## Giveth — donation platform (giveth.io, read live)

- Hero: "Raise More. Keep Everything." plus "Zero fees. Start
  fundraising in minutes." Two buttons: start a project, learn more.
- Below the hero: live project cards with amounts raised and contributor
  counts, then aggregate proof ("7,358 projects have raised $7.2M+",
  "Supported by 31,000+ donors"), then the upcoming QF round banner
  ($70,000 in matching), then a three step "Want your project in a QF
  round?" (create, build trust, join funding opportunities), then
  "New on Giveth" discovery cards, then a newsletter signup.
- Mechanism: zero platform fee, direct wallet to wallet donations,
  GIVbacks rewards donors 50% to 80% of donation value in GIV, GIVpower
  staking boosts project rank, quadratic funding rounds since 2023.
- Borrow: hero plus two actions; live cards with real amounts and
  contributor counts as the proof; aggregate numbers strip; a three step
  "how to join" with numbered steps; the round banner with pool and
  timing.
- Do NOT copy: donation and fundraising language; the zero fee pitch;
  the rewards token economy; the newsletter signup.

## SourceCred — contribution graph and Cred

- What it was: an open source PageRank based reputation algorithm
  (Cred) plus payout token (Grain). Activity from GitHub, Discourse,
  and Discord was ingested into a contribution graph (nodes are
  contributions and contributors, edges are relationships), CredRank
  computed a score for every node, and Cred drove weekly Grain
  distributions. Wound down as an organisation in 2022; influential
  as an idea.
- Hero pattern: the graph itself was the product demo. The explorer let
  a visitor click a person, expand the plus sign, and see exactly which
  contributions their Cred came from, down to a single pull request.
- Borrow: the expandable explanation is the strongest pattern in this
  whole set. FairShare already has explain my payout; the rebuild
  should make it the centrepiece of the live round section, not a
  footnote. Public weights and public algorithm, stated on the page.
- Do NOT copy: automatic scraping of platforms (FairShare settles what
  members said about each other, nothing more); PageRank; the Grain
  token.

## Superfluid — money streaming

- What it is: a real time asset streaming protocol. Instead of a one
  off payment, an account opens a stream that moves tokens to a
  recipient continuously, every second, at a set flow rate, until
  cancelled or the sender runs out. Super Tokens wrap ERC-20s; balances
  are computed live from net flow rate. Distribution pools split one
  stream across many recipients by units.
- Hero pattern: "Stream money every second" with a live ticking balance
  as the demo. The live number IS the product.
- Borrow: live numbers on the page that move or are read fresh from
  chain; the idea that the proof is a live figure, not a screenshot.
- Do NOT copy: streaming itself (FairShare settles discrete rounds);
  Super Tokens; per second flows.

## What FairShare borrows, in one list

1. Coordinape: circle and epoch framing, plain hero, allocation table
   as proof, honest gaming limit in plain sight.
2. Gitcoin: live round card (envelope, members, status), stage
   timeline, maths in one line with a worked example, named Sybil
   defence.
3. Giveth: hero plus two actions, live cards with real amounts,
   aggregate numbers strip, numbered three step join flow.
4. SourceCred: the expandable per person explanation as the centrepiece
   of the live round section.
5. Superfluid: live figures read fresh from chain as the proof, not
   screenshots.

## What FairShare does not copy

- No donor fundraising, no matching pool, no rewards token, no
  streaming, no scraped contribution graph, no linear proportional
  payout, no copied copy text or branding from any of the above.
