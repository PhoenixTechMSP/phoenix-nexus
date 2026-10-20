#!/usr/bin/env bash
# Prepare un serveur Ubuntu 24.04 NEUF (a lancer une fois, en root) :
#   bash bootstrap-vps.sh "<cle publique ssh du pipeline>"
# Installe Docker, cree l'utilisateur 'deploy', ferme tout sauf 22/80/443, SSH par cle uniquement, fail2ban, mises a jour de securite auto.
set -euo pipefail
PUBKEY="${1:?usage : bootstrap-vps.sh \"ssh-ed25519 AAAA... pipeline\"}"
[ "$(id -u)" -eq 0 ] || { echo "a lancer en root" >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl ufw fail2ban unattended-upgrades
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
id deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$PUBKEY" /home/deploy/.ssh/authorized_keys 2>/dev/null || echo "$PUBKEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys; chmod 600 /home/deploy/.ssh/authorized_keys
install -d -o deploy -g deploy /opt/nexus /opt/nexus/deploy
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'CONF'
PasswordAuthentication no
PermitRootLogin prohibit-password
CONF
systemctl reload ssh || systemctl reload sshd
ufw default deny incoming; ufw default allow outgoing
ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban unattended-upgrades
echo "Serveur pret. Etape suivante : creer /opt/nexus/deploy/.env (voir deploy/CICD.md)."
