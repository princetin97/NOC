#!/usr/bin/env bash
# Installs Docker Engine + Compose plugin on a fresh Ubuntu 24.04 host.
# Usage: chmod +x setup-ubuntu-24.04.sh && sudo ./setup-ubuntu-24.04.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (sudo ./setup-ubuntu-24.04.sh)" >&2
  exit 1
fi

echo "==> Removing conflicting packages (if any)"
for pkg in docker.io docker-doc docker-compose podman-docker containerd runc; do
  apt-get remove -y "$pkg" >/dev/null 2>&1 || true
done

echo "==> Installing prerequisites"
apt-get update
apt-get install -y ca-certificates curl gnupg

echo "==> Adding Docker's official GPG key and repository"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-noble} stable" \
  > /etc/apt/sources.list.d/docker.list

echo "==> Installing Docker Engine, CLI, containerd and Compose plugin"
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo "==> Enabling and starting Docker"
systemctl enable --now docker

if [ -n "${SUDO_USER:-}" ]; then
  echo "==> Adding ${SUDO_USER} to the docker group (re-login required to take effect)"
  usermod -aG docker "${SUDO_USER}"
fi

echo "==> Opening firewall ports (if ufw is active)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 8080/tcp  || true  # UI
  ufw allow 4000/tcp  || true  # API (optional, only if accessed directly)
  ufw allow 514/udp   || true  # Syslog collector
  ufw allow 162/udp   || true  # SNMP trap collector
fi

echo "==> Done. Docker version:"
docker --version
docker compose version
