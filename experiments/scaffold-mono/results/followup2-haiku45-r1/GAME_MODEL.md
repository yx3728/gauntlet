# GAME_MODEL.md — Understanding the Game World

## Observations

### Game Structure
- **Waves**: 3 waves before boss fights
- **Movement**: Limited to speed_cap (default 40) per tick
- **Auto-fire**: Weapons fire automatically, player controls only movement

### Object Types Encountered
- Enemies: grunt, swift, tank, shooter, weaver (and elite versions)
- Boss: appears after waves
- Pickups: exp_small/medium/large/huge, heart, bomb, magnet, coin, levelup, invincible

### Game Flow
- Multiple waves of enemies
- Level-ups at certain experience thresholds
- Boss encounters
- Victory condition: defeat all bosses (boss_cleared = true)

## Key Mechanics to Discover
- [ ] Enemy movement patterns and velocities
- [ ] Optimal upgrade choices for different situations
- [ ] Boss mechanics and phases
- [ ] Safe movement zones
- [ ] How pickups affect gameplay
