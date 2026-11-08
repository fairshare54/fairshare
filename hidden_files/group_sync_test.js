// Group sync test: the member-list sync button on the group page.
// The contract's member list is a synced mirror of the DAO council. After
// a join proposal passes, the new member is on the council but not in the
// contract list yet, so the page hides the details section (and its vote
// buttons) from them. The fix is a Sync members button: in the join panel
// when the wallet is on the council but not yet a contract member, and in
// the members panel whenever the council and the member list disagree.
// Run: node hidden_files/group_sync_test.js
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

const GROUP = {
  group_id: "browser-test", name: "Browser Test", template: "friends",
  creator: "carol-fairshare.testnet", dao_id: "browser-test.sputnikv2.testnet",
  contract_id: "browser-test-fairshare.fairshare-registry.testnet",
  invite_code: "invite-737hbrr4", badge_url: "",
};

function makeContext(members, council) {
  const els = {};
  const listeners = {};
  const walletCalls = [];
  function mkEl(id) {
    return {
      innerHTML: "", textContent: "", value: "", disabled: false,
      style: {}, dataset: {}, files: [], src: "", title: "",
      classList: { add() {}, remove() {} },
      querySelectorAll: () => [],
      getAttribute: () => null,
      addEventListener: (ev, fn) => { listeners[id + ":" + ev] = fn; },
    };
  }
  const fetchStub = (url, opts) => {
    const body = JSON.parse(opts.body);
    const p = body.params;
    const ok = (value) => ({ ok: true, json: async () => ({ result: { result: Array.from(new TextEncoder().encode(JSON.stringify(value))) } }) });
    let res;
    if (p.request_type === "view_account") {
      res = { ok: true, json: async () => ({ result: { amount: "10000000000000000000000000" } }) };
    } else {
      const args = JSON.parse(Buffer.from(p.args_base64, "base64").toString("utf8"));
      if (p.method_name === "get_group") res = ok(GROUP);
      else if (p.method_name === "get_members") res = ok(members);
      else if (p.method_name === "get_policy") res = ok({ roles: [{ name: "council", kind: { Group: council } }] });
      else if (p.method_name === "get_standing") res = ok(100);
      else res = { ok: true, json: async () => ({ error: { code: -32000, message: "not found" } }) };
    }
    return new Promise((resolve) => setImmediate(() => resolve(res)));
  };
  const fakeWallet = {
    restore: async () => null,
    connect: async () => ({ accountId: null }),
    disconnect: async () => {},
    accountId: () => null,
    sendTransaction: async (tx) => { walletCalls.push(tx); return {}; },
  };
  const sandbox = {
    console,
    TextEncoder, TextDecoder, URLSearchParams, AbortController,
    setTimeout, clearTimeout,
    crypto: { getRandomValues: (buf) => { require("crypto").randomFillSync(buf); return buf; } },
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
    location: { origin: "https://fairshare-pi.vercel.app", pathname: "/group", search: "?id=browser-test&invite=invite-737hbrr4", hash: "", href: "https://fairshare-pi.vercel.app/group?id=browser-test&invite=invite-737hbrr4" },
    history: { replaceState: () => {} },
    fetch: fetchStub,
  };
  sandbox.window = sandbox;
  sandbox.window.nearWallet = fakeWallet;
  sandbox.addEventListener = (ev, fn) => { listeners["window:" + ev] = fn; };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(EGBE + "/site/groups-common.js", "utf8"), sandbox, { filename: "groups-common.js" });
  vm.runInContext(fs.readFileSync(EGBE + "/site/group.js", "utf8"), sandbox, { filename: "group.js" });
  return { sandbox, els, listeners, walletCalls };
}

