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

## [0.8.37] - 2026-10-07

### Fixed
- Khắc phục tình trạng mô tả interface (ifAlias/description) không tự cập nhật theo poll chu kỳ:
  - Poller bổ sung nhịp làm mới metadata IF-MIB (`ifName`, `ifDescr`, `ifAlias`) ngay trong luồng poll định kỳ.
  - Dữ liệu mô tả cổng trên tab Interfaces giờ sẽ tự đồng bộ theo chu kỳ, không còn phụ thuộc hoàn toàn vào thao tác "Quét SNMP" thủ công.

### Config
- Thêm biến môi trường mới cho backend/poller:
  - `INTERFACE_METADATA_REFRESH_SECONDS` (mặc định `600`) để điều chỉnh chu kỳ làm mới metadata interface trong poll thường.

### Verified
- Đã rebuild full stack bằng `docker compose up -d --build`.
- Xác nhận image `api` và `poller` build thành công, services khởi động lại ổn định.

## [0.8.36] - 2026-10-06

### Fixed
- Khắc phục thu thập RAM/Disk cho một số Windows SNMP agent trả kết quả walk không ổn định:
  - Poller ưu tiên nhánh thu thập HOST-RESOURCES theo indexed GET cho thiết bị Windows.
  - Bổ sung luồng persist sensor Disk/Virtual Memory trực tiếp trong poll cycle cho Windows,
    không phụ thuộc discovery walk tổng quát vốn dễ timeout trên một số host.
  - Cập nhật fallback maxRepetitions trong SNMP walk để giảm lỗi timeout khi đọc bảng lớn.

### Verified
- Đã rebuild full stack bằng `docker compose up -d --build`.
- Poll thủ công thiết bị Windows `192.168.60.11` thành công, DB cập nhật:
  - `Device.memoryUsage = 57`, `Device.totalMemoryBytes = 8589410304`.
  - Có sensor `disk` và `memory` với giá trị hợp lệ, thời gian cập nhật mới.

## [0.8.35] - 2026-10-06

### Performance
- Tối ưu truy vấn Events theo site để tránh quét sâu bảng `EventLog` khi site có ít hoặc không có thiết bị:
  - Bổ sung bước prefetch danh sách `deviceId` theo site và lọc `EventLog` theo `deviceId IN (...)`.
  - Thêm nhánh trả về nhanh khi site không có thiết bị, giảm tải CPU/IO cho Postgres trong các lần phân trang rỗng.

### Added
- Mở rộng Alert Rules cho phép nhiều điều kiện ngưỡng trên cùng một metric (multi-condition):
  - Hỗ trợ cấu hình nhiều ngưỡng theo mức cảnh báo (ví dụ `>70 => medium`, `>90 => high`).
  - Bổ sung model/migration `AlertRuleCondition` và backfill dữ liệu từ cấu trúc rule cũ.
  - API CRUD/copy/apply-site đã hỗ trợ `conditions` với backward compatibility.
  - Poller alerting đánh giá điều kiện phù hợp nhất theo mức severity cao nhất và cập nhật severity alert đang mở khi cần.

### Changed
- Cập nhật UI Alert Console để tạo/sửa/hiển thị nhiều điều kiện ngưỡng trong rule cảnh báo.
- Cải thiện trang chi tiết thiết bị cho UPS:
  - Tự nhận diện UPS và ưu tiên hiển thị chỉ số đặc thù: dung lượng pin, tải ngõ ra, thời gian lưu điện, điện áp vào/ra.
  - Ẩn/giảm nhấn mạnh biểu đồ CPU/RAM không phù hợp với UPS.
  - Bổ sung lịch sử tải và dung lượng pin UPS khi có sensor tương ứng.

### Verified
- Đã rebuild full stack bằng `docker compose up -d --build`.
- Xác nhận migration multi-condition được áp dụng và dữ liệu điều kiện được backfill.
- Kiểm tra UPS trong DB: tất cả thiết bị loại `ups` hiện có dữ liệu sensor không rỗng và có thời gian cập nhật gần nhất.

## [0.8.34] - 2026-09-25

### Performance
- Tối ưu an toàn cho Postgres healthcheck trong Docker Compose:
  - Sửa lệnh `pg_isready` để kiểm tra đúng database cấu hình (`POSTGRES_DB`) thay vì mặc định theo username.
  - Loại bỏ vòng lặp kết nối lỗi `FATAL: database "monitor" does not exist` gây nhiễu log và làm tăng tải không cần thiết.

