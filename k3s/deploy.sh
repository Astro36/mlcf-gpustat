#!/usr/bin/env bash

# Usage:
#   bash k3s/deploy.sh          # render configs + apply manifests
#   bash k3s/deploy.sh --build  # build + import images into k3s first, then deploy

set -euo pipefail

K3S_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$K3S_DIR/.." && pwd)"
NS="gpustat"
KUBECTL="${KUBECTL:-kubectl}"

cd "$ROOT"

$KUBECTL version --client >/dev/null 2>&1 || {
  echo "[ERR] kubectl is not usable. Set it via the KUBECTL env var (e.g. KUBECTL='k3s kubectl')."
  exit 1
}
command -v node >/dev/null 2>&1 || { echo "[ERR] node not found."; exit 1; }
[ -f "$ROOT/.env" ] || { echo "[ERR] .env file is missing. Create one from .env.example."; exit 1; }
[ -f "$ROOT/servers.config.json" ] || { echo "[ERR] servers.config.json file is missing."; exit 1; }

if [ "${1:-}" = "--build" ]; then
  bash "$K3S_DIR/build-images.sh"
fi

apply_configmap() {
  local name="$1"; shift
  $KUBECTL -n "$NS" create configmap "$name" "$@" --dry-run=client -o yaml | $KUBECTL apply -f -
}

echo "=> Namespace"
$KUBECTL apply -f "$K3S_DIR/namespace.yaml"

echo "=> Creating Secret from .env"
$KUBECTL -n "$NS" create secret generic gpustat-secrets --from-env-file="$ROOT/.env"  --dry-run=client -o yaml | $KUBECTL apply -f -

echo "=> Creating Grafana ConfigMaps"
apply_configmap grafana-datasources --from-file=victoriametrics.yml="$ROOT/grafana/provisioning/datasources/victoriametrics.yml"
apply_configmap grafana-dashboard-provider --from-file=dashboards.yml="$ROOT/grafana/provisioning/dashboards/dashboards.yml"
apply_configmap grafana-dashboard-gpustat --from-file=gpustat.json="$ROOT/grafana/dashboards/gpustat.json"

echo "=> Generating gpustat-telemetry manifests"
node "$K3S_DIR/make_gpustat_telemetry_manifests.js"

echo "=> Applying manifests"
$KUBECTL apply -f "$K3S_DIR/victoriametrics.yaml"
$KUBECTL apply -f "$K3S_DIR/gpustat-telemetry.yaml"
$KUBECTL apply -f "$K3S_DIR/gpustat-web.yaml"
$KUBECTL apply -f "$K3S_DIR/ingress.yaml"
$KUBECTL apply -f "$K3S_DIR/grafana.yaml"

echo "[OK] Deployment complete."
