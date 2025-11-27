import { clerkMiddleware, clerkClient, getAuth } from "@clerk/express";
import { Request, Response, NextFunction, Express } from "express";
import { env, clerkEnabled } from "./env.js";
import { prisma } from "./prisma.js";

export type RequestWithContext = Request & { actorId?: string; entityId?: string };

async function upsertActorFromClerk(userId: string) {
  const user = await clerkClient.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses?.[0]?.emailAddress ??
    `${userId}@unknown.clerk.local`;
  const name = user.firstName ?? user.username ?? userId;

  const actor = await prisma.actor.upsert({
    where: { email },
    update: { name },
    create: { email, name },
  });

  return actor.id;
}

export function attachAuth(app: Express) {
  if (clerkEnabled) {
    app.use(clerkMiddleware());
  }

  app.use(async (req: RequestWithContext, _res: Response, next: NextFunction) => {
    try {
      if (clerkEnabled) {
        const auth = getAuth(req);
        if (auth?.userId) {
          req.actorId = await upsertActorFromClerk(auth.userId);
        }
      } else {
        // Dev fallback: allow passing actor/entity ids via headers for local testing without Clerk.
        req.actorId = req.header("x-actor-id") ?? undefined;
        req.entityId = req.header("x-entity-id") ?? undefined;
      }
    } catch (err) {
      console.error("Auth context error", err);
    }
    next();
  });
}
