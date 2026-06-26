#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEMPLATE_PATH = path.join(__dirname, "gpustat-telemetry.yaml.tmpl");
const OUTPUT_PATH = path.join(__dirname, "gpustat-telemetry.yaml");

const servers = require(path.join(ROOT, "servers.config.json"));
if (!Array.isArray(servers) || servers.length === 0) {
  throw new Error("No servers found in servers.config.json");
}

const sanitizeServiceName = (name) =>
  String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-");

const serviceNames = servers.map((server) => `gpustat-telemetry-${sanitizeServiceName(server.name)}`);

const manifestVars = {
  TELEMETRY_SECRET_DATA: servers
    .map((server, i) => `  ${serviceNames[i]}: ${server.password}`)
    .join("\n"),
  TELEMETRY_DEPLOYMENTS: servers
    .map(
      (server, i) => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${serviceNames[i]}
  namespace: gpustat
  labels:
    app.kubernetes.io/name: gpustat
    app.kubernetes.io/instance: ${serviceNames[i]}
    app.kubernetes.io/component: collector
    app.kubernetes.io/part-of: gpustat
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: gpustat
      app.kubernetes.io/instance: ${serviceNames[i]}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: gpustat
        app.kubernetes.io/instance: ${serviceNames[i]}
        app.kubernetes.io/component: collector
        app.kubernetes.io/part-of: gpustat
    spec:
      containers:
        - name: telemetry
          image: gpustat-telemetry:latest
          imagePullPolicy: Never
          env:
            - name: VICTORIAMETRICS_URL
              value: http://victoriametrics:8428
            - name: SERVER_NAME
              value: "${server.name}"
            - name: SERVER_HOST
              value: "${server.host}"
            - name: SERVER_USERNAME
              value: "${server.username}"
            - name: SERVER_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: gpustat-telemetry-ssh-creds
                  key: ${serviceNames[i]}
          ports:
            - containerPort: 9090
          livenessProbe:
            httpGet:
              path: /health
              port: 9090
            initialDelaySeconds: 30
            periodSeconds: 30
            failureThreshold: 3`,
    )
    .join("\n---\n"),
};

const manifest = fs.readFileSync(TEMPLATE_PATH, "utf8").replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (_, key) => {
  if (!(key in manifestVars)) {
    throw new Error(`Missing template variable: ${key}`);
  }
  return String(manifestVars[key]);
});
fs.writeFileSync(OUTPUT_PATH, manifest.endsWith("\n") ? manifest : manifest + "\n", "utf8");

console.log(`Generated ${OUTPUT_PATH} (${servers.length} gpustat-telemetry deployments)`);
console.log(serviceNames.join("\n"));
