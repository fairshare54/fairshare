//! FairShare round contract (formerly Egbe) — a Sputnik DAO funds a
//! round, the round contract escrows only that round's envelope, and
//! members allocate points to each other. Settlement is deterministic
//! and on-chain.
//!
//! Rules (fixed, readable via `get_params`):
//!   * Each member gets 100 points per round to give to others.
//!   * No self-allocation; at least 3 distinct recipients; a reason link
//!     (non-empty, at most 200 chars) on every allocation; each allocation
//!     1..=100 points; total per member per round at most 100 points.
//!   * One allocation submission per member per round; re-submitting
//!     before settlement replaces the previous one.
//!   * Score for a member = (sum over distinct givers of
//!     isqrt(points_from_giver * giver_weight))^2. Giver weight is the
//!     giver's standing (starts at 100 for everyone).
//!   * Reciprocity discount: for each pair of members who allocated to
//!     each other, the mutual portion (the smaller of the two allocations)
//!     is discounted by 50% on BOTH directions before scoring.
//!   * Payouts are proportional to score, capped at 25% of the envelope
//!     per member; capped surplus is redistributed water-filling style to
//!     uncapped members, so the payout sum never exceeds the envelope and
//!     any dust remainder stays in the contract.
//!   * A round settles only after its deadline (7 days from creation) or
//!     after the owner closes it. Settling twice fails.
//!
//! Membership: production membership is a Sputnik DAO role read
//! cross-contract. The contract stores the DAO id and the role name
//! (default "council"); `sync_dao_members` reads the DAO's `get_policy`
//! live and mirrors that role's group into the local member set, and
//! `get_dao_role` does a live one-off check the same way. `allocate`
//! checks the synced set. `add_member` remains only as a clearly
//! labelled local-testing fallback (owner only) so rounds can be
//! exercised without a live DAO.
//!
//! Stretch (ownership units): on every settle, existing units decay 10%
//! and new units are minted pro-rata to payout share (units = payout
//! share in basis points of the envelope, so a capped 25% payout mints
//! 2500 units). Units are non-transferable — there is no transfer method.
//! `distribute_inflow` splits an attached inflow pro-rata to units.
//!
//! TESTNET ONLY. Never deploy to mainnet.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError};

// ---------------------------------------------------------------------------
// Fixed parameters
// ---------------------------------------------------------------------------

/// Points each member may give away per round.
pub const POINTS_PER_MEMBER: u16 = 100;
/// Minimum distinct recipients per allocation submission.
pub const MIN_RECIPIENTS: usize = 3;
/// Maximum reason length, in characters.
pub const MAX_REASON_CHARS: usize = 200;
/// Per-member payout cap, basis points of the envelope (25%).
pub const CAP_BPS: u128 = 2_500;
/// Reciprocity discount, basis points of the mutual portion (50%).
pub const RECIPROCITY_DISCOUNT_BPS: u128 = 5_000;
/// Round lifetime, nanoseconds (7 days).
pub const ROUND_DURATION_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
/// Standing every member starts with (also the giver weight).
pub const STANDING_START: u64 = 100;
/// Ownership-unit decay per settle: keep 9/10 of existing units.
pub const UNIT_DECAY_NUM: u64 = 9;
pub const UNIT_DECAY_DEN: u64 = 10;
/// Units minted per payout: payout share in basis points of the envelope.
pub const UNITS_PER_SHARE_BPS: u128 = 10_000;

/// Integer square root (floor) for u64, Newton iteration.
pub fn isqrt(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

// ---------------------------------------------------------------------------
// Sputnik DAO policy (minimal view — only the role list is read)
// ---------------------------------------------------------------------------

/// Extract the member list of one named role from a Sputnik DAO
/// `get_policy` response. The policy JSON is parsed generically
/// (`serde_json::Value`) so this contract never depends on the exact
/// Sputnik Policy struct shape: only `roles[].name` and
/// `roles[].kind.Group[]` are read. Any other role kind (Everyone,
/// Member, ...) contributes no members.
fn role_group_members(
    policy: &near_sdk::serde_json::Value,
    role_name: &str,
) -> Vec<AccountId> {
    let mut out = Vec::new();
    if let Some(roles) = policy.get("roles").and_then(|v| v.as_array()) {
        for role in roles {
            if role.get("name").and_then(|v| v.as_str()) != Some(role_name) {
                continue;
            }
            if let Some(group) = role
                .get("kind")
                .and_then(|k| k.get("Group"))
                .and_then(|v| v.as_array())
            {
                for id in group {
                    if let Some(s) = id.as_str() {
                        if let Ok(acc) = s.parse::<AccountId>() {
                            out.push(acc);
                        }
                    }
                }
            }
        }
    }
    out
}

/// Cross-contract interface to the Sputnik DAO: only `get_policy` is used.
#[near_sdk::ext_contract(ext_dao)]
pub trait ExtDao {
    fn get_policy(&self) -> near_sdk::serde_json::Value;
}

/// Callbacks on this contract for the DAO policy reads.
#[near_sdk::ext_contract(ext_self)]
pub trait ExtSelf {
    fn on_dao_policy_synced(
        &mut self,
        #[callback_result] result: Result<near_sdk::serde_json::Value, PromiseError>,
    );
    fn on_dao_role_checked(
        &mut self,
        account_id: AccountId,
        #[callback_result] result: Result<near_sdk::serde_json::Value, PromiseError>,
    ) -> bool;
}

// ---------------------------------------------------------------------------
// Stored + view types
// ---------------------------------------------------------------------------

/// One points allocation from a member to another member.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Allocation {
    pub to: AccountId,
    pub points: u16,
    /// Reason link / note. Non-empty, at most 200 chars.
    pub reason: String,
}

/// One giver's contribution to a member's score, as stored in the payout
/// explanation.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Contribution {
    pub giver: AccountId,
    /// Points the giver originally allocated to this member.
    pub points: u16,
    /// Points after the reciprocity discount.
    pub effective_points: u16,
    pub giver_weight: u64,
    /// isqrt(effective_points * giver_weight).
    pub sqrt_contribution: u64,
    /// Points removed from this edge by the reciprocity discount.
    pub reciprocity_discount_points: u16,
}

/// Round record (stored; yocto amounts are raw u128 internally).
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct Round {
    pub id: u64,
    pub envelope_yocto: u128,
    pub created_ns: u64,
    pub deadline_ns: u64,
    pub closed: bool,
    pub settled: bool,
    pub total_payout_yocto: u128,
}

/// Round record as returned by views (yocto amounts as U128 strings).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct RoundView {
    pub id: u64,
    pub envelope_yocto: U128,
    pub created_ns: u64,
    pub deadline_ns: u64,
    pub closed: bool,
    pub settled: bool,
    pub total_payout_yocto: U128,
}

impl From<&Round> for RoundView {
    fn from(r: &Round) -> Self {
        Self {
            id: r.id,
            envelope_yocto: U128(r.envelope_yocto),
            created_ns: r.created_ns,
            deadline_ns: r.deadline_ns,
            closed: r.closed,
            settled: r.settled,
            total_payout_yocto: U128(r.total_payout_yocto),
        }
    }
}

/// Full stored explanation of one member's payout in one round.
#[derive(BorshSerialize, BorshDeserialize, Clone, Debug)]
pub struct PayoutExplanation {
    pub round_id: u64,
    pub account_id: AccountId,
    pub score: u64,
    pub total_score: u64,
    pub contributions: Vec<Contribution>,
    pub reciprocity_discount_total_points: u16,
    pub cap_applied: bool,
    pub uncapped_payout_yocto: u128,
    pub payout_yocto: u128,
}

/// Explanation as returned by `explain_payout` (yocto as U128 strings).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutExplanationView {
    pub round_id: u64,
    pub account_id: AccountId,
    pub score: u64,
    pub total_score: u64,
    pub contributions: Vec<Contribution>,
    pub reciprocity_discount_total_points: u16,
    pub cap_applied: bool,
    pub uncapped_payout_yocto: U128,
    pub payout_yocto: U128,
}

impl From<&PayoutExplanation> for PayoutExplanationView {
    fn from(e: &PayoutExplanation) -> Self {
        Self {
            round_id: e.round_id,
            account_id: e.account_id.clone(),
            score: e.score,
            total_score: e.total_score,
            contributions: e.contributions.clone(),
            reciprocity_discount_total_points: e.reciprocity_discount_total_points,
            cap_applied: e.cap_applied,
            uncapped_payout_yocto: U128(e.uncapped_payout_yocto),
            payout_yocto: U128(e.payout_yocto),
        }
    }
}

