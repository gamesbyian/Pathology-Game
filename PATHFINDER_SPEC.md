# Pathfinder Product Specification

This document describes Pathfinder as an application and game in implementation-independent terms. It is intended to be sufficient for an AI coding model to build a compatible version of the app from scratch when paired with the existing `levels.js` and `firebase-config.js` data/configuration files.

The spec focuses on what the app must do, what rules users experience, what data the app consumes and produces, and how the major modes fit together. It intentionally avoids prescribing a particular framework, file structure, rendering strategy, or exact visual styling unless that behavior is core to Pathfinder.

---

## 1. Core Concept

Pathfinder is a grid-based line-drawing puzzle game about exact constraint satisfaction.

The player draws one continuous path across a rectangular grid. The path begins at one gate and must end at the true goal. A solution is accepted only if the path simultaneously satisfies:

1. It starts on a gate.
2. It ends on the true goal.
3. Its counted length exactly equals the level's required length.
4. Its counted number of self-intersections exactly equals the level's required crossings.
5. It satisfies every object-specific obligation and restriction on the grid.

The player is not merely finding any route from start to finish. The player is shaping a route with a precise history: how long it is, where it revisits itself, which required cells it visits or crosses, which hazards it avoids, and how portals and filters affect movement.

The game is won on a level when the currently drawn path reaches the true goal with all required metrics and obligations satisfied. Near misses are failures: one step too short, one step too long, one crossing too few, or one crossing too many must not count as a win.

---

## 2. Data Inputs Provided to the App

A rebuilt Pathfinder app should be able to load these two externally supplied files:

### 2.1 `levels.js`

`levels.js` defines the built-in level set as `window.RAW_LEVELS`, an array of level objects.

Each level may contain:

```js
{
  grid: { w: Number, h: Number },
  gates: [{ x: Number, y: Number }, ...],
  goal: { x: Number, y: Number },
  falseGoals: [{ x: Number, y: Number }, ...],
  reqLen: Number,
  reqInt: Number,
  designerName: String,
  description: String,
  difficulty: Number | null,
  blocks: [{ x: Number, y: Number }, ...],
  mustPass: [{ x: Number, y: Number }, ...],
  mustCross: [{ x: Number, y: Number }, ...],
  filters: [{ x: Number, y: Number, axis: 1 | 2 }, ...],
  flippingFilters: [{ x: Number, y: Number, axis: 1 | 2 }, ...],
  portals: [{ x1: Number, y1: Number, x2: Number, y2: Number, color?: String }, ...],
  geese: [{ x: Number, y: Number }, ...],
  hints: [Path, Path, ...]
}
```

Coordinates in `levels.js` are 1-based: `{ x: 1, y: 1 }` is the top-left grid cell.

Compatibility expectations:

- Object arrays may be omitted in older or hand-written data; missing optional arrays should be treated as empty arrays.
- `designerName` and `description` may be omitted and should default to empty strings.
- `difficulty` may be omitted, blank, or `null`; otherwise it is an integer difficulty rating.
- `reqLen` and `reqInt` are required gameplay metrics and should be interpreted as non-negative integers.
- Unknown non-structural fields should not break loading. A compatible app may ignore them unless it intentionally preserves them during round-trip editing.
- The loader should normalize old-but-compatible level objects into the same effective shape used by new exports before play, editing, solving, or review.

The app may convert these to any internal representation, but all imported and exported level data should remain compatible with the above shape.

### 2.2 `firebase-config.js`

`firebase-config.js` supplies the Firebase app configuration. A compatible implementation should use it to initialize Firebase if online submission/review features are enabled.

The app should still be usable for local play and editing if Firebase is unavailable, but submission, review, published-level loading, and deletion require a working Firebase connection.

---

## 3. Coordinate and Grid Model

### 3.1 Grid

Each level is played on a rectangular grid of `w` columns and `h` rows. Every object occupies a whole cell.

Cells are addressed by integer column and row. For user-facing level data, both coordinates are 1-based. Internally, any representation is acceptable.

### 3.2 Adjacent Movement

A drawn path normally moves orthogonally from one cell to one of its four neighbors:

- left
- right
- up
- down

Diagonal movement is not allowed.

A portal jump is the special exception: entering a portal terminal immediately appends the paired terminal to the path without counting as a normal grid step.

### 3.3 Path Nodes and Segments

The path is an ordered sequence of visited cells. Consecutive non-portal nodes define horizontal or vertical segments between adjacent cells. Portal jumps are represented as consecutive path nodes too, but they are not drawn or counted as ordinary adjacent movement segments.

The path has:

- **Raw node count:** number of cells in the path sequence.
- **Counted length:** number of non-portal movement steps. This is `path nodes - 1 - portal jumps`.
- **Visited count per cell:** how many times the path has occupied each cell.
- **Axis usage per cell:** whether horizontal and/or vertical path segments have passed through that cell.
- **Intersection count:** increments when the path enters a previously visited non-gate, non-goal cell in a valid way.

### 3.4 Path and Hint Encoding

User-facing level coordinates are 1-based, but saved hint paths may use Pathfinder's compact packed-key format. A compatible implementation should understand and be able to produce hint paths in the following forms where practical:

- Packed integer keys, where `key = zeroBasedX + (zeroBasedY << 16)`.
- Coordinate arrays such as `[x, y]`, interpreted as 1-based level coordinates when imported from user-facing data.
- Coordinate objects such as `{ x, y }`, likewise interpreted consistently with the importer/exporter context.

Hint paths are ordered path-node sequences. They should be decoded, normalized, and validated against the current level before display, copying, submission, approval, or audit use. Invalid, duplicate, malformed, out-of-bounds, or stale hint paths should be ignored or reported as invalid; they must not be accepted as proof that a level is solvable.

