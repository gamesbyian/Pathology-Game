// app.js – Main application: mode switching, play logic, edit logic, Firebase wiring.
'use strict';

// ─── App State ────────────────────────────────────────────────────────────────

const App = {
    mode: 'play',           // 'play' | 'edit' | 'review'
    currentLevelIndex: 0,
    levels: [],             // normalised built-in levels
    remoteLevels: [],       // from Firebase published collection
    allLevels: [],          // built-in + remote, used in play

    // Options
    opts: {
        mute:       false,
        showGeese:  true,
        showFalseGoals: true,
        showDeadGates: true,
        theme: 'Midnight',
    },

    // Play state
    playLevel:  null,
    pathState:  null,
    hintIndex:  -1,
    hintPinned: false,
    _hintAnimTimer: null,

    // Edit state
    editLevel:  null,
    editDirty:  false,
    editTool:   'gate',
    editPathState: null,
    pendingPortal: null,
    editHistory: [],

    // Review state
    reviewQueue: [],
    reviewIndex: 0,
    reviewLevel: null,
    fbUser:      null,

    // Firebase
    db: null,
    auth: null,

    // Renderer
    renderer: null,
    canvas:   null,

    // Solver handle
    activeSolver: null,
    solverWorkerTimer: null,
};

// ─── Boot ─────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
    loadPrefs();
    buildUI();
    applyThemeFromPrefs();
    loadBuiltInLevels();
    await initFirebase();
    if (App.db) await loadRemoteLevels();
    combineAllLevels();
    startPlayMode(App.currentLevelIndex);
    attachInputHandlers();
});

function loadPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem('pf_opts') || '{}');
        Object.assign(App.opts, saved);
        App.currentLevelIndex = parseInt(localStorage.getItem('pf_level') || '0', 10) || 0;
    } catch {}
}

function savePrefs() {
    try {
        localStorage.setItem('pf_opts', JSON.stringify(App.opts));
        localStorage.setItem('pf_level', String(App.currentLevelIndex));
    } catch {}
}

function loadBuiltInLevels() {
    const raw = window.RAW_LEVELS || [];
    App.levels = raw.map(l => window.Engine.normaliseLevel(l));
}

function combineAllLevels() {
    App.allLevels = [...App.levels, ...App.remoteLevels];
    if (App.currentLevelIndex >= App.allLevels.length) App.currentLevelIndex = 0;
}

function applyThemeFromPrefs() {
    window.ThemeEngine.applyTheme(App.opts.theme);
    markActiveTheme();
}

// ─── Firebase ─────────────────────────────────────────────────────────────────

async function initFirebase() {
    try {
        const cfg = JSON.parse(window.__firebase_config || 'null');
        if (!cfg) return;
        if (!window.firebase) return;
        if (!firebase.apps.length) firebase.initializeApp(cfg);
        App.db   = firebase.firestore();
        App.auth = firebase.auth();
        await App.auth.signInAnonymously().catch(() => {});
        App.auth.onAuthStateChanged(u => { App.fbUser = u; });
    } catch (e) {
        console.warn('Firebase init failed:', e);
    }
}

async function loadRemoteLevels() {
    try {
        const col = App.db.collection(`${window.__app_id}/publishedLevels`);
        const snap = await col.orderBy('sortOrder', 'asc').get();
        App.remoteLevels = snap.docs.map(d => {
            const data = d.data();
            const lvl  = window.Engine.normaliseLevel(data.levelData || data);
            lvl._remoteId = d.id;
            lvl._sortOrder = data.sortOrder || 0;
            return lvl;
        });
    } catch (e) {
        console.warn('Remote level load failed:', e);
    }
}

// ─── UI Building ─────────────────────────────────────────────────────────────

