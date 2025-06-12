import fs from "fs";
import path from "path";
import csv from "csv-parser";
import { Client } from "ssh2";
import serverConfigs from "./servers.config.json" with { type: "json" };
import { WebSocket, WebSocketServer } from "ws";
import http from "http";
import serveHandler from "serve-handler";

const PORT = 3000;
const BROADCAST_INTERVAL_MS = 2000;
const GPU_UTILIZATION_HISTORY_LENGTH = 3;

const serverStats = {};
const gpuUuidMap = {};

const normalizeGpuName = (name) => {
  if (name.includes("A4000")) return "NVIDIA RTX A4000";
  if (name.includes("A100")) return "NVIDIA A100 80GB";
  if (name.includes("2080")) return "GeForce RTX 2080 Ti";
  if (name.includes("3090")) return "GeForce RTX 3090";
  return name;
};

const initializeGpuStats = (client, host) =>
  new Promise((resolve, reject) => {
    const serverStat = serverStats[host];
    serverStat.gpus ??= {};

    const handleData = (row) => {
      const [index, name, uuid, memoryTotal] = Object.values(row);
      if (!uuid) return reject(new Error("GPU UUID missing"));

      const gpuStat = {
        name: normalizeGpuName(name),
        memoryTotal: Number(memoryTotal),
        utilizationHistory: Array(GPU_UTILIZATION_HISTORY_LENGTH).fill(0),
        processes: {},
      };
      serverStat.gpus[index] = gpuStat;
      gpuUuidMap[uuid] = gpuStat;
    };

    client.exec("nvidia-smi --query-gpu=index,name,uuid,memory.total --format=csv,noheader,nounits", (err, stream) => {
      if (err) return reject(err);
      stream
        .pipe(csv({ headers: false, mapValues: ({ value }) => value.trim() }))
        .on("data", handleData)
        .on("error", reject)
        .on("end", resolve);
    });
  });

const monitorGpuStats = (client) =>
  new Promise((_resolve, reject) => {
    const handleGpuData = (row) => {
      const [_timestamp, uuid, temperature, utilization, memoryUsed] = Object.values(row);

      const gpuStat = gpuUuidMap[uuid];
      gpuStat.temperature = Number(temperature);
      gpuStat.memoryUsed = Number(memoryUsed);
      gpuStat.updatedAt = new Date();
      gpuStat.utilizationHistory = [gpuStat.utilizationHistory[1], gpuStat.utilizationHistory[2], Number(utilization)]; // Slide the history
      gpuStat.utilization = Math.max(...gpuStat.utilizationHistory);
    };

    client.exec(
      "nvidia-smi --query-gpu=timestamp,uuid,temperature.gpu,utilization.gpu,memory.used --format=csv,noheader,nounits -l 1",
      (err, stream) => {
        if (err) return reject(err);
        stream
          .pipe(csv({ headers: false, mapValues: ({ value }) => value.trim() }))
          .on("data", handleGpuData)
          .on("error", reject)
          .on("end", reject);
      },
    );

    const handleProcessData = (row) => {
      let [_timestamp, uuid, pid, user, memoryUsed] = Object.values(row);
      const updatedAt = new Date();

      const gpuStat = gpuUuidMap[uuid];
      gpuStat.processes[pid] = { pid, user, memoryUsed, updatedAt };
    };

    client.exec(
      `while true; do timeout 5s nvidia-smi --query-compute-apps=timestamp,gpu_uuid,pid,used_memory --format=csv,noheader,nounits | while IFS=',' read -r ts uuid pid mem; do user=$(ps -o user= -p $pid 2>/dev/null); echo "$ts,$uuid,$pid,$user,$mem"; done; sleep 1; done`,
      (err, stream) => {
        if (err) return reject(err);
        stream
          .pipe(csv({ headers: false, mapValues: ({ value }) => value.trim() }))
          .on("data", handleProcessData)
          .on("error", reject)
          .on("end", reject);
      },
    );

    const disposeProcessData = () => {
      const gpuStats = Object.values(serverStats[client.config.host].gpus);
      for (const gpuStat of gpuStats) {
        const now = new Date();
        const TTL = BROADCAST_INTERVAL_MS * 1.5;
        for (const pid in gpuStat.processes) {
          if (now - gpuStat.processes[pid].updatedAt > TTL || !gpuStat.processes[pid].user) {
            delete gpuStat.processes[pid];
          }
        }
      }
    };
    setInterval(disposeProcessData, BROADCAST_INTERVAL_MS);
  });

