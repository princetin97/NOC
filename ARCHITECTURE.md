# Kiến trúc hệ thống (Network / Device Monitor)

> Tài liệu này mô tả kiến trúc tổng thể để không phải đọc lại toàn bộ source mỗi khi
> quay lại dự án. Khi thay đổi cấu trúc lớn (thêm service, đổi luồng dữ liệu, đổi
> model DB...), hãy cập nhật file này + thêm entry vào [CHANGELOG.md](CHANGELOG.md).

Context reload nhanh khi mở lại source: xem thêm [docs/PROJECT-MEMORY.md](docs/PROJECT-MEMORY.md).

## 1. Tổng quan

Hệ thống giám sát thiết bị mạng kiểu LibreNMS, gồm 6 service chạy trong Docker Compose
(xem [docker-compose.yml](docker-compose.yml)):

```
UI (React, :8080) --proxy /api,/socket.io--> api (Express, :4000) --+--> postgres (:5432)
                                                                     +--> redis (:6379) <-- BullMQ jobs/pubsub
poller (SNMP/ping/discovery/alerting)  ---\
trap-collector (UDP :162)                ---/
```

- **api**: REST API + JWT auth + WebSocket (Socket.IO) — nhận event realtime qua Redis
  pub/sub từ poller/collectors rồi re-broadcast cho client.
- **poller**: BullMQ workers — discovery, polling (SNMP/ping), alerting, service checks.
- **trap-collector**: nhận SNMP trap UDP 162, ghi vào `EventLog`.
- **postgres**: datastore chính (Prisma ORM).
- **redis**: job queue (BullMQ) + realtime pub/sub bus.
- **ui**: React SPA (Vite), có server Express riêng để proxy `/api` và `/socket.io`
  sang service `api` (same-origin, tránh CORS).

Chi tiết triển khai Docker: [deploy/README.md](deploy/README.md).
Chi tiết backend: [backend/README.md](backend/README.md).

## 2. Backend (`backend/`)

Node.js + TypeScript, 3 process entry point dùng chung 1 codebase/image:

| Process          | Entry point                | Trách nhiệm |
|------------------|-----------------------------|-------------|
| api              | `src/api/server.ts`         | REST API, JWT auth, WebSocket bridge |
| poller           | `src/poller/index.ts`       | Scheduling, SNMP/ping polling, discovery, alerting |
| trap-collector   | `src/collectors/trap.ts`    | UDP 162 SNMP trap receiver |

Stack: Express, Socket.IO, Zod, JWT+bcrypt, Prisma + PostgreSQL, BullMQ + Redis,
`net-snmp`, `ping`.

### API routes (`src/api/routes/`)
`alerts, auth, dashboards, devices, events, groups, health, nagstamon, notifications,
ports, services, sites, topology, users, vcenter` — mỗi file là 1 router Express theo domain tương ứng.

### Poller modules (`src/poller/`)
`index.ts` (bootstrap/scheduler), `discovery.ts` (nhận diện thiết bị + enum interfaces),
`metrics.ts` (poll ping/CPU/mem/counter interface mỗi cycle), `alerting.ts` (đánh giá
`AlertRule` → mở/đóng `Alert`), `service-check.ts` (HTTP/HTTPS/DNS/PING/TCP check),
`sensors.ts`, `processors.ts`, `vlans.ts`, `neighbors.ts`, `inventory.ts`, `cleanup.ts`,
`vcenter.ts` (đồng bộ inventory ESXi host/VM từ vCenter, chạy định kỳ mỗi
`VCENTER_SYNC_INTERVAL_SECONDS`, mặc định 60s kể từ v0.5.2 (trước là 300s);
có cơ chế khoá (`syncInProgress`) chống chạy chồng chéo nếu một lần đồng bộ mất
lâu hơn khoảng thời gian giữa 2 lần). Từ v0.6.2, mỗi lần đồng bộ ghi thêm 1 dòng
`DeviceMetric` (cpuUsage/memoryUsage) cho từng host ESXi — bắt buộc vì các
Device đồng bộ từ vCenter có `disabled=true` nên `poller/metrics.ts`'s
`pollDevice()` bỏ qua hoàn toàn (không có nguồn `DeviceMetric` nào khác), nếu
thiếu bước này biểu đồ "Lịch sử hiệu năng" trên UI sẽ luôn trống. Cũng từ
v0.6.2, `Device.firmware`/`Device.serial` được điền từ
`vsphere.VSphereHostInfo.biosVersion`/`.serialNumber` (lấy qua
`hardware.biosInfo.biosVersion` và `summary.hardware.otherIdentifyingInfo` của
vSphere API).

`api/routes/vcenter.ts` có route `PATCH /api/vcenter/managers/:id` (v0.6.0) để
sửa từng phần (`name/endpoint/username/password/siteId`) một kết nối
`VirtualizationManager` đã tồn tại mà không cần xoá + tạo lại; `username`/`password`
để trống trong body coi như giữ nguyên giá trị cũ (không bắt buộc gửi lại).
`siteId` là bắt buộc từ v0.6.1 (không còn phạm vi "Toàn hệ thống"/null nữa) —
cả `createManagerSchema` lẫn `updateManagerSchema` yêu cầu `siteId` là chuỗi
không rỗng nếu có gửi lên; cột DB `VirtualizationManager.siteId` vẫn để nullable
(không tạo migration) vì chỉ chặn ở tầng API/UI, không đổi schema.

