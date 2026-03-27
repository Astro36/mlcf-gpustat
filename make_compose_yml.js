#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const servers_config = require("./servers.config.json");

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const SERVER_CONFIG_PATH = path.join(ROOT, "servers.config.json");
const TEMPLATE_PATH = path.join(ROOT, "compose.yml.tmpl");
const OUTPUT_PATH = path.join(ROOT, "compose.yml");

function readFileOrThrow(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} 파일이 없습니다: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function loadEnv(filePath) {
  const env = {};

  if (!fs.existsSync(filePath)) {
    return env;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function sanitizeServiceName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-");
}

function renderTelemetryServices(servers) {
  return servers
    .map((server) => {
      const serviceName = `telemetry-${sanitizeServiceName(server.name)}`;
      return `  ${serviceName}:
    image: gpustat-telemetry:latest
    env_file:
      - .env
    environment:
      - VICTORIAMETRICS_URL=http://victoriametrics:8428
      - SERVER_NAME=${server.name}
      - SERVER_HOST=${server.host}
      - SERVER_USERNAME=${server.username}
      - SERVER_PASSWORD=${server.password}
    depends_on:
      victoriametrics:
        condition: service_healthy
    restart: unless-stopped`;
    })
    .join("\n\n");
}

function renderTemplate(template, variables) {
  return template.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (match, key) => {
    if (!(key in variables)) {
      throw new Error(`템플릿 변수 ${key} 값이 없습니다.`);
    }
    return String(variables[key]);
  });
}

function main() {
  try {
    const env = loadEnv(ENV_PATH);
    const config = servers_config;
    const template = readFileOrThrow(TEMPLATE_PATH, "compose.yml.tmpl");

    const telemetryServices = renderTelemetryServices(config);

    const variables = {
      ...env,
      TELEMETRY_SERVICES: telemetryServices
    };

    const output = renderTemplate(template, variables);
    fs.writeFileSync(OUTPUT_PATH, output, "utf8");

    console.log(`생성 완료: ${OUTPUT_PATH}`);
    console.log(`telemetry 서비스 수: ${config.length}`);
    console.log(
      config
        .map((s) => `telemetry-${sanitizeServiceName(s.name)}`)
        .join("\n")
    );
  } catch (error) {
    console.error(`오류: ${error.message}`);
    process.exit(1);
  }
}

main();