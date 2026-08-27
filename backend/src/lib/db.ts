import { PrismaClient } from '@prisma/client';

// Reuse a single Prisma client instance across the process.
export const prisma = new PrismaClient();
