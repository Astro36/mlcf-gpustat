import { WebSocket, WebSocketServer } from "ws";
import http from "http";
import serveHandler from "serve-handler";

const BROADCAST_INTERVAL_MS = 2000;
const PORT = 8080;
const BASE_PATH = (process.env.BASE_PATH ?? "").replace(/\/+$/, "");
const VICTORIAMETRICS_URL = process.env.VICTORIAMETRICS_URL ?? "http://localhost:8428";

/**
 * Builds server stats by querying the VictoriaMetrics instant API.
 * Reconstructs the same shape the web dashboard frontend expects:
 * { [host]: { name, host, gpus: { [index]: { name, memoryTotal, utilization,
 *                                             memoryUsed, temperature, processes } } } }
 *
 * @param {string} vmUrl - VictoriaMetrics base URL
 * @returns {Promise<object>} Server stats keyed by host
 */
export const buildServerStats = async (vmUrl) => {
  const vmBase = `${vmUrl}/api/v1/query`;
  const q = (metric) => `last_over_time(${metric}[5s])`;
  const utilQuery = "max_over_time(gpu_utilization[5s])";
  const lastUserQuery = `tlast_over_time(gpu_process_memory_used[7d])`;

  try {
    const [utilRes, memUsedRes, memTotalRes, tempRes, procRes, lastUserRes] = await Promise.all([
      fetch(`${vmBase}?query=${encodeURIComponent(utilQuery)}`),
      fetch(`${vmBase}?query=${encodeURIComponent(q("gpu_memory_used"))}`),
      fetch(`${vmBase}?query=${encodeURIComponent(q("gpu_memory_total"))}`),
      fetch(`${vmBase}?query=${encodeURIComponent(q("gpu_temperature"))}`),
      fetch(`${vmBase}?query=${encodeURIComponent(q("gpu_process_memory_used"))}`),
      fetch(`${vmBase}?query=${encodeURIComponent(lastUserQuery)}`),
    ]);

    const [utilData, memUsedData, memTotalData, tempData, procData, lastUserData] = await Promise.all([
      utilRes.json(),
      memUsedRes.json(),
      memTotalRes.json(),
      tempRes.json(),
      procRes.json(),
      lastUserRes.json(),
    ]);

    const stats = {};

    const getGpu = ({ server_name, server_host, gpu_index, gpu_name }) => {
      stats[server_host] ??= { name: server_name, host: server_host, gpus: {} };
      stats[server_host].gpus[gpu_index] ??= { name: gpu_name, processes: {} };
      return stats[server_host].gpus[gpu_index];
    };

    for (const { metric, value } of utilData.data?.result ?? []) {
      getGpu(metric).utilization = Number(value[1]);
    }
    for (const { metric, value } of memUsedData.data?.result ?? []) {
      getGpu(metric).memoryUsed = Number(value[1]);
    }
    for (const { metric, value } of memTotalData.data?.result ?? []) {
      getGpu(metric).memoryTotal = Number(value[1]);
    }
    for (const { metric, value } of tempData.data?.result ?? []) {
      getGpu(metric).temperature = Number(value[1]);
    }
    // Processes keyed by username (frontend only reads .user and .memoryUsed)
    for (const { metric, value } of procData.data?.result ?? []) {
      const gpu = getGpu(metric);
      const user = metric.user;
      gpu.processes[user] = { pid: user, user, memoryUsed: Number(value[1]) };
    }

    // Most recent user per server: pick the series with the latest sample timestamp.
    // value[1] is the timestamp in seconds returned by tlast_over_time.
    const lastUsed = {};
    for (const { metric, value } of lastUserData.data?.result ?? []) {
      const host = metric.server_host;
      const timestamp = Number(value[1]);
      if (!Number.isFinite(timestamp)) continue;
      if (!lastUsed[host] || timestamp > lastUsed[host].timestamp) {
        lastUsed[host] = { user: metric.user, timestamp };
      }
    }
    for (const [host, info] of Object.entries(lastUsed)) {
      if (stats[host]) stats[host].lastUsed = info;
    }

    return stats;
  } catch (err) {
    console.error("buildServerStats error:", err.message);
    return {};
  }
};

// --- HTTP server ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;

  if (BASE_PATH) {
    // Redirect bare base path to trailing slash so the page's relative URLs resolve under BASE_PATH.
    if (pathname === BASE_PATH) {
      res.writeHead(301, { Location: `${BASE_PATH}/` });
      return res.end();
    }
    // Strip the prefix so health/static serving work regardless of mount point.
    if (pathname.startsWith(`${BASE_PATH}/`)) {
      pathname = pathname.slice(BASE_PATH.length);
      req.url = req.url.slice(BASE_PATH.length);
    }
  }

  if (pathname === "/health") {
    res.writeHead(200);
    return res.end("OK");
  }

  serveHandler(req, res, { public: "static/dist" });
});

// --- WebSocket broadcast ---

const wss = new WebSocketServer({ server, path: `${BASE_PATH}/ws` });

setInterval(async () => {
  if (wss.clients.size === 0) return;
  const stats = await buildServerStats(VICTORIAMETRICS_URL);
  const payload = JSON.stringify(stats);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}, BROADCAST_INTERVAL_MS);

// --- Start ---

server.listen(PORT, () => {
  console.log(`🌐 Web dashboard: http://localhost:${PORT}${BASE_PATH}/`);
  console.log(`📊 VictoriaMetrics: ${VICTORIAMETRICS_URL}`);
});
