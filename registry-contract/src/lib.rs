//! FairShare group registry — the directory of self-serve FairShare groups.
//!
//! Anyone can create their own FairShare group from the site, without a
//! technical person: the create page makes the group's Sputnik DAO through
//! the live Sputnik factory, deploys the group's own FairShare round
//! contract (the same code as fairshare-contract.testnet, read off the
//! chain), and then registers the group here. This contract only stores
//! the directory: one record per group with its name, template, badge
//! image URL, DAO id, contract id, creator and invite code. It never
//! holds group money and never moves funds except refunding unused
//! storage deposits.
//!
//! Naming (enforced): a group with id `<slug>` has DAO
//! `<slug>.sputnikv2.testnet` and round contract
//! `<slug>-fairshare.<creator>`. The badge image itself is stored
//! offchain; only its URL is stored here (a data: URL counts as a URL
//! for small images on testnet; the mainnet version will use object
//! storage). Changing a group's badge later needs the group's DAO to
//! approve it: the DAO calls `update_badge` through a proposal.
//!
//! TESTNET ONLY. Never deploy to mainnet.

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, near, AccountId, NearToken, PanicOnDefault, Promise};

/// YoctoNEAR charged per byte of storage (the network's storage price).
const STORAGE_PRICE_PER_BYTE_YOCTO: u128 = 10_000_000_000_000_000_000;

/// Smallest storage deposit any payable call here accepts (0.01 NEAR).
/// The exact storage cost is charged on top of this check and the rest
/// is refunded; the floor exists so an underfunded call fails fast
/// instead of leaving the registry paying for someone else's record.
const MIN_STORAGE_DEPOSIT_YOCTO: u128 = 10_000_000_000_000_000_000_000;

/// Templates the create page offers. Kept as plain strings so the page
/// and the contract agree without a shared enum.
const TEMPLATES: [&str; 5] = [
    "market-traders",
    "grant-team",
    "cooperative",
    "friends",
    "other",
];

/// Longest badge URL the registry accepts (a downscaled 256px image as a
/// data: URL is roughly 10-30KB; anything larger belongs in object
/// storage, which is a mainnet step).
const MAX_BADGE_URL_LEN: usize = 65_536;