### Risk Assessment
- Thay đổi chỉ tác động vào cơ chế healthcheck của container `postgres`, không thay đổi logic nghiệp vụ API, poller, alerting hoặc UI.
- Không thay đổi schema/migration, không tác động dữ liệu hiện có.
- Rủi ro tương thích thấp vì giá trị DB check sử dụng cùng biến môi trường `POSTGRES_DB` đang được toàn bộ service dùng trong `DATABASE_URL`.

### Verified
- Đã rebuild full stack bằng `docker compose up -d --build`.
- Xác nhận sau deploy không còn log `database "monitor" does not exist` trong `postgres`.
- Trạng thái dịch vụ đều `Up/Healthy`.

## [0.8.33] - 2026-09-25

### Performance
- Tiếp tục tối ưu tải poller và DB sau cơ chế SNMP auto-pause:
  - Thêm cơ chế backoff theo từng `vCenter manager` khi gặp lỗi DNS `ENOTFOUND` lặp lại, giảm retry storm ở chu kỳ sync.
  - Áp dụng exponential backoff có trần cho lỗi DNS và bỏ qua tạm thời manager trong cửa sổ backoff.
  - Giảm tần suất ghi `deviceMetric` cho thiết bị đang `SNMP AUTO-PAUSED` (ping-only), chỉ ghi theo nhịp định kỳ thay vì mỗi vòng poll.

### Verified
- Đã rebuild full stack bằng `docker compose up -d --build`.
- Runtime sau deploy ghi nhận log backoff DNS hoạt động đúng (`Applied DNS backoff for vCenter manager`).
- Snapshot `docker stats --no-stream` sau tối ưu: `poller` duy trì quanh ~14% CPU trong thời điểm kiểm tra.

### Added
- Thêm metric cảnh báo mới cho rule thiết bị: `ping_loss_packets` (mất gói ping theo số lượng gói).
  - Cho phép cấu hình ngưỡng theo số gói mất trên mỗi lần probe 3 gói (0..3) để phát hiện mất kết nối nhanh hơn.
  - Bổ sung lựa chọn metric này trong form tạo/sửa Alert Rule trên UI.

### Changed
- Tối ưu tải poller cho thiết bị SNMP lỗi kéo dài:
  - Khi một thiết bị gặp `SNMP timeout` liên tiếp đến ngưỡng cấu hình, hệ thống tự động tạm dừng SNMP cho thiết bị đó và chuyển sang poll ping-only.
  - Trạng thái tạm dừng SNMP được lưu trên Redis để giữ ổn định qua restart process.
  - Khi quản trị viên cập nhật lại cấu hình SNMP của thiết bị (port/version/community/credential), trạng thái auto-pause sẽ được xoá và SNMP được bật lại.
  - API và UI hiển thị thêm trạng thái `SNMP AUTO-PAUSED` để nhận diện nhanh thiết bị đang ở chế độ ping-only.
  - Bổ sung bộ lọc danh sách thiết bị theo trạng thái SNMP auto-pause (Tất cả/Đang pause/Bình thường).
  - Bổ sung thao tác nhanh "Bật lại SNMP" cho thiết bị auto-pause ngay trên bảng và màn hình chi tiết.
  - Tinh gọn bố cục thanh công cụ quản trị mục Thiết bị: rút gọn ô tìm kiếm, rút ngắn nhãn bộ lọc/nút thao tác để tránh control quá dài và dễ quét mắt hơn.
  - Giảm tải poller khi bật cơ chế SNMP auto-pause:
    - Luồng `discovery` bỏ qua thiết bị đang `SNMP AUTO-PAUSED` (ping-only), tránh tiếp tục quét SNMP gây timeout lặp lại.
    - Chu kỳ xếp job `discovery` chỉ áp dụng cho thiết bị còn bật SNMP (`snmpPort > 0`).

### Config
- Thêm biến môi trường:
  - `SNMP_AUTO_PAUSE_ENABLED` (mặc định `true`)
  - `SNMP_AUTO_PAUSE_TIMEOUT_STREAK` (mặc định `6` lần timeout liên tiếp)

## [0.8.26] - 2026-09-22

