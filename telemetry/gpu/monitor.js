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
 * ⚠️ This Promise intentionally never resolves. The nvidia-smi monitors run
 * indefinitely, so the returned Promise only rejects (on stream error/close).
 * Callers should treat rejection as the signal to reconnect.
 *
 * @param {object} client - Connected SSH2 client
 * @param {object} gpuUuidMap - UUID-to-gpuStat map populated by initializeGpuStats
 * @param {object} serverStat - Server stat object with populated `.gpus`
 * @param {number} ttlMS - Time in ms to keep process info after last update before considering it stale and removing it
 * @returns {Promise<never>} Never resolves; rejects on stream error
 */
export const monitorGpuStats = (client, gpuUuidMap, serverStat, ttlMS) =>
  new Promise((_resolve, reject) => {
    let settled = false;
    let gpuStream;
    let procStream;
    let disposeTimer;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearInterval(disposeTimer);
      gpuStream?.close();
      procStream?.close();
      reject(err);
    };

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
      "nvidia-smi --query-gpu=timestamp,uuid,temperature.gpu,utilization.gpu,memory.used --format=csv,noheader,nounits -l 1 2>/dev/null",
      { pty: true },
      (err, stream) => {
        if (err) return fail(err);
        gpuStream = stream;
        stream
          .on("error", fail)
          .on("close", () => fail(new Error("GPU stat stream closed")))
          .pipe(csv({ headers: false, mapValues: ({ value }) => value.trim() }))
          .on("data", handleGpuData)
          .on("error", fail)
          .on("end", () => fail(new Error("GPU stat stream ended")));
      },
    );

    const handleProcessData = (row) => {
      const [_timestamp, uuid, pid, user, memoryUsed] = Object.values(row);
      const gpuStat = gpuUuidMap[uuid];
      if (!gpuStat) return;
      gpuStat.processes[pid] = { pid, user, memoryUsed, updatedAt: new Date() };
    };

    client.exec(
      `while true; do timeout 5s nvidia-smi --query-compute-apps=timestamp,gpu_uuid,pid,used_memory --format=csv,noheader,nounits 2>/dev/null | while IFS=',' read -r ts uuid pid mem; do user=$(ps -o user= -p $pid 2>/dev/null); echo "$ts,$uuid,$pid,$user,$mem"; done || break; sleep 1; done`,
      { pty: true },
      (err, stream) => {
        if (err) return fail(err);
        procStream = stream;
        stream
          .on("error", fail)
          .on("close", () => fail(new Error("compute-apps stream closed")))
          .pipe(csv({ headers: false, mapValues: ({ value }) => value.trim() }))
          .on("data", handleProcessData)
          .on("error", fail)
          .on("end", () => fail(new Error("compute-apps stream ended")));
      },
    );

    const disposeProcessData = () => {
      const now = new Date();
      for (const gpu of Object.values(serverStat.gpus ?? {})) {
        for (const pid in gpu.processes) {
          if (now - gpu.processes[pid].updatedAt > ttlMS || !gpu.processes[pid].user) {
            delete gpu.processes[pid];
          }
        }
      }
    };
    disposeTimer = setInterval(disposeProcessData, Math.max(1000, ttlMS / 2));
  });
