/**
 * Renders server GPU stats into the given container element.
 * @param {HTMLElement} container - Target DOM element
 * @param {object} serverStats - Server stats keyed by host
 */
export function renderServers(container, serverStats) {
  container.innerHTML = Object.values(serverStats)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((server) => renderServer(server))
    .join("");
}

function renderServer(server) {
  const gpuRows = Object.entries(server.gpus ?? {})
    .map(([index, gpu]) => renderGpuRow(index, gpu))
    .join("");

  return `
<article>
  <h2 class="text-sm font-bold text-white has-tooltip">${server.name}<span class="tooltip">${server.host}</span></h2>
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
    ${gpuRows}
  </tbody>
  </table>
</article>`;
}

function renderGpuRow(index, gpu) {
  const colorClass = gpu.memoryUsed >= 0 && gpu.memoryUsed < 10 ? "text-neutral-300" : "";

  const userTooltip = Object.values(gpu.processes ?? {})
    .map((proc) => `${proc.user}(${proc.memoryUsed})`)
    .join(" ");

  const memoryCell = `<span class="has-tooltip">${gpu.memoryUsed}<span class="tooltip">${userTooltip}</span></span> / ${gpu.memoryTotal} MB`;

  return `
<tr class="${colorClass}">
<td class="p-1 text-center text-neutral-300">${index}</td>
<td class="p-1 text-center">${gpu.name}</td>
<td class="p-1 text-right">${gpu.utilization} %</td>
<td class="p-1 text-right">${memoryCell}</td>
</tr>`;
}