### 3.5 Mode-Independent State Principles

Play, Edit, and Review modes should share the same underlying level and path rules wherever possible. The following state principles keep behavior predictable:

- Loading a level, changing levels, resetting, or switching into a different working level clears the current path, transient hazard state, portal ripple effects, and transient hint animation state.
- Undo/backtracking should restore derived path metrics rather than trying to patch them manually. Counted length, intersections, visited counts, axis usage, portal-jump markers, and flipping-filter state should all be recomputed or restored together.
- A level's structural data should remain immutable during Play Mode; options may create a temporary playable copy, but they must not mutate the built-in or published source data.
- Edit and Review modes may mutate a working copy. Leaving that working copy with unsaved changes should be guarded by a confirmation.
- Solver, hint, editor, review, submission, audit, and win-detection flows should all depend on the same rule semantics, even if they use different UI flows.

---

## 4. Objects on the Grid

### 4.1 Gate

A gate is a possible start cell.

Rules:

- A path must begin on exactly one gate.
- If a level has multiple gates, the player chooses one by starting there.
- Once a gate has been chosen, the path should not enter any gate again during normal Play Mode.
- The starting gate is not counted as a self-intersection when visited as the initial path node.
- Undo/reset lets the player try a different gate.
- Gates may be annotated with parity warnings when they cannot reach the true goal in the required length under simple checkerboard parity constraints. These warnings are advisory; they are display/filtering aids, not separate puzzle objects.

### 4.2 Goal

The true goal is the required destination.

Rules:

- A level has exactly one true goal.
- The path may win only by ending on the true goal.
- Once the path is at the true goal in Play Mode, additional movement should not be allowed unless the user undoes or resets.
- Entering the true goal before metrics and obligations are satisfied should not produce a win.

### 4.3 False Goal / Booby-Trap Goal

A false goal is a decoy goal, conceptually a trap.

Rules:

- False goals look goal-like but are not the true goal.
- They may be hidden or shown depending on the False Goals option in Play Mode.
- If the player reaches a false goal at a moment when the current path otherwise satisfies the win metrics, the trap detonates instead of winning.
- After a false-goal detonation, the app should present a strong failure/hazard feedback and require the player to recover via undo/reset.

### 4.4 Block

A block is an impassable obstacle.

Rules:

- The path may not enter a block.
- Blocks participate in level validation because they can isolate regions or make required cells unreachable.

### 4.5 Must-Pass / Visit-Here Cell

A must-pass cell imposes a visit obligation.

Rules:

- A valid solution must visit every must-pass cell at least once.
- The cell may be visited more than once if the path rules allow it.
- In Play Mode, the UI should make it clear whether each must-pass requirement has been satisfied.

### 4.6 Must-Cross Cell

A must-cross cell imposes an intersection obligation.

Rules:

- A valid solution must create an intersection inside every must-cross cell.
- In practical terms, the path must visit that cell at least twice in a manner that creates a crossing/intersection.
- Must-cross cells are structural obligations, not mere visit targets.
- They should not be placed on the grid edge in valid submitted levels because a true crossing needs space around the cell.
- The editor should prevent or warn about nearby blocks/geese/filters that make required crossings structurally impossible or misleading.

### 4.7 Goose

A goose is a hazard.

Rules:

- In Play Mode, entering a goose cell triggers a hazard event rather than a normal safe move.
- The app should reveal or emphasize the goose and display a failure/hazard state.
- While the goose hazard state is active, further path movement should be blocked until the player undoes or resets.
- If the path would create an intersection on a hidden goose, the app should roll back enough to avoid leaving an impossible/ambiguous intersection state and reveal the hazard.
- Geese can be hidden or shown in Play Mode based on the Geese option.
- In Edit/Review modes, geese are visible as editable objects and do not function as surprise gameplay hazards while editing.

### 4.8 Filter

A filter is a cell that restricts movement through it to a specified axis.

Axes:

- `axis: 1` = horizontal-only filter.
- `axis: 2` = vertical-only filter.

Rules:

- Any non-portal movement segment that enters or leaves a filter cell must match the filter's active axis.
- A horizontal filter allows left/right traversal and rejects up/down traversal.
- A vertical filter allows up/down traversal and rejects left/right traversal.
- Filters act both when the filter is the origin cell and when it is the target cell.
- Filters should visually communicate their allowed axis.

### 4.9 Flipping Filter

A flipping filter is a filter whose active axis can switch as the path progresses.

Rules:

- A flipping filter starts with its declared axis (`1` horizontal or `2` vertical).
- The first time the path uses/crosses a flipping filter, the app records the global flip order for that filter.
- On subsequent checks, a flipping filter's active axis is inverted when its recorded flip order is odd and remains its base axis when the recorded flip order is even.
- A path may not turn on a flipping filter; it must pass straight through along the currently allowed axis.
- Flipping filters should visually convey both that they are filters and that they can change orientation.

### 4.10 Portal

A portal is a paired teleport connection between two cells.

Rules:

- Portals always come in complete pairs.
- Entering one terminal immediately moves the path to the paired terminal.
- The teleport hop is part of the path sequence but is not counted toward required length.
- A portal terminal should not be re-used after it has already been visited in Play Mode, except if the destination is the goal where normal goal behavior applies.
- After entering a portal terminal, the next path node must be its paired destination; the player cannot choose to stand on a portal and then move elsewhere.
- Portal pairs should be visually distinguishable and paired clearly, often by matching color/marking.
- Portal parity matters for editor warnings: when a portal pair connects different checkerboard parities, it can change length parity; when any portal pair is parity-breaking in that way, simple gate/terminal parity warnings should be suppressed because naive parity predictions become unreliable.

---

