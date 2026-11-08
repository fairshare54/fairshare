// Home directory test: the Groups section on the homepage, driven through
// the real app.js with a stubbed DOM and RPC. The registry holds three
// groups; the connected wallet (clearsite587.testnet, Isaiah's) created
// Football fans, is on prove-group-2's DAO council but not in its
// contract member set yet (DAO list is the source of truth), and is in
// neither list for prove-group.
// Run: node hidden_files/home_directory_test.js
const fs = require("fs");
const vm = require("vm");

const EGBE = "/home/hatch/workspace/egbe";
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + " " + name + (detail !== undefined ? " — " + detail : ""));
  if (!ok) failures++;
}
const tick = () => new Promise((r) => setImmediate(r));
async function flush(n) { for (let i = 0; i < (n || 10); i++) await tick(); }

const GROUPS = [
  { group_id: "prove-group", name: "Prove Group", template: "cooperative", creator: "prove-creator.testnet", dao_id: "prove-group.sputnikv2.testnet", contract_id: "prove-group-fairshare.prove-creator.testnet", invite_code: "prove-abc123", badge_url: "" },
  { group_id: "prove-group-2", name: "Prove Group Two", template: "cooperative", creator: "prove-creator-2.testnet", dao_id: "prove-group-2.sputnikv2.testnet", contract_id: "prove-group-2-fairshare.fairshare-registry.testnet", invite_code: "prove-xyz789", badge_url: "" },
  { group_id: "football-fans", name: "Football fans", template: "friends", creator: "clearsite587.testnet", dao_id: "football-fans.sputnikv2.testnet", contract_id: "football-fans-fairshare.fairshare-registry.testnet", invite_code: "invite-gbzbcu4a", badge_url: "" },
];
const MEMBERS = {
  "prove-group-fairshare.prove-creator.testnet": ["prove-creator.testnet", "bob-fairshare.testnet", "carol-fairshare.testnet", "dave-fairshare.testnet"],
  "prove-group-2-fairshare.fairshare-registry.testnet": ["prove-creator-2.testnet", "bob-fairshare.testnet", "carol-fairshare.testnet", "dave-fairshare.testnet"],
  "football-fans-fairshare.fairshare-registry.testnet": ["clearsite587.testnet"],
};
const COUNCILS = {
  "prove-group.sputnikv2.testnet": ["prove-creator.testnet", "bob-fairshare.testnet", "carol-fairshare.testnet", "dave-fairshare.testnet"],
  "prove-group-2.sputnikv2.testnet": ["prove-creator-2.testnet", "bob-fairshare.testnet", "carol-fairshare.testnet", "dave-fairshare.testnet", "clearsite587.testnet"],
  "football-fans.sputnikv2.testnet": ["clearsite587.testnet"],
};

function makeContext(groups) {
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
  const stats = { calls: [], inflight: 0, maxInflight: 0 };
  const fetchStub = (url, opts) => {
    const body = JSON.parse(opts.body);
    const p = body.params;
    stats.calls.push(p.method_name || p.request_type);
    stats.inflight++;
    stats.maxInflight = Math.max(stats.maxInflight, stats.inflight);
    const ok = (value) => ({ ok: true, json: async () => ({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } }) });
    let res;
    if (p.request_type === "view_account") {
      res = { ok: true, json: async () => ({ result: { amount: "10000000000000000000000000" } }) };
    } else {
      const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString("utf8"));
      if (p.method_name === "list_groups") res = ok(groups);
      else if (p.method_name === "get_members") res = ok(MEMBERS[p.account_id] || []);
      else if (p.method_name === "get_policy") res = ok({ roles: [{ name: "council", kind: { Group: COUNCILS[p.account_id] || [] } }] });
      else res = { ok: true, json: async () => ({ error: { code: -32000, message: "not found" } }) };
    }
    return new Promise((resolve) => setImmediate(() => { stats.inflight--; resolve(res); }));
  };
  const sandbox = {
    console,
    TextEncoder, TextDecoder, URLSearchParams, AbortController,
    setTimeout, clearTimeout,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    document: {
      title: "",
      getElementById: (id) => els[id] || (els[id] = mkEl(id)),
      addEventListener: (ev, fn) => { listeners["document:" + ev] = fn; },
      createElement: () => ({ getContext: () => null, toDataURL: () => "" }),
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, get length() { return 0; } },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, get length() { return 0; } },
    navigator: { clipboard: { writeText: async () => {} } },
    location: { origin: "https://fairshare-pi.vercel.app", pathname: "/", search: "", hash: "", href: "https://fairshare-pi.vercel.app/" },
    history: { replaceState: () => {} },
    fetch: fetchStub,
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (ev, fn) => { listeners["window:" + ev] = fn; };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(EGBE + "/site/app.js", "utf8"), sandbox, { filename: "app.js" });
  return { sandbox, els, stats };
}