function buildUI() {
    document.body.innerHTML = `
<div id="shell">
  <header id="header">
    <div id="header-left">
      <span id="level-title">Level 1</span>
      <button id="btn-prev" class="nav-btn" title="Previous level">‹</button>
      <button id="btn-next" class="nav-btn" title="Next level">›</button>
    </div>
    <div id="metrics">
      <span id="metric-len" class="metric">Len: 0/0</span>
      <span id="metric-int" class="metric">× 0/0</span>
      <span id="metric-status"></span>
    </div>
    <div id="header-right">
      <button id="btn-options" class="shell-btn">Options</button>
      <button id="btn-mode"    class="shell-btn">Editor</button>
    </div>
  </header>

  <div id="canvas-wrapper">
    <canvas id="grid-canvas"></canvas>
  </div>

  <div id="controls-play">
    <button class="ctrl-btn" id="btn-guide">Guide</button>
    <button class="ctrl-btn" id="btn-hint">Hint</button>
    <span id="hint-counter" style="display:none;font-size:.82em;opacity:.75;margin:0 2px"></span>
    <button class="ctrl-btn" id="btn-hint-pin" style="display:none">Pin</button>
    <button class="ctrl-btn" id="btn-hint-clear" style="display:none">Clear</button>
    <button class="ctrl-btn" id="btn-whoa">Whoa</button>
    <button class="ctrl-btn" id="btn-undo">Undo</button>
    <button class="ctrl-btn" id="btn-reset">Reset</button>
  </div>

  <div id="controls-edit" style="display:none">
    <div id="palette-row">
      <button class="pal-btn" data-tool="gate">Gate</button>
      <button class="pal-btn" data-tool="goal">Goal</button>
      <button class="pal-btn" data-tool="falseGoal">FGoal</button>
      <button class="pal-btn" data-tool="block">Block</button>
      <button class="pal-btn" data-tool="goose">Goose</button>
      <button class="pal-btn" data-tool="mustPass">MPass</button>
      <button class="pal-btn" data-tool="mustCross">MCross</button>
      <button class="pal-btn" data-tool="filterH">FiltH</button>
      <button class="pal-btn" data-tool="filterV">FiltV</button>
      <button class="pal-btn" data-tool="flipH">FlipH</button>
      <button class="pal-btn" data-tool="flipV">FlipV</button>
      <button class="pal-btn" data-tool="portal">Portal</button>
      <button class="pal-btn" data-tool="pencil">Pencil</button>
      <button class="pal-btn" data-tool="eraser">Erase</button>
    </div>
    <div id="edit-metrics-row">
      <label>Len: <input type="number" id="edit-reqLen" min="0" value="0" style="width:50px"></label>
      <label>Int: <input type="number" id="edit-reqInt" min="0" value="0" style="width:40px"></label>
      <button class="ctrl-btn" id="btn-set-metrics" title="Set from drawn path">Set</button>
      <span id="edit-pencil-info" style="font-size:0.8em;opacity:0.7"></span>
    </div>
    <div id="edit-grid-row">
      <button class="ctrl-btn" id="btn-grid-minus">Grid−</button>
      <button class="ctrl-btn" id="btn-grid-plus">Grid+</button>
      <button class="ctrl-btn" id="btn-rotate">Rotate</button>
      <button class="ctrl-btn" id="btn-mirror">Mirror</button>
    </div>
    <div id="edit-action-row">
      <button class="ctrl-btn" id="btn-edit-guide">Guide</button>
      <button class="ctrl-btn" id="btn-edit-new">New</button>
      <button class="ctrl-btn" id="btn-edit-clear">Clear</button>
      <button class="ctrl-btn" id="btn-bombs">BOMBS?</button>
      <button class="ctrl-btn" id="btn-solve">Solve</button>
      <button class="ctrl-btn" id="btn-submit">Submit</button>
      <button class="ctrl-btn" id="btn-edit-undo">Undo</button>
    </div>
    <div id="meta-row">
      <input id="edit-designer" placeholder="Designer" maxlength="80" style="width:120px">
      <input id="edit-desc"     placeholder="Description" maxlength="160" style="width:180px">
      <input id="edit-diff"     placeholder="Diff 1-10" type="number" min="1" max="10" style="width:55px">
    </div>
    <textarea id="edit-output" rows="3" style="width:100%;font-size:0.75em;display:none;resize:vertical"></textarea>
    <div id="edit-output-btns" style="display:none">
      <button class="ctrl-btn" id="btn-copy-path">Copy Path</button>
      <button class="ctrl-btn" id="btn-copy-hints">Copy Hints</button>
    </div>
  </div>

  <div id="controls-review" style="display:none">
    <div id="review-action-row">
      <button class="ctrl-btn" id="btn-rev-guide">Guide</button>
      <button class="ctrl-btn" id="btn-rev-hint">Hint</button>
      <button class="ctrl-btn" id="btn-rev-solve">Solve</button>
      <button class="ctrl-btn" id="btn-rev-reject">Reject</button>
      <button class="ctrl-btn" id="btn-rev-approve">Approve</button>
      <button class="ctrl-btn" id="btn-rev-published">Published</button>
    </div>
  </div>
</div>

<!-- ── Modals ── -->
<div id="modal-overlay" style="display:none">
  <div id="modal-box">
    <div id="modal-content"></div>
  </div>
</div>

<!-- Win modal -->
<div id="win-modal" style="display:none">
  <div id="win-box">
    <div id="win-title">Path Found!</div>
    <div id="win-msg"></div>
    <div id="win-export-row" style="display:none;margin:.4em 0;font-size:.8em">
      <input id="win-path-export" readonly style="width:100%;font-family:monospace;font-size:.9em;padding:2px 4px">
      <button id="btn-win-copy-path" style="margin-top:3px;font-size:.8em">Copy Path</button>
    </div>
    <div id="win-btns">
      <button id="btn-win-next">Next Level</button>
      <button id="btn-win-stay">Stay</button>
    </div>
  </div>
</div>

<!-- Hazard overlay -->
<div id="hazard-modal" style="display:none">
  <div id="hazard-box">
    <div id="hazard-icon"></div>
    <div id="hazard-msg"></div>
    <button id="btn-hazard-undo">Undo</button>
    <button id="btn-hazard-reset">Reset</button>
  </div>
</div>
`;

    App.canvas = document.getElementById('grid-canvas');
    App.renderer = new GridRenderer(App.canvas);

    // Wire static buttons
    document.getElementById('btn-prev').addEventListener('click', prevLevel);
    document.getElementById('btn-next').addEventListener('click', nextLevel);
    document.getElementById('btn-options').addEventListener('click', openOptions);
    document.getElementById('btn-mode').addEventListener('click', toggleMode);
    document.getElementById('btn-guide').addEventListener('click', openPlayGuide);
    document.getElementById('btn-hint').addEventListener('click', showHint);
    document.getElementById('btn-hint-pin').addEventListener('click', pinHint);
    document.getElementById('btn-hint-clear').addEventListener('click', clearHint);
    document.getElementById('btn-whoa').addEventListener('click', toggleWhoa);
    document.getElementById('btn-undo').addEventListener('click', undoMove);
    document.getElementById('btn-reset').addEventListener('click', resetPath);

    // Edit buttons
    document.querySelectorAll('.pal-btn').forEach(b => {
        b.addEventListener('click', () => { App.editTool = b.dataset.tool; updatePalette(); });
    });
    document.getElementById('btn-set-metrics').addEventListener('click', setMetricsFromPath);
    document.getElementById('btn-grid-minus').addEventListener('click', () => resizeGrid(-1));
    document.getElementById('btn-grid-plus').addEventListener('click',  () => resizeGrid(+1));
    document.getElementById('btn-rotate').addEventListener('click', rotateLevel);
    document.getElementById('btn-mirror').addEventListener('click', mirrorLevel);
    document.getElementById('btn-edit-guide').addEventListener('click', openEditGuide);
    document.getElementById('btn-edit-new').addEventListener('click', newEditLevel);
    document.getElementById('btn-edit-clear').addEventListener('click', clearEditLevel);
    document.getElementById('btn-bombs').addEventListener('click', findBombs);
    document.getElementById('btn-solve').addEventListener('click', runSolver);
    document.getElementById('btn-submit').addEventListener('click', submitLevel);
    document.getElementById('btn-edit-undo').addEventListener('click', editUndo);
    document.getElementById('btn-copy-path').addEventListener('click', copyPath);
    document.getElementById('btn-copy-hints').addEventListener('click', copyHints);

    document.getElementById('edit-reqLen').addEventListener('input', () => {
        if (App.editLevel) { App.editLevel.reqLen = +document.getElementById('edit-reqLen').value || 0; App.editDirty = true; }
    });
    document.getElementById('edit-reqInt').addEventListener('input', () => {
        if (App.editLevel) { App.editLevel.reqInt = +document.getElementById('edit-reqInt').value || 0; App.editDirty = true; }
    });

    // Review buttons
    document.getElementById('btn-rev-guide').addEventListener('click', openEditGuide);
    document.getElementById('btn-rev-hint').addEventListener('click', () => revShowHint());
    document.getElementById('btn-rev-solve').addEventListener('click', runSolver);
    document.getElementById('btn-rev-reject').addEventListener('click', rejectSubmission);
    document.getElementById('btn-rev-approve').addEventListener('click', approveSubmission);
    document.getElementById('btn-rev-published').addEventListener('click', openPublishedModal);

    // Win / Hazard modals
    document.getElementById('btn-win-next').addEventListener('click', () => { closeWin(); nextLevel(); });
    document.getElementById('btn-win-stay').addEventListener('click', closeWin);
    document.getElementById('btn-win-copy-path').addEventListener('click', () => {
        const val = document.getElementById('win-path-export').value;
        if (val) navigator.clipboard.writeText(val).then(() => showToast('Path copied'));
    });
    document.getElementById('btn-hazard-undo').addEventListener('click', () => { closeHazard(); undoMove(); });
    document.getElementById('btn-hazard-reset').addEventListener('click', () => { closeHazard(); resetPath(); });
}

// ─── Play Mode ────────────────────────────────────────────────────────────────

function startPlayMode(idx) {
    App.mode = 'play';
    document.getElementById('controls-play').style.display   = '';
    document.getElementById('controls-edit').style.display   = 'none';
    document.getElementById('controls-review').style.display = 'none';
    document.getElementById('btn-mode').textContent = 'Editor';

    const levels = App.allLevels;
    if (!levels.length) return;
    idx = Math.max(0, Math.min(idx, levels.length - 1));
    App.currentLevelIndex = idx;
    App.hintIndex  = -1;
    App.hintPinned = false;

    // Check options conflict
    const level = levels[idx];
    const effectiveLevel = buildEffectiveLevel(level);
    if (!effectiveLevel) {
        // Conflict – skip to next
        const next = findNextCompatibleLevel(idx);
        if (next === -1) {
            showModal('<h2>Options Conflict</h2><p>No compatible levels with current options.</p><button onclick="closeModal()">OK</button>');
            return;
        }
        App.currentLevelIndex = next;
        startPlayMode(next);
        return;
    }

    App.playLevel = effectiveLevel;
    App.pathState = new window.Engine.PathState(effectiveLevel);

    App.renderer.setLevel(effectiveLevel, App.pathState);
    App.renderer.showGeese      = App.opts.showGeese;
    App.renderer.showFalseGoals = App.opts.showFalseGoals;
    App.renderer.hintPath       = null;
    App.renderer.hintAnimStep   = null;
    App.renderer.bombHighlights = null;
    App.renderer.pendingPortalCell = null;

    // Dead gate parity marks (only when showDeadGates is on — dead gates are kept in level)
    if (App.opts.showDeadGates) {
        const allDead = computeDeadGates(level);
        App.renderer.deadGateKeys = allDead.size > 0 ? allDead : null;
    } else {
        App.renderer.deadGateKeys = null;
    }

    updatePlayHeader();
    App.renderer.draw();
    savePrefs();
}

function buildEffectiveLevel(level) {
    const L = Object.assign({}, level);
    L.gates       = (L.gates || []).slice();
    L.falseGoals  = (L.falseGoals || []).slice();
    L.geese       = (L.geese || []).slice();

    if (!App.opts.showGeese)      L.geese      = [];
    if (!App.opts.showFalseGoals) L.falseGoals = [];

    if (!App.opts.showDeadGates) {
        // Filter dead gates by parity
        const deadKeys = computeDeadGates(L);
        L.gates = L.gates.filter(g => !deadKeys.has(window.Engine.packKey(g.x, g.y)));
        if (!L.gates.length) return null;
    }

    return window.Engine.normaliseLevel(L);
}

function computeDeadGates(level) {
    const dead = new Set();
    if (!level.goal) return dead;
    const { portals } = level;
    // If any portal breaks parity, don't flag any dead gates
    const hasParityBreaker = (portals || []).some(p => {
        const parity1 = (p.x1 + p.y1) % 2;
        const parity2 = (p.x2 + p.y2) % 2;
        return parity1 !== parity2;
    });
    if (hasParityBreaker) return dead;
    const goalParity = (level.goal.x + level.goal.y) % 2;
    for (const g of level.gates) {
        const gateParity = (g.x + g.y) % 2;
        const needed = (goalParity + level.reqLen) % 2;
        if (gateParity % 2 !== needed % 2) dead.add(window.Engine.packKey(g.x, g.y));
    }
    return dead;
}