## 5. Drawing and Editing the Line

### 5.1 Starting a Path

In Play Mode:

1. The player taps/clicks/drags from a gate.
2. The selected gate becomes the active gate.
3. The path starts with that gate as its first node.

The logical path start in Play Mode is always a gate. A convenience input may let the player tap or drag from an aligned non-gate cell if the app can unambiguously begin at a gate and then extend through legal intervening cells, but the resulting path's first node must still be the gate. If the app cannot form such a legal gate-originating path, no path should start.

In Edit/Review modes, the pencil tool can be used to sketch a candidate path on the current working level. This uses the same movement rules as puzzle play where practical, but it is primarily for testing and setting/copying metrics. Pencil mode may allow creator conveniences such as starting from arbitrary cells or reversing a sketched path direction, but any path used as a submitted hint or solution must still validate under the normal solution rules.

### 5.2 Continuing a Path

The player extends the path by entering valid neighboring cells, either by tap/click or drag. The app should interpolate over dragged cells only if it can do so as a sequence of valid orthogonal moves; it must not create illegal jumps.

A candidate next cell is rejected if it violates any move rule, including:

- outside the grid
- blocked cell
- illegal gate re-entry
- moving after the goal
- non-adjacent move, except for mandatory portal jumps
- using a portal incorrectly
- entering a previously used portal terminal
- reusing an already used segment/axis in a way that would duplicate a path edge
- violating a filter's active axis
- entering a goose while the mode disallows it as a normal move
- creating a blocked T-intersection with no legal continuation
- attempting to move while a solver/search overlay or non-dismissible modal owns input
- attempting to extend while a hazard state is active, except for undo/backtracking/reset recovery

Rejected moves should simply not extend the path, ideally with minimal feedback rather than punishing the player.

When a drag or tap target is more than one cell away, the app may interpolate a straight-line sequence of orthogonal moves from the current head to the target. Each interpolated step must pass the same legality checks as an explicit step. If any step fails or triggers a hazard/trap, interpolation stops at that point.

### 5.3 Backtracking and Undo

The player can reverse the most recent step by moving/tapping back onto the previous cell. This truncates the current path by one move and recomputes derived counts.

The Undo button should restore the last saved navigation state. Undo should recover from hazards, portal side effects, and normal moves.

Reset clears the current path and restores the level to its initial playable state while preserving the selected level and options.

### 5.4 Intersections

An intersection occurs when the path enters a cell it has already visited, excluding the active starting gate and excluding the true goal for scoring purposes.

The app must track cell usage by axis:

- A straight revisit along an already-used same-axis segment is not allowed because it would reuse the same edge.
- A valid crossing uses a cell on the perpendicular axis, producing a visible self-crossing and incrementing the crossing count.
- T-intersections that would leave the path unable to continue legally should be blocked.

A must-cross cell is satisfied when it has been visited enough to create an intersection there.

### 5.5 Path Length

Path length is the number of ordinary grid moves, not counting portal jumps.

Examples:

- Gate → adjacent cell: length 1.
- Gate → portal terminal → paired terminal: the first move counts 1; the teleport hop counts 0.
- Backtracking reduces the current length accordingly.

---

## 6. Winning a Level

A level is won when all of the following are true at the same time:

1. The app is in Play Mode.
2. The app is not in an active hazard state.
3. The path is non-empty.
4. The last path node is the true goal.
5. Counted path length exactly equals `reqLen`.
6. Current intersection count exactly equals `reqInt`.
7. Every must-pass cell has been visited at least once.
8. Every must-cross cell has been visited/crossed sufficiently to count as a crossing.
9. No move in the path violates movement, object, or hazard rules.

On win:

- Display a completion modal/message.
- Offer to proceed to the next level.
- Offer to stay/rest on the solved level.
- Optionally expose the winning path data for copying when developer/editor output features are enabled.
- Persist progress locally so completed levels can be recognized later.

---

## 7. Play Mode

Play Mode is the normal player experience for solving published/built-in levels.

### 7.1 Shared Grid State

Play Mode displays the current level's grid and objects. It uses the same level data model as Edit and Review modes but treats the level as immutable: users draw paths, use hints, change options, and navigate levels, but they do not place or remove objects.

### 7.2 Play Mode Header and Metrics

Play Mode should show:

- Current level number/title.
- Previous level button.
- Next level button.
- Current length vs required length.
- Current crossings vs required crossings.
- Completion status when solved.

### 7.3 Play Mode Buttons

Play Mode has these primary controls:

- **Guide:** opens the gameplay guide modal.
- **Hint:** requests or cycles through available hint paths.
- **Whoa:** changes the displayed board orientation/view variant. The exact visual transformation is implementation-specific, but it should let the player inspect the same puzzle from a different perspective without altering the actual level rules.
- **Undo:** restores the previous path state.
- **Reset:** clears the current attempt.

Global controls available outside the play panel:

- **Options:** opens the options/theme menu.
- **Editor:** switches into Edit Mode.
- **Mute:** toggles audio, or is reflected through the Options menu.

### 7.4 Hints in Play Mode

Levels may contain saved hint paths. The Hint button should:

- Use saved hint paths when available.
- Optionally use a solver to find a hint if no saved hint is available.
- Show the hint as a path overlay or step guide without automatically solving the level for the player.
- Support pinning a hint so it remains visible.
- Support clearing the displayed hint.

Hint paths must be validated against the current level before use. Invalid hints should be ignored rather than shown.

### 7.5 Level Navigation

The player can move to previous/next levels. Navigation should:

- Reset transient path state for the new level.
- Preserve global options and theme.
- Respect option filters. For example, if the user hides geese/false goals/dead gates and the current level cannot be played under those options, show an Options Conflict modal and offer to skip to the next playable level.

