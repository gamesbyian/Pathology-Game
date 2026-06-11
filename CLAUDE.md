# Pathfinder – Claude Working Notes

**Keep this file updated** whenever you make significant architectural decisions,
add new files, change data formats, or discover important invariants.

---

## Project Overview

Pathfinder is a grid-based line-drawing puzzle game.  The player draws one
continuous path from a gate to the true goal, satisfying exact length and
intersection-count constraints, plus all per-cell obligations.

The authoritative rule spec lives in `PATHFINDER_SPEC.md`.  Read it before
changing any movement, win-detection, or solver logic.

---

## File Map

| File | Purpose |
|------|---------|
| `index.html` | Single-page app shell, CSS, modal markup |
| `levels.js` | Built-in level set as `window.RAW_LEVELS` (1-based coords, packed-int hints) |
| `firebase-config.js` | Firebase project config + `window.__admin_uid` |
| `themes.js` | `window.THEMES` registry + seed-based derivation helpers |
| `engine.js` | Core rules: path state, move validation, win detection, level normalisation |
| `solver.js` | Deterministic BFS/work-budget solver; exports `SolverV2` |
| `renderer.js` | Canvas grid renderer; draws cells, objects, path, hint overlay |
| `app.js` | App bootstrap, mode switching (Play/Edit/Review), Firebase wiring, UI glue |

---

## Coordinate Convention

- **User-facing / levels.js**: 1-based `{x, y}` where `(1,1)` is top-left.
- **Packed hint keys**: `key = (x-1) + ((y-1) << 16)` (zero-based).
- Engine internals may use either; always normalise at the boundary.

Key decode:  `x0 = key & 0xFFFF`,  `y0 = key >> 16`  → 1-based: `x0+1, y0+1`.

---

## Path State (engine.js `PathState`)

```
nodes[]        – ordered {x,y} 1-based cells
portalJumps    – count of teleport hops (not counted in length)
length         – nodes.length - 1 - portalJumps
intersections  – count of valid crossings
visitCount     – Map<key, number>  (packed key → visits)
axisH / axisV  – Set<key> cells traversed horizontally / vertically
flipOrder      – Map<key, number> for flipping-filter state
mustPassSat    – Set<key> must-pass cells satisfied
mustCrossSat   – Set<key> must-cross cells satisfied
```

---

## Solver

`SolverV2` in `solver.js` uses iterative-deepening DFS with a work budget
(node expansions, not wall clock).  It is deterministic: fixed move order
(right, down, left, up), stable tie-breaks, no randomness.

Return value:
```js
{ found: bool, path: [{x,y},...] | null, workUsed: number, reason: string }
```

---

## Level Normalisation

`normaliseLevel(raw)` in `engine.js` fills missing optional arrays to `[]`,
coerces strings to numbers for `reqLen`/`reqInt`, converts any packed-int hint
arrays to `[{x,y},…]` format internally.

---

## Themes

`themes.js` exports `window.THEMES` (named registry).  Each theme has `seeds`
object; `deriveTokens(seeds)` produces the full semantic token map written to
CSS custom properties on `<html>`.

---

## Firebase

`firebase-config.js` provides `window.__firebase_config`, `window.__app_id`,
and `window.__admin_uid`.  The app initialises Firebase lazily; all Firebase
paths degrade gracefully when offline.

Firestore collections (under `window.__app_id`):
- `pendingSubmissions` – user-submitted levels awaiting review
- `publishedLevels` – approved levels, sorted by `sortOrder`

---

## Known Invariants / Gotchas

1. A gate re-entry is never allowed (except undoing back through the gate).
2. Portal jumps don't count toward `reqLen`.
3. Flipping-filter axis flips on *every* use (odd flip-order → inverted).
4. A T-intersection that blocks all continuation is illegal *before* the move.
5. False-goal detonation fires only when the path *would otherwise win*.
6. `reqInt` counts valid crossings only (perp-axis revisits, not same-axis reuse).
7. Hints are decoded from packed keys then validated before display or storage.

---

## Update Instructions

**Update this file when you:**
- Add or rename source files
- Change coordinate conventions
- Add new level object types
- Change Firebase collection structure
- Change solver API
- Discover a rule edge case not listed above