### Performance
- Tối ưu scheduler poller để giảm tải Redis và tăng throughput:
  - Chuyển enqueue job từ tuần tự (`add`) sang theo lô (`addBulk`) cho poll,
    fast-poll, discovery và service-check queues.
  - Trải đều `device-discovery` jobs theo toàn bộ chu kỳ discovery bằng `delay`
    ngẫu nhiên để tránh dồn burst tại cùng một thời điểm.

### Stability
- Bổ sung cơ chế cooldown/backoff thích ứng cho thiết bị unreachable:
  - Khi thiết bị thất bại liên tiếp, poller tạm giãn khoảng cách poll theo hàm mũ
    (`base * 2^n`, có trần), giúp giảm retry storm và SNMP timeout flood.
  - Khi thiết bị phục hồi, cooldown được xoá ngay và quay lại nhịp poll bình thường.
- Scheduler bỏ qua tạm thời các thiết bị đang trong cooldown thay vì tiếp tục xếp
  queue dày đặc cho cùng endpoint lỗi.

### Config
- Thêm biến cấu hình poll backoff:
  - `POLL_FAILURE_BACKOFF_BASE_SECONDS` (mặc định `60`)
  - `POLL_FAILURE_BACKOFF_MAX_SECONDS` (mặc định `900`)

## [0.8.25] - 2026-09-22

### Security
- Triển khai pha 2 hardening theo checklist:
  - Thêm audit log cho các trường hợp đăng nhập thất bại, login bị rate-limit,
    bootstrap bị từ chối và websocket auth bị từ chối.
  - Tăng bảo vệ endpoint `/api/ai-diagnose` bằng rate-limit theo IP
    (tối đa 30 request/phút) ở UI server.
- Bổ sung rate-limit cho nhóm API nhạy cảm (chỉ áp dụng với thao tác ghi):
  - `/api/users`
  - `/api/notification-channels`
  - `/api/sites`
  - `/api/vcenter`

### Added
- Thêm test tự động tối thiểu cho hardening:
  - bootstrap token check
  - sliding-window limiter behavior
  - socket token extraction for websocket auth
- Bổ sung script test backend:
  - `npm run test`
  - `npm run test:unit`

## [0.8.24] - 2026-09-22

### Security
- Gia cố luồng xác thực và khởi tạo tài khoản:
  - Bỏ cơ chế tự tạo `admin` khi login lần đầu qua `/api/auth/login`.
  - Thêm endpoint bootstrap một lần `/api/auth/bootstrap` yêu cầu `AUTH_BOOTSTRAP_TOKEN`.
  - Nếu chưa có user, login thường sẽ bị chặn và yêu cầu bootstrap trước.
- Bổ sung giới hạn chống brute-force cho login:
  - Theo cặp `IP + username` trong cửa sổ 15 phút.
  - Từ lần sai thứ 11 sẽ trả `429 Too Many Requests`.
- Bắt buộc xác thực JWT cho kết nối Socket.IO realtime:
  - Websocket không có token hợp lệ sẽ bị từ chối handshake.

### Backend
- Bổ sung guard cấu hình an toàn khi chạy production:
  - Từ chối khởi động nếu vẫn dùng `JWT_SECRET` mặc định hoặc `CORS_ORIGIN=*`
    (có thể override bằng `ALLOW_INSECURE_DEFAULTS=true` khi cần).
- Cập nhật `docker-compose.yml` để truyền các biến môi trường mới:
  - `AUTH_BOOTSTRAP_TOKEN`
  - `ALLOW_INSECURE_DEFAULTS`

### UI
- Bảo vệ endpoint AI diagnose trên UI server (`/api/ai-diagnose`) bằng JWT bearer.
- Cập nhật `AIAnomalyAssistant` dùng `apiClient` để tự động gửi token thay vì gọi `fetch` thẳng.
- Thêm dependency `jsonwebtoken` cho UI server-side auth guard.

## [0.8.23] - 2026-09-22

### Fixed
- Sửa biểu đồ `Traffic In/Out` ở màn chi tiết Interface khi chọn `7 ngày`:
  - Dữ liệu lịch sử không còn bị cụt do giới hạn lấy 2000 bản ghi gần nhất.
  - Backend `GET /api/ports/:id/metrics?hours=...` với khoảng thời gian dài
    được gom bucket theo thời gian (5/10/15 phút) để luôn phủ đủ toàn bộ cửa sổ
    thời gian yêu cầu và vẫn đảm bảo hiệu năng.