const connectToServer = (config) => {
  const { host, name } = config;
  serverStats[host] = { name, host };

  const client = new Client();
  client
    .on("ready", async () => {
      console.log(`✅ Connected to ${name}`);
      try {
        await initializeGpuStats(client, host);
        await monitorGpuStats(client);
      } catch (error) {
        client.emit("error", error);
      } finally {
        client.end();
      }
    })
    .on("error", (err) => {
      console.error(`❌ Connection error on ${name}:`, err);
    })
    .on("close", () => {
      console.log(`🔌 Disconnected from ${name}`);
    })
    .connect(config);
};

const startMonitoring = () => {
  serverConfigs.forEach(connectToServer);
};

const startWebServer = (logFilePath) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/gpu-history" && req.method === "GET") {
      const host = url.searchParams.get("host");
      const gpuIndex = url.searchParams.get("gpu");

      if (!host || gpuIndex === null) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Missing host or gpu parameters" }));
      }

      try {
        // Calculate date 7 days ago
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 3);

        // Read and parse log file
        const historyData = [];
        const logLines = fs.readFileSync(logFilePath, "utf-8").split("\n");

        // Skip header line
        for (let i = 1; i < logLines.length; i++) {
          const line = logLines[i].trim();
          if (!line) continue;

          const [timestamp, serverName, index, utilization, memoryUsed, users] = line.split(",");

          // Check if this line matches the requested server and GPU
          if (serverName === host && index === gpuIndex) {
            const lineDate = new Date(timestamp);

            // Only include data from the last week
            if (lineDate >= oneWeekAgo) {
              historyData.push({
                timestamp,
                utilization: Number(utilization),
                memoryUsed: Number(memoryUsed),
                users: users
                  ? users
                      .split("|")
                      .map((user) => {
                        const match = user.match(/(.+?)\((\d+)\)/);
                        return match ? { name: match[1], memoryUsed: Number(match[2]) } : null;
                      })
                      .filter(Boolean)
                  : [],
              });
            }
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            host,
            gpuNumber: gpuIndex,
            history: historyData,
          }),
        );
      } catch (err) {
        console.error("Error reading log file:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to retrieve GPU history" }));
      }
    } else {
      // Continue with the static file serving for non-API requests
      serveHandler(req, res, { public: "static/dist" });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  setInterval(() => {
    const payload = JSON.stringify(serverStats);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });

    const timestamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD HH:mm:ss
    let logContent = "";
    for (const host in serverStats) {
      const serverStat = serverStats[host];
      for (const index in serverStat.gpus) {
        const gpuStat = serverStat.gpus[index];
        const users = Object.values(gpuStat.processes ?? {})
          .map((proc) => `${proc.user}(${proc.memoryUsed})`)
          .join("|");
        if (gpuStat.utilization === undefined || gpuStat.memoryUsed === undefined) continue;
        if (gpuStat.utilization >= 10 && users.length == 0) continue;
        logContent += `${timestamp},${serverStat.host},${index},${gpuStat.utilization},${gpuStat.memoryUsed},${users}\n`;
      }
    }
    fs.appendFile(logFilePath, logContent, (err) => {
      if (err) {
        console.error("Error writing to log file:", err);
      }
    });
  }, BROADCAST_INTERVAL_MS);

  server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
};

const main = () => {
  const logDir = "./logs";
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, "gpustat.log");
  if (!fs.existsSync(logFile)) {
    fs.appendFile(logFile, "timestamp,server_name,gpu_number,utilization,memory_used,users\n", (err) => {
      if (err) {
        console.error("Error writing to log file:", err);
      }
    });
  }

  startMonitoring();
  startWebServer(logFile);
};
main();
