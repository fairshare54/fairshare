// Group page — one self-serve FairShare group's own page.
// Route: /group?id=<slug>&invite=<code>. The group record comes from
// fairshare-registry.testnet; rounds, members and allocations come from
// the group's own round contract; proposals come from its own DAO.
// Only members see the details: the page checks the contract's synced
// member set and hides the details section from everyone else. (Honest
// note: the chain underneath is public, so this is app-level gating; a
// determined reader can query the contract directly.)
// Testnet only.
let GROUP = null;
let GROUP_ID = "";
let INVITE = "";
let groupMembers = [];
let groupCouncil = [];
let groupThreshold = 0;
let groupOpenRound = null;
let allocBuiltForRound = 0;

function paramsFromUrl() {
  const q = new URLSearchParams(window.location.search);
  return { id: q.get("id") || "", invite: q.get("invite") || "" };
}

async function loadGroup() {
  const { id, invite } = paramsFromUrl();
  GROUP_ID = id; INVITE = invite;
  const nameEl = el("groupName");
  if (!GROUP_ID) {
    if (nameEl) nameEl.textContent = "No group here";
    pageStatus("Pick a group from the directory, or create your own.");
    return;
  }
  try {
    GROUP = await rpcViewCall(REGISTRY_ID, "get_group", { group_id: GROUP_ID });
  } catch (e) {
    if (nameEl) nameEl.textContent = "Could not load this group";
    pageStatus("The directory could not be read just now: " + String(e.message).slice(0, 120));
    return;
  }
  if (!GROUP) {
    if (nameEl) nameEl.textContent = "No group called “" + GROUP_ID + "”";
    pageStatus("This group is not in the directory. Check the link, or create your own group.");
    return;
  }
  document.title = GROUP.name + " — FairShare";
  if (nameEl) nameEl.textContent = GROUP.name;
  const badge = el("groupBadge");
  if (badge) {
    if (GROUP.badge_url) { badge.src = GROUP.badge_url; badge.style.display = "inline-block"; }
    else { badge.src = "/favicon.svg"; badge.style.display = "inline-block"; }
  }
  const kicker = el("groupKicker");
  if (kicker) kicker.textContent = "FairShare group · " + GROUP.template;
  const lede = el("groupLede");
  if (lede) lede.textContent = "Created by " + GROUP.creator + ". Its own DAO funds its rounds; its members give each other 100 points per round and the contract settles the payouts onchain.";
  await refreshGroupPage();
}

function isMember() {
  return !!walletAccountId && groupMembers.indexOf(walletAccountId) >= 0;
}
function isCouncil() {
  return !!walletAccountId && groupCouncil.indexOf(walletAccountId) >= 0;
}

async function refreshGroupPage() {
  if (!GROUP) return;
  const details = el("detailsSection");
  const join = el("joinPanel");
  // The contract may not exist yet if the creator stopped halfway.
  const contractExists = await accountExists(GROUP.contract_id);
  if (!contractExists) {
    pageStatus("This group is still being set up — its contract is not deployed yet. Ask the creator to finish creating it.");
    if (join) join.style.display = "none";
    if (details) details.style.display = "none";
    return;
  }
  try {
    groupMembers = await rpcViewCall(GROUP.contract_id, "get_members", {});
  } catch (_) { groupMembers = []; }
  try {
    const policy = await rpcViewCall(GROUP.dao_id, "get_policy", {});
    const role = (policy.roles || []).find((r) => r.name === "council");
    groupCouncil = (role && role.kind && role.kind.Group) || [];
    groupThreshold = Math.floor(groupCouncil.length / 2) + 1;
  } catch (_) { groupCouncil = []; groupThreshold = 0; }
  if (!walletAccountId) {
    pageStatus("Connect your wallet above. Members see the group's rounds, proposals and allocations.");
    if (join) join.style.display = "block";
    const jb = el("joinBtn"); if (jb) jb.style.display = "none";
    if (details) details.style.display = "none";
    return;
  }
  if (!isMember()) {
    pageStatus("You are not a member of this group yet.");
    if (join) join.style.display = "block";
    const jt = el("joinText");
    const jb = el("joinBtn");
    const jr = el("joinResult");
    if (INVITE && INVITE === GROUP.invite_code) {
      if (jt) jt.textContent = "You opened this page with the group's invite link. Tap Join and a council member will approve you.";
      if (jb) jb.style.display = "inline-block";
    } else {
      if (jt) jt.textContent = "You need an invite link from a member of this group. Ask a member to share it with you.";
      if (jb) jb.style.display = "none";
    }
    if (jr) jr.textContent = "";
    if (details) details.style.display = "none";
    return;
  }
  if (join) join.style.display = "none";
  if (details) details.style.display = "block";
  pageStatus("You are a member of " + GROUP.name + ".");
  await refreshMembersPanel();
  await refreshRoundsPanel();
  await refreshAllocForm();
  await refreshGovPanel();
}

