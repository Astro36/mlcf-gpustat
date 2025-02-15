import csv from "csv-parser";
import { Client } from "ssh2";
import serverConfigs from "./servers.config.json" with { type: "json" };
import { WebSocketServer } from "ws";

const PORT = 3000;
const serverStats = {};

const mapGpuName = (gpuName) => {
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

const runGpuStatCommand = (client, serverStat) => {
  return new Promise((_resolve, reject) => {
    client.exec(
      "nvidia-smi --query-gpu=timestamp,index,name,uuid,temperature.gpu,utilization.gpu,memory.total,memory.used,pstate --format=csv,noheader,nounits -l 2",
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
            const [
              updatedAt,
              index,
              name,
              uuid,
              temperature,
              utilization,
              memory_total,
              memory_used,
              pstate,
            ] = Object.values(data);

            if (index) {
              serverStat.gpus[index] = Object.assign(
                serverStat.gpus[index] || {},
                {
                  name: mapGpuName(name),
                  uuid,
                  temperature: Number(temperature),
                  utilization: Number(utilization),
                  memory_total: Number(memory_total),
                  memory_used: Number(memory_used),
                  pstate,
                  updatedAt,
                }
              );
            }
          })
          .on("end", reject)
          .on("error", reject);
      }
    );
  });
};

const setupGpuMonitoring = (serverConfig, serverStat) => {
  const client = new Client();
  client
    .on("ready", async () => {
      try {
        console.log(`✅ Connected to ${serverConfig.name}`);
        await runGpuStatCommand(client, serverStat);
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
    serverStats[serverConfig.host] = { name: serverConfig.name, gpus: {} };
    setupGpuMonitoring(serverConfig, serverStats[serverConfig.host]);
  }
};
startMonitoring();

const wss = new WebSocketServer({ port: PORT });
setInterval(() => {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(serverStats));
    }
  });
}, 2000);
