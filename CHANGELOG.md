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

## [0.1.0] - 2026-08-27

### Added
- Khởi tạo git repository cho toàn bộ source hiện có (backend + UI + deploy) làm baseline.
- Thêm `.gitignore`, `CHANGELOG.md`, `ARCHITECTURE.md` để quản lý phiên bản và lưu kiến trúc hệ thống.
- Thiết lập repo memory (`/memories/repo/`) giúp Copilot nhớ kiến trúc dự án giữa các phiên làm việc.
