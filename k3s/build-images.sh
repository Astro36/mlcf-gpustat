#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CTR="${CTR:-sudo k3s ctr}"

for app in telemetry web; do
  img="gpustat-$app:latest"
  echo "=> Building image $img"
  docker build -t "$img" "$ROOT/$app"
  echo "=> Importing $img into k3s containerd"
  docker save "$img" | $CTR images import -
done

echo "[OK] Build/import complete"
