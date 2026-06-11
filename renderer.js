// renderer.js – Canvas-based grid renderer.
'use strict';

const CELL_MIN = 32;
const CELL_MAX = 80;

class GridRenderer {
    constructor(canvas) {
        this.canvas  = canvas;
        this.ctx     = canvas.getContext('2d');
        this.cellSize = 56;
        this.padding  = 16;
        this.level    = null;
        this.pathState= null;
        this.hintPath = null;          // [{x,y}] or null
        this.showGeese      = true;
        this.showFalseGoals = true;
        this.flipped        = false;   // "Whoa" orientation
        this.bombHighlights = null;    // Set of packed keys
        this._rainbowT      = 0;
    }

    setLevel(level, pathState) {
        this.level     = level;
        this.pathState = pathState;
        this._resize();
    }

    _resize() {
        if (!this.level) return;
        const { w, h } = this.level.grid;
        const maxW = this.canvas.parentElement ? this.canvas.parentElement.clientWidth  - 24 : 600;
        const maxH = window.innerHeight * 0.55;
        const cs = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(Math.min((maxW - this.padding * 2) / w, (maxH - this.padding * 2) / h))));
        this.cellSize = cs;
        this.canvas.width  = w * cs + this.padding * 2;
        this.canvas.height = h * cs + this.padding * 2;
    }

    cellAt(px, py) {
        const { w, h } = this.level.grid;
        const x0 = Math.floor((px - this.padding) / this.cellSize) + 1;
        const y0 = Math.floor((py - this.padding) / this.cellSize) + 1;
        if (x0 < 1 || y0 < 1 || x0 > w || y0 > h) return null;
        if (this.flipped) return { x: w - x0 + 1, y: h - y0 + 1 };
        return { x: x0, y: y0 };
    }

    cellCenter(x, y) {
        const cs = this.cellSize;
        const p  = this.padding;
        const { w, h } = this.level.grid;
        let cx = x, cy = y;
        if (this.flipped) { cx = w - x + 1; cy = h - y + 1; }
        return {
            px: p + (cx - 1) * cs + cs / 2,
            py: p + (cy - 1) * cs + cs / 2,
        };
    }

    _css(varName) {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || '#888';
    }

    // Rainbow path colour based on position
    _rainbowColor(i, total) {
        const hue = ((i / Math.max(total - 1, 1)) * 360 + this.rainbowOffset) % 360;
        return `hsl(${hue},100%,65%)`;
    }

    draw() {
        if (!this.level) return;
        const ctx  = this.ctx;
        const cs   = this.cellSize;
        const p    = this.padding;
        const { w, h } = this.level.grid;

        // Background
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = this._css('--canvas-bg') || '#1a1a2e';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Grid lines
        ctx.strokeStyle = this._css('--grid-line');
        ctx.lineWidth   = 1;
        for (let col = 0; col <= w; col++) {
            ctx.beginPath(); ctx.moveTo(p + col * cs, p); ctx.lineTo(p + col * cs, p + h * cs); ctx.stroke();
        }
        for (let row = 0; row <= h; row++) {
            ctx.beginPath(); ctx.moveTo(p, p + row * cs); ctx.lineTo(p + w * cs, p + row * cs); ctx.stroke();
        }

        // Cell objects
        this._drawObjects();

        // Hint path (under player path)
        if (this.hintPath) this._drawHintPath();

        // Player path
        if (this.pathState && !this.pathState.isEmpty()) this._drawPath();

        // Hazard overlay
        if (this.pathState) {
            if (this.pathState.hazardActive && this.pathState.hazardCell) {
                this._drawHazardOverlay('goose', this.pathState.hazardCell);
            }
            if (this.pathState.trapActive && this.pathState.trapCell) {
                this._drawHazardOverlay('trap', this.pathState.trapCell);
            }
        }
    }

    _cellRect(x, y) {
        const { w, h } = this.level.grid;
        const cs = this.cellSize, p = this.padding;
        let cx = x, cy = y;
        if (this.flipped) { cx = w - x + 1; cy = h - y + 1; }
        return { rx: p + (cx - 1) * cs, ry: p + (cy - 1) * cs, cs };
    }

    _drawObjects() {
        const { level, pathState } = this;
        const ctx = this.ctx;
        const cs  = this.cellSize;
        const E   = window.Engine;

        const blockSet   = E.makeBlockSet(level);
        const gateSet    = E.makeGateSet(level);
        const mustPSet   = E.makeMustPassSet(level);
        const mustCSet   = E.makeMustCrossSet(level);
        const geeseSet   = E.makeGeeseSet(level);
        const fgSet      = E.makeFalseGoalSet(level);
        const filterMap  = E.makeFilterMap(level);
        const portalMap  = E.makePortalMap(level);

        const satMP = pathState ? pathState.mustPassSat : new Set();
        const satMC = pathState ? pathState.mustCrossSat: new Set();

        // Draw blocks
        ctx.fillStyle = this._css('--block-color');
        for (const b of level.blocks) {
            const { rx, ry } = this._cellRect(b.x, b.y);
            ctx.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
            ctx.fillStyle = this._css('--block-detail');
            ctx.fillRect(rx + 4, ry + 4, cs - 8, cs - 8);
            ctx.fillStyle = this._css('--block-color');
        }

        // Bomb highlights
        if (this.bombHighlights) {
            ctx.fillStyle = 'rgba(245,158,11,0.35)';
            for (const k of this.bombHighlights) {
                const { x, y } = E.unpackKey(k);
                const { rx, ry } = this._cellRect(x, y);
                ctx.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
            }
        }

        // Must-pass
        for (const c of level.mustPass) {
            const { rx, ry } = this._cellRect(c.x, c.y);
            const satisfied = satMP.has(E.packKey(c.x, c.y));
            ctx.fillStyle = satisfied ? this._css('--satisfied-color') : this._css('--mustpass-color');
            this._drawRoundRect(ctx, rx + 4, ry + 4, cs - 8, cs - 8, 4);
            ctx.fillStyle = satisfied ? this._css('--satisfied-color') : this._css('--mustpass-color');
        }

        // Must-cross
        for (const c of level.mustCross) {
            const { rx, ry } = this._cellRect(c.x, c.y);
            const satisfied = satMC.has(E.packKey(c.x, c.y));
            const color = satisfied ? this._css('--satisfied-color') : this._css('--mustcross-color');
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(rx + cs * 0.2, ry + cs / 2); ctx.lineTo(rx + cs * 0.8, ry + cs / 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(rx + cs / 2, ry + cs * 0.2); ctx.lineTo(rx + cs / 2, ry + cs * 0.8); ctx.stroke();
        }

        // Filters
        for (const [k, f] of filterMap) {
            const { x, y } = E.unpackKey(k);
            const { rx, ry } = this._cellRect(x, y);
            const activeAxis = pathState ? pathState._activeFilterAxis(k) : f.axis;
            const color = this._css('--filter-color');
            ctx.fillStyle = color + '44';
            ctx.fillRect(rx + 1, ry + 1, cs - 2, cs - 2);
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            if (activeAxis === 1) {
                // horizontal arrows
                this._drawArrow(ctx, rx + cs * 0.15, ry + cs / 2, rx + cs * 0.85, ry + cs / 2, color);
            } else {
                // vertical arrows
                this._drawArrow(ctx, rx + cs / 2, ry + cs * 0.15, rx + cs / 2, ry + cs * 0.85, color);
            }
            if (f.flipping) {
                ctx.fillStyle = color;
                ctx.font = `bold ${Math.max(8, cs * 0.18)}px sans-serif`;
                ctx.textAlign = 'right'; ctx.textBaseline = 'top';
                ctx.fillText('↔', rx + cs - 2, ry + 2);
            }
        }

        // Portals
        for (const portal of (level.portals || [])) {
            const color = portal.color || this._css('--portal-color');
            [[portal.x1, portal.y1], [portal.x2, portal.y2]].forEach(([px, py]) => {
                const { rx, ry } = this._cellRect(px, py);
                const used = pathState && pathState.portalUsed.has(E.packKey(px, py));
                ctx.fillStyle = used ? color + '44' : color + 'bb';
                this._drawRoundRect(ctx, rx + 4, ry + 4, cs - 8, cs - 8, cs * 0.3);
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.stroke();
                // Portal symbol
                ctx.fillStyle = used ? color + '66' : '#ffffff';
                ctx.font = `bold ${Math.max(10, cs * 0.28)}px sans-serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('◎', rx + cs / 2, ry + cs / 2);
            });
        }

        // Geese
        if (this.showGeese) {
            for (const g of (level.geese || [])) {
                const { rx, ry } = this._cellRect(g.x, g.y);
                ctx.fillStyle = this._css('--geese-color') + '33';
                ctx.fillRect(rx + 2, ry + 2, cs - 4, cs - 4);
                ctx.font = `${Math.max(12, cs * 0.5)}px serif`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('🪿', rx + cs / 2, ry + cs / 2);
            }
        }

        // False goals
        if (this.showFalseGoals) {
            for (const fg of (level.falseGoals || [])) {
                const { rx, ry } = this._cellRect(fg.x, fg.y);
                // Draw like a goal but slightly different
                ctx.fillStyle = this._css('--falsegoal-color');
                this._drawHexagon(ctx, rx + cs / 2, ry + cs / 2, cs * 0.38, false);
                ctx.fillStyle = this._css('--falsegoal-color');
                this._drawHexagon(ctx, rx + cs / 2, ry + cs / 2, cs * 0.38, true);
            }
        }

        // True goal
        if (level.goal) {
            const { rx, ry } = this._cellRect(level.goal.x, level.goal.y);
            const goalColor = this._css('--goal-color');
            ctx.fillStyle = goalColor;
            this._drawStar(ctx, rx + cs / 2, ry + cs / 2, cs * 0.42, cs * 0.22, 5);
        }

        // Gates
        for (const g of level.gates) {
            const { rx, ry } = this._cellRect(g.x, g.y);
            const gateColor = this._css('--gate-color');
            ctx.fillStyle = gateColor;
            this._drawRoundRect(ctx, rx + cs * 0.15, ry + cs * 0.15, cs * 0.7, cs * 0.7, cs * 0.15);
            ctx.strokeStyle = this._css('--canvas-bg');
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }

    _drawPath() {
        const { pathState } = this;
        const nodes = pathState.nodes;
        if (nodes.length < 1) return;
        const ctx = this.ctx;
        const cs  = this.cellSize;
        const isRainbow = document.documentElement.dataset.pathRainbow === '1';
        const pathColor = isRainbow ? null : this._css('--path-color');

        ctx.lineCap  = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = cs * 0.3;

        for (let i = 1; i < nodes.length; i++) {
            const a = nodes[i - 1], b = nodes[i];
            const ac = this.cellCenter(a.x, a.y);
            const bc = this.cellCenter(b.x, b.y);
            const isPortal = (Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) !== 1;
            if (isPortal) continue; // don't draw portal jump segments

            ctx.strokeStyle = isRainbow ? this._rainbowColor(i, nodes.length) : pathColor;
            ctx.beginPath();
            ctx.moveTo(ac.px, ac.py);
            ctx.lineTo(bc.px, bc.py);
            ctx.stroke();
        }

        // Draw dots at each node
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            const { px, py } = this.cellCenter(n.x, n.y);
            ctx.fillStyle = isRainbow ? this._rainbowColor(i, nodes.length) : pathColor;
            ctx.beginPath();
            ctx.arc(px, py, cs * 0.14, 0, Math.PI * 2);
            ctx.fill();
        }

        // Head dot
        const head = nodes[nodes.length - 1];
        if (head) {
            const { px, py } = this.cellCenter(head.x, head.y);
            ctx.fillStyle = pathColor || '#ffffff';
            ctx.beginPath();
            ctx.arc(px, py, cs * 0.18, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    _drawHintPath() {
        if (!this.hintPath || this.hintPath.length < 2) return;
        const ctx = this.ctx;
        const cs  = this.cellSize;
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = this._css('--path-color') || '#ffffff';
        ctx.lineWidth   = cs * 0.18;
        ctx.lineCap     = 'round';
        ctx.lineJoin    = 'round';
        ctx.setLineDash([cs * 0.18, cs * 0.12]);
        ctx.beginPath();
        for (let i = 0; i < this.hintPath.length; i++) {
            const n = this.hintPath[i];
            const { px, py } = this.cellCenter(n.x, n.y);
            if (i === 0) ctx.moveTo(px, py);
            else {
                const p = this.hintPath[i - 1];
                const isPortal = (Math.abs(n.x - p.x) + Math.abs(n.y - p.y)) !== 1;
                if (isPortal) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    _drawHazardOverlay(type, cell) {
        const { rx, ry } = this._cellRect(cell.x, cell.y);
        const cs = this.cellSize;
        const ctx = this.ctx;
        ctx.fillStyle = 'rgba(239,68,68,0.55)';
        ctx.fillRect(rx, ry, cs, cs);
        ctx.font = `${cs * 0.55}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(type === 'goose' ? '🪿' : '💣', rx + cs / 2, ry + cs / 2);
    }

    // ── Shape helpers ──

    _drawRoundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
    }

    _drawStar(ctx, cx, cy, outerR, innerR, points) {
        ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const r = i % 2 === 0 ? outerR : innerR;
            const a = (i * Math.PI / points) - Math.PI / 2;
            if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
            else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        ctx.closePath();
        ctx.fill();
    }

    _drawHexagon(ctx, cx, cy, r, stroke) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI / 3) - Math.PI / 6;
            if (i === 0) ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
            else ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
        }
        ctx.closePath();
        if (stroke) { ctx.lineWidth = 2; ctx.stroke(); }
        else ctx.fill();
    }

    _drawArrow(ctx, x1, y1, x2, y2, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const a = Math.atan2(y2 - y1, x2 - x1);
        const len = 7;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(a - 0.4), y2 - len * Math.sin(a - 0.4));
        ctx.lineTo(x2 - len * Math.cos(a + 0.4), y2 - len * Math.sin(a + 0.4));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    }
}

window.GridRenderer = GridRenderer;
