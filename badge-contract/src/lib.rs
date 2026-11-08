//! FairShare soulbound council membership badge — NEP-171 NFT on NEAR
//! testnet, transfers disabled BY DESIGN (not by convention).
//!
//! * One badge per council member. Token id: `badge-<account_id>`, e.g.
//!   `badge-alice-fairshare.testnet`.
//! * `nft_transfer` and `nft_transfer_call` ALWAYS panic, as do
//!   `nft_approve`, `nft_revoke` and `nft_revoke_all`. There is no way
//!   to move a badge to another account.
//! * Only the owner (`fairshare-owner.testnet`, set at init) — or the
//!   badge contract account itself — may `mint` or `burn`.
//! * `mint(member, standing)` refuses a second mint for the same member.
//! * Each token's metadata records the member's standing at mint time
//!   and points at the badge artwork.
//!
//! Views (exact names/shapes — the site display wires to these):
//! * `nft_token(token_id: String) -> Option<Token>`
//!   Token = { token_id: String, owner_id: AccountId,
//!             metadata: Option<TokenMetadata>,
//!             approved_account_ids: Option<HashMap<AccountId, u64>> }
//!   TokenMetadata = { title: Option<String>, description: Option<String>,
//!     media: Option<String>, media_hash: Option<Base64VecU8>,
//!     copies: Option<u64>, issued_at: Option<String>,
//!     expires_at: Option<String>, starts_at: Option<String>,
//!     updated_at: Option<String>, extra: Option<String>,
//!     reference: Option<String>, reference_hash: Option<Base64VecU8> }
//! * `nft_tokens_for_owner(account_id: AccountId,
//!     from_index: Option<U128>, limit: Option<u64>) -> Vec<Token>`
//! * `nft_tokens(from_index: Option<U128>, limit: Option<u64>) -> Vec<Token>`
//! * `nft_total_supply() -> U128`, `nft_supply_for_owner(account_id) -> U128`
//! * `nft_metadata() -> NFTContractMetadata`
//! * `get_badge(account_id: AccountId) -> Option<BadgeView>`
//!   BadgeView = { token_id: String, owner_id: AccountId, standing: u64 }
//! * `get_owner() -> AccountId`, `get_total_supply() -> u64`
//!
//! TESTNET ONLY. Never deploy to mainnet.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, UnorderedMap};
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault};
use std::collections::HashMap;

/// Badge artwork served from the FairShare site.
pub const BADGE_MEDIA: &str = "https://fairshare-pi.vercel.app/badge-3d.png";
/// Minimum attached deposit on mint (covers token storage; surplus stays
/// in the contract). Token storage is ~0.005 NEAR; 0.01 NEAR is headroom.
pub const MIN_MINT_DEPOSIT_YOCTO: u128 = 10_000_000_000_000_000_000_000;

// ---------------------------------------------------------------------------
// NEP-171 types
// ---------------------------------------------------------------------------

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<Base64VecU8>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<Base64VecU8>,
}

#[derive(BorshDeserialize, BorshSerialize, Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: Option<TokenMetadata>,
    pub approved_account_ids: Option<HashMap<AccountId, u64>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(crate = "near_sdk::serde")]
pub struct NFTContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<Base64VecU8>,
}

/// What `get_badge` returns: token id + standing + owner for one member.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct BadgeView {
    pub token_id: String,
    pub owner_id: AccountId,
    pub standing: u64,
}

/// Token id for a member. Unique and valid: `badge-<account_id>`.
pub fn token_id_for(member: &AccountId) -> String {
    format!("badge-{}", member)
}

