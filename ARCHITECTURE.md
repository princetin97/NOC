# Kiến trúc hệ thống (Network / Device Monitor)

> Tài liệu này mô tả kiến trúc tổng thể để không phải đọc lại toàn bộ source mỗi khi
> quay lại dự án. Khi thay đổi cấu trúc lớn (thêm service, đổi luồng dữ liệu, đổi
> model DB...), hãy cập nhật file này + thêm entry vào [CHANGELOG.md](CHANGELOG.md).

## 1. Tổng quan

Hệ thống giám sát thiết bị mạng kiểu LibreNMS, gồm 6 service chạy trong Docker Compose
(xem [docker-compose.yml](docker-compose.yml)):

```
UI (React, :8080) --proxy /api,/socket.io--> api (Express, :4000) --+--> postgres (:5432)
                                                                     +--> redis (:6379) <-- BullMQ jobs/pubsub
poller (SNMP/ping/discovery/alerting)  ---\
syslog-collector (UDP :514)              ---> đều publish event qua Redis, ghi DB trực tiếp
trap-collector (UDP :162)                ---/
```

- **api**: REST API + JWT auth + WebSocket (Socket.IO) — nhận event realtime qua Redis
  pub/sub từ poller/collectors rồi re-broadcast cho client.
- **poller**: BullMQ workers — discovery, polling (SNMP/ping), alerting, service checks.
- **syslog-collector** / **trap-collector**: nhận syslog UDP 514 / SNMP trap UDP 162,
  ghi vào `EventLog`.
- **postgres**: datastore chính (Prisma ORM).
- **redis**: job queue (BullMQ) + realtime pub/sub bus.
- **ui**: React SPA (Vite), có server Express riêng để proxy `/api` và `/socket.io`
  sang service `api` (same-origin, tránh CORS).

Chi tiết triển khai Docker: [deploy/README.md](deploy/README.md).
Chi tiết backend: [backend/README.md](backend/README.md).

## 2. Backend (`backend/`)

Node.js + TypeScript, 4 process entry point dùng chung 1 codebase/image:

| Process          | Entry point                | Trách nhiệm |
|------------------|-----------------------------|-------------|
| api              | `src/api/server.ts`         | REST API, JWT auth, WebSocket bridge |
| poller           | `src/poller/index.ts`       | Scheduling, SNMP/ping polling, discovery, alerting |
| syslog-collector | `src/collectors/syslog.ts`  | UDP 514 syslog receiver |
| trap-collector   | `src/collectors/trap.ts`    | UDP 162 SNMP trap receiver |

Stack: Express, Socket.IO, Zod, JWT+bcrypt, Prisma + PostgreSQL, BullMQ + Redis,
`net-snmp`, `ping`.

### API routes (`src/api/routes/`)
`alerts, auth, dashboards, devices, events, groups, health, nagstamon, notifications,
ports, services, sites, topology, users` — mỗi file là 1 router Express theo domain tương ứng.

### Poller modules (`src/poller/`)
`index.ts` (bootstrap/scheduler), `discovery.ts` (nhận diện thiết bị + enum interfaces),
`metrics.ts` (poll ping/CPU/mem/counter interface mỗi cycle), `alerting.ts` (đánh giá
`AlertRule` → mở/đóng `Alert`), `service-check.ts` (HTTP/HTTPS/DNS/PING/TCP check),
`sensors.ts`, `processors.ts`, `vlans.ts`, `neighbors.ts`, `inventory.ts`, `cleanup.ts`.

### Lib dùng chung (`src/lib/`)
`snmp.ts` (session SNMP v1/v2c/v3, get/walk), `mib-oids.ts` (OID cho MIB-II, IF-MIB,
HOST-RESOURCES-MIB, UCD-SNMP-MIB), `events.ts` (Redis pub/sub → WebSocket realtime),
`auth.ts`, `db.ts` (Prisma client), `env.ts`, `logger.ts` (pino), `notifications.ts`,
`ping.ts`, `queue.ts` (BullMQ), `ssh.ts`, `subnet-scan.ts`, `websocket.ts`.

### Data model (`backend/prisma/schema.prisma`)
Các model chính (27 model, xem file để biết đầy đủ field/quan hệ):
`User, Site, UserSite` (multi-site + phân quyền) · `Device, HardwareComponent,
DeviceGroup, DeviceNeighbor, ConfigBackup` · `Port, Vlan, PortVlan, PortMetric`
(time-series interface) · `DeviceMetric, Processor, ProcessorMetric, Sensor,
SensorMetric` (time-series thiết bị/cảm biến — `SensorMetric` lưu lịch sử từng cảm
biến, ví dụ Tải UPS %, dùng bởi `GET /devices/:id/sensors/metrics?type=&hours=` và
component `SensorHistoryPanel`) · `AlertRule, AlertRenotifySettings,
NotificationChannel, Alert`
· `EventLog` (syslog/trap/system) · `ServiceCheck, ServiceCheckHistory` ·
`MapNode, MapLink` (topology map) · `Dashboard` (dashboard tuỳ biến).

Migrations nằm ở `backend/prisma/migrations/*`, đặt tên theo timestamp + mô tả.

## 3. UI (`UI/`)

React 19 + Vite + Tailwind v4, TypeScript. Có server Express riêng (`server.ts`)
để build production (`vite build` + bundle server bằng esbuild) và proxy API/WebSocket.

### Components chính (`src/components/`)
`OverviewDashboard, DeviceManagement, AddDeviceModal, EditDeviceModal, DevicePortPicker,
InterfaceList, PortDetail, DeviceMetricsHistory, DeviceNeighbors, DeviceConfigBackup,
AlertConsole, ServiceMonitoring, SyslogConsole, NetworkTopology, TopologyEditor,
DashboardBuilder, ProcessorsPanel, VirtualizationMonitor, PollerHealth,
AIAnomalyAssistant, ScanSubnetModal, ExportModal, SettingsPanel, LoginScreen, Header,
Navigation`.

### Services (`src/services/`)
`api.ts` / `apiClient.ts` (gọi REST API backend), `authService.ts` (login/JWT),
`socket.ts` (Socket.IO client realtime), `adapters.ts` (map DTO backend ↔ UI model),
`siteContext.ts` (multi-site context).

## 4. Quy ước làm việc / Versioning

- Sau mỗi thay đổi code có ý nghĩa: cập nhật [CHANGELOG.md](CHANGELOG.md) (mục
  `[Unreleased]` → bump version khi "chốt"), commit git với message rõ ràng, và tạo
  tag `vX.Y.Z` để có thể revert.
- Thay đổi cấu trúc/kiến trúc lớn: cập nhật file này.
- Không commit `.env`, `node_modules/`, `dist/` (xem `.gitignore`).
