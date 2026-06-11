// themes.js – seed-based theme system. Exports window.THEMES and window.ThemeEngine.
'use strict';

// ─── Colour utilities ─────────────────────────────────────────────────────────

function hexToRgb(hex) {
    hex = hex.replace(/^#/, '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function luminance({ r, g, b }) {
    const s = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * s(r) + 0.7152 * s(g) + 0.0722 * s(b);
}

function contrastRatio(c1, c2) {
    const l1 = luminance(c1) + 0.05;
    const l2 = luminance(c2) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
}

function readableText(bg) {
    const white = { r: 255, g: 255, b: 255 };
    const black = { r: 0, g: 0, b: 0 };
    return contrastRatio(hexToRgb(bg), white) >= contrastRatio(hexToRgb(bg), black) ? '#ffffff' : '#111111';
}

function mix(hex1, hex2, t) {
    const a = hexToRgb(hex1), b = hexToRgb(hex2);
    return rgbToHex({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
}

function lighten(hex, amt) { return mix(hex, '#ffffff', amt); }
function darken(hex, amt)  { return mix(hex, '#000000', amt); }

function alpha(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
}

// ─── Token derivation ─────────────────────────────────────────────────────────

function deriveTokens(seeds) {
    const { bg, surface, primary, secondary, neutral, text, border, path } = seeds;

    const isDark = luminance(hexToRgb(bg)) < 0.3;

    const tokens = {
        '--bg':           bg,
        '--surface':      surface,
        '--primary':      primary,
        '--secondary':    secondary,
        '--neutral':      neutral,
        '--text':         text,
        '--border':       border,
        '--path':         path === 'rainbow' ? path : path,

        '--canvas-bg':    surface,
        '--grid-line':    alpha(neutral, 0.35),
        '--gate-color':   primary,
        '--goal-color':   secondary,
        '--block-color':  neutral,
        '--block-detail': darken(neutral, 0.3),

        '--mustpass-color':  lighten(secondary, 0.3),
        '--mustcross-color': lighten(primary, 0.2),
        '--filter-color':   mix(primary, '#ffffff', 0.5),
        '--portal-color':   secondary,
        '--geese-color':    '#ef4444',
        '--falsegoal-color':mix(secondary, '#ef4444', 0.4),

        '--path-color':    path === 'rainbow' ? '#ffffff' : path,

        '--modal-bg':     isDark ? lighten(bg, 0.1) : darken(surface, 0.05),
        '--modal-border': border,
        '--modal-text':   text,
        '--modal-muted':  alpha(text, 0.55),
        '--modal-accent': primary,

        '--header-bg':    primary,
        '--header-text':  readableText(primary),
        '--nav-btn-bg':   lighten(primary, 0.15),
        '--nav-btn-text': readableText(lighten(primary, 0.15)),

        '--btn-guide-bg':    mix(primary, '#ffffff', 0.2),
        '--btn-hint-bg':     mix(secondary, '#ffffff', 0.2),
        '--btn-undo-bg':     mix(neutral, '#ffffff', 0.2),
        '--btn-reset-bg':    mix(neutral, '#ff6b6b', 0.3),
        '--btn-solve-bg':    '#10b981',
        '--btn-submit-bg':   '#6366f1',
        '--btn-approve-bg':  '#22c55e',
        '--btn-reject-bg':   '#ef4444',
        '--btn-bombs-bg':    '#f59e0b',
        '--btn-editor-bg':   mix(neutral, primary, 0.4),
        '--btn-text':        '#ffffff',

        '--palette-bg':   isDark ? lighten(bg, 0.08) : darken(surface, 0.08),
        '--palette-selected': primary,

        '--output-bg':    isDark ? '#0a0a0a' : '#1e1e2e',
        '--output-text':  '#a6e3a1',

        '--win-bg':       mix(secondary, '#ffffff', 0.15),
        '--win-text':     readableText(mix(secondary, '#ffffff', 0.15)),

        '--hazard-bg':    alpha('#ef4444', 0.9),
        '--hazard-text':  '#ffffff',
        '--overlay-bg':   alpha('#000000', 0.6),

        '--satisfied-color':   '#22c55e',
        '--unsatisfied-color': '#ef4444',
    };

    return tokens;
}

// ─── Named theme registry ─────────────────────────────────────────────────────

window.THEMES = {
    'Midnight': {
        seeds: { bg:'#0f0f1a', surface:'#1a1a2e', primary:'#6366f1', secondary:'#a78bfa',
                 neutral:'#374151', text:'#e2e8f0', border:'#374151', path:'#818cf8' }
    },
    'Ocean': {
        seeds: { bg:'#0c1445', surface:'#0f1f4f', primary:'#0ea5e9', secondary:'#38bdf8',
                 neutral:'#1e3a5f', text:'#bae6fd', border:'#1e3a5f', path:'#7dd3fc' }
    },
    'Forest': {
        seeds: { bg:'#0a1f0a', surface:'#132613', primary:'#22c55e', secondary:'#86efac',
                 neutral:'#1a3a1a', text:'#d1fae5', border:'#1a3a1a', path:'#4ade80' }
    },
    'Sunset': {
        seeds: { bg:'#1a0a00', surface:'#2a1200', primary:'#f97316', secondary:'#fb923c',
                 neutral:'#3d1f00', text:'#fed7aa', border:'#3d1f00', path:'#fdba74' }
    },
    'Arctic': {
        seeds: { bg:'#f0f4f8', surface:'#ffffff', primary:'#3b82f6', secondary:'#60a5fa',
                 neutral:'#cbd5e1', text:'#1e293b', border:'#cbd5e1', path:'#2563eb' }
    },
    'Sakura': {
        seeds: { bg:'#fff0f6', surface:'#ffffff', primary:'#ec4899', secondary:'#f472b6',
                 neutral:'#fce7f3', text:'#831843', border:'#fbcfe8', path:'#db2777' }
    },
    'Neon': {
        seeds: { bg:'#020207', surface:'#060614', primary:'#ff0080', secondary:'#00ffff',
                 neutral:'#1a0030', text:'#ffffff', border:'#2d0060', path:'rainbow' }
    },
    'Slate': {
        seeds: { bg:'#0f172a', surface:'#1e293b', primary:'#94a3b8', secondary:'#cbd5e1',
                 neutral:'#334155', text:'#f1f5f9', border:'#334155', path:'#e2e8f0' }
    },
    'Ember': {
        seeds: { bg:'#1c0505', surface:'#2d0a0a', primary:'#ef4444', secondary:'#fca5a5',
                 neutral:'#450a0a', text:'#fee2e2', border:'#450a0a', path:'#f87171' }
    },
    'Mint': {
        seeds: { bg:'#f0fdf4', surface:'#ffffff', primary:'#10b981', secondary:'#34d399',
                 neutral:'#d1fae5', text:'#064e3b', border:'#a7f3d0', path:'#059669' }
    },
};

// ─── Apply theme ──────────────────────────────────────────────────────────────

function applyTheme(nameOrDef) {
    let themeDef;
    if (typeof nameOrDef === 'string') {
        themeDef = window.THEMES[nameOrDef] || window.THEMES['Midnight'];
    } else {
        themeDef = nameOrDef;
    }
    const tokens = deriveTokens(themeDef.seeds);
    if (themeDef.overrides) Object.assign(tokens, themeDef.overrides);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(tokens)) {
        if (k === '--path' || k === '--path-color') {
            // rainbow handled by renderer
        }
        root.style.setProperty(k, v);
    }
    root.dataset.pathRainbow = (themeDef.seeds.path === 'rainbow') ? '1' : '0';
    root.dataset.theme = typeof nameOrDef === 'string' ? nameOrDef : 'custom';
    return tokens;
}

window.ThemeEngine = { deriveTokens, applyTheme, readableText, lighten, darken, mix, alpha, hexToRgb };
