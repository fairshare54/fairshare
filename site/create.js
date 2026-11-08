// Create your DAO — the self-serve FairShare group flow.
// One wallet, four steps, each verified onchain before the next:
//  1. DAO through the Sputnik factory (treasury deposit -> the DAO).
//  2. Register the group in fairshare-registry.testnet.
//  3. Deploy the group's round contract: one wallet call to the
//     registry's deploy_group_contract, which creates the contract as
//     its own subaccount and deploys the embedded FairShare code — no
//     browser key, no full-access grant (Meteor blocks those).
//  4. Sync the DAO council into the contract.
// Every step first reads onchain state and skips work already done, so
// reloading halfway (the wallet redirects back here after each signing)
// continues where it stopped. Testnet only.
const CREATE_KEY = "fairshare-creating";

let createState = null; // the in-progress record from localStorage
let badgeDataUrl = ""; // downscaled badge image, if the user picked a file
let slugAvailable = null;
let redirectPending = false; // set once the group is live and the page is about to leave for it

// A tap must show feedback before the wallet opens: the wallet call is
// async and can take seconds on a phone, so the button is disabled and
// given a spinner synchronously, in the same tick as the tap — before
// any await yields. Without this the page looks dead until the wallet
// prompt appears, and an impatient tap fires the flow twice.
function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    if (btn.dataset.origHtml === undefined) btn.dataset.origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = "<span class=\"spinner\" aria-hidden=\"true\"></span>" + label;
  } else {
    if (btn.dataset.origHtml !== undefined) { btn.innerHTML = btn.dataset.origHtml; delete btn.dataset.origHtml; }
    btn.disabled = false;
  }
}

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
// The round contract is a subaccount of the registry, deployed by the
// registry itself — never by the browser, so no wallet key is needed.
function contractIdFor(slug) { return slug + "-fairshare." + REGISTRY_ID; }
function inviteLinkFor(slug, code) {
  return window.location.origin + "/group?id=" + encodeURIComponent(slug) + "&invite=" + encodeURIComponent(code);
}

