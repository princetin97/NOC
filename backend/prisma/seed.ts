import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Default alert rules: only High CPU, Memory and Temperature are seeded out of the
// box. Administrators add any further rules (interfaces, ping, uptime, etc.) themselves.
const DEFAULT_RULES = [
  {
    name: 'High CPU Usage',
    metric: 'cpu',
    condition: '>',
    threshold: 85,
    unit: '%',
    severity: 'high' as const,
    description: 'CPU usage exceeded threshold',
  },
  {
    name: 'High Memory Usage',
    metric: 'memory',
    condition: '>',
    threshold: 80,
    unit: '%',
    severity: 'medium' as const,
    description: 'Memory usage exceeded threshold',
  },
  {
    name: 'High Temperature',
    metric: 'temperature',
    condition: '>',
    threshold: 65,
    unit: '°C',
    severity: 'high' as const,
    description: 'Chassis/ambient temperature is high',
  },
];

async function main() {
  for (const rule of DEFAULT_RULES) {
    const existing = await prisma.alertRule.findFirst({ where: { name: rule.name } });
    if (!existing) {
      await prisma.alertRule.create({ data: rule });
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