- Cải thiện hiển thị trục thời gian trên biểu đồ Interface:
  - Với mốc dài (24h, 7 ngày) trục X hiển thị kèm ngày để phân biệt mốc thời gian.
  - Tooltip hiển thị đầy đủ `ngày/tháng/năm giờ:phút` thay vì chỉ giờ.

## [0.8.22] - 2026-09-21

### Fixed
- Sửa nhận diện sensor nhiệt độ cho Fortinet FortiGate 201G.
  - Nguyên nhân: một số probe nhiệt độ của dòng này được đặt tên `TMP ...`
    (ví dụ `TMP 1 CPUTIN`, `TMP 2 PECI`) nên logic cũ chỉ lọc theo `temp`
    đã bỏ sót.
  - Mở rộng rule phân loại sensor Fortinet để nhận cả `TMP`/`thermal` ở:
    - luồng tính `Device.temperature`
    - luồng lưu `Sensor` loại `temperature`

### Verified
- Thiết bị `HQO-FWL-FG` (`192.168.24.1`, `FortiGate 201G`) sau khi poll lại đã có:
  - `Device.temperature = 45.6`
  - `2` sensor nhiệt độ: `TMP 1 CPUTIN`, `TMP 2 PECI`

## [0.8.21] - 2026-09-21

### Added
- Bổ sung tính năng ghi chú quản trị theo từng thiết bị để lưu nhanh thông tin
  vận hành như địa chỉ truy cập, tài khoản và lưu ý thao tác.
  - Backend thêm trường `Device.adminNote` (nullable text) + migration tương ứng.
  - API thiết bị (`POST/PUT /api/devices`) nhận và cập nhật trường `adminNote`.
  - UI thêm ô nhập `Ghi chú quản trị` trong form Thêm/Sửa thiết bị.
  - Modal chi tiết thiết bị hiển thị khối `Ghi chú quản trị` trong tab Trạng thái hệ thống.

## [0.8.20] - 2026-09-21

### Fixed
- Sửa hiển thị sai ở widget `Top cổng theo tải` khi nhiều cổng có băng thông thực tế
  thấp nhưng vẫn hiện `100%`.
  - Nguyên nhân: một số thiết bị/switch có thể báo `ifSpeed` thấp bất thường cho
    cổng `Gi/Fa/Te` làm % utilization bị đội lên.
  - Cập nhật logic hiển thị/sắp xếp trong widget Top cổng để tính theo tốc độ
    hiệu dụng, có chuẩn hoá theo loại cổng (`Gi/Fa/Te`) nhằm tránh 100% giả.

## [0.8.19] - 2026-09-18

### Fixed
- Khôi phục discovery VLAN cho Cisco CBS220/Cisco SMB khi thiết bị không expose
  `dot1dBasePortIfIndex`:
  - Mở rộng nhận diện model CBS để áp dụng nhánh xử lý SMB.
  - Bổ sung fallback map `basePort -> ifIndex` trực tiếp khi bridge-port map rỗng.
  - Đổi luồng walk Q-BRIDGE sang tuần tự và chịu lỗi theo từng OID để tránh
    fail toàn bộ discovery do một nhánh SNMP timeout/lỗi.

### Notes
- Với thiết bị `10.3.16.7` (CBS220-16P-2G), sau bản vá đã ghi nhận lại VLAN trong DB
  (`9` VLAN, `76` bản ghi `PortVlan`).
- CPU/RAM vẫn chưa có do thiết bị không trả dữ liệu ở các nhánh CPU/RAM MIB đang dùng
  (HOST-RESOURCES, UCD, CISCO-PROCESS, CISCO-MEMPOOL, CISCOSB root).

## [0.8.18] - 2026-09-18

### Added
- Tab `Interfaces` trong chi tiết thiết bị có thêm nút `Xuất Excel` để phục vụ
  lập port mapping.
- File xuất chứa các thông tin phục vụ port mapping: tên thiết bị, tên cổng, mô
  tả, VLAN, trạng thái `up/down`.

### Changed
- Chuẩn hóa header file port mapping theo định dạng dễ đọc trong Excel:
  `Source Device`, `Source Port`, `Description`, `VLAN`, `Status`.