function findNextCompatibleLevel(fromIdx) {
    const total = App.allLevels.length;
    for (let i = 1; i <= total; i++) {
        const idx = (fromIdx + i) % total;
        if (buildEffectiveLevel(App.allLevels[idx])) return idx;
    }
    return -1;
}

function updatePlayHeader() {
    const level = App.playLevel;
    const ps    = App.pathState;
    const idx   = App.currentLevelIndex;

    let done = false;
    try { done = !!(JSON.parse(localStorage.getItem('pf_done') || '{}')[idx]); } catch {}

    document.getElementById('level-title').textContent =
        `Level ${idx + 1}` + (done ? ' ✓' : '') + (level.designerName ? ` — ${level.designerName}` : '');

    const lenEl = document.getElementById('metric-len');
    const intEl = document.getElementById('metric-int');
    const stsEl = document.getElementById('metric-status');

    const curLen = ps ? ps.length : 0;
    const curInt = ps ? ps.intersections : 0;
    lenEl.textContent = `Len: ${curLen}/${level.reqLen}`;
    intEl.textContent = `× ${curInt}/${level.reqInt}`;
    lenEl.className = 'metric' + (curLen === level.reqLen ? ' sat' : '');
    intEl.className = 'metric' + (curInt === level.reqInt ? ' sat' : '');

    // must-pass / must-cross status dots
    let dots = '';
    if (ps) {
        for (const k of ps.mustPassSet) {
            dots += `<span class="oblig-dot ${ps.mustPassSat.has(k) ? 'sat' : ''}">●</span>`;
        }
        for (const k of ps.mustCrossSet) {
            dots += `<span class="oblig-dot cross ${ps.mustCrossSat.has(k) ? 'sat' : ''}">✕</span>`;
        }
    }
    stsEl.innerHTML = dots;
}

function prevLevel() {
    const n = App.currentLevelIndex - 1;
    if (n < 0) return;
    startPlayMode(n);
}

function nextLevel() {
    const n = App.currentLevelIndex + 1;
    if (n >= App.allLevels.length) return;
    startPlayMode(n);
}

function undoMove() {
    if (!App.pathState) return;
    if (App.pathState.hazardActive || App.pathState.trapActive) {
        App.pathState.hazardActive = false;
        App.pathState.hazardCell   = null;
        App.pathState.trapActive   = false;
        App.pathState.trapCell     = null;
    }
    App.pathState.undo();
    App.hintIndex  = -1;
    if (!App.hintPinned) {
        if (App._hintAnimTimer) { clearInterval(App._hintAnimTimer); App._hintAnimTimer = null; }
        App.renderer.hintPath = null;
        App.renderer.hintAnimStep = null;
    }
    updatePlayHeader();
    updateHintUI(App.playLevel?.hints?.length || 0);
    App.renderer.draw();
    playSound('undo');
}

function resetPath() {
    if (!App.pathState) return;
    App.pathState.reset();
    App.hintIndex  = -1;
    if (App._hintAnimTimer) { clearInterval(App._hintAnimTimer); App._hintAnimTimer = null; }
    App.renderer.hintPath = null;
    App.renderer.hintAnimStep = null;
    updatePlayHeader();
    updateHintUI(0);
    App.renderer.draw();
}

function showHint() {
    if (!App.playLevel) return;
    const hints = App.playLevel.hints;
    if (!hints || !hints.length) {
        runHintSolver();
        return;
    }
    App.hintIndex = (App.hintIndex + 1) % hints.length;
    _animateHint(hints[App.hintIndex], hints.length);
}

function _animateHint(path, total) {
    // Cancel any running animation
    if (App._hintAnimTimer) { clearInterval(App._hintAnimTimer); App._hintAnimTimer = null; }

    App.renderer.hintPath = path;
    App.renderer.hintAnimStep = 0;
    updateHintUI(total);
    App.renderer.draw();

    App._hintAnimTimer = setInterval(() => {
        const maxStep = path.length - 1;
        if (App.renderer.hintAnimStep >= maxStep) {
            clearInterval(App._hintAnimTimer);
            App._hintAnimTimer = null;
            App.renderer.hintAnimStep = null; // show full path
            App.renderer.draw();
            return;
        }
        App.renderer.hintAnimStep++;
        App.renderer.draw();
    }, 80);
}

function updateHintUI(total) {
    const counterEl = document.getElementById('hint-counter');
    const pinEl     = document.getElementById('btn-hint-pin');
    const clearEl   = document.getElementById('btn-hint-clear');
    if (!counterEl) return;
    const visible = App.renderer.hintPath !== null;
    if (visible && total > 0) {
        counterEl.textContent = `${App.hintIndex + 1}/${total}`;
        counterEl.style.display = '';
    } else {
        counterEl.style.display = 'none';
    }
    if (pinEl) pinEl.style.display = visible ? '' : 'none';
    if (clearEl) clearEl.style.display = visible ? '' : 'none';
    if (pinEl) pinEl.textContent = App.hintPinned ? 'Unpin' : 'Pin';
}

function pinHint() {
    App.hintPinned = !App.hintPinned;
    const total = App.playLevel?.hints?.length || 0;
    updateHintUI(total);
}

function clearHint() {
    if (App._hintAnimTimer) { clearInterval(App._hintAnimTimer); App._hintAnimTimer = null; }
    App.renderer.hintPath = null;
    App.renderer.hintAnimStep = null;
    App.hintPinned = false;
    App.hintIndex = -1;
    updateHintUI(0);
    App.renderer.draw();
}

function runHintSolver() {
    if (!App.playLevel) return;
    const solver = new window.SolverV2(App.playLevel, { budget: 200_000, maxSolutions: 1 });
    showSolverModal('Finding Hint', solver, result => {
        if (result.found && result.paths.length) {
            // Store discovered hint and animate it
            if (!App.playLevel.hints) App.playLevel.hints = [];
            App.playLevel.hints.push(result.paths[0]);
            App.hintIndex = App.playLevel.hints.length - 1;
            _animateHint(result.paths[0], App.playLevel.hints.length);
        } else {
            showModal('<h2>No Hint Found</h2><p>Solver exhausted budget without finding a solution.</p><button onclick="closeModal()">OK</button>');
        }
    });
}

function toggleWhoa() {
    App.renderer.flipped = !App.renderer.flipped;
    App.renderer.draw();
}

// ─── Input (mouse/touch) ──────────────────────────────────────────────────────

function attachInputHandlers() {
    const canvas = App.canvas;
    let dragging = false;

    function handlePointer(px, py, isStart) {
        if (App.mode === 'edit') { handleEditPointer(px, py, isStart); return; }
        if (App.mode === 'review') { handleEditPointer(px, py, isStart); return; }
        handlePlayPointer(px, py, isStart);
    }

    canvas.addEventListener('mousedown', e => {
        dragging = true;
        const r = canvas.getBoundingClientRect();
        handlePointer(e.clientX - r.left, e.clientY - r.top, true);
    });
    canvas.addEventListener('mousemove', e => {
        if (!dragging) return;
        const r = canvas.getBoundingClientRect();
        handlePointer(e.clientX - r.left, e.clientY - r.top, false);
    });
    canvas.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('mouseleave', () => { dragging = false; });

    canvas.addEventListener('touchstart', e => {
        e.preventDefault();
        dragging = true;
        const t = e.touches[0];
        const r = canvas.getBoundingClientRect();
        handlePointer(t.clientX - r.left, t.clientY - r.top, true);
    }, { passive: false });
    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        const r = canvas.getBoundingClientRect();
        handlePointer(t.clientX - r.left, t.clientY - r.top, false);
    }, { passive: false });
    canvas.addEventListener('touchend', () => { dragging = false; });

    window.addEventListener('resize', () => {
        if (App.renderer && App.renderer.level) {
            App.renderer._resize();
            App.renderer.draw();
        }
    });
}

