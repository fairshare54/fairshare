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
