import { connectWebSocket } from "./websocket.js";
import { renderServers } from "./render.js";

const servers = document.querySelector("#servers");
connectWebSocket(`ws://${window.location.host}/ws`, (stats) => renderServers(servers, stats));
