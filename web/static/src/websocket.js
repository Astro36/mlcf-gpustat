/**
 * Connects to a WebSocket server and handles automatic reconnection.
 * On close, retries after 1 second.
 * @param {string} url - WebSocket URL
 * @param {function} onMessage - Called with parsed JSON data on each message
 */
export function connectWebSocket(url, onMessage) {
  const socket = new WebSocket(url);
  socket.addEventListener("message", (event) => onMessage(JSON.parse(event.data)));
  socket.addEventListener("close", () => setTimeout(() => connectWebSocket(url, onMessage), 1000));
}