function handlePlayPointer(px, py, isStart) {
    const ps = App.pathState;
    if (!ps) return;
    if (ps.hazardActive || ps.trapActive) return;

    const cell = App.renderer.cellAt(px, py);
    if (!cell) return;

    const E = window.Engine;
    const gateSet = E.makeGateSet(App.playLevel);
    const ck = E.packKey(cell.x, cell.y);

    // Starting a new path or tapping a gate to start
    if (ps.isEmpty() || isStart) {
        if (gateSet.has(ck)) {
            ps.startAt(cell.x, cell.y);
            updatePlayHeader();
            App.renderer.draw();
            playSound('move');

            // Auto-portal jump if starting on a portal
            doPortalJumpIfPending();
            return;
        }
        if (!ps.isEmpty() && !isStart) {
            // Continue dragging from head
        }
    }

    if (ps.isEmpty()) return;
    const head = ps.head;
    if (!head) return;

    // Backtrack: tapping/moving back to the previous node
    if (ps.nodes.length >= 2) {
        const prev = ps.nodes[ps.nodes.length - 2];
        if (prev.x === cell.x && prev.y === cell.y) {
            undoMove();
            return;
        }
    }

    const check = ps.canMoveTo(cell.x, cell.y);
    if (!check.ok) return;

    const hazard = ps.applyMove(cell.x, cell.y);
    doPortalJumpIfPending();
    updatePlayHeader();

    if (hazard) {
        App.renderer.draw();
        showHazardModal(hazard);
        return;
    }

    if (ps.checkWin()) {
        markLevelComplete();
        App.renderer.draw();
        showWinModal();
        return;
    }

    App.renderer.draw();
    playSound('move');
}

function doPortalJumpIfPending() {
    if (!App.pathState) return;
    const dest = App.pathState.pendingPortalDest();
    if (!dest) return;
    const check = App.pathState.canMoveTo(dest.x, dest.y);
    if (check.ok) {
        App.pathState.applyMove(dest.x, dest.y);
        updatePlayHeader();
        App.renderer.draw();
        playSound('portal');
    }
}

function showHazardModal(hazard) {
    const box = document.getElementById('hazard-modal');
    document.getElementById('hazard-icon').textContent = hazard.hazard === 'goose' ? '🪿' : '💣';
    document.getElementById('hazard-msg').textContent  = hazard.hazard === 'goose'
        ? 'Oh no! A goose! Undo or Reset to continue.'
        : 'BOOM! False goal trap! Undo or Reset.';
    box.style.display = 'flex';
    playSound('hazard');
}

function closeHazard() {
    document.getElementById('hazard-modal').style.display = 'none';
}

function showWinModal() {
    const level = App.playLevel;
    const ps    = App.pathState;
    document.getElementById('win-msg').textContent =
        `Level ${App.currentLevelIndex + 1} complete!` +
        (level.description ? ` ${level.description}` : '');

    const exportRow = document.getElementById('win-export-row');
    const exportInput = document.getElementById('win-path-export');
    if (ps && !ps.isEmpty() && exportRow && exportInput) {
        const pathJson = JSON.stringify(ps.nodes.map(n => window.Engine.packKey(n.x, n.y)));
        exportInput.value = pathJson;
        exportRow.style.display = '';
    } else if (exportRow) {
        exportRow.style.display = 'none';
    }

    document.getElementById('win-modal').style.display = 'flex';
    playSound('win');
}

function closeWin() {
    document.getElementById('win-modal').style.display = 'none';
    const exportRow = document.getElementById('win-export-row');
    if (exportRow) exportRow.style.display = 'none';
}

function markLevelComplete() {
    try {
        const done = JSON.parse(localStorage.getItem('pf_done') || '{}');
        done[App.currentLevelIndex] = true;
        localStorage.setItem('pf_done', JSON.stringify(done));
    } catch {}
}

// ─── Edit Mode ────────────────────────────────────────────────────────────────

function startEditMode() {
    App.mode = 'edit';
    document.getElementById('controls-play').style.display   = 'none';
    document.getElementById('controls-edit').style.display   = '';
    document.getElementById('controls-review').style.display = 'none';
    document.getElementById('btn-mode').textContent = 'Play';

    if (!App.editLevel) {
        App.editLevel = window.Engine.normaliseLevel({ grid: { w: 8, h: 8 }, gates: [], goal: null });
    }
    App.pendingPortal = null;
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    App.renderer.showGeese         = true;
    App.renderer.showFalseGoals    = true;
    App.renderer.hintPath          = null;
    App.renderer.hintAnimStep      = null;
    App.renderer.bombHighlights    = null;
    App.renderer.pendingPortalCell = null;
    App.renderer.deadGateKeys      = null;
    App.editTool = 'gate';
    updatePalette();
    syncEditUI();
    App.renderer.draw();
}

function syncEditUI() {
    if (!App.editLevel) return;
    document.getElementById('edit-reqLen').value = App.editLevel.reqLen || 0;
    document.getElementById('edit-reqInt').value = App.editLevel.reqInt || 0;
    document.getElementById('edit-designer').value = App.editLevel.designerName || '';
    document.getElementById('edit-desc').value     = App.editLevel.description || '';
    document.getElementById('edit-diff').value     = App.editLevel.difficulty != null ? App.editLevel.difficulty : '';
}

function handleEditPointer(px, py, isStart) {
    if (!App.editLevel) return;
    const cell = App.renderer.cellAt(px, py);
    const tool = App.editTool;

    if (tool === 'pencil') {
        handlePencilInput(px, py, isStart, cell);
        return;
    }
    if (!cell) return;
    if (!isStart) return; // only respond on click, not drag for most tools

    // When a portal terminal is pending, only portal or eraser (to cancel) are allowed
    if (App.pendingPortal && tool !== 'portal' && tool !== 'eraser') {
        showToast('Complete portal placement first (or Erase to cancel)');
        return;
    }

    pushEditHistory();

    const L = App.editLevel;
    const E = window.Engine;
    const ck = E.packKey(cell.x, cell.y);

    function removeFromAll(x, y) {
        const k2 = E.packKey(x, y);
        L.gates        = L.gates.filter(c => E.packKey(c.x, c.y) !== k2);
        L.falseGoals   = (L.falseGoals || []).filter(c => E.packKey(c.x, c.y) !== k2);
        L.blocks       = (L.blocks || []).filter(c => E.packKey(c.x, c.y) !== k2);
        L.mustPass     = (L.mustPass || []).filter(c => E.packKey(c.x, c.y) !== k2);
        L.mustCross    = (L.mustCross || []).filter(c => E.packKey(c.x, c.y) !== k2);
        L.geese        = (L.geese || []).filter(c => E.packKey(c.x, c.y) !== k2);
        L.filters      = (L.filters || []).filter(f => E.packKey(f.x, f.y) !== k2);
        L.flippingFilters = (L.flippingFilters || []).filter(f => E.packKey(f.x, f.y) !== k2);
        L.portals      = (L.portals || []).filter(p =>
            E.packKey(p.x1, p.y1) !== k2 && E.packKey(p.x2, p.y2) !== k2);
        if (L.goal && E.packKey(L.goal.x, L.goal.y) === k2) L.goal = null;
    }

    switch (tool) {
        case 'eraser': {
            // Cancel any pending portal first
            if (App.pendingPortal) {
                App.pendingPortal = null;
                App.renderer.pendingPortalCell = null;
            }
            // If erasing a portal terminal, keep the other as pending
            const portalPair = (L.portals || []).find(p =>
                E.packKey(p.x1, p.y1) === ck || E.packKey(p.x2, p.y2) === ck);
            if (portalPair) {
                L.portals = (L.portals || []).filter(p => p !== portalPair);
                const isFirst = E.packKey(portalPair.x1, portalPair.y1) === ck;
                const other = isFirst
                    ? { x: portalPair.x2, y: portalPair.y2 }
                    : { x: portalPair.x1, y: portalPair.y1 };
                App.pendingPortal = other;
                App.renderer.pendingPortalCell = { ...other };
                showToast('Click second portal terminal');
            } else {
                removeFromAll(cell.x, cell.y);
            }
            break;
        }
        case 'gate':
            removeFromAll(cell.x, cell.y);
            L.gates.push({ x: cell.x, y: cell.y });
            break;
        case 'goal':
            L.goal = null; // remove existing
            removeFromAll(cell.x, cell.y);
            L.goal = { x: cell.x, y: cell.y };
            break;
        case 'falseGoal':
            removeFromAll(cell.x, cell.y);
            L.falseGoals.push({ x: cell.x, y: cell.y });
            break;
        case 'block':
            removeFromAll(cell.x, cell.y);
            L.blocks.push({ x: cell.x, y: cell.y });
            break;
        case 'goose':
            removeFromAll(cell.x, cell.y);
            L.geese.push({ x: cell.x, y: cell.y });
            break;
        case 'mustPass':
            removeFromAll(cell.x, cell.y);
            L.mustPass.push({ x: cell.x, y: cell.y });
            break;
        case 'mustCross':
            removeFromAll(cell.x, cell.y);
            L.mustCross.push({ x: cell.x, y: cell.y });
            break;
        case 'filterH':
            removeFromAll(cell.x, cell.y);
            L.filters.push({ x: cell.x, y: cell.y, axis: 1 });
            break;
        case 'filterV':
            removeFromAll(cell.x, cell.y);
            L.filters.push({ x: cell.x, y: cell.y, axis: 2 });
            break;
        case 'flipH':
            removeFromAll(cell.x, cell.y);
            L.flippingFilters.push({ x: cell.x, y: cell.y, axis: 1 });
            break;
        case 'flipV':
            removeFromAll(cell.x, cell.y);
            L.flippingFilters.push({ x: cell.x, y: cell.y, axis: 2 });
            break;
        case 'portal':
            handlePortalPlacement(cell);
            break;
    }

    if (tool !== 'portal') {
        App.editLevel = window.Engine.normaliseLevel(L);
        App.editDirty = true;
    }
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    App.renderer.draw();
}

