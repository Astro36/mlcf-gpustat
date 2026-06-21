#!/usr/bin/env node
// telemetry/cleanup-orphans.js
//
// One-shot cleanup for orphaned GPU-monitor processes left on the GPU hosts by
// the pre-fix telemetry. The old SSH exec loops survived disconnects, so every
// container restart leaked another `while true` loop that kept spawning
// nvidia-smi forever (the pile of stuck nvidia-smi seen in `top`).
//
// This connects to every server in ../servers.config.json and kills the leftover
// monitor loops. It targets the EXACT query signatures telemetry/gpu/monitor.js
// emits (unchanged from the buggy version, so the same patterns match the
// orphans it produced):
//   - compute-apps loop:  nvidia-smi --query-compute-apps=timestamp,gpu_uuid,pid,used_memory ...
//   - gpu-stat -l loop:   nvidia-smi --query-gpu=timestamp,uuid,temperature.gpu,... -l 1
//
// Notes:
//   - nvidia-smi stuck in D (uninterruptible) state cannot be killed by ANY
//     signal; it clears on its own once the GPU driver frees up (or on reboot).
//     This script kills the *loops* that keep respawning them — that is what
//     actually stops the pile-up. Surviving D-state processes are reported.
//   - Run this AFTER deploying the fixed telemetry (or with the stack stopped).
//     If old telemetry is still running it will just reconnect and leak again.
//     If the fixed telemetry is running, killing its (legit) monitors only
//     triggers a clean reconnect — a brief blip, not a problem.
//
// Usage:
//   node cleanup-orphans.js                  # find + kill on every server
//   node cleanup-orphans.js --dry-run        # only list what would be killed
//   node cleanup-orphans.js server-39        # limit to one or more servers
//   node cleanup-orphans.js --dry-run 39     # name or host substring also works

import { Client } from "ssh2";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "servers.config.json");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const NAME_FILTERS = args.filter((a) => !a.startsWith("--"));

const READY_TIMEOUT_MS = 15000;
const OVERALL_TIMEOUT_MS = 60000;

// Bracketed first char ("[q]uery...") is an ERE that still matches the orphans'
// literal "query..." command lines, but NOT this cleanup command's own shell
// (whose cmdline carries the bracketed text verbatim). Combined with pgrep/pkill
// excluding their own process, this makes the remote command safe to run.
const PATTERNS = ["[q]uery-compute-apps=timestamp,gpu_uuid", "[q]uery-gpu=timestamp,uuid,temperature"];

const listSection = PATTERNS.map((p) => `pgrep -af '${p}' || echo '  (none)'`).join("; echo '  --'; ");

const buildRemoteCommand = () => {
  const cmds = [];
  cmds.push("echo '--- monitor loops (before) ---'");
  cmds.push(listSection);
  if (!DRY_RUN) {
    cmds.push("echo '--- killing ---'");
    for (const p of PATTERNS) cmds.push(`pkill -f '${p}' && echo "  TERM -> ${p}" || echo "  no match -> ${p}"`);
    cmds.push("sleep 2");
    for (const p of PATTERNS) cmds.push(`pkill -9 -f '${p}' >/dev/null 2>&1 || true`);
    cmds.push("sleep 1");
    cmds.push("echo '--- still alive (after) ---'");
    cmds.push(listSection);
  }
  cmds.push("echo '--- D-state nvidia-smi (uninterruptible; clears when the driver frees) ---'");
  cmds.push(`ps -eo pid,stat,etime,cmd | awk '$2 ~ /D/ && /nvidia-smi/ { print "  " $0 }'; true`);
  return cmds.join("; ");
};

const runRemote = (server, command) =>
  new Promise((resolve) => {
    const conn = new Client();
    let out = "";
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        conn.end();
      } catch {}
      resolve({ server, ...result, out });
    };

    const timer = setTimeout(() => done({ ok: false, error: "timed out" }), OVERALL_TIMEOUT_MS);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) return done({ ok: false, error: err.message });
          stream.on("data", (d) => (out += d.toString()));
          stream.stderr.on("data", (d) => (out += d.toString()));
          stream.on("close", () => done({ ok: true }));
        });
      })
      .on("error", (err) => done({ ok: false, error: err.message }))
      .connect({
        host: server.host,
        port: server.port ?? 22,
        username: server.username,
        password: server.password,
        readyTimeout: READY_TIMEOUT_MS,
      });
  });

const main = async () => {
  let servers = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (NAME_FILTERS.length) {
    servers = servers.filter((s) => NAME_FILTERS.some((f) => s.name.includes(f) || s.host.includes(f)));
  }

  if (servers.length === 0) {
    console.error("No matching servers in servers.config.json");
    process.exit(1);
  }

  console.log(`🧹 Orphan GPU-monitor cleanup${DRY_RUN ? "  (DRY RUN — nothing will be killed)" : ""}`);
  console.log(`   ${servers.length} server(s): ${servers.map((s) => s.name).join(", ")}\n`);

  const command = buildRemoteCommand();
  const results = await Promise.all(servers.map((s) => runRemote(s, command)));

  for (const r of results) {
    console.log("========================================================");
    console.log(`▶ ${r.server.name} (${r.server.host})  ${r.ok ? "✅ connected" : "❌ " + r.error}`);
    console.log("========================================================");
    if (r.out.trim()) console.log(r.out.trimEnd());
    console.log("");
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`Done — reached ${results.length - failed.length}/${results.length} server(s).`);
  if (failed.length) console.log(`Unreachable: ${failed.map((r) => r.server.name).join(", ")}`);
  if (DRY_RUN) console.log("\nDry run only. Re-run without --dry-run to actually kill the loops.");
};

main();
