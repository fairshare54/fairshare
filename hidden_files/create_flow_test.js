// Create-flow DOM test: the spinner, the redirect and the remaining-cost
// warning, driven through the real create.js / group.js with a stubbed
// DOM, wallet and RPC. Isaiah's 2026-11-08 phone observations:
//  (1) tapping Create showed nothing before the wallet opened;
//  (2) same for Continue creating;
//  (3) after all four steps the page stayed on /create;
//  (4) the balance warning claimed the full 17.7 NEAR even when resuming
//      after the DAO step was already done.
// Run: node hidden_files/create_flow_test.js
const fs = require("fs");
const vm = require("vm");

const EGBE = "/home/hatch/workspace/egbe";
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + " " + name + (detail !== undefined ? " — " + detail : ""));
  if (!ok) failures++;
}
const tick = () => new Promise((r) => setImmediate(r));
async function flush(n) { for (let i = 0; i < (n || 6); i++) await tick(); }

function makeDom() {
  const els = {};
  const listeners = {};
  function mkEl(id) {
    return {
      innerHTML: "", textContent: "", value: "", disabled: false,
      style: {}, dataset: {}, files: [], src: "",
      classList: { add() {}, remove() {} },
      querySelectorAll: () => [],
      getAttribute: () => null,
      addEventListener: (ev, fn) => { listeners[id + ":" + ev] = fn; },
    };
  }
  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
  };
  const documentStub = {
    title: "",
    getElementById: (id) => els[id] || (els[id] = mkEl(id)),
    addEventListener: (ev, fn) => { if (ev === "DOMContentLoaded") listeners["document:" + ev] = fn; },
    createElement: () => ({ getContext: () => null, toDataURL: () => "" }),
  };
  return { els, listeners, mkEl, localStorage, documentStub, store };
}

// A tiny NEAR testnet in a box: the wallet signs instantly, and each
// wallet call flips the onchain state the next step checks.
function makeChain() {
  return { daoExists: false, registered: false, contractDeployed: false, synced: false };
}
function makeFetch(chain, balanceYocto) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    const p = body.params;
    const ok = (value) => ({ ok: true, json: async () => ({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } }) });
    const err = () => ({ ok: true, json: async () => ({ error: { code: -32000, message: "not found" } }) });
    if (p.request_type === "view_account") {
      if (p.account_id === "clearsite587.testnet") return { ok: true, json: async () => ({ result: { amount: balanceYocto } }) };
      return err();
    }
    const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString("utf8"));
    if (p.method_name === "get_policy") return chain.daoExists ? ok({ roles: [{ name: "council", kind: { Group: ["clearsite587.testnet"] } }] }) : err();
    if (p.method_name === "get_group") return chain.registered ? ok({ group_id: args.group_id }) : ok(null);
    if (p.method_name === "get_params") return chain.contractDeployed ? ok({ points_per_member: 100 }) : err();
    if (p.method_name === "get_members") return chain.synced ? ok(["clearsite587.testnet"]) : (chain.contractDeployed ? ok([]) : err());
    if (p.method_name === "get_standing") return ok(100);
    return err();
  };
}

