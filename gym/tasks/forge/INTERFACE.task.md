## Task: Forge & Fortune (`forge`)

A non-spatial workshop-economy simulator. One step = one day. The episode ends on a
win (net worth reaches the target), or when the season's last day passes (`timeout`).
There is no `death`. Handle the **whole** schema below — a short run may not show every
event kind or decision.

### Config keys

| key         | type | default | meaning                                                        |
|-------------|------|---------|----------------------------------------------------------------|
| `max_steps` | int  | 80      | hard step cap; the season itself is 60 days, so an episode never exceeds 60 steps unless `max_steps` is smaller — then the episode ends at `max_steps` with `timeout` |

No other task-specific config keys.

### Action schema

```js
{ op: "buy" | "sell" | "craft" | "upgrade" | "rest",   // default: "rest"
  item: "ore" | "wood" | "crystal" | "goods",          // for buy/sell (goods cannot be bought)
  qty: int,                                            // default 1; clamped to [1, 9999]
  choice: int }                                        // only meaningful while a pending_decision is open
```

All fields are sanitized; a malformed action becomes `{ op: "rest" }`. Exactly one op
executes per day, at the prices currently shown in `obs.prices`:

- `buy`: buy `qty` of a material at `prices[item]`. If gold covers fewer than `qty`,
  buys as many as affordable (possibly zero). Buying `"goods"` does nothing.
- `sell`: sell `min(qty, owned)` of `item` at `prices[item]` (goods at `prices.goods`).
- `craft`: convert up to `qty` recipe batches (limited by inventory). Each batch
  consumes the published recipe and produces `craft_yield` goods. `item` is ignored.
- `upgrade`: if `workshop_level < workshop_max_level` and gold ≥ `upgrade_cost`, pay
  `upgrade_cost` and raise `workshop_level` by 1 (raising `craft_yield`). Else nothing.
- `rest`: nothing.

### Published economy facts

- Start: 100 gold, empty inventory, 0 goods, workshop level 1. Target net worth: **1000**
  (seed-independent; also in `obs.target`). Season: 60 days.
- Recipe per craft batch: `{ ore: 2, wood: 2, crystal: 1 }` (also in `obs.recipe`).
- Craft yield per batch: `workshop_level + 1` goods (also in `obs.craft_yield`).
- Upgrade cost: `150 × workshop_level` gold (also in `obs.upgrade_cost`; `null` at the
  max level, 5).
- Material prices are integers following seeded daily random walks within fixed bounds:
  ore 5–24, wood 3–16, crystal 9–40. A few times per season a scheduled `market_shift`
  multiplies one material's price by a factor of roughly 1.25–1.45 (or its inverse, for
  a downward jump), rounded and clamped to the same bounds.
- Goods price: `max(1, round(demand × (2·ore + 2·wood + 1·crystal price)))`, where
  `demand` is a hidden factor that walks daily within [0.58, 0.85]. The current goods
  price is always visible in `obs.prices.goods`.
- Net worth = `gold + Σ inventory[m]·prices[m] + goods·prices.goods`, recomputed at the
  prices shown in the same obs.

### Trader offers (`pending_decision`)

On a few seeded days a trader arrives. While the offer is open:

```js
obs.pending_decision = {
  kind: "trader_offer",
  options: [
    { index: 0, kind: "decline", desc: "decline the offer" },
    // 1 or 2 deals:
    { index: 1, kind: "bulk_buy" | "premium_sale",
      item: "ore"|"wood"|"crystal"|"goods", qty: int, unit_price: int, desc: string },
    // possibly { index: 2, ... }
  ]
}
```

- `bulk_buy`: you may buy up to `qty` of `item` at `unit_price` (below market at offer
  time). Accepting buys `min(qty, floor(gold / unit_price))`.
- `premium_sale`: you may sell up to `qty` of `item` at `unit_price` (above market at
  offer time). Accepting sells `min(qty, owned)`.
- Deal prices are **fixed at offer time** and do not track the next day's market.
- Resolve by setting `action.choice` to an option `index` on your **next** action (the
  same action's `op` also executes that day, after the choice is applied). The offer
  lasts exactly one step; a missing/invalid `choice` selects option 0 (decline).

### Events (`event` is null or exactly one of these per step)

| kind           | payload fields              | meaning                                   |
|----------------|-----------------------------|-------------------------------------------|
| `trader_offer` | `day`, `deals`              | a trader offer just opened (see obs)      |
| `market_shift` | `item`, `from`, `to`        | a scheduled price jump (already in prices)|
| `game_over`    | `reason` (`win`/`timeout`)  | episode ended; equals `metrics.done_reason` |

Priority when several coincide: `game_over` > `trader_offer` > `market_shift` (a shift
is always still visible in `obs.prices`).

### Obs schema

```js
{
  day: int,                 // 0 at reset; +1 per step
  horizon: 60,              // season length in days
  days_left: int,           // horizon - day
  gold: int,
  inventory: { ore: int, wood: int, crystal: int },
  goods: int,
  workshop_level: int,      // 1..5
  workshop_max_level: 5,
  upgrade_cost: int | null, // gold cost of the next upgrade; null at max level
  craft_yield: int,         // goods produced per craft batch at the current level
  recipe: { ore: 2, wood: 2, crystal: 1 },
  prices: { ore: int, wood: int, crystal: int, goods: int },
  net_worth: int,
  target: 1000,
  pending_decision?: { kind: "trader_offer", options: [...] },  // only while open
  metrics: { ... }          // below
}
```

### Metrics & score

```js
obs.metrics = {
  score,            // published formula below
  progress,         // running max of min(1, net_worth / target); 1.0 only on a win
  done_reason,      // null | "win" | "timeout"
  gold, net_worth, workshop_level, goods,   // current values (as in obs)
  goods_crafted,    // cumulative goods produced this episode
  deals_accepted,   // trader deals accepted with nonzero effect
  day,
}
```

**Score formula:** `score = net_worth + (win ? 500 + 10 × days_left : 0)`, where
`days_left` is measured on the day the win occurs. Without a win, score is simply the
final net worth (bounded by the fixed season — there is no unbounded grinding).
