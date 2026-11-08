// Create your DAO — the self-serve FairShare group flow.
// One wallet, four steps, each verified onchain before the next:
//  1. DAO through the Sputnik factory (treasury deposit -> the DAO).
//  2. Round contract as a creator subaccount (wallet creates it with a
//     fresh browser key; near-api-js deploys the live FairShare code and
//     calls new() with owner=creator, dao=the new DAO).
//  3. Register the group in fairshare-registry.testnet.
//  4. Sync the DAO council into the contract.
// Every step first reads onchain state and skips work already done, so
// reloading halfway (the wallet redirects back here after each signing)
// continues where it stopped. Testnet only.
const CREATE_KEY = "fairshare-creating";
const GROUP_KEY_PREFIX = "fairshare-group-key-";

let createState = null; // the in-progress record from localStorage
let badgeDataUrl = ""; // downscaled badge image, if the user picked a file
let slugAvailable = null;

function loadCreateState() {
  try {
    const raw = localStorage.getItem(CREATE_KEY);
    createState = raw ? JSON.parse(raw) : null;
  } catch (_) { createState = null; }
}
function saveCreateState() {
  try {
    if (createState) localStorage.setItem(CREATE_KEY, JSON.stringify(createState));
    else localStorage.removeItem(CREATE_KEY);
  } catch (_) { /* storage unavailable */ }
}
function daoIdFor(slug) { return slug + "." + FACTORY_ID; }
function contractIdFor(slug, creator) { return slug + "-fairshare." + creator; }
function inviteLinkFor(slug, code) {
  return window.location.origin + "/group?id=" + encodeURIComponent(slug) + "&invite=" + encodeURIComponent(code);
}

const STEPS = [
  { id: "dao", label: "Create your DAO" },
  { id: "contract", label: "Deploy your group's contract" },
  { id: "register", label: "List the group in the directory" },
  { id: "sync", label: "Sync your membership" },
];

async function stepDone(stepId) {
  if (!createState) return false;
  const slug = createState.slug;
  try {
    if (stepId === "dao") {
      const policy = await rpcViewCall(daoIdFor(slug), "get_policy", {});
      const council = (policy.roles || []).find((r) => r.name === "council");
      return Array.isArray(council && council.kind && council.kind.Group)
        && council.kind.Group.indexOf(createState.creator) >= 0;
    }
    if (stepId === "contract") {
      const params = await rpcViewCall(contractIdFor(slug, createState.creator), "get_params", {});
      return params && params.points_per_member === 100;
    }
    if (stepId === "register") {
      const g = await rpcViewCall(REGISTRY_ID, "get_group", { group_id: slug });
      return g !== null && g !== undefined;
    }
    if (stepId === "sync") {
      const members = await rpcViewCall(contractIdFor(slug, createState.creator), "get_members", {});
      return Array.isArray(members) && members.indexOf(createState.creator) >= 0;
    }
  } catch (_) { return false; }
  return false;
}

async function renderProgress() {
  const panel = el("progressPanel");
  const list = el("progressSteps");
  const cont = el("continueBtn");
  const note = el("progressNote");
  if (!createState) { if (panel) panel.style.display = "none"; return; }
  if (panel) panel.style.display = "block";
  if (!list) return;
  let html = "";
  let allDone = true;
  for (const s of STEPS) {
    const done = await stepDone(s.id);
    if (!done) allDone = false;
    const mark = done ? "✓" : (createState.failedStep === s.id ? "✗" : "·");
    const cls = done ? "done" : (createState.failedStep === s.id ? "" : "");
    html += "<li class=\"" + cls + "\">" + mark + " " + s.label + "</li>";
  }
  list.innerHTML = html;
  if (cont) cont.style.display = allDone ? "none" : "block";
  if (note) {
    if (allDone) note.textContent = "All four steps are done. Your group is live.";
    else if (createState.failedStep) note.textContent = "Stopped at: " + createState.failedStep + ". Tap Continue creating to retry from there.";
    else note.textContent = "Tap Continue creating to pick up where you stopped.";
  }
}

function setStepFailed(stepId, message) {
  if (createState) { createState.failedStep = stepId; saveCreateState(); }
  const note = el("progressNote");
  if (note) note.textContent = "Stopped: " + message + " Tap Continue creating to retry.";
  renderProgress();
}

