// Shared helpers for the self-serve group pages (create.html, group.html).
// Same patterns as the main site's app.js: the @fastnear/wallet 2.5.0
// bundle for signing, the RPC fallback helper for reads, the PAC-style
// one-button wallet toggle. Testnet only. Loaded before create.js /
// group.js; those pages call initGroupsWallet() and set
// window.fairshareWalletChanged to refresh their own panels.
const NETWORK = "testnet";
const FACTORY_ID = "sputnikv2.testnet";
const REGISTRY_ID = "fairshare-registry.testnet";
const MAIN_CONTRACT_ID = "fairshare-contract.testnet";
const YOCTO_PER_NEAR = 10n ** 24n;
const WALLET_GAS_100 = "100000000000000";
const WALLET_GAS_150 = "150000000000000";
const DAO_BOND_YOCTO = "1000000000000000000000000"; // 1 NEAR proposal bond
// Creating a group, as the create page states plainly: the DAO deposit
// (treasury) and the contract funding (storage-locked in the group's
// contract account). The register call attaches 1 NEAR, mostly refunded.
const GROUP_DAO_DEPOSIT_NEAR = 10.5;
const GROUP_CONTRACT_FUND_NEAR = 5.2;
const REGISTER_DEPOSIT_YOCTO = "1000000000000000000000000"; // 1 NEAR, mostly refunded

const TEMPLATES = [
  { id: "market-traders", label: "Market traders" },
  { id: "grant-team", label: "Team splitting a grant" },
  { id: "cooperative", label: "Cooperative" },
  { id: "friends", label: "Friends sharing costs" },
  { id: "other", label: "Something else" },
];

const RPC_ENDPOINTS = ["https://rpc.testnet.near.org", "https://rpc.testnet.fastnear.com"];

function el(id) { return document.getElementById(id); }
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
// btoa only handles Latin-1, so any string with a character above U+00FF
// (for example the em dash in a DAO purpose, or a non-ASCII group name)
// makes it throw "Failed to execute 'btoa' on 'Window'". Encode to UTF-8
// bytes first, then base64 the binary string. Safe for any Unicode text.
function b64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function fmtYocto(yocto) {
  const whole = yocto / YOCTO_PER_NEAR;
  const frac = Number((yocto % YOCTO_PER_NEAR) * 1000n / YOCTO_PER_NEAR);
  return whole.toString() + "." + String(frac).padStart(3, "0");
}
function pageStatus(msg) {
  const s = el("pageStatus");
  if (s) s.textContent = msg;
}

async function rpcViewCall(accountId, method, args) {
  let lastErr = null;
  for (const url of RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: method, method: "query",
          params: {
            request_type: "call_function",
            account_id: accountId,
            method_name: method,
            args_base64: b64Utf8(JSON.stringify(args)),
            finality: "final",
          },
        }),
      });
      if (!res.ok) throw new Error("RPC HTTP " + res.status);
      const d = await res.json();
      if (d.error) throw new Error("RPC error");
      return JSON.parse(new TextDecoder().decode(new Uint8Array(d.result.result)));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("RPC read failed");
}

async function rpcAccountBalance(accountId) {
  for (const url of RPC_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: "view_account", method: "query",
          params: { request_type: "view_account", account_id: accountId, finality: "final" },
        }),
      });
      if (!res.ok) throw new Error("RPC HTTP " + res.status);
      const d = await res.json();
      if (d.error) throw new Error("RPC error");
      return BigInt(d.result.amount);
    } catch (e) { /* try the next endpoint */ }
  }
  throw new Error("RPC read failed");
}

async function accountExists(accountId) {
  try { await rpcAccountBalance(accountId); return true; } catch (_) { return false; }
}

