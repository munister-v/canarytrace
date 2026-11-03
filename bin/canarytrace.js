#!/usr/bin/env node
'use strict';
// canarytrace run <campaign.js> [args...]
//   Runs a campaign module: it must export `run(args)` returning a report (or
//   a promise of one). Prints the report as JSON; exits 1 if it has leaks.
// canarytrace summary <report.json>
//   Prints a short table of leaks per canary class and mutation scores.

const fs = require('fs');
const path = require('path');

function usage() {
  console.error('usage: canarytrace run <campaign.js> [args...]\n       canarytrace summary <report.json>');
  process.exit(2);
}

function countLeaks(report) {
  let n = 0;
  (function walk(v, key) {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (key === 'leaks' && typeof v === 'number') n += v;
  })(report);
  return n;
}

function summary(report) {
  const lines = [];
  (function walk(v, at) {
    if (!v || typeof v !== 'object') return;
    if (v.byClass) {
      lines.push(`${at || 'report'}: ${v.leaks} leak(s)`);
      for (const [cls, s] of Object.entries(v.byClass)) lines.push(`  ${cls.padEnd(22)} planted ${String(s.planted).padStart(8)}  leaked ${s.leaked}${s.missing ? `  missing ${s.missing}` : ''}`);
    }
    if (v.score) {
      lines.push(`${at || 'report'}: mutation score`);
      for (const [o, s] of Object.entries(v.score)) lines.push(`  ${o.padEnd(22)} killed ${s.killed} of ${s.total}`);
    }
    for (const [k, x] of Object.entries(v)) if (k !== 'byClass' && k !== 'mutants') walk(x, at ? `${at}.${k}` : k);
  })(report, '');
  return lines.join('\n');
}

async function main() {
  const [cmd, file, ...rest] = process.argv.slice(2);
  if (!cmd || !file) usage();
  if (cmd === 'summary') {
    console.log(summary(JSON.parse(fs.readFileSync(file, 'utf8'))));
    return;
  }
  if (cmd !== 'run') usage();
  const mod = require(path.resolve(file));
  if (typeof mod.run !== 'function') throw new Error(`${file} does not export run(args)`);
  const report = await mod.run(rest);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = countLeaks(report) > 0 ? 1 : 0;
}

if (require.main === module) {
  main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e.message); process.exit(2); });
}

module.exports = { summary, countLeaks };