const PORTAL_COLORS = ['#6366f1','#0ea5e9','#22c55e','#f97316','#ec4899','#f59e0b','#10b981','#8b5cf6'];
let _portalColorIdx = 0;

function handlePortalPlacement(cell) {
    const L = App.editLevel;
    const E = window.Engine;
    const ck = E.packKey(cell.x, cell.y);

    if (!App.pendingPortal) {
        App.pendingPortal = { x: cell.x, y: cell.y };
        App.renderer.pendingPortalCell = { x: cell.x, y: cell.y };
        App.renderer.draw();
        showToast('Click second portal terminal');
    } else {
        // Clicking the same cell cancels placement
        if (ck === E.packKey(App.pendingPortal.x, App.pendingPortal.y)) {
            App.pendingPortal = null;
            App.renderer.pendingPortalCell = null;
            App.renderer.draw();
            showToast('Portal placement cancelled');
            return;
        }
        const color = PORTAL_COLORS[_portalColorIdx++ % PORTAL_COLORS.length];
        L.portals.push({ x1: App.pendingPortal.x, y1: App.pendingPortal.y,
                         x2: cell.x, y2: cell.y, color });
        App.pendingPortal = null;
        App.renderer.pendingPortalCell = null;
        App.editLevel = window.Engine.normaliseLevel(L);
        App.editDirty = true;
    }
}

function handlePencilInput(px, py, isStart, cell) {
    if (!cell) return;
    const ps = App.editPathState;
    const L  = App.editLevel;
    if (!L.gates.length) { showToast('Add a gate first'); return; }
    const E = window.Engine;
    const gateSet = E.makeGateSet(L);
    const ck = E.packKey(cell.x, cell.y);

    if (ps.isEmpty() || isStart) {
        if (gateSet.has(ck)) {
            ps.startAt(cell.x, cell.y);
            updateEditPencilInfo();
            App.renderer.draw();
        }
        return;
    }

    // Backtrack
    if (ps.nodes.length >= 2) {
        const prev = ps.nodes[ps.nodes.length - 2];
        if (prev.x === cell.x && prev.y === cell.y) {
            ps.undo();
            updateEditPencilInfo();
            App.renderer.draw();
            return;
        }
    }

    const check = ps.canMoveTo(cell.x, cell.y);
    if (check.ok) {
        ps.applyMove(cell.x, cell.y);
        // auto portal
        const dest = ps.pendingPortalDest();
        if (dest) {
            const c2 = ps.canMoveTo(dest.x, dest.y);
            if (c2.ok) ps.applyMove(dest.x, dest.y);
        }
        updateEditPencilInfo();
        App.renderer.draw();
    }
}

function updateEditPencilInfo() {
    const ps = App.editPathState;
    if (!ps) return;
    const el = document.getElementById('edit-pencil-info');
    if (ps.isEmpty()) { el.textContent = ''; return; }
    el.textContent = `Path: len=${ps.length} int=${ps.intersections}`;
}

function setMetricsFromPath() {
    const ps = App.editPathState;
    if (!ps || ps.isEmpty()) return;
    if (!App.editLevel) return;
    App.editLevel.reqLen = ps.length;
    App.editLevel.reqInt = ps.intersections;
    syncEditUI();
    App.editDirty = true;
    showToast(`Set: len=${ps.length} int=${ps.intersections}`);
}

function updatePalette() {
    document.querySelectorAll('.pal-btn').forEach(b => {
        b.classList.toggle('selected', b.dataset.tool === App.editTool);
    });
}

function pushEditHistory() {
    App.editHistory.push(JSON.stringify(App.editLevel));
    if (App.editHistory.length > 50) App.editHistory.shift();
}

function editUndo() {
    if (!App.editHistory.length) return;
    App.editLevel = window.Engine.normaliseLevel(JSON.parse(App.editHistory.pop()));
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    syncEditUI();
    App.renderer.draw();
}

function newEditLevel() {
    if (App.editDirty && !confirm('Discard current level and start new?')) return;
    App.editLevel = window.Engine.normaliseLevel({ grid: { w: 8, h: 8 }, gates: [], goal: null });
    App.editDirty = false;
    App.editHistory = [];
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    syncEditUI();
    App.renderer.draw();
}

function clearEditLevel() {
    if (!confirm('Clear all objects?')) return;
    pushEditHistory();
    const L = App.editLevel;
    L.gates=[]; L.goal=null; L.falseGoals=[]; L.blocks=[]; L.mustPass=[]; L.mustCross=[];
    L.filters=[]; L.flippingFilters=[]; L.portals=[]; L.geese=[];
    App.editLevel = window.Engine.normaliseLevel(L);
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    App.renderer.draw();
}

function resizeGrid(delta) {
    if (!App.editLevel) return;
    pushEditHistory();
    const { w, h } = App.editLevel.grid;
    const nw = Math.max(3, Math.min(20, w + delta));
    const nh = Math.max(3, Math.min(20, h + delta));
    App.editLevel.grid = { w: nw, h: nh };
    // Remove out-of-bounds objects
    App.editLevel = window.Engine.normaliseLevel(App.editLevel);
    App.editLevel.gates       = App.editLevel.gates.filter(c => c.x <= nw && c.y <= nh);
    App.editLevel.blocks      = App.editLevel.blocks.filter(c => c.x <= nw && c.y <= nh);
    App.editLevel.mustPass    = App.editLevel.mustPass.filter(c => c.x <= nw && c.y <= nh);
    App.editLevel.mustCross   = App.editLevel.mustCross.filter(c => c.x <= nw && c.y <= nh);
    App.editLevel.geese       = App.editLevel.geese.filter(c => c.x <= nw && c.y <= nh);
    App.editLevel.filters     = App.editLevel.filters.filter(f => f.x <= nw && f.y <= nh);
    App.editLevel.flippingFilters = App.editLevel.flippingFilters.filter(f => f.x <= nw && f.y <= nh);
    if (App.editLevel.goal && (App.editLevel.goal.x > nw || App.editLevel.goal.y > nh)) App.editLevel.goal = null;
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    App.renderer.draw();
}

function rotateLevel() {
    if (!App.editLevel) return;
    pushEditHistory();
    const L  = App.editLevel;
    const { w, h } = L.grid;
    // Rotate 90° clockwise: (x,y) → (h-y+1, x) on new grid (h×w)
    const rot = c => ({ x: h - c.y + 1, y: c.x });
    const rotF = f => ({ x: h - f.y + 1, y: f.x, axis: f.axis === 1 ? 2 : 1 });
    const rotP = p => ({ x1: h - p.y1 + 1, y1: p.x1, x2: h - p.y2 + 1, y2: p.x2, color: p.color });
    App.editLevel.grid       = { w: h, h: w };
    App.editLevel.gates      = L.gates.map(rot);
    App.editLevel.goal       = L.goal ? rot(L.goal) : null;
    App.editLevel.falseGoals = (L.falseGoals || []).map(rot);
    App.editLevel.blocks     = (L.blocks || []).map(rot);
    App.editLevel.mustPass   = (L.mustPass || []).map(rot);
    App.editLevel.mustCross  = (L.mustCross || []).map(rot);
    App.editLevel.geese      = (L.geese || []).map(rot);
    App.editLevel.filters    = (L.filters || []).map(rotF);
    App.editLevel.flippingFilters = (L.flippingFilters || []).map(rotF);
    App.editLevel.portals    = (L.portals || []).map(rotP);
    App.editLevel.hints      = [];
    App.editLevel = window.Engine.normaliseLevel(App.editLevel);
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    App.renderer.draw();
}

