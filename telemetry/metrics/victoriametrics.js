/**
 * Pushes GPU metrics to VictoriaMetrics in Prometheus text format.
 * @param {string} vmUrl - VictoriaMetrics base URL
 * @param {object} serverStats - Server stats keyed by host
 */
export const pushToVictoriaMetrics = async (vmUrl, serverStats) => {
  const lines = [];

  for (const host in serverStats) {
    const server = serverStats[host];
    for (const index in server.gpus ?? {}) {
      const gpu = server.gpus[index];
      if (gpu.utilization === undefined || gpu.memoryUsed === undefined) continue;

      const labels = [
        `server_name="${server.name}"`,
        `server_host="${host}"`,
        `gpu_index="${index}"`,
        `gpu_name="${gpu.name}"`,
      ].join(",");

      lines.push(`gpu_utilization{${labels}} ${gpu.utilization}`);
      lines.push(`gpu_memory_used{${labels}} ${gpu.memoryUsed}`);
      lines.push(`gpu_memory_total{${labels}} ${gpu.memoryTotal}`);
      if (gpu.temperature !== undefined) {
        lines.push(`gpu_temperature{${labels}} ${gpu.temperature}`);
      }

      // Aggregate memory per user (sum across multiple PIDs from the same user)
      const userMemory = {};
      for (const proc of Object.values(gpu.processes ?? {})) {
        if (!proc.user) continue;
        userMemory[proc.user] = (userMemory[proc.user] ?? 0) + Number(proc.memoryUsed);
      }
      for (const [user, mem] of Object.entries(userMemory)) {
        lines.push(`gpu_process_memory_used{${labels},user="${user}"} ${mem}`);
      }
    }
  }

  if (lines.length === 0) return;

  try {
    const res = await fetch(`${vmUrl}/api/v1/import/prometheus`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: lines.join("\n"),
    });
    if (!res.ok) {
      console.error(`VictoriaMetrics push failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error("VictoriaMetrics push error:", err.message);
  }
};
