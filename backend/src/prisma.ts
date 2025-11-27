import { PrismaClient } from "@prisma/client";
import { isDev } from "./env.js";

export const prisma = new PrismaClient({
  log: isDev ? ["query", "info", "warn", "error"] : ["warn", "error"],
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
