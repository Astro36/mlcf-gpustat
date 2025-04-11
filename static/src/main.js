const serverStatTemplate = `
<article>
    <h2 class="text-sm font-bold text-white has-tooltip">__SERVER_NAME__<span class="tooltip">__SERVER_HOST__</span></h2>
    <table class="mt-1 w-full border border-neutral-800 text-xs">
    <thead class="bg-neutral-800 text-neutral-200">
        <tr>
        <th class="p-1">#</th>
        <th class="p-1">GPU</th>
        <th class="p-1">Usage</th>
        <th class="p-1">Memory</th>
        </tr>
    </thead>
    <tbody class="text-neutral-500">
        __GPU_STATS__
    </tbody>
    </table>
</article>`;
const gpuStatTemplate = `
<tr class="__GPU_COLOR__">
<td class="p-1 text-center text-neutral-300">__GPU_INDEX__</td>
<td class="p-1 text-center">__GPU_NAME__</td>
<td class="p-1 text-right">__GPU_UTILIZATION__ %</td>
<td class="p-1 text-right">__GPU_MEMORY__</td>
</tr>`;
const gpuStatMemoryTemplate = `<span class="has-tooltip">__GPU_MEMORY_USED__<span class="tooltip">__GPU_MEMORY_USED_USERS__</span></span> / __GPU_MEMORY_TOTAL__ MB`;

const PORT = 4000;

const run = () => {
  const socket = new WebSocket(`ws://${window.location.hostname}:${PORT}`);
  socket.addEventListener("message", (event) => {
    const serverStats = JSON.parse(event.data);
    // console.log("Message from server ", serverStats);
    const servers = document.querySelector("#servers");
    servers.innerHTML = Object.entries(serverStats)
      .map(([serverHost, serverStat]) => {
        let serverStatHtml = serverStatTemplate;
        serverStatHtml = serverStatHtml.replace(
          "__SERVER_NAME__",
          serverStat.name,
        );
        serverStatHtml = serverStatHtml.replace(
          "__SERVER_HOST__",
          serverStat.host,
        );
        const gpuStatsHTML = Object.entries(serverStat.gpus)
          .map(([gpuIndex, gpuStat]) => {
            let gpuStatHtml = gpuStatTemplate;
            gpuStatHtml = gpuStatHtml.replace("__GPU_INDEX__", gpuIndex);
            gpuStatHtml = gpuStatHtml.replace("__GPU_NAME__", gpuStat.name);

            gpuStatHtml = gpuStatHtml.replace(
              "__GPU_UTILIZATION__",
              gpuStat.utilization,
            );

            if (gpuStat.memory_used >= 0 && gpuStat.memory_used < 10) {
              gpuStatHtml = gpuStatHtml
                .replace("__GPU_MEMORY__", `0 / ${gpuStat.memory_total} MB`)
                .replace("__GPU_COLOR__", "text-neutral-300");
            } else {
              gpuStatHtml = gpuStatHtml
                .replace("__GPU_MEMORY__", gpuStatMemoryTemplate)
                .replace("__GPU_MEMORY_USED__", gpuStat.memory_used)
                .replace("__GPU_MEMORY_TOTAL__", gpuStat.memory_total)
                .replace(
                  "__GPU_MEMORY_USED_USERS__",
                  Object.values(gpuStat.processes)
                    .map((proc) => `${proc.user}(${proc.memory_used})`)
                    .join(" "),
                );
            }
            return gpuStatHtml;
          })
          .join("");
        serverStatHtml = serverStatHtml.replace("__GPU_STATS__", gpuStatsHTML);
        return serverStatHtml;
      })
      .join("");
  });
  socket.addEventListener("close", () => {
    setTimeout(run, 1000);
  });
};
run();
