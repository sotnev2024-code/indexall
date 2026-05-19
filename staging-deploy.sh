#!/bin/bash
# ── Staging deploy script ─────────────────────────────────────────────────────
# Run from /opt/indexall-staging/
# Usage: ./staging-deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "==> [staging] Pulling latest changes from 'staging' branch..."
git pull origin staging

echo "==> [staging] Rebuilding and restarting containers..."
cd docker
docker compose -f docker-compose.staging.yml down
docker compose -f docker-compose.staging.yml up -d --build

echo ""
echo "==> [staging] Done! Containers status:"
docker compose -f docker-compose.staging.yml ps

echo ""
echo "==> [staging] Frontend logs (last 20 lines):"
docker logs indexall-frontend-staging --tail 20 2>&1 || true
