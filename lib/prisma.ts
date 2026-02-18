// lib/prisma.ts
// Use the better-sqlite3 driver adapter for Prisma 7
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

declare global {
  // avoid creating multiple clients during HMR in dev
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

function buildPrismaClient() {
  const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";

  // instantiate the adapter class from the adapter package
  const adapter = new PrismaBetterSqlite3({
    // adapter expects the file URL (sqlite uses 'file:...' strings)
    url: dbUrl,
  });

  return new PrismaClient({
    adapter,
    log: ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? buildPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
