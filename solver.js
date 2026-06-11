// solver.js – Deterministic work-budget solver (iterative deepening DFS).
'use strict';

// Move directions: fixed order for determinism
const DIRS = [
    { dx: 1,  dy: 0  },  // right
    { dx: 0,  dy: 1  },  // down
    { dx: -1, dy: 0  },  // left
    { dx: 0,  dy: -1 },  // up
];

class SolverV2 {
    /**
     * @param {object} level – normalised level object
     * @param {object} opts
     *   budget      {number}  max node expansions (default 500_000)
     *   maxSolutions {number} stop after this many found (default 1)
     *   onProgress  {fn}      called periodically with { workUsed, found }
     */
    constructor(level, opts = {}) {
        const E = window.Engine;
        this.level        = E.normaliseLevel(level);
        this.budget       = opts.budget       ?? 500_000;
        this.maxSolutions = opts.maxSolutions ?? 1;
        this.onProgress   = opts.onProgress   || null;
        this.cancelled    = false;
        this.workUsed     = 0;
        this.solutions    = [];
        this._progressInterval = 5000;

        // pre-build lookup caches
        this.blockSet    = E.makeBlockSet(this.level);
        this.gateSet     = E.makeGateSet(this.level);
        this.falseGoalSet= E.makeFalseGoalSet(this.level);
        this.geeseSet    = E.makeGeeseSet(this.level);
        this.mustPassSet = E.makeMustPassSet(this.level);
        this.mustCrossSet= E.makeMustCrossSet(this.level);
        this.portalMap   = E.makePortalMap(this.level);
        this.filterMap   = E.makeFilterMap(this.level);
        this.goalKey     = this.level.goal ? E.packKey(this.level.goal.x, this.level.goal.y) : -1;
        this.packKey     = E.packKey;
        this.unpackKey   = E.unpackKey;
    }

    cancel() { this.cancelled = true; }

    /**
     * Run solver. Returns { found, paths, workUsed, reason }.
     */
    solve() {
        this.cancelled  = false;
        this.workUsed   = 0;
        this.solutions  = [];

        const level = this.level;

        // Try each gate as starting point
        for (const gate of level.gates) {
            if (this.cancelled) break;
            if (this.solutions.length >= this.maxSolutions) break;
            this._dfs(gate);
        }

        const reason = this.cancelled                   ? 'cancelled'
                     : this.workUsed >= this.budget     ? 'budget_exhausted'
                     : this.solutions.length > 0        ? 'found'
                                                        : 'no_solution';

        return {
            found:    this.solutions.length > 0,
            paths:    this.solutions,
            workUsed: this.workUsed,
            reason,
        };
    }