### 7.6 Hazard Feedback

Play Mode includes strong feedback for hazards:

- Goose hazard: display a goose warning/jumpscare and instruct the player to undo.
- False goal trap: display a booby-trap/bomb warning.
- During hazard state, block further path extension until recovery.

---

## 8. Edit Mode

Edit Mode is the user-facing level editor. It shares the same grid renderer and level data model as Play Mode, but the grid becomes mutable.

### 8.1 Entering and Leaving Edit Mode

The global mode toggle switches between Play and Edit. If the current edited level has unsaved/unexported modifications, leaving Edit Mode should show an unsaved changes confirmation:

- **Stay:** remain in the editor.
- **Leave:** discard/leave despite unsaved changes.

### 8.2 Editor Header and Metrics

Edit Mode replaces read-only play metrics with editable numeric fields:

- Required length (`reqLen`).
- Required crossings (`reqInt`).

The editor must allow these values to be set directly. They are used for parity warnings, solver checks, validation, and final submission.

### 8.3 Editor Palette

The editor includes a palette of placeable tools:

- Gate
- Goal
- False Goal
- Block
- Goose
- Must-Pass
- Must-Cross
- Horizontal Filter
- Vertical Filter
- Horizontal Flipping Filter
- Vertical Flipping Filter
- Portal
- Eraser

Additional editor tools:

- Pencil: draw/test a candidate path on the edited level.
- Step eraser/undo step: remove the most recent pencil path step.
- Grid action undo: undo the last object/grid edit.

### 8.4 Placing Objects

Users can build levels by:

- Selecting a palette tool and tapping/clicking a grid cell.
- Dragging an object from the palette onto the grid.
- Dragging existing grid objects to new positions.
- Dragging objects off the grid to remove them.
- Using the eraser tool to clear cells.

Object placement rules:

- Most single-cell objects should be exclusive: a cell should not simultaneously contain incompatible object types such as a block and a goal.
- The editor should enforce exactly one true goal for a valid level, while allowing multiple gates and false goals.
- Portals require two terminals. Selecting/placing a portal once creates a pending terminal; placing the second terminal completes the pair.
- Pending incomplete portals should be visually distinct and should make the level invalid until completed.
- Filters and flipping filters store an axis.
- Editing objects should clear or invalidate candidate hint paths if the level structure changes.

### 8.5 Grid Size and Transform Controls

The editor includes grid-level controls:

- **Grid size minus:** shrink the grid where possible.
- **Grid size plus:** grow the grid.
- **Rotate:** rotate/remap the level geometry.
- **Mirror:** mirror/remap the level geometry. The editor tracks whether the mirror operation is horizontal or vertical and should communicate that state.

Grid transforms must remap every object consistently, including gates, goal, false goals, blocks, geese, must-pass, must-cross, filters, flipping filters, portals, and hints. Filter axes must rotate/mirror correctly when the transform changes horizontal vs vertical orientation.

### 8.6 Metadata Panel

The editor exposes optional level metadata:

- Designer name, maximum 80 characters.
- Brief description, maximum 160 characters.
- Difficulty, integer 1 through 10 or blank/null.

Metadata should be included in submissions and exports.

### 8.7 Editor Buttons

Edit Mode primary buttons:

- **Guide:** opens the editor guide modal.
- **New:** starts a fresh level.
- **Clear:** clears the current grid/level.
- **BOMBS?:** highlights cells where a false-goal trap could plausibly work.
- **Solve:** runs the solver on the current edited level.
- **Submit:** sends the level for review. This appears for normal editor submissions and is hidden/replaced in admin review contexts as appropriate.

Developer/export controls may include:

- Output text area for serialized level data or path data.
- Copy Path.
- Copy Hints.
- Set metrics from the currently drawn pencil path.

### 8.8 Setting Metrics from a Drawn Path

When the user draws a candidate path with the pencil, the editor should display the candidate's current length and crossings. A **Set** control should copy those values into the required length and crossings fields.

This supports a workflow where the creator draws an intended solution, sets the metrics from it, then validates/solves/submits the level.

### 8.9 Parity Warnings

When the true goal and required length are known, the editor may show red cross-out warnings on gates and portal terminals that cannot reach the true goal in exactly that length by checkerboard parity.

Rules:

- On a plain grid, each orthogonal move flips checkerboard parity. Therefore start/end parity must match the required length parity.
- Portal jumps do not count as length steps but may change position parity. A portal pair connecting opposite checkerboard parities can break the simple parity prediction.
- If any portal pair is parity-breaking, suppress all simple parity cross-outs because the warning would be unreliable.
- These warnings are advisory and should not replace full solver validation.

### 8.10 False-Goal Trap Finder

The **BOMBS?** editor tool should highlight possible false-goal trap spots. A trap spot is a cell where placing a false goal could plausibly create a booby-trap route under the current level geometry and metrics.

The exact search algorithm is implementation-specific, but the feature should help creators identify candidate decoy-goal positions rather than manually guessing.

---

## 9. Solver Features

Pathfinder includes solver-assisted workflows in Play, Edit, and Review contexts.

### 9.1 Solver Modal / Search Overlay

When a solve or hint search runs, show an overlay/modal that conveys:

- Current task, such as "Finding Solutions".
- Detail/status text, such as preparing/searching/validating.
- Elapsed time timer.
- Progress bar and percent if progress is knowable.
- Animated activity indicator.
- Close/cancel control.

If the user cancels, the app should stop as soon as practical and report that the solve was cancelled or timed out.

### 9.2 What the Solver Must Find

A solver result is a valid candidate path satisfying the same validity rules as a user solution:

