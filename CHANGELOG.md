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