    _dfs(startGate) {
        const { packKey } = this;
        const reqLen  = this.level.reqLen;
        const reqInt  = this.level.reqInt;
        const { w, h } = this.level.grid;

        // Stack-based iterative DFS to avoid stack overflow on large grids.
        // State: { x, y, length, intersections, flipGlobal, visitCount, axisH, axisV,
        //          mustPassSat, mustCrossSat, portalUsed, path, portalJumps }

        const initState = {
            x: startGate.x, y: startGate.y,
            length: 0, intersections: 0, portalJumps: 0,
            flipGlobal: 0,
            visitCount:   new Map([[packKey(startGate.x, startGate.y), 1]]),
            axisH:        new Set(),
            axisV:        new Set(),
            mustPassSat:  new Set(this.mustPassSet.has(packKey(startGate.x, startGate.y)) ? [packKey(startGate.x, startGate.y)] : []),
            mustCrossSat: new Set(),
            portalUsed:   new Set(),
            path:         [{ x: startGate.x, y: startGate.y }],
        };

        const stack = [initState];

        while (stack.length > 0) {
            if (this.cancelled || this.workUsed >= this.budget) return;
            if (this.solutions.length >= this.maxSolutions) return;

            const st = stack.pop();
            this.workUsed++;

            if (this.onProgress && this.workUsed % this._progressInterval === 0) {
                this.onProgress({ workUsed: this.workUsed, found: this.solutions.length });
            }

            const { x, y, length, intersections, portalJumps, flipGlobal, path,
                    visitCount, axisH, axisV, mustPassSat, mustCrossSat, portalUsed } = st;

            // Check for pending portal jump from current position
            const curKey = packKey(x, y);
            const portalDest = this.portalMap.get(curKey);
            if (portalDest && !portalUsed.has(curKey)) {
                // Must follow portal jump immediately
                const { x: dx, y: dy } = portalDest;
                const dk = packKey(dx, dy);
                if (!this.blockSet.has(dk)) {
                    const nv = new Map(visitCount);
                    nv.set(dk, (nv.get(dk) || 0) + 1);
                    const npu = new Set(portalUsed);
                    npu.add(curKey);
                    npu.add(dk); // mark destination as used too
                    const nMPS = new Set(mustPassSat);
                    if (this.mustPassSet.has(dk)) nMPS.add(dk);
                    const nPJ = portalJumps + 1;
                    const nLen = path.length - 1 - nPJ; // recompute
                    if (nLen <= reqLen) {
                        stack.push({
                            x: dx, y: dy, length: nLen, intersections, portalJumps: nPJ,
                            flipGlobal,
                            visitCount: nv, axisH: new Set(axisH), axisV: new Set(axisV),
                            mustPassSat: nMPS, mustCrossSat: new Set(mustCrossSat),
                            portalUsed: npu,
                            path: [...path, { x: dx, y: dy }],
                        });
                    }
                }
                continue; // portal jump is mandatory
            }

            // Pruning: can't exceed required length
            if (length > reqLen) continue;

            // Check goal
            if (curKey === this.goalKey) {
                if (length === reqLen && intersections === reqInt) {
                    let allMP = true;
                    for (const k of this.mustPassSet) { if (!mustPassSat.has(k)) { allMP = false; break; } }
                    let allMC = true;
                    for (const k of this.mustCrossSet) { if (!mustCrossSat.has(k)) { allMC = false; break; } }
                    if (allMP && allMC) {
                        this.solutions.push([...path]);
                    }
                }
                continue; // don't extend past goal
            }

            // Try each direction
            for (const { dx, dy } of DIRS) {
                const nx = x + dx, ny = y + dy;
                if (nx < 1 || ny < 1 || nx > w || ny > h) continue;
                const nk = packKey(nx, ny);

                if (this.blockSet.has(nk)) continue;
                if (this.geeseSet.has(nk)) continue;           // geese are hazards
                if (this.gateSet.has(nk)) continue;            // no gate re-entry

                const axis = (dy === 0) ? 1 : 2;

                // Filter checks: active axis depends on global flip counter
                const hFilter = this.filterMap.get(curKey);
                if (hFilter) {
                    const allowed = this._activeAxis(hFilter, flipGlobal);
                    if (axis !== allowed) continue;
                }
                const dFilter = this.filterMap.get(nk);
                if (dFilter) {
                    const allowed = this._activeAxis(dFilter, flipGlobal);
                    if (axis !== allowed) continue;
                }

                // Segment reuse check
                const prevVisits = visitCount.get(nk) || 0;
                if (prevVisits > 0) {
                    const usedH = axisH.has(nk);
                    const usedV = axisV.has(nk);
                    if (axis === 1 && usedH) continue;
                    if (axis === 2 && usedV) continue;
                }

                // False goal trap check: skip if would detonate
                if (this.falseGoalSet.has(nk)) {
                    const newLen = length + 1;
                    let newInt = intersections;
                    if (prevVisits > 0) newInt++;
                    if (newLen === reqLen && newInt === reqInt) {
                        // Would detonate – skip for solver
                        let wouldWin = true;
                        for (const k of this.mustPassSet) {
                            const nMPS2 = new Set(mustPassSat);
                            if (this.mustPassSet.has(nk)) nMPS2.add(nk);
                            if (!nMPS2.has(k)) { wouldWin = false; break; }
                        }
                        if (wouldWin) {
                            for (const k of this.mustCrossSet) {
                                const nMCS2 = new Set(mustCrossSat);
                                if (!nMCS2.has(k)) { wouldWin = false; break; }
                            }
                        }
                        if (wouldWin) continue; // skip trap cell when it would fire
                    }
                }

                const nLen = length + 1;
                if (nLen > reqLen) continue;

                // Compute new intersection count
                let nInt = intersections;
                const nMCS = new Set(mustCrossSat);
                if (prevVisits > 0 && nk !== this.goalKey) {
                    nInt++;
                    if (this.mustCrossSet.has(nk)) nMCS.add(nk);
                }
                if (nInt > reqInt) continue;

                // Build new state
                const nv  = new Map(visitCount);
                nv.set(nk, prevVisits + 1);
                const nAxH = new Set(axisH);
                const nAxV = new Set(axisV);
                if (axis === 1) { nAxH.add(curKey); nAxH.add(nk); }
                if (axis === 2) { nAxV.add(curKey); nAxV.add(nk); }

                // Flip filter: increment global counter when LEAVING a flip filter cell
                let nFlipGlobal = flipGlobal;
                const curFilter = this.filterMap.get(curKey);
                if (curFilter && curFilter.flipping) {
                    nFlipGlobal++;
                }

                const nMPS = new Set(mustPassSat);
                if (this.mustPassSet.has(nk)) nMPS.add(nk);

                stack.push({
                    x: nx, y: ny, length: nLen, intersections: nInt, portalJumps,
                    flipGlobal: nFlipGlobal,
                    visitCount: nv, axisH: nAxH, axisV: nAxV,
                    mustPassSat: nMPS, mustCrossSat: nMCS,
                    portalUsed: new Set(portalUsed),
                    path: [...path, { x: nx, y: ny }],
                });
            }
        }
    }

    _activeAxis(filterDef, flipGlobal) {
        if (!filterDef.flipping) return filterDef.axis;
        // Global flip counter: even → base axis, odd → flipped axis
        return (flipGlobal % 2 === 0) ? filterDef.axis : (filterDef.axis === 1 ? 2 : 1);
    }
}

window.SolverV2 = SolverV2;
