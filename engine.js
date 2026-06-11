// engine.js – Core game rules: path state, move validation, win detection, level normalisation.
'use strict';

// ─── Coordinate helpers ──────────────────────────────────────────────────────

function packKey(x, y) { return (x - 1) + ((y - 1) << 16); }          // 1-based → key
function unpackKey(k)   { return { x: (k & 0xFFFF) + 1, y: (k >> 16) + 1 }; }
function keyEq(a, b)    { return a.x === b.x && a.y === b.y; }

// ─── Level normalisation ──────────────────────────────────────────────────────

function normaliseLevel(raw) {
    const L = Object.assign({}, raw);
    L.grid         = L.grid   || { w: 8, h: 8 };
    L.gates        = (L.gates || []).map(c => ({ x: +c.x, y: +c.y }));
    L.goal         = L.goal   ? { x: +L.goal.x, y: +L.goal.y } : null;
    L.falseGoals   = (L.falseGoals   || []).map(c => ({ x: +c.x, y: +c.y }));
    L.blocks       = (L.blocks       || []).map(c => ({ x: +c.x, y: +c.y }));
    L.mustPass     = (L.mustPass     || []).map(c => ({ x: +c.x, y: +c.y }));
    L.mustCross    = (L.mustCross    || []).map(c => ({ x: +c.x, y: +c.y }));
    L.filters      = (L.filters      || []).map(f => ({ x: +f.x, y: +f.y, axis: +f.axis }));
    L.flippingFilters = (L.flippingFilters || []).map(f => ({ x: +f.x, y: +f.y, axis: +f.axis }));
    L.portals      = (L.portals || []).map(p => ({
        x1: +p.x1, y1: +p.y1, x2: +p.x2, y2: +p.y2,
        color: p.color || '#818cf8'
    }));
    L.geese        = (L.geese || []).map(c => ({ x: +c.x, y: +c.y }));
    L.reqLen       = (L.reqLen  != null) ? +L.reqLen  : 0;
    L.reqInt       = (L.reqInt  != null) ? +L.reqInt  : 0;
    L.designerName = L.designerName || '';
    L.description  = L.description  || '';
    L.difficulty   = (L.difficulty != null && L.difficulty !== '') ? +L.difficulty : null;
    L.hints        = decodeLevelHints(L.hints || []);
    return L;
}

function decodeLevelHints(rawHints) {
    if (!Array.isArray(rawHints)) return [];
    return rawHints.map(h => {
        if (!Array.isArray(h)) return null;
        // elements are either packed keys (numbers) or [x,y] pairs or {x,y} objects
        try {
            return h.map(node => {
                if (typeof node === 'number') {
                    return unpackKey(node);
                } else if (Array.isArray(node) && node.length >= 2) {
                    return { x: +node[0], y: +node[1] };
                } else if (node && typeof node === 'object') {
                    return { x: +node.x, y: +node.y };
                }
                return null;
            }).filter(Boolean);
        } catch { return null; }
    }).filter(h => h && h.length >= 2);
}

function encodeHintsForStorage(hints) {
    return hints.map(path => path.map(n => packKey(n.x, n.y)));
}

// ─── Level lookup helpers ─────────────────────────────────────────────────────

function makeBlockSet(level) {
    const s = new Set();
    for (const b of level.blocks) s.add(packKey(b.x, b.y));
    return s;
}

function makeGateSet(level) {
    const s = new Set();
    for (const g of level.gates) s.add(packKey(g.x, g.y));
    return s;
}

function makeFalseGoalSet(level) {
    const s = new Set();
    for (const fg of (level.falseGoals || [])) s.add(packKey(fg.x, fg.y));
    return s;
}

function makeGeeseSet(level) {
    const s = new Set();
    for (const g of (level.geese || [])) s.add(packKey(g.x, g.y));
    return s;
}

function makeMustPassSet(level) {
    const s = new Set();
    for (const c of level.mustPass) s.add(packKey(c.x, c.y));
    return s;
}

function makeMustCrossSet(level) {
    const s = new Set();
    for (const c of level.mustCross) s.add(packKey(c.x, c.y));
    return s;
}

// Build portal map: key→paired destination {x,y}
function makePortalMap(level) {
    const m = new Map();
    for (const p of (level.portals || [])) {
        const k1 = packKey(p.x1, p.y1);
        const k2 = packKey(p.x2, p.y2);
        m.set(k1, { x: p.x2, y: p.y2 });
        m.set(k2, { x: p.x1, y: p.y1 });
    }
    return m;
}