// ---- Wallet connect (FastNEAR wallet 2.5.0, same as the main site) ----
let walletAccountId = null;
function fastnear() {
  if (typeof window.nearWallet === "undefined") {
    throw new Error("FastNear wallet library not loaded. Check the script tag.");
  }
  return window.nearWallet;
}
function currentAccountId(nw) {
  try {
    const id = nw.accountId({ network: NETWORK });
    return typeof id === "string" && id ? id : null;
  } catch (_) {
    return null;
  }
}
function walletChanged() {
  if (typeof window.fairshareWalletChanged === "function") {
    window.fairshareWalletChanged();
  }
}
async function initGroupsWallet() {
  if (typeof window === "undefined") return;
  let skipRestore = false;
  try { skipRestore = localStorage.getItem("fairshare-wallet-disconnected") === "1" || sessionStorage.getItem("fairshare-wallet-disconnected") === "1"; } catch (_) { /* storage unavailable */ }
  if (!skipRestore) {
    try {
      const nw = fastnear();
      const restored = await nw.restore({ network: NETWORK });
      const id = (restored && typeof restored.accountId === "string" && restored.accountId) || currentAccountId(nw);
      if (id) walletAccountId = id;
    } catch (e) { console.warn("wallet restore failed", e); }
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("transactionHashes")) {
      const hashes = params.get("transactionHashes").split(",");
      pageStatus("Transaction " + hashes[0] + " is onchain; check it on Nearblocks.");
      window.history.replaceState({}, "", window.location.pathname + window.location.search + window.location.hash);
    }
  } catch (_) { /* ignore */ }
  refreshWalletBtn();
  walletChanged();
}
function refreshWalletBtn() {
  const btn = el("connectBtn");
  if (!btn) return;
  let libOk = true;
  try { fastnear(); } catch (_) { libOk = false; }
  if (!libOk) { btn.textContent = "Wallet unavailable"; btn.disabled = true; return; }
  const id = walletAccountId;
  btn.textContent = id ? id + " (sign out)" : "Connect wallet";
  if (btn.title !== undefined) btn.title = id ? "Tap to sign out" : "";
  btn.disabled = false;
}
async function disconnectWallet() {
  try { localStorage.setItem("fairshare-wallet-disconnected", "1"); } catch (_) { /* storage unavailable */ }
  try { sessionStorage.setItem("fairshare-wallet-disconnected", "1"); } catch (_) { /* storage unavailable */ }
  try {
    const nw = fastnear();
    try { await nw.disconnect({ network: NETWORK }); } catch (_) { /* wallet already signed out */ }
    try {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.indexOf("selected-wallet") >= 0 || k.indexOf("signedAccountId") >= 0 || k.indexOf("near-wallet") >= 0 || k.indexOf("fastnear") >= 0)) drop.push(k);
      }
      drop.forEach((k) => { try { localStorage.removeItem(k); } catch (_) {} });
    } catch (_) { /* storage unavailable */ }
    let stillConnected = false;
    try {
      const still = nw.accountId({ network: NETWORK });
      if (still) stillConnected = true;
    } catch (_) { /* accountId unavailable, session is clear */ }
    pageStatus(stillConnected ? "Disconnect did not take. Tap sign out again." : "Signed out.");
  } catch (_) { /* library missing, clear local state anyway */ }
  walletAccountId = null;
  refreshWalletBtn();
  walletChanged();
}
async function toggleWallet() {
  let nw;
  try { nw = fastnear(); } catch (_) { pageStatus("Wallet library did not load. Check your connection and reload."); return; }
  if (walletAccountId) { await disconnectWallet(); return; }
  try { localStorage.removeItem("fairshare-wallet-disconnected"); } catch (_) { /* storage unavailable */ }
  try { sessionStorage.removeItem("fairshare-wallet-disconnected"); } catch (_) { /* storage unavailable */ }
  try {
    pageStatus("Opening wallet selector…");
    const result = await nw.connect({ network: NETWORK });
    const id = (result && typeof result.accountId === "string" && result.accountId) || currentAccountId(nw);
    if (typeof id !== "string" || !id) { pageStatus("Could not determine the connected account. Try again."); return; }
    walletAccountId = id;
    refreshWalletBtn();
    walletChanged();
  } catch (e) { pageStatus("Wallet error: " + String(e.message).slice(0, 160)); }
}
async function walletCall(contractId, method, args, depositYocto, gas) {
  const nw = fastnear();
  return nw.sendTransaction({
    receiverId: contractId,
    network: NETWORK,
    actions: [{
      type: "FunctionCall",
      methodName: method,
      args: args,
      gas: (gas || WALLET_GAS_100).toString(),
      deposit: depositYocto.toString(),
    }],
  });
}
// ---- Group helpers ----
function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}
function randomInviteCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "invite-";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (const b of buf) out += chars[b % chars.length];
  return out;
}
// Downscale a badge image to at most 256px on its longest side and return
// a JPEG data URL (small enough to store as the group's badge URL on
// testnet). Returns "" when the file cannot be read as an image.
function downscaleBadgeImage(file) {
  return new Promise((resolve) => {
    if (!file || !file.type || file.type.indexOf("image/") !== 0) { resolve(""); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const max = 256;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#0a0e14";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        } catch (_) { resolve(""); }
      };
      img.onerror = () => resolve("");
      img.src = reader.result;
    };
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}
function nearblocksTxUrl(hash) {
  return "https://testnet.nearblocks.io/txns/" + hash;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { slugify, randomInviteCode, fmtYocto, escapeHtml, b64Utf8, FACTORY_ID, REGISTRY_ID, MAIN_CONTRACT_ID, GROUP_DAO_DEPOSIT_NEAR, GROUP_CONTRACT_FUND_NEAR, REGISTER_DEPOSIT_YOCTO, DAO_BOND_YOCTO, TEMPLATES, WALLET_GAS_100, WALLET_GAS_150, YOCTO_PER_NEAR, RPC_ENDPOINTS };
}
