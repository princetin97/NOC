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
       │  PostgreSQL  │                │    Redis     │
       └──────────────┘                └──────┬──────┘
                                               │ BullMQ jobs
                    ┌───────────────┬──────────┴─────────┬───────────────┐
             ┌──────▼──────┐ ┌──────▼──────┐      ┌───────▼──────┐ ┌─────▼──────┐
             │   poller     │ │syslog-collect│      │trap-collector│ │  (workers)  │
             │(SNMP/ping/   │ │  :514/udp    │      │   :162/udp   │ │             │
             │ discovery)   │ └─────────────┘      └──────────────┘ └────────────┘
             └──────────────┘
```

- **api**: REST API, JWT auth, WebSocket bridge (re-broadcasts events published by poller/collectors via Redis pub/sub).
- **poller**: schedules and runs SNMP polling, ICMP ping, discovery and service checks (BullMQ workers).
- **syslog-collector** / **trap-collector**: receive syslog (UDP 514) and SNMP traps (UDP 162), store as events.
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

## 4. Tạo tài khoản admin & thêm thiết bị (qua API)

Tài khoản admin đầu tiên được tạo tự động ở lần đăng nhập đầu tiên với username `admin`:

```bash
TOKEN=$(curl -s -X POST http://<server-ip>:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"ChangeMe123!"}' | jq -r .token)

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

## 5. Cấu hình thiết bị gửi syslog / SNMP trap về hệ thống

Trên router/switch, trỏ syslog server và SNMP trap receiver về IP của host Docker:

```
logging host <docker-host-ip>
snmp-server host <docker-host-ip> version 2c public
```

## 6. Xem log

```bash
docker compose logs -f api
docker compose logs -f poller
docker compose logs -f syslog-collector trap-collector
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