async function runCreate() {
  if (!createState) return;
  const s = createState;
  const result = el("createResult");
  try {
    // Step 1: DAO through the factory.
    if (!(await stepDone("dao"))) {
      pageStatus("Step 1 of 4: creating your DAO. Your wallet will open to sign it.");
      const daoArgs = {
        config: { name: s.slug, purpose: s.name + " — a self-serve FairShare group", metadata: "" },
        policy: [s.creator],
      };
      await walletCall(FACTORY_ID, "create", { name: s.slug, args: btoa(JSON.stringify(daoArgs)) }, (BigInt(Math.round(s.treasury * 10)) * YOCTO_PER_NEAR / 10n).toString(), WALLET_GAS_150);
      const policy = await rpcViewCall(daoIdFor(s.slug), "get_policy", {});
      const council = (policy.roles || []).find((r) => r.name === "council");
      if (!council || (council.kind.Group || []).indexOf(s.creator) < 0) throw new Error("the DAO was created but its council does not list you");
      s.failedStep = null; saveCreateState();
      await renderProgress();
    }
    // Step 2: round contract as a creator subaccount.
    if (!(await stepDone("contract"))) {
      const contractId = contractIdFor(s.slug, s.creator);
      if (!(await accountExists(contractId))) {
        pageStatus("Step 2 of 4: creating your group's contract account. Your wallet will open to sign it.");
        const kp = window.nearApiJs.KeyPair.fromRandom("ed25519");
        const secretKey = kp.toString();
        try { localStorage.setItem(GROUP_KEY_PREFIX + s.slug, secretKey); } catch (_) { /* storage unavailable */ }
        s.contractKey = secretKey;
        saveCreateState();
        await walletTx(contractId, [
          { type: "CreateAccount" },
          { type: "Transfer", deposit: (BigInt(Math.round(GROUP_CONTRACT_FUND_NEAR * 10)) * YOCTO_PER_NEAR / 10n).toString() },
          { type: "AddKey", publicKey: kp.getPublicKey().toString(), accessKey: { permission: "FullAccess" } },
        ]);
        if (!(await accountExists(contractId))) throw new Error("the contract account was not created");
      }
      // Deploy the live FairShare code with the fresh key, then init it.
      pageStatus("Step 2 of 4: deploying your group's contract. This signs in the browser with the key just made; no wallet popup.");
      const secretKey = s.contractKey || localStorage.getItem(GROUP_KEY_PREFIX + s.slug);
      if (!secretKey) throw new Error("the contract account key is missing from this browser; reload the page and continue");
      const codeB64 = await fetchContractCodeBase64();
      const raw = atob(codeB64);
      const code = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) code[i] = raw.charCodeAt(i);
      const { connect, keyStores, KeyPair } = window.nearApiJs;
      const ks = new keyStores.InMemoryKeyStore();
      await ks.setKey("testnet", contractId, KeyPair.fromString(secretKey));
      const near = await connect({ networkId: "testnet", nodeUrl: "https://rpc.testnet.fastnear.com", keyStore: ks });
      const acct = await near.account(contractId);
      await acct.deployContract(code);
      await acct.functionCall({
        contractId: contractId,
        methodName: "new",
        args: { owner_id: s.creator, dao_id: daoIdFor(s.slug) },
        gas: 100_000_000_000_000n,
        attachedDeposit: 0n,
      });
      const params = await rpcViewCall(contractId, "get_params", {});
      if (!params || params.points_per_member !== 100) throw new Error("the contract deployed but its params do not match");
      s.failedStep = null; saveCreateState();
      await renderProgress();
    }
    // Step 3: register in the directory.
    if (!(await stepDone("register"))) {
      pageStatus("Step 3 of 4: listing your group in the directory. Your wallet will open to sign it.");
      await walletCall(REGISTRY_ID, "register_group", {
        group_id: s.slug, name: s.name, template: s.template, badge_url: s.badgeUrl,
        dao_id: daoIdFor(s.slug), contract_id: contractIdFor(s.slug, s.creator),
        creator: s.creator, invite_code: s.inviteCode,
      }, REGISTER_DEPOSIT_YOCTO, WALLET_GAS_100);
      const g = await rpcViewCall(REGISTRY_ID, "get_group", { group_id: s.slug });
      if (!g) throw new Error("the group was not listed in the directory");
      s.failedStep = null; saveCreateState();
      await renderProgress();
    }
    // Step 4: sync the DAO council into the contract.
    if (!(await stepDone("sync"))) {
      pageStatus("Step 4 of 4: syncing your membership. Your wallet will open to sign it.");
      await walletCall(contractIdFor(s.slug, s.creator), "sync_dao_members", {}, "0", WALLET_GAS_100);
      const members = await rpcViewCall(contractIdFor(s.slug, s.creator), "get_members", {});
      if (!members || members.indexOf(s.creator) < 0) throw new Error("your membership did not sync into the contract");
      s.failedStep = null; saveCreateState();
      await renderProgress();
    }
    showDone();
  } catch (e) {
    const step = (await stepDone("dao")) ? ((await stepDone("contract")) ? ((await stepDone("register")) ? "sync" : "register") : "contract") : "dao";
    setStepFailed(step, String(e && e.message ? e.message : e).slice(0, 200));
    pageStatus("Creating stopped: " + String(e && e.message ? e.message : e).slice(0, 160));
  }
}

