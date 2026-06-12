#!/usr/bin/env node
// tools/validate-hints.js – Validate all level hints using the engine rules.
// Usage: node tools/validate-hints.js [--verbose]
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Browser-globals shim ──────────────────────────────────────────────────────
const window = global;
window.window = global;

// Load engine and levels
eval(fs.readFileSync(path.join(__dirname, '../engine.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../levels.js'), 'utf8'));

const verbose = process.argv.includes('--verbose');
const E = window.Engine;
const levels = (window.RAW_LEVELS || []).map(l => E.normaliseLevel(l));

let totalHints = 0, passed = 0, failed = 0;

for (let li = 0; li < levels.length; li++) {
    const level = levels[li];
    if (!level.hints || !level.hints.length) continue;

    for (let hi = 0; hi < level.hints.length; hi++) {
        const hint = level.hints[hi];
        totalHints++;
        const result = E.validateSolution(level, hint);
        if (result.valid) {
            passed++;
            if (verbose) console.log(`Level ${li + 1} hint ${hi}: OK`);
        } else {
            failed++;
            console.error(`Level ${li + 1} hint ${hi}: FAIL — ${result.reason}`);
            if (verbose) {
                console.error('  Path:', JSON.stringify(hint));
            }
        }
    }
}

console.log(`\nHint validation: ${passed} passed, ${failed} failed (${totalHints} total)`);
process.exit(failed > 0 ? 1 : 0);