/// One self-serve FairShare group.
#[derive(BorshSerialize, BorshDeserialize, Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(crate = "near_sdk::serde")]
pub struct Group {
    /// URL slug, e.g. "market-traders". Also the DAO and contract prefix.
    pub group_id: String,
    /// Display name, e.g. "Lagos Market Traders".
    pub name: String,
    /// One of TEMPLATES.
    pub template: String,
    /// Badge image URL ("" = the default three-slice mark). http(s) URL
    /// or data:image/... URL.
    pub badge_url: String,
    /// `<group_id>.sputnikv2.testnet`.
    pub dao_id: AccountId,
    /// `<group_id>-fairshare.<creator>`.
    pub contract_id: AccountId,
    /// The account that created the group (and owns its round contract).
    pub creator: AccountId,
    /// Invite code the creator shares; the group page checks it before
    /// letting a wallet join through a DAO proposal.
    pub invite_code: String,
    /// Block timestamp (ns) of registration.
    pub created_at_ns: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Registry {
    owner_id: AccountId,
    /// group_id -> Group.
    groups: LookupMap<String, Group>,
    /// group ids in registration order (LookupMap cannot be iterated).
    group_ids: Vector<String>,
    /// dao_id -> group_id.
    by_dao: LookupMap<AccountId, String>,
    /// contract_id -> group_id.
    by_contract: LookupMap<AccountId, String>,
}

#[near]
impl Registry {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            owner_id,
            groups: LookupMap::new(b"g"),
            group_ids: Vector::new(b"i"),
            by_dao: LookupMap::new(b"d"),
            by_contract: LookupMap::new(b"c"),
        }
    }

    /// Register a group the caller just created (DAO + round contract
    /// already exist onchain; the create page verified that with view
    /// calls before this call). Only the creator may register, and the
    /// caller must attach enough NEAR to cover the record's storage;
    /// any excess is refunded. Panics (rolling everything back) when
    /// the attached deposit does not cover storage.
    #[payable]
    pub fn register_group(
        &mut self,
        group_id: String,
        name: String,
        template: String,
        badge_url: String,
        dao_id: AccountId,
        contract_id: AccountId,
        creator: AccountId,
        invite_code: String,
    ) {
        let caller = env::predecessor_account_id();
        assert_eq!(caller, creator, "only the creator can register the group");
        assert!(is_valid_group_id(&group_id), "group_id must be 2-32 lowercase letters, digits or hyphens");
        assert!(!self.groups.contains_key(&group_id), "group_id is already taken");
        assert!(name.len() >= 2 && name.len() <= 80, "name must be 2-80 characters");
        assert!(
            TEMPLATES.contains(&template.as_str()),
            "unknown template"
        );
        assert!(
            badge_url.is_empty()
                || badge_url.len() <= MAX_BADGE_URL_LEN
                    && (badge_url.starts_with("https://") || badge_url.starts_with("data:image/")),
            "badge_url must be empty, an https:// URL, or a data:image/... URL under 64KB"
        );
        let expected_dao: AccountId = format!("{group_id}.sputnikv2.testnet")
            .parse()
            .expect("group_id builds a valid DAO id");
        assert_eq!(dao_id, expected_dao, "dao_id must be <group_id>.sputnikv2.testnet");
        let expected_contract: AccountId = format!("{group_id}-fairshare.{creator}")
            .parse()
            .expect("group_id and creator build a valid contract id");
        assert_eq!(
            contract_id, expected_contract,
            "contract_id must be <group_id>-fairshare.<creator>"
        );
        assert!(
            !self.by_dao.contains_key(&dao_id),
            "dao_id is already registered"
        );
        assert!(
            !self.by_contract.contains_key(&contract_id),
            "contract_id is already registered"
        );
        assert!(
            invite_code.len() >= 8
                && invite_code.len() <= 32
                && invite_code
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-'),
            "invite_code must be 8-32 letters, digits or hyphens"
        );

        let storage_before = env::storage_usage();
        let attached = env::attached_deposit();
        let group = Group {
            group_id: group_id.clone(),
            name,
            template,
            badge_url,
            dao_id: dao_id.clone(),
            contract_id: contract_id.clone(),
            creator,
            invite_code,
            created_at_ns: env::block_timestamp(),
        };
        self.groups.insert(group_id.clone(), group);
        self.group_ids.push(group_id.clone());
        self.by_dao.insert(dao_id, group_id.clone());
        self.by_contract.insert(contract_id, group_id);
        self.refund_excess_storage(storage_before, attached);
    }

    /// Change a group's badge. Only the group's DAO may call this, which
    /// means the change passed a council vote as a DAO proposal. The
    /// caller must attach enough NEAR to cover any extra storage; excess
    /// is refunded.
    #[payable]
    pub fn update_badge(&mut self, group_id: String, badge_url: String) {
        let caller = env::predecessor_account_id();
        let mut group = self
            .groups
            .get(&group_id)
            .cloned()
            .expect("unknown group_id");
        assert_eq!(caller, group.dao_id, "only the group's DAO can change its badge");
        assert!(
            badge_url.is_empty()
                || badge_url.len() <= MAX_BADGE_URL_LEN
                    && (badge_url.starts_with("https://") || badge_url.starts_with("data:image/")),
            "badge_url must be empty, an https:// URL, or a data:image/... URL under 64KB"
        );
        let storage_before = env::storage_usage();
        let attached = env::attached_deposit();
        group.badge_url = badge_url;
        self.groups.insert(group_id, group);
        self.refund_excess_storage(storage_before, attached);
    }

    /// The group with this id, if it exists.
    pub fn get_group(&self, group_id: String) -> Option<Group> {
        self.groups.get(&group_id).cloned()
    }

    /// The group for a DAO id, if it is registered.
    pub fn get_group_by_dao(&self, dao_id: AccountId) -> Option<Group> {
        self.by_dao
            .get(&dao_id)
            .and_then(|id| self.groups.get(id).cloned())
    }

    /// The group for a round contract id, if it is registered.
    pub fn get_group_by_contract(&self, contract_id: AccountId) -> Option<Group> {
        self.by_contract
            .get(&contract_id)
            .and_then(|id| self.groups.get(id).cloned())
    }

    /// Groups in registration order, paginated.
    pub fn list_groups(&self, from_index: u64, limit: u64) -> Vec<Group> {
        self.group_ids
            .iter()
            .skip(from_index as usize)
            .take(limit as usize)
            .filter_map(|id| self.groups.get(id).cloned())
            .collect()
    }

    /// How many groups are registered.
    pub fn group_count(&self) -> u64 {
        self.group_ids.len() as u64
    }

    /// The registry owner (the FairShare project account).
    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }

    /// Refund any attached deposit above the storage this call used.
    /// Panics (reverting the call) when the deposit does not cover it.
    fn refund_excess_storage(&self, storage_before: u64, attached: NearToken) {
        let attached_yocto = attached.as_yoctonear();
        assert!(
            attached_yocto >= MIN_STORAGE_DEPOSIT_YOCTO,
            "attached deposit does not cover storage"
        );
        let used_now = env::storage_usage();
        let used_delta = used_now.saturating_sub(storage_before) as u128;
        let cost = used_delta * STORAGE_PRICE_PER_BYTE_YOCTO;
        assert!(
            attached_yocto >= cost,
            "attached deposit does not cover storage"
        );
        if attached_yocto > cost {
            // The transfer is scheduled with the runtime when created;
            // the handle itself is not needed afterwards.
            let _ = Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(attached_yocto - cost));
        }
    }
}