const STEPS = [
  { id: "dao", label: "Create your DAO" },
  { id: "register", label: "List the group in the directory" },
  { id: "contract", label: "Deploy your group's contract" },
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
      const params = await rpcViewCall(contractIdFor(slug), "get_params", {});
      return params && params.points_per_member === 100;
    }
    if (stepId === "register") {
      const g = await rpcViewCall(REGISTRY_ID, "get_group", { group_id: slug });
      return g !== null && g !== undefined;
    }
    if (stepId === "sync") {
      const members = await rpcViewCall(contractIdFor(slug), "get_members", {});
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
  // All done — including when the page reloaded after the last wallet
  // signing and the user never tapped Continue again. Show the done
  // panel, which takes them to their group's page.
  if (allDone) showDone();
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
      await walletCall(FACTORY_ID, "create", { name: s.slug, args: b64Utf8(JSON.stringify(daoArgs)) }, (BigInt(Math.round(s.treasury * 10)) * YOCTO_PER_NEAR / 10n).toString(), WALLET_GAS_150);
      const policy = await rpcViewCall(daoIdFor(s.slug), "get_policy", {});
      const council = (policy.roles || []).find((r) => r.name === "council");
      if (!council || (council.kind.Group || []).indexOf(s.creator) < 0) throw new Error("the DAO was created but its council does not list you");
      s.failedStep = null; saveCreateState();
      await renderProgress();
    }
    // Step 2: register in the directory. The registry records the
    // contract id the deploy step will create, so this comes first.
    if (!(await stepDone("register"))) {
      pageStatus("Step 2 of 4: listing your group in the directory. Your wallet will open to sign it.");
      await walletCall(REGISTRY_ID, "register_group", {
        group_id: s.slug, name: s.name, template: s.template, badge_url: s.badgeUrl,
        dao_id: daoIdFor(s.slug), contract_id: contractIdFor(s.slug),
        creator: s.creator, invite_code: s.inviteCode,
      }, REGISTER_DEPOSIT_YOCTO, WALLET_GAS_100);
      const g = await rpcViewCall(REGISTRY_ID, "get_group", { group_id: s.slug });
      if (!g) throw new Error("the group was not listed in the directory");
      s.failedStep = null; saveCreateState();
      await renderProgress();
    }
    // Step 3: deploy the round contract. One wallet call to the
    // registry, which creates the contract as its own subaccount and
    // deploys the embedded FairShare code — no browser key, no
    // full-access grant, so Meteor signs it like any other call.
    if (!(await stepDone("contract"))) {
      const contractId = contractIdFor(s.slug);
      pageStatus("Step 3 of 4: deploying your group's contract. Your wallet will open to sign it.");
      await walletCall(REGISTRY_ID, "deploy_group_contract", { group_id: s.slug }, (BigInt(Math.round(GROUP_CONTRACT_FUND_NEAR * 10)) * YOCTO_PER_NEAR / 10n).toString(), WALLET_GAS_150);
      const params = await rpcViewCall(contractId, "get_params", {});
      if (!params || params.points_per_member !== 100) throw new Error("the contract deployed but its params do not match");
      s.failedStep = null; saveCreateState();
      await renderProgress();
    }
    // Step 4: sync the DAO council into the contract.
    if (!(await stepDone("sync"))) {
      pageStatus("Step 4 of 4: syncing your membership. Your wallet will open to sign it.");
      await walletCall(contractIdFor(s.slug), "sync_dao_members", {}, "0", WALLET_GAS_100);
      const members = await rpcViewCall(contractIdFor(s.slug), "get_members", {});
      if (!members || members.indexOf(s.creator) < 0) throw new Error("your membership did not sync into the contract");
      s.failedStep = null; saveCreateState();
      await renderProgress();
    }
    showDone();
  } catch (e) {
    const step = (await stepDone("dao")) ? ((await stepDone("register")) ? ((await stepDone("contract")) ? "sync" : "contract") : "register") : "dao";
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
  const contractEl = el("doneContractId");
  const next = el("doneNext");
  if (line) line.textContent = s.name + " is live. Your DAO is " + daoIdFor(s.slug) + " and your contract is " + contractIdFor(s.slug) + ".";
  if (link) link.textContent = inviteLinkFor(s.slug, s.inviteCode);
  if (groupLink) groupLink.href = "/group?id=" + encodeURIComponent(s.slug) + "&invite=" + encodeURIComponent(s.inviteCode);
  if (contractEl) contractEl.textContent = contractIdFor(s.slug);
  if (next) next.textContent = "Taking you to your group's page — the invite link is shown there, so share it with your members, then propose your first round. Your DAO holds " + s.treasury + " NEAR; a " + s.envelope + " NEAR round needs that much liquid plus the proposal bond, which is returned when the council approves.";
  if (panel) panel.style.display = "block";
  const form = el("formPanel");
  if (form) form.style.display = "none";
  pageStatus("Your group is live. Taking you to your group's page…");
  createState = null;
  saveCreateState();
  // Do not leave the creator on /create: the group's own page is where
  // the invite link lives and the first round gets proposed. A short
  // pause lets the "Your group is live" panel be seen first.
  redirectPending = true;
  setTimeout(() => {
    window.location.href = "/group?id=" + encodeURIComponent(s.slug) + "&invite=" + encodeURIComponent(s.inviteCode);
  }, 1500);
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
      if (walletAccountId && await accountExists(contractIdFor(slug))) { slugAvailable = false; if (line) line.textContent = "“" + slug + "” is already taken as a contract name. Try another name."; return; }
      slugAvailable = true;
      if (line) line.textContent = "Available: your DAO will be " + daoIdFor(slug) + " and your contract " + contractIdFor(slug) + ".";
    } catch (e) {
      if (line) line.textContent = "Could not check availability just now: " + String(e.message).slice(0, 100) + ". Try again.";
    }
  }, 400);
}

