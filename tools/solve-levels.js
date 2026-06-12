#!/usr/bin/env node
// tools/solve-levels.js – Run solver against all built-in levels and report results.
// Usage: node tools/solve-levels.js [--budget N] [--level N] [--verbose]
'use strict';

const fs   = require('fs');
const path = require('path');

// ── Browser-globals shim ──────────────────────────────────────────────────────
const window = global;
window.window = global;
// SolverV2 uses requestAnimationFrame; stub it out for Node (sync-only mode)
global.requestAnimationFrame = cb => cb();

// Load engine, solver, and levels
eval(fs.readFileSync(path.join(__dirname, '../engine.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../solver.js'), 'utf8'));
eval(fs.readFileSync(path.join(__dirname, '../levels.js'), 'utf8'));

// Parse args
const args = process.argv.slice(2);
const budgetArg = args.includes('--budget') ? parseInt(args[args.indexOf('--budget') + 1]) : 500_000;
const levelArg  = args.includes('--level')  ? parseInt(args[args.indexOf('--level')  + 1]) : null;
const verbose   = args.includes('--verbose');

const E = window.Engine;
const levels = (window.RAW_LEVELS || []).map(l => E.normaliseLevel(l));
const subset = levelArg !== null ? [levels[levelArg - 1]].filter(Boolean) : levels;
const offset = levelArg !== null ? levelArg - 1 : 0;

let solved = 0, unsolved = 0, noHints = 0, budgetExhausted = 0;
const startAll = Date.now();

for (let i = 0; i < subset.length; i++) {
    const level = subset[i];
    const li    = i + offset;
    const { errors } = E.validateLevelStructure(level);
    if (errors.length) {
        console.warn(`Level ${li + 1}: INVALID — ${errors[0]}`);
        unsolved++;
        continue;
    }

    const solver = new window.SolverV2(level, { budget: budgetArg, maxSolutions: 1 });
    const t0 = Date.now();
    const result = solver.solve();
    const ms = Date.now() - t0;

    if (result.found) {
        solved++;
        const hasHint = level.hints && level.hints.length > 0;
        if (!hasHint) noHints++;
        if (verbose || !hasHint) {
            console.log(`Level ${li + 1}: solved in ${ms}ms (${result.workUsed} nodes)${hasHint ? '' : ' [NO STORED HINT]'}`);
        }
    } else {
        if (result.reason === 'budget_exhausted') budgetExhausted++;
        else unsolved++;
        console.warn(`Level ${li + 1}: ${result.reason} (${ms}ms, ${result.workUsed} nodes)`);
    }
}

const elapsed = ((Date.now() - startAll) / 1000).toFixed(2);
console.log(`\nSolver results: ${solved} solved, ${unsolved} unsolved, ${budgetExhausted} budget_exhausted`);
if (noHints > 0) console.log(`  Levels with no stored hints: ${noHints}`);
console.log(`  Total time: ${elapsed}s, budget per level: ${budgetArg.toLocaleString()} nodes`);
process.exit((unsolved + budgetExhausted) > 0 ? 1 : 0);
