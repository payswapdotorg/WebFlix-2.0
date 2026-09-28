import { PrismaClient } from "@prisma/client";

// WFX2-W: prisma client singleton (z.ai standard shape; boot lane will have
// the identical file — byte-compatible merge expected).

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