// What finishing still costs. A fresh create needs the DAO deposit, the
// contract funding, the 1 NEAR register deposit and the 1 NEAR proposal
// bond float. Resuming mid-flow only needs the steps not yet done
// onchain — the DAO's 10.5 NEAR is already spent once the DAO exists, so
// the warning must not keep claiming the full 17.7. A step whose onchain
// check fails reads as not done, so the figure can only overstate, never
// understate, what is left to pay.
async function remainingNeedYocto() {
  if (!createState) {
    const t = parseFloat((el("groupTreasury") || {}).value) || GROUP_DAO_DEPOSIT_NEAR;
    return BigInt(Math.round((t + GROUP_CONTRACT_FUND_NEAR + 2) * 10)) * YOCTO_PER_NEAR / 10n;
  }
  let need = 0;
  if (!(await stepDone("dao"))) need += createState.treasury;
  if (!(await stepDone("register"))) need += 1;
  if (!(await stepDone("contract"))) need += GROUP_CONTRACT_FUND_NEAR;
  return BigInt(Math.round(need * 10)) * YOCTO_PER_NEAR / 10n;
}

async function refreshCreatePage() {
  const bal = el("balanceLine");
  if (walletAccountId && bal) {
    try {
      const b = await rpcAccountBalance(walletAccountId);
      const need = await remainingNeedYocto();
      if (createState) {
        bal.textContent = "Wallet balance: " + fmtYocto(b) + " NEAR. You need about " + fmtYocto(need) + " NEAR more to finish creating this group."
          + (b < need ? " Top up from the NEAR faucet first." : "");
      } else {
        bal.textContent = "Wallet balance: " + fmtYocto(b) + " NEAR. You need about " + fmtYocto(need) + " NEAR to create a group with the defaults above."
          + (b < need ? " Top up from the NEAR faucet first." : "");
      }
    } catch (_) { bal.textContent = "Wallet balance: could not be read just now."; }
  } else if (bal) {
    bal.textContent = "Wallet balance: not connected.";
  }
  if (createState) renderProgress();
}

async function submitCreate() {
  const result = el("createResult");
  if (!walletAccountId) { if (result) result.textContent = "Connect your testnet wallet first (top right)."; return; }
  const btn = el("createBtn");
  // Show the spinner synchronously, before any await: the balance check
  // and the wallet prompt both take time on a phone, and until now the
  // tap showed nothing at all.
  setBusy(btn, true, "Creating…");
  try {
    await submitCreateInner(result);
  } finally {
    // On success showDone has set redirectPending and the page is
    // leaving for the group's page, so keep the button disabled.
    if (!redirectPending) setBusy(btn, false);
  }
}

async function submitCreateInner(result) {
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
  // Resuming the same group only needs what its unfinished steps cost —
  // the DAO deposit is already spent once the DAO exists.
  const resuming = !!(createState && createState.slug === slug);
  const need = resuming
    ? await remainingNeedYocto()
    : BigInt(Math.round((treasury + GROUP_CONTRACT_FUND_NEAR + 2) * 10)) * YOCTO_PER_NEAR / 10n;
  try {
    const b = await rpcAccountBalance(walletAccountId);
    if (b < need) { if (result) result.textContent = "You have " + fmtYocto(b) + " NEAR but need about " + fmtYocto(need) + " NEAR" + (resuming ? " more to finish creating this group." : ".") + " Top up from the NEAR faucet first."; return; }
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
    failedStep: null,
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
  if (cont) cont.addEventListener("click", () => {
    // Same as Create: spinner synchronously, before any await, so the
    // tap reads as working while the wallet prompt is being prepared.
    setBusy(cont, true, "Continuing…");
    runCreate().finally(() => { if (!redirectPending) setBusy(cont, false); });
  });
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
