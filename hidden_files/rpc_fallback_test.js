// RPC fallback test: badgeView / contractView / daoView must survive a dead
// primary endpoint by retrying once against fastnear, and only show the
// "could not read" message when both endpoints fail.
const els = {}; const listeners = {};
function mkEl(id){ return { innerHTML:'', textContent:'', style:{}, value:'amina',
  classList:{ add(){}, }, addEventListener:(ev,fn)=>{ listeners[id+':'+ev]=fn; } }; }
let domReady = null;
global.document = {
  getElementById:(id)=> els[id] || (els[id]=mkEl(id)),
  addEventListener:(ev,fn)=>{ if(ev==='DOMContentLoaded') domReady = fn; },
};

// mode: 'primary-fails' | 'primary-502' | 'primary-rpc-error' | 'both-fail' | 'primary-ok'
let mode = 'primary-fails';
const calls = [];
function canned(method) {
  switch (method) {
    case 'nft_tokens': return [{ owner_id: 'alice-fairshare.testnet', metadata: { description: 'FairShare Council Badge, standing 100 at mint' } }];
    case 'get_badge': return { token_id: 'badge-alice-fairshare.testnet', owner_id: 'alice-fairshare.testnet', standing: 100 };
    case 'get_params': return { points_per_member: 100, min_recipients: 3, cap_bps: 2500, reciprocity_discount_bps: 5000, standing_start: 100 };
    case 'get_members': return ['alice-fairshare.testnet'];
    case 'get_dao_info': return { dao_id: 'fairshare-dao.testnet', member_role: 'council', member_count: 1 };
    case 'get_round': return { round_id: 1, total_payout_yocto: '0', envelope_yocto: '0', settled: true };
    case 'get_proposals': return [];
    default: return {};
  }
}
function rpcOk(value) {
  const bytes = Array.from(Buffer.from(JSON.stringify(value), 'utf8'));
  return { ok: true, status: 200, json: async () => ({ result: { result: bytes } }) };
}
global.fetch = async (url, opts) => {
  calls.push(url);
  let method = '';
  try { method = JSON.parse(opts.body).params.method_name; } catch (_) { method = ''; }
  const primary = url.includes('rpc.testnet.near.org');
  if (mode === 'both-fail') throw new Error('network down');
  if (primary && mode === 'primary-fails') throw new Error('network down');
  if (primary && mode === 'primary-502') return { ok: false, status: 502, json: async () => ({}) };
  if (primary && mode === 'primary-rpc-error') return { ok: true, status: 200, json: async () => ({ error: { code: -32000, message: 'boom' } }) };
  return rpcOk(canned(method));
};

const app = require('/home/hatch/workspace/egbe/site/app.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // 1. Primary throws, fallback answers.
  calls.length = 0;
  const v1 = await app.rpcViewCall('fairshare-badge.testnet', 'nft_tokens', { from_index: '0', limit: 100 });
  console.log('fallback after primary throw: ok=', Array.isArray(v1) && v1.length === 1, 'endpoints tried=', calls.join(','));

  // 2. Primary 502, fallback answers.
  mode = 'primary-502'; calls.length = 0;
  const v2 = await app.rpcViewCall('fairshare-badge.testnet', 'nft_tokens', { from_index: '0', limit: 100 });
  console.log('fallback after primary 502: ok=', Array.isArray(v2) && v2.length === 1, 'endpoints tried=', calls.join(','));

  // 3. Primary RPC error, fallback answers.
  mode = 'primary-rpc-error'; calls.length = 0;
  const v3 = await app.rpcViewCall('fairshare-badge.testnet', 'nft_tokens', { from_index: '0', limit: 100 });
  console.log('fallback after primary RPC error: ok=', Array.isArray(v3) && v3.length === 1, 'endpoints tried=', calls.join(','));

  // 4. Both fail: throws.
  mode = 'both-fail'; calls.length = 0;
  let threw = false;
  try { await app.rpcViewCall('fairshare-badge.testnet', 'nft_tokens', { from_index: '0', limit: 100 }); } catch (_) { threw = true; }
  console.log('both fail throws: ok=', threw, 'endpoints tried=', calls.join(','));

  // 5. Badge panel renders when primary fails and fallback answers.
  mode = 'primary-fails';
  domReady();
  await sleep(100);
  console.log('badge panel renders via fallback: ok=', els.badgeList.innerHTML.includes('alice-fairshare.testnet'), 'no error msg=', !els.badgeList.innerHTML.includes('Could not read'));
  console.log('badge panel html:', els.badgeList.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200));

  // 6. Badge panel shows the error message only when both fail.
  mode = 'both-fail';
  domReady();
  await sleep(100);
  console.log('badge panel error only when both fail: ok=', els.badgeList.innerHTML.includes('Could not read the badges'));
})();
