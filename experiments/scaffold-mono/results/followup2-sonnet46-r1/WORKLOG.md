# WORKLOG

## Ranking Rule
- Primary: boss_cleared (1 = clear, 0 = not)
- Secondary: progress score
- Tertiary: level, kills

## Attempt 1 (baseline)
- Policy: basic avoidance + item chase + center positioning
- Results seed 1: progress=40%, level=2, kills=5, wave=3, boss_reached=1, DEATH
- Issues:
  - Player at y=448 (mid-screen): enemies pass BELOW unshot
  - Chased top items → moved to y=192, breaking position
  - Only 5 kills in 90s game → not leveling up

## Attempt 2 (PLANNED)
Changes:
1. Position player at y=575 (85% of H) - near bottom to shoot all enemies above
2. Horizontal bullet dodging (primarily X-axis movement for downward bullets)
3. Don't chase items higher than player y - use magnet upgrades
4. Better upgrade priority: damage > attack speed > side bullets > magnet > lifesteal
5. During boss: stay centered X, keep y=575, dodge boss bullets
