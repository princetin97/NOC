# Triển khai trên Ubuntu 24.04 (Docker)

## 1. Kiến trúc

```
                      ┌─────────────┐
                      │   UI (React) │  :8080
                      └──────┬──────┘
                             │ REST + WebSocket (future wiring)
                      ┌──────▼──────┐
                      │   API (Express)  │ :4000
                      └───┬─────┬───┘
              ┌───────────┘     └────────────┐
       ┌──────▼──────┐                ┌──────▼──────┐
       │  PostgreSQL │                │    Redis    │
       └─────────────┘                └──────┬──────┘
                                             │ BullMQ jobs
                          ┌───────────────┬────────┴─────────┬───────────────┐
                        ┌──────▼──────┐                         ┌───────▼──────┐ ┌─────▼──────┐
                        │   poller    │                         │trap-collector│ │  (workers) │
                        │(SNMP/ping/  │                         │   :162/udp   │ │            │
                        │ discovery)  │                         └──────────────┘ └────────────┘
                        └─────────────┘
```

- **api**: REST API, JWT auth, WebSocket bridge (re-broadcasts events published by poller/collectors via Redis pub/sub).
- **poller**: schedules and runs SNMP polling, ICMP ping, discovery and service checks (BullMQ workers).
- **trap-collector**: receive SNMP traps (UDP 162), store as events.
- **postgres**: primary datastore (devices, interfaces, metrics, alerts, events).
- **redis**: job queue (BullMQ) + realtime pub/sub bus.
- **ui**: the React dashboard; its own Express server proxies `/api` and `/socket.io` to the `api` service (same-origin, no CORS).

## 2. Cài đặt Docker trên Ubuntu 24.04

```bash
cd deploy
chmod +x setup-ubuntu-24.04.sh
sudo ./setup-ubuntu-24.04.sh
# đăng xuất/đăng nhập lại để áp dụng quyền docker group
```

## 2.1 Triển khai nhanh cho site mới (một lệnh)

Script này tự động:

1. Cài Docker/Compose nếu thiếu.
2. Clone hoặc cập nhật source code.
3. Tạo file `.env` cho site.
4. Chạy `docker compose up -d --build`.

```bash
chmod +x deploy/quick-deploy-site.sh
./deploy/quick-deploy-site.sh \
  --repo <repo-url> \
  --branch main \
  --site-name site-a \
  --public-host <ip-hoac-domain>
```

Ví dụ:

```bash
./deploy/quick-deploy-site.sh \
  --repo git@github.com:your-org/network-monitor.git \
  --branch main \
  --site-name hcm-site \
  --public-host 10.10.10.20
```

## 3. Triển khai

```bash
git clone <repo-url> device-monitor-system
cd device-monitor-system
cp .env.example .env
nano .env   # đặt mật khẩu DB, JWT_SECRET, v.v.

docker compose up -d --build
docker compose ps
```

- UI: http://<server-ip>:8080
- API: http://<server-ip>:4000/api/health

## 4. Bootstrap tài khoản admin đầu tiên & thêm thiết bị (qua API)

Từ bản hardening mới, hệ thống yêu cầu bootstrap admin đầu tiên qua endpoint bảo mật.

Lấy `AUTH_BOOTSTRAP_TOKEN` trong file `.env` của site, sau đó chạy:

```bash
TOKEN=$(curl -s -X POST http://<server-ip>:4000/api/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"token":"<AUTH_BOOTSTRAP_TOKEN>","username":"admin","password":"ChangeMe123!"}' | jq -r .token)

curl -s -X POST http://<server-ip>:4000/api/devices \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
        "name": "Core-Router-01",
        "hostname": "core-router-01",
        "ip": "192.168.1.1",
        "type": "router",
        "snmpVersion": "v2c",
        "snmpCommunity": "public"
      }'
```

Thêm thiết bị sẽ tự động enqueue 1 lượt discovery + poll ngay lập tức; sau đó `poller` sẽ tự động polling định kỳ theo `POLL_INTERVAL_SECONDS`.

## 5. Cấu hình thiết bị gửi SNMP trap về hệ thống

Trên router/switch, trỏ SNMP trap receiver về IP của host Docker:

```
snmp-server host <docker-host-ip> version 2c public
```

## 6. Xem log

```bash
docker compose logs -f api
docker compose logs -f poller
docker compose logs -f trap-collector
```

## 7. Backup dữ liệu

```bash
docker compose exec postgres pg_dump -U monitor device_monitor > backup.sql
```

## 8. Lộ trình mở rộng (chưa triển khai trong bản này)

Để đạt tính năng tương đương đầy đủ với LibreNMS, các hạng mục sau cần được bổ sung dần:
- LLDP/CDP discovery để dựng sơ đồ topology thật (bảng `Link`).
- RRD/long-term rollup & retention cho dữ liệu time-series.
- Module billing, config backup, distributed pollers, plugin system.
- Cơ chế notification (email/Slack/webhook) khi có alert mới.

## 9. Tài liệu thiết kế scale-up (single-site -> multi-site)

Xem tài liệu chi tiết kiến trúc và cách triển khai Docker tại:

- [SCALING-ARCHITECTURE-DOCKER.md](SCALING-ARCHITECTURE-DOCKER.md)

## 10. Hướng dẫn triển khai cho các site khác

- [DEPLOY-OTHER-SITES.md](DEPLOY-OTHER-SITES.md)

## 11. Lệnh cập nhật source và build lại các site

- [UPDATE-SOURCE-AND-REDEPLOY.md](UPDATE-SOURCE-AND-REDEPLOY.md)
