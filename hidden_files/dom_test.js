const els = {}; const listeners = {};
function mkEl(id){ return { innerHTML:'', textContent:'', style:{}, value:'amina',
  classList:{ add(){}, }, addEventListener:(ev,fn)=>{ listeners[id+':'+ev]=fn; } }; }
global.document = {
  getElementById:(id)=> els[id] || (els[id]=mkEl(id)),
  addEventListener:(ev,fn)=>{ if(ev==='DOMContentLoaded') fn(); },
};
require('/home/hatch/workspace/egbe/site/app.js');
listeners['settleBtn:click']();
console.log('settle rows:', (els.settleBody.innerHTML.match(/<tr>/g)||[]).length);
console.log('settle note:', els.settleNote.textContent);
console.log('explain rows for amina:', (els.explainBody.innerHTML.match(/<tr>/g)||[]).length);
console.log('explain note:', els.explainNote.textContent);
listeners['labBtn:click']();
console.log('lab ring rows:', (els.labRingBody.innerHTML.match(/<tr>/g)||[]).length);
console.log('lab honest rows:', (els.labHonestBody.innerHTML.match(/<tr>/g)||[]).length);
console.log('lab verdict:', els.labVerdict.innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,700));


// envelope minus dust, no payout passes the cap, standings stay in range.
const app = require('/home/hatch/workspace/egbe/site/app.js');
const YOCTO = 10n ** 24n;
const ENVELOPE = 5n * YOCTO;
const CAP = ENVELOPE * 2500n / 10000n;
for (const sc of app.STRESS_SCENARIOS) {
  const out = app.runStressScenario(sc.id);
  const r = out.result;
  const rows = (els.stressResultBody.innerHTML.match(/<tr>/g)||[]).length;
  const patternRows = (els.stressPatternBody.innerHTML.match(/<tr>/g)||[]).length;
  let maxPay = 0n, badStanding = false;
  for (const id of app.STRESS_MEMBERS) {
    if (r.per[id].payoutYocto > maxPay) maxPay = r.per[id].payoutYocto;
    if (out.standingAfter[id] < 50 || out.standingAfter[id] > 200) badStanding = true;
  }
  console.log('stress', sc.id, 'pattern rows:', patternRows, 'result rows:', rows,
    'totalScore:', r.totalScore, 'payout sum:', r.totalPayoutYocto.toString(),
    'dust:', r.dustYocto.toString(), 'max payout <= cap:', maxPay <= CAP,
    'standings in [50,200]:', !badStanding);
  console.log('stress verdict', sc.id + ':', els.stressVerdict.innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,420));
}


// Membership Integrity Monitor: the mutual pair rule flags exactly the six
// recorded pairs, activity covers all 19 members, history lists all 13
// admissions and no removals, and the last sync is the clearsite587 one.
const pairs = app.monitorMutualPairs();
console.log('monitor pairs:', pairs.length, pairs.map((p) => "r" + p.round + ":" + p.a.split("-")[0] + "<->" + p.b.split("-")[0] + " " + p.aToB + "/" + p.bToA + " (" + p.shareA + "%/" + p.shareB + "%)").join(" | "));
console.log('monitor activity rows:', (els.monitorActivity.innerHTML.match(/<tr>/g)||[]).length);
console.log('monitor history rows:', (els.monitorHistory.innerHTML.match(/<tr>/g)||[]).length);
console.log('monitor history says no removals:', els.monitorHistory.innerHTML.includes("No member has been removed"));
console.log('monitor sync text:', els.monitorSync.innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,260));
console.log('monitor warnings text:', els.monitorWarnings.innerHTML.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,500));