# Changelog

Tất cả các thay đổi đáng chú ý của dự án được ghi lại tại đây.
Định dạng dựa trên [Keep a Changelog](https://keepachangelog.com/) và dự án dùng
[Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH) cho số phiên bản ở đầu mỗi mục.

Mỗi lần Copilot (hoặc dev) thay đổi code, một mục mới sẽ được thêm vào đầu file này,
kèm theo một git tag tương ứng (`vX.Y.Z`) để có thể revert nhanh bằng:

```bash
git log --oneline                 # xem lịch sử
git tag                           # xem danh sách phiên bản
git diff v0.1.1 v0.1.0            # so sánh 2 phiên bản
git checkout v0.1.0 -- .          # lấy lại toàn bộ code ở phiên bản cũ (working dir)
git reset --hard v0.1.0           # (cẩn thận) quay hẳn repo về phiên bản cũ
```

## [Unreleased]

## [0.7.6] - 2026-09-03

### Fixed
- Tên (name/hostname) của Device được đồng bộ từ vCenter (ESXi host) bị ghi đè
  về đúng tên trong vCenter ở mỗi chu kỳ đồng bộ (mặc định 60s/lần), nên đổi tên
  thủ công qua giao diện (nút Sửa thiết bị) không giữ được. `backend/src/poller/
  vcenter.ts`, `syncVCenterManager()`: `name`/`hostname` giờ chỉ được gán từ
  vCenter khi tạo mới Device lần đầu; các lần đồng bộ sau (update) không còn
  đụng tới 2 trường này nữa, nên tên tùy chỉnh của người dùng được giữ nguyên.

## [0.7.5] - 2026-09-03

### Fixed
- Giao diện có thể bị "đứng hình" (không cập nhật dữ liệu thiết bị) khi phiên
  đăng nhập (JWT, hạn 12h) hết hạn trong lúc tab trình duyệt bị để chạy nền lâu
  (ví dụ màn hình wallboard NOC để qua đêm). Cơ chế tự làm mới phiên trước đây
  chỉ dựa vào `setInterval` mỗi 30 phút, có thể bị trình duyệt tạm dừng khi tab
  không hiển thị trong thời gian dài, khiến token hết hạn mà không kịp làm mới
  → mọi request API trả 401 → tự đăng xuất về màn hình đăng nhập. Backend/poller
  vẫn thu thập dữ liệu bình thường trong suốt thời gian này (không mất dữ liệu),
  đây thuần là vấn đề hiển thị phía UI.
- `UI/src/App.tsx`: thêm làm mới phiên ngay khi tab được focus lại/hiển thị lại
  (`visibilitychange`/`focus`), bên cạnh interval 30 phút hiện có, để thu hẹp
  khoảng trống khi interval bị trình duyệt tạm dừng.

## [0.7.4] - 2026-08-28

### Changed
- Thay đổi cách chọn nhiệt độ đại diện cho thiết bị (ô "Nhiệt độ Ambient") khi
  thiết bị có nhiều cảm biến nhiệt độ (FortiGate, Juniper, HH3C, Cisco Small
  Business, Dell iDRAC), thay vì luôn lấy giá trị **cao nhất** trong tất cả cảm
  biến (dễ gây hiểu nhầm, ví dụ CPU on-die 74.4°C bị hiển thị như "Ambient" dù
  ngưỡng cảnh báo mặc định là cho nhiệt độ khung máy/inlet, không phải nhiệt độ
  lõi CPU):
  1. Ưu tiên cảm biến có tên chứa "ambient/inlet/intake" nếu có.
  2. Nếu không có, loại các cảm biến "hotspot" tên chứa cpu/processor/die/core/asic
     rồi lấy **trung bình** các cảm biến còn lại (board/nguồn/quạt...).
  3. Nếu tất cả cảm biến đều là hotspot (không cảm biến nào khác), lấy trung
     bình toàn bộ — vẫn hợp lý hơn lấy đỉnh của 1 cảm biến đơn lẻ.
  - File: `backend/src/poller/metrics.ts` — hàm mới `pickRepresentativeTemperature()`
    dùng chung cho các nhánh FortiGate/Juniper/HH3C/CiscoSB/Dell iDRAC trong
    `readTemperature()`. ENTITY-SENSOR-MIB/CISCO-ENTITY-SENSOR-MIB/CISCO-ENVMON-MIB
    vẫn giữ nguyên (đã lấy trung bình từ trước).
  - Lưu ý: giá trị "Nhiệt độ Ambient" cho các thiết bị nhiều cảm biến có thể
    thay đổi (thường thấp hơn) sau bản này — nên rà soát lại ngưỡng cảnh báo
    nhiệt độ nếu có rule tùy chỉnh dựa trên giá trị cũ.

## [0.7.3] - 2026-08-27

### Changed
- Chia lại layout tab "Trạng thái hệ thống" trong popup chi tiết thiết bị thành
  2 cột để xem được nhiều thông tin hơn trên 1 màn hình, giảm việc phải cuộn
  lên/xuống:
  - Cột trái (7/12): các biểu đồ — Bộ xử lý (Processor), Lịch sử hiệu năng
    (CPU/RAM/nhiệt độ/ping theo thời gian), và Lịch sử Tải UPS (nếu có).
  - Cột phải (5/12): các thông tin còn lại — Gauges (CPU/RAM/nhiệt độ/ICMP,
    nay 2 ô/hàng), lưới thông tin định danh thiết bị (nay 2 ô/hàng), cảm biến
    sức khỏe, và khối chi tiết kỹ thuật (sysObjectID/SNMP/uptime).
  - Ở màn hình hẹp (<1024px) layout tự động xếp chồng lại thành 1 cột như cũ.
  - File: `UI/src/components/DeviceManagement.tsx`.

## [0.7.2] - 2026-08-27

### Changed
- Mở rộng popup chi tiết thiết bị (khi click vào 1 thiết bị trong danh sách) sang
  hai bên để hiển thị nhiều thông tin hơn, giảm việc phải cuộn lên/xuống:
  - Khung popup: `max-w-4xl` → `max-w-6xl` (và `2xl:max-w-7xl` trên màn hình rất
    rộng ≥1536px).
  - Lưới thông tin định danh thiết bị (Tên thiết bị, Hãng/Model, Firmware, Số
    Serial, Loại thiết bị, Hệ điều hành, CPU Model, NIC vật lý, Kho lưu trữ, Mô
    tả sysDescr, Vị trí): thêm `lg:grid-cols-4` (≥1024px) để hiển thị 4 ô/hàng
    thay vì tối đa 3 ô/hàng như trước.
  - File: `UI/src/components/DeviceManagement.tsx`.

## [0.7.1] - 2026-08-27

### Changed
- Chuẩn hóa thông tin host VMware ESXi trong trang Thiết bị (khớp với sysDescr
  đồng bộ từ vCenter): ô **Firmware** giờ hiển thị "VMware ESXi \<version\>"
  (ví dụ "VMware ESXi 7.0.3") thay vì phiên bản BIOS máy chủ vật lý. Thêm 3 ô
  mới chỉ hiện với host ESXi: **CPU Model**, **NIC vật lý**, **Kho lưu trữ
  (Inventory)** — lấy từ chuỗi inventorySummary/sysDescr dạng
  `key=value • key=value`. Logic parse chuỗi này được tách ra dùng chung
  (`UI/src/utils/inventorySummary.ts`) giữa trang Thiết bị và trang VMware
  vCenter thay vì trùng lặp code.

## [0.7.0] - 2026-08-27

### Added
- Quy tắc cảnh báo theo phạm vi "Theo nhóm" (cả rule theo thiết bị lẫn rule theo
  cảm biến/đối tượng) giờ cho phép chọn **nhiều nhóm thiết bị cùng lúc** bằng
  cách tích vào danh sách checkbox, thay vì chỉ chọn được một nhóm duy nhất qua
  dropdown như trước. Thêm cột `AlertRule.groupIds` (String[], mặc định rỗng)
  song song với `groupId` cũ để tương thích ngược — theo đúng pattern đã dùng
  cho `deviceIds`/`portIds`/`sensorIds`/`serviceIds`. Logic đánh giá cảnh báo
  (poller) và tính năng sao chép/áp dụng rule sang nhiều site đều đã cập nhật
  để nhận diện `groupIds`.

## [0.6.2] - 2026-08-27

### Fixed
- Khớp thêm thông tin host ESXi đồng bộ từ vCenter vào đúng các ô tương ứng của
  thiết bị: **Firmware** (BIOS version) và **Số Serial** trước đây luôn để trống, giờ
  lấy từ `hardware.biosInfo.biosVersion` và
  `summary.hardware.otherIdentifyingInfo` (Service Tag/Serial Number Tag) qua
  vSphere API. Tab "VMware vCenter/ESXi" cũng thêm mục **Firmware** trong phần
  "Phần cứng" và sửa lỗi **Serial** chưa bao giờ được điền (thiếu token
  `serial_number` khi build inventory summary).
- Biểu đồ **"Lịch sử hiệu năng"** (CPU/RAM theo thời gian) không bao giờ hiển
  thị dữ liệu cho các thiết bị đồng bộ từ vCenter, vì các thiết bị này có
  `disabled=true` nên bị `poller/metrics.ts`'s `pollDevice()` bỏ qua hoàn toàn
  (không bao giờ tạo `DeviceMetric`). Giờ `poller/vcenter.ts` tự ghi 1 dòng
  `DeviceMetric` (cpuUsage/memoryUsage) sau mỗi chu kỳ đồng bộ cho từng host.

## [0.6.1] - 2026-08-27

### Changed
- Không cho phép thiết lập kết nối vCenter ở phạm vi "Toàn hệ thống" nữa —
  mỗi kết nối vCenter bắt buộc phải gắn với 1 trụ sở cụ thể (backend:
  `siteId` bắt buộc khi tạo mới và khi sửa không được đặt về rỗng/null;
  UI: bỏ tùy chọn "Toàn hệ thống" trong form, bắt buộc chọn trụ sở trước
  khi lưu).

## [0.6.0] - 2026-08-27

### Added
- Thêm nút **"Sửa"** cho từng kết nối vCenter (bên cạnh Đồng bộ ngay / Xóa): cho phép sửa tên, endpoint, tài khoản, mật khẩu, trụ sở mà không cần xóa và tạo lại. Tài khoản/mật khẩu để trống khi sửa sẽ giữ nguyên giá trị cũ.
- Backend: route `PATCH /api/vcenter/managers/:id` (cho phép cập nhật từng phần).

### Fixed
- Sửa toàn bộ tiếng Việt không dấu trong giao diện VMware vCenter/ESXi
  (`VirtualizationMonitor.tsx`): nhãn form, danh sách vCenter, bảng host, modal
  chi tiết host, thông báo lỗi...

## [0.5.2] - 2026-08-27

### Changed
- Giảm chu kỳ đồng bộ vCenter mặc định từ 300s xuống **60s**
  (`VCENTER_SYNC_INTERVAL_SECONDS`, đặt trong `docker-compose.yml`) — CPU/RAM/
  status/cảnh báo của các host ESXi giờ cập nhật mới hơn (tối đa 1 phút thay vì
  5 phút), phù hợp với quy mô hiện tại (1 vCenter manager, 5 host, ~101 VM).

### Added
- `poller/vcenter.ts`: thêm khoá `syncInProgress` chống 2 lần đồng bộ chạy
  chồng lên nhau nếu một lần đồng bộ (gọi vCenter API) mất lâu hơn khoảng thời
  gian giữa 2 chu kỳ — quan trọng hơn khi chu kỳ đã rút ngắn xuống 60s.

## [0.5.1] - 2026-08-27

### Fixed
- **Bug**: các rule cảnh báo (`device down`, `cpu`, `memory`...) hoàn toàn không
  được áp dụng cho các thiết bị đồng bộ từ vCenter, dù dữ liệu CPU/RAM/status
  vẫn cập nhật đúng. Nguyên nhân: các `Device` này được tạo với `disabled=true`
  (để vòng poll ping/SNMP thường không quét đè), nhưng `evaluateAlertsForDevice()`
  chỉ được gọi từ `pollDevice()` — hàm này bỏ qua ngay các device có
  `disabled=true`, và `poller/vcenter.ts` trước đó không tự gọi đánh giá cảnh báo.
- **Fix**: `poller/vcenter.ts` giờ gọi `evaluateAlertsForDevice()` ngay sau khi
  tạo/cập nhật `Device` cho mỗi ESXi host trong mỗi lần đồng bộ vCenter — các
  rule nhắm tới thiết bị/nhóm/site đó (theo `deviceId`, `deviceIds`, `groupId`
  "vCenter Device", hoặc `siteId`) giờ hoạt động bình thường như thiết bị SNMP.

## [0.5.0] - 2026-08-27

### Added
- Thêm trạng thái thiết bị mới **`critical`** (enum `DeviceStatus`, khác với
  `down`): một ESXi host vẫn kết nối bình thường tới vCenter nhưng có cảnh báo
  phần cứng/tài nguyên nghiêm trọng (`overallStatus=red` hoặc CPU/RAM vượt
  ngưỡng) giờ hiển thị đúng là **CRITICAL** (cam) thay vì bị gộp nhầm vào
  **DOWN** (đỏ, nghĩa là mất kết nối hẳn) như trước — chỉ khi vCenter báo
  `connectionState !== 'connected'` mới thật sự là `down`.
- Migration `20260827010000_device_status_critical` (`ALTER TYPE ... ADD VALUE`).
- UI: badge/màu trạng thái mới cho `critical` ở danh sách Thiết bị, modal chi
  tiết thiết bị, dashboard tuỳ biến (widget trạng thái thiết bị), và bản đồ
  mạng (Topology).

## [0.4.0] - 2026-08-27

### Added
- Mỗi ESXi host đồng bộ từ vCenter giờ được tạo thành một `Device` thật, gom vào
  nhóm tự động **"vCenter Device"** (mục Thiết bị) — không còn tách rời khỏi danh
  sách thiết bị SNMP. Bấm vào host sẽ mở đúng giao diện chi tiết thiết bị dùng
  chung (CPU/RAM/uptime/vendor/model/OS/sysDescr...) như mọi thiết bị khác.
- `backend/src/lib/vsphere.ts`: lấy thêm IP quản trị (VMkernel `vmk0`) của host.
- `backend/src/poller/vcenter.ts`: mỗi vòng đồng bộ tạo/cập nhật `Device` liên kết
  1-1 với `VirtualizationHost` (cột `deviceId` mới), tự tạo nhóm thiết bị theo site,
  tự tránh trùng `hostname`, map trạng thái (`ok/warning/critical` → `up/warning/down`,
  bảo trì → `maintenance`), và xoá `Device` tương ứng khi host bị gỡ khỏi vCenter
  hoặc xoá cả vCenter manager. Các thiết bị này đặt `disabled=true` để không bị
  vòng poll ping/SNMP/discovery thông thường quét chồng lên (dữ liệu lấy từ vCenter).
- Migration mới `20260827000000_vcenter_device_link` thêm cột
  `VirtualizationHost.deviceId` (FK 1-1 tới `Device`, `ON DELETE SET NULL`).

## [0.3.0] - 2026-08-27

### Added
- Tính năng giám sát VMware vCenter/ESXi (tương tự `vmware_exporter`): hoàn thiện
  phần code đã có sẵn nhưng dang dở (Prisma schema thiếu model, UI không có API/kiểu
  dữ liệu tương ứng, chưa gắn vào navigation).
- Thêm 3 model Prisma khớp với 2 migration đã áp dụng từ trước (không tạo migration
  mới): `VirtualizationManager`, `VirtualizationHost`, `VirtualMachine`.
- `backend/src/lib/vsphere.ts`: client SOAP vim25 tự viết (không dùng thư viện
  pyVmomi vì không có bản Node) — `RetrieveServiceContent`, `Login`/`Logout` theo
  session cookie, `RetrieveProperties` với `TraversalSpec` để duyệt toàn bộ
  Folder → Datacenter → hostFolder → ComputeResource → HostSystem, lấy thêm
  Datastore/VirtualMachine theo tham chiếu.
- `backend/src/poller/vcenter.ts`: đồng bộ inventory ESXi host/VM vào DB, tính
  % CPU/RAM sử dụng, gắn trạng thái cảnh báo ok/warning/critical, dọn dẹp
  host/VM không còn tồn tại trên vCenter.
- API mới `/api/vcenter/managers` (CRUD, đồng bộ ngay, xem inventory, chẩn đoán
  host) mounted trong `server.ts`.
- Đồng bộ định kỳ tự động mỗi `VCENTER_SYNC_INTERVAL_SECONDS` (mặc định 300s)
  cho tất cả vCenter manager đang bật, chạy trong tiến trình `poller`.
- UI: gắn tab "VMware vCenter" vào Navigation/App, bổ sung kiểu dữ liệu
  `VirtualizationManager`/`VirtualizationHost` và client API `api.vcenter.*`
  còn thiếu để `VirtualizationMonitor.tsx` (đã có sẵn nhưng mồ côi) hoạt động.
- Thêm dependency `fast-xml-parser` cho backend (parse phản hồi SOAP/XML).

### Fixed
- Sửa lỗi tính % CPU sử dụng của host ESXi: `summary.hardware.cpuMhz` là xung
  nhịp một lõi, không phải tổng công suất host — tổng công suất phải nhân với
  số lõi vật lý (`cpuCores`). Đã xác minh với vCenter thật (misa-group.vn).

## [0.2.0] - 2026-08-27

### Added
- Lưu lịch sử theo thời gian cho tất cả cảm biến (`Sensor`) qua model `SensorMetric`
  mới (giống cơ chế `ProcessorMetric`), áp dụng cho mọi loại cảm biến — bao gồm
  **Tải (UPS)** như yêu cầu.
- API `GET /devices/:id/sensors/metrics?type=load&hours=` trả về lịch sử cảm biến
  theo loại.
- UI: component `SensorHistoryPanel` hiển thị biểu đồ lịch sử Tải (UPS) trong trang
  chi tiết thiết bị, kèm bảng Hiện tại/Nhỏ nhất/Lớn nhất/Trung bình.
- Dọn dẹp định kỳ (`cleanup.ts`) xoá `SensorMetric` cũ theo `METRIC_RETENTION_DAYS`
  như các bảng time-series khác.

## [0.1.0] - 2026-08-27


### Added
- Khởi tạo git repository cho toàn bộ source hiện có (backend + UI + deploy) làm baseline.
- Thêm `.gitignore`, `CHANGELOG.md`, `ARCHITECTURE.md` để quản lý phiên bản và lưu kiến trúc hệ thống.
- Thiết lập repo memory (`/memories/repo/`) giúp Copilot nhớ kiến trúc dự án giữa các phiên làm việc.