fn is_valid_group_id(id: &str) -> bool {
    id.len() >= 2
        && id.len() <= 32
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !id.starts_with('-')
        && !id.ends_with('-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const OWNER: &str = "fairshare-owner.testnet";
    const REGISTRY: &str = "fairshare-registry.testnet";
    const CREATOR: &str = "alice-fairshare.testnet";
    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
    const T0: u64 = 1_000_000_000_000_000_000;

    fn ctx(predecessor: &str, attached: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(predecessor.parse().unwrap())
            .current_account_id(REGISTRY.parse().unwrap())
            .attached_deposit(NearToken::from_yoctonear(attached))
            .block_timestamp(T0);
        b
    }

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn setup() -> Registry {
        testing_env!(ctx(OWNER, 0).build());
        Registry::new(acc(OWNER))
    }

    fn register_args() -> (String, String, String, String, AccountId, AccountId, AccountId, String) {
        (
            "market-traders".to_string(),
            "Lagos Market Traders".to_string(),
            "market-traders".to_string(),
            "https://example.com/badge.png".to_string(),
            acc("market-traders.sputnikv2.testnet"),
            acc("market-traders-fairshare.alice-fairshare.testnet"),
            acc(CREATOR),
            "invite-abc123".to_string(),
        )
    }

    fn register(c: &mut Registry) {
        let (id, name, template, badge, dao, contract, creator, code) = register_args();
        testing_env!(ctx(CREATOR, NEAR).build());
        c.register_group(id, name, template, badge, dao, contract, creator, code);
    }

    #[test]
    fn register_and_read_back() {
        let mut c = setup();
        assert_eq!(c.group_count(), 0);
        register(&mut c);
        assert_eq!(c.group_count(), 1);
        let g = c.get_group("market-traders".to_string()).unwrap();
        assert_eq!(g.name, "Lagos Market Traders");
        assert_eq!(g.template, "market-traders");
        assert_eq!(g.dao_id, acc("market-traders.sputnikv2.testnet"));
        assert_eq!(g.contract_id, acc("market-traders-fairshare.alice-fairshare.testnet"));
        assert_eq!(g.creator, acc(CREATOR));
        assert_eq!(g.invite_code, "invite-abc123");
        assert_eq!(g.created_at_ns, T0);
        let by_dao = c.get_group_by_dao(acc("market-traders.sputnikv2.testnet")).unwrap();
        assert_eq!(by_dao.group_id, "market-traders");
        let by_contract = c
            .get_group_by_contract(acc("market-traders-fairshare.alice-fairshare.testnet"))
            .unwrap();
        assert_eq!(by_contract.group_id, "market-traders");
        assert_eq!(c.get_owner(), acc(OWNER));
    }

    #[test]
    fn list_groups_paginates() {
        let mut c = setup();
        register(&mut c);
        let (id, name, template, badge, dao, contract, creator, code) = (
            "grant-team".to_string(),
            "Grant Team".to_string(),
            "grant-team".to_string(),
            "".to_string(),
            acc("grant-team.sputnikv2.testnet"),
            acc("grant-team-fairshare.alice-fairshare.testnet"),
            acc(CREATOR),
            "invite-def456".to_string(),
        );
        testing_env!(ctx(CREATOR, NEAR).build());
        c.register_group(id, name, template, badge, dao, contract, creator, code);
        assert_eq!(c.group_count(), 2);
        let page = c.list_groups(0, 1);
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].group_id, "market-traders");
        let page = c.list_groups(1, 1);
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].group_id, "grant-team");
        assert!(c.list_groups(2, 10).is_empty());
    }

    #[test]
    #[should_panic(expected = "group_id is already taken")]
    fn duplicate_group_id_rejected() {
        let mut c = setup();
        register(&mut c);
        register(&mut c);
    }

    #[test]
    #[should_panic(expected = "only the creator can register the group")]
    fn only_creator_registers() {
        let mut c = setup();
        let (id, name, template, badge, dao, contract, creator, code) = register_args();
        testing_env!(ctx("mallory.testnet", NEAR).build());
        c.register_group(id, name, template, badge, dao, contract, creator, code);
    }

    #[test]
    #[should_panic(expected = "unknown template")]
    fn bad_template_rejected() {
        let mut c = setup();
        let (id, name, template, badge, dao, contract, creator, code) = register_args();
        testing_env!(ctx(CREATOR, NEAR).build());
        c.register_group(
            id,
            name,
            "pyramid".to_string(),
            badge,
            dao,
            contract,
            creator,
            code,
        );
        let _ = template;
    }

    #[test]
    #[should_panic(expected = "dao_id must be")]
    fn wrong_dao_name_rejected() {
        let mut c = setup();
        let (id, name, template, badge, _dao, contract, creator, code) = register_args();
        testing_env!(ctx(CREATOR, NEAR).build());
        c.register_group(
            id,
            name,
            template,
            badge,
            acc("someone-else.sputnikv2.testnet"),
            contract,
            creator,
            code,
        );
    }

    #[test]
    #[should_panic(expected = "contract_id must be")]
    fn wrong_contract_name_rejected() {
        let mut c = setup();
        let (id, name, template, badge, dao, _contract, creator, code) = register_args();
        testing_env!(ctx(CREATOR, NEAR).build());
        c.register_group(
            id,
            name,
            template,
            badge,
            dao,
            acc("market-traders-fairshare.bob-fairshare.testnet"),
            creator,
            code,
        );
    }

    #[test]
    #[should_panic(expected = "group_id must be")]
    fn bad_group_id_rejected() {
        let mut c = setup();
        let (_id, name, template, badge, dao, contract, creator, code) = register_args();
        testing_env!(ctx(CREATOR, NEAR).build());
        c.register_group(
            "Market Traders!".to_string(),
            name,
            template,
            badge,
            dao,
            contract,
            creator,
            code,
        );
    }

    #[test]
    fn update_badge_by_dao_only() {
        let mut c = setup();
        register(&mut c);
        // The group's DAO approves the change (as a proposal would).
        testing_env!(ctx("market-traders.sputnikv2.testnet", NEAR).build());
        c.update_badge("market-traders".to_string(), "https://example.com/new.png".to_string());
        let g = c.get_group("market-traders".to_string()).unwrap();
        assert_eq!(g.badge_url, "https://example.com/new.png");
    }

    #[test]
    #[should_panic(expected = "only the group's DAO can change its badge")]
    fn update_badge_by_stranger_rejected() {
        let mut c = setup();
        register(&mut c);
        testing_env!(ctx("mallory.testnet", NEAR).build());
        c.update_badge("market-traders".to_string(), "https://example.com/evil.png".to_string());
    }

    #[test]
    #[should_panic(expected = "attached deposit does not cover storage")]
    fn registration_needs_storage_deposit() {
        let mut c = setup();
        let (id, name, template, badge, dao, contract, creator, code) = register_args();
        testing_env!(ctx(CREATOR, 1).build());
        c.register_group(id, name, template, badge, dao, contract, creator, code);
    }
}
