#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  INDEXALL STAGING SETUP — test.indexall.nkubot.ru
#  Run as root on the production server:
#    bash /opt/indexall/staging-setup.sh
# ═══════════════════════════════════════════════════════════════
set -e

STAGING_DIR="/opt/indexall-staging"
PROD_DIR="/opt/indexall"
STAGING_DOMAIN="test.indexall.nkubot.ru"
REPO="https://github.com/sotnev2024-code/indexall.git"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   INDEXALL STAGING SETUP                     ║"
echo "║   Domain: $STAGING_DOMAIN  ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Clone or update staging repo ──────────────────────────
echo "── Step 1: Clone/update staging repo ──"
if [ -d "$STAGING_DIR/.git" ]; then
  echo "   Already cloned. Pulling latest..."
  cd "$STAGING_DIR"
  git fetch origin
  git checkout staging 2>/dev/null || git checkout -b staging origin/main
  git pull origin staging 2>/dev/null || git pull origin main
else
  echo "   Cloning repo..."
  git clone "$REPO" "$STAGING_DIR"
  cd "$STAGING_DIR"
  git checkout -b staging origin/main 2>/dev/null || git checkout staging
fi

# ── 2. Create staging branch on GitHub if needed ─────────────
echo "── Step 2: Ensure staging branch exists on remote ──"
cd "$STAGING_DIR"
git push origin staging 2>/dev/null || echo "   (branch already exists or push failed — continuing)"

# ── 3. Copy .env files from production ───────────────────────
echo "── Step 3: Copy .env files from production ──"

# Backend .env.staging
if [ ! -f "$STAGING_DIR/backend/.env.staging" ]; then
  echo "   Creating backend/.env.staging from production..."
  cp "$PROD_DIR/backend/.env.production" "$STAGING_DIR/backend/.env.staging"
fi

# Patch staging-specific values
sed -i "s|^PORT=.*|PORT=4001|" "$STAGING_DIR/backend/.env.staging"
sed -i "s|^DATABASE_PORT=.*|DATABASE_PORT=5433|" "$STAGING_DIR/backend/.env.staging"
sed -i "s|^DATABASE_NAME=.*|DATABASE_NAME=indexall_staging|" "$STAGING_DIR/backend/.env.staging"
sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://$STAGING_DOMAIN|" "$STAGING_DIR/backend/.env.staging"
# Make sure DB_PASSWORD line exists and is correct
grep -q "^DB_PASSWORD=" "$STAGING_DIR/backend/.env.staging" || echo "DB_PASSWORD=postgres" >> "$STAGING_DIR/backend/.env.staging"

echo "   backend/.env.staging: OK"

# Frontend .env.staging
cat > "$STAGING_DIR/frontend/.env.staging" <<EOF
NEXT_PUBLIC_API_URL=https://$STAGING_DOMAIN/api
EOF
echo "   frontend/.env.staging: OK"

# ── 4. Copy docker-compose.staging.yml ───────────────────────
echo "── Step 4: Check docker-compose.staging.yml ──"
cp "$STAGING_DIR/docker/docker-compose.staging.yml" "$STAGING_DIR/docker/docker-compose.staging.yml" 2>/dev/null || true
echo "   OK"

# ── 5. Get SSL certificate for staging domain ─────────────────
echo "── Step 5: SSL certificate for $STAGING_DOMAIN ──"

# Check if cert already exists
if [ -d "/etc/letsencrypt/live/$STAGING_DOMAIN" ]; then
  echo "   Certificate already exists — skipping"
else
  echo "   Requesting certificate via Certbot..."
  docker run --rm \
    -v indexall_certbot-certs:/etc/letsencrypt \
    -v indexall_certbot-webroot:/var/www/certbot \
    certbot/certbot certonly --webroot \
    -w /var/www/certbot \
    -d "$STAGING_DOMAIN" \
    --non-interactive --agree-tos \
    --email "sotnev2024@gmail.com" \
    --no-eff-email \
    || echo "   ⚠ Certbot failed — check DNS. You can run it manually later."
fi

# ── 6. Update nginx.conf with staging block ───────────────────
echo "── Step 6: Update nginx.conf ──"
NGINX_CONF="$PROD_DIR/docker/nginx/nginx.conf"

if grep -q "$STAGING_DOMAIN" "$NGINX_CONF"; then
  echo "   Staging block already in nginx.conf"
else
  echo "   Adding staging block to nginx.conf..."
  # Pull the latest nginx.conf from repo (which already has the staging block)
  cp "$STAGING_DIR/docker/nginx/nginx.conf" "$NGINX_CONF"
  echo "   Copied updated nginx.conf from staging repo"
fi

# Reload nginx
echo "   Reloading nginx..."
docker exec indexall-nginx nginx -s reload || echo "   ⚠ Nginx reload failed"

# ── 7. Build and start staging containers ─────────────────────
echo "── Step 7: Build and start staging containers ──"
cd "$STAGING_DIR/docker"
docker compose -f docker-compose.staging.yml down 2>/dev/null || true
docker compose -f docker-compose.staging.yml up -d --build

# ── 8. Status ─────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════"
echo "  STAGING SETUP COMPLETE"
echo "══════════════════════════════════════════════"
echo ""
echo "  URL:      https://$STAGING_DOMAIN"
echo "  Frontend: port 3001"
echo "  Backend:  port 4001"
echo "  Database: indexall_staging (port 5433)"
echo ""
echo "  Containers:"
docker compose -f docker-compose.staging.yml ps
echo ""
echo "  To deploy updates:"
echo "    cd $STAGING_DIR && git pull origin staging"
echo "    cd docker && docker compose -f docker-compose.staging.yml up -d --build"
echo ""
