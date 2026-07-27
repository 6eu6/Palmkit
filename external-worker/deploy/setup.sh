#!/bin/bash
# Palmkit External Worker — Full Setup
# Oracle Linux 9 ARM64 (A1.Flex)
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/6eu6/Palmkit/main/external-worker/deploy/setup.sh)
set -e

REPO_BRANCH="main"
INSTALL_DIR="/opt/palmkit-worker"
SERVICE_NAME="palmkit-worker"
WORKER_PORT=8787

echo "╔══════════════════════════════════════════╗"
echo "║   Palmkit External Worker — Setup        ║"
echo "╚══════════════════════════════════════════╝"

# ── 1. System packages ───────────────────────────────────────────────────────
echo ""
echo "▶ [1/6] System packages..."
sudo dnf update -y -q
sudo dnf install -y -q git curl nginx

# ── 2. Bun runtime ───────────────────────────────────────────────────────────
echo "▶ [2/6] Installing Bun..."
if ! command -v bun &>/dev/null; then
  curl -fsSL https://bun.sh/install | bash
fi
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
grep -q BUN_INSTALL ~/.bashrc 2>/dev/null || \
  echo 'export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
echo "  Bun $(bun --version)"

# ── 3. Clone / update repo ───────────────────────────────────────────────────
echo "▶ [3/6] Cloning repo..."
sudo mkdir -p "$INSTALL_DIR"
sudo chown opc:opc "$INSTALL_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" fetch origin "$REPO_BRANCH"
  git -C "$INSTALL_DIR" checkout "$REPO_BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth=1 --branch "$REPO_BRANCH" \
    https://github.com/6eu6/Palmkit.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/external-worker"
bun install --frozen-lockfile 2>/dev/null || bun install
echo "  Dependencies installed."

# ── 4. .env file (skip if exists) ────────────────────────────────────────────
echo "▶ [4/6] Environment file..."
ENV_FILE="$INSTALL_DIR/external-worker/.env"

if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" << 'ENVEOF'
# ─── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# ─── Cloudflare R2 ───────────────────────────────────────────────────────────
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=palmkit-files

# ─── Encryption key (same value used in Cloudflare Pages env vars) ───────────
# Generate: openssl rand -hex 32
API_KEY_ENCRYPTION_KEY=

# ─── E2B sandbox (REQUIRED — runs npm install / build in the cloud sandbox) ──
E2B_API_KEY=

# ─── LLM fallback key (used when a user has no key of their own) ─────────────
OPENROUTER_API_KEY=

# ─── Worker ──────────────────────────────────────────────────────────────────
WORKER_PORT=8787
# ADMIN_TOKEN=   # optional — required only for POST /admin/update
ENVEOF
  chmod 600 "$ENV_FILE"
  echo "  Created $ENV_FILE  ← FILL IN SECRETS BEFORE STARTING"
else
  echo "  .env already exists — skipping."
fi

# ── 5. Systemd service ───────────────────────────────────────────────────────
echo "▶ [5/6] Systemd service..."
BUN_PATH="$HOME/.bun/bin/bun"

sudo tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null << SERVICEEOF
[Unit]
Description=Palmkit External Build Worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=opc
WorkingDirectory=$INSTALL_DIR/external-worker
EnvironmentFile=$INSTALL_DIR/external-worker/.env
ExecStart=$BUN_PATH run src/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=palmkit-worker
MemoryMax=5500M

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
echo "  Service enabled."

# ── 6. Nginx ─────────────────────────────────────────────────────────────────
echo "▶ [6/6] Nginx & firewall..."
sudo tee /etc/nginx/conf.d/palmkit-worker.conf > /dev/null << NGINXEOF
server {
    listen 80;
    server_name _;

    location /health {
        proxy_pass http://127.0.0.1:$WORKER_PORT/health;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 10s;
    }

    location /jobs/ {
        proxy_pass http://127.0.0.1:$WORKER_PORT/jobs/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location / { return 403; }
}
NGINXEOF

sudo nginx -t -q
sudo systemctl enable nginx --quiet
sudo systemctl restart nginx

sudo systemctl start firewalld 2>/dev/null || true
sudo firewall-cmd --permanent --add-service=http  --quiet 2>/dev/null || true
sudo firewall-cmd --permanent --add-service=ssh   --quiet 2>/dev/null || true
sudo firewall-cmd --reload --quiet 2>/dev/null || true

PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "YOUR_IP")

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║                   Setup Complete!                        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  STEP 1 — Fill in secrets:                               ║"
echo "║    nano $ENV_FILE"
echo "║                                                          ║"
echo "║  STEP 2 — Start the worker:                              ║"
echo "║    sudo systemctl start palmkit-worker                   ║"
echo "║                                                          ║"
echo "║  STEP 3 — Check logs:                                    ║"
echo "║    sudo journalctl -fu palmkit-worker                    ║"
echo "║                                                          ║"
echo "║  STEP 4 — Test:                                          ║"
echo "║    curl http://$PUBLIC_IP/health                         ║"
echo "╚══════════════════════════════════════════════════════════╝"
