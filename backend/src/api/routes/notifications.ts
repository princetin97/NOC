import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/db';
import { sendTestNotification } from '../../lib/notifications';
import { requireAdmin, type AuthedRequest } from '../middleware/auth';
import { canAccessSite, isGlobalAdmin, notificationSiteWhere } from '../middleware/site-scope';

export const notificationsRouter = Router();

// Notification channel configuration is admin-only (system or site-scoped admin).
notificationsRouter.use(requireAdmin);

const emailConfig = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  secure: z.boolean().optional(),
  user: z.string().optional(),
  pass: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
});
const telegramConfig = z.object({
  botToken: z.string().min(1),
  chatId: z.string().min(1),
  messageThreadId: z.string().optional(),
});
const webhookConfig = z.object({ url: z.string().url() });
const slackConfig = z.object({ webhookUrl: z.string().url() });

const configByType = {
  email: emailConfig,
  telegram: telegramConfig,
  webhook: webhookConfig,
  slack: slackConfig,
} as const;

const channelBaseSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['email', 'telegram', 'webhook', 'slack']),
  enabled: z.boolean().default(true),
  minSeverity: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  siteId: z.string().nullish(),
  // Alert categories this channel receives (e.g. "temperature", "service"). Empty = all.
  categories: z.array(z.string()).default([]),
  config: z.record(z.unknown()),
});

const channelSchema = channelBaseSchema.superRefine((val, ctx) => {
  const result = configByType[val.type].safeParse(val.config);
  if (!result.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Cấu hình không hợp lệ cho kênh ${val.type}`, path: ['config'] });
  }
});

// Never leak secrets (SMTP passwords, bot tokens) back to the client.
function redactConfig(type: string, raw: string): Record<string, unknown> {
  const cfg = JSON.parse(raw) as Record<string, unknown>;
  for (const key of ['pass', 'botToken']) {
    if (cfg[key]) cfg[key] = '••••••••';
  }
  return cfg;
}

function serialize(channel: { id: string; name: string; type: string; enabled: boolean; minSeverity: string; siteId: string | null; categories: string[]; config: string; lastError: string | null; lastSentAt: Date | null; createdAt: Date }) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    enabled: channel.enabled,
    minSeverity: channel.minSeverity,
    siteId: channel.siteId,
    categories: channel.categories,
    config: redactConfig(channel.type, channel.config),
    lastError: channel.lastError,
    lastSentAt: channel.lastSentAt,
    createdAt: channel.createdAt,
  };
}

notificationsRouter.get('/', async (req: AuthedRequest, res) => {
  const channels = await prisma.notificationChannel.findMany({ where: notificationSiteWhere(req), orderBy: { createdAt: 'asc' } });
  res.json(channels.map(serialize));
});

notificationsRouter.post('/', async (req: AuthedRequest, res) => {
  const parsed = channelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (!isGlobalAdmin(req) && !canAccessSite(req, parsed.data.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền tạo kênh cho trụ sở này' });
    return;
  }
  const created = await prisma.notificationChannel.create({
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      enabled: parsed.data.enabled,
      minSeverity: parsed.data.minSeverity,
      siteId: parsed.data.siteId,
      categories: parsed.data.categories,
      config: JSON.stringify(parsed.data.config),
    },
  });
  res.status(201).json(serialize(created));
});

notificationsRouter.put('/:id', async (req: AuthedRequest, res) => {
  const parsed = channelBaseSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const existingForScope = await prisma.notificationChannel.findFirst({ where: { id: req.params.id, ...(notificationSiteWhere(req) ?? {}) } });
  if (!existingForScope) {
    res.status(404).json({ error: 'Notification channel not found' });
    return;
  }
  if (!isGlobalAdmin(req) && typeof parsed.data.siteId !== 'undefined' && !canAccessSite(req, parsed.data.siteId)) {
    res.status(403).json({ error: 'Bạn không có quyền chuyển kênh sang trụ sở này' });
    return;
  }
  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.config) {
    // Merge onto the existing config (rather than replacing it) so secret fields
    // (SMTP password, bot token) left blank in the edit form aren't wiped out —
    // the client never receives the real secret back, only a redacted placeholder.
    const existing = await prisma.notificationChannel.findUnique({ where: { id: req.params.id } });
    const existingConfig = existing ? (JSON.parse(existing.config) as Record<string, unknown>) : {};
    data.config = JSON.stringify({ ...existingConfig, ...parsed.data.config });
  }
  const updated = await prisma.notificationChannel.update({ where: { id: req.params.id }, data });
  res.json(serialize(updated));
});

notificationsRouter.delete('/:id', async (req: AuthedRequest, res) => {
  const existing = await prisma.notificationChannel.findFirst({ where: { id: req.params.id, ...(notificationSiteWhere(req) ?? {}) }, select: { id: true } });
  if (!existing) {
    res.status(404).json({ error: 'Notification channel not found' });
    return;
  }
  await prisma.notificationChannel.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

notificationsRouter.post('/test', async (req, res) => {
  const parsed = z
    .object({ type: z.enum(['email', 'telegram', 'webhook', 'slack']), config: z.record(z.unknown()) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    await sendTestNotification(parsed.data.type, JSON.stringify(parsed.data.config));
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ ok: false, error: err instanceof Error ? err.message : 'Gửi thử thất bại' });
  }
});
