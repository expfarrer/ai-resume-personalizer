// prisma.config.ts
// Loads env from .env automatically (dotenv) and defines Prisma CLI config.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  // path to your prisma schema
  schema: "prisma/schema.prisma",

  // migrations folder (default)
  migrations: {
    path: "prisma/migrations",
  },

  // Move datasource URL here (prisma 7+)
  datasource: {
    url: env("DATABASE_URL"),
  },
});