(async () => {
  // --- Connected as clearsite587.testnet --------------------------------
  {
    const ctx = makeContext(GROUPS);
    vm.runInContext("walletAccountId = \"clearsite587.testnet\";", ctx.sandbox);
    await ctx.sandbox.refreshGroupsDirectory();
    await flush(20);
    const els = ctx.els;
    check("list_groups is called once", ctx.stats.calls.filter((c) => c === "list_groups").length === 1, ctx.stats.calls.join(","));
    check("my DAO group shows Football fans as Creator", (els.myGroup.innerHTML || "").indexOf("Football fans") >= 0 && (els.myGroup.innerHTML || "").indexOf("Creator") >= 0, els.myGroup.innerHTML);
    check("my DAO group shows prove-group-2 as Member via the DAO council", (els.myGroup.innerHTML || "").indexOf("Prove Group Two") >= 0 && (els.myGroup.innerHTML || "").indexOf("Member") >= 0, els.myGroup.innerHTML);
    check("my DAO group does not list prove-group", (els.myGroup.innerHTML || "").indexOf("Prove Group</a>") < 0 && (els.myGroup.innerHTML || "").indexOf("prove-group</a>") < 0, els.myGroup.innerHTML);
    check("my DAO group section is shown", els.myGroupWrap.style.display === "block");
    check("all groups lists all three", ["Prove Group", "Prove Group Two", "Football fans"].every((n) => (els.allGroups.innerHTML || "").indexOf(n) >= 0), els.allGroups.innerHTML);
    check("all groups links carry id and invite", (els.allGroups.innerHTML || "").indexOf("/group?id=football-fans&amp;invite=invite-gbzbcu4a") >= 0 || (els.allGroups.innerHTML || "").indexOf("/group?id=football-fans&invite=invite-gbzbcu4a") >= 0, els.allGroups.innerHTML);
    check("membership checks run in parallel", ctx.stats.maxInflight >= 4, "max in flight: " + ctx.stats.maxInflight);
    check("note says your groups are listed first", (els.groupsNote.textContent || "").indexOf("My DAO group") >= 0, els.groupsNote.textContent);
    // A second render reuses the cached list: no second list_groups call.
    const before = ctx.stats.calls.filter((c) => c === "list_groups").length;
    await ctx.sandbox.refreshGroupsDirectory();
    await flush(20);
    check("second render reuses the cached list", ctx.stats.calls.filter((c) => c === "list_groups").length === before);
  }

  // --- No wallet connected ----------------------------------------------
  {
    const ctx = makeContext(GROUPS);
    await ctx.sandbox.refreshGroupsDirectory();
    await flush(20);
    const els = ctx.els;
    check("no wallet: all three groups still listed", ["Prove Group", "Prove Group Two", "Football fans"].every((n) => (els.allGroups.innerHTML || "").indexOf(n) >= 0));
    check("no wallet: my DAO group section stays hidden", els.myGroupWrap.style.display === "none");
    check("no wallet: note asks to connect", (els.groupsNote.textContent || "").indexOf("Connect your wallet above to see which groups are yours.") >= 0, els.groupsNote.textContent);
    check("no wallet: no membership calls are made", ctx.stats.calls.filter((c) => c === "get_members" || c === "get_policy").length === 0, ctx.stats.calls.join(","));
  }

  // --- Empty registry -----------------------------------------------------
  {
    const ctx = makeContext([]);
    await ctx.sandbox.refreshGroupsDirectory();
    await flush(20);
    check("empty registry shows the no-groups state", (ctx.els.groupsNote.textContent || "").indexOf("No groups yet. Be the first to start one.") >= 0, ctx.els.groupsNote.textContent);
    check("empty registry lists nothing", (ctx.els.allGroups.innerHTML || "") === "");
  }

  if (failures > 0) { console.log(failures + " FAILURES"); process.exit(1); }
  console.log("home directory test: all passed");
})().catch((e) => { console.log("FAIL harness threw — " + (e && e.stack ? e.stack : e)); process.exit(1); });