- starts on a gate
- ends on the true goal
- exact required length
- exact required crossings
- all must-pass and must-cross obligations
- legal handling of blocks, geese, filters, flipping filters, false goals, portals, intersections, and gate rules

The solver may return multiple paths. Hints should store one or more validated paths.

### 9.3 Solver Use in Edit Mode

The Solve button validates the current level structure and required metrics, then searches for valid solutions.

Outcomes:

- If solutions are found, display/copy/store them as hint paths.
- If no solution is found within budget, report that clearly without automatically declaring the puzzle impossible.
- If the level structure is invalid, show validation reasons before or instead of searching.

### 9.4 Solver Use in Review Mode

During approval, the app should try to produce or validate a hint path. If no solution is found, the reviewer may be asked to confirm whether to publish anyway.

### 9.5 Determinism and Work-Based Budgets

Solver behavior should be deterministic for a given level, solver configuration, and budget. Running the same solver on the same input should visit equivalent search states in the same order, apply the same tie-breaks, and return the same result path/status regardless of machine speed, browser, operating system, or incidental scheduling differences.

To support this, solver limits should be expressed primarily as work-based budgets rather than wall-clock budgets. Examples of acceptable work units include expanded states, generated candidates, search phases, queue pops, depth iterations, validation checks, or another stable unit chosen by the solver. Wall-clock timers may still be used for UI responsiveness, cancellation, or a coarse safety cap, but they should not be the primary source of search variability when deciding which candidate paths are explored.

Determinism expectations:

- Use stable ordering for gates, moves, portal handling, object lists, candidate scoring tie-breaks, and any priority queues or beam-frontier selection.
- Avoid unseeded randomness. If randomness is ever part of search, expose the seed and include it in solver telemetry.
- Report budget exhaustion distinctly from proof of impossibility. A deterministic budget miss means only that no solution was found within the selected work budget.
- Include telemetry that makes runs comparable, such as work units consumed, attempts/profiles tried, stop reason, solution path when found, and any validation errors.
- Ensure that hint generation, editor solving, review validation, and automated audits all validate returned paths through the same solution-validity rules used by player win detection.

### 9.6 Solver Harnesses and Regression Tools

A Pathfinder codebase should include command-line harnesses/scripts that let developers and AI coding agents run the solver outside the browser, compare outputs, and diagnose regressions without manually operating the UI. The current project includes representative tools with these purposes:

- A direct SolverV2 runner that loads built-in levels, accepts a level/range/all selector and a budget option, runs the solver, prints per-level outcomes, and writes a structured JSON result file.
- Audit export and audit-check scripts that run broader solver sweeps, persist telemetry, and verify that audit output has the expected shape and invariants.
- A hint-path oracle/replay style harness that validates stored hint paths against the same core movement and win-condition rules, so known-good paths can catch solver or rule regressions.
- Diagnostic scripts for difficult or failing levels that compare solver telemetry against known hints/frontiers and summarize where the search is spending or exhausting its budget.
- Related smoke/unit tests for domain rules, editor validation, startup/persistence wiring, and solver-adjacent tools such as false-goal trap search.

Any AI coder extending or replacing the solver should build and maintain equivalent local tools for itself before making substantial solver changes. These tools should be easy to run from the command line, accept targeted level filters for quick iteration, support full-suite runs for regression confidence, write machine-readable output for comparison, and separate deterministic solver work budgets from optional wall-clock safety limits.

---

## 10. What Makes a Puzzle Valid

Puzzle validity is structural validity. It means the level is well-formed enough to submit/review/play. It is separate from solution validity, though submission should also attempt to find at least one solution.

A structurally valid level must satisfy the requirements below. Validation should report actionable reasons, not merely a generic failure. Validation may be stricter for submission/review than for loading historical built-in levels, but no invalid structure should be silently treated as a solved or published-ready puzzle.

### 10.1 Required Core Fields

- Grid exists with positive width and height.
- At least one gate exists.
- Exactly one true goal exists.
- Required length and crossings are numeric and non-negative.
- All portal pairs are complete.

### 10.2 Bounds

Every object coordinate must be inside the grid:

- gates
- true goal
- false goals
- blocks
- geese
- must-pass
- must-cross
- filters
- flipping filters
- portal terminals

### 10.3 Object Conflicts

A valid level should not contain impossible or contradictory object overlaps. In particular:

- Must-cross cannot overlap a block.
- The true goal should not be absent or outside the grid.
- Portal terminals must pair with valid destinations.
- Pending/incomplete portal terminals are invalid.

A robust editor should prevent most illegal overlaps at placement time.

### 10.4 Must-Cross Structural Checks

For each must-cross cell:

- It must not be on the grid edge.
- It must not overlap a block.
- No orthogonally adjacent cell should be a block.
- No orthogonally adjacent cell should be a goose.
- A vertical filter immediately left or right of the must-cross should be invalid because it blocks horizontal crossing approaches.
- A horizontal filter immediately above or below the must-cross should be invalid because it blocks vertical crossing approaches.
- Flipping filters that would block the same required approaches should be invalid unless there is a free flipping filter elsewhere that can change the relevant filter state before reaching the must-cross.
- Filters diagonally adjacent to a must-cross should be treated as invalid because they tend to create misleading/blocked crossing geometry.

### 10.5 Accessibility

- Every gate must have at least one open orthogonal side to leave through.
- The true goal must have at least one open orthogonal side to enter through.
- Every must-pass cell must have at least two open sides so a path can enter and leave it.
- The grid must not be partitioned by blocks such that no gate can reach the goal by ordinary connectivity. Portal connectivity may be included for reachability.

### 10.6 Duplicate Detection for Submitted Levels

When Firebase is available, submission should reject duplicate levels already present in pending submissions or approved/published levels.