function mirrorLevel() {
    if (!App.editLevel) return;
    pushEditHistory();
    const L  = App.editLevel;
    const { w } = L.grid;
    // Mirror horizontally: (x,y) → (w-x+1, y)
    const mir  = c => ({ x: w - c.x + 1, y: c.y });
    const mirF = f => ({ x: w - f.x + 1, y: f.y, axis: f.axis });
    const mirP = p => ({ x1: w - p.x1 + 1, y1: p.y1, x2: w - p.x2 + 1, y2: p.y2, color: p.color });
    App.editLevel.gates      = L.gates.map(mir);
    App.editLevel.goal       = L.goal ? mir(L.goal) : null;
    App.editLevel.falseGoals = (L.falseGoals || []).map(mir);
    App.editLevel.blocks     = (L.blocks || []).map(mir);
    App.editLevel.mustPass   = (L.mustPass || []).map(mir);
    App.editLevel.mustCross  = (L.mustCross || []).map(mir);
    App.editLevel.geese      = (L.geese || []).map(mir);
    App.editLevel.filters    = (L.filters || []).map(mirF);
    App.editLevel.flippingFilters = (L.flippingFilters || []).map(mirF);
    App.editLevel.portals    = (L.portals || []).map(mirP);
    App.editLevel.hints      = [];
    App.editLevel = window.Engine.normaliseLevel(App.editLevel);
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    App.renderer.draw();
}

function findBombs() {
    if (!App.editLevel) return;
    const E = window.Engine;
    const L = App.editLevel;

    // Run solver to find solution paths, then highlight cells that appear in them.
    // Those cells are plausible false-goal trap positions.
    const solver = new window.SolverV2(L, { budget: 200_000, maxSolutions: 5 });
    showSolverModal('Analyzing Bomb Spots', solver, result => {
        const highlights = new Set();
        if (result.found) {
            const gateSet = E.makeGateSet(L);
            const goalKey = L.goal ? E.packKey(L.goal.x, L.goal.y) : -1;
            for (const path of result.paths) {
                for (const n of path) {
                    const k = E.packKey(n.x, n.y);
                    if (!gateSet.has(k) && k !== goalKey) highlights.add(k);
                }
            }
        }
        if (!highlights.size) {
            showToast('No bomb spots identified — try Solve first');
            return;
        }
        App.renderer.bombHighlights = highlights;
        App.renderer.draw();
        setTimeout(() => { App.renderer.bombHighlights = null; App.renderer.draw(); }, 5000);
    });
}

function copyPath() {
    const ps = App.editPathState;
    if (!ps || ps.isEmpty()) return;
    const keys = ps.nodes.map(n => window.Engine.packKey(n.x, n.y));
    const text = JSON.stringify(keys);
    navigator.clipboard.writeText(text).then(() => showToast('Path copied'));
    document.getElementById('edit-output').value = text;
    document.getElementById('edit-output').style.display = '';
    document.getElementById('edit-output-btns').style.display = '';
}

function copyHints() {
    if (!App.editLevel || !App.editLevel.hints.length) return;
    const encoded = window.Engine.encodeHintsForStorage(App.editLevel.hints);
    const text = JSON.stringify(encoded);
    navigator.clipboard.writeText(text).then(() => showToast('Hints copied'));
    document.getElementById('edit-output').value = text;
    document.getElementById('edit-output').style.display = '';
    document.getElementById('edit-output-btns').style.display = '';
}

// ─── Solver UI ────────────────────────────────────────────────────────────────

function runSolver() {
    const level = App.mode === 'play' ? App.playLevel : App.editLevel;
    if (!level) return;
    const { errors } = window.Engine.validateLevelStructure(level);
    if (errors.length) {
        showModal(`<h2>Invalid Level</h2><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul><button onclick="closeModal()">OK</button>`);
        return;
    }
    const solver = new window.SolverV2(level, { budget: 1_000_000, maxSolutions: 3 });
    showSolverModal('Finding Solutions', solver, result => {
        if (result.found) {
            if (App.editLevel) {
                App.editLevel.hints = result.paths;
                showToast(`Found ${result.paths.length} solution(s)`);
            }
            App.renderer.hintPath = result.paths[0];
            App.renderer.draw();
        } else {
            showModal(`<h2>No Solution Found</h2><p>Reason: ${result.reason}</p><p>Work used: ${result.workUsed}</p><button onclick="closeModal()">OK</button>`);
        }
    });
}

function showSolverModal(title, solver, onDone) {
    let cancelled = false;
    let workUsed = 0;
    const startTime = Date.now();

    solver.onProgress = ({ workUsed: w }) => { workUsed = w; };

    const html = `
<div style="text-align:center;padding:1em">
  <h2>${title}</h2>
  <div id="solver-detail">Preparing…</div>
  <div id="solver-timer" style="font-size:1.2em;margin:.5em 0">0.0s</div>
  <div style="background:#333;border-radius:4px;height:8px;margin:.5em 0">
    <div id="solver-bar" style="background:var(--primary,#6366f1);height:8px;border-radius:4px;width:0%;transition:width .2s"></div>
  </div>
  <button onclick="window._solverCancel()" class="ctrl-btn">Cancel</button>
</div>`;
    showModal(html, false);

    window._solverCancel = () => {
        cancelled = true;
        solver.cancel();
        closeModal();
    };

    const timerEl = document.getElementById('solver-timer');
    const detailEl = document.getElementById('solver-detail');
    const barEl = document.getElementById('solver-bar');

    const tick = setInterval(() => {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        if (timerEl) timerEl.textContent = `${elapsed}s`;
        if (barEl) {
            const pct = Math.min(100, (workUsed / (solver.budget || 500000)) * 100);
            barEl.style.width = `${pct}%`;
        }
        if (detailEl) detailEl.textContent = `Searching… (${workUsed.toLocaleString()} nodes)`;
    }, 100);

    // Run solver asynchronously (yields every 5000 nodes via rAF)
    solver.solveAsync(result => {
        clearInterval(tick);
        if (!cancelled) {
            closeModal();
            onDone(result);
        }
    });
}

// ─── Submit Level ─────────────────────────────────────────────────────────────

async function submitLevel() {
    if (!App.editLevel) return;
    const L = App.editLevel;
    // Sync metadata from inputs
    L.designerName = document.getElementById('edit-designer').value.trim().slice(0, 80);
    L.description  = document.getElementById('edit-desc').value.trim().slice(0, 160);
    L.difficulty   = parseInt(document.getElementById('edit-diff').value) || null;

    showSubmitModal(L);
}