### Fixed
- Khắc phục trường hợp `api` bị restart khi tải danh sách thiết bị dưới tải cao:
  - Nguyên nhân: Prisma timeout khi lấy kết nối DB (`Timed out fetching a new connection from the connection pool`).
  - Bọc xử lý lỗi endpoint `GET /api/devices` để trả về `503` khi DB bận thay vì làm tiến trình API thoát.
  - Tăng cấu hình pool Prisma trong `docker-compose.yml`:
    - `api`: `connection_limit=25`, `pool_timeout=30`
    - `poller`: `connection_limit=10`, `pool_timeout=30`

### Performance
- Tối ưu truy vấn danh sách thiết bị để giảm tải DB mà không đổi hành vi nghiệp vụ:
  - Tăng TTL cache ngắn từ `3s` lên `5s` cho `GET /api/devices`.
  - Thêm cơ chế gộp request đồng thời cùng scope (`in-flight dedup`) để tránh
    nhiều truy vấn giống nhau chạy song song trong cùng thời điểm.
- Tối ưu logging API:
  - Bỏ auto-log cho `GET /api/health`.
  - Giữ cấu hình logging ổn định để tránh ảnh hưởng runtime.

## [0.8.17] - 2026-09-17

### Changed
- Đồng bộ lại bộ nhận diện mới từ thư mục `Logo/` vào `UI/public/` để UI sử dụng
  đúng phiên bản logo và favicon mới nhất.
- Tăng nhẹ kích thước logo hiển thị trên giao diện:
  - Header: `40px` -> `44px`.
  - Màn hình đăng nhập: `64px` -> `72px`.

## [0.8.16] - 2026-09-17

### Changed
- Đổi nhận diện sản phẩm trên UI sang thương hiệu `NOC`:
  - Cập nhật tiêu đề trang trong `UI/index.html` thành `NOC`.
  - Cập nhật tên/miêu tả ứng dụng trong `UI/metadata.json`.
  - Cập nhật branding hiển thị trên Header và màn hình đăng nhập.
  - Cập nhật nhãn xuất báo cáo (`NOC_Report`, `NOC_Devices`) và trường
    metadata `system` trong file export.
  - Cập nhật tiêu đề phần cấu hình quy tắc cảnh báo sang `NOC`.

### Added
- Tích hợp bộ logo và favicon mới từ thư mục `Logo/` vào UI static assets:
  - `UI/public/logo-noc.png`
  - `UI/public/favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`
  - `UI/public/apple-touch-icon.png`
  - `UI/public/android-chrome-192x192.png`, `android-chrome-512x512.png`
  - `UI/public/site.webmanifest` với `name`/`short_name` là `NOC`.
- Bổ sung các thẻ favicon và manifest trong `UI/index.html` để trình duyệt sử
  dụng đúng bộ icon mới.

## [0.8.15] - 2026-09-17

### Added
- Thiết lập workflow chuẩn cho GitHub Copilot ngay trong repo để áp dụng theo
  hướng incremental + verification-first:
  - Thêm [copilot instructions](.github/copilot-instructions.md) cho ngữ cảnh
    backend/UI, ranh giới an toàn, checklist xác minh và lệnh chuẩn của dự án.
  - Thêm 4 core skills dưới `.github/skills/`:
    `context-engineering`, `incremental-implementation`,
    `test-driven-development`, `code-review-and-quality`.
  - Thêm 3 specialized agent personas dưới `.github/agents/`:
    `code-reviewer`, `test-engineer`, `security-auditor`.
  - Thêm prompt workflow ngắn tại `.github/prompts/nm-workflow.prompt.md` để
    gọi chuỗi thực thi an toàn hằng ngày.

### Changed
- Cải tiến cấu hình widget `Top Interfaces` trong Dashboard Builder:
  - Bổ sung tải danh sách `DeviceGroup` theo site đang chọn.
  - Bộ lọc nhóm chuyển sang `select` thay vì nhập tay ID nhóm.
  - Bổ sung chọn thiết bị theo ngữ cảnh nhóm cho widget `top-interfaces`.
  - Logic render dữ liệu `Top Interfaces` hỗ trợ lọc theo cả `groupId` và
    `deviceId` ngay trong widget config.

### Docs
- Chỉnh lại sơ đồ ASCII trong `deploy/README.md` để canh lề nhất quán hơn ở
  khối PostgreSQL/Redis/poller workers.

## [0.8.14] - 2026-09-15