(async () => {
  // --- A: stuck member — on the council, not yet in the contract list ---
  {
    const ctx = makeContext(
      ["carol-fairshare.testnet", "bob-fairshare.testnet"],
      ["carol-fairshare.testnet", "bob-fairshare.testnet", "dave-fairshare.testnet"],
    );
    vm.runInContext("GROUP = " + JSON.stringify(GROUP) + "; GROUP_ID = \"browser-test\"; INVITE = \"invite-737hbrr4\"; walletAccountId = \"dave-fairshare.testnet\";", ctx.sandbox);
    ctx.sandbox.initGroupPage();
    await ctx.sandbox.refreshGroupPage();
    await flush(20);
    const els = ctx.els;
    check("stuck member: join panel is shown", els.joinPanel.style.display === "block");
    check("stuck member: sync panel is shown", els.syncPanel.style.display === "block");
    check("stuck member: join button is hidden", els.joinBtn.style.display === "none");
    check("stuck member: text says council and sync", (els.joinText.textContent || "").indexOf("council") >= 0 && (els.joinText.textContent || "").indexOf("Sync") >= 0, els.joinText.textContent);
    check("stuck member: details stay hidden", els.detailsSection.style.display === "none");
    // Clicking Sync members calls sync_dao_members on the group contract.
    await ctx.listeners["syncMembersBtn:click"]();
    await flush(20);
    check("sync click: one wallet call", ctx.walletCalls.length === 1, JSON.stringify(ctx.walletCalls));
    const tx = ctx.walletCalls[0] || {};
    check("sync click: receiver is the group contract", tx.receiverId === GROUP.contract_id, tx.receiverId);
    const action = (tx.actions || [])[0] || {};
    check("sync click: method is sync_dao_members", action.methodName === "sync_dao_members", action.methodName);
    check("sync click: no deposit attached", String(action.deposit) === "0", String(action.deposit));
    check("sync click: status says wallet opened", (els.syncMembersResult.textContent || "").indexOf("wallet") >= 0, els.syncMembersResult.textContent);
  }

  // --- B: stranger with the invite link — no sync panel, Join offered ---
  {
    const ctx = makeContext(
      ["carol-fairshare.testnet", "bob-fairshare.testnet", "dave-fairshare.testnet"],
      ["carol-fairshare.testnet", "bob-fairshare.testnet", "dave-fairshare.testnet"],
    );
    vm.runInContext("GROUP = " + JSON.stringify(GROUP) + "; GROUP_ID = \"browser-test\"; INVITE = \"invite-737hbrr4\"; walletAccountId = \"erin-fairshare.testnet\";", ctx.sandbox);
    ctx.sandbox.initGroupPage();
    await ctx.sandbox.refreshGroupPage();
    await flush(20);
    const els = ctx.els;
    check("stranger: sync panel stays hidden", els.syncPanel.style.display === "none");
    check("stranger: join button is offered", els.joinBtn.style.display === "inline-block");
    check("stranger: no wallet call was made", ctx.walletCalls.length === 0);
  }

  // --- C: member view, council and member list disagree ---
  {
    const ctx = makeContext([], []);
    vm.runInContext("GROUP = " + JSON.stringify(GROUP) + "; groupMembers = [\"carol-fairshare.testnet\", \"bob-fairshare.testnet\", \"dave-fairshare.testnet\"]; groupCouncil = [\"carol-fairshare.testnet\", \"bob-fairshare.testnet\", \"dave-fairshare.testnet\", \"alice-fairshare.testnet\"]; walletAccountId = \"carol-fairshare.testnet\";", ctx.sandbox);
    ctx.sandbox.initGroupPage();
    await ctx.sandbox.refreshMembersPanel();
    await flush(20);
    const els = ctx.els;
    check("members panel: sync panel shown when lists disagree", els.membersSyncPanel.style.display === "block");
    check("members panel: text names the counts", (els.membersSyncText.textContent || "").indexOf("4") >= 0 && (els.membersSyncText.textContent || "").indexOf("3") >= 0, els.membersSyncText.textContent);
    await ctx.listeners["syncMembersBtn2:click"]();
    await flush(20);
    const tx = ctx.walletCalls[0] || {};
    check("members sync click: calls sync_dao_members", ((tx.actions || [])[0] || {}).methodName === "sync_dao_members", JSON.stringify(ctx.walletCalls));
  }

  // --- D: member view, lists agree — no sync panel ---
  {
    const ctx = makeContext([], []);
    vm.runInContext("GROUP = " + JSON.stringify(GROUP) + "; groupMembers = [\"carol-fairshare.testnet\", \"bob-fairshare.testnet\", \"dave-fairshare.testnet\", \"alice-fairshare.testnet\"]; groupCouncil = [\"carol-fairshare.testnet\", \"bob-fairshare.testnet\", \"dave-fairshare.testnet\", \"alice-fairshare.testnet\"]; walletAccountId = \"carol-fairshare.testnet\";", ctx.sandbox);
    ctx.sandbox.initGroupPage();
    await ctx.sandbox.refreshMembersPanel();
    await flush(20);
    check("members panel: sync panel hidden when lists agree", ctx.els.membersSyncPanel.style.display === "none");
    check("members panel: no wallet call was made", ctx.walletCalls.length === 0);
  }

  if (failures > 0) { console.log(failures + " FAILURES"); process.exit(1); }
  console.log("group sync test: all passed");
})().catch((e) => { console.log("FAIL harness threw — " + (e && e.stack ? e.stack : e)); process.exit(1); });