async function refreshMembersPanel() {
  const list = el("membersList");
  const note = el("membersNote");
  if (!list) return;
  try {
    const rows = [];
    for (const m of groupMembers) {
      let standing = "?";
      try { standing = await rpcViewCall(GROUP.contract_id, "get_standing", { account_id: m }); } catch (_) { /* keep ? */ }
      rows.push("<tr><td>" + escapeHtml(m) + "</td><td>" + standing + "</td><td>" + (m === GROUP.creator ? "Creator" : "") + "</td></tr>");
    }
    list.innerHTML = "<table><tr><th>Member</th><th>Standing</th><th></th></tr>" + rows.join("") + "</table>";
    if (note) note.textContent = groupMembers.length + " members. Standing starts at 100, rises when others give you points, and falls by 5 when you skip a round. DAO: " + GROUP.dao_id + ". Contract: " + GROUP.contract_id + ".";
  } catch (e) {
    list.innerHTML = "<p class=\"muted\">Could not read the members just now.</p>";
  }
}

async function findGroupOpenRound() {
  for (let id = 20; id >= 1; id--) {
    try {
      const r = await rpcViewCall(GROUP.contract_id, "get_round", { round_id: id });
      if (r && !r.closed && !r.settled) return r;
    } catch (_) { /* a missing round id is not an error */ }
  }
  return null;
}
async function nextGroupRoundId() {
  for (let id = 20; id >= 1; id--) {
    try {
      const r = await rpcViewCall(GROUP.contract_id, "get_round", { round_id: id });
      if (r) return id + 1;
    } catch (_) { /* no round at this id */ }
  }
  return 1;
}

async function refreshRoundsPanel() {
  const list = el("roundsList");
  if (!list) return;
  try {
    const rounds = [];
    for (let id = 1; id <= 20; id++) {
      try {
        const r = await rpcViewCall(GROUP.contract_id, "get_round", { round_id: id });
        if (r) rounds.push(r);
      } catch (_) { /* no round at this id */ }
    }
    if (rounds.length === 0) {
      list.innerHTML = "<p class=\"muted\">No rounds yet. A council member can propose the first one below.</p>";
      return;
    }
    let html = "";
    for (const r of rounds) {
      const status = r.settled ? "Settled" : (r.closed ? "Closed" : "Open");
      html += "<h3>Round " + r.id + " · " + fmtYocto(BigInt(r.envelope_yocto)) + " NEAR · " + status + "</h3>";
      if (r.settled) {
        try {
          const payouts = await rpcViewCall(GROUP.contract_id, "get_payouts", { round_id: r.id });
          const lines = (payouts || []).filter((p) => BigInt(p.payout_yocto || "0") > 0n)
            .map((p) => escapeHtml(p.account_id) + " · " + fmtYocto(BigInt(p.payout_yocto)) + " NEAR");
          html += lines.length ? "<p>" + lines.join("<br>") + "</p>" : "<p class=\"muted\">Settled with no payouts.</p>";
        } catch (_) { html += "<p class=\"muted\">Payouts could not be read just now.</p>"; }
      } else {
        try {
          const subs = await rpcViewCall(GROUP.contract_id, "get_allocations", { round_id: r.id });
          html += "<p class=\"muted\">" + (subs || []).length + " member(s) have allocated so far. Deadline: " + new Date(r.deadline_ns / 1000000).toLocaleString() + ".</p>";
        } catch (_) { /* ignore */ }
      }
    }
    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = "<p class=\"muted\">Could not read the rounds just now.</p>";
  }
}

