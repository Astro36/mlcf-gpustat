#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEMPLATE_PATH = path.join(__dirname, "compose.yml.tmpl");
const OUTPUT_PATH = path.join(__dirname, "compose.yml");
const VM_DATA_PATH = { win32: "C:/docker-data/victoriametrics" }[process.platform] ?? "/srv/gpustat/victoriametrics";

const servers = require(path.join(ROOT, "servers.config.json"));

const loadEnvFile = (file) => {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([^#=\s][^=]*)=(.*)$/);
    if (m) {
      env[m[1].trim()] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return env;
};

const formatServiceName = (name) =>
  String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-");

const composeFileVars = {
  ...loadEnvFile(path.join(ROOT, ".env")),
  TELEMETRY_SERVICES: servers
    .map(
      (server) => `  telemetry-${formatServiceName(server.name)}:
    image: gpustat-telemetry:latest
    env_file:
      - ../.env
    environment:
      - VICTORIAMETRICS_URL=http://victoriametrics:8428
      - SERVER_NAME=${server.name}
      - SERVER_HOST=${server.host}
      - SERVER_USERNAME=${server.username}
      - SERVER_PASSWORD=${server.password}
    depends_on:
      victoriametrics:
        condition: service_healthy
    restart: unless-stopped`,
    )
    .join("\n\n"),
  VM_DATA_PATH,
};
const composeFile = fs.readFileSync(TEMPLATE_PATH, "utf8").replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_, key) => {
  if (!(key in composeFileVars)) {
    throw new Error(`Missing template variable: ${key}`);
  }
  return String(composeFileVars[key]);
});
fs.writeFileSync(OUTPUT_PATH, composeFile, "utf8");

console.log(`Generated ${OUTPUT_PATH} (${servers.length} telemetry services, VictoriaMetrics data: ${VM_DATA_PATH})`);
