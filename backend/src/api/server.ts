import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from '../lib/env';
import { logger } from '../lib/logger';
import { patchBigIntSerialization } from '../lib/json';

patchBigIntSerialization();
import { initWebsocket, broadcast } from '../lib/websocket';
import { subscribeEvents } from '../lib/events';
import { requireAuth, requireWriteAccess } from './middleware/auth';
import { authRouter } from './routes/auth';
import { devicesRouter } from './routes/devices';
import { portsRouter } from './routes/ports';
import { alertsRouter, alertRulesRouter } from './routes/alerts';
import { servicesRouter } from './routes/services';
import { eventsRouter } from './routes/events';
import { topologyRouter } from './routes/topology';
import { notificationsRouter } from './routes/notifications';
import { usersRouter } from './routes/users';
import { healthRouter } from './routes/health';
import { groupsRouter } from './routes/groups';
import { dashboardsRouter } from './routes/dashboards';
import { nagstamonRouter } from './routes/nagstamon';
import { sitesRouter } from './routes/sites';
import { vcenterRouter } from './routes/vcenter';

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/auth', authRouter);
app.use('/api/devices', requireAuth, requireWriteAccess, devicesRouter);
app.use('/api/ports', requireAuth, requireWriteAccess, portsRouter);
app.use('/api/alerts', requireAuth, requireWriteAccess, alertsRouter);
app.use('/api/alert-rules', requireAuth, requireWriteAccess, alertRulesRouter);
app.use('/api/services', requireAuth, requireWriteAccess, servicesRouter);
app.use('/api/events', requireAuth, requireWriteAccess, eventsRouter);
app.use('/api/topology', requireAuth, requireWriteAccess, topologyRouter);
app.use('/api/notification-channels', requireAuth, requireWriteAccess, notificationsRouter);
app.use('/api/users', requireAuth, requireWriteAccess, usersRouter);
app.use('/api/poller-health', requireAuth, requireWriteAccess, healthRouter);
app.use('/api/device-groups', requireAuth, requireWriteAccess, groupsRouter);
app.use('/api/dashboards', requireAuth, requireWriteAccess, dashboardsRouter);
app.use('/api/sites', requireAuth, requireWriteAccess, sitesRouter);
app.use('/api/vcenter', requireAuth, requireWriteAccess, vcenterRouter);
app.use('/alertmanager', nagstamonRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const httpServer = http.createServer(app);
initWebsocket(httpServer);

// Re-broadcast events published by the poller/collector processes to connected UI clients.
const COALESCE_WINDOW_MS = 1500;
const coalescedEvents = new Set(['device:updated', 'device:discovered', 'service:updated', 'event:new', 'alert:new', 'alert:resolved']);
const coalesceTimerByEvent = new Map<string, NodeJS.Timeout>();
const lastPayloadByEvent = new Map<string, unknown>();

subscribeEvents((event, payload) => {
  if (!coalescedEvents.has(event)) {
    broadcast(event, payload);
    return;
  }

  lastPayloadByEvent.set(event, payload);
  if (coalesceTimerByEvent.has(event)) return;

  const timer = setTimeout(() => {
    coalesceTimerByEvent.delete(event);
    const mergedPayload = lastPayloadByEvent.get(event);
    lastPayloadByEvent.delete(event);
    broadcast(event, mergedPayload);
  }, COALESCE_WINDOW_MS);

  coalesceTimerByEvent.set(event, timer);
});

httpServer.listen(env.apiPort, () => {
  logger.info(`API server listening on port ${env.apiPort}`);
});
