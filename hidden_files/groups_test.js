// Groups test: the pure helpers behind the self-serve group pages, plus a
// structural check that every element id create.js and group.js look up
// actually exists in create.html and group.html. Run: node hidden_files/groups_test.js
const fs = require("fs");
const gc = require("/home/hatch/workspace/egbe/site/groups-common.js");

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + " " + name + (detail !== undefined ? " — " + detail : ""));
  if (!ok) failures++;
}

// 1. slugify: group names become DAO slugs the registry accepts.
check("slugify Market Traders", gc.slugify("Market Traders") === "market-traders", gc.slugify("Market Traders"));
check("slugify strips punctuation", gc.slugify("Chidi's Group!") === "chidi-s-group", gc.slugify("Chidi's Group!"));
check("slugify collapses spaces and hyphens", gc.slugify("  Co-op  2026 ") === "co-op-2026", gc.slugify("  Co-op  2026 "));
check("slugify drops non-ascii", gc.slugify("café traders") === "caf-traders", gc.slugify("café traders"));
check("slugify empty stays empty", gc.slugify("!!!") === "", JSON.stringify(gc.slugify("!!!")));

// 2. Invite codes: "invite-" plus 8 unambiguous characters, 15 total,
// inside the registry's 8-32 [A-Za-z0-9-] rule, random.
const code1 = gc.randomInviteCode();
const code2 = gc.randomInviteCode();
check("invite code is 15 chars", code1.length === 15, code1);
check("invite code starts invite-", code1.startsWith("invite-"), code1);
check("invite code uses only letters, digits and hyphen", /^invite-[a-z0-9]{8}$/.test(code1), code1);
check("invite codes differ", code1 !== code2, code1 + " vs " + code2);

// 3. fmtYocto: the amounts the create page shows.
check("fmtYocto 5 NEAR", gc.fmtYocto(5000000000000000000000000n) === "5.000", gc.fmtYocto(5000000000000000000000000n));
check("fmtYocto 1.25 NEAR", gc.fmtYocto(1250000000000000000000000n) === "1.250", gc.fmtYocto(1250000000000000000000000n));
check("fmtYocto 0.5 NEAR", gc.fmtYocto(500000000000000000000000n) === "0.500", gc.fmtYocto(500000000000000000000000n));
check("fmtYocto dust", gc.fmtYocto(1n) === "0.000", gc.fmtYocto(1n));
check("fmtYocto 10.5 NEAR", gc.fmtYocto(10500000000000000000000000n) === "10.500", gc.fmtYocto(10500000000000000000000000n));

// 4. Constants: the live testnet ids and the costs the create page states.
check("factory id", gc.FACTORY_ID === "sputnikv2.testnet", gc.FACTORY_ID);
check("registry id", gc.REGISTRY_ID === "fairshare-registry.testnet", gc.REGISTRY_ID);
check("main contract id", gc.MAIN_CONTRACT_ID === "fairshare-contract.testnet", gc.MAIN_CONTRACT_ID);
check("DAO deposit 10.5 NEAR", gc.GROUP_DAO_DEPOSIT_NEAR === 10.5);
check("contract fund 5.2 NEAR", gc.GROUP_CONTRACT_FUND_NEAR === 5.2);
check("register deposit 1 NEAR", gc.REGISTER_DEPOSIT_YOCTO === "1000000000000000000000000", gc.REGISTER_DEPOSIT_YOCTO);
check("DAO bond 1 NEAR", gc.DAO_BOND_YOCTO === "1000000000000000000000000", gc.DAO_BOND_YOCTO);
check("default create cost is 17.7 NEAR", gc.GROUP_DAO_DEPOSIT_NEAR + gc.GROUP_CONTRACT_FUND_NEAR + 2 === 17.7);
check("templates are the four named plus other", gc.TEMPLATES.map((t) => t.id).join(",") === "market-traders,grant-team,cooperative,friends,other", gc.TEMPLATES.map((t) => t.id).join(","));

