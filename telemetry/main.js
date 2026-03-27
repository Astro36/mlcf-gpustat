// telemetry/main.js — single-server GPU data collector
// One container per server. Pushes metrics to VictoriaMetrics.
// Exposes GET /health on HEALTH_PORT. Returns 200 when SSH is connected, 503 when disconnected.
// Docker will restart the container when health checks fail repeatedly.

import { Client } from "ssh2";
import http from "http";
import { initializeGpuStats, monitorGpuStats } from "./gpu/monitor.js";
import { pushToVictoriaMetrics } from "./metrics/victoriametrics.js";

// --- Config (all via environment variables) ---

const SERVER_HOST = process.env.SERVER_HOST;
const SERVER_NAME = process.env.SERVER_NAME ?? SERVER_HOST;
const SERVER_USERNAME = process.env.SERVER_USERNAME;
const SERVER_PASSWORD = process.env.SERVER_PASSWORD;
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 22);
const PUSH_INTERVAL_MS = 2000;

const VICTORIAMETRICS_URL = process.env.VICTORIAMETRICS_URL ?? "http://localhost:8428";

const HEALTH_PORT = 9090;

if (!SERVER_HOST || !SERVER_USERNAME || !SERVER_PASSWORD) {
  console.error("❌ Required env vars missing: SERVER_HOST, SERVER_USERNAME, SERVER_PASSWORD");
  process.exit(1);
}

// --- State ---

let isConnected = false;
const serverStats = { [SERVER_HOST]: { name: SERVER_NAME, host: SERVER_HOST } };
const gpuUuidMap = {};

// --- SSH connection + monitoring ---

const connectAndMonitor = () => {
  const client = new Client();
  const serverStat = serverStats[SERVER_HOST];
  client
    .on("ready", async () => {
      isConnected = true;
      console.log(`✅ Connected to ${SERVER_NAME} (${SERVER_HOST})`);
      try {
        await initializeGpuStats(client, serverStat, gpuUuidMap);
        await monitorGpuStats(client, gpuUuidMap, serverStat, PUSH_INTERVAL_MS);
      } catch (err) {
        client.emit("error", err);
      } finally {
        client.end();
      }
    })
    .on("error", (err) => {
      isConnected = false;
      console.error(`❌ ${SERVER_NAME}: ${err.message}`);
      process.exit(1);
    })
    .on("close", () => {
      isConnected = false;
      console.log(`🔌 Disconnected from ${SERVER_NAME}`);
      process.exit(1);
    })
    .connect({ host: SERVER_HOST, port: SERVER_PORT, username: SERVER_USERNAME, password: SERVER_PASSWORD });
};

// --- Health check server ---
// Docker HEALTHCHECK polls GET /health.
// Returns 200 (OK) when SSH is connected, 503 (DISCONNECTED) otherwise.

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(isConnected ? 200 : 503);
      res.end(isConnected ? "OK" : "DISCONNECTED");
    } else {
      res.writeHead(404).end();
    }
  })
  .listen(HEALTH_PORT, () => {
    console.log(`❤️  Health: http://localhost:${HEALTH_PORT}/health`);
  });

// --- Push loop ---

setInterval(async () => {
  await pushToVictoriaMetrics(VICTORIAMETRICS_URL, serverStats);
}, PUSH_INTERVAL_MS);

// --- Start ---

connectAndMonitor();
console.log(`🚀 Telemetry started — ${SERVER_NAME} (${SERVER_HOST})`);
console.log(`📊 VictoriaMetrics: ${VICTORIAMETRICS_URL}`);
