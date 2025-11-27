import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.string().optional(),
});

export const env = envSchema.parse(process.env);
export const isDev = env.NODE_ENV !== "production";
