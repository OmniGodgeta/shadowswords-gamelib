#!/usr/bin/env node
const base = (process.argv[2] || "http://127.0.0.1:8710").replace(/\/$/, "");
const checks = [
  ["/index.html", (r) => r.ok],
  ["/assets/app.js", (r) => r.ok],
  ["/assets/live-tv.json", (r) => r.ok],
  ["/health", (r) => r.ok],
  ["/np/health", (r) => r.ok],
];
let failed = 0;
for (const [path, test] of checks) {
  try {
    const r = await fetch(base + path);
    const ok = test(r);
    console.log(`${ok ? "ok" : "FAIL"} ${path} (${r.status})`);
    if (!ok) failed++;
  } catch (e) {
    console.log(`FAIL ${path} (${e.message})`);
    failed++;
  }
}
if (failed) process.exitCode = 1;