function showDone() {
  if (!createState) return;
  const s = createState;
  const panel = el("donePanel");
  const line = el("doneLine");
  const link = el("doneInviteLink");
  const groupLink = el("doneGroupLink");
  const keyEl = el("doneContractKey");
  const next = el("doneNext");
  if (line) line.textContent = s.name + " is live. Your DAO is " + daoIdFor(s.slug) + " and your contract is " + contractIdFor(s.slug, s.creator) + ".";
  if (link) link.textContent = inviteLinkFor(s.slug, s.inviteCode);
  if (groupLink) groupLink.href = "/group?id=" + encodeURIComponent(s.slug) + "&invite=" + encodeURIComponent(s.inviteCode);
  if (keyEl) keyEl.textContent = s.contractKey || localStorage.getItem(GROUP_KEY_PREFIX + s.slug) || "(key not in this browser)";
  if (next) next.textContent = "Next: share the invite link, then open your group's page and propose your first round. Your DAO holds " + s.treasury + " NEAR; a " + s.envelope + " NEAR round needs that much liquid plus the proposal bond, which is returned when the council approves.";
  if (panel) panel.style.display = "block";
  const form = el("formPanel");
  if (form) form.style.display = "none";
  pageStatus("Your group is live.");
  createState = null;
  saveCreateState();
}

let slugTimer = null;
function onNameInput() {
  const name = (el("groupName").value || "").trim();
  const slug = slugify(name);
  const line = el("slugLine");
  slugAvailable = null;
  if (!slug || slug.length < 2) {
    if (line) line.textContent = "Your group's address will be shown here once you type a name.";
    return;
  }
  if (line) line.textContent = "Checking " + slug + ".sputnikv2.testnet …";
  clearTimeout(slugTimer);
  slugTimer = setTimeout(async () => {
    try {
      const taken = await rpcViewCall(REGISTRY_ID, "get_group", { group_id: slug });
      if (taken) { slugAvailable = false; if (line) line.textContent = "“" + slug + "” is already taken. Try another name."; return; }
      if (await accountExists(daoIdFor(slug))) { slugAvailable = false; if (line) line.textContent = "“" + slug + "” is already taken as a DAO name. Try another name."; return; }
      if (walletAccountId && await accountExists(contractIdFor(slug, walletAccountId))) { slugAvailable = false; if (line) line.textContent = "“" + slug + "” is already taken as a contract name. Try another name."; return; }
      slugAvailable = true;
      if (line) line.textContent = "Available: your DAO will be " + daoIdFor(slug) + " and your contract " + (walletAccountId ? contractIdFor(slug, walletAccountId) : slug + "-fairshare.<you>") + ".";
    } catch (e) {
      if (line) line.textContent = "Could not check availability just now: " + String(e.message).slice(0, 100) + ". Try again.";
    }
  }, 400);
}

async function refreshCreatePage() {
  const bal = el("balanceLine");
  if (walletAccountId && bal) {
    try {
      const b = await rpcAccountBalance(walletAccountId);
      const need = (BigInt(Math.round((GROUP_DAO_DEPOSIT_NEAR + GROUP_CONTRACT_FUND_NEAR + 2) * 10)) * YOCTO_PER_NEAR / 10n);
      bal.textContent = "Wallet balance: " + fmtYocto(b) + " NEAR. You need about " + fmtYocto(need) + " NEAR to create a group with the defaults above."
        + (b < need ? " Top up from the NEAR faucet first." : "");
    } catch (_) { bal.textContent = "Wallet balance: could not be read just now."; }
  } else if (bal) {
    bal.textContent = "Wallet balance: not connected.";
  }
  if (createState) renderProgress();
}