function showSubmitModal(level) {
    const stages = [
        { id: 's1', label: 'Validate structure' },
        { id: 's2', label: 'Check duplicates' },
        { id: 's3', label: 'Find solutions' },
        { id: 's4', label: 'Save to server' },
    ];
    let html = `<div style="padding:1em"><h2>Submitting Level</h2>`;
    for (const s of stages) html += `<div id="${s.id}" class="submit-stage pending">⏳ ${s.label}</div>`;
    html += `<div id="submit-msg" style="margin-top:.5em;font-size:.9em"></div>`;
    html += `<button id="btn-submit-close" style="display:none" onclick="closeModal()">Close</button></div>`;
    showModal(html, false);

    function setStage(id, state, msg) {
        const el = document.getElementById(id);
        if (!el) return;
        const icon = state === 'ok' ? '✅' : state === 'fail' ? '❌' : state === 'warn' ? '⚠️' : '⏳';
        el.textContent = `${icon} ${stages.find(s => s.id === id).label}` + (msg ? ` — ${msg}` : '');
        el.className = `submit-stage ${state}`;
    }

    function setMsg(msg) {
        const el = document.getElementById('submit-msg');
        if (el) el.textContent = msg;
    }

    function done() {
        const el = document.getElementById('btn-submit-close');
        if (el) el.style.display = '';
    }

    (async () => {
        // Stage 1: structure
        const { valid, errors } = window.Engine.validateLevelStructure(level);
        if (!valid) {
            setStage('s1', 'fail', errors[0]);
            setMsg(errors.join(' · '));
            done(); return;
        }
        setStage('s1', 'ok');

        // Stage 2: duplicates
        if (App.db) {
            try {
                const fp = window.Engine.levelFingerprint(level);
                const col = App.db.collection(`${window.__app_id}/pendingSubmissions`);
                const pub = App.db.collection(`${window.__app_id}/publishedLevels`);
                const [pSnap, rSnap] = await Promise.all([
                    col.where('levelFingerprint', '==', fp).limit(1).get(),
                    pub.where('levelFingerprint', '==', fp).limit(1).get(),
                ]);
                if (!pSnap.empty || !rSnap.empty) {
                    setStage('s2', 'fail', 'Duplicate level already exists');
                    done(); return;
                }
                setStage('s2', 'ok');
            } catch (e) {
                setStage('s2', 'warn', 'Could not check (offline)');
            }
        } else {
            setStage('s2', 'warn', 'Offline — skipped');
        }

        // Stage 3: solve
        let hints = [];
        const solver = new window.SolverV2(level, { budget: 500_000, maxSolutions: 1 });
        const result = solver.solve();
        if (result.found) {
            hints = result.paths;
            setStage('s3', 'ok', `${hints.length} solution(s) found`);
        } else {
            setStage('s3', 'warn', 'No solution found within budget');
        }

        // Stage 4: save
        if (!App.db) {
            setStage('s4', 'fail', 'Firebase not available');
            done(); return;
        }
        if (!App.fbUser) {
            setStage('s4', 'fail', 'Not signed in');
            done(); return;
        }

        try {
            const E = window.Engine;
            const levelData = Object.assign({}, level, {
                hints: E.encodeHintsForStorage(hints),
            });
            await App.db.collection(`${window.__app_id}/pendingSubmissions`).add({
                levelData,
                levelFingerprint: E.levelFingerprint(level),
                fingerprintVersion: 1,
                submittedAt: firebase.firestore.FieldValue.serverTimestamp(),
                submittedBy: App.fbUser.uid,
            });
            setStage('s4', 'ok');
            setMsg('Level submitted for review!');
        } catch (e) {
            setStage('s4', 'fail', e.message);
        }
        done();
    })();
}

// ─── Mode toggle ──────────────────────────────────────────────────────────────

function toggleMode() {
    if (App.mode === 'play') {
        // Copy current play level into the editor so the user can tweak it
        App.editLevel = App.playLevel ? JSON.parse(JSON.stringify(App.playLevel)) : null;
        App.editDirty = false;
        App.editHistory = [];
        startEditMode();
    } else {
        if (App.editDirty) {
            const stay = !confirm('Discard unsaved changes and return to Play Mode?');
            if (stay) return;
        }
        startPlayMode(App.currentLevelIndex);
    }
}

// ─── Review Mode ──────────────────────────────────────────────────────────────

async function startReviewMode() {
    App.mode = 'review';
    document.getElementById('controls-play').style.display   = 'none';
    document.getElementById('controls-edit').style.display   = '';
    document.getElementById('controls-review').style.display = '';
    document.getElementById('btn-mode').textContent = 'Play';

    // Auth check
    if (!App.db || !App.auth) {
        showModal('<h2>Review Mode</h2><p>Firebase not available.</p><button onclick="closeModal()">OK</button>');
        startPlayMode(App.currentLevelIndex);
        return;
    }

    showModal('<h2>Sign In</h2><p>Signing in for review access…</p>', false);
    try {
        const result = await App.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        App.fbUser = result.user;
    } catch (e) {
        closeModal();
        showModal('<h2>Access Denied</h2><p>Sign-in failed or unauthorised.</p><button onclick="closeModal()">OK</button>');
        startPlayMode(App.currentLevelIndex);
        return;
    }

    if (App.fbUser.uid !== window.__admin_uid) {
        closeModal();
        showModal('<h2>Access Denied</h2><p>Your account is not authorised to review levels.</p><button onclick="closeModal()">OK</button>');
        await App.auth.signOut().catch(() => {});
        startPlayMode(App.currentLevelIndex);
        return;
    }

    closeModal();
    await loadReviewQueue();
}

async function loadReviewQueue() {
    showModal('<div style="padding:1em;text-align:center"><h2>Loading Submissions…</h2></div>', false);
    try {
        const snap = await App.db.collection(`${window.__app_id}/pendingSubmissions`)
            .orderBy('submittedAt', 'asc').get();
        App.reviewQueue = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        App.reviewIndex = 0;
    } catch (e) {
        closeModal();
        showModal(`<h2>Load Failed</h2><p>${e.message}</p><button onclick="closeModal()">OK</button>`);
        return;
    }
    closeModal();
    if (!App.reviewQueue.length) {
        App.renderer.level = null;
        showModal('<h2>No Pending Submissions</h2><button onclick="closeModal()">OK</button>');
        return;
    }
    loadReviewItem(0);
}

function loadReviewItem(idx) {
    if (idx >= App.reviewQueue.length) {
        showModal('<h2>No More Submissions</h2><button onclick="closeModal()">OK</button>');
        return;
    }
    App.reviewIndex = idx;
    const item = App.reviewQueue[idx];
    App.reviewLevel = window.Engine.normaliseLevel(item.levelData || item);
    App.editLevel   = App.reviewLevel;
    App.editDirty   = false;
    App.editPathState = new window.Engine.PathState(App.editLevel);
    App.renderer.setLevel(App.editLevel, App.editPathState);
    App.renderer.showGeese = true;
    App.renderer.showFalseGoals = true;
    syncEditUI();
    App.renderer.draw();
    document.getElementById('level-title').textContent =
        `Review ${idx + 1}/${App.reviewQueue.length}`;
}

function revShowHint() {
    if (!App.editLevel) return;
    if (App.editLevel.hints && App.editLevel.hints.length) {
        App.renderer.hintPath = App.editLevel.hints[0];
        App.renderer.draw();
    }
}

async function rejectSubmission() {
    const item = App.reviewQueue[App.reviewIndex];
    if (!item || !confirm('Reject and delete this submission?')) return;
    try {
        await App.db.doc(`${window.__app_id}/pendingSubmissions/${item.id}`).delete();
        App.reviewQueue.splice(App.reviewIndex, 1);
        loadReviewItem(App.reviewIndex < App.reviewQueue.length ? App.reviewIndex : 0);
    } catch (e) { showToast('Reject failed: ' + e.message); }
}

async function approveSubmission() {
    if (!App.editLevel) return;
    const item = App.reviewQueue[App.reviewIndex];
    if (!item) return;

    const { valid, errors } = window.Engine.validateLevelStructure(App.editLevel);
    if (!valid) {
        showModal(`<h2>Cannot Approve</h2><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul><button onclick="closeModal()">OK</button>`);
        return;
    }

    // Get next sort order
    let sortOrder = 1;
    try {
        const snap = await App.db.collection(`${window.__app_id}/publishedLevels`).orderBy('sortOrder','desc').limit(1).get();
        if (!snap.empty) sortOrder = (snap.docs[0].data().sortOrder || 0) + 1;
    } catch {}

    // Validate hints, run solver if needed
    let hints = (App.editLevel.hints || []).filter(h => {
        const v = window.Engine.validateSolution(App.editLevel, h);
        return v.valid;
    });

    if (!hints.length) {
        const solver = new window.SolverV2(App.editLevel, { budget: 500_000, maxSolutions: 1 });
        const r = solver.solve();
        if (r.found) hints = r.paths;
    }

    if (!hints.length) {
        if (!confirm('No valid solution found. Approve anyway?')) return;
    }

    try {
        const E = window.Engine;
        const lvlData = Object.assign({}, App.editLevel, {
            hints: E.encodeHintsForStorage(hints),
        });
        await App.db.collection(`${window.__app_id}/publishedLevels`).add({
            levelData: lvlData,
            levelFingerprint: E.levelFingerprint(App.editLevel),
            approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
            sortOrder,
        });
        await App.db.doc(`${window.__app_id}/pendingSubmissions/${item.id}`).delete();
        App.reviewQueue.splice(App.reviewIndex, 1);
        showToast('Level approved!');
        loadReviewItem(App.reviewIndex < App.reviewQueue.length ? App.reviewIndex : 0);
    } catch (e) { showToast('Approve failed: ' + e.message); }
}

