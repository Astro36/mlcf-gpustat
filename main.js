import csv from "csv-parser";
import { Client } from "ssh2";
import serverConfigs from "./servers.config.json" with { type: "json" };
import { WebSocketServer } from "ws";
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

const initializeGpuStats = (client, host) => {
  return new Promise((resolve, reject) => {
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

    client.exec(
      "nvidia-smi --query-gpu=index,name,uuid,memory.total --format=csv,noheader,nounits",
      (err, stream) => {
        if (err) return reject(err);
        stream
          .pipe(csv({ headers: false, mapValues: ({ value }) => value.trim() }))
          .on("data", handleData)
          .on("error", reject)
          .on("end", resolve);
      },
    );
  });
};

const monitorGpuStats = (client) => {
  return new Promise((_resolve, reject) => {
    const handleGpuData = (row) => {
      const [timestamp, uuid, temperature, utilization, memoryUsed] =
        Object.values(row);

      if (!(uuid in gpuUuidMap)) return;
      const gpuStat = gpuUuidMap[uuid];

      gpuStat.temperature = Number(temperature);
      gpuStat.memoryUsed = Number(memoryUsed);
      gpuStat.updatedAt = timestamp;
      gpuStat.utilizationHistory = [
        gpuStat.utilizationHistory[1],
        gpuStat.utilizationHistory[2],
        Number(utilization),
      ]; // Slide the history
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
      let [timestamp, uuid, pid, user, memoryUsed] = Object.values(row);
      const updatedAt = new Date(timestamp);

      if (!(uuid in gpuUuidMap)) return;
      const gpuStat = gpuUuidMap[uuid];

      gpuStat.processes[pid] = { pid, user, memoryUsed, updatedAt };

      const now = updatedAt;
      const TTL = BROADCAST_INTERVAL_MS;
      for (const pid in gpuStat.processes) {
        if (
          now - gpuStat.processes[pid].updatedAt > TTL ||
          !gpuStat.processes[pid].user
        ) {
          delete gpuStat.processes[pid];
        }
      }
    };

    client.exec(
      `while true; do nvidia-smi --query-compute-apps=timestamp,gpu_uuid,pid,used_memory --format=csv,noheader,nounits | while IFS=',' read -r ts uuid pid mem; do user=$(ps -o user= -p $pid 2>/dev/null); echo "$ts,$uuid,$pid,$user,$mem"; done; sleep 1; done`,
      (err, stream) => {
        if (err) return reject(err);
        stream
          .pipe(csv({ headers: false, mapValues: ({ value }) => value.trim() }))
          .on("data", handleProcessData)
          .on("error", reject)
          .on("end", reject);
      },
    );
  });
};

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
  for (const config of serverConfigs) {
    connectToServer(config);
  }
};

const startServer = () => {
  const server = http.createServer((req, res) =>
    serveHandler(req, res, { public: "static/dist" }),
  );

  const wss = new WebSocketServer({ server, path: "/ws" });

  setInterval(() => {
    const payload = JSON.stringify(serverStats);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }, BROADCAST_INTERVAL_MS);

  server.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
};

startMonitoring();
startServer();
