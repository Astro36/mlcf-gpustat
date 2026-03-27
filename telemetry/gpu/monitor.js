import csv from "csv-parser";
import { normalizeGpuName } from "./utils.js";

/**
 * Initializes GPU stats by querying nvidia-smi.
 *
 * ⚠️ Mutation contract: both `serverStat` and `gpuUuidMap` are out-parameters.
 * - `serverStat.gpus` is populated with GPU stat objects keyed by GPU index.
 * - `gpuUuidMap` is populated with GPU stat objects keyed by UUID.
 *
 * @param {object} client - Connected SSH2 client
 * @param {object} serverStat - Server stat object; `.gpus` is populated as side effect
 * @param {object} gpuUuidMap - UUID-to-gpuStat map; populated as side effect
 * @returns {Promise<void>} Resolves when initialization is complete
 */
export const initializeGpuStats = (client, serverStat, gpuUuidMap) =>
  new Promise((resolve, reject) => {
    serverStat.gpus ??= {};

    const handleData = (row) => {
      const [index, name, uuid, memoryTotal] = Object.values(row);
      if (!uuid) return reject(new Error("GPU UUID missing"));

      const gpuStat = {
        name: normalizeGpuName(name),
        memoryTotal: Number(memoryTotal),
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

/**
 * Starts continuous GPU monitoring via nvidia-smi.
 *
 * ⚠️ This Promise intentionally never resolves. `nvidia-smi -l 1` runs indefinitely,
 * so the returned Promise only rejects (on stream error or unexpected stream end).
 * Callers should treat rejection as the signal to reconnect.
 *
 * @param {object} client - Connected SSH2 client
 * @param {object} gpuUuidMap - UUID-to-gpuStat map populated by initializeGpuStats
 * @param {object} serverStat - Server stat object with populated `.gpus`
 * @param {number} intervalMs - Interval (ms) for process data TTL cleanup
 * @returns {Promise<never>} Never resolves; rejects on stream error
 */
export const monitorGpuStats = (client, gpuUuidMap, serverStat, intervalMs) =>
  new Promise((_resolve, reject) => {
    const handleGpuData = (row) => {
      const [_timestamp, uuid, temperature, utilization, memoryUsed] = Object.values(row);
      const gpuStat = gpuUuidMap[uuid];
      if (!gpuStat) return;
      gpuStat.temperature = Number(temperature);
      gpuStat.memoryUsed = Number(memoryUsed);
      gpuStat.updatedAt = new Date();
      gpuStat.utilization = Number(utilization);
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
      const [_timestamp, uuid, pid, user, memoryUsed] = Object.values(row);
      const gpuStat = gpuUuidMap[uuid];
      if (!gpuStat) return;
      gpuStat.processes[pid] = { pid, user, memoryUsed, updatedAt: new Date() };
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
      const now = new Date();
      const TTL = intervalMs * 1.5;
      for (const gpu of Object.values(serverStat.gpus ?? {})) {
        for (const pid in gpu.processes) {
          if (now - gpu.processes[pid].updatedAt > TTL || !gpu.processes[pid].user) {
            delete gpu.processes[pid];
          }
        }
      }
    };
    setInterval(disposeProcessData, intervalMs);
  });
