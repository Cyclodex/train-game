#!/usr/bin/env node
// Where the unit suite's time actually goes.
//
//   npm run test:unit:profile            # full suite, ranked
//   npm run test:unit:profile -- --fast  # the fast lane only
//   npm run test:unit:profile -- --top 40
//
// Runs vitest with the JSON reporter and prints the slowest FILES and the
// slowest individual TESTS, plus what the two tiers currently cost. This is the
// tool that keeps the tiering in `tests/unit/support/tier.ts` honest: the line
// between a fast case and a slow one moves every time the sim's hot path
// changes, so check it here rather than guessing.
//
// Read it as: anything near the top of "slowest tests" that is NOT already
// tagged `itSlow` is a candidate for tagging, and anything tagged that now runs
// in milliseconds should go back to plain `it`.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const fast = argv.includes("--fast");
const topIdx = argv.indexOf("--top");
const TOP = topIdx >= 0 ? Number(argv[topIdx + 1]) : 20;
// Anything at or above this is worth considering for the slow tier. Kept in step
// with the guidance in tests/unit/support/tier.ts.
const SLOW_MS = 900;

const dir = mkdtempSync(join(tmpdir(), "vitest-profile-"));
const out = join(dir, "report.json");

const args = ["vitest", "run", "--reporter=json", `--outputFile=${out}`];
if (fast) args.push("--config", "vitest.fast.config.ts");

console.log(`running the ${fast ? "FAST" : "FULL"} unit suite (this takes a while)…\n`);
const started = Date.now();
const run = spawnSync("npx", args, { stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
const wall = (Date.now() - started) / 1000;

let report;
try {
  report = JSON.parse(readFileSync(out, "utf8"));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (!report) process.exit(run.status ?? 1);

const rel = name => name.replace(/.*tests[/\\]unit[/\\]/, "");
const ms = n => `${Math.round(n)}`.padStart(7);

const files = new Map();
const tests = [];
for (const file of report.testResults) {
  files.set(rel(file.name), file.endTime - file.startTime);
  for (const t of file.assertionResults) {
    tests.push({ file: rel(file.name), title: t.title, ms: t.duration ?? 0, status: t.status });
  }
}

const ranked = [...files.entries()].sort((a, b) => b[1] - a[1]);
const cpu = ranked.reduce((s, [, v]) => s + v, 0);

console.log(`slowest FILES (of ${files.size})`);
for (const [f, v] of ranked.slice(0, TOP)) console.log(`${ms(v)}  ${f}`);

const run_ = tests.filter(t => t.status !== "skipped" && t.status !== "pending");
console.log(`\nslowest TESTS (of ${run_.length} run, ${tests.length - run_.length} skipped)`);
for (const t of [...run_].sort((a, b) => b.ms - a.ms).slice(0, TOP)) {
  console.log(`${ms(t.ms)}  ${t.file} :: ${t.title.slice(0, 64)}`);
}

const over = run_.filter(t => t.ms >= SLOW_MS);
const overMs = over.reduce((s, t) => s + t.ms, 0);
console.log(
  `\nwall ${wall.toFixed(1)}s · cpu ${(cpu / 1000).toFixed(1)}s across ${files.size} files` +
    `\n${over.length} test(s) at or over ${SLOW_MS}ms, costing ${(overMs / 1000).toFixed(1)}s` +
    ` (${cpu ? Math.round((100 * overMs) / cpu) : 0}% of cpu time)`,
);
if (!fast && over.length) {
  console.log("\ncandidates for the slow tier (see tests/unit/support/tier.ts):");
  for (const t of over.sort((a, b) => b.ms - a.ms)) console.log(`${ms(t.ms)}  ${t.file} :: ${t.title.slice(0, 64)}`);
}
process.exit(run.status ?? 0);
