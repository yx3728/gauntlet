# GridRun — dungeon floor crawler

A turn-based crawl down through three floors of a compact dungeon grid.

You control a lone runner. Each turn you move one cell — north, south, east, or
west — or hold your ground. Every floor is a fresh maze of walls hiding loose
gems, a single key, and a locked exit; hazards patrol the corridors on their
own fixed rounds, and touching one (from either side) ends the run instantly.

Walk onto a gem or the key to pick it up. Reach the exit while carrying that
floor's key to descend. Each time you finish a floor (except the last) a
passing spirit offers you a choice of boon — their effects are for you to
observe. Clear the third floor to win; dawdle too long and the run times out.

Gems are optional treasure that sweeten your final tally; the key and the exit
are the only things you truly need. Everything on the floor is visible to you
every turn — the layout, your position, the patrols. How boldly you thread
past them is up to you.

You play by writing a policy module; see `INTERFACE.md` for everything you can
observe and do, and run it with `run_policy.js`.
