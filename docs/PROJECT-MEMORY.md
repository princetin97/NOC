# Project Memory (Fast Context Reload)

Muc tieu: mo lai source la nho ngay boi canh, khong can doc lai toan bo code.

## 1) Kien truc nhanh
- Monorepo gom 2 app chinh: backend (Node.js + TypeScript + Prisma) va UI (React + Vite + TypeScript).
- Runtime Docker Compose: api, poller, trap-collector, postgres, redis, ui.
- Luong realtime: poller/collectors -> Redis pubsub -> API Socket.IO -> UI.

## 2) Tinh nang chinh
- Device monitoring: discovery + polling SNMP/ping + interface/processor/sensor/vlan/neighbor/inventory.
- Alerting: rule engine, acknowledge/resolve, re-notify, notifications (email/telegram/webhook/slack).
- Events: SNMP Trap console.
- Topology: auto topology + topology map editor.
- Services: PING/HTTP/HTTPS/DNS/TCP checks.
- Virtualization: VMware vCenter manager + ESXi host/VM inventory + diagnostics.
- Multi-site + RBAC + dashboard custom.

## 3) File map nen doc truoc khi code
- Tong quan he thong: ARCHITECTURE.md
- Lich su thay doi: CHANGELOG.md
- Rule lam viec cho Copilot: agentskill/copilot-instructions.md
- Backend API entry: backend/src/api/server.ts
- Poller bootstrap: backend/src/poller/index.ts
- Prisma schema: backend/prisma/schema.prisma
- UI app shell: UI/src/App.tsx
- UI service layer: UI/src/services/api.ts

## 4) Quy trinh version hoa de revert
1. Code change xong -> cap nhat CHANGELOG.md (muc Unreleased).
2. Commit ro nghia.
3. Tao tag annotated:
   ./deploy/version-tag.sh vX.Y.Z "<mo ta ngan gon>"
4. Neu can day len remote:
   ./deploy/version-tag.sh vX.Y.Z "<mo ta ngan gon>" --push

## 5) Quy trinh cap nhat memory sau moi thay doi co y nghia
- Cap nhat muc "Tinh nang chinh" neu co module/chuc nang moi.
- Cap nhat "File map" neu doi entrypoint/duong dan quan trong.
- Cap nhat CHANGELOG.md va tham chieu version moi nhat.
- Neu co thay doi kien truc lon, cap nhat them ARCHITECTURE.md.

## 6) Last verified snapshot
- Date: 2026-10-15
- Runtime model: Trap-only (khong con syslog collector)
- Nagstamon bridge: /alertmanager + Basic Auth qua NAGSTAMON_USER/NAGSTAMON_PASSWORD
- UI navigation: header + nav menu duoc sticky de hien thi khi cuon
