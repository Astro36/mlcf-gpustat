import csv from "csv-parser";
import { Client } from "ssh2";
import serverConfigs from "./servers.config.json" with { type: "json" };
import { WebSocketServer } from "ws";
import http from "http";
import serveHandler from "serve-handler";

const PORT = 3000;

const serverStats = {};
const gpuUuid2gpuStat = {};

const noramlizeGpuName = (gpuName) => {
  if (gpuName.includes("A4000")) {
    gpuName = "NVIDIA RTX A4000";
  } else if (gpuName.includes("A100")) {
    gpuName = "NVIDIA A100 80GB";
  } else if (gpuName.includes("2080")) {
    gpuName = "GeForce RTX 2080 Ti";
  } else if (gpuName.includes("3090")) {
    gpuName = "GeForce RTX 3090";
  }
  return gpuName;
};

const initCollectorClient = (client, host) => {
  const serverStat = serverStats[host];
  serverStat.gpus ??= {};

  return new Promise((resolve, reject) => {
    client.exec(
      "nvidia-smi --query-gpu=index,name,uuid,memory.total --format=csv,noheader,nounits",
      (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        stream
          .pipe(
            csv({
              headers: false,
              mapValues: ({ _header, _index, value }) => value.trim(),
            })
          )
          .on("data", (data) => {
            const [index, name, uuid, memory_total] = Object.values(data);
            if (!uuid) {
              reject(data[0]);
              return;
            }
            serverStat.gpus[index] = {
              name: noramlizeGpuName(name),
              memory_total: Number(memory_total),
              utilization_history: [0, 0, 0],
              processes: {},
            };
            gpuUuid2gpuStat[uuid] = serverStat.gpus[index];
          })
          .on("end", resolve)
          .on("error", reject);
      }
    );
  });
};

const startCollectorClient = (client, host) => {
  return new Promise((_resolve, reject) => {
    // GPU monitoring
    client.exec(
      "nvidia-smi --query-gpu=timestamp,uuid,temperature.gpu,utilization.gpu,memory.used --format=csv,noheader,nounits -l 1",
      (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        stream
          .pipe(
            csv({
              headers: false,
              mapValues: ({ _header, _index, value }) => value.trim(),
            })
          )
          .on("data", (data) => {
            const [updatedAt, uuid, temperature, utilization, memory_used] =
              Object.values(data);

            const gpuStat = gpuUuid2gpuStat[uuid];
            gpuStat.temperature = Number(temperature);
            gpuStat.memory_used = Number(memory_used);
            gpuStat.updatedAt = updatedAt;

            gpuStat.utilization_history.shift();
            gpuStat.utilization_history.push(Number(utilization));
            gpuStat.utilization = Math.max(...gpuStat.utilization_history);
          })
          .on("end", reject)
          .on("error", reject);
      }
    );

    // Process monitoring
    client.exec(
      `while true; do nvidia-smi --query-compute-apps=timestamp,gpu_uuid,pid,used_memory --format=csv,noheader,nounits | while IFS=',' read -r ts uuid pid mem; do user=$(ps -o user= -p $pid 2>/dev/null); echo "$ts,$uuid,$pid,$user,$mem"; done; sleep 1; done`,
      (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        stream
          .pipe(
            csv({
              headers: false,
              mapValues: ({ header, index, value }) => value.trim(),
            })
          )
          .on("data", (data) => {
            let [updatedAt, uuid, pid, user, memory_used] = Object.values(data);
            updatedAt = new Date(updatedAt);

            const gpuStat = gpuUuid2gpuStat[uuid];
            gpuStat.processes[pid] = {
              pid,
              user,
              memory_used,
              updatedAt,
            };

            const TTL = 2000;
            const now = updatedAt;
            for (const pid in gpuStat.processes) {
              if (now - gpuStat.processes[pid].timestamp > TTL) {
                delete gpuStat.processes[pid];
              }
            }
          })
          .on("end", reject)
          .on("error", reject);
      }
    );
  });
};

const setupGpuMonitoring = (serverConfig) => {
  serverStats[serverConfig.host] = {
    name: serverConfig.name,
    host: serverConfig.host,
  };

  const client = new Client();
  client
    .on("ready", async () => {
      try {
        console.log(`✅ Connected to ${serverConfig.name}`);
        await initCollectorClient(client, serverConfig.host);
        await startCollectorClient(client, serverConfig.host);
      } catch (err) {
        client.emit("error", err);
      } finally {
        client.end();
      }
    })
    .on("error", (err) => {
      console.error(`❌ Connection error on ${serverConfig.name}:`, err);
    })
    .on("close", () => {
      console.log(`🔌 Disconnected from ${serverConfig.name}`);
    })
    .connect(serverConfig);
};

const startMonitoring = async () => {
  for (const serverConfig of serverConfigs) {
    setupGpuMonitoring(serverConfig);
  }
};
startMonitoring();

const server = http.createServer((request, response) => {
  return serveHandler(request, response, {public: "static/dist"});
});

const wss = new WebSocketServer({ server });
setInterval(() => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(serverStats));
    }
  });
}, 2000);

server.listen(PORT, () => {
  console.log(`Running at http://localhost:${PORT}`);
});

