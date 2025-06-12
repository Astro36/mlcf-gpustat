import { init } from "echarts";

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
<tr class="cursor-pointer hover:bg-neutral-800 __GPU_COLOR__" onclick="showGpuHistory(this)" data-host="__SERVER_HOST__" data-gpu="__GPU_INDEX__" data-gpu-memory="__GPU_MEMORY_TOTAL__">
<td class="p-1 text-center text-neutral-300">__GPU_INDEX__</td>
<td class="p-1 text-center">__GPU_NAME__</td>
<td class="p-1 text-right">__GPU_UTILIZATION__ %</td>
<td class="p-1 text-right">__GPU_MEMORY__</td>
</tr>`;
const gpuStatMemoryTemplate = `<span class="has-tooltip">__GPU_MEMORY_USED__<span class="tooltip">__GPU_MEMORY_USED_USERS__</span></span> / __GPU_MEMORY_TOTAL__ MB`;

const run = () => {
  const socket = new WebSocket(`ws://${window.location.host}/ws`);
  socket.addEventListener("message", (event) => {
    const serverStats = JSON.parse(event.data);
    // console.log(serverStats);
    const servers = document.querySelector("#servers");
    servers.innerHTML = Object.values(serverStats)
      .map((serverStat) => {
        let serverStatHtml = serverStatTemplate;
        serverStatHtml = serverStatHtml.replace("__SERVER_NAME__", serverStat.name);
        serverStatHtml = serverStatHtml.replace("__SERVER_HOST__", serverStat.host);
        const gpuStatsHTML = Object.entries(serverStat.gpus ?? [])
          .map(([gpuIndex, gpuStat]) => {
            let gpuStatHtml = gpuStatTemplate;
            gpuStatHtml = gpuStatHtml.replace("__SERVER_HOST__", serverStat.host);
            gpuStatHtml = gpuStatHtml.replaceAll("__GPU_INDEX__", gpuIndex);
            gpuStatHtml = gpuStatHtml.replace("__GPU_NAME__", gpuStat.name);

            gpuStatHtml = gpuStatHtml.replace("__GPU_UTILIZATION__", gpuStat.utilization);

            gpuStatHtml = gpuStatHtml
              .replace("__GPU_MEMORY__", gpuStatMemoryTemplate)
              .replace("__GPU_MEMORY_USED__", gpuStat.memoryUsed)
              .replaceAll("__GPU_MEMORY_TOTAL__", gpuStat.memoryTotal)
              .replace(
                "__GPU_MEMORY_USED_USERS__",
                Object.values(gpuStat.processes)
                  .map((proc) => `${proc.user}(${proc.memoryUsed})`)
                  .join(" "),
              );
            if (gpuStat.memoryUsed >= 0 && gpuStat.memoryUsed < 10) {
              gpuStatHtml = gpuStatHtml.replace("__GPU_COLOR__", "text-neutral-300");
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

const showGpuHistory = (element) => {
  const host = element.getAttribute("data-host");
  const gpuIndex = element.getAttribute("data-gpu");
  const gpuTotalMemory = element.getAttribute("data-gpu-memory");

  const overlayHTML = `
    <div class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" id="gpu-history-overlay">
      <div class="bg-neutral-900 p-4 rounded-md max-w-4xl w-full max-h-[90vh] overflow-auto">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-white text-lg font-bold">GPU ${gpuIndex} History - ${host}</h2>
          <button class="text-neutral-400 hover:text-white" id="close-modal">X</button>
        </div>
        <div class="mb-6" id="utilization-chart" style="height: 300px;"></div>
        <div class="mb-4" id="memory-chart" style="height: 300px;"></div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", overlayHTML);
  const overlay = document.getElementById("gpu-history-overlay");
  document.getElementById("close-modal").onclick = () => document.body.removeChild(overlay);

  const utilizationChart = init(document.getElementById("utilization-chart"));
  const memoryChart = init(document.getElementById("memory-chart"));
  fetch(`/api/gpu-history?host=${encodeURIComponent(host)}&gpu=${gpuIndex}`)
    .then((response) => response.json())
    .then(({ history }) => {
      utilizationChart.setOption({
        title: {
          text: "GPU Utilization (%)",
          textStyle: { color: "#e5e5e5", fontSize: 16 },
        },
        tooltip: {
          trigger: "axis",
          formatter: ([obj]) => `<b>${obj.data[1]} %`,
        },
        dataZoom: [
          {
            type: "slider",
            show: true,
            xAxisIndex: [0],
            start: 0,
            end: 100,
          },
        ],
        xAxis: {
          type: "time",
          axisLabel: { formatter: (value) => new Date(value).toLocaleTimeString(), color: "#a3a3a3" },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: 100,
          axisLabel: { formatter: (value) => `${value} %`, color: "#a3a3a3" },
        },
        grid: {
          left: "3%",
          right: "4%",
          bottom: "20%",
          containLabel: true,
        },
        series: [
          {
            data: history.map((item) => [item.timestamp, item.utilization]),
            type: "line",
            smooth: true,
            color: "#10b981",
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  {
                    offset: 0,
                    color: "rgba(16, 185, 129, 0.7)",
                  },
                  {
                    offset: 1,
                    color: "rgba(16, 185, 129, 0.1)",
                  },
                ],
              },
            },
          },
        ],
      });
      memoryChart.setOption({
        title: {
          text: "Memory Usage (MB)",
          textStyle: { color: "#e5e5e5", fontSize: 16 },
        },
        tooltip: {
          trigger: "axis",
          formatter: ([obj]) =>
            `<b>${obj.data[1]} MB</b><br>${history[obj.dataIndex].users.map((user) => `${user.name}(${user.memoryUsed})`).join("<br>")}`,
        },
        dataZoom: [
          {
            type: "slider",
            show: true,
            xAxisIndex: [0],
            start: 0,
            end: 100,
          },
        ],
        xAxis: {
          type: "time",
          axisLabel: { formatter: (value) => new Date(value).toLocaleTimeString(), color: "#a3a3a3" },
        },
        yAxis: {
          type: "value",
          min: 0,
          max: gpuTotalMemory,
          axisLabel: {
            formatter: (value) => `${value} MB`,
            color: "#a3a3a3",
          },
        },
        grid: {
          left: "3%",
          right: "4%",
          bottom: "20%",
          containLabel: true,
        },
        series: [
          {
            data: history.map((item) => [item.timestamp, item.memoryUsed]),
            type: "line",
            smooth: true,
            color: "#3b82f6",
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  {
                    offset: 0,
                    color: "rgba(59, 130, 246, 0.7)",
                  },
                  {
                    offset: 1,
                    color: "rgba(59, 130, 246, 0.1)",
                  },
                ],
              },
            },
          },
        ],
      });
    })
    .catch((error) => {
      console.error("Error fetching GPU history:", error);
    });

  const handleResize = () => {
    utilizationChart.resize();
    memoryChart.resize();
  };
  window.addEventListener("resize", handleResize);
  overlay.addEventListener("remove", () => {
    window.removeEventListener("resize", handleResize);
  });
};
window.showGpuHistory = showGpuHistory;