### Fixed
- Chặn lỗi auto-resolve sai của cảnh báo `port_security_trap` khi cổng vẫn
  `err-disabled`:
  - `poller/alerting.ts` bỏ qua metric `port_security_trap` trong luồng
    `evaluateAlertsForDevice()`.
  - Vòng đời alert port-security chỉ còn do trap collector điều khiển
    (violation/recovery/linkUp), tránh bị coi là orphan interface và tự đóng.

## [0.8.13] - 2026-09-14

### Fixed
- Sửa hiển thị CPU/Memory sensor 0% hàng loạt trên HPE 1910-48 (JG540A):
  - `pollProcessors()` ưu tiên đọc `HP-ICF-MIB::hpSwitchCpuStat` cho HPE 1910,
    tránh dùng `hrProcessorLoad` có nhiều index placeholder 0%.
  - Nhánh `HH3C-ENTITY-EXT-MIB` bỏ qua sensor CPU/Memory có giá trị `0%` để
    không tạo danh sách sensor nhiễu (`CPU 62`, `Memory 14`, ...).

## [0.8.12] - 2026-09-14

### Fixed
- Sửa định tuyến Telegram cho alert sensor legacy thiếu `sensorType`:
  - Bổ sung chuẩn hoá category từ `sensorType` alias (ví dụ `temp` -> `temperature`).
  - Tự suy luận category theo `name/unit/metric` cho rule `sensor_value` cũ.
  - Hỗ trợ bỏ dấu tiếng Việt khi suy luận để các rule tên như "nhiệt độ" vẫn
    bắn đúng vào topic Nhiệt độ thay vì rơi vào topic Thiết bị (category `other`).

## [0.8.11] - 2026-09-13

### Changed
- Tối ưu cấu hình runtime để giảm tải CPU/RAM nhưng vẫn giữ giám sát gần realtime:
  - `POLL_WORKER_CONCURRENCY`: `32` -> `16`
  - `POLL_QUEUE_BUFFER_MULTIPLIER`: `4` -> `2`
  - `POLL_FAST_INTERVAL_SECONDS`: `10` -> `12`
  - `POLL_FAST_BATCH_SIZE`: `120` -> `60`
  - `SNMP_RETRIES`: `1` -> `0`
  - `DISCOVERY_INTERVAL_SECONDS`: `21600` -> `43200`
  - `SERVICE_WORKER_CONCURRENCY`: `6`
  - `SERVICE_CHECK_FAST_INTERVAL_SECONDS`: `8` -> `10`
  - `VCENTER_SYNC_INTERVAL_SECONDS`: `120`

## [0.8.10] - 2026-09-13

### Fixed
- Public UI proxy chuyển tiếp các route `/alertmanager` tới backend để Nagstamon
  truy cập được Alertmanager bridge.
- Chuẩn hóa các biến môi trường có thể chứa CRLF (`CORS_ORIGIN` và Basic Auth
  Nagstamon), tránh lỗi healthcheck API và lỗi xác thực khi deploy bằng `.env`
  định dạng Windows.

## [0.8.9] - 2026-09-13

### Fixed
- Cảnh báo port-security từ SNMP trap giờ gắn category `interface` cho cả sự kiện
  vi phạm và khôi phục, để các kênh Telegram lọc theo loại **Cổng mạng** không bị
  bỏ qua âm thầm.

## [0.8.8] - 2026-09-11

### Added
- Tính năng đánh dấu **thiết bị ưu tiên giám sát** để đẩy nhanh chu kỳ quan sát
  và phản ánh cảnh báo sát thực tế hơn trên các thiết bị quan trọng.
  - Backend thêm cờ `Device.isPriority` (mặc định `false`) và migration
    `20260910093000_device_priority_flag`.
  - API thiết bị (`POST/PUT /api/devices`, bulk create) nhận và lưu trường
    `isPriority`.
  - Poll scheduler ưu tiên các thiết bị có `isPriority=true` trong cả luồng
    poll thường và poll nhanh (`backend/src/poller/index.ts`), đồng thời đưa
    nhóm này vào điều kiện chọn của fast cycle.
  - UI Device Management thêm:
    - Cột badge `PRIORITY`.
    - Bộ lọc `Ưu tiên` (tất cả/đang bật/bình thường).
    - Nút bật/tắt ưu tiên theo từng thiết bị ngay trên bảng.

## [0.8.7] - 2026-09-10