async function submitCreate() {
  const result = el("createResult");
  if (!walletAccountId) { if (result) result.textContent = "Connect your testnet wallet first (top right)."; return; }
  const name = (el("groupName").value || "").trim();
  const template = el("groupTemplate").value;
  const envelope = parseInt(el("groupEnvelope").value, 10);
  const treasury = parseFloat(el("groupTreasury").value);
  if (name.length < 2 || name.length > 80) { if (result) result.textContent = "Give your group a name of 2 to 80 characters."; return; }
  const slug = slugify(name);
  if (!slug || slug.length < 2) { if (result) result.textContent = "That name does not make a usable group address. Use letters and numbers."; return; }
  if (TEMPLATES.map((t) => t.id).indexOf(template) < 0) { if (result) result.textContent = "Pick what the group is for."; return; }
  if (!envelope || envelope < 1) { if (result) result.textContent = "The first round envelope must be at least 1 NEAR."; return; }
  if (!treasury || treasury < 5.5) { if (result) result.textContent = "The DAO needs at least 5.5 NEAR for its storage. Use 10.5 NEAR to also fund a 5 NEAR first round."; return; }
  if (slugAvailable === false) { if (result) result.textContent = "That group name is already taken. Try another name."; return; }
  const need = BigInt(Math.round((treasury + GROUP_CONTRACT_FUND_NEAR + 2) * 10)) * YOCTO_PER_NEAR / 10n;
  try {
    const b = await rpcAccountBalance(walletAccountId);
    if (b < need) { if (result) result.textContent = "You have " + fmtYocto(b) + " NEAR but need about " + fmtYocto(need) + " NEAR. Top up from the NEAR faucet first."; return; }
  } catch (_) { /* balance check failed; the chain will reject an underfunded call instead */ }
  let badgeUrl = badgeDataUrl;
  if (!badgeUrl) {
    const u = (el("badgeUrl").value || "").trim();
    if (u && !u.startsWith("https://")) { if (result) result.textContent = "The badge link must start with https://."; return; }
    badgeUrl = u;
  }
  if (badgeUrl.length > 65536) { if (result) result.textContent = "That badge image is too big. Pick a smaller one."; return; }
  createState = {
    slug: slug, name: name, template: template, badgeUrl: badgeUrl,
    envelope: envelope, treasury: treasury,
    inviteCode: randomInviteCode(), creator: walletAccountId,
    contractKey: null, failedStep: null,
  };
  saveCreateState();
  if (result) result.textContent = "";
  await renderProgress();
  await runCreate();
}

function initCreatePage() {
  loadCreateState();
  const nameInput = el("groupName");
  if (nameInput) nameInput.addEventListener("input", onNameInput);
  const badgeFile = el("badgeFile");
  if (badgeFile) badgeFile.addEventListener("change", async () => {
    const f = badgeFile.files && badgeFile.files[0];
    badgeDataUrl = f ? await downscaleBadgeImage(f) : "";
    const prev = el("badgePreview");
    if (prev) {
      if (badgeDataUrl) { prev.src = badgeDataUrl; prev.style.display = "inline-block"; }
      else prev.style.display = "none";
    }
  });
  const badgeUrlInput = el("badgeUrl");
  if (badgeUrlInput) badgeUrlInput.addEventListener("input", () => {
    const u = badgeUrlInput.value.trim();
    const prev = el("badgePreview");
    if (prev) {
      if (u.startsWith("https://")) { prev.src = u; prev.style.display = "inline-block"; }
      else if (!badgeDataUrl) prev.style.display = "none";
    }
  });
  const btn = el("createBtn");
  if (btn) btn.addEventListener("click", submitCreate);
  const cont = el("continueBtn");
  if (cont) cont.addEventListener("click", runCreate);
  const copy = el("copyInviteBtn");
  if (copy) copy.addEventListener("click", () => {
    const link = el("doneInviteLink");
    if (link && navigator.clipboard) navigator.clipboard.writeText(link.textContent).then(() => { copy.textContent = "Copied"; }, () => { copy.textContent = "Copy invite link"; });
  });
  window.fairshareWalletChanged = refreshCreatePage;
  initGroupsWallet();
  if (createState) {
    if (nameInput) nameInput.value = createState.name;
    const t = el("groupTemplate"); if (t) t.value = createState.template;
    const e = el("groupEnvelope"); if (e) e.value = String(createState.envelope);
    const tr = el("groupTreasury"); if (tr) tr.value = String(createState.treasury);
    renderProgress();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initCreatePage);
}