function groupRowHtml(members, selected, points, reason) {
  const opts = members.map((m) =>
    "<option value=\"" + m + "\"" + (m === selected ? " selected" : "") + ">" + m + "</option>"
  ).join("");
  return "<div class=\"groupRow\"><select class=\"groupTo\" aria-label=\"Recipient\">" + opts + "</select> " +
    "<input type=\"number\" class=\"groupPoints\" value=\"" + points + "\" min=\"0\" max=\"100\" aria-label=\"Points\" style=\"max-width:90px\"> points" +
    "<br><input type=\"text\" class=\"groupReason\" value=\"" + escapeHtml(reason || "") + "\" maxlength=\"200\" placeholder=\"Why do they deserve points?\" aria-label=\"Reason\" style=\"max-width:420px\"></div>";
}
function groupUpdateTotal() {
  const form = el("allocForm");
  const totalEl = el("groupTotal");
  if (!form || !totalEl) return;
  let total = 0;
  form.querySelectorAll(".groupPoints").forEach((i) => { total += parseInt(i.value, 10) || 0; });
  totalEl.textContent = "You have given " + total + " of your 100 points.";
}

async function refreshAllocForm() {
  const form = el("allocForm");
  const title = el("allocTitle");
  const note = el("allocNote");
  if (!form) return;
  groupOpenRound = await findGroupOpenRound();
  if (!groupOpenRound) {
    if (title) title.textContent = "Allocate your 100 points";
    if (note) note.textContent = "No round is open right now. When a round opens, your allocate form appears here.";
    form.innerHTML = "";
    allocBuiltForRound = 0;
    return;
  }
  if (title) title.textContent = "Round " + groupOpenRound.id + " is open: allocate your 100 points";
  if (note) note.textContent = "Give your 100 points to at least 3 members, with a reason for each. Sending replaces any earlier submission you made in this round. The call is signed in your wallet; the site never sees your keys.";
  if (allocBuiltForRound === groupOpenRound.id) return; // already built for this round
  const others = groupMembers.filter((m) => m !== walletAccountId);
  let mine = [];
  try {
    const subs = await rpcViewCall(GROUP.contract_id, "get_allocations", { round_id: groupOpenRound.id });
    const sub = (subs || []).find((s) => (s.account_id || s.member || s.giver) === walletAccountId);
    if (sub && sub.allocations) mine = sub.allocations;
  } catch (_) { /* no submission yet */ }
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const a = mine[i] || {};
    rows.push(groupRowHtml(others, a.to || others[i % others.length], a.points || 0, a.reason || ""));
  }
  form.innerHTML = (mine.length > 0
    ? "<div id=\"groupAllocDone\"><p><strong>Your allocation is onchain:</strong> " + mine.map((a) => (a.to || "").replace(".testnet", "") + " " + a.points).join(", ") + ".</p>" +
      "<p><button id=\"groupChangeAlloc\" type=\"button\" class=\"secondary\">Change my allocation</button></p></div>"
    : "") +
    "<div id=\"groupAllocEdit\" style=\"display:" + (mine.length > 0 ? "none" : "block") + "\">" +
    rows.join("") +
    "<p><button id=\"groupAddRow\" type=\"button\" class=\"secondary\">Add another recipient</button> " +
    "<button id=\"groupSubmit\" type=\"button\">Send my 100 points</button></p>" +
    "<p class=\"muted\" id=\"groupTotal\"></p></div>";
  allocBuiltForRound = groupOpenRound.id;
  form.querySelectorAll(".groupPoints").forEach((i) => i.addEventListener("input", groupUpdateTotal));
  groupUpdateTotal();
  const change = el("groupChangeAlloc");
  if (change) change.addEventListener("click", () => {
    const edit = el("groupAllocEdit");
    const done = el("groupAllocDone");
    if (edit) edit.style.display = "block";
    if (done) done.style.display = "none";
  });
  const add = el("groupAddRow");
  if (add) add.addEventListener("click", () => {
    const count = form.querySelectorAll(".groupRow").length;
    if (count >= 8) return;
    const used = Array.from(form.querySelectorAll(".groupTo")).map((s) => s.value);
    const next = others.find((m) => used.indexOf(m) < 0) || others[0];
    const div = document.createElement("div");
    div.innerHTML = groupRowHtml(others, next, 0, "");
    while (div.firstChild) form.insertBefore(div.firstChild, add.parentNode);
    form.querySelectorAll(".groupPoints").forEach((i) => { i.removeEventListener("input", groupUpdateTotal); i.addEventListener("input", groupUpdateTotal); });
    groupUpdateTotal();
  });
  const submit = el("groupSubmit");
  if (submit) submit.addEventListener("click", submitGroupAllocate);
}

