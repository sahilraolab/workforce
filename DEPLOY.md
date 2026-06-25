# Production Deployment — workforce.dreamtonexiv.xyz

## Overview
- **App**: Node.js/Express on port **3010** (internal, not exposed)
- **Proxy**: Nginx reverse proxy on the VPS (already handles other domains)
- **Process manager**: PM2
- **Database**: MySQL on the VPS (localhost)
- **Domain**: `workforce.dreamtonexiv.xyz` (DNS subdomain)

---

## Step 1 — DNS (do this first, propagates in ~5 min)

In your DNS provider (wherever dreamtonexiv.xyz is managed), add:

```
Type  Name        Value          TTL
A     workforce   <VPS_IP>       300
```

Verify: `dig workforce.dreamtonexiv.xyz +short` should return your VPS IP.

---

## Step 2 — VPS: Create MySQL database & user

SSH into your VPS, then:

```bash
mysql -u root -p
```

```sql
CREATE DATABASE workforce_saas CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'workforce_user'@'127.0.0.1' IDENTIFIED BY 'CHOOSE_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON workforce_saas.* TO 'workforce_user'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

> Replace `CHOOSE_A_STRONG_PASSWORD` with something secure (store it — you'll need it in .env).

---

## Step 3 — VPS: Upload the app

**Option A — Git (recommended):**
```bash
cd /var/www
git clone https://github.com/YOUR_ORG/YOUR_REPO.git workforce
cd workforce
```

**Option B — rsync from your Mac:**
```bash
# Run this on your Mac (not on the VPS)
rsync -avz --exclude='node_modules' --exclude='.env*' --exclude='uploads' \
  /Users/sahil/Documents/new_project_01/ root@<VPS_IP>:/var/www/workforce/
```

---

## Step 4 — VPS: Create the production .env

```bash
nano /var/www/workforce/.env
```

Paste the contents below, filling in the blanks:

```env
NODE_ENV=production
PORT=3010
APP_NAME=WorkforceEOS
APP_URL=https://workforce.dreamtonexiv.xyz

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=workforce_saas
DB_USER=workforce_user
DB_PASS=CHOOSE_A_STRONG_PASSWORD        # same as Step 2

SESSION_SECRET=c52336f6f41902465fd2c15bb5c6f263eb7992cc15bf07766be73566bb70286d7ef9273def7eb109e7debd79b0ff68cf9b988d79baf124b16191e5ad016d953c
SESSION_MAX_AGE_MS=28800000

ENCRYPTION_KEY=6f67783b1e3fb73aae9b81518b9b802a1bfd685451c5e4c66c5a7777361bc986

RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx   # your Resend.com key
EMAIL_FROM="WorkforceEOS <noreply@dreamtonexiv.xyz>"

SUPER_ADMIN_EMAIL=admin@dreamtonexiv.xyz
SUPER_ADMIN_PASSWORD=CHOOSE_STRONG_ADMIN_PASS
```

```bash
chmod 600 /var/www/workforce/.env
```

---

## Step 5 — VPS: Install dependencies & seed DB

```bash
cd /var/www/workforce
npm install --omit=dev

# Seed the super admin account (uses SUPER_ADMIN_EMAIL / _PASSWORD from .env)
NODE_ENV=production node utils/seed.js
```

---

## Step 6 — VPS: Create uploads directory

```bash
mkdir -p /var/www/workforce/uploads
chmod 755 /var/www/workforce/uploads
```

---

## Step 7 — VPS: Set up PM2

```bash
# Install PM2 globally if not already installed
npm install -g pm2

# Create log directory
mkdir -p /var/log/workforce

# Start the app
cd /var/www/workforce
pm2 start ecosystem.config.js --env production

# Save PM2 process list so it restarts on server reboot
pm2 save
pm2 startup   # follow the printed command (copy-paste and run it)
```

Verify it's running:
```bash
pm2 status
pm2 logs workforce-eos --lines 30
```

You should see:
```
Database connected.
Models synced.
WorkforceSaaS running on http://localhost:3010
```

---

## Step 8 — VPS: Nginx config

Find your Nginx config directory (usually `/etc/nginx/sites-available/`).

```bash
nano /etc/nginx/sites-available/workforce.dreamtonexiv.xyz
```

Paste:

```nginx
server {
    listen 80;
    server_name workforce.dreamtonexiv.xyz;

    # Let Certbot handle HTTPS redirect after Step 9
    location / {
        proxy_pass         http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
        client_max_body_size 20M;
    }

    # Serve uploaded files directly via Nginx (faster than Node)
    location /uploads/ {
        alias /var/www/workforce/uploads/;
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }
}
```

Enable it:
```bash
ln -s /etc/nginx/sites-available/workforce.dreamtonexiv.xyz \
       /etc/nginx/sites-enabled/

nginx -t          # must say "syntax is ok"
systemctl reload nginx
```

Test HTTP first: open `http://workforce.dreamtonexiv.xyz` — you should see the login page.

---

## Step 9 — SSL with Let's Encrypt (Certbot)

```bash
# Install certbot if not present
apt install -y certbot python3-certbot-nginx   # Debian/Ubuntu

# Issue certificate — Certbot auto-edits the Nginx config for HTTPS
certbot --nginx -d workforce.dreamtonexiv.xyz

# Auto-renewal is set up automatically; verify:
certbot renew --dry-run
```

After certbot runs, `https://workforce.dreamtonexiv.xyz` should load with a padlock.

---

## Step 10 — First login & post-launch checklist

1. Open `https://workforce.dreamtonexiv.xyz`
2. Log in with `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from your `.env`
3. **Immediately change the super admin password** via Settings → Profile
4. Create the first company + company admin account
5. Test: add a site, register a worker, mark attendance, run a compliance report

---

## Deployments after this (updates)

```bash
# On your Mac — push changes to Git
git add -A && git commit -m "..." && git push

# On the VPS
cd /var/www/workforce
git pull
npm install --omit=dev
pm2 reload workforce-eos       # zero-downtime restart
```

If you changed any model (added columns), run a one-time manual sync before reload:
```bash
NODE_ENV=production node -e "
  require('dotenv').config();
  const { sequelize } = require('./models');
  sequelize.sync({ alter: true }).then(() => { console.log('done'); process.exit(0); });
"
```

---

## Port reference (don't conflict with existing apps)

| App | Internal port |
|-----|--------------|
| WorkforceEOS | **3010** |
| Other apps on VPS | check with: `ss -tlnp \| grep LISTEN` |

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| 502 Bad Gateway | `pm2 status` — is the app running? `pm2 logs workforce-eos` |
| Login loop / CSRF error | Make sure `trust proxy 1` is set (already done) |
| Emails not sending | Check `RESEND_API_KEY` in `.env`; check Resend dashboard |
| DB connection refused | Verify `DB_USER`/`DB_PASS` match what you created in Step 2 |
| Uploads not persisting | Check `/var/www/workforce/uploads/` exists and is writable |