// filter map: key → axis (1=horiz, 2=vert); includes both normal and flipping
function makeFilterMap(level) {
    const m = new Map();
    for (const f of (level.filters || [])) m.set(packKey(f.x, f.y), { axis: f.axis, flipping: false });
    for (const f of (level.flippingFilters || [])) m.set(packKey(f.x, f.y), { axis: f.axis, flipping: true });
    return m;
}

// ─── Path State ───────────────────────────────────────────────────────────────

class PathState {
    constructor(level) {
        this.level       = level;
        this.nodes       = [];          // [{x,y}] 1-based
        this.portalJumps = 0;
        this.length      = 0;          // moves = nodes-1 - portalJumps
        this.intersections = 0;
        this.visitCount  = new Map();  // packedKey → count
        this.axisH       = new Set();  // keys traversed horizontally
        this.axisV       = new Set();  // keys traversed vertically
        this.flipGlobal  = 0;          // global flip-filter exit counter (shared by ALL flip filters)
        this.mustPassSat = new Set();  // keys satisfied
        this.mustCrossSat= new Set();  // keys satisfied
        this.portalUsed  = new Set();  // portal terminal keys already entered
        this.hazardActive= false;
        this.hazardCell  = null;
        this.trapActive  = false;
        this.trapCell    = null;

        // pre-build lookup structures
        this.blockSet    = makeBlockSet(level);
        this.gateSet     = makeGateSet(level);
        this.falseGoalSet= makeFalseGoalSet(level);
        this.geeseSet    = makeGeeseSet(level);
        this.mustPassSet = makeMustPassSet(level);
        this.mustCrossSet= makeMustCrossSet(level);
        this.portalMap   = makePortalMap(level);
        this.filterMap   = makeFilterMap(level);
        this.goalKey     = level.goal ? packKey(level.goal.x, level.goal.y) : -1;
    }

    clone() {
        const c = new PathState(this.level);
        c.nodes        = this.nodes.slice();
        c.portalJumps  = this.portalJumps;
        c.length       = this.length;
        c.intersections= this.intersections;
        c.visitCount   = new Map(this.visitCount);
        c.axisH        = new Set(this.axisH);
        c.axisV        = new Set(this.axisV);
        c.flipGlobal   = this.flipGlobal;
        c.mustPassSat  = new Set(this.mustPassSat);
        c.mustCrossSat = new Set(this.mustCrossSat);
        c.portalUsed   = new Set(this.portalUsed);
        c.hazardActive = this.hazardActive;
        c.hazardCell   = this.hazardCell;
        c.trapActive   = this.trapActive;
        c.trapCell     = this.trapCell;
        return c;
    }

    get head() { return this.nodes[this.nodes.length - 1] || null; }
    get size()  { return this.nodes.length; }

    isEmpty() { return this.nodes.length === 0; }

    isAtGoal() {
        const h = this.head;
        return h && this.goalKey === packKey(h.x, h.y);
    }

    getVisitCount(x, y) { return this.visitCount.get(packKey(x, y)) || 0; }

    _incVisit(x, y) {
        const k = packKey(x, y);
        this.visitCount.set(k, (this.visitCount.get(k) || 0) + 1);
    }

    _decVisit(x, y) {
        const k = packKey(x, y);
        const v = (this.visitCount.get(k) || 0) - 1;
        if (v <= 0) this.visitCount.delete(k);
        else this.visitCount.set(k, v);
    }

    // Determine movement axis: 1=horizontal, 2=vertical, 0=portal jump
    _moveAxis(from, to) {
        if (from.y === to.y && from.x !== to.x) return 1;
        if (from.x === to.x && from.y !== to.y) return 2;
        return 0; // portal jump (non-adjacent)
    }

    // Get the currently active axis for a filter cell
    _activeFilterAxis(fk) {
        const f = this.filterMap.get(fk);
        if (!f) return 0;
        if (!f.flipping) return f.axis;
        // Global flip counter: all flip filters share the same counter.
        // Odd count → flipped; even count → base axis.
        return (this.flipGlobal % 2 === 0) ? f.axis : (f.axis === 1 ? 2 : 1);
    }

    // Detect if moving from head to (nx,ny) is a portal jump.
    _isPortalJump(head, nx, ny) {
        const hk = packKey(head.x, head.y);
        if (!this.portalMap.has(hk)) return false;
        if (this.portalUsed.has(hk)) return false;
        const dest = this.portalMap.get(hk);
        return dest.x === nx && dest.y === ny;
    }

