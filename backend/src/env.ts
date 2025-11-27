import { z } from "zod";
import dotenv from "dotenv";

// Load environment variables from .env at startup
dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.string().optional(),
  // Auth (optional): set CLERK_* to enable Clerk; otherwise header-based dev auth is used.
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_JWT_TEMPLATE: z.string().optional(),
});

export const env = envSchema.parse(process.env);
export const isDev = env.NODE_ENV !== "production";
export const clerkEnabled = Boolean(env.CLERK_SECRET_KEY);
