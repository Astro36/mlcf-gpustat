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
  <section class="flex items-baseline justify-between">
    <h2 class="text-sm font-bold text-white has-tooltip">${server.name}<span class="tooltip">${server.host}</span></h2>
    ${renderLastUsed(server)}
  </section>
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

function getActiveUser(server) {
  for (const gpu of Object.values(server.gpus ?? {})) {
    const procs = Object.values(gpu.processes ?? {});
    if (procs.length > 0) return procs[0].user;
  }
  return null;
}

function formatElapsedTime(ageSeconds) {
  const totalMinutes = Math.max(0, Math.floor(ageSeconds / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes / 60);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h`;
  return `${totalMinutes}m`;
}

function renderLastUsed(server) {
  if (getActiveUser(server)) return "";
  const DAY_SECONDS = 24 * 3600;
  const lastUsed = server.lastUsed;
  if (lastUsed?.user) {
    const ageSeconds = Date.now() / 1000 - lastUsed.timestamp;
    return `<span class="text-[10px] text-neutral-400">${ageSeconds > 24 * 3600 ? "🟢" : "🟡"} Last used by ${lastUsed.user} ${formatElapsedTime(ageSeconds)} ago</span>`;
  }
  return "";
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
