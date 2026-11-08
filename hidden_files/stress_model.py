#!/usr/bin/env python3
"""Independent integer model of the FairShare settlement rules, written
from the contract spec (contract/src/lib.rs), NOT from site/app.js.

Rules:
- discount on a mutual pair = floor(min(points, reverse) * 5000 / 10000),
  subtracted from the giver's own points on BOTH directions.
- sqrt contribution = isqrt(effective_points * giver_standing).
- score = (sum of sqrt contributions over distinct givers) ** 2.
- payouts: proportional to score over a 5 NEAR envelope, capped at 25%
  of the envelope, surplus redistributed water-filling style.
- standing: submitted -> +2 per distinct giver, capped +10; no
  submission -> -5; clamped to [50, 200].
Compares against the site's computed results in /tmp/stress_site.json.
Regenerate that file with hidden_files/stress_dump.js, then run this file.
"""
import json
import math
import sys

YOCTO = 10 ** 24
ENVELOPE = 5 * YOCTO
CAP_BPS = 2500
DISCOUNT_BPS = 5000


def settle(members, standings, allocations):
    raw = {(a["from"], a["to"]): a["points"] for a in allocations}
    eff = {}
    for a in allocations:
        back = raw.get((a["to"], a["from"]), 0)
        discount = min(a["points"], back) * DISCOUNT_BPS // 10000
        eff[(a["from"], a["to"])] = a["points"] - discount
    scores = {}
    for m in members:
        s = 0
        for a in allocations:
            if a["to"] == m and a["from"] != m:
                s += math.isqrt(eff[(a["from"], a["to"])] * standings[a["from"]])
        scores[m] = s * s
    total = sum(scores.values())
    cap = ENVELOPE * CAP_BPS // 10000
    uncapped = {m: (scores[m] * ENVELOPE // total if total else 0) for m in members}
    payouts = {m: 0 for m in members}
    capped = {m: False for m in members}
    if total > 0:
        remaining = ENVELOPE
        active = [m for m in members if scores[m] > 0]
        while active:
            tot = sum(scores[m] for m in active)
            over = [m for m in active if scores[m] * remaining // tot > cap]
            if not over:
                for m in active:
                    payouts[m] = scores[m] * remaining // tot
                break
            for m in over:
                payouts[m] = cap
                capped[m] = True
                remaining -= cap
            active = [m for m in active if m not in over]
    after = {}
    for m in members:
        submitted = any(a["from"] == m for a in allocations)
        givers = {a["from"] for a in allocations if a["to"] == m}
        gain = min(len(givers) * 2, 10)
        new = standings[m] + gain if submitted else standings[m] - 5
        after[m] = max(50, min(200, new))
    return scores, uncapped, payouts, capped, total, sum(payouts.values()), after


def main():
    site = json.load(open("/tmp/stress_site.json"))
    ok = True
    for sid, s in site.items():
        members = ["ada", "ben", "cara", "dan", "eli", "fay"]
        scores, uncapped, payouts, capped, total, psum, after = settle(
            members, s["standings"], s["allocations"])
        problems = []
        if total != s["totalScore"]:
            problems.append(f"totalScore {total} != site {s['totalScore']}")
        if psum != int(s["totalPayoutYocto"]):
            problems.append(f"payout sum {psum} != site {s['totalPayoutYocto']}")
        if ENVELOPE - psum != int(s["dustYocto"]):
            problems.append(f"dust {ENVELOPE - psum} != site {s['dustYocto']}")
        for m in members:
            p = s["per"][m]
            if scores[m] != p["score"]:
                problems.append(f"{m} score {scores[m]} != site {p['score']}")
            if uncapped[m] != int(p["rawPayoutYocto"]):
                problems.append(f"{m} raw {uncapped[m]} != site {p['rawPayoutYocto']}")
            if payouts[m] != int(p["payoutYocto"]):
                problems.append(f"{m} payout {payouts[m]} != site {p['payoutYocto']}")
            if capped[m] != p["capped"]:
                problems.append(f"{m} capped {capped[m]} != site {p['capped']}")
            if after[m] != s["standingAfter"][m]:
                problems.append(f"{m} standing {after[m]} != site {s['standingAfter'][m]}")
        # Invariants: cap never exceeded, payouts sum to envelope minus dust.
        for m in members:
            if payouts[m] > ENVELOPE * CAP_BPS // 10000:
                problems.append(f"{m} payout exceeds cap")
        if problems:
            ok = False
            print(f"FAIL {sid}:")
            for pr in problems:
                print("  ", pr)
        else:
            print(f"PASS {sid}: totalScore {total}, payout sum {psum / YOCTO:.6f} NEAR, "
                  f"cap {max(payouts.values()) / YOCTO:.3f} max, standings {after}")
    print("ALL PASS" if ok else "MISMATCHES FOUND")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