    // Can we move from current head to cell (nx,ny)?
    // Returns: { ok: boolean, reason?: string, isPortalJump?: boolean }
    canMoveTo(nx, ny, opts = {}) {
        if (this.hazardActive || this.trapActive) return { ok: false, reason: 'hazard' };
        const head = this.head;
        if (!head) return { ok: false, reason: 'no head' };

        const { w, h } = this.level.grid;
        const goalKey = this.goalKey;

        // Already at goal → no further movement
        if (packKey(head.x, head.y) === goalKey) return { ok: false, reason: 'at goal' };

        if (nx < 1 || ny < 1 || nx > w || ny > h) return { ok: false, reason: 'out of bounds' };

        const nk = packKey(nx, ny);
        const hk = packKey(head.x, head.y);

        // If at an unvisited portal terminal, ONLY the portal destination is valid
        if (this.portalMap.has(hk) && !this.portalUsed.has(hk)) {
            const dest = this.portalMap.get(hk);
            if (dest.x !== nx || dest.y !== ny) return { ok: false, reason: 'must take portal jump' };
            if (this.blockSet.has(nk)) return { ok: false, reason: 'portal dest blocked' };
            return { ok: true, isPortalJump: true };
        }

        // Block check
        if (this.blockSet.has(nk)) return { ok: false, reason: 'block' };

        // Gate re-entry (not allowed after start)
        if (this.gateSet.has(nk) && this.nodes.length > 0) {
            return { ok: false, reason: 'gate re-entry' };
        }

        // Orthogonality check
        if (Math.abs(nx - head.x) + Math.abs(ny - head.y) !== 1) return { ok: false, reason: 'non-adjacent' };

        const axis = this._moveAxis(head, { x: nx, y: ny });

        // Filter checks for the segment from head→(nx,ny)
        const headFilter = this.filterMap.get(hk);
        if (headFilter) {
            const allowed = this._activeFilterAxis(hk);
            if (axis !== allowed) return { ok: false, reason: 'filter axis' };
        }
        const destFilter = this.filterMap.get(nk);
        if (destFilter) {
            const allowed = this._activeFilterAxis(nk);
            if (axis !== allowed) return { ok: false, reason: 'filter axis dest' };
        }

        // Check for segment reuse (same edge already used)
        const visited = this.visitCount.get(nk) || 0;
        if (visited > 0) {
            const usedH = this.axisH.has(nk);
            const usedV = this.axisV.has(nk);
            if (axis === 1 && usedH) return { ok: false, reason: 'segment reuse H' };
            if (axis === 2 && usedV) return { ok: false, reason: 'segment reuse V' };
        }

        return { ok: true, isPortalJump: false };
    }

    // Check if pending portal jump is needed from head cell
    // Returns destination or null
    pendingPortalDest() {
        const h = this.head;
        if (!h) return null;
        const hk = packKey(h.x, h.y);
        // If head is an unvisited portal terminal
        if (this.portalMap.has(hk) && !this.portalUsed.has(hk)) {
            return this.portalMap.get(hk);
        }
        return null;
    }