### Fixed
- Giảm báo động giả trạng thái thiết bị down khi mạng chập chờn bằng cơ chế
  yêu cầu **thất bại liên tiếp** trước khi hạ trạng thái thiết bị xuống `down`:
  - Thêm ngưỡng cấu hình `DOWN_FAIL_STREAK_THRESHOLD` (mặc định `2`) trong
    `backend/src/lib/env.ts` và truyền vào poller qua `docker-compose.yml`.
  - Cập nhật luồng `pollDevice()` trong `backend/src/poller/metrics.ts`:
    nếu ping/SNMP thành công thì reset fail streak và lên `up` ngay; chỉ xuống
    `down` khi số lần fail liên tiếp đạt ngưỡng.

### Changed
- Tối ưu nhịp giám sát để giảm backlog poll và giảm độ trễ phản ánh trạng thái:
  - Tăng throughput poll bằng các tham số mẫu mới trong `backend/.env.example`:
    `POLL_WORKER_CONCURRENCY`, `POLL_QUEUE_BUFFER_MULTIPLIER`,
    `POLL_FAST_INTERVAL_SECONDS`, `POLL_FAST_BATCH_SIZE`.
  - Giảm độ trễ timeout SNMP qua `SNMP_TIMEOUT_MS=2000`, giữ `SNMP_RETRIES=1`.
  - Giảm tần suất discovery mẫu để ưu tiên tài nguyên cho polling trạng thái
    (`DISCOVERY_INTERVAL_SECONDS`, `DISCOVERY_WORKER_CONCURRENCY`).

- Bổ sung thời gian rõ ngày/giờ vào nội dung tin nhắn cảnh báo:
  - `backend/src/lib/notifications.ts` thêm dòng `🕒 Thời gian:` với định dạng
    `dd/mm/yyyy HH:mm:ss (GMT+7)` để dễ đối chiếu với hệ thống khác.

## [0.8.6] - 2026-09-07

### Changed
- Cơ chế cảnh báo cho tính năng Service Check được đổi để tránh báo động giả:
  cảnh báo trạng thái dịch vụ (`service_status`) chỉ được mở khi có **2 lần check
  thất bại liên tiếp** thay vì fail ngay lần đầu.
  - Áp dụng tại `backend/src/poller/alerting.ts` trong luồng đánh giá rule service.
  - Các rule service khác như `service_response_time` và `service_uptime` giữ
    nguyên hành vi cũ (đánh giá theo ngưỡng ngay mỗi lần check).

### Added
- Bổ sung biến cấu hình mẫu cho chu kỳ kiểm tra dịch vụ trong file env example:
  - `SERVICE_CHECK_INTERVAL_SECONDS` (chu kỳ check thường, mặc định 20s)
  - `SERVICE_CHECK_FAST_INTERVAL_SECONDS` (chu kỳ check nhanh cho service đang down/warning, mặc định 8s)

## [0.8.5] - 2026-09-03

### Added
- Tính năng quét dải mạng (Subnet Scan) giờ cho phép chọn **Nhóm thiết bị** trước
  khi thêm hàng loạt thiết bị đã quét thấy.
  - UI `ScanSubnetModal` thêm dropdown nhóm, tự nạp danh sách nhóm theo trụ sở đã chọn.
  - Khi bấm "Thêm thiết bị đã chọn", `groupId` được gửi kèm mỗi thiết bị.
  - Backend `/api/devices/bulk` nhận `groupId`, kiểm tra hợp lệ nhóm-trụ sở giống
    logic tạo/sửa thiết bị đơn lẻ, rồi gán nhóm ngay lúc tạo.

## [0.8.4] - 2026-09-03

### Fixed
- Một số cổng access VLAN 611 trên switch Cisco dòng SMB (ví dụ SF550X) bị
  hiển thị trống ở cột VLAN dù trên thiết bị thực tế có gán VLAN.
  - Nguyên nhân: nhánh Q-BRIDGE cho Cisco SMB chỉ ưu tiên static bitmap khi có
    dữ liệu một phần, trong khi nhiều model SF/SG/SX lại trả membership đầy đủ
    ở current bitmap; thêm vào đó regex nhận diện model SMB chưa bắt được mẫu
    có hậu tố chữ-số như `SF550X-48`.
  - Sửa: mở rộng nhận diện model SMB và buộc dùng hợp nhất static+current
    bitmap cho các dòng `SF/SG/SX/CBS/C1200/C1300` trong
    `backend/src/poller/vlans.ts`.
  - Kết quả đã xác minh trên `SDC-SWC-ACC-F3-02`: các cổng `fa1/0/7..11`,
    `fa1/0/15..24`, `fa1/0/30..35`, `fa1/0/38..48` được map đúng `611U`.