async function submitGroupAllocate() {
  const form = el("allocForm");
  if (!form || !groupOpenRound || !walletAccountId) return;
  const allocations = [];
  let error = null;
  form.querySelectorAll(".groupRow").forEach((row) => {
    const to = row.querySelector(".groupTo").value;
    const points = parseInt(row.querySelector(".groupPoints").value, 10) || 0;
    const reason = row.querySelector(".groupReason").value.trim();
    if (points < 0 || points > 100) error = "Points for one member must be between 0 and 100.";
    if (points > 0 && !reason) error = "Give a reason for every gift.";
    if (points > 0) allocations.push({ to: to, points: points, reason: reason });
  });
  const seen = {};
  for (const a of allocations) {
    if (seen[a.to]) error = "Name each recipient only once.";
    seen[a.to] = true;
  }
  const total = allocations.reduce((s, a) => s + a.points, 0);
  if (!error && total !== 100) error = "You gave " + total + " points. Give exactly 100.";
  if (!error && allocations.length < 3) error = "Name at least 3 recipients. You named " + allocations.length + ".";
  if (error) { pageStatus(error); return; }
  pageStatus("Opening your wallet to sign the allocate call for round " + groupOpenRound.id + "…");
  try {
    await walletCall(GROUP.contract_id, "allocate", { round_id: groupOpenRound.id, allocations: allocations }, "0");
    pageStatus("Allocation sent. Checking the chain…");
    await new Promise((r) => setTimeout(r, 4000));
    allocBuiltForRound = 0;
    await refreshAllocForm();
    await refreshRoundsPanel();
  } catch (e) {
    pageStatus("Wallet error: " + String(e.message).slice(0, 160));
  }
}

function govKindLabel(kind) {
  if (!kind || typeof kind !== "object") return "Proposal";
  if (kind.AddMemberToRole) return "Add " + kind.AddMemberToRole.member_id + " to the council";
  if (kind.RemoveMemberFromRole) return "Remove " + kind.RemoveMemberFromRole.member_id + " from " + kind.RemoveMemberFromRole.role;
  if (kind.FunctionCall) {
    const f = kind.FunctionCall;
    const dep = f.deposit && f.deposit !== "0" ? " with " + fmtYocto(BigInt(f.deposit)) + " NEAR attached" : "";
    return "Call " + f.receiver_id + ", " + f.method_name + dep;
  }
  if (kind.Transfer) return "Transfer " + fmtYocto(BigInt(kind.Transfer.amount)) + " NEAR to " + kind.Transfer.receiver_id;
  if (kind.ChangePolicy) return "Change the DAO policy";
  if (kind.ChangeConfig) return "Change the DAO config";
  return Object.keys(kind)[0];
}