Duplicate detection should be based on a canonical structural fingerprint that ignores non-structural metadata where appropriate. Hints may be encoded for storage but should not make two otherwise identical levels count as distinct.

The fingerprint should include the structural geometry and win requirements: grid size, required length/crossings, gates, true goal, false goals, blocks, must-pass cells, must-cross cells, filters and their axes, flipping filters and their axes, portal terminal pairs, and geese. It should ignore designer name, description, difficulty, hint contents, timestamps, submitter identity, published sort order, and other review metadata. Object ordering in arrays should not affect the fingerprint.

### 10.7 Submitted-Level Solvability Expectations

A level can be structurally valid but not proven solvable within the current solver budget. Submission and review should distinguish these states clearly:

- Structural validation failure blocks submission/approval until fixed or intentionally overridden by an admin workflow.
- A confirmed solution/hint is strong evidence that the level is publishable and should be stored if available.
- Solver timeout or budget exhaustion is not proof of impossibility. It should be reported as "no solution found within budget" rather than "unsolvable."
- Normal user submissions may be queued for manual review even if no solution is found, provided the app communicates that status.
- Admin review should revalidate hints and may request confirmation before approving a level without a valid stored hint.

---

## 11. What Makes a Solution Valid

A solution-valid path is a complete path that solves a structurally valid level.

A valid solution must satisfy:

1. The path contains at least two nodes.
2. The first node is one of the level's gates.
3. Every step is legal under the move rules.
4. Every ordinary move is orthogonally adjacent.
5. Every portal entry is followed immediately by the paired destination.
6. Portal jumps do not contribute to counted length.
7. The path never enters blocks.
8. The path does not illegally re-enter gates.
9. The path does not move after reaching the true goal.
10. The path does not use portal terminals illegally or repeatedly.
11. The path respects normal filters and active flipping-filter axes.
12. The path does not turn illegally on a flipping filter.
13. The path avoids goose hazard cells in the final solution.
14. The path does not finish at a false goal.
15. The last node is the true goal.
16. Counted length equals `reqLen`.
17. Intersection count equals `reqInt`.
18. Every must-pass cell was visited.
19. Every must-cross cell was crossed/intersected.
20. No blocked T-intersection or segment reuse exists.

Candidate paths in hints, solver output, review approval, and win detection should all be checked against the same solution-validity rules.

---

## 12. Review Mode

Review Mode is an administrative mode for reviewing user-submitted levels and managing published levels. It shares the editor grid and object-editing capabilities, but its workflow and buttons differ.

### 12.1 Access Control

Review Mode requires admin authentication through Firebase/Google sign-in.

- Show an auth overlay asking the reviewer to sign in.
- Only the authorized admin account should be allowed to review submissions.
- If sign-in fails or the account is unauthorized, show an access-denied message and do not load review controls.

### 12.2 Loading Pending Submissions

After authentication:

- Load pending submissions from Firebase in oldest-first order.
- Show a loading modal/status while fetching.
- If there are no pending submissions, show an empty-review message on the grid.
- Each submission contains stored `levelData`, submitter ID, submission time, and a level fingerprint if available.

### 12.3 Reviewing a Pending Level

A pending level opens in the shared editor grid as a working level. The reviewer can:

- Inspect the grid and metadata.
- Modify the level using the same editor tools.
- Adjust required length/crossings.
- Run the solver.
- View/add/validate hints.
- Reject the submission.
- Approve/publish the submission.

Review Mode should clearly indicate that the reviewer is editing a pending submission, not a built-in level.

### 12.4 Review Mode Buttons

Review Mode uses the editor button area, with review-specific controls visible:

- **Guide:** editor guide.
- **New/Clear/BOMBS?/Solve:** may remain available depending on reviewer workflow.
- **Hint:** inspect or generate hints associated with the working level.
- **Submit:** save reviewer modifications back into the review workflow if applicable.
- **Reject:** delete the pending submission without publishing.
- **Approve:** publish the working level and remove the pending submission.
- **View Published Levels:** open published-level management.

### 12.5 Approving a Submission

Approval should:

1. Validate the working level structure.
2. Validate existing hints and remove invalid/duplicate hints.
3. Try to find a solver hint if no valid hint exists.
4. If no solution/hint is found, ask the reviewer to confirm publishing anyway.
5. Save the level into the published-level collection with a sort order.
6. Delete the corresponding pending submission.
7. Advance to the next pending submission or show the empty-review state.

Published levels should include the level data, encoded hints, a canonical fingerprint, an approval timestamp, and a sort order.

### 12.6 Rejecting a Submission

Rejecting should:

- Confirm or immediately delete the pending submission according to the app's UX choice.
- Remove it from the pending queue.
- Advance to the next pending submission or show the empty-review state.

### 12.7 Published-Level Management

The published-level modal allows admins to:

- List approved Firestore levels in served order.
- View identifying information for each published level.
- Select one or more published levels.
- Refresh the list.
- Delete selected published levels.
- Close the modal and return to review.

Deleting published levels should affect only the published collection, not local `levels.js`.

---

## 13. Submission Workflow

Normal users can submit levels built in Edit Mode.

### 13.1 Submission Modal

Submission should show a multi-step status modal with these stages:

1. Validate structure.
2. Check duplicates.
3. Find solutions.
4. Save to server.

Each stage should indicate pending/running/success/failure and include helpful details on failure.

### 13.2 Submission Requirements

To submit:

- Firebase must be available.
- The user must be signed in or sign-in must occur as part of submission; anonymous authentication is sufficient unless the deployment requires a stronger provider.
- The level must be structurally valid.
- Required length must be set to a positive integer.
- Required crossings must be set to a non-negative integer.
- Duplicate checks should pass unless explicitly bypassed by an admin-only workflow. If part of the duplicate check cannot run, the app should show that limitation as a warning or error rather than hiding it.
- The app should attempt to provide at least one solution/hint. It should validate any existing editor hints, current solver-found hints, and the currently drawn candidate path before running a solver.
- If the user has drawn a valid solution or the solver finds one, include it as a hint.
- If no solution is found within budget, submission may still be allowed for manual review if the app clearly communicates that no solution was found.
- Only validated, unique hint paths should be saved with the submission.

### 13.3 Stored Submission Data

Store pending submissions under an app-specific Firebase root with:

- `levelData`: serialized level data compatible with `levels.js` shape.
- encoded hints, either inside `levelData.hints` or in a companion field, safely stored for Firestore if needed.
- `levelFingerprint`: canonical structural fingerprint.
- `fingerprintVersion`.
- `submittedAt`: server timestamp.
- `submittedBy`: Firebase user ID.

Remote storage should encode hint arrays in a format that survives Firestore serialization and can be decoded back into the same path-node sequences. Loading submissions or published levels should decode those hints before validation or display.

---

## 14. Options Menu

The Options menu is a modal with an options page and a theme-selection page.

### 14.1 Sound Option

- **Mute:** when enabled, game audio is silenced.
- This should stay synchronized with any visible mute button.
- The preference should persist locally.

### 14.2 Challenge Visibility Options

- **Geese:** show or hide goose hazard squares in Play Mode.
- **False Goals:** show or hide false-goal trap squares in Play Mode.
- **Dead Gates:** show or hide parity-invalid/dead gates in Play Mode.

These options are not mere visual cosmetics: hiding a challenge type changes the temporary playable copy of a level:

- Hiding geese removes goose hazards from the playable copy, so goose cells should no longer surprise or block the player in that attempt.
- Hiding false goals removes false-goal trap objects from the playable copy, so they should not detonate.
- Hiding dead gates removes parity-invalid gates from the playable copy when simple parity analysis is reliable. If every gate would be removed, the level is incompatible with the option and the app should show an Options Conflict modal rather than presenting an unsolvable no-gate level.

If the current level conflicts with active options, show an Options Conflict modal and offer to move to the next compatible level.

Edit and Review modes should generally show all objects because creators/reviewers need full structural visibility. Options should not permanently mutate the built-in, submitted, or published source level data.

### 14.3 Theme Selection

The Options menu includes **Select Theme**, which opens a theme grid. Selecting a theme applies it immediately and persists the choice locally.

---

## 15. Theme System

Pathfinder has a seed-based theme system. Themes are not just a few colors; they generate a complete set of semantic color tokens used throughout the app.

### 15.1 Theme Definition

A theme may be defined as:

```js
{
  seeds: {
    bg: '#...',
    surface: '#...',
    primary: '#...',
    secondary: '#...',
    neutral: '#...',
    text: '#...',
    border: '#...',
    path: '#...' | 'rainbow'
  },
  overrides: {
    // optional semantic token overrides
  }
}
```

`themes.js` should provide `window.THEMES`, a registry of named themes. The app should also have a safe default theme if `themes.js` fails to load.

### 15.2 Seed Meanings

- `bg`: application background.
- `surface`: panels/canvas base.
- `primary`: main header/action color.
- `secondary`: goal/header contrast/action color.
- `neutral`: grid lines, blocks, utility surfaces.
- `text`: base text color.
- `border`: panel and control borders.
- `path`: drawn path color, or `rainbow` for animated/multicolor path behavior.

### 15.3 Derived Tokens

From seed colors, derive semantic tokens for:

- body background
- canvas background
- grid lines
- gate color
- goal color
- block color and block details
- path color
- portal color
- filter and must-cross colors
- modal backgrounds, borders, accent text, muted text
- loading/search overlays
- header regions and navigation buttons
- editor palette colors
- action buttons: guide, hint, undo, reset, solve, submit, approve, reject, bombs
- output/code panels
- win modal
- hazard/jumpscare overlays
- shell buttons such as Options and mode toggle

Derived colors should maintain adequate contrast. The theme engine should choose readable text colors based on background luminance/contrast rather than assuming white or black always works.

### 15.4 Overrides

A theme may provide overrides for any semantic token group. Overrides are applied after derivation and should allow special themes to customize individual colors without redefining the whole token set.

### 15.5 Applying a Theme

When a theme is selected:

1. Normalize the theme.
2. Derive semantic tokens from seeds.
3. Apply overrides.
4. Write semantic tokens to the app's styling system.
5. Update the theme-selection UI to mark the active theme.
6. Persist the chosen theme.
7. Redraw the grid so canvas-rendered objects reflect the new theme.

### 15.6 Random/Generated Themes

The theme engine may support random seed generation. Generated themes should still pass through the same derivation and contrast safeguards as named themes.

---

## 16. Guide and Informational Modals

### 16.1 Gameplay Guide Modal

The Guide modal in Play Mode explains the goal and all major object types.

It should convey:

- Draw a line from a gate to the goal.
- The line must be exactly as long and as twisty/crossed as specified.
- Gate: start point; only one active gate per attempt; reset/undo to try another.
- Goal: destination; one true goal.
- False goals: decoy/trap goals.
- Blocks: obstacles.
- Must-pass cells: must be visited.
- Filters: one-axis traffic rules; some filters flip.
- Portals: teleport to the paired portal; portal parity can affect editor warnings.
- Must-cross cells: require an intersection in that square.
- Geese: danger/hazard.
- Attribution/credits if desired.

### 16.2 Editor Guide Modal

The Editor Guide explains creator workflows:

- Pick a palette tool and place objects on the grid.
- Drag objects into position or off-grid to remove them.
- Use the pencil to sketch/test paths.
- Use BOMBS? to highlight possible false-goal trap positions.
- Use Solve to find valid solutions after setting required metrics.
- Understand parity warnings on gates/portal terminals.
- Submit levels for review once complete.
- Valid drawn/solver solutions may be included automatically as hints.

### 16.3 Solver/Search Modal

The solver modal conveys active search state:

- task title
- detail text
- timer
- progress bar/percentage
- activity dots/spinner
- close/cancel button

### 16.4 Submission Modal

The submission modal conveys submission pipeline state:

- validating structure
- duplicate checking
- solving/finding hints
- saving to server
- close/dismiss on completion or failure

### 16.5 Win Modal

The win modal conveys success:

- strong success message such as "Path Found".
- next-level action.
- rest/stay action.
- optional winning-path export/copy area.

### 16.6 Unsaved Changes Modal

When leaving an edited level with unsaved changes, the app asks whether the user wants to stay or leave.

### 16.7 Options Conflict Modal

When current Play Mode options make a level unplayable or incompatible, explain that conflict and offer to go to the next compatible level.

---

## 17. Persistence and Progress

### 17.1 Local Persistence

The app should persist locally:

- selected theme
- sound mute state
- challenge visibility options
- player progress/completed levels
- any temporary session state that improves continuity without corrupting levels

### 17.2 Remote Persistence

Firebase-backed persistence supports:

- anonymous or provider-backed user identity for submissions.
- pending submissions collection.
- published levels collection.
- duplicate checks by fingerprint and fallback structural comparison.
- admin-only review operations.

If remote published levels are available, the app may append or merge them into the playable level list after built-in levels. If remote loading fails, built-in `levels.js` should remain playable.

### 17.3 Persistence Failure Behavior

Persistence failures should degrade gracefully:

- If Firebase initialization, authentication, reads, or writes fail, local play and local editing should continue.
- Submission/review/published-level management should show clear failure or disabled states rather than pretending the operation succeeded.
- Local storage parse errors should not crash the app; invalid saved preferences/progress/session state should be ignored or reset to safe defaults.
- Cloud session/progress sync should merge conservatively, avoid overwriting newer local state with stale remote state, and tolerate missing or partial remote documents.
- Network timeouts should be reported distinctly from validation failures and duplicate-level findings.

---

## 18. Audio and Feedback

Audio is optional but part of the intended feel.

Recommended feedback:

- short sound for normal move
- different sound for backtrack/undo
- portal sound for teleport
- low/impact sound for goose hazard
- celebratory or completion feedback on win

All audio must respect mute settings.

Visual feedback should include:

- path drawing as the player moves
- live metrics update
- satisfied/unsatisfied required cells
- portal ripple/teleport indication
- hazard overlays
- invalid move non-extension
- completion burst/success state

---

## 19. Accessibility and Input Expectations

A compatible app should support:

- pointer/touch input for tap and drag path drawing.
- keyboard focus on the grid where practical.
- clear buttons with accessible labels or text.
- enough contrast through theme derivation.
- status messages for loading, validation, submission, and review.
- controls sized for touch interaction.

Gamepad support may be included: if implemented, it should move a cursor/selection across the grid, start paths at gates, extend paths with directional input, and activate buttons/menus.

---

## 20. Level Export Format

The editor should be able to serialize a level back into a compact object compatible with `levels.js`.

Exported level data should include:

- `grid`
- `gates`
- `goal`
- `falseGoals`
- `reqLen`
- `reqInt`
- `designerName`
- `description`
- `difficulty`
- `blocks`
- `mustPass`
- `mustCross`
- `filters`
- `flippingFilters`
- `portals`
- `geese`
- `hints`

Coordinates should be 1-based in exported data. Hints may use the app's compact path-key representation, but any rebuilt app should consistently validate and decode the hint paths it produces.

Export should produce a complete self-contained level object, not a diff from the current built-in level. Empty object arrays may be included explicitly for clarity. The exported object should be suitable for pasting into `levels.js`, submitting to Firebase, approving into published levels, and re-importing without changing the puzzle's structural fingerprint.

---

## 21. High-Level User Journeys

### 21.1 Solve a Level

1. Player opens the app.
2. App loads themes, built-in levels, optional remote levels, and persisted preferences.
3. Player sees level 1 in Play Mode.
4. Player starts from a gate and draws a path.
5. Metrics update live.
6. Player uses undo/reset/hint/options as needed.
7. Player reaches the goal with exact metrics and obligations.
8. Win modal appears.
9. Player advances or stays.

### 21.2 Create and Submit a Level

1. Player switches to Edit Mode.
2. Player creates a level using the palette and grid tools.
3. Player sets required length/crossings directly or from a drawn candidate path.
4. Player adds metadata.
5. Player opens the editor guide or uses BOMBS?/Solve as needed.
6. Player clicks Submit.
7. App validates structure, checks duplicates, searches for solutions/hints, and saves to Firebase.
8. Submission awaits admin review.

### 21.3 Review a Submission

1. Admin enters Review Mode and signs in.
2. App loads pending submissions.
3. Admin inspects and optionally edits the working level.
4. Admin solves/validates hints.
5. Admin rejects or approves.
6. Approval publishes the level and removes it from pending submissions.
7. Admin can manage already published levels from the published-level modal.

---

## 22. Non-Goals and Implementation Freedom

A reimplementation does not need to match:

- exact CSS classes
- exact SVG artwork
- exact animation timings
- exact file/module structure
- exact solver algorithm
- exact rendering technology
- exact sound synthesis technology

A reimplementation must preserve:

- level data compatibility
- path and object rules
- exact win conditions
- editor/review/submission workflows
- options and theme semantics
- guide/solver/submission/review modal content purposes
- Firebase-backed submission/review behavior when configured

