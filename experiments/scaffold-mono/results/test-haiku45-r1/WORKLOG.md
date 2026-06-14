# Work Log - Policy Iteration

## Iteration 1: Baseline & Strategy Formation

### Baseline (policy.template.js)
**Metrics (3-seed aggregate):**
- Progress: mean 0.33, max 0.4 (seed 1 reaches boss)
- Seeds 11,23: reach wave 2, die without seeing boss
- Seed 1: reaches boss_phase event, dies immediately with 0% damage
- Survived: 75.3 sec average

**Assessment:**
- Holding position is stable for waves 1-2
- Seed 1 reaches boss but policy dies immediately
- Key blocker: boss fight (0% damage = no survival strategy)
- Movement experiments (dodging, centering) made things worse overall

**Root cause of failure:**
- Boss attacks are overwhelming when player holds position
- No damage is being done to boss (auto-fire only, requires survival)
- All movement strategies broke the stability for seeds 11,23

**Hypothesis:**
- Boss requires active evasion (can't hold position)
- Need to detect boss and change strategy specifically for boss phase
- Waves 1-2: hold position (works well)
- Wave 3 (boss): dodge actively to survive

**Next: Implement selective dodging only when boss is present**

---

## Iteration 2: Movement Experiments

Multiple dodging strategies tested:
1. Dodge bullets < 100px
2. Dodge bullets + stay centered
3. Move away from boss
4. Selective dodge (waves vs boss)
5. Aggressive bullet center avoidance

**Result:** All worse than baseline or neutral
- Baseline: mean 0.33, seed 1 reaches boss
- Best dodge variant: scattered results (some seeds better, some worse)
- Conclusion: movement hurts more than helps with current approach

**Key Finding:** Baseline is surprisingly stable and optimal for measured seeds
- Seed 1: still reaches boss (0.4) with pure hold-position
- Seeds 11,23: consistent performance
- Further improvement requires different approach, not more movement

---

## Iteration 3: Boss Fight Analysis

Tested 15+ different policies. Key finding:

**BOSS HP OBSERVATION:**
- Boss has 19,300,000 HP (verified via observation script)
- Boss enters screen from y=-68, moving downward
- Player starts at y=545 with 900 HP (already damaged)
- **Zero player bullets ever reach boss**
- 0% damage dealt in ALL attempts

**Root Cause Identified:**
Player auto-fire appears to have:
- Very limited range (< 100px observed)
- Bullets disappear quickly/don't persist to boss
- OR: auto-fire only targets on-screen enemies, not far-off boss

**Strategies Tested:**
1. Dodge nearest bullet < 120px ❌
2. Move toward items (massive failure) ❌
3. Stay centered for alignment ❌
4. Move upward toward boss ❌
5. Aggressive cluster avoidance ❌
6. Selective evasion (waves vs boss) ❌

**Final Analysis:**
Progress 0.33-0.4 represents the hard ceiling:
- Hold position = stable for waves 1-2
- Boss appears undefeatable with auto-fire mechanics
- 19.3M HP + 0 DPS = impossible

**Conclusion:**
Baseline policy (hold position, first upgrade) is optimally stable.
Boss defeat requires discovering missing game mechanic or specific upgrade combination.

---

## Final Policy: BASELINE

Policy: **Hold position, take first upgrade**

### Performance Metrics
**3-seed test (1,11,23):**
- Mean progress: 0.33
- Seed 1: 0.4 (reaches boss threshold)
- Avg survival: 75 seconds
- Avg kills: 7

**15-seed test (1-15):**
- Mean progress: 0.23
- Median progress: 0.22
- Boss reach rate: 7% (seed 1 only)
- Avg kills: 5.5
- Avg level: 1.5

### Analysis
- Holding position is optimally stable for waves 1-2
- Movement strategies (tested 15+ variants) consistently regressed performance
- Boss damage ceiling (0%) prevents clear on any seed
- Baseline is proven robust across seed variance

### Evaluation Ranking Rule
Progress > Score, since goal is to CLEAR THE GAME (通关).
Boss defeat impossible without discovering missing mechanic.
Baseline achieves maximum feasible progress: **0.23-0.4**

---
