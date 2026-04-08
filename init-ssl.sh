#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# init-ssl.sh — First-time SSL setup with Let's Encrypt
#
# Usage:
#   chmod +x init-ssl.sh
#   ./init-ssl.sh yourdomain.com your@email.com
# ═══════════════════════════════════════════════════════════════

set -e

DOMAIN="$1"
EMAIL="$2"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Usage: ./init-ssl.sh <domain> <email>"
  echo "Example: ./init-ssl.sh 7150079-fv25894.twc1.net admin@example.com"
  exit 1
fi

echo "=== Setting up SSL for $DOMAIN ==="

# 1. Replace DOMAIN placeholder in nginx config
sed -i "s|DOMAIN|$DOMAIN|g" nginx/conf.d/default.conf
echo "[OK] nginx config updated with domain: $DOMAIN"

# 2. Create a temporary nginx config (HTTP only) for certbot challenge
cat > nginx/conf.d/temp-http.conf << 'HTTPCONF'
server {
    listen 80;
    server_name _;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 'waiting for SSL...'; add_header Content-Type text/plain; }
}
HTTPCONF

# Temporarily hide the SSL config
mv nginx/conf.d/default.conf nginx/conf.d/default.conf.bak

# 3. Start nginx (HTTP only) + certbot volumes
echo "[...] Starting nginx in HTTP mode..."
docker compose up -d nginx

# Wait for nginx to be ready
sleep 3

# 4. Request certificate
echo "[...] Requesting Let's Encrypt certificate for $DOMAIN..."
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# 5. Restore SSL config
mv nginx/conf.d/default.conf.bak nginx/conf.d/default.conf
rm -f nginx/conf.d/temp-http.conf

# 6. Restart everything with SSL
echo "[...] Restarting all services with SSL..."
docker compose down
docker compose up -d

echo ""
echo "=== DONE ==="
echo "Your site is now available at https://$DOMAIN"
echo ""
echo "Don't forget to update .env:"
echo "  FRONTEND_URL=https://$DOMAIN"
echo "  NEXT_PUBLIC_API_URL=https://$DOMAIN/api"
echo ""
echo "SSL auto-renew is handled by the certbot container."