    // Commit a move (no validation – call canMoveTo first). Returns hazard info.
    applyMove(nx, ny) {
        const prev = this.head;
        const nk = packKey(nx, ny);
        const isPortalJump = prev ? this._isPortalJump(prev, nx, ny) : false;
        const axis = isPortalJump ? 0 : this._moveAxis(prev, { x: nx, y: ny });

        this.nodes.push({ x: nx, y: ny });
        this._incVisit(nx, ny);

        if (isPortalJump) {
            this.portalJumps++;
            // Mark both terminals as used (spec: terminals not re-usable after any visit)
            this.portalUsed.add(packKey(prev.x, prev.y));
            this.portalUsed.add(nk);
        } else {
            this.length++;
            // Track axis usage for both endpoints of this segment
            if (axis === 1) { this.axisH.add(packKey(prev.x, prev.y)); this.axisH.add(nk); }
            if (axis === 2) { this.axisV.add(packKey(prev.x, prev.y)); this.axisV.add(nk); }

            // Flip filter: increment global counter when LEAVING any flip filter cell
            if (prev) {
                const prevFilter = this.filterMap.get(packKey(prev.x, prev.y));
                if (prevFilter && prevFilter.flipping) {
                    this.flipGlobal++;
                }
            }

            // Intersection detection
            const prevVisits = (this.visitCount.get(nk) || 0) - 1; // before this move
            if (prevVisits > 0) {
                const isGate = this.gateSet.has(nk);
                const isGoal = nk === this.goalKey;
                if (!isGate && !isGoal) {
                    this.intersections++;
                    if (this.mustCrossSet.has(nk)) this.mustCrossSat.add(nk);
                }
            }
        }

        // Must-pass satisfaction
        if (this.mustPassSet.has(nk)) this.mustPassSat.add(nk);

        this.length = this.nodes.length - 1 - this.portalJumps;

        // Hazard checks
        if (!isPortalJump) {
            const isGeese = this.geeseSet.has(nk);
            if (isGeese) {
                this.hazardActive = true;
                this.hazardCell = { x: nx, y: ny };
                return { hazard: 'goose', cell: { x: nx, y: ny } };
            }
        }

        // False goal trap (only when would-be win)
        if (this.falseGoalSet.has(nk) && this._wouldWinMetrics()) {
            this.trapActive = true;
            this.trapCell = { x: nx, y: ny };
            return { hazard: 'trap', cell: { x: nx, y: ny } };
        }

        return null;
    }

    _wouldWinMetrics() {
        const L = this.level;
        if (this.length !== L.reqLen) return false;
        if (this.intersections !== L.reqInt) return false;
        for (const k of this.mustPassSet) if (!this.mustPassSat.has(k)) return false;
        for (const k of this.mustCrossSet) if (!this.mustCrossSat.has(k)) return false;
        return true;
    }

    // Start a path at a gate
    startAt(x, y) {
        this.nodes = [{ x, y }];
        this.portalJumps = 0;
        this.length = 0;
        this.intersections = 0;
        this.visitCount = new Map();
        this.axisH = new Set();
        this.axisV = new Set();
        this.flipGlobal = 0;
        this.mustPassSat = new Set();
        this.mustCrossSat = new Set();
        this.portalUsed = new Set();
        this.hazardActive = false;
        this.hazardCell = null;
        this.trapActive = false;
        this.trapCell = null;
        this._incVisit(x, y);
        if (this.mustPassSet.has(packKey(x, y))) this.mustPassSat.add(packKey(x, y));
    }

    reset() {
        this.nodes = [];
        this.portalJumps = 0;
        this.length = 0;
        this.intersections = 0;
        this.visitCount = new Map();
        this.axisH = new Set();
        this.axisV = new Set();
        this.flipGlobal = 0;
        this.mustPassSat = new Set();
        this.mustCrossSat = new Set();
        this.portalUsed = new Set();
        this.hazardActive = false;
        this.hazardCell = null;
        this.trapActive = false;
        this.trapCell = null;
    }

    // Undo the last move; returns true if success
    undo() {
        if (this.nodes.length <= 1) { this.reset(); return true; }
        this.hazardActive = false;
        this.hazardCell = null;
        this.trapActive = false;
        this.trapCell = null;

        const removed = this.nodes.pop();
        const rk = packKey(removed.x, removed.y);
        const prev = this.nodes[this.nodes.length - 1];

        this._decVisit(removed.x, removed.y);

        const prevKey = prev ? packKey(prev.x, prev.y) : -1;
        const isPortalJump = prev &&
            this.portalMap.has(prevKey) &&
            this.portalMap.get(prevKey).x === removed.x &&
            this.portalMap.get(prevKey).y === removed.y;

        if (isPortalJump) {
            this.portalJumps--;
            this.portalUsed.delete(prevKey);
        } else if (prev) {
            const axis = this._moveAxis(prev, removed);
            // Remove axis marks ONLY if removed cell no longer has any traversal on that axis
            // (could have multiple crossings)
            if (axis === 1) {
                // check if axisH should stay for removed cell
                const stillH = this._cellStillUsesAxisH(removed);
                if (!stillH) this.axisH.delete(rk);
                const prevStillH = this._cellStillUsesAxisH(prev);
                if (!prevStillH) this.axisH.delete(packKey(prev.x, prev.y));
            }
            if (axis === 2) {
                const stillV = this._cellStillUsesAxisV(removed);
                if (!stillV) this.axisV.delete(rk);
                const prevStillV = this._cellStillUsesAxisV(prev);
                if (!prevStillV) this.axisV.delete(packKey(prev.x, prev.y));
            }

            // Flip filter undo: decrement global counter if we were leaving a flip filter
            const prevFilter = this.filterMap.get(packKey(prev.x, prev.y));
            if (prevFilter && prevFilter.flipping) {
                if (this.flipGlobal > 0) this.flipGlobal--;
            }
        }

        // Recompute derived metrics from scratch (simpler and more correct)
        this._recomputeMetrics();
        return true;
    }