async function refreshGovPanel() {
  const list = el("govProposals");
  if (!list || !GROUP) return;
  const status = el("govStatus");
  const forms = el("govForms");
  try {
    if (status) status.textContent = "Reading open proposals from the DAO…";
    const proposals = await rpcViewCall(GROUP.dao_id, "get_proposals", { from_index: 0, limit: 50 });
    const open = (proposals || []).filter((p) => p.status === "InProgress");
    const total = (proposals || []).length;
    if (open.length === 0) {
      list.innerHTML = "<p class=\"muted\">No open proposals right now. " + total +
        " proposals have run so far, and every one of them was decided by the council.</p>";
    } else {
      list.innerHTML = open.map((p) => {
        const counts = (p.vote_counts && p.vote_counts.council) || [0, 0, 0];
        const approve = counts[0] || 0;
        const reject = counts[1] || 0;
        const myVote = walletAccountId && p.votes ? p.votes[walletAccountId] : null;
        let actions = "";
        if (isCouncil()) {
          if (myVote) {
            actions = "<p class=\"muted\">You voted " + myVote + " on this proposal.</p>";
          } else {
            actions = "<p><button type=\"button\" data-gov-vote=\"VoteApprove\" data-gov-id=\"" + p.id +
              "\">Approve</button> <button type=\"button\" data-gov-vote=\"VoteReject\" data-gov-id=\"" + p.id +
              "\">Reject</button></p>";
          }
        } else if (walletAccountId) {
          actions = "<p class=\"muted\">Only council members can vote. This account is not on the council.</p>";
        } else {
          actions = "<p class=\"muted\">Connect your wallet above to vote. Only council members can vote.</p>";
        }
        return "<div><h3>Proposal #" + p.id + " · " + govKindLabel(p.kind) + "</h3>" +
          "<p class=\"muted\">" + escapeHtml(p.description || "") + " · Proposed by " + p.proposer + "</p>" +
          "<p><span>" + approve + " approve · " + reject + " reject</span> · Needs " +
          groupThreshold + " approvals out of " + groupCouncil.length + " council members</p>" +
          actions + "</div>";
      }).join("");
      list.querySelectorAll("[data-gov-vote]").forEach((b) =>
        b.addEventListener("click", () => govVote(
          parseInt(b.getAttribute("data-gov-id"), 10),
          b.getAttribute("data-gov-vote"),
          open.find((p) => p.id === parseInt(b.getAttribute("data-gov-id"), 10))
        ))
      );
    }
    if (status) status.textContent = open.length === 0
      ? "No open proposals. The list above is fresh from the DAO."
      : open.length + " open proposal" + (open.length > 1 ? "s" : "") + ", fresh from the DAO. Threshold is " + groupThreshold + " approvals.";
    if (forms) forms.style.display = isCouncil() ? "block" : "none";
    // Start-a-round form state.
    const roundNote = el("govRoundNote");
    const roundBtn = el("govRoundBtn");
    if (roundNote && roundBtn) {
      try {
        const openRound = await findGroupOpenRound();
        const nextId = await nextGroupRoundId();
        const daoBal = await rpcAccountBalance(GROUP.dao_id);
        if (openRound) {
          roundNote.textContent = "Round " + openRound.id + " is open. A new round can start after it closes or settles.";
          roundBtn.disabled = true;
        } else {
          roundNote.textContent = "Next round: " + nextId + ". The DAO holds " + fmtYocto(daoBal) + " NEAR. The envelope comes from the DAO treasury; proposing costs a 1 NEAR bond, returned when the council approves.";
          roundBtn.disabled = false;
          roundBtn.textContent = "Propose starting round " + nextId;
        }
      } catch (_) {
        roundNote.textContent = "Could not read the next round just now. Reload to try again.";
        roundBtn.disabled = true;
      }
    }
  } catch (e) {
    if (status) status.textContent = "Could not read proposals just now: " + String(e.message).slice(0, 120) + ". Reload to try again.";
    if (forms) forms.style.display = "none";
  }
}

async function govVote(proposalId, action, proposal) {
  const status = el("govStatus");
  if (!proposal || !walletAccountId) return;
  if (status) status.textContent = "Opening your wallet to sign the " + (action === "VoteApprove" ? "Approve" : "Reject") + " vote on proposal #" + proposalId + "…";
  try {
    await walletCall(GROUP.dao_id, "act_proposal", { id: proposalId, action: action, proposal: proposal.kind, memo: null }, "0", WALLET_GAS_150);
    if (status) status.textContent = "Sent to your wallet. Approve the call there; the list refreshes when you return.";
    setTimeout(refreshGovPanel, 3000);
  } catch (e) {
    if (status) status.textContent = "Wallet error: " + String(e.message).slice(0, 160);
  }
}

async function govProposeRound() {
  const input = el("govRoundEnvelope");
  const result = el("govRoundResult");
  if (!input || !walletAccountId) return;
  const near = parseInt(input.value, 10);
  if (!near || near < 1) {
    if (result) result.textContent = "Enter a whole number of NEAR for the envelope, at least 1.";
    return;
  }
  if (!isCouncil()) {
    if (result) result.textContent = "Only council members can propose a round.";
    return;
  }
  const status = el("govStatus");
  if (status) status.textContent = "Checking the round and the DAO balance…";
  try {
    const openRound = await findGroupOpenRound();
    if (openRound) {
      if (result) result.textContent = "Round " + openRound.id + " is still open. A new round can start after it closes or settles.";
      return;
    }
    const nextId = await nextGroupRoundId();
    const envelopeYocto = BigInt(near) * YOCTO_PER_NEAR;
    const daoBal = await rpcAccountBalance(GROUP.dao_id);
    if (envelopeYocto > daoBal) {
      if (result) result.textContent = "The DAO holds " + fmtYocto(daoBal) + " NEAR, which is less than the " + near + " NEAR envelope.";
      return;
    }
    const argsB64 = b64Utf8(JSON.stringify({ round_id: nextId, envelope_yocto: envelopeYocto.toString() }));
    const kind = { FunctionCall: { receiver_id: GROUP.contract_id, actions: [{ method_name: "create_round", args: argsB64, deposit: envelopeYocto.toString(), gas: "100000000000000" }] } };
    const description = "Fund " + GROUP.name + " round " + nextId + ": " + near + " NEAR envelope via create_round";
    if (status) status.textContent = "Opening your wallet to sign the proposal. The 1 NEAR bond is attached and returned when the council approves.";
    await walletCall(GROUP.dao_id, "add_proposal", { proposal: { description: description, kind: kind } }, DAO_BOND_YOCTO, WALLET_GAS_100);
    if (result) result.textContent = "Sent to your wallet. Approve the call there; the new proposal appears in the list above when you return, and " + groupThreshold + " approvals start the round.";
    setTimeout(refreshGovPanel, 3000);
  } catch (e) {
    if (result) result.textContent = "Wallet error: " + String(e.message).slice(0, 160);
  }
}

