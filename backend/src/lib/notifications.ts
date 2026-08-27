import nodemailer from 'nodemailer';
import { prisma } from './db';
import { logger } from './logger';

// Alert severity presentation: display label, colour dot and ranking floor.
const SEVERITY_META: Record<string, { label: string; emoji: string; rank: number }> = {
  critical: { label: 'CRITICAL', emoji: '🔴', rank: 3 },
  high: { label: 'HIGH', emoji: '🟠', rank: 2 },
  medium: { label: 'MEDIUM', emoji: '🟡', rank: 1 },
  low: { label: 'LOW', emoji: '🔵', rank: 0 },
};

function severityMeta(s: string): { label: string; emoji: string; rank: number } {
  return SEVERITY_META[s] ?? SEVERITY_META.medium;
}

export interface AlertNotification {
  deviceName: string;
  deviceIp: string;
  message: string;
  severity: string;
  event: 'new' | 'resolved';
  timestamp: Date;
  // Extra structured detail to build a richer, highlighted message (all optional).
  ruleName?: string | null;
  siteId?: string | null;
  objectName?: string | null;
  currentValue?: string | null;
  threshold?: string | null;
  // Alert category (e.g. "temperature", "service", "cpu"...) used to route to
  // channels whose `categories` filter is non-empty (e.g. a Telegram topic per type).
  category?: string;
}

interface EmailConfig {
  host: string;
  port: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string;
}

interface TelegramConfig {
  botToken: string;
  chatId: string;
  // Forum topic (message thread) id within a Telegram group with Topics enabled.
  // Omit to post to the group's General topic as before.
  messageThreadId?: string;
}

interface WebhookConfig {
  url: string;
}

interface SlackConfig {
  webhookUrl: string;
}

function meetsSeverity(alertSeverity: string, minSeverity: string): boolean {
  return severityMeta(alertSeverity).rank >= severityMeta(minSeverity).rank;
}

// Builds a detailed, highlighted alert message. No timestamp is included on purpose.
// Uses only emoji/uppercase/separators so it renders safely on every channel
// (no Markdown/HTML parse mode, which would break on '<'/'>' threshold conditions).
function formatText(n: AlertNotification): string {
  const sev = severityMeta(n.severity);
  const resolved = n.event === 'resolved';
  const headIcon = resolved ? '✅' : sev.emoji;
  const headText = resolved ? 'ĐÃ GIẢI QUYẾT' : 'CẢNH BÁO';
  const lines: string[] = [];
  lines.push(`${headIcon} ${headText} — MỨC ĐỘ ${sev.label}`);
  lines.push('━━━━━━━━━━━━━━━');
  lines.push(`🖥️ Đối tượng: ${n.deviceName} (${n.deviceIp})`);
  if (n.ruleName) lines.push(`📋 Nội dung: ${n.ruleName}`);
  if (n.objectName) lines.push(`📍 Thành phần: ${n.objectName}`);
  const stat: string[] = [];
  if (n.threshold) stat.push(`Ngưỡng ${n.threshold}`);
  if (n.currentValue) stat.push(`Hiện tại ${n.currentValue}`);
  if (stat.length > 0) lines.push(`📊 ${stat.join('   |   ')}`);
  return lines.join('\n');
}

async function sendEmail(cfg: EmailConfig, n: AlertNotification): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure ?? cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
  const subject = `${n.event === 'resolved' ? '[RESOLVED]' : '[ALERT]'} ${n.deviceName}: ${n.message}`;
  await transporter.sendMail({ from: cfg.from, to: cfg.to, subject, text: formatText(n) });
}

async function sendTelegram(cfg: TelegramConfig, n: AlertNotification): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: cfg.chatId,
      text: formatText(n),
      ...(cfg.messageThreadId ? { message_thread_id: Number(cfg.messageThreadId) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Telegram API responded ${res.status}: ${await res.text()}`);
}

async function sendWebhook(cfg: WebhookConfig, n: AlertNotification): Promise<void> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(n),
  });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
}

async function sendSlack(cfg: SlackConfig, n: AlertNotification): Promise<void> {
  const res = await fetch(cfg.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: formatText(n) }),
  });
  if (!res.ok) throw new Error(`Slack webhook responded ${res.status}`);
}

async function dispatchToChannel(
  channel: { id: string; type: string; config: string },
  n: AlertNotification,
): Promise<void> {
  const cfg = JSON.parse(channel.config);
  switch (channel.type) {
    case 'email':
      return sendEmail(cfg as EmailConfig, n);
    case 'telegram':
      return sendTelegram(cfg as TelegramConfig, n);
    case 'webhook':
      return sendWebhook(cfg as WebhookConfig, n);
    case 'slack':
      return sendSlack(cfg as SlackConfig, n);
    default:
      throw new Error(`Unknown notification channel type: ${channel.type}`);
  }
}

/** Fans an alert out to every enabled notification channel that meets the severity floor. */
export async function dispatchAlertNotification(n: AlertNotification): Promise<void> {
  const channels = await prisma.notificationChannel.findMany({
    where: {
      enabled: true,
      // Strict site routing: a site-scoped alert must only go to that site's
      // channels. This prevents cross-site leakage via global (siteId=null)
      // channels when multi-site separation is required.
      ...(typeof n.siteId !== 'undefined' ? { siteId: n.siteId ?? null } : {}),
    },
  });
  await Promise.all(
    channels
      .filter((c) => meetsSeverity(n.severity, c.minSeverity))
      // Empty categories = receives every alert type (default, back-compat). A
      // non-empty list restricts the channel to only those categories, letting
      // several channels share one Telegram chat but different topics per type.
      .filter((c) => c.categories.length === 0 || (n.category !== undefined && c.categories.includes(n.category)))
      .map(async (channel) => {
        try {
          await dispatchToChannel(channel, n);
          await prisma.notificationChannel.update({
            where: { id: channel.id },
            data: { lastSentAt: new Date(), lastError: null },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn({ err, channelId: channel.id, type: channel.type }, 'Notification delivery failed');
          await prisma.notificationChannel.update({ where: { id: channel.id }, data: { lastError: message } });
        }
      }),
  );
}

/** Sends a test message through a single channel config without persisting anything. */
export async function sendTestNotification(type: string, config: string): Promise<void> {
  await dispatchToChannel({ id: 'test', type, config }, {
    deviceName: 'Thiết bị kiểm tra',
    deviceIp: '0.0.0.0',
    message: 'Đây là thông báo kiểm tra kênh gửi cảnh báo.',
    severity: 'info',
    event: 'new',
    timestamp: new Date(),
  });
}
