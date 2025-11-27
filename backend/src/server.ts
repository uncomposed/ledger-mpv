import cors from "cors";
import express, { Request, Response } from "express";
import morgan from "morgan";
import { z } from "zod";
import { clerkEnabled, env } from "./env.js";
import { prisma } from "./prisma.js";
import { attachAuth, RequestWithContext } from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("dev"));
attachAuth(app);

const defaultLensTypes = [
  { type: "INVENTORY_LENS", name: "Inventory Lens" },
  { type: "MEAL_PLAN_LENS", name: "Weekly Meal Plan Lens" },
];

function weekRange(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sunday
  const diffToSunday = day;
  const start = new Date(d);
  start.setDate(d.getDate() - diffToSunday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

async function ensureDefaultLenses() {
  for (const lens of defaultLensTypes) {
    const existing = await prisma.lens.findFirst({ where: { type: lens.type } });
    if (!existing) {
      await prisma.lens.create({
        data: { type: lens.type, name: lens.name },
      });
    }
  }
}

async function ensureBaseLocations(entityId: string) {
  const existing = await prisma.location.findMany({ where: { entityId } });
  if (existing.length) return existing;

  const home = await prisma.location.create({
    data: { entityId, name: "Home" },
  });

  const children = await prisma.location.createMany({
    data: [
      { entityId, name: "Pantry", parentId: home.id },
      { entityId, name: "Fridge", parentId: home.id },
      { entityId, name: "Freezer", parentId: home.id },
    ],
  });

  if (!children.count) {
    return prisma.location.findMany({ where: { entityId } });
  }

  return prisma.location.findMany({ where: { entityId } });
}

async function ensureDefaultSensors(entityId: string) {
  const sensors = [
    { name: "Mobile camera", type: "MOBILE_CAMERA" },
    { name: "Web upload", type: "WEB_UPLOAD" },
  ];

  for (const sensor of sensors) {
    const existing = await prisma.sensor.findFirst({
      where: { entityId, type: sensor.type },
    });
    if (!existing) {
      await prisma.sensor.create({
        data: { entityId, name: sensor.name, type: sensor.type },
      });
    }
  }
}

function respondError(res: Response, error: unknown) {
  console.error(error);
  return res.status(500).json({ error: "Unexpected error" });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post("/actors", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const actor = await prisma.actor.create({ data: parsed.data });
    return res.json(actor);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    adminActorId: z.string().uuid().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const entity = await prisma.entity.create({ data: { name: parsed.data.name } });
    await ensureBaseLocations(entity.id);
    await ensureDefaultSensors(entity.id);

    if (parsed.data.adminActorId) {
      await prisma.entityActor.create({
        data: {
          entityId: entity.id,
          actorId: parsed.data.adminActorId,
          role: "ADMIN",
        },
      });
    }

    const locations = await prisma.location.findMany({ where: { entityId: entity.id } });
    return res.json({ entity, locations });
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/actors", async (req, res) => {
  const schema = z.object({
    actorId: z.string().uuid(),
    role: z.string().default("MEMBER"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const membership = await prisma.entityActor.create({
      data: {
        entityId: req.params.entityId,
        actorId: parsed.data.actorId,
        role: parsed.data.role,
      },
    });
    return res.json(membership);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/locations", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    parentId: z.string().uuid().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const location = await prisma.location.create({
      data: {
        entityId: req.params.entityId,
        name: parsed.data.name,
        parentId: parsed.data.parentId,
      },
    });
    return res.json(location);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/resources", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    unit: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const resource = await prisma.resource.create({
      data: {
        entityId: req.params.entityId,
        name: parsed.data.name,
        unit: parsed.data.unit,
      },
    });
    return res.json(resource);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/inventory", async (req, res) => {
  const schema = z.object({
    resourceId: z.string().uuid(),
    locationId: z.string().uuid(),
    quantity: z.number(),
    expiresAt: z.string().datetime().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        entityId: req.params.entityId,
        resourceId: parsed.data.resourceId,
        locationId: parsed.data.locationId,
        quantity: parsed.data.quantity,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
      },
    });
    return res.json(item);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/goals/weekly-plan", async (req, res) => {
  const schema = z.object({
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const { start, end } = parsed.data.periodStart
    ? {
        start: new Date(parsed.data.periodStart),
        end: parsed.data.periodEnd ? new Date(parsed.data.periodEnd) : weekRange(new Date(parsed.data.periodStart)).end,
      }
    : weekRange();

  try {
    let goal = await prisma.goal.findFirst({
      where: {
        entityId: req.params.entityId,
        type: "WEEKLY_MEAL_PLAN",
        periodStart: start,
      },
    });

    if (!goal) {
      goal = await prisma.goal.create({
        data: {
          entityId: req.params.entityId,
          type: "WEEKLY_MEAL_PLAN",
          state: "PENDING",
          periodStart: start,
          periodEnd: end,
          recurring: true,
        },
      });
    }

    const planningTask = await prisma.task.create({
      data: {
        entityId: req.params.entityId,
        goalId: goal.id,
        type: "PLAN_WEEKLY_MEALS",
        status: "PENDING",
        dueAt: end,
      },
    });

    if ((req as RequestWithContext).actorId) {
      await prisma.taskActor.create({
        data: {
          taskId: planningTask.id,
          actorId: (req as RequestWithContext).actorId!,
          role: "ACCOUNTABLE",
        },
      });
    }

    await prisma.planning.create({
      data: {
        entityId: req.params.entityId,
        goalId: goal.id,
        taskId: planningTask.id,
        config: { dinners: 7 },
      },
    });

    return res.json({ goal, planningTask });
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/tracks", async (req, res) => {
  const schema = z.object({
    actorId: z.string().uuid(),
    mediaUrl: z.string(),
    telemetry: z.any().optional(),
    locationId: z.string().uuid().optional(),
    sensorType: z.string().default("MOBILE_CAMERA"),
    lensType: z.string().default("INVENTORY_LENS"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    await ensureDefaultSensors(req.params.entityId);
    await ensureDefaultLenses();

    const sensor = await prisma.sensor.findFirst({
      where: { entityId: req.params.entityId, type: parsed.data.sensorType },
    });

    if (!sensor) {
      return res.status(400).json({ error: "Sensor type not found for entity" });
    }

    const track = await prisma.track.create({
      data: {
        entityId: req.params.entityId,
        actorId: parsed.data.actorId,
        sensorId: sensor.id,
        locationId: parsed.data.locationId,
        mediaUrl: parsed.data.mediaUrl,
        telemetry: parsed.data.telemetry,
      },
    });

    const lens = await prisma.lens.findFirst({ where: { type: parsed.data.lensType } });
    if (lens) {
      await prisma.lensRun.create({
        data: {
          trackId: track.id,
          lensId: lens.id,
          analystType: "AI",
          status: "PENDING",
        },
      });
    }

    return res.json(track);
  } catch (error) {
    return respondError(res, error);
  }
});

app.get("/entities/:entityId/tasks", async (req, res) => {
  const schema = z.object({
    type: z.string().optional(),
    actorId: z.string().uuid().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const tasks = await prisma.task.findMany({
      where: {
        entityId: req.params.entityId,
        type: parsed.data.type,
        taskActors: parsed.data.actorId
          ? { some: { actorId: parsed.data.actorId, role: "RESPONSIBLE" } }
          : undefined,
      },
      include: {
        taskActors: true,
        goal: true,
        step: true,
        solution: true,
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
    });
    return res.json(tasks);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/tasks/:taskId/status", async (req, res) => {
  const schema = z.object({
    status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const updated = await prisma.task.update({
      where: { id: req.params.taskId },
      data: { status: parsed.data.status },
    });
    return res.json(updated);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/seed/demo", async (_req, res) => {
  try {
    await ensureDefaultLenses();

    const actor =
      (await prisma.actor.findUnique({ where: { email: "demo@ledger.local" } })) ??
      (await prisma.actor.create({
        data: { email: "demo@ledger.local", name: "Demo Admin" },
      }));

    const entity =
      (await prisma.entity.findFirst({ where: { name: "Demo Household" } })) ??
      (await prisma.entity.create({ data: { name: "Demo Household" } }));

    await ensureBaseLocations(entity.id);
    await ensureDefaultSensors(entity.id);

    const membership = await prisma.entityActor.upsert({
      where: { entityId_actorId: { entityId: entity.id, actorId: actor.id } },
      update: { role: "ADMIN" },
      create: { entityId: entity.id, actorId: actor.id, role: "ADMIN" },
    });

    const [pantry, fridge] = await prisma.location.findMany({
      where: { entityId: entity.id, name: { in: ["Pantry", "Fridge"] } },
    });

    const potatoes =
      (await prisma.resource.findFirst({ where: { entityId: entity.id, name: "Gold potatoes" } })) ??
      (await prisma.resource.create({
        data: { entityId: entity.id, name: "Gold potatoes", unit: "lb" },
      }));

    const beef =
      (await prisma.resource.findFirst({ where: { entityId: entity.id, name: "Ground beef" } })) ??
      (await prisma.resource.create({
        data: { entityId: entity.id, name: "Ground beef", unit: "lb" },
      }));

    if (pantry) {
      await prisma.inventoryItem.upsert({
        where: {
          resourceId_entityId_locationId: {
            resourceId: potatoes.id,
            entityId: entity.id,
            locationId: pantry.id,
          },
        },
        update: { quantity: 2 },
        create: {
          entityId: entity.id,
          resourceId: potatoes.id,
          locationId: pantry.id,
          quantity: 2,
        },
      });
    }

    if (fridge) {
      await prisma.inventoryItem.upsert({
        where: {
          resourceId_entityId_locationId: {
            resourceId: beef.id,
            entityId: entity.id,
            locationId: fridge.id,
          },
        },
        update: { quantity: 1 },
        create: {
          entityId: entity.id,
          resourceId: beef.id,
          locationId: fridge.id,
          quantity: 1,
        },
      });
    }

    const { start, end } = weekRange();
    const goal =
      (await prisma.goal.findFirst({
        where: { entityId: entity.id, type: "WEEKLY_MEAL_PLAN", periodStart: start },
      })) ??
      (await prisma.goal.create({
        data: {
          entityId: entity.id,
          type: "WEEKLY_MEAL_PLAN",
          state: "PENDING",
          periodStart: start,
          periodEnd: end,
          recurring: true,
        },
      }));

    const planTask =
      (await prisma.task.findFirst({
        where: { entityId: entity.id, goalId: goal.id, type: "PLAN_WEEKLY_MEALS" },
      })) ??
      (await prisma.task.create({
        data: {
          entityId: entity.id,
          goalId: goal.id,
          type: "PLAN_WEEKLY_MEALS",
          status: "PENDING",
          dueAt: end,
        },
      }));

    await prisma.taskActor.upsert({
      where: { taskId_actorId_role: { taskId: planTask.id, actorId: actor.id, role: "ACCOUNTABLE" } },
      update: {},
      create: { taskId: planTask.id, actorId: actor.id, role: "ACCOUNTABLE" },
    });

    await prisma.planning.upsert({
      where: { taskId: planTask.id },
      update: {},
      create: { entityId: entity.id, goalId: goal.id, taskId: planTask.id, config: { dinners: 7 } },
    });

    return res.json({ actor, entity, membership, goal, planTask });
  } catch (error) {
    return respondError(res, error);
  }
});

app.get("/entities/:entityId/summary", async (req, res) => {
  try {
    const [tasks, inventory, goals] = await Promise.all([
      prisma.task.findMany({
        where: { entityId: req.params.entityId },
        include: { taskActors: true },
      }),
      prisma.inventoryItem.findMany({
        where: { entityId: req.params.entityId },
        include: { resource: true, location: true },
      }),
      prisma.goal.findMany({ where: { entityId: req.params.entityId } }),
    ]);

    return res.json({ tasks, inventory, goals });
  } catch (error) {
    return respondError(res, error);
  }
});

app.listen(env.PORT, async () => {
  await ensureDefaultLenses();
  console.log(`API server running on http://localhost:${env.PORT}`);
});