// 4b. b64Utf8: the create page base64-encodes the DAO args, whose purpose
// carries an em dash. Plain btoa throws on any character above Latin-1,
// which blocked every group creation on the phone (2026-11-08). The helper
// must encode and round-trip any Unicode text, including a non-ASCII name.
function b64RoundTrip(s) { return Buffer.from(gc.b64Utf8(s), "base64").toString("utf8") === s; }
const daoArgsJson = JSON.stringify({ config: { name: "test-group", purpose: "Test Group — a self-serve FairShare group", metadata: "" }, policy: ["clearsite587.testnet"] });
check("b64Utf8 encodes the DAO args with the em dash", b64RoundTrip(daoArgsJson));
check("b64Utf8 handles a non-ASCII group name", b64RoundTrip(JSON.stringify({ config: { name: "café", purpose: "Café Traders — a self-serve FairShare group", metadata: "" }, policy: ["a.testnet"] })));
check("b64Utf8 matches btoa on plain ASCII", gc.b64Utf8("hello") === btoa("hello"));
check("create.js uses b64Utf8 for the DAO args", fs.readFileSync("/home/hatch/workspace/egbe/site/create.js", "utf8").includes("b64Utf8(JSON.stringify(daoArgs))"));
check("no bare btoa(JSON call left in the group pages", !/btoa\(JSON\.stringify/.test(fs.readFileSync("/home/hatch/workspace/egbe/site/groups-common.js", "utf8")) && !/btoa\(JSON\.stringify/.test(fs.readFileSync("/home/hatch/workspace/egbe/site/create.js", "utf8")) && !/btoa\(JSON\.stringify/.test(fs.readFileSync("/home/hatch/workspace/egbe/site/group.js", "utf8")));

// 4c. The registry deploys the contract (Meteor blocks the old browser
// flow's full-access key grant, 2026-11-08). The contract id is now a
// subaccount of the registry, the flow is dao -> register -> deploy ->
// sync, and no browser key exists anywhere in the group pages.
const createJs = fs.readFileSync("/home/hatch/workspace/egbe/site/create.js", "utf8");
const groupJs = fs.readFileSync("/home/hatch/workspace/egbe/site/group.js", "utf8");
const commonJs = fs.readFileSync("/home/hatch/workspace/egbe/site/groups-common.js", "utf8");
const createHtml = fs.readFileSync("/home/hatch/workspace/egbe/site/create.html", "utf8");
check("contract id is a registry subaccount", createJs.includes('function contractIdFor(slug) { return slug + "-fairshare." + REGISTRY_ID; }'), createJs.match(/function contractIdFor[^\n]*/)?.[0]);
check("create flow order is dao, register, contract, sync", JSON.stringify([...createJs.matchAll(/\{ id: "(\w+)", label/g)].map((m) => m[1])) === JSON.stringify(["dao", "register", "contract", "sync"]));
check("deploy goes through the registry", createJs.includes('walletCall(REGISTRY_ID, "deploy_group_contract", { group_id: s.slug }'));
check("no AddKey anywhere in the group pages", !/AddKey/.test(createJs) && !/AddKey/.test(groupJs) && !/AddKey/.test(commonJs));
check("no FullAccess anywhere in the group pages", !/FullAccess/.test(createJs) && !/FullAccess/.test(groupJs) && !/FullAccess/.test(commonJs));
check("no browser contract key in create.js", !/contractKey|GROUP_KEY_PREFIX/.test(createJs));
check("no browser deploy helpers left", !/fetchContractCodeBase64|walletTx/.test(createJs) && !/fetchContractCodeBase64|walletTx/.test(commonJs));
check("done panel shows the contract id, not a key", createHtml.includes('id="doneContractId"') && !/doneContractKey/.test(createHtml) && !/doneContractKey/.test(createJs));
// 4d. Layout: "How it works" sits at the top of the create page, right
// under the hero and before the costs panel and the form; the progress
// panel stays after the form (it was never moved).
const howAt = createHtml.indexOf("How it works, in three steps");
const costsAt = createHtml.indexOf('id="costsPanel"');
const formAt = createHtml.indexOf('id="formPanel"');
const progressAt = createHtml.indexOf('id="progressPanel"');
check("how-it-works is before the costs panel", howAt >= 0 && howAt < costsAt, "how at " + howAt + ", costs at " + costsAt);
check("how-it-works is before the form", howAt < formAt);
check("how-it-works is not inside the form panel", createHtml.slice(formAt, createHtml.indexOf("</section>", formAt)).indexOf("How it works, in three steps") < 0);
check("progress panel stays after the form", progressAt > formAt, "form at " + formAt + ", progress at " + progressAt);
check("how-it-works lists the new step order", createHtml.includes("your DAO is created, the group is listed in the directory, your group's contract is deployed, and your membership is synced"));

// 4e. Create flow UX (Isaiah's 2026-11-08 phone observations): the tap
// must show a spinner before the wallet opens, the page must take the
// creator to their group when done, and the balance warning must only
// claim what finishing still costs.
check("create page has a CSS spinner", /\.spinner\s*\{/.test(createHtml) && /@keyframes spin/.test(createHtml));
check("setBusy disables the button and inserts a spinner", /function setBusy\(btn, busy, label\)/.test(createJs) && createJs.includes('btn.innerHTML = "<span class=\\"spinner\\"'));
check("submitCreate spins synchronously before any await", (() => {
  const body = createJs.slice(createJs.indexOf("async function submitCreate()"), createJs.indexOf("async function submitCreateInner"));
  const code = body.replace(/\/\/[^\n]*/g, ""); // comments may mention await
  const spinAt = code.indexOf('setBusy(btn, true, "Creating…")');
  return spinAt >= 0 && code.slice(0, spinAt).indexOf("await") < 0;
})());
check("continue handler spins synchronously", createJs.includes('setBusy(cont, true, "Continuing…")'));
check("buttons are restored unless the redirect is pending", createJs.includes("if (!redirectPending) setBusy(btn, false)") && createJs.includes("if (!redirectPending) setBusy(cont, false)"));
check("showDone redirects to the group's page", createJs.includes('window.location.href = "/group?id=" + encodeURIComponent(s.slug) + "&invite=" + encodeURIComponent(s.inviteCode)'));
check("all-done progress also shows the done panel", /if \(allDone\) showDone\(\);/.test(createJs));
check("remaining cost only counts unfinished steps", createJs.includes("async function remainingNeedYocto()") && createJs.includes('if (!(await stepDone("dao"))) need += createState.treasury') && createJs.includes('if (!(await stepDone("register"))) need += 1') && createJs.includes('if (!(await stepDone("contract"))) need += GROUP_CONTRACT_FUND_NEAR'));
check("balance line and gate use the remaining cost", createJs.includes("const need = await remainingNeedYocto()") && createJs.includes("more to finish creating this group"));
check("group page shows the invite link text", groupJs.includes('el("groupInviteLink")') && groupJs.includes('inviteEl.textContent = window.location.origin + "/group?id="') && fs.readFileSync("/home/hatch/workspace/egbe/site/group.html", "utf8").includes('id="groupInviteLink"'));

// 4f. Group page speed (Isaiah 2026-11-08: Rounds and Governance stuck on
// "Reading..."): one parallel scan shared by every panel, and every RPC
// fetch times out so a stalled endpoint fails over.
check("shared RPC fetch has a 10s AbortController timeout", commonJs.includes("const RPC_TIMEOUT_MS = 10000") && commonJs.includes("new AbortController()") && commonJs.includes("async function fetchWithTimeout"));
check("both shared RPC readers use the timeout fetch", (() => {
  const view = commonJs.slice(commonJs.indexOf("async function rpcViewCall"), commonJs.indexOf("async function rpcAccountBalance"));
  const bal = commonJs.slice(commonJs.indexOf("async function rpcAccountBalance"));
  return view.includes("fetchWithTimeout(url") && bal.includes("fetchWithTimeout(url") && !view.includes("await fetch(url") && !bal.includes("await fetch(url");
})());
check("group page has one cached parallel round scan", groupJs.includes("let groupRoundsCache = null") && groupJs.includes("await Promise.all(ids.map(async (id) =>") && groupJs.includes('rpcViewCall(GROUP.contract_id, "get_round", { round_id: id })'));
check("no sequential per-id round loops left in group.js", !/for \(let id = 1; id <= 20/.test(groupJs) && !/for \(let id = 20; id >= 1/.test(groupJs));
check("open-round and next-id read the shared scan", /async function findGroupOpenRound\(\) \{ return findGroupOpenRoundFrom\(await scanGroupRounds\(\)\); \}/.test(groupJs) && /async function nextGroupRoundId\(\) \{ return nextGroupRoundIdFrom\(await scanGroupRounds\(\)\); \}/.test(groupJs));
check("rounds panel reads the shared scan and parallelises details", groupJs.includes("const rounds = await scanGroupRounds();") && groupJs.includes("const details = await Promise.all(rounds.map(async (r) =>"));
check("group setup reads go out together", groupJs.includes("const [contractExists, members, policy] = await Promise.all([") && groupJs.includes('rpcViewCall(GROUP.contract_id, "get_members", {}).catch(() => [])') && groupJs.includes('rpcViewCall(GROUP.dao_id, "get_policy", {}).catch(() => null)'));
check("member standings are read in parallel", groupJs.includes("const standings = await Promise.all(groupMembers.map(async (m) =>"));
check("rounds empty state kept", groupJs.includes("No rounds yet. A council member can propose the first one below."));
check("governance empty state kept", groupJs.includes("No open proposals right now."));

// 4g. Homepage directory (Isaiah 2026-11-08: Football fans was only
// reachable through its invite link): every group listed, with "My DAO
// group" first for the connected wallet.
const appJs = fs.readFileSync("/home/hatch/workspace/egbe/site/app.js", "utf8");
const indexHtml = fs.readFileSync("/home/hatch/workspace/egbe/site/index.html", "utf8");
check("home page has the groups section", indexHtml.includes('id="groupsPanel"') && indexHtml.includes('id="groupsNote"') && indexHtml.includes('id="allGroups"'));
check("my-groups section is headed My DAO group", indexHtml.includes("<h3>My DAO group</h3>") && indexHtml.includes('id="myGroupWrap"') && indexHtml.includes('id="myGroup"'));
check("home page loads the new app.js", indexHtml.includes('src="app.js?v=10"'));
check("directory reads list_groups once from the registry", appJs.includes('rpcViewCall(REGISTRY_ID, "list_groups", { from_index: 0, limit: 100 })') && appJs.includes("let groupsDirectoryCache = null"));
check("membership counts the contract set and the DAO council", appJs.includes('rpcViewCall(g.contract_id, "get_members", {})') && appJs.includes('rpcViewCall(g.dao_id, "get_policy", {})') && appJs.includes('council.kind.Group'));
check("membership checks run in parallel", appJs.includes("await Promise.all(groups.map((g) => groupRoleFor(g, walletAccountId)))"));
check("directory links carry id and invite", appJs.includes('"/group?id=" + encodeURIComponent(g.group_id) + "&invite=" + encodeURIComponent(g.invite_code)'));
check("directory shows the no-groups state", appJs.includes("No groups yet. Be the first to start one."));
check("directory asks the unconnected to connect", appJs.includes("Connect your wallet above to see which groups are yours."));
check("directory re-renders on wallet connect and disconnect", appJs.includes("refreshGroupsDirectory();"));
check("home page RPC reads time out too", appJs.includes("const RPC_TIMEOUT_MS = 10000") && appJs.includes("new AbortController()") && (appJs.match(/await fetchWithTimeout\(url/g) || []).length === 2);

// 5. Structural check: every id the page scripts look up exists in the HTML.
function idsIn(html) {
  return new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
}
function checkIds(htmlPath, jsPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const js = fs.readFileSync(jsPath, "utf8");
  const ids = idsIn(html);
  const used = [...new Set([...js.matchAll(/el\("([^"]+)"\)/g)].map((m) => m[1]))];
  // Ids the allocate form builds at runtime via innerHTML (refreshAllocForm):
  // they are not in the static HTML, so check the page script contains them.
  const dynamic = new Set(["groupTotal", "groupChangeAlloc", "groupAllocEdit", "groupAllocDone", "groupAddRow", "groupSubmit"]);
  for (const id of used) {
    if (dynamic.has(id)) {
      // The template strings in group.js carry escaped quotes (id=\"...\").
      check(jsPath.split("/").pop() + " builds #" + id + " at runtime", js.includes('id=\\"' + id + '\\"'));
    } else {
      check(jsPath.split("/").pop() + " finds #" + id + " in " + htmlPath.split("/").pop(), ids.has(id));
    }
  }
}
checkIds("/home/hatch/workspace/egbe/site/create.html", "/home/hatch/workspace/egbe/site/create.js");
checkIds("/home/hatch/workspace/egbe/site/group.html", "/home/hatch/workspace/egbe/site/group.js");

// 6. The rewrites cover the new routes.
const vercel = JSON.parse(fs.readFileSync("/home/hatch/workspace/egbe/vercel.json", "utf8"));
for (const src of ["/create", "/group", "/create.js", "/group.js", "/groups-common.js", "/near-api-js.bundle.js"]) {
  check("vercel rewrite " + src, vercel.rewrites.some((r) => r.source === src), vercel.rewrites.map((r) => r.source).join(","));
}
// 7. The home page links to the create page from the hero and the nav.
const home = fs.readFileSync("/home/hatch/workspace/egbe/site/index.html", "utf8");
check("home hero links /create", home.includes('href="/create">Create your DAO</a>'));
check("home nav links /create", home.includes('href="/create">Create your DAO</a>'));
for (const page of ["rounds.html", "how.html", "lab.html"]) {
  const h = fs.readFileSync("/home/hatch/workspace/egbe/site/" + page, "utf8");
  check(page + " nav links /create", h.includes('href="/create">Create your DAO</a>'));
}

if (failures > 0) { console.log(failures + " FAILURES"); process.exit(1); }
console.log("groups test: all passed");