    _cellStillUsesAxisH(cell) {
        // Check if any consecutive pair in nodes still traverses this cell horizontally
        const ck = packKey(cell.x, cell.y);
        for (let i = 1; i < this.nodes.length; i++) {
            const a = this.nodes[i - 1];
            const b = this.nodes[i];
            if ((packKey(a.x, a.y) === ck || packKey(b.x, b.y) === ck) &&
                a.y === b.y && a.x !== b.x) return true;
        }
        return false;
    }

    _cellStillUsesAxisV(cell) {
        const ck = packKey(cell.x, cell.y);
        for (let i = 1; i < this.nodes.length; i++) {
            const a = this.nodes[i - 1];
            const b = this.nodes[i];
            if ((packKey(a.x, a.y) === ck || packKey(b.x, b.y) === ck) &&
                a.x === b.x && a.y !== b.y) return true;
        }
        return false;
    }

    _recomputeMetrics() {
        // Recompute all derived state from this.nodes
        this.visitCount  = new Map();
        this.axisH       = new Set();
        this.axisV       = new Set();
        this.flipGlobal  = 0;
        this.mustPassSat = new Set();
        this.mustCrossSat= new Set();
        this.portalUsed  = new Set();
        this.portalJumps = 0;
        this.intersections = 0;

        const tempPortalUsed = new Set();
        for (let i = 0; i < this.nodes.length; i++) {
            const n = this.nodes[i];
            const nk = packKey(n.x, n.y);
            const prevCount = this.visitCount.get(nk) || 0;

            if (i > 0) {
                const p = this.nodes[i - 1];
                const pk = packKey(p.x, p.y);
                const isPortal = this.portalMap.has(pk) && !tempPortalUsed.has(pk) &&
                    this.portalMap.get(pk).x === n.x && this.portalMap.get(pk).y === n.y;
                if (isPortal) {
                    this.portalJumps++;
                    this.portalUsed.add(pk);
                    this.portalUsed.add(nk);
                    tempPortalUsed.add(pk);
                } else {
                    const axis = this._moveAxis(p, n);
                    if (axis === 1) { this.axisH.add(pk); this.axisH.add(nk); }
                    if (axis === 2) { this.axisV.add(pk); this.axisV.add(nk); }
                    // Flip filter: increment global counter on exit from any flip filter
                    const pFilter = this.filterMap.get(pk);
                    if (pFilter && pFilter.flipping) {
                        this.flipGlobal++;
                    }
                    // Intersection
                    if (prevCount > 0 && !this.gateSet.has(nk) && nk !== this.goalKey) {
                        this.intersections++;
                        if (this.mustCrossSet.has(nk)) this.mustCrossSat.add(nk);
                    }
                }
            }

            this.visitCount.set(nk, prevCount + 1);
            if (this.mustPassSet.has(nk)) this.mustPassSat.add(nk);
        }

        this.length = this.nodes.length - 1 - this.portalJumps;
        if (this.length < 0) this.length = 0;
    }

    checkWin() {
        if (this.hazardActive || this.trapActive) return false;
        if (this.nodes.length < 2) return false;
        const h = this.head;
        if (!h) return false;
        const hk = packKey(h.x, h.y);
        if (hk !== this.goalKey) return false;
        if (this.length !== this.level.reqLen) return false;
        if (this.intersections !== this.level.reqInt) return false;
        for (const k of this.mustPassSet) if (!this.mustPassSat.has(k)) return false;
        for (const k of this.mustCrossSet) if (!this.mustCrossSat.has(k)) return false;
        return true;
    }
}

// ─── Solution validation ──────────────────────────────────────────────────────