/// One member's submitted allocations in a round.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct MemberAllocations {
    pub giver: AccountId,
    pub allocations: Vec<Allocation>,
}

/// Fixed round parameters, readable by anyone.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Params {
    pub points_per_member: u16,
    pub min_recipients: u16,
    pub cap_bps: u16,
    pub reciprocity_discount_bps: u16,
    pub round_duration_ns: u64,
    pub standing_start: u64,
}

/// What membership looks like for one account: the DAO id and role, whether
/// the account is in the member set last synced from that role, the last
/// live one-off check (if any), and when the set was last synced. This is
/// the last synced state — a view cannot make a cross-contract call, so
/// call `sync_dao_members` (or `get_dao_role`) to refresh it live from the
/// DAO.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DaoRoleInfo {
    pub dao_id: AccountId,
    pub account_id: AccountId,
    pub member_role: String,
    pub is_member: bool,
    /// Result of the last live one-off check via `get_dao_role`, if any.
    pub live_check: Option<bool>,
    pub last_sync_ns: u64,
    pub note: String,
}

/// The DAO this contract reads membership from, and sync state.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DaoInfo {
    pub dao_id: AccountId,
    pub member_role: String,
    pub member_count: u64,
    pub last_sync_ns: u64,
}

/// One member's payout in a round.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutView {
    pub account_id: AccountId,
    pub payout_yocto: U128,
}

/// One member's share of a distributed inflow.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct DistributionView {
    pub account_id: AccountId,
    pub amount_yocto: U128,
}