function makeContext(chain, balanceYocto, scripts, opts) {
  const dom = makeDom();
  const walletCalls = [];
  const timeouts = [];
  const o = opts || {};
  const locationStub = {
    origin: "https://fairshare-pi.vercel.app",
    pathname: "/create", search: o.search || "", hash: "",
    _href: "https://fairshare-pi.vercel.app/create",
    get href() { return this._href; },
    // A real browser resolves a relative assignment against the origin.
    set href(v) { this._href = v.indexOf("://") >= 0 ? v : this.origin + (v.charAt(0) === "/" ? v : "/" + v); },
  };
  const sandbox = {
    console,
    TextEncoder, TextDecoder, URLSearchParams, AbortController,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout: () => {},
    document: dom.documentStub,
    localStorage: dom.localStorage,
    sessionStorage: dom.localStorage,
    navigator: { clipboard: { writeText: async () => {} } },
    crypto: { getRandomValues: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = 1; return buf; } },
    history: { replaceState: () => {} },
    location: locationStub,
    fetch: o.fetch || makeFetch(chain, balanceYocto),
    nearWallet: {
      restore: async () => null,
      accountId: () => "clearsite587.testnet",
      connect: async () => ({ accountId: "clearsite587.testnet" }),
      disconnect: async () => {},
      sendTransaction: async (tx) => {
        walletCalls.push(tx);
        const method = tx.actions[0].methodName;
        if (method === "create") chain.daoExists = true;
        if (method === "register_group") chain.registered = true;
        if (method === "deploy_group_contract") chain.contractDeployed = true;
        if (method === "sync_dao_members") chain.synced = true;
        return { transactionHash: "testhash" };
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (ev, fn) => { if (ev === "DOMContentLoaded") dom.listeners["window:" + ev] = fn; };
  vm.createContext(sandbox);
  for (const s of scripts) vm.runInContext(fs.readFileSync(EGBE + "/site/" + s, "utf8"), sandbox, { filename: s });
  return { sandbox, dom, walletCalls, timeouts, locationStub };
}

async function fireLoaded(ctx) {
  const fn = ctx.dom.listeners["window:DOMContentLoaded"] || ctx.dom.listeners["document:DOMContentLoaded"];
  if (fn) await fn();
  await flush();
}

// A group page's chain, as Isaiah's Football fans group actually is:
// no rounds, no proposals, one member (the creator). Fetches resolve on
// the next macrotask tick, so a sequential scan can only ever have one
// call in flight while a parallel scan has all twenty.
function makeGroupFetch(stats) {
  const record = { group_id: "football-fans", name: "Football fans", template: "friends", creator: "clearsite587.testnet", dao_id: "football-fans.sputnikv2.testnet", contract_id: "football-fans-fairshare.fairshare-registry.testnet", invite_code: "invite-gbzbcu4a", badge_url: "" };
  return (url, opts) => {
    const body = JSON.parse(opts.body);
    const p = body.params;
    stats.calls.push(p.method_name || p.request_type);
    stats.inflight++;
    stats.maxInflight = Math.max(stats.maxInflight, stats.inflight);
    const ok = (value) => ({ ok: true, json: async () => ({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } }) });
    const err = () => ({ ok: true, json: async () => ({ error: { code: -32000, message: "not found" } }) });
    let res;
    if (p.request_type === "view_account") {
      res = { ok: true, json: async () => ({ result: { amount: "10000000000000000000000000" } }) };
    } else {
      const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString("utf8"));
      if (p.method_name === "get_group") res = ok(record);
      else if (p.method_name === "get_members") res = ok(["clearsite587.testnet"]);
      else if (p.method_name === "get_policy") res = ok({ roles: [{ name: "council", kind: { Group: ["clearsite587.testnet"] } }] });
      else if (p.method_name === "get_standing") res = ok(100);
      else if (p.method_name === "get_round") res = ok(null);
      else if (p.method_name === "get_proposals") res = ok([]);
      else res = err();
    }
    return new Promise((resolve) => setImmediate(() => { stats.inflight--; resolve(res); }));
  };
}
// Elements only exist once the page script looks them up; the form fields
// are not touched on load, so materialise them before setting values.
function getEl(ctx, id) { return ctx.sandbox.document.getElementById(id); }
// The page's own setTimeout stub captures the RPC timeout timers too, so
// find the completion redirect by its delay, not by position.
function findRedirect(ctx) { return ctx.timeouts.find((t) => t.ms === 1500); }