function validateSolution(level, pathNodes) {
    if (!Array.isArray(pathNodes) || pathNodes.length < 2) return { valid: false, reason: 'too short' };
    const norm = normaliseLevel(level);
    const state = new PathState(norm);
    const first = pathNodes[0];
    const gateSet = makeGateSet(norm);
    if (!gateSet.has(packKey(first.x, first.y))) return { valid: false, reason: 'does not start on gate' };
    state.startAt(first.x, first.y);
    for (let i = 1; i < pathNodes.length; i++) {
        const n = pathNodes[i];
        const check = state.canMoveTo(n.x, n.y);
        if (!check.ok) return { valid: false, reason: `illegal move at step ${i}: ${check.reason}` };
        const hazard = state.applyMove(n.x, n.y);
        if (hazard && hazard.hazard === 'goose') return { valid: false, reason: 'hits goose' };
        if (hazard && hazard.hazard === 'trap') return { valid: false, reason: 'hits false goal trap' };
    }
    if (!state.checkWin()) {
        return { valid: false, reason: `metrics not satisfied (len=${state.length}/${norm.reqLen} int=${state.intersections}/${norm.reqInt})` };
    }
    return { valid: true };
}

// ─── Structural validation ────────────────────────────────────────────────────

function validateLevelStructure(level) {
    const errors = [];
    const L = normaliseLevel(level);
    const { w, h } = L.grid;
    if (!w || !h || w < 1 || h < 1) errors.push('Grid must have positive width and height.');
    if (!L.gates.length) errors.push('Level must have at least one gate.');
    if (!L.goal) errors.push('Level must have exactly one goal.');
    if (L.reqLen == null || isNaN(L.reqLen) || L.reqLen < 0) errors.push('reqLen must be a non-negative integer.');
    if (L.reqInt == null || isNaN(L.reqInt) || L.reqInt < 0) errors.push('reqInt must be a non-negative integer.');

    const inBounds = c => c.x >= 1 && c.x <= w && c.y >= 1 && c.y <= h;
    const check = (arr, name) => { for (const c of arr) if (!inBounds(c)) errors.push(`${name} (${c.x},${c.y}) out of bounds.`); };
    check(L.gates, 'Gate');
    if (L.goal && !inBounds(L.goal)) errors.push('Goal out of bounds.');
    check(L.falseGoals, 'FalseGoal');
    check(L.blocks, 'Block');
    check(L.geese, 'Goose');
    check(L.mustPass, 'MustPass');
    check(L.mustCross, 'MustCross');
    check(L.filters, 'Filter');
    check(L.flippingFilters, 'FlippingFilter');
    for (const p of L.portals) {
        if (!inBounds({ x: p.x1, y: p.y1 })) errors.push(`Portal terminal (${p.x1},${p.y1}) out of bounds.`);
        if (!inBounds({ x: p.x2, y: p.y2 })) errors.push(`Portal terminal (${p.x2},${p.y2}) out of bounds.`);
    }

    return { valid: errors.length === 0, errors };
}

// ─── Fingerprint ─────────────────────────────────────────────────────────────

function levelFingerprint(level) {
    const L = normaliseLevel(level);
    const sortCoords = arr => arr.map(c => `${c.x},${c.y}`).sort().join(';');
    const sortFilters = arr => arr.map(f => `${f.x},${f.y},${f.axis}`).sort().join(';');
    const sortPortals = arr => arr.map(p => {
        const a = `${p.x1},${p.y1}`;
        const b = `${p.x2},${p.y2}`;
        return a < b ? `${a}>${b}` : `${b}>${a}`;
    }).sort().join(';');
    return [
        `${L.grid.w}x${L.grid.h}`,
        `len${L.reqLen}`,
        `int${L.reqInt}`,
        `gates:${sortCoords(L.gates)}`,
        `goal:${L.goal ? `${L.goal.x},${L.goal.y}` : ''}`,
        `fg:${sortCoords(L.falseGoals)}`,
        `bl:${sortCoords(L.blocks)}`,
        `mp:${sortCoords(L.mustPass)}`,
        `mc:${sortCoords(L.mustCross)}`,
        `fi:${sortFilters(L.filters)}`,
        `ff:${sortFilters(L.flippingFilters)}`,
        `po:${sortPortals(L.portals)}`,
        `ge:${sortCoords(L.geese)}`,
    ].join('|');
}

// Export for use in other modules
window.Engine = {
    normaliseLevel,
    decodeLevelHints,
    encodeHintsForStorage,
    PathState,
    validateSolution,
    validateLevelStructure,
    levelFingerprint,
    packKey,
    unpackKey,
    makeBlockSet,
    makeGateSet,
    makeFalseGoalSet,
    makeGeeseSet,
    makePortalMap,
    makeFilterMap,
    makeMustPassSet,
    makeMustCrossSet,
};