async function govProposeAdd() {
  const input = el("govNewMember");
  const result = el("govProposeResult");
  if (!input || !walletAccountId) return;
  const id = input.value.trim();
  if (!/^[a-z0-9._-]+\.testnet$/.test(id)) {
    if (result) result.textContent = "That does not look like a testnet account. Use the full name, like newmember.testnet.";
    return;
  }
  if (groupCouncil.indexOf(id) >= 0) {
    if (result) result.textContent = id + " is already on the council.";
    return;
  }
  const kind = { AddMemberToRole: { member_id: id, role: "council" } };
  const description = "Add " + id + " to the " + GROUP.name + " council";
  const status = el("govStatus");
  if (status) status.textContent = "Opening your wallet to sign the proposal. The 1 NEAR bond is attached and returned when the council approves.";
  try {
    await walletCall(GROUP.dao_id, "add_proposal", { proposal: { description: description, kind: kind } }, DAO_BOND_YOCTO, WALLET_GAS_100);
    if (result) result.textContent = "Sent to your wallet. Approve the call there; the new proposal appears in the list above when you return.";
    setTimeout(refreshGovPanel, 3000);
  } catch (e) {
    if (result) result.textContent = "Wallet error: " + String(e.message).slice(0, 160);
  }
}

async function joinGroup() {
  const result = el("joinResult");
  if (!walletAccountId || !GROUP) return;
  if (!INVITE || INVITE !== GROUP.invite_code) {
    if (result) result.textContent = "This invite link does not match the group. Ask a member for a fresh link.";
    return;
  }
  const status = el("pageStatus");
  if (status) status.textContent = "Opening your wallet to sign the join proposal. The 1 NEAR bond is attached and returned when the council approves.";
  try {
    const kind = { AddMemberToRole: { member_id: walletAccountId, role: "council" } };
    const description = "Add " + walletAccountId + " to the " + GROUP.name + " council (joined with the invite link)";
    const nextId = await rpcViewCall(GROUP.dao_id, "get_last_proposal_id", {});
    await walletCall(GROUP.dao_id, "add_proposal", { proposal: { description: description, kind: kind } }, DAO_BOND_YOCTO, WALLET_GAS_100);
    if (result) result.textContent = "Proposal #" + nextId + " is open. A council member needs to approve it, then your membership syncs into the contract. Check back on this page.";
  } catch (e) {
    if (result) result.textContent = "Wallet error: " + String(e.message).slice(0, 160);
  }
}

function initGroupPage() {
  const joinBtn = el("joinBtn");
  if (joinBtn) joinBtn.addEventListener("click", joinGroup);
  const roundBtn = el("govRoundBtn");
  if (roundBtn) roundBtn.addEventListener("click", govProposeRound);
  const addBtn = el("govProposeBtn");
  if (addBtn) addBtn.addEventListener("click", govProposeAdd);
  const copyBtn = el("copyInviteBtn2");
  if (copyBtn) copyBtn.addEventListener("click", () => {
    if (!GROUP) return;
    const link = window.location.origin + "/group?id=" + encodeURIComponent(GROUP.group_id) + "&invite=" + encodeURIComponent(GROUP.invite_code);
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => { copyBtn.textContent = "Copied"; }, () => { copyBtn.textContent = "Copy invite link"; });
  });
  window.fairshareWalletChanged = refreshGroupPage;
  initGroupsWallet();
  loadGroup();
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", initGroupPage);
}