(async () => {
  // --- Scenario 1: fresh create, full flow -------------------------------
  {
    const chain = makeChain();
    const ctx = makeContext(chain, "20000000000000000000000000", ["groups-common.js", "create.js"]);
    await fireLoaded(ctx);
    const els = ctx.dom.els;
    check("fresh create balance line states the full 17.700 NEAR", els.balanceLine.textContent.indexOf("17.700") >= 0, els.balanceLine.textContent);
    els.groupName.value = "Test Group";
    getEl(ctx, "groupTemplate").value = "friends";
    getEl(ctx, "groupEnvelope").value = "5";
    getEl(ctx, "groupTreasury").value = "10.5";
    getEl(ctx, "badgeUrl").value = "";
    getEl(ctx, "createBtn").innerHTML = "Create my group";
    const p = ctx.dom.listeners["createBtn:click"]();
    // The spinner must already be visible in this same tick, before any
    // await yields to the balance check or the wallet.
    check("create button is disabled synchronously on tap", els.createBtn.disabled === true);
    check("create button shows a spinner synchronously on tap", els.createBtn.innerHTML.indexOf("spinner") >= 0, els.createBtn.innerHTML);
    await p;
    await flush();
    check("all four wallet calls ran in order", JSON.stringify(ctx.walletCalls.map((t) => t.actions[0].methodName)) === JSON.stringify(["create", "register_group", "deploy_group_contract", "sync_dao_members"]), ctx.walletCalls.map((t) => t.actions[0].methodName).join(","));
    check("done panel is shown", els.donePanel.style.display === "block");
    check("create button stays disabled while the redirect is pending", els.createBtn.disabled === true);
    check("a redirect is scheduled after completion", !!findRedirect(ctx), JSON.stringify(ctx.timeouts.map((t) => t.ms)));
    findRedirect(ctx).fn();
    check("redirect lands on the group's page with the invite code", ctx.locationStub.href === els.doneInviteLink.textContent, ctx.locationStub.href);
    check("redirect url carries the invite code", /\/group\?id=test-group&invite=invite-/.test(ctx.locationStub.href), ctx.locationStub.href);
  }

  // --- Scenario 2: resume after the DAO step, Continue button ------------
  {
    const chain = makeChain();
    chain.daoExists = true; // Isaiah's case: DAO done, the rest to go.
    const ctx = makeContext(chain, "7466000000000000000000000", ["groups-common.js", "create.js"]);
    ctx.dom.localStorage.setItem("fairshare-creating", JSON.stringify({
      slug: "test-group", name: "Test Group", template: "friends", badgeUrl: "",
      envelope: 5, treasury: 10.5, inviteCode: "invite-abcdefgh",
      creator: "clearsite587.testnet", failedStep: null,
    }));
    await fireLoaded(ctx);
    const els = ctx.dom.els;
    // Remaining cost is register 1 + contract 5.2 = 6.2 NEAR, not 17.7.
    check("resumed balance line shows the remaining 6.200 NEAR", els.balanceLine.textContent.indexOf("6.200") >= 0, els.balanceLine.textContent);
    check("resumed balance line says more to finish", els.balanceLine.textContent.indexOf("more to finish creating this group") >= 0, els.balanceLine.textContent);
    check("resumed balance line does not claim the full 17.700 NEAR", els.balanceLine.textContent.indexOf("17.700") < 0, els.balanceLine.textContent);
    check("resumed balance line does not ask for a top-up at 7.466 NEAR", els.balanceLine.textContent.indexOf("Top up") < 0, els.balanceLine.textContent);
    getEl(ctx, "continueBtn").innerHTML = "Continue creating";
    const p = ctx.dom.listeners["continueBtn:click"]();
    check("continue button is disabled synchronously on tap", els.continueBtn.disabled === true);
    check("continue button shows a spinner synchronously on tap", els.continueBtn.innerHTML.indexOf("spinner") >= 0, els.continueBtn.innerHTML);
    await p;
    await flush();
    check("continue ran the three remaining wallet calls", JSON.stringify(ctx.walletCalls.map((t) => t.actions[0].methodName)) === JSON.stringify(["register_group", "deploy_group_contract", "sync_dao_members"]), ctx.walletCalls.map((t) => t.actions[0].methodName).join(","));
    findRedirect(ctx).fn();
    check("continue redirect lands on the resumed group's page", ctx.locationStub.href === "https://fairshare-pi.vercel.app/group?id=test-group&invite=invite-abcdefgh", ctx.locationStub.href);
  }

  // --- Scenario 3: the group page shows the invite link ------------------
  {
    const chain = makeChain();
    const ctx = makeContext(chain, "20000000000000000000000000", ["groups-common.js", "group.js"]);
    vm.runInContext("GROUP = { group_id: \"football-fans\", name: \"Football fans\", template: \"friends\", creator: \"clearsite587.testnet\", dao_id: \"football-fans.sputnikv2.testnet\", contract_id: \"football-fans-fairshare.fairshare-registry.testnet\", invite_code: \"invite-gbzbcu4a\", badge_url: \"\" }; groupMembers = [\"clearsite587.testnet\"];", ctx.sandbox);
    await ctx.sandbox.refreshMembersPanel();
    check("group page shows the invite link text", ctx.dom.els.groupInviteLink.textContent === "https://fairshare-pi.vercel.app/group?id=football-fans&invite=invite-gbzbcu4a", ctx.dom.els.groupInviteLink.textContent);
  }

  // --- Scenario 4: a failed create re-enables the button -----------------
  {
    const chain = makeChain();
    const ctx = makeContext(chain, "1000000000000000000000000", ["groups-common.js", "create.js"]); // 1 NEAR: underfunded
    await fireLoaded(ctx);
    const els = ctx.dom.els;
    els.groupName.value = "Test Group";
    getEl(ctx, "groupTemplate").value = "friends";
    getEl(ctx, "groupEnvelope").value = "5";
    getEl(ctx, "groupTreasury").value = "10.5";
    getEl(ctx, "badgeUrl").value = "";
    getEl(ctx, "createBtn").innerHTML = "Create my group";
    const p = ctx.dom.listeners["createBtn:click"]();
    check("underfunded tap still spins first", els.createBtn.disabled === true && els.createBtn.innerHTML.indexOf("spinner") >= 0);
    await p;
    await flush();
    check("underfunded create reports the shortfall", els.createResult.textContent.indexOf("but need about 17.700 NEAR") >= 0, els.createResult.textContent);
    check("button is re-enabled after the failure", els.createBtn.disabled === false);
    check("button label is restored after the failure", els.createBtn.innerHTML === "Create my group", els.createBtn.innerHTML);
    check("no wallet call was made when underfunded", ctx.walletCalls.length === 0);
    check("no redirect is scheduled after the failure", !findRedirect(ctx));
  }

  // --- Scenario 5: group page load is one parallel scan, fast empty states
  {
    const chain = makeChain();
    const stats = { calls: [], inflight: 0, maxInflight: 0 };
    const ctx = makeContext(chain, "20000000000000000000000000", ["groups-common.js", "group.js"], {
      search: "?id=football-fans&invite=invite-gbzbcu4a",
      fetch: makeGroupFetch(stats),
    });
    await fireLoaded(ctx);
    await flush(40);
    const els = ctx.dom.els;
    const roundCalls = stats.calls.filter((c) => c === "get_round").length;
    check("group page scans get_round exactly 20 times in one load", roundCalls === 20, "get_round calls: " + roundCalls + " of " + stats.calls.length + " total");
    check("the scan issues its calls in parallel", stats.maxInflight >= 20, "max in flight: " + stats.maxInflight);
    check("rounds panel shows the empty state", (els.roundsList.innerHTML || "").indexOf("No rounds yet. A council member can propose the first one below.") >= 0, els.roundsList.innerHTML);
    check("governance panel shows the empty state", (els.govProposals.innerHTML || "").indexOf("No open proposals right now.") >= 0, els.govProposals.innerHTML);
    check("group page shows the invite link", els.groupInviteLink.textContent === "https://fairshare-pi.vercel.app/group?id=football-fans&invite=invite-gbzbcu4a", els.groupInviteLink.textContent);
  }

  if (failures > 0) { console.log(failures + " FAILURES"); process.exit(1); }
  console.log("create flow test: all passed");
})().catch((e) => { console.log("FAIL harness threw — " + (e && e.stack ? e.stack : e)); process.exit(1); });