// ---------------------------------------------------------------------------
// Contract state
// ---------------------------------------------------------------------------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    /// token_id -> Token (iterable, so nft_tokens can enumerate).
    tokens: UnorderedMap<String, Token>,
    /// member -> token_id (one badge per member, enforced at mint).
    token_by_owner: LookupMap<AccountId, String>,
    /// member -> standing recorded at mint time.
    standing_at_mint: LookupMap<AccountId, u64>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        assert!(!env::state_exists(), "already initialized");
        Self {
            owner_id,
            tokens: UnorderedMap::new(b"t"),
            token_by_owner: LookupMap::new(b"o"),
            standing_at_mint: LookupMap::new(b"s"),
        }
    }

    fn assert_owner(&self) {
        let caller = env::predecessor_account_id();
        assert!(
            caller == self.owner_id || caller == env::current_account_id(),
            "only the owner may call this method"
        );
    }

    /// Mint one soulbound badge for a council member. Owner only.
    /// Refuses a second mint for the same member. Payable: attached
    /// deposit must cover storage (see MIN_MINT_DEPOSIT_YOCTO).
    #[payable]
    pub fn mint(&mut self, member: AccountId, standing: u64) -> Token {
        self.assert_owner();
        assert!(
            env::attached_deposit() >= NearToken::from_yoctonear(MIN_MINT_DEPOSIT_YOCTO),
            "attach at least 0.01 NEAR for storage"
        );
        assert!(
            !self.token_by_owner.contains_key(&member),
            "member already holds a badge"
        );
        let token_id = token_id_for(&member);
        assert!(!self.tokens.contains_key(&token_id), "token id already exists");
        let metadata = TokenMetadata {
            title: Some("FairShare Council Badge".to_string()),
            description: Some(format!(
                "Soulbound FairShare council membership badge for {} (standing {} at mint). Non-transferable.",
                member, standing
            )),
            media: Some(BADGE_MEDIA.to_string()),
            media_hash: None,
            copies: Some(1),
            issued_at: Some(env::block_timestamp().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference: None,
            reference_hash: None,
        };
        let token = Token {
            token_id: token_id.clone(),
            owner_id: member.clone(),
            metadata: Some(metadata),
            approved_account_ids: Some(HashMap::new()),
        };
        self.tokens.insert(token_id.clone(), token.clone());
        self.token_by_owner.insert(member.clone(), token_id);
        self.standing_at_mint.insert(member, standing);
        token
    }

    /// Burn a badge by token id (e.g. when a member leaves the council).
    /// Owner only.
    pub fn burn(&mut self, token_id: String) {
        self.assert_owner();
        let token = self
            .tokens
            .remove(&token_id)
            .unwrap_or_else(|| panic!("no such token: {}", token_id));
        self.token_by_owner.remove(&token.owner_id);
        self.standing_at_mint.remove(&token.owner_id);
    }

    // -- soulbound: transfers are impossible by design ----------------------

    /// Always fails: FairShare badges are soulbound and cannot move.
    #[payable]
    pub fn nft_transfer(
        &mut self,
        #[allow(unused_variables)] receiver_id: AccountId,
        #[allow(unused_variables)] token_id: String,
        #[allow(unused_variables)] approval: Option<u64>,
        #[allow(unused_variables)] memo: Option<String>,
    ) {
        panic!("soulbound: FairShare council badges cannot be transferred");
    }

    /// Always fails: FairShare badges are soulbound and cannot move.
    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        #[allow(unused_variables)] receiver_id: AccountId,
        #[allow(unused_variables)] token_id: String,
        #[allow(unused_variables)] approval: Option<u64>,
        #[allow(unused_variables)] memo: Option<String>,
        #[allow(unused_variables)] msg: String,
    ) -> near_sdk::PromiseOrValue<bool> {
        panic!("soulbound: FairShare council badges cannot be transferred");
    }

    /// Always fails: approvals are meaningless on a soulbound token.
    #[payable]
    pub fn nft_approve(
        &mut self,
        #[allow(unused_variables)] token_id: String,
        #[allow(unused_variables)] account_id: AccountId,
        #[allow(unused_variables)] msg: Option<String>,
    ) {
        panic!("soulbound: FairShare council badges cannot be approved");
    }

    /// Always fails: approvals are meaningless on a soulbound token.
    pub fn nft_revoke(
        &mut self,
        #[allow(unused_variables)] token_id: String,
        #[allow(unused_variables)] account_id: AccountId,
    ) {
        panic!("soulbound: FairShare council badges cannot be approved");
    }

    /// Always fails: approvals are meaningless on a soulbound token.
    pub fn nft_revoke_all(
        &mut self,
        #[allow(unused_variables)] token_id: String,
    ) {
        panic!("soulbound: FairShare council badges cannot be approved");
    }

    /// Always false: no approvals can ever exist on a soulbound token.
    pub fn nft_is_approved(
        &self,
        #[allow(unused_variables)] token_id: String,
        #[allow(unused_variables)] approved_account_id: AccountId,
        #[allow(unused_variables)] approval_id: Option<u64>,
    ) -> bool {
        false
    }

    // -- views ---------------------------------------------------------------

    pub fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: "nft-1.0.0".to_string(),
            name: "FairShare Council Badge".to_string(),
            symbol: "FSBADGE".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        self.tokens.get(&token_id).cloned()
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|i| i.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(u64::MAX) as usize;
        self.tokens
            .iter()
            .skip(from)
            .take(limit)
            .map(|(_, token)| token.clone())
            .collect()
    }

    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        let from = from_index.map(|i| i.0 as usize).unwrap_or(0);
        let limit = limit.unwrap_or(u64::MAX) as usize;
        match self.token_by_owner.get(&account_id) {
            Some(token_id) => match self.tokens.get(token_id) {
                Some(token) => {
                    if from == 0 && limit >= 1 {
                        vec![token.clone()]
                    } else {
                        vec![]
                    }
                }
                None => vec![],
            },
            None => vec![],
        }
    }

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.tokens.len() as u128)
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(if self.token_by_owner.contains_key(&account_id) {
            1
        } else {
            0
        })
    }

    /// Badge for one member: token id + standing at mint + owner.
    /// Returns None when the member holds no badge.
    pub fn get_badge(&self, account_id: AccountId) -> Option<BadgeView> {
        let token_id = self.token_by_owner.get(&account_id)?.clone();
        let standing = self.standing_at_mint.get(&account_id).copied().unwrap_or(0);
        Some(BadgeView {
            token_id,
            owner_id: account_id,
            standing,
        })
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    pub fn get_total_supply(&self) -> u64 {
        self.tokens.len() as u64
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const OWNER: &str = "fairshare-owner.testnet";
    const BADGE: &str = "fairshare-badge.testnet";
    const ALICE: &str = "alice-fairshare.testnet";
    const BOB: &str = "bob-fairshare.testnet";
    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    fn ctx(predecessor: &str, attached: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor.parse().unwrap())
            .current_account_id(BADGE.parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(attached))
            .block_timestamp(1_000_000_000_000_000_000);
        b
    }

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn setup() -> Contract {
        Contract::new(acc(OWNER))
    }

    fn mint(c: &mut Contract, caller: &str, member: &str, standing: u64) -> Token {
        testing_env!(ctx(caller, NEAR / 100).build());
        c.mint(acc(member), standing)
    }

    #[test]
    fn mint_happy_path_and_views() {
        let mut c = setup();
        let token = mint(&mut c, OWNER, ALICE, 105);
        assert_eq!(token.token_id, "badge-alice-fairshare.testnet");
        assert_eq!(token.owner_id, acc(ALICE));
        let meta = token.metadata.unwrap();
        assert_eq!(meta.title.as_deref(), Some("FairShare Council Badge"));
        let desc = meta.description.unwrap();
        assert!(desc.contains(ALICE));
        assert!(desc.contains("105"));
        assert_eq!(meta.media.as_deref(), Some(BADGE_MEDIA));

        // nft_token round-trips with correct owner + standing in description.
        let got = c.nft_token("badge-alice-fairshare.testnet".to_string()).unwrap();
        assert_eq!(got.owner_id, acc(ALICE));

        // get_badge returns token id + standing + owner.
        let badge = c.get_badge(acc(ALICE)).unwrap();
        assert_eq!(
            badge,
            BadgeView {
                token_id: "badge-alice-fairshare.testnet".to_string(),
                owner_id: acc(ALICE),
                standing: 105,
            }
        );
        assert!(c.get_badge(acc(BOB)).is_none());

        // nft_tokens_for_owner: exactly this one token; empty for others.
        let owned = c.nft_tokens_for_owner(acc(ALICE), None, None);
        assert_eq!(owned.len(), 1);
        assert_eq!(owned[0].token_id, "badge-alice-fairshare.testnet");
        assert!(c.nft_tokens_for_owner(acc(BOB), None, None).is_empty());

        assert_eq!(c.get_owner(), acc(OWNER));
        assert_eq!(c.get_total_supply(), 1);
        assert_eq!(c.nft_total_supply(), U128(1));
        assert_eq!(c.nft_supply_for_owner(acc(ALICE)), U128(1));
        assert_eq!(c.nft_supply_for_owner(acc(BOB)), U128(0));
        assert_eq!(c.nft_tokens(None, None).len(), 1);
    }

    #[test]
    #[should_panic(expected = "soulbound")]
    fn soulbound_transfer_fails() {
        let mut c = setup();
        mint(&mut c, OWNER, ALICE, 100);
        testing_env!(ctx(ALICE, 1).build());
        c.nft_transfer(acc(BOB), "badge-alice-fairshare.testnet".to_string(), None, None);
    }

    #[test]
    #[should_panic(expected = "soulbound")]
    fn soulbound_transfer_call_fails() {
        let mut c = setup();
        mint(&mut c, OWNER, ALICE, 100);
        testing_env!(ctx(ALICE, 1).build());
        let _ = c.nft_transfer_call(
            acc(BOB),
            "badge-alice-fairshare.testnet".to_string(),
            None,
            None,
            "{}".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "soulbound")]
    fn soulbound_approve_fails() {
        let mut c = setup();
        mint(&mut c, OWNER, ALICE, 100);
        testing_env!(ctx(ALICE, 1).build());
        c.nft_approve("badge-alice-fairshare.testnet".to_string(), acc(BOB), None);
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn non_owner_mint_fails() {
        let mut c = setup();
        mint(&mut c, ALICE, BOB, 100);
    }

    #[test]
    #[should_panic(expected = "already holds a badge")]
    fn double_mint_fails() {
        let mut c = setup();
        mint(&mut c, OWNER, ALICE, 100);
        mint(&mut c, OWNER, ALICE, 110);
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn non_owner_burn_fails() {
        let mut c = setup();
        mint(&mut c, OWNER, ALICE, 100);
        testing_env!(ctx(ALICE, 0).build());
        c.burn("badge-alice-fairshare.testnet".to_string());
    }

    #[test]
    fn burn_works_and_frees_member() {
        let mut c = setup();
        mint(&mut c, OWNER, ALICE, 100);
        assert_eq!(c.get_total_supply(), 1);
        testing_env!(ctx(OWNER, 0).build());
        c.burn("badge-alice-fairshare.testnet".to_string());
        assert_eq!(c.get_total_supply(), 0);
        assert!(c.get_badge(acc(ALICE)).is_none());
        assert!(c
            .nft_token("badge-alice-fairshare.testnet".to_string())
            .is_none());
        assert!(c.nft_tokens_for_owner(acc(ALICE), None, None).is_empty());
        // After a burn the member can be re-minted (e.g. rejoins council).
        mint(&mut c, OWNER, ALICE, 95);
        assert_eq!(c.get_total_supply(), 1);
        assert_eq!(c.get_badge(acc(ALICE)).unwrap().standing, 95);
    }

    #[test]
    #[should_panic(expected = "attach at least 0.01 NEAR")]
    fn mint_without_storage_deposit_fails() {
        let mut c = setup();
        testing_env!(ctx(OWNER, 0).build());
        c.mint(acc(ALICE), 100);
    }
}