### Lib dùng chung (`src/lib/`)
`snmp.ts` (session SNMP v1/v2c/v3, get/walk), `mib-oids.ts` (OID cho MIB-II, IF-MIB,
HOST-RESOURCES-MIB, UCD-SNMP-MIB), `events.ts` (Redis pub/sub → WebSocket realtime),
`auth.ts`, `db.ts` (Prisma client), `env.ts`, `logger.ts` (pino), `notifications.ts`,
`ping.ts`, `queue.ts` (BullMQ), `ssh.ts`, `subnet-scan.ts`, `websocket.ts`,
`vsphere.ts` (client SOAP vim25 tự viết để gọi VMware vSphere Web Services API —
`RetrieveServiceContent`/`Login`/`RetrieveProperties` với `TraversalSpec` để duyệt
Folder→Datacenter→hostFolder→ComputeResource→HostSystem; không dùng thư viện ngoài
vì không có bản pyVmomi cho Node).

### Data model (`backend/prisma/schema.prisma`)
Các model chính (30 model, xem file để biết đầy đủ field/quan hệ):
`User, Site, UserSite` (multi-site + phân quyền) · `Device, HardwareComponent,
DeviceGroup, DeviceNeighbor, ConfigBackup` · `Port, Vlan, PortVlan, PortMetric`
(time-series interface) · `DeviceMetric, Processor, ProcessorMetric, Sensor,
SensorMetric` (time-series thiết bị/cảm biến — `SensorMetric` lưu lịch sử từng cảm
biến, ví dụ Tải UPS %, dùng bởi `GET /devices/:id/sensors/metrics?type=&hours=` và
component `SensorHistoryPanel`) · `AlertRule, AlertRenotifySettings,
NotificationChannel, Alert`
· `EventLog` (trap/system) · `ServiceCheck, ServiceCheckHistory` ·
`MapNode, MapLink` (topology map) · `Dashboard` (dashboard tuỳ biến) ·
`VirtualizationManager, VirtualizationHost, VirtualMachine` (kết nối vCenter +
inventory ESXi host/VM, giám sát tương tự `vmware_exporter`; model khớp với 2
migration đã áp dụng từ trước `20260821120000_vcenter_monitoring` và
`20260821130000_vcenter_host_metrics` — không tạo migration mới khi thêm model).

`VirtualizationHost.deviceId` (v0.4.0, migration `20260827000000_vcenter_device_link`)
liên kết 1-1 tới `Device`: mỗi lần đồng bộ, `poller/vcenter.ts` tạo/cập nhật một
`Device` thật cho từng ESXi host, gom vào `DeviceGroup` tự tạo tên "vCenter Device"
(theo site của manager), đặt `disabled=true` để vòng poll ping/SNMP/discovery
thường không quét đè (dữ liệu CPU/RAM/status lấy từ vCenter). Xoá host khỏi vCenter
hoặc xoá manager sẽ xoá luôn `Device` tương ứng (dọn cả metric/alert lịch sử).

`Device.status` (enum `DeviceStatus`) có 5 giá trị: `up, down, warning, critical,
maintenance` (thêm `critical` ở v0.5.0, migration `20260827010000_device_status_critical`).
`critical` dùng cho thiết bị vẫn kết nối/hoạt động bình thường nhưng có cảnh báo
nghiêm trọng (vd. ESXi host còn `connectionState=connected` nhưng
`overallStatus=red` hoặc CPU/RAM vượt ngưỡng) — khác với `down` (mất kết nối hẳn).
`poller/vcenter.ts`'s `deviceStatusFor()` là nơi áp dụng logic này cho vCenter hosts.

Rule cảnh báo (`AlertRule`/`evaluateAlertsForDevice()`) hoạt động như nhau cho cả
thiết bị SNMP lẫn thiết bị đồng bộ từ vCenter: vòng poll SNMP/ping thường
(`poller/metrics.ts`'s `pollDevice()`) bỏ qua các `Device` có `disabled=true`
(gồm mọi thiết bị vCenter) trước khi gọi `evaluateAlertsForDevice()`, nên
`poller/vcenter.ts` phải tự gọi `evaluateAlertsForDevice(deviceId)` ngay sau khi
tạo/cập nhật từng `Device` trong `syncVCenterManager()` (từ v0.5.1) — nếu thiếu
bước này, rule `device_status`/`cpu`/`memory`/... nhắm tới các host vCenter sẽ
không bao giờ được đánh giá dù dữ liệu vẫn hiển thị đúng trên UI.

Migrations nằm ở `backend/prisma/migrations/*`, đặt tên theo timestamp + mô tả.

## 3. UI (`UI/`)

React 19 + Vite + Tailwind v4, TypeScript. Có server Express riêng (`server.ts`)
để build production (`vite build` + bundle server bằng esbuild) và proxy API/WebSocket.

### Components chính (`src/components/`)
`OverviewDashboard, DeviceManagement, AddDeviceModal, EditDeviceModal, DevicePortPicker,
InterfaceList, PortDetail, DeviceMetricsHistory, DeviceNeighbors, DeviceConfigBackup,
AlertConsole, ServiceMonitoring, SyslogConsole, NetworkTopology, TopologyEditor,
DashboardBuilder, ProcessorsPanel, VirtualizationMonitor (tab "VMware vCenter" —
quản lý kết nối vCenter + bảng host ESXi + modal chi tiết/chẩn đoán; mỗi kết nối có
nút "Sửa" (v0.6.0) gọi `api.vcenter.update()` → `PATCH /vcenter/managers/:id`),
PollerHealth,
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