## [0.8.3] - 2026-09-03

### Fixed
- Tab Interfaces trên popup thiết bị trước đây chỉ hiển thị 1 VLAN untagged
  cho mỗi cổng, nên với cổng trunk có nhiều VLAN tagged dễ nhìn thành "sai VLAN"
  khi so với giao diện quản trị switch.
  - Dữ liệu backend thực tế đã đúng (có đủ tagged/untagged theo từng port trong
    bảng `PortVlan`), nhưng UI rút gọn còn 1 giá trị nên gây hiểu nhầm.
  - Sửa hiển thị ở `UI/src/components/DeviceManagement.tsx`: cột VLAN giờ hiện
    đầy đủ membership theo port dạng `U/T` (ví dụ `407U, 1T, 6T, ...`) thay vì
    chỉ 1 VLAN mặc định.

## [0.8.2] - 2026-09-03

### Fixed
- Giá trị RAM trên thiết bị F5 BIG-IP có thể hiển thị sai cao bất thường
  (ví dụ 90%+) so với dashboard trực tiếp trên F5.
  - Nguyên nhân: poller ưu tiên đọc UCD-SNMP-MIB (Linux chung), trong khi BIG-IP
    quản lý bộ nhớ theo pool TMM và non-TMM riêng; cách đọc generic này không phản
    ánh đúng cách F5 tính RAM sử dụng toàn hệ thống.
  - Sửa: thêm nhánh tính RAM riêng cho F5 trong `backend/src/poller/metrics.ts`,
    ưu tiên các OID của `F5-BIGIP-SYSTEM-MIB`:
    `sysGlobalHostMemTotal/Used` (fallback `sysStatMemory*` +
    `sysGlobalHostOtherMemory*`) để lấy đúng phần trăm RAM và tổng RAM theo F5.
  - Thêm các hằng OID F5 tương ứng trong `backend/src/lib/mib-oids.ts`.

## [0.8.1] - 2026-09-03

### Fixed
- Cảnh báo "thiết bị đã khắc phục" (device up trở lại) có lúc báo trễ tới hơn
  1 phút so với thực tế khi thiết bị down lâu (> ~3 phút), so với PRTG dùng
  cùng SNMP thì phát hiện phục hồi gần như ngay lập tức.
  - Nguyên nhân: BullMQ coi job không set `priority` là ưu tiên **cao nhất**
    (cao hơn cả `priority: 1`). Job poll nhanh 15s dành cho thiết bị
    down/warning (`poll-fast`, `check-fast`, priority: 1) vô tình bị các job
    poll định kỳ 60s bình thường (không set priority) chen ngang, nên khi
    hàng đợi có nhiều thiết bị, việc tái kiểm tra thiết bị down bị trễ.
  - Sửa: gán `priority: 5` cho job poll/check định kỳ thường
    (`backend/src/poller/index.ts`), để job tái kiểm tra nhanh của thiết bị
    down/warning thực sự được xử lý trước.

## [0.8.0] - 2026-09-03

### Added
- Tab mới "Lịch sử cảnh báo" trong popup chi tiết thiết bị, hiển thị các cảnh
  báo (mọi trạng thái: active/acknowledged/resolved) của riêng thiết bị đó
  trong 30 ngày gần nhất, kèm mức độ, nội dung, quy tắc, trạng thái và thời
  điểm khắc phục.
  - Backend: `GET /api/devices/:id/alerts` (`backend/src/api/routes/
    devices.ts`), giới hạn cứng 30 ngày + 500 bản ghi gần nhất. Thêm index
    `Alert(deviceId, timestamp)` (migration
    `20260903000000_alert_device_timestamp_index`) để truy vấn nhanh.
  - Frontend: component mới `UI/src/components/DeviceAlertHistory.tsx`
    (cùng khuôn mẫu với `DeviceNeighbors.tsx`), gắn vào tab bar của
    `DeviceManagement.tsx`. `NetworkAlert`/`RawAlert`/`mapAlert` bổ sung
    trường `resolvedAt`.

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
