# Backend (Device Monitor Engine)

Node.js + TypeScript monitoring engine inspired by LibreNMS's architecture. Ships as three
independently deployable processes sharing the same codebase/image:

| Process           | Entry point                    | Responsibility                                      |
|-------------------|---------------------------------|------------------------------------------------------|
| api               | `src/api/server.ts`             | REST API, JWT auth, WebSocket realtime bridge         |
| poller            | `src/poller/index.ts`           | Scheduling + SNMP/ping polling, discovery, alerting   |
| trap-collector    | `src/collectors/trap.ts`        | UDP 162 SNMP trap receiver                            |

## Stack

- Express (REST API), Socket.IO (realtime), Zod (validation), JWT + bcrypt (auth)
- Prisma + PostgreSQL (persistence), BullMQ + Redis (job scheduling/queueing)
- `net-snmp` (SNMP get/walk/v3/traps), `ping` (ICMP reachability)

## Data model (see `prisma/schema.prisma`)

`Device` → `Port` (interfaces) → `PortMetric` (time series); `Device` → `DeviceMetric`
(time series); `AlertRule` → `Alert`; `EventLog` (trap/system events);
`ServiceCheck` → `ServiceCheckHistory`.

## Key modules

- `src/lib/snmp.ts` — SNMP session helper (v1/v2c/v3), get/walk wrappers.
- `src/lib/mib-oids.ts` — OIDs used for discovery/polling (MIB-II, IF-MIB,
  HOST-RESOURCES-MIB, UCD-SNMP-MIB).
- `src/poller/discovery.ts` — identifies the device (sysDescr/sysObjectID) and
  enumerates interfaces (ifTable/ifXTable) into `Port` rows.
- `src/poller/metrics.ts` — per-cycle poll: ping, CPU/memory, per-interface counter
  deltas (rate + utilization), device status.
- `src/poller/alerting.ts` — evaluates enabled `AlertRule`s against latest metrics,
  opens/resolves `Alert`s.
- `src/poller/service-check.ts` — HTTP/HTTPS/DNS/PING/TCP service checks.
- `src/lib/events.ts` — Redis pub/sub bridge so poller/collector processes can push
  realtime events to the API's WebSocket clients.

## Environment variables

See `.env.example`. Required: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`.

## Local development

```bash
npm install
npx prisma migrate deploy
npm run dev:api
npm run dev:poller
```

## Known limitations / roadmap

This covers the core LibreNMS-style monitoring loop (discovery, polling, alerting,
SNMP traps, service checks) but not the full feature set of mature LibreNMS
(billing, config backup, distributed pollers, plugin system, LLDP-based topology,
long-term RRD rollups). See [../deploy/README.md](../deploy/README.md#8-lộ-trình-mở-rộng-chưa-triển-khai-trong-bản-này).