// ---------------------------------------------------------------------------
// Contract state
// ---------------------------------------------------------------------------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    dao_id: AccountId,
    /// Role in the DAO whose group is the member set (default "council").
    member_role: String,
    /// Block timestamp of the last successful DAO policy sync (0 = never).
    last_sync_ns: u64,
    /// Last live one-off role check per account (from `get_dao_role`).
    dao_role_cache: LookupMap<AccountId, bool>,
    rounds: LookupMap<u64, Round>,
    /// Members in join order (LookupSet cannot be iterated).
    members: Vector<AccountId>,
    member_set: LookupSet<AccountId>,
    /// Giver standing (weight). Absent = STANDING_START.
    standing: LookupMap<AccountId, u64>,
    /// "round_id:account" -> that member's latest allocation submission.
    allocations: LookupMap<String, Vec<Allocation>>,
    /// "round_id:account" -> payout in yoctoNEAR (0 if none).
    payouts: LookupMap<String, u128>,
    /// "round_id:account" -> full payout explanation.
    explanations: LookupMap<String, PayoutExplanation>,
    /// Non-transferable ownership units per account (stretch).
    units: LookupMap<AccountId, u64>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, dao_id: AccountId) -> Self {
        Self {
            owner_id,
            dao_id,
            member_role: "council".to_string(),
            last_sync_ns: 0,
            dao_role_cache: LookupMap::new(b"c"),
            rounds: LookupMap::new(b"r"),
            members: Vector::new(b"m"),
            member_set: LookupSet::new(b"s"),
            standing: LookupMap::new(b"w"),
            allocations: LookupMap::new(b"a"),
            payouts: LookupMap::new(b"p"),
            explanations: LookupMap::new(b"e"),
            units: LookupMap::new(b"u"),
        }
    }

    // -- helpers -----------------------------------------------------------

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "only the contract owner may call this"
        );
    }

    fn standing_of(&self, account: &AccountId) -> u64 {
        self.standing.get(account).copied().unwrap_or(STANDING_START)
    }

    fn round_or_panic(&self, round_id: u64) -> Round {
        self.rounds
            .get(&round_id)
            .expect("round does not exist")
            .clone()
    }

    fn submission_key(round_id: u64, account: &AccountId) -> String {
        format!("{}:{}", round_id, account)
    }

    // -- membership: local-testing fallback + DAO (production path) -------

    /// Seed a member for local testing ONLY. Production membership comes
    /// from `sync_dao_members`, which reads the DAO role live — do not rely
    /// on this method on a live deployment. Only the owner may call it.
    pub fn add_member(&mut self, member: AccountId) {
        self.assert_owner();
        if !self.member_set.contains(&member) {
            self.member_set.insert(member.clone());
            self.members.push(member.clone());
            self.standing.insert(member, STANDING_START);
        }
    }

    /// Point the contract at a different Sputnik DAO. Owner only. The
    /// member set is re-synced from the new DAO by calling
    /// `sync_dao_members` afterwards.
    pub fn set_dao_id(&mut self, dao_id: AccountId) {
        self.assert_owner();
        self.dao_id = dao_id;
    }

    /// Change which DAO role holds the members (default "council").
    /// Owner only.
    pub fn set_member_role(&mut self, member_role: String) {
        self.assert_owner();
        assert!(!member_role.is_empty(), "member role must not be empty");
        self.member_role = member_role;
    }

    /// Refresh the member set from the Sputnik DAO, live and on-chain.
    /// Anyone may call it. This reads the DAO's `get_policy`
    /// cross-contract and mirrors that role's group into the local member
    /// set — the DAO is the source of truth, the local set is a synced
    /// mirror of it. `allocate` checks the synced set, so call this after
    /// the DAO's council changes.
    pub fn sync_dao_members(&mut self) -> Promise {
        ext_dao::ext(self.dao_id.clone())
            .with_static_gas(Gas::from_tgas(5))
            .get_policy()
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(10))
                    .on_dao_policy_synced(),
            )
    }

    /// Live one-off check: is this account in the DAO role right now?
    /// This is a change call — a view cannot make a cross-contract call.
    /// It reads the DAO's `get_policy` live and the callback stores the
    /// answer, which `get_cached_dao_role` then reports. The returned
    /// promise resolves to the bool from the callback.
    pub fn get_dao_role(&mut self, account_id: AccountId) -> Promise {
        ext_dao::ext(self.dao_id.clone())
            .with_static_gas(Gas::from_tgas(5))
            .get_policy()
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(5))
                    .on_dao_role_checked(account_id),
            )
    }

    /// Callback for `sync_dao_members`: apply the DAO policy to the local
    /// member set. Members dropped from the role lose membership (and so
    /// cannot allocate in later rounds); members added to the role gain it.
    /// A failed DAO call leaves the existing set untouched.
    #[private]
    pub fn on_dao_policy_synced(
        &mut self,
        #[callback_result] result: Result<near_sdk::serde_json::Value, PromiseError>,
    ) {
        let policy = match result {
            Ok(p) => p,
            Err(_) => return,
        };
        let wanted = role_group_members(&policy, &self.member_role);
        let current: Vec<AccountId> = self.members.iter().cloned().collect();
        for m in &current {
            if !wanted.contains(m) {
                self.member_set.remove(m);
                if let Some(idx) = self.members.iter().position(|x| x == m) {
                    self.members.swap_remove(idx as u32);
                }
            }
        }
        for m in &wanted {
            if !self.member_set.contains(m) {
                self.member_set.insert(m.clone());
                self.members.push(m.clone());
                if self.standing.get(m).is_none() {
                    self.standing.insert(m.clone(), STANDING_START);
                }
            }
        }
        self.last_sync_ns = env::block_timestamp();
    }

    /// Callback for `get_dao_role`: store and return the live answer.
    #[private]
    pub fn on_dao_role_checked(
        &mut self,
        account_id: AccountId,
        #[callback_result] result: Result<near_sdk::serde_json::Value, PromiseError>,
    ) -> bool {
        let is_member = match result {
            Ok(policy) => {
                role_group_members(&policy, &self.member_role).contains(&account_id)
            }
            Err(_) => false,
        };
        self.dao_role_cache.insert(account_id, is_member);
        is_member
    }

    // -- rounds ------------------------------------------------------------

    /// Create a round and escrow its envelope. The attached deposit must
    /// equal `envelope_yocto` exactly. Only the owner or the DAO may call
    /// this; for local testing the owner calls it. Deadline is 7 days from
    /// creation.
    #[payable]
    pub fn create_round(&mut self, round_id: u64, envelope_yocto: U128) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.owner_id || caller == self.dao_id,
            "only the owner or the DAO may create a round"
        );
        let attached = env::attached_deposit().as_yoctonear();
        assert_eq!(
            attached, envelope_yocto.0,
            "attached deposit must equal the round envelope"
        );
        assert!(envelope_yocto.0 > 0, "envelope must be greater than zero");
        assert!(
            !self.rounds.contains_key(&round_id),
            "round already exists"
        );
        let now = env::block_timestamp();
        self.rounds.insert(
            round_id,
            Round {
                id: round_id,
                envelope_yocto: envelope_yocto.0,
                created_ns: now,
                deadline_ns: now + ROUND_DURATION_NS,
                closed: false,
                settled: false,
                total_payout_yocto: 0,
            },
        );
    }

    /// Close a round early so it can settle before its deadline. Owner only.
    pub fn close_round(&mut self, round_id: u64) {
        self.assert_owner();
        let mut round = self.round_or_panic(round_id);
        assert!(!round.settled, "round is already settled");
        assert!(!round.closed, "round is already closed");
        round.closed = true;
        self.rounds.insert(round_id, round);
    }

    /// Submit (or replace, before settlement) this member's allocations
    /// for a round. Caller must be a member — membership is the set synced
    /// from the DAO role (`sync_dao_members`), or seeded via `add_member`
    /// in local testing only. Validates: at least 3
    /// distinct recipients, no self-allocation, each allocation 1..=100
    /// points, total at most 100 points, every reason non-empty and at
    /// most 200 chars. Rejected after the round closes, settles, or its
    /// deadline passes.
    pub fn allocate(&mut self, round_id: u64, allocations: Vec<Allocation>) {
        let caller = env::predecessor_account_id();
        let round = self.round_or_panic(round_id);
        assert!(!round.settled, "round is already settled");
        assert!(!round.closed, "round is closed");
        assert!(
            env::block_timestamp() < round.deadline_ns,
            "allocation window has passed (deadline reached)"
        );
        assert!(
            self.member_set.contains(&caller),
            "caller is not a member of this round"
        );
        assert!(
            allocations.len() >= MIN_RECIPIENTS,
            "at least 3 distinct recipients are required"
        );
        let mut seen: Vec<AccountId> = Vec::new();
        let mut total: u32 = 0;
        for a in &allocations {
            assert_ne!(a.to, caller, "cannot allocate points to yourself");
            assert!(
                (1..=POINTS_PER_MEMBER).contains(&a.points),
                "allocation points must be between 1 and 100"
            );
            assert!(
                !seen.contains(&a.to),
                "duplicate recipient in allocations"
            );
            seen.push(a.to.clone());
            assert!(
                !a.reason.is_empty(),
                "every allocation needs a non-empty reason"
            );
            assert!(
                a.reason.chars().count() <= MAX_REASON_CHARS,
                "reason must be at most 200 characters"
            );
            total += a.points as u32;
        }
        assert_eq!(
            seen.len(),
            allocations.len(),
            "at least 3 distinct recipients are required"
        );
        assert!(
            total <= POINTS_PER_MEMBER as u32,
            "total points must not exceed 100"
        );
        self.allocations
            .insert(Self::submission_key(round_id, &caller), allocations);
    }

    // -- settlement ----------------------------------------------------------

    /// Settle a round. Only after its deadline, or after the owner closes
    /// it. Anyone may call it once the condition holds. Computes scores
    /// deterministically, applies the reciprocity discount and the 25%
    /// cap, stores a full explanation per member, transfers each payout,
    /// mints ownership units (stretch), and marks the round settled.
    /// Settling twice fails.
    pub fn settle_round(&mut self, round_id: u64) {
        let mut round = self.round_or_panic(round_id);
        assert!(!round.settled, "round is already settled");
        assert!(
            round.closed || env::block_timestamp() >= round.deadline_ns,
            "round is not yet settleable: wait for the deadline or ask the owner to close it"
        );

        let members: Vec<AccountId> = self.members.iter().cloned().collect();

        // Gather every submitted edge (giver, recipient, points).
        let mut edges: Vec<(AccountId, AccountId, u16)> = Vec::new();
        for giver in &members {
            if let Some(allocs) = self
                .allocations
                .get(&Self::submission_key(round_id, giver))
            {
                for a in allocs {
                    edges.push((giver.clone(), a.to.clone(), a.points));
                }
            }
        }

        // Effective points: for each mutual pair, the smaller of the two
        // allocations is the mutual portion; discount it by 50% on BOTH
        // directions before scoring.
        // (giver, recipient, effective_points, discount_points)
        let mut effective: Vec<(AccountId, AccountId, u16, u16)> = Vec::new();
        for (giver, to, points) in &edges {
            let reverse = edges
                .iter()
                .find(|(g2, t2, _)| g2 == to && t2 == giver)
                .map(|(_, _, p)| *p);
            let discount = match reverse {
                // u32 arithmetic: min(points) * 5000 can exceed u16::MAX.
                Some(rp) => (((*points).min(rp) as u32 * RECIPROCITY_DISCOUNT_BPS as u32)
                    / 10_000) as u16,
                None => 0,
            };
            effective.push((giver.clone(), to.clone(), points - discount, discount));
        }

        // Scores: score = (sum over distinct givers of
        // isqrt(effective_points * giver_weight))^2.
        let mut scores: Vec<(AccountId, u64)> = Vec::new();
        let mut explanations: Vec<PayoutExplanation> = Vec::new();
        for member in &members {
            let mut contributions: Vec<Contribution> = Vec::new();
            let mut sqrt_sum: u64 = 0;
            let mut discount_total: u16 = 0;
            for (giver, to, eff_points, discount) in &effective {
                if to == member && giver != member {
                    let weight = self.standing_of(giver);
                    let sqrt_c = isqrt((*eff_points as u64) * weight);
                    sqrt_sum += sqrt_c;
                    discount_total += *discount;
                    let original = edges
                        .iter()
                        .find(|(g2, t2, _)| g2 == giver && t2 == member)
                        .map(|(_, _, p)| *p)
                        .unwrap_or(0);
                    contributions.push(Contribution {
                        giver: giver.clone(),
                        points: original,
                        effective_points: *eff_points,
                        giver_weight: weight,
                        sqrt_contribution: sqrt_c,
                        reciprocity_discount_points: *discount,
                    });
                }
            }
            let score = sqrt_sum
                .checked_mul(sqrt_sum)
                .expect("score overflow");
            scores.push((member.clone(), score));
            explanations.push(PayoutExplanation {
                round_id,
                account_id: member.clone(),
                score,
                total_score: 0, // filled below
                contributions,
                reciprocity_discount_total_points: discount_total,
                cap_applied: false, // filled below
                uncapped_payout_yocto: 0, // filled below
                payout_yocto: 0, // filled below
            });
        }
        let total_score: u128 = scores.iter().map(|(_, s)| *s as u128).sum();
        for e in explanations.iter_mut() {
            e.total_score = total_score as u64;
        }

        // Payouts: proportional to score, capped at 25% of the envelope.
        // Capped surplus is redistributed water-filling style to uncapped
        // members, so the payout sum never exceeds the envelope.
        let cap = round.envelope_yocto * CAP_BPS / 10_000;
        let mut payouts: Vec<u128> = vec![0; members.len()];
        let mut uncapped: Vec<u128> = vec![0; members.len()];
        for (i, (_, score)) in scores.iter().enumerate() {
            uncapped[i] = if total_score == 0 {
                0
            } else {
                (*score as u128) * round.envelope_yocto / total_score
            };
        }
        if total_score > 0 {
            let mut remaining = round.envelope_yocto;
            let mut active: Vec<usize> = scores
                .iter()
                .enumerate()
                .filter(|(_, (_, s))| *s > 0)
                .map(|(i, _)| i)
                .collect();
            while !active.is_empty() {
                let tot: u128 = active.iter().map(|&i| scores[i].1 as u128).sum();
                let over: Vec<usize> = active
                    .iter()
                    .copied()
                    .filter(|&i| scores[i].1 as u128 * remaining / tot > cap)
                    .collect();
                if over.is_empty() {
                    for &i in &active {
                        let pay = scores[i].1 as u128 * remaining / tot;
                        payouts[i] = pay;
                    }
                    break;
                }
                for i in over {
                    payouts[i] = cap;
                    active.retain(|&x| x != i);
                    remaining -= cap;
                }
            }
        }
        let total_payout: u128 = payouts.iter().sum();

        // Store payouts + explanations, mint units, transfer payouts.
        for (i, member) in members.iter().enumerate() {
            explanations[i].cap_applied = uncapped[i] > cap;
            explanations[i].uncapped_payout_yocto = uncapped[i];
            explanations[i].payout_yocto = payouts[i];
            self.payouts
                .insert(Self::submission_key(round_id, member), payouts[i]);
            self.explanations.insert(
                Self::submission_key(round_id, member),
                explanations[i].clone(),
            );
            // Stretch: decay existing units 10%, then mint units equal to
            // the payout share in basis points of the envelope.
            let old_units = self.units.get(member).copied().unwrap_or(0);
            let decayed = old_units * UNIT_DECAY_NUM / UNIT_DECAY_DEN;
            let minted = if round.envelope_yocto == 0 {
                0
            } else {
                (payouts[i] * UNITS_PER_SHARE_BPS / round.envelope_yocto) as u64
            };
            self.units.insert(member.clone(), decayed + minted);
            if payouts[i] > 0 {
                let _ = Promise::new(member.clone())
                    .transfer(NearToken::from_yoctonear(payouts[i]));
            }
        }

        round.settled = true;
        round.total_payout_yocto = total_payout;
        self.rounds.insert(round_id, round);
    }

    /// Split an attached inflow pro-rata to ownership units (stretch).
    /// The attached deposit must equal `amount`. Returns each member's
    /// share. Dust from integer division stays in the contract. Fails if
    /// no units are outstanding.
    #[payable]
    pub fn distribute_inflow(&mut self, amount: U128) -> Vec<DistributionView> {
        let attached = env::attached_deposit().as_yoctonear();
        assert_eq!(
            attached, amount.0,
            "attached deposit must equal the inflow amount"
        );
        assert!(amount.0 > 0, "inflow amount must be greater than zero");
        let members: Vec<AccountId> = self.members.iter().cloned().collect();
        let total_units: u64 = members
            .iter()
            .map(|m| self.units.get(m).copied().unwrap_or(0))
            .sum();
        assert!(total_units > 0, "no ownership units outstanding");
        let mut out: Vec<DistributionView> = Vec::new();
        for member in &members {
            let units = self.units.get(member).copied().unwrap_or(0);
            if units == 0 {
                continue;
            }
            let share = amount.0 * (units as u128) / (total_units as u128);
            if share > 0 {
                let _ = Promise::new(member.clone())
                    .transfer(NearToken::from_yoctonear(share));
                out.push(DistributionView {
                    account_id: member.clone(),
                    amount_yocto: U128(share),
                });
            }
        }
        out
    }

    // -- views ---------------------------------------------------------------

    pub fn get_round(&self, round_id: u64) -> Option<RoundView> {
        self.rounds.get(&round_id).map(RoundView::from)
    }

    pub fn get_allocations(&self, round_id: u64) -> Vec<MemberAllocations> {
        let mut out: Vec<MemberAllocations> = Vec::new();
        for member in self.members.iter() {
            if let Some(allocs) = self
                .allocations
                .get(&Self::submission_key(round_id, &member))
            {
                out.push(MemberAllocations {
                    giver: member.clone(),
                    allocations: allocs.clone(),
                });
            }
        }
        out
    }

    pub fn explain_payout(
        &self,
        round_id: u64,
        account_id: AccountId,
    ) -> Option<PayoutExplanationView> {
        self.explanations
            .get(&Self::submission_key(round_id, &account_id))
            .map(PayoutExplanationView::from)
    }

    pub fn get_payouts(&self, round_id: u64) -> Vec<PayoutView> {
        let mut out: Vec<PayoutView> = Vec::new();
        for member in self.members.iter() {
            if let Some(p) = self.payouts.get(&Self::submission_key(round_id, &member)) {
                out.push(PayoutView {
                    account_id: member.clone(),
                    payout_yocto: U128(*p),
                });
            }
        }
        out
    }

    pub fn get_members(&self) -> Vec<AccountId> {
        self.members.iter().cloned().collect()
    }

    pub fn get_standing(&self, account_id: AccountId) -> u64 {
        self.standing_of(&account_id)
    }

    pub fn get_params(&self) -> Params {
        Params {
            points_per_member: POINTS_PER_MEMBER,
            min_recipients: MIN_RECIPIENTS as u16,
            cap_bps: CAP_BPS as u16,
            reciprocity_discount_bps: RECIPROCITY_DISCOUNT_BPS as u16,
            round_duration_ns: ROUND_DURATION_NS,
            standing_start: STANDING_START,
        }
    }

    /// What the contract knows about an account's DAO membership: the DAO
    /// id and role, whether the account is in the member set synced from
    /// that role, the last live one-off check (if any), and when the set
    /// was last synced. This is a view of the last synced state; call
    /// `sync_dao_members` (or `get_dao_role`) to refresh it live from the
    /// DAO — a view cannot make a cross-contract call.
    pub fn get_cached_dao_role(&self, account_id: AccountId) -> DaoRoleInfo {
        DaoRoleInfo {
            dao_id: self.dao_id.clone(),
            account_id: account_id.clone(),
            member_role: self.member_role.clone(),
            is_member: self.member_set.contains(&account_id),
            live_check: self.dao_role_cache.get(&account_id).copied(),
            last_sync_ns: self.last_sync_ns,
            note: "Membership is read live from the Sputnik DAO role via get_policy (sync_dao_members / get_dao_role). This view reports the last synced state.".to_string(),
        }
    }

    /// The DAO this contract reads membership from, and sync state.
    pub fn get_dao_info(&self) -> DaoInfo {
        DaoInfo {
            dao_id: self.dao_id.clone(),
            member_role: self.member_role.clone(),
            member_count: self.members.len() as u64,
            last_sync_ns: self.last_sync_ns,
        }
    }

    /// Non-transferable ownership units held by an account (stretch).
    pub fn get_units(&self, account_id: AccountId) -> u64 {
        self.units.get(&account_id).copied().unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const OWNER: &str = "owner.testnet";
    const DAO: &str = "egbe-dao.testnet";
    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const T0: u64 = 1_000_000_000_000_000_000;

    fn ctx(predecessor: &str, attached: u128, timestamp_ns: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor.parse().unwrap())
            .current_account_id("fairshare-contract.testnet".parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(attached))
            .block_timestamp(timestamp_ns);
        b
    }

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn setup(members: &[&str]) -> Contract {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        for m in members {
            testing_env!(ctx(OWNER, 0, T0).build());
            c.add_member(acc(m));
        }
        c
    }

    fn alloc(to: &str, points: u16, reason: &str) -> Allocation {
        Allocation {
            to: acc(to),
            points,
            reason: reason.to_string(),
        }
    }

    fn submit(c: &mut Contract, giver: &str, round_id: u64, allocs: Vec<Allocation>) {
        testing_env!(ctx(giver, 0, T0).build());
        c.allocate(round_id, allocs);
    }

    fn create_round(c: &mut Contract, round_id: u64, envelope: u128) {
        testing_env!(ctx(OWNER, envelope, T0).build());
        c.create_round(round_id, U128(envelope));
    }

    fn close(c: &mut Contract, round_id: u64) {
        testing_env!(ctx(OWNER, 0, T0).build());
        c.close_round(round_id);
    }

    fn settle(c: &mut Contract, round_id: u64) {
        testing_env!(ctx(OWNER, 0, T0).build());
        c.settle_round(round_id);
    }

    fn ex(c: &Contract, round_id: u64, who: &str) -> PayoutExplanationView {
        c.explain_payout(round_id, acc(who))
            .unwrap_or_else(|| panic!("no explanation for {}", who))
    }

    // -- allocation validation ----------------------------------------------

    #[test]
    #[should_panic(expected = "cannot allocate points to yourself")]
    fn validation_self_allocation_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("alice.testnet", 40, "me"),
                alloc("bob.testnet", 30, "work"),
                alloc("carol.testnet", 30, "work"),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "at least 3 distinct recipients are required")]
    fn validation_too_few_recipients_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 50, "work"),
                alloc("carol.testnet", 50, "work"),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "total points must not exceed 100")]
    fn validation_over_100_points_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet", "dave.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 50, "work"),
                alloc("carol.testnet", 40, "work"),
                alloc("dave.testnet", 11, "work"),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "every allocation needs a non-empty reason")]
    fn validation_empty_reason_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet", "dave.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 40, "work"),
                alloc("carol.testnet", 30, ""),
                alloc("dave.testnet", 30, "work"),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "reason must be at most 200 characters")]
    fn validation_reason_too_long_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet", "dave.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        let long = "x".repeat(201);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 40, "work"),
                alloc("carol.testnet", 30, &long),
                alloc("dave.testnet", 30, "work"),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "allocation points must be between 1 and 100")]
    fn validation_zero_points_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet", "dave.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 0, "work"),
                alloc("carol.testnet", 50, "work"),
                alloc("dave.testnet", 50, "work"),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "duplicate recipient in allocations")]
    fn validation_duplicate_recipient_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet", "dave.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 40, "work"),
                alloc("bob.testnet", 30, "more work"),
                alloc("carol.testnet", 30, "work"),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "caller is not a member")]
    fn validation_non_member_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "stranger.testnet",
            1,
            vec![
                alloc("alice.testnet", 40, "work"),
                alloc("bob.testnet", 30, "work"),
                alloc("carol.testnet", 30, "work"),
            ],
        );
    }

    #[test]
    fn allocate_resubmission_replaces_previous() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet", "dave.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 50, "first"),
                alloc("carol.testnet", 25, "first"),
                alloc("dave.testnet", 25, "first"),
            ],
        );
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 10, "second"),
                alloc("carol.testnet", 45, "second"),
                alloc("dave.testnet", 45, "second"),
            ],
        );
        let got = c.get_allocations(1);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].allocations[0].points, 10);
        assert_eq!(got[0].allocations[0].reason, "second");
        assert_eq!(got[0].allocations[1].points, 45);
    }

    // -- worked settlement example -------------------------------------------
    //
    // Envelope 100 NEAR. Standing 100 for everyone.
    //   alice: dave 66, carol 26, bob 8
    //   bob:   frank 75, carol 13, dave 4, alice 8
    //   carol: alice 18, frank 64, erin 18
    //   dave:  alice 7, erin 65, bob 28
    //   erin:  frank 1, bob 33, dave 66
    //   frank: alice 61, erin 34, carol 1, dave 4
    // Effective points after the 50% reciprocity discount on each mutual
    // pair (discount = smaller of the pair / 2, taken off both directions),
    // sqrt contributions (standing 100), sqrt-sums and scores:
    //   alice: bob 8(-4)->4:20, carol 18(-9)->9:30, dave 7(-3)->4:20,
    //     frank 61:78 -> sum 148 -> score 21904
    //   bob:   alice 8(-4)->4:20, dave 28(-2)->26:50, erin 33:57
    //     -> sum 127 -> score 16129
    //   carol: alice 26(-9)->17:41, bob 13:36, frank 1:10
    //     -> sum 87 -> score 7569
    //   dave:  alice 66(-3)->63:79, bob 4(-2)->2:14, erin 66(-32)->34:58,
    //     frank 4:20 -> sum 171 -> score 29241
    //   erin:  carol 18:42, dave 65(-32)->33:57, frank 34:58
    //     -> sum 157 -> score 24649
    //   frank: bob 75:86, carol 64:80, erin 1:10
    //     -> sum 176 -> score 30976
    // Total score 130468. No member's raw share reaches the 25% cap, so
    // payouts are exactly score/total * 100 NEAR (integer division,
    // 1 yocto dust remains). Table computed independently in Python.
    #[test]
    fn worked_example_settlement_math() {
        let members = [
            "alice.testnet",
            "bob.testnet",
            "carol.testnet",
            "dave.testnet",
            "erin.testnet",
            "frank.testnet",
        ];
        let mut c = setup(&members);
        let env = 100 * NEAR;
        create_round(&mut c, 1, env);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("dave.testnet", 66, "ran the demo session"),
                alloc("carol.testnet", 26, "reviewed the round notes"),
                alloc("bob.testnet", 8, "answered my question"),
            ],
        );
        submit(
            &mut c,
            "bob.testnet",
            1,
            vec![
                alloc("frank.testnet", 75, "shipped the fix"),
                alloc("carol.testnet", 13, "helped debug"),
                alloc("dave.testnet", 4, "shared notes"),
                alloc("alice.testnet", 8, "paired with me"),
            ],
        );
        submit(
            &mut c,
            "carol.testnet",
            1,
            vec![
                alloc("alice.testnet", 18, "wrote the spec"),
                alloc("frank.testnet", 64, "built the prototype"),
                alloc("erin.testnet", 18, "tested the flow"),
            ],
        );
        submit(
            &mut c,
            "dave.testnet",
            1,
            vec![
                alloc("alice.testnet", 7, "reviewed my code"),
                alloc("erin.testnet", 65, "mentored me"),
                alloc("bob.testnet", 28, "co-wrote the doc"),
            ],
        );
        submit(
            &mut c,
            "erin.testnet",
            1,
            vec![
                alloc("frank.testnet", 1, "quick tip"),
                alloc("bob.testnet", 33, "designed the UI"),
                alloc("dave.testnet", 66, "led the round"),
            ],
        );
        submit(
            &mut c,
            "frank.testnet",
            1,
            vec![
                alloc("alice.testnet", 61, "organised everything"),
                alloc("erin.testnet", 34, "gave feedback"),
                alloc("carol.testnet", 1, "fixed a typo"),
                alloc("dave.testnet", 4, "shared a link"),
            ],
        );
        close(&mut c, 1);
        settle(&mut c, 1);

        let expected: [(&str, u64, u128); 6] = [
            ("alice.testnet", 21904, 16788791121194469141858540),
            ("bob.testnet", 16129, 12362418370788239261734678),
            ("carol.testnet", 7569, 5801422571051905448079222),
            ("dave.testnet", 29241, 22412392310758193580034951),
            ("erin.testnet", 24649, 18892755311647300487475856),
            ("frank.testnet", 30976, 23742220314559892080816752),
        ];
        let mut total_payout: u128 = 0;
        for (who, score, payout) in expected {
            let e = ex(&c, 1, who);
            assert_eq!(e.score, score, "score for {}", who);
            assert_eq!(e.total_score, 130468, "total score");
            assert_eq!(e.payout_yocto.0, payout, "payout for {}", who);
            assert!(!e.cap_applied, "no cap should apply for {}", who);
            total_payout += payout;
        }
        assert_eq!(total_payout, env - 1, "1 yocto dust stays in the contract");
        let round = c.get_round(1).expect("round");
        assert!(round.settled);
        assert_eq!(round.total_payout_yocto.0, env - 1);

        // Spot-check one explanation in full: alice's gift from frank is
        // one-way (61 pts, no discount, isqrt(6100) = 78); her gift from
        // bob is mutual 8/8, discounted to 4 (isqrt(400) = 20).
        let alice = ex(&c, 1, "alice.testnet");
        let from_frank = alice
            .contributions
            .iter()
            .find(|ct| ct.giver == acc("frank.testnet"))
            .expect("frank contribution");
        assert_eq!(from_frank.points, 61);
        assert_eq!(from_frank.effective_points, 61);
        assert_eq!(from_frank.sqrt_contribution, 78);
        assert_eq!(from_frank.reciprocity_discount_points, 0);
        let from_bob = alice
            .contributions
            .iter()
            .find(|ct| ct.giver == acc("bob.testnet"))
            .expect("bob contribution");
        assert_eq!(from_bob.points, 8);
        assert_eq!(from_bob.effective_points, 4);
        assert_eq!(from_bob.sqrt_contribution, 20);
        assert_eq!(from_bob.reciprocity_discount_points, 4);
    }

    // -- reciprocity ---------------------------------------------------------
    //
    // Same 5 members, same c/d/e allocations, same a allocations. Only b's
    // outgoing edge to a changes: in round 1 b does NOT allocate to a
    // (a -> b 50 is one-way); in round 2 b allocates a 50 (mutual).
    // b receives only from a in both rounds, so the comparison is clean:
    // one-way b score = isqrt(50*100)^2 = 70^2 = 4900;
    // mutual b score = isqrt(25*100)^2 = 50^2 = 2500.
    #[test]
    fn reciprocity_discount_mutual_scores_less_than_one_way() {
        let members = ["a.testnet", "b.testnet", "c.testnet", "d.testnet", "e.testnet"];
        let mut c = setup(&members);
        let fixed_cde = |giver: &str, c: &mut Contract, round: u64| {
            let others: [(&str, u16); 3] = match giver {
                "c.testnet" => [("a.testnet", 40), ("d.testnet", 30), ("e.testnet", 30)],
                "d.testnet" => [("a.testnet", 40), ("c.testnet", 30), ("e.testnet", 30)],
                _ => [("a.testnet", 40), ("c.testnet", 30), ("d.testnet", 30)],
            };
            submit(
                c,
                giver,
                round,
                others
                    .iter()
                    .map(|(to, p)| alloc(to, *p, "work"))
                    .collect(),
            );
        };
        for round in [1u64, 2u64] {
            create_round(&mut c, round, 60 * NEAR);
            submit(
                &mut c,
                "a.testnet",
                round,
                vec![
                    alloc("b.testnet", 50, "work"),
                    alloc("c.testnet", 25, "work"),
                    alloc("d.testnet", 25, "work"),
                ],
            );
            if round == 1 {
                submit(
                    &mut c,
                    "b.testnet",
                    round,
                    vec![
                        alloc("c.testnet", 40, "work"),
                        alloc("d.testnet", 30, "work"),
                        alloc("e.testnet", 30, "work"),
                    ],
                );
            } else {
                submit(
                    &mut c,
                    "b.testnet",
                    round,
                    vec![
                        alloc("a.testnet", 50, "work"),
                        alloc("c.testnet", 25, "work"),
                        alloc("d.testnet", 25, "work"),
                    ],
                );
            }
            fixed_cde("c.testnet", &mut c, round);
            fixed_cde("d.testnet", &mut c, round);
            fixed_cde("e.testnet", &mut c, round);
            close(&mut c, round);
            settle(&mut c, round);
        }
        assert_eq!(ex(&c, 1, "b.testnet").score, 4900, "one-way score");
        assert_eq!(ex(&c, 2, "b.testnet").score, 2500, "mutual score");
        assert!(
            ex(&c, 2, "b.testnet").score < ex(&c, 1, "b.testnet").score,
            "mutual allocation must score less than the same points one-way"
        );
    }

    // -- 25% cap -------------------------------------------------------------
    //
    // 8 members, 100 NEAR. Everyone piles onto `a`, whose raw share is
    // 79.05% (score 254016 / total 321345). `a` is capped at exactly
    // 25 NEAR; the surplus flows to the others, none of whom then hits
    // the cap. Remainder 2 yocto.
    #[test]
    fn cap_25_percent_applies() {
        let members = [
            "a.testnet",
            "b.testnet",
            "c.testnet",
            "d.testnet",
            "e.testnet",
            "f.testnet",
            "g.testnet",
            "h.testnet",
        ];
        let mut c = setup(&members);
        let env = 100 * NEAR;
        create_round(&mut c, 1, env);
        let pile_on = |to_a: Vec<(&str, u16)>| -> Vec<Allocation> {
            to_a.iter()
                .map(|(to, p)| alloc(to, *p, "work"))
                .collect()
        };
        submit(
            &mut c,
            "a.testnet",
            1,
            pile_on(vec![
                ("b.testnet", 20),
                ("c.testnet", 20),
                ("d.testnet", 20),
                ("e.testnet", 20),
                ("f.testnet", 20),
            ]),
        );
        for (who, others) in [
            ("b.testnet", [("c.testnet", 20), ("d.testnet", 20)]),
            ("c.testnet", [("b.testnet", 20), ("d.testnet", 20)]),
            ("d.testnet", [("b.testnet", 20), ("c.testnet", 20)]),
            ("e.testnet", [("f.testnet", 20), ("g.testnet", 20)]),
            ("f.testnet", [("e.testnet", 20), ("g.testnet", 20)]),
            ("g.testnet", [("e.testnet", 20), ("f.testnet", 20)]),
            ("h.testnet", [("b.testnet", 20), ("c.testnet", 20)]),
        ] {
            let mut v = vec![alloc("a.testnet", 60, "work")];
            v.extend(others.iter().map(|(to, p)| alloc(to, *p, "work")));
            submit(&mut c, who, 1, v);
        }
        close(&mut c, 1);
        settle(&mut c, 1);

        let a = ex(&c, 1, "a.testnet");
        assert_eq!(a.score, 254016);
        assert!(a.cap_applied, "a's raw share exceeds the cap");
        assert!(a.uncapped_payout_yocto.0 > 25 * NEAR);
        assert_eq!(a.payout_yocto.0, 25 * NEAR, "a capped at exactly 25%");

        let expected: [(&str, u128); 7] = [
            ("b.testnet", 20907409882814240520429532),
            ("c.testnet", 20907409882814240520429532),
            ("d.testnet", 9634407164817537762331239),
            ("e.testnet", 9634407164817537762331239),
            ("f.testnet", 9634407164817537762331239),
            ("g.testnet", 4281958739918905672147217),
            ("h.testnet", 0),
        ];
        let mut sum: u128 = 25 * NEAR;
        for (who, payout) in expected {
            let e = ex(&c, 1, who);
            assert_eq!(e.payout_yocto.0, payout, "payout for {}", who);
            assert!(e.payout_yocto.0 <= 25 * NEAR, "cap holds for {}", who);
            assert!(!e.cap_applied, "only a is capped, not {}", who);
            sum += payout;
        }
        assert_eq!(sum, env - 2, "2 yocto dust stays in the contract");
    }

    // -- settle timing / double settle ---------------------------------------

    #[test]
    #[should_panic(expected = "round is not yet settleable")]
    fn settle_before_deadline_without_close_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        settle(&mut c, 1);
    }

    #[test]
    fn settle_after_deadline_without_close_works() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        testing_env!(ctx(OWNER, 0, T0 + ROUND_DURATION_NS + 1).build());
        c.settle_round(1);
        assert!(c.get_round(1).expect("round").settled);
    }

    #[test]
    #[should_panic(expected = "round is already settled")]
    fn double_settle_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        close(&mut c, 1);
        settle(&mut c, 1);
        settle(&mut c, 1);
    }

    #[test]
    #[should_panic(expected = "round is already settled")]
    fn allocate_after_settle_rejected() {
        let mut c = setup(&["alice.testnet", "bob.testnet", "carol.testnet", "dave.testnet"]);
        create_round(&mut c, 1, 10 * NEAR);
        close(&mut c, 1);
        settle(&mut c, 1);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 40, "late"),
                alloc("carol.testnet", 30, "late"),
                alloc("dave.testnet", 30, "late"),
            ],
        );
    }

    // -- auth / views ----------------------------------------------------------

    #[test]
    #[should_panic(expected = "only the owner or the DAO may create a round")]
    fn create_round_non_owner_rejected() {
        let mut c = setup(&["alice.testnet"]);
        testing_env!(ctx("alice.testnet", 10 * NEAR, T0).build());
        c.create_round(1, U128(10 * NEAR));
    }

    #[test]
    #[should_panic(expected = "attached deposit must equal the round envelope")]
    fn create_round_wrong_deposit_rejected() {
        let mut c = setup(&["alice.testnet"]);
        testing_env!(ctx(OWNER, 9 * NEAR, T0).build());
        c.create_round(1, U128(10 * NEAR));
    }

    #[test]
    #[should_panic(expected = "only the contract owner may call this")]
    fn add_member_non_owner_rejected() {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        testing_env!(ctx("alice.testnet", 0, T0).build());
        c.add_member(acc("bob.testnet"));
    }

    #[test]
    fn params_and_dao_role_views() {
        let c = setup(&["alice.testnet", "bob.testnet"]);
        let p = c.get_params();
        assert_eq!(p.points_per_member, 100);
        assert_eq!(p.min_recipients, 3);
        assert_eq!(p.cap_bps, 2500);
        assert_eq!(p.reciprocity_discount_bps, 5000);
        assert_eq!(p.round_duration_ns, ROUND_DURATION_NS);
        assert_eq!(p.standing_start, 100);

        let role = c.get_cached_dao_role(acc("alice.testnet"));
        assert_eq!(role.dao_id, acc(DAO));
        assert!(role.is_member);
        assert!(role.note.contains("Sputnik"));

        let outsider = c.get_cached_dao_role(acc("stranger.testnet"));
        assert!(!outsider.is_member);

        assert_eq!(c.get_standing(acc("alice.testnet")), 100);
        assert_eq!(c.get_standing(acc("stranger.testnet")), 100);
        assert_eq!(
            c.get_members(),
            vec![acc("alice.testnet"), acc("bob.testnet")]
        );
    }

    #[test]
    fn round_deadline_is_seven_days_from_creation() {
        let mut c = setup(&["alice.testnet"]);
        create_round(&mut c, 7, 5 * NEAR);
        let r = c.get_round(7).expect("round");
        assert_eq!(r.created_ns, T0);
        assert_eq!(r.deadline_ns, T0 + ROUND_DURATION_NS);
        assert_eq!(r.envelope_yocto.0, 5 * NEAR);
        assert!(!r.closed);
        assert!(!r.settled);
    }

    // -- DAO membership (production path) ----------------------------------
    //
    // The DAO policy is faked at the callback boundary: the tests call the
    // `on_dao_policy_synced` / `on_dao_role_checked` callbacks directly
    // with a policy JSON shaped like a Sputnik `get_policy` response
    // (roles[].name + roles[].kind.Group[]), as the live DAO would return.
    // The cross-contract call itself (`sync_dao_members` / `get_dao_role`)
    // is exercised live on testnet in phase 2, not in unit tests.

    fn dao_policy(role: &str, members: &[&str]) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({
            "roles": [
                {
                    "name": role,
                    "kind": { "Group": members },
                    "permissions": ["*:*"],
                    "vote_policy": {}
                }
            ]
        })
    }

    fn sync_policy(c: &mut Contract, policy: near_sdk::serde_json::Value) {
        testing_env!(ctx("fairshare-contract.testnet", 0, T0).build());
        c.on_dao_policy_synced(Ok(policy));
    }

    #[test]
    fn dao_member_can_allocate_after_sync() {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        assert_eq!(c.get_members().len(), 0);
        sync_policy(
            &mut c,
            dao_policy(
                "council",
                &[
                    "alice.testnet",
                    "bob.testnet",
                    "carol.testnet",
                    "dave.testnet",
                ],
            ),
        );
        let mut members = c.get_members();
        members.sort();
        assert_eq!(
            members,
            vec![
                acc("alice.testnet"),
                acc("bob.testnet"),
                acc("carol.testnet"),
                acc("dave.testnet"),
            ]
        );
        let info = c.get_dao_info();
        assert_eq!(info.dao_id, acc(DAO));
        assert_eq!(info.member_role, "council");
        assert_eq!(info.member_count, 4);
        assert_eq!(info.last_sync_ns, T0);

        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 40, "work"),
                alloc("carol.testnet", 30, "work"),
                alloc("dave.testnet", 30, "work"),
            ],
        );
        assert_eq!(c.get_allocations(1).len(), 1);
    }

    #[test]
    #[should_panic(expected = "caller is not a member")]
    fn dao_non_member_cannot_allocate() {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        sync_policy(
            &mut c,
            dao_policy(
                "council",
                &["alice.testnet", "bob.testnet", "carol.testnet"],
            ),
        );
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "stranger.testnet",
            1,
            vec![
                alloc("alice.testnet", 40, "work"),
                alloc("bob.testnet", 30, "work"),
                alloc("carol.testnet", 30, "work"),
            ],
        );
    }

    #[test]
    #[should_panic(expected = "caller is not a member")]
    fn dao_role_removal_blocks_allocation() {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        sync_policy(
            &mut c,
            dao_policy(
                "council",
                &[
                    "alice.testnet",
                    "bob.testnet",
                    "carol.testnet",
                    "dave.testnet",
                ],
            ),
        );
        create_round(&mut c, 1, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            1,
            vec![
                alloc("bob.testnet", 40, "work"),
                alloc("carol.testnet", 30, "work"),
                alloc("dave.testnet", 30, "work"),
            ],
        );
        // Council removes alice; a fresh sync drops her from the set.
        sync_policy(
            &mut c,
            dao_policy("council", &["bob.testnet", "carol.testnet", "dave.testnet"]),
        );
        assert!(!c.get_members().contains(&acc("alice.testnet")));
        create_round(&mut c, 2, 10 * NEAR);
        submit(
            &mut c,
            "alice.testnet",
            2,
            vec![
                alloc("bob.testnet", 40, "work"),
                alloc("carol.testnet", 30, "work"),
                alloc("dave.testnet", 30, "work"),
            ],
        );
    }

    #[test]
    fn dao_role_live_check_caches_result() {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        testing_env!(ctx("fairshare-contract.testnet", 0, T0).build());
        let alice_in = c.on_dao_role_checked(
            acc("alice.testnet"),
            Ok(dao_policy("council", &["alice.testnet", "bob.testnet"])),
        );
        assert!(alice_in);
        testing_env!(ctx("fairshare-contract.testnet", 0, T0).build());
        let carol_out = c.on_dao_role_checked(
            acc("carol.testnet"),
            Ok(dao_policy("council", &["alice.testnet", "bob.testnet"])),
        );
        assert!(!carol_out);
        assert_eq!(
            c.get_cached_dao_role(acc("alice.testnet")).live_check,
            Some(true)
        );
        assert_eq!(
            c.get_cached_dao_role(acc("carol.testnet")).live_check,
            Some(false)
        );
    }

    #[test]
    fn dao_sync_failure_keeps_existing_members() {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        sync_policy(
            &mut c,
            dao_policy("council", &["alice.testnet", "bob.testnet"]),
        );
        testing_env!(ctx("fairshare-contract.testnet", 0, T0).build());
        c.on_dao_policy_synced(Err(PromiseError::Failed));
        assert_eq!(
            c.get_members(),
            vec![acc("alice.testnet"), acc("bob.testnet")]
        );
    }

    #[test]
    fn set_dao_id_and_role_owner_only() {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        testing_env!(ctx(OWNER, 0, T0).build());
        c.set_dao_id(acc("fairshare-dao.testnet"));
        c.set_member_role("members".to_string());
        let info = c.get_dao_info();
        assert_eq!(info.dao_id, acc("fairshare-dao.testnet"));
        assert_eq!(info.member_role, "members");
    }

    #[test]
    #[should_panic(expected = "only the contract owner may call this")]
    fn set_dao_id_non_owner_rejected() {
        let mut c = Contract::new(acc(OWNER), acc(DAO));
        testing_env!(ctx("alice.testnet", 0, T0).build());
        c.set_dao_id(acc("fairshare-dao.testnet"));
    }

    // -- property (a): collusion ring vs honest allocation ------------------
    //
    // Two worlds, same 9 members, same 60 NEAR envelope, same outsider
    // rule (outsiders give to members who give to them).
    // RING world: a, b, c allocate 40/40 to each other plus 20 to one
    // outsider each; outsiders keep their points among themselves, so the
    // trio is fed only by each other (discounted) plus one thin edge each.
    // HONEST world: a, b, c allocate to distinct outsiders (34/33/33);
    // outsiders reciprocate 34/33/33 to a, b, c, so the trio is fed by
    // six distinct givers.
    // Result (independent Python computation): ring trio ~3.51 NEAR each,
    // honest trio exactly 15 NEAR each (25% cap). The ring earns strictly
    // less per person.
    #[test]
    fn property_collusion_ring_earns_less_than_honest() {
        let members = [
            "a.testnet",
            "b.testnet",
            "c.testnet",
            "d.testnet",
            "e.testnet",
            "f.testnet",
            "g.testnet",
            "h.testnet",
            "i.testnet",
        ];
        let mut c = setup(&members);
        let env = 60 * NEAR;
        let trio = ["a.testnet", "b.testnet", "c.testnet"];

        // Round 1: ring world.
        create_round(&mut c, 1, env);
        let ring_trio: [(&str, Vec<(&str, u16)>); 3] = [
            ("a.testnet", vec![("b.testnet", 40), ("c.testnet", 40), ("d.testnet", 20)]),
            ("b.testnet", vec![("a.testnet", 40), ("c.testnet", 40), ("e.testnet", 20)]),
            ("c.testnet", vec![("a.testnet", 40), ("b.testnet", 40), ("f.testnet", 20)]),
        ];
        for (who, allocs) in ring_trio {
            submit(
                &mut c,
                who,
                1,
                allocs
                    .iter()
                    .map(|(to, p)| alloc(to, *p, "work"))
                    .collect(),
            );
        }
        let ring_outsiders: [(&str, Vec<(&str, u16)>); 6] = [
            ("d.testnet", vec![("e.testnet", 34), ("f.testnet", 33), ("g.testnet", 33)]),
            ("e.testnet", vec![("d.testnet", 34), ("f.testnet", 33), ("h.testnet", 33)]),
            ("f.testnet", vec![("d.testnet", 34), ("e.testnet", 33), ("i.testnet", 33)]),
            ("g.testnet", vec![("d.testnet", 34), ("e.testnet", 33), ("h.testnet", 33)]),
            ("h.testnet", vec![("d.testnet", 34), ("e.testnet", 33), ("g.testnet", 33)]),
            ("i.testnet", vec![("d.testnet", 34), ("e.testnet", 33), ("f.testnet", 33)]),
        ];
        for (who, allocs) in ring_outsiders {
            submit(
                &mut c,
                who,
                1,
                allocs
                    .iter()
                    .map(|(to, p)| alloc(to, *p, "work"))
                    .collect(),
            );
        }
        close(&mut c, 1);
        settle(&mut c, 1);

        // Round 2: honest world.
        create_round(&mut c, 2, env);
        let honest_trio: [(&str, Vec<(&str, u16)>); 3] = [
            ("a.testnet", vec![("d.testnet", 34), ("e.testnet", 33), ("f.testnet", 33)]),
            ("b.testnet", vec![("g.testnet", 34), ("h.testnet", 33), ("i.testnet", 33)]),
            ("c.testnet", vec![("d.testnet", 34), ("g.testnet", 33), ("h.testnet", 33)]),
        ];
        for (who, allocs) in honest_trio {
            submit(
                &mut c,
                who,
                2,
                allocs
                    .iter()
                    .map(|(to, p)| alloc(to, *p, "work"))
                    .collect(),
            );
        }
        for who in ["d.testnet", "e.testnet", "f.testnet", "g.testnet", "h.testnet", "i.testnet"]
        {
            submit(
                &mut c,
                who,
                2,
                vec![
                    alloc("a.testnet", 34, "work"),
                    alloc("b.testnet", 33, "work"),
                    alloc("c.testnet", 33, "work"),
                ],
            );
        }
        close(&mut c, 2);
        settle(&mut c, 2);

        let ring_avg: u128 = trio
            .iter()
            .map(|w| ex(&c, 1, w).payout_yocto.0)
            .sum::<u128>()
            / 3;
        let honest_avg: u128 = trio
            .iter()
            .map(|w| ex(&c, 2, w).payout_yocto.0)
            .sum::<u128>()
            / 3;
        // Exact ring value from the independent Python computation
        // (waterfall: d and e cap at 15 NEAR, remaining 30 NEAR splits
        // over the seven uncapped scores totalling 66250).
        for w in trio {
            assert_eq!(
                ex(&c, 1, w).payout_yocto.0,
                3506716981132075471698113,
                "ring payout for {}",
                w
            );
            assert_eq!(
                ex(&c, 2, w).payout_yocto.0,
                15 * NEAR,
                "honest payout for {} (capped at 25%)",
                w
            );
        }
        assert!(
            ring_avg < honest_avg,
            "ring avg {} must be strictly less than honest avg {}",
            ring_avg,
            honest_avg
        );
    }

    // -- property (b): payouts never exceed the envelope ----------------------
    //
    // Deterministic pseudo-random loop (xorshift-free LCG, fixed seed, no
    // extra crates): 200 rounds, 6 members, random valid allocations.
    #[test]
    fn property_payouts_never_exceed_envelope() {
        struct Rng(u64);
        impl Rng {
            fn next(&mut self) -> u64 {
                self.0 = self
                    .0
                    .wrapping_mul(6364136223846793005)
                    .wrapping_add(1442695040888963407);
                self.0 >> 33
            }
            fn below(&mut self, n: u64) -> u64 {
                self.next() % n
            }
        }
        let members = [
            "m0.testnet",
            "m1.testnet",
            "m2.testnet",
            "m3.testnet",
            "m4.testnet",
            "m5.testnet",
        ];
        let mut c = setup(&members);
        let mut rng = Rng(0xE6BE_2026_1108);
        let env = 10 * NEAR;
        let cap = env / 4;
        for round in 0..200u64 {
            create_round(&mut c, round, env);
            for (i, giver) in members.iter().enumerate() {
                // 3 distinct recipients: rotate through the other members.
                let others: Vec<&str> = members
                    .iter()
                    .enumerate()
                    .filter(|(j, _)| *j != i)
                    .map(|(_, m)| *m)
                    .collect();
                let start = rng.below(5) as usize;
                let mut allocs = Vec::new();
                for k in 0..3 {
                    let to = others[(start + k) % 5];
                    let points = (5 + rng.below(25)) as u16;
                    allocs.push(alloc(to, points, "random round work"));
                }
                submit(&mut c, giver, round, allocs);
            }
            close(&mut c, round);
            settle(&mut c, round);
            let payouts = c.get_payouts(round);
            assert_eq!(payouts.len(), 6, "every member gets a payout row");
            let sum: u128 = payouts.iter().map(|p| p.payout_yocto.0).sum();
            assert!(
                sum <= env,
                "round {}: payout sum {} exceeds envelope {}",
                round,
                sum,
                env
            );
            for p in &payouts {
                assert!(
                    p.payout_yocto.0 <= cap,
                    "round {}: {} payout {} exceeds 25% cap {}",
                    round,
                    p.account_id,
                    p.payout_yocto.0,
                    cap
                );
            }
        }
    }

    // -- stretch: ownership units + inflow distribution -----------------------
    //
    // Same 8-member cap setup as `cap_25_percent_applies`: a mints 2500
    // units (25% share), b/c 2090 each, d/e/f 963 each, g 428, h 0.
    // A second identical settle decays existing units 10% then mints
    // again: a ends at 2500*9/10 + 2500 = 4750.
    #[test]
    fn units_minted_decayed_and_inflow_distributed_pro_rata() {
        let members = [
            "a.testnet",
            "b.testnet",
            "c.testnet",
            "d.testnet",
            "e.testnet",
            "f.testnet",
            "g.testnet",
            "h.testnet",
        ];
        let mut c = setup(&members);
        let env = 100 * NEAR;
        let submit_cap_setup = |c: &mut Contract, round: u64| {
            submit(
                c,
                "a.testnet",
                round,
                vec![
                    alloc("b.testnet", 20, "work"),
                    alloc("c.testnet", 20, "work"),
                    alloc("d.testnet", 20, "work"),
                    alloc("e.testnet", 20, "work"),
                    alloc("f.testnet", 20, "work"),
                ],
            );
            for (who, others) in [
                ("b.testnet", [("c.testnet", 20), ("d.testnet", 20)]),
                ("c.testnet", [("b.testnet", 20), ("d.testnet", 20)]),
                ("d.testnet", [("b.testnet", 20), ("c.testnet", 20)]),
                ("e.testnet", [("f.testnet", 20), ("g.testnet", 20)]),
                ("f.testnet", [("e.testnet", 20), ("g.testnet", 20)]),
                ("g.testnet", [("e.testnet", 20), ("f.testnet", 20)]),
                ("h.testnet", [("b.testnet", 20), ("c.testnet", 20)]),
            ] {
                let mut v = vec![alloc("a.testnet", 60, "work")];
                v.extend(others.iter().map(|(to, p)| alloc(to, *p, "work")));
                submit(c, who, round, v);
            }
        };
        create_round(&mut c, 1, env);
        submit_cap_setup(&mut c, 1);
        close(&mut c, 1);
        settle(&mut c, 1);

        assert_eq!(c.get_units(acc("a.testnet")), 2500);
        assert_eq!(c.get_units(acc("b.testnet")), 2090);
        assert_eq!(c.get_units(acc("c.testnet")), 2090);
        assert_eq!(c.get_units(acc("d.testnet")), 963);
        assert_eq!(c.get_units(acc("g.testnet")), 428);
        assert_eq!(c.get_units(acc("h.testnet")), 0);

        // Distribute a 10 NEAR inflow pro-rata to units (total 9997).
        let inflow = 10 * NEAR;
        testing_env!(ctx(OWNER, inflow, T0).build());
        let dist = c.distribute_inflow(U128(inflow));
        let total_units: u128 = 9997;
        let a_share = inflow * 2500 / total_units;
        let got_a = dist
            .iter()
            .find(|d| d.account_id == acc("a.testnet"))
            .expect("a in distribution");
        assert_eq!(got_a.amount_yocto.0, a_share);
        let dist_sum: u128 = dist.iter().map(|d| d.amount_yocto.0).sum();
        assert!(dist_sum <= inflow, "distribution must not exceed inflow");
        assert_eq!(dist.len(), 7, "h holds 0 units and gets no share");

        // Second identical round: decay 10% then mint again.
        create_round(&mut c, 2, env);
        submit_cap_setup(&mut c, 2);
        close(&mut c, 2);
        settle(&mut c, 2);
        assert_eq!(c.get_units(acc("a.testnet")), 4750);
        assert_eq!(c.get_units(acc("b.testnet")), 2090 * 9 / 10 + 2090);
    }
}
