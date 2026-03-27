import { WebSocket, WebSocketServer } from "ws";
import http from "http";
import serveHandler from "serve-handler";

const BROADCAST_INTERVAL_MS = 2000;
const PORT = 8080;
const VICTORIAMETRICS_URL = process.env.VICTORIAMETRICS_URL ?? "http://localhost:8428";

/**
 * Builds server stats by querying the VictoriaMetrics instant API.
 * Reconstructs the same shape the web dashboard frontend expects:
 * { [host]: { name, host, gpus: { [index]: { name, memoryTotal, utilization,
 *                                             memoryUsed, temperature, processes } } } }
 *
 * @param {string} vmUrl - VictoriaMetrics base URL
 * @param {string} [lookback="15s"] - Lookback window for last_over_time (stale metrics disappear quickly)
 * @returns {Promise<object>} Server stats keyed by host
 */
export const buildServerStats = async (vmUrl, lookback = "15s") => {
  const vmBase = `${vmUrl}/api/v1/query`;
  const q = (metric) => `last_over_time(${metric}[${lookback}])`;
  const utilQuery = "max_over_time(gpu_utilization[3s])";

  try {
    const [utilRes, memUsedRes, memTotalRes, tempRes, procRes] = await Promise.all([
      fetch(`${vmBase}?query=${encodeURIComponent(utilQuery)}`),
      fetch(`${vmBase}?query=${encodeURIComponent(q("gpu_memory_used"))}`),
      fetch(`${vmBase}?query=${encodeURIComponent(q("gpu_memory_total"))}`),
      fetch(`${vmBase}?query=${encodeURIComponent(q("gpu_temperature"))}`),
      fetch(`${vmBase}?query=${encodeURIComponent(q("gpu_process_memory_used"))}`),
    ]);

    const [utilData, memUsedData, memTotalData, tempData, procData] = await Promise.all([
      utilRes.json(),
      memUsedRes.json(),
      memTotalRes.json(),
      tempRes.json(),
      procRes.json(),
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

    return stats;
  } catch (err) {
    console.error("buildServerStats error:", err.message);
    return {};
  }
};


// --- HTTP server ---

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200);
    return res.end("OK");
  }

  serveHandler(req, res, { public: "static/dist" });
});

// --- WebSocket broadcast ---

const wss = new WebSocketServer({ server, path: "/ws" });

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
  console.log(`🌐 Web dashboard: http://localhost:${PORT}`);
  console.log(`📊 VictoriaMetrics: ${VICTORIAMETRICS_URL}`);
});
