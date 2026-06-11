# Playtest assignment

You are playtesting a black-box game/task and developing the strongest `policy.js` you can.
This prompt is task-agnostic: everything specific to this task is in the two documents below.

## Start here

1. Read `DESCRIPTION.md` — what the task is and what counts as clearing it.
2. Read `INTERFACE.md` — the complete API & data schema (it is the full truth about what you
   can observe and do; it says nothing about how to play well — discovering that is your job).
3. `task.bundle.js` is a black box. Interact with it ONLY through the documented interface.
   Do not attempt to read, pretty-print, or de-obfuscate it. Stay within this directory.

## What to do

Write `policy.js` (start from `policy.template.js`) implementing the documented policy
contract, then iterate: run it, read the metrics, improve it.

```
node run_policy.js --policy ./policy.js --seeds <seed> --json
```

You have a budget of about **$ATTEMPTS run-and-improve iterations** — spend them
deliberately (changing one thing at a time beats thrashing).

## The goal

**CLEAR the task** — `progress` 1.0 / `done_reason` `"win"`. The metrics (`score`,
`progress`, ...) are useful references, NOT the target. Don't settle for grinding easy
points; name the dominant objective and what it quantitatively requires before optimizing.

## Robustness

Your final `policy.js` will also be evaluated on **held-out seeds you cannot see**, so
prefer robust play over fitting one seed. `policy()` must never throw: handle the entire
documented obs/event/decision space (including `pending_decision` whenever it appears),
even the parts a short test never shows you.

## Deliverables (both in this directory)

1. `policy.js` — your final policy (always keep this file at your best-known version).
2. `report.json` —

```json
{
  "best_result": { "...": "metrics of your best observed run" },
  "how_far": "one paragraph: how far you got and what stopped you",
  "failure_modes": ["..."],
  "lessons": ["..."],
  "attempts_used": 0
}
```

Write `report.json` AS SOON AS you have any working policy and keep updating it —
do NOT leave it for the end (your session may be cut at any time).