async function openPublishedModal() {
    try {
        const snap = await App.db.collection(`${window.__app_id}/publishedLevels`).orderBy('sortOrder','asc').get();
        const levels = snap.docs;
        let rows = levels.map((d, i) => {
            const data = d.data();
            const lvl  = data.levelData || {};
            return `<tr><td><input type="checkbox" class="pub-chk" data-id="${d.id}"></td><td>${i+1}</td><td>${lvl.designerName||''}</td><td>${lvl.description||''}</td></tr>`;
        }).join('');
        const html = `<div style="padding:1em"><h2>Published Levels (${levels.length})</h2>
          <table border="1" cellpadding="4" style="width:100%;border-collapse:collapse">${rows}</table>
          <div style="margin-top:.5em">
            <button onclick="deleteSelectedPublished()" class="ctrl-btn">Delete Selected</button>
            <button onclick="closeModal()" class="ctrl-btn">Close</button>
          </div></div>`;
        window._publishedDocs = snap.docs;
        showModal(html, false);
    } catch (e) {
        showModal(`<h2>Error</h2><p>${e.message}</p><button onclick="closeModal()">OK</button>`);
    }
}

window.deleteSelectedPublished = async function() {
    const checkboxes = document.querySelectorAll('.pub-chk:checked');
    if (!checkboxes.length || !confirm(`Delete ${checkboxes.length} published level(s)?`)) return;
    for (const cb of checkboxes) {
        try { await App.db.doc(`${window.__app_id}/publishedLevels/${cb.dataset.id}`).delete(); } catch {}
    }
    openPublishedModal();
};

// ─── Options ──────────────────────────────────────────────────────────────────

function openOptions() {
    const themeButtons = Object.keys(window.THEMES).map(name => {
        const active = name === document.documentElement.dataset.theme ? ' active' : '';
        return `<button class="theme-btn${active}" onclick="selectTheme('${name}')">${name}</button>`;
    }).join('');

    const html = `
<div style="padding:1em">
  <h2>Options</h2>
  <label style="display:block;margin:.5em 0">
    <input type="checkbox" id="opt-mute" ${App.opts.mute ? 'checked' : ''}> Mute sounds
  </label>
  <label style="display:block;margin:.5em 0">
    <input type="checkbox" id="opt-geese" ${App.opts.showGeese ? 'checked' : ''}> Show Geese
  </label>
  <label style="display:block;margin:.5em 0">
    <input type="checkbox" id="opt-fg" ${App.opts.showFalseGoals ? 'checked' : ''}> Show False Goals
  </label>
  <label style="display:block;margin:.5em 0">
    <input type="checkbox" id="opt-dg" ${App.opts.showDeadGates ? 'checked' : ''}> Show Dead Gates
  </label>
  <h3 style="margin-top:1em">Theme</h3>
  <div id="theme-grid">${themeButtons}</div>
  <div style="margin-top:1em">
    <button onclick="applyOptionsAndClose()" class="ctrl-btn">OK</button>
    <button onclick="closeModal()" class="ctrl-btn">Cancel</button>
    ${App.mode !== 'review' && App.db ? '<button onclick="startReviewMode();closeModal()" class="ctrl-btn">Review Mode</button>' : ''}
  </div>
</div>`;
    showModal(html);
}

function selectTheme(name) {
    App.opts.theme = name;
    window.ThemeEngine.applyTheme(name);
    markActiveTheme();
    if (App.renderer && App.renderer.level) App.renderer.draw();
    savePrefs();
}

function markActiveTheme() {
    document.querySelectorAll('.theme-btn').forEach(b => {
        b.classList.toggle('active', b.textContent === document.documentElement.dataset.theme);
    });
}

function applyOptionsAndClose() {
    App.opts.mute           = document.getElementById('opt-mute')?.checked  || false;
    App.opts.showGeese      = document.getElementById('opt-geese')?.checked !== false;
    App.opts.showFalseGoals = document.getElementById('opt-fg')?.checked    !== false;
    App.opts.showDeadGates  = document.getElementById('opt-dg')?.checked    !== false;
    savePrefs();
    closeModal();
    if (App.mode === 'play') startPlayMode(App.currentLevelIndex);
}

// ─── Guide Modals ─────────────────────────────────────────────────────────────

function openPlayGuide() {
    showModal(`<div style="padding:1em;max-height:70vh;overflow-y:auto">
<h2>How to Play Pathfinder</h2>
<p>Draw a continuous path from a <strong>gate</strong> (square) to the <strong>goal</strong> (star).</p>
<ul>
  <li><strong>Length</strong>: Your path must be exactly the required number of steps.</li>
  <li><strong>Crossings</strong>: Your path must cross itself exactly the required number of times.</li>
  <li><strong>Gate</strong>: Start point. Tap a gate to begin your path. You cannot re-enter a gate.</li>
  <li><strong>Goal</strong>: The destination (star). Reach it with exact metrics to win.</li>
  <li><strong>False Goals</strong>: Hexagonal traps. Reaching one when you'd otherwise win detonates it!</li>
  <li><strong>Blocks</strong>: Impassable squares. Your path cannot enter them.</li>
  <li><strong>Must-Pass</strong>: Rounded squares you <em>must</em> visit at least once.</li>
  <li><strong>Must-Cross</strong>: Plus-marked squares where your path must cross itself.</li>
  <li><strong>Filters (→/↑)</strong>: Only allow movement in the indicated direction.</li>
  <li><strong>Flipping Filters</strong>: Like filters but the allowed axis flips each use (marked ↔).</li>
  <li><strong>Portals</strong>: Entering one immediately transports you to its pair. Teleport hops don't count toward length.</li>
  <li><strong>Geese</strong>: Hazards 🪿. Stepping on one ends your current attempt — undo or reset!</li>
</ul>
<p><em>Created with Pathfinder.</em></p>
<button onclick="closeModal()" class="ctrl-btn">Got it!</button>
</div>`);
}

function openEditGuide() {
    showModal(`<div style="padding:1em;max-height:70vh;overflow-y:auto">
<h2>Editor Guide</h2>
<p>Select a tool from the palette and click grid cells to place objects.</p>
<ul>
  <li><strong>Gate / Goal</strong>: Every level needs at least one gate and exactly one goal.</li>
  <li><strong>Pencil</strong>: Draw a test path. Use <strong>Set</strong> to copy its metrics to the required fields.</li>
  <li><strong>Portal</strong>: Click twice to place a portal pair.</li>
  <li><strong>Grid±</strong>: Resize the grid. Objects outside the new bounds are removed.</li>
  <li><strong>Rotate / Mirror</strong>: Transform the entire level geometry.</li>
  <li><strong>BOMBS?</strong>: Briefly highlights possible false-goal trap positions.</li>
  <li><strong>Solve</strong>: Run the solver to find valid solutions (and store them as hints).</li>
  <li><strong>Submit</strong>: Validate, check duplicates, find solutions, and submit for review.</li>
  <li><strong>Undo</strong>: Undo the last object edit (not pencil strokes — use backtrack for those).</li>
</ul>
<p>Parity warnings: gates with a red × cannot reach the goal in the required length by basic parity.</p>
<button onclick="closeModal()" class="ctrl-btn">Got it!</button>
</div>`);
}

// ─── Modal helpers ────────────────────────────────────────────────────────────

function showModal(html, closeable = true) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').style.display = 'flex';
    if (closeable) {
        document.getElementById('modal-overlay').onclick = e => {
            if (e.target.id === 'modal-overlay') closeModal();
        };
    } else {
        document.getElementById('modal-overlay').onclick = null;
    }
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

window.closeModal       = closeModal;
window.selectTheme      = selectTheme;
window.applyOptionsAndClose = applyOptionsAndClose;
window.startReviewMode  = startReviewMode;

// ─── Audio ────────────────────────────────────────────────────────────────────

const _audioCtx = window.AudioContext ? new AudioContext() : null;

function playSound(type) {
    if (App.opts.mute || !_audioCtx) return;
    try {
        const osc = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.connect(gain); gain.connect(_audioCtx.destination);
        const now = _audioCtx.currentTime;
        const map = { move: [440, 0.05, 0.08], undo: [300, 0.05, 0.07],
                      portal: [660, 0.08, 0.15], hazard: [150, 0.15, 0.3], win: [660, 0.1, 0.6] };
        const [freq, vol, dur] = map[type] || [440, 0.05, 0.08];
        osc.frequency.setValueAtTime(freq, now);
        if (type === 'win') { osc.frequency.exponentialRampToValueAtTime(freq * 1.5, now + dur); }
        gain.gain.setValueAtTime(vol, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
        osc.start(now); osc.stop(now + dur);
    } catch {}
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2500);
}
