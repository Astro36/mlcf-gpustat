import { connectWebSocket } from "./websocket.js";
import { renderServers } from "./render.js";

const servers = document.querySelector("#servers");
const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const wsUrl = `${wsProtocol}//${location.host}${location.pathname.replace(/[^/]*$/, "")}ws`;
connectWebSocket(wsUrl, (stats) => renderServers(servers, stats));
