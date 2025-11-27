import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
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

async function logAudit(params: {
  entityId: string;
  actorId?: string;
  subjectType: string;
  subjectId: string;
  action: string;
  payload?: any;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        entityId: params.entityId,
        actorId: params.actorId,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        action: params.action,
        payload: params.payload,
      },
    });
  } catch (err) {
    console.error("Failed to write audit log", err);
  }
}

const defaultLensTypes = [
  { type: "INVENTORY_LENS", name: "Inventory Lens" },
  { type: "MEAL_PLAN_LENS", name: "Weekly Meal Plan Lens" },
];

function requireActor(req: RequestWithContext, res: Response, next: NextFunction) {
  if (!req.actorId) {
    return res.status(401).json({ error: "Unauthorized: missing actor context" });
  }
  next();
}

async function assertMembership(entityId: string, actorId: string | undefined, roles?: string[]) {
  if (!actorId) return false;
  const membership = await prisma.entityActor.findFirst({
    where: { entityId, actorId, role: roles ? { in: roles } : undefined },
  });
  return Boolean(membership);
}

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

app.get("/me", requireActor, async (req: RequestWithContext, res) => {
  res.json({ actorId: req.actorId, entityId: req.entityId });
});

app.get("/me/entities", requireActor, async (req: RequestWithContext, res) => {
  try {
    const memberships = await prisma.entityActor.findMany({
      where: { actorId: req.actorId! },
      include: { entity: true },
      orderBy: { createdAt: "asc" },
    });
    return res.json(memberships);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/inventory/:inventoryItemId/to-buy", requireActor, async (req, res) => {
  const schema = z.object({
    quantity: z.number().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.inventoryItemId },
      include: { resource: true, location: true },
    });
    if (!item) return res.status(404).json({ error: "Inventory item not found" });
    const allowed = await assertMembership(item.entityId, (req as RequestWithContext).actorId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    const qty = parsed.data.quantity ?? 1;

    const changeSet = await prisma.changeSet.create({
      data: {
        entityId: item.entityId,
        subjectType: "INVENTORY",
        subjectId: item.id,
        type: "INVENTORY_DIFF",
        status: "PENDING",
        payload: {
          items: [
            {
              inventoryItemId: item.id,
              resourceId: item.resourceId,
              locationId: item.locationId,
              quantity: qty,
              action: "TO_BUY",
            },
          ],
        },
      },
    });

    const question = await prisma.question.create({
      data: {
        entityId: item.entityId,
        changeSetId: changeSet.id,
        subjectType: "CHANGESET",
        subjectId: changeSet.id,
        questionType: "BOOLEAN",
        prompt: item.resource ? `Create to-buy task for ${qty} x ${item.resource.name}?` : "Create to-buy task?",
        batchId: changeSet.id,
      },
    });

    await logAudit({
      entityId: item.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "CHANGESET",
      subjectId: changeSet.id,
      action: "REQUEST_TO_BUY",
      payload: { inventoryItemId: item.id, quantity: qty },
    });

    return res.json({ changeSet, question });
  } catch (error) {
    return respondError(res, error);
  }
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

app.post("/tasks/:taskId/tags", requireActor, async (req, res) => {
  const schema = z.object({
    tags: z.array(z.string()).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const task = await prisma.task.update({
      where: { id: req.params.taskId },
      data: { tags: parsed.data.tags },
    });
    await logAudit({
      entityId: task.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "TASK",
      subjectId: task.id,
      action: "UPDATE_TASK_TAGS",
      payload: { tags: parsed.data.tags },
    });
    return res.json(task);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/tasks/:taskId/assign", requireActor, async (req, res) => {
  const schema = z.object({
    actorId: z.string().uuid(),
    role: z.enum(["RESPONSIBLE", "ACCOUNTABLE"]).default("RESPONSIBLE"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!task) return res.status(404).json({ error: "Task not found" });
    const allowed = await assertMembership(task.entityId, (req as RequestWithContext).actorId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    const assignment = await prisma.taskActor.upsert({
      where: {
        taskId_actorId_role: {
          taskId: req.params.taskId,
          actorId: parsed.data.actorId,
          role: parsed.data.role,
        },
      },
      update: {},
      create: {
        taskId: req.params.taskId,
        actorId: parsed.data.actorId,
        role: parsed.data.role,
      },
    });
    await logAudit({
      entityId: task.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "TASK",
      subjectId: task.id,
      action: "ASSIGN_TASK",
      payload: { assignment },
    });
    return res.json(assignment);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/tasks/:taskId/unassign", requireActor, async (req, res) => {
  const schema = z.object({
    actorId: z.string().uuid(),
    role: z.enum(["RESPONSIBLE", "ACCOUNTABLE"]).default("RESPONSIBLE"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!task) return res.status(404).json({ error: "Task not found" });
    const allowed = await assertMembership(task.entityId, (req as RequestWithContext).actorId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    await prisma.taskActor.deleteMany({
      where: {
        taskId: req.params.taskId,
        actorId: parsed.data.actorId,
        role: parsed.data.role,
      },
    });
    await logAudit({
      entityId: task.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "TASK",
      subjectId: task.id,
      action: "UNASSIGN_TASK",
      payload: { actorId: parsed.data.actorId, role: parsed.data.role },
    });
    return res.json({ ok: true });
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/tasks", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const schema = z.object({
    type: z.string(),
    status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]).default("PENDING"),
    goalId: z.string().uuid().optional(),
    solutionId: z.string().uuid().optional(),
    stepId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    dueAt: z.string().datetime().optional(),
    startsAt: z.string().datetime().optional(),
    tags: z.array(z.string()).optional(),
    title: z.string().optional(),
    metadata: z.any().optional(),
    assignToActor: z.boolean().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const task = await prisma.task.create({
      data: {
        entityId: req.params.entityId,
        ...parsed.data,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : undefined,
      },
    });
    if (parsed.data.assignToActor) {
      await prisma.taskActor.upsert({
        where: {
          taskId_actorId_role: {
            taskId: task.id,
            actorId: (req as RequestWithContext).actorId!,
            role: "RESPONSIBLE",
          },
        },
        update: {},
        create: {
          taskId: task.id,
          actorId: (req as RequestWithContext).actorId!,
          role: "RESPONSIBLE",
        },
      });
    }
    await logAudit({
      entityId: task.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "TASK",
      subjectId: task.id,
      action: "CREATE_TASK",
    });
    return res.json(task);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities", requireActor, async (req, res) => {
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

    const adminActorId = parsed.data.adminActorId ?? (req as RequestWithContext).actorId;
    if (adminActorId) {
      await prisma.entityActor.create({
        data: {
          entityId: entity.id,
          actorId: adminActorId,
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

app.post("/entities/:entityId/actors", requireActor, async (req, res) => {
  const memberships = await prisma.entityActor.count({ where: { entityId: req.params.entityId } });
  const isAdmin = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId, ["ADMIN"]);
  // Bootstrap rule: if no memberships exist yet, allow the caller to add themselves as ADMIN.
  if (!isAdmin && !(memberships === 0 && (req as RequestWithContext).actorId === req.body.actorId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
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

app.post("/entities/:entityId/join", requireActor, async (req, res) => {
  const actorId = (req as RequestWithContext).actorId!;
  try {
    const existing = await prisma.entityActor.findFirst({
      where: { entityId: req.params.entityId, actorId },
    });
    if (existing) return res.json(existing);

    const memberships = await prisma.entityActor.count({ where: { entityId: req.params.entityId } });
    const role = memberships === 0 ? "ADMIN" : "MEMBER";

    const membership = await prisma.entityActor.create({
      data: { entityId: req.params.entityId, actorId, role },
    });

    await logAudit({
      entityId: req.params.entityId,
      actorId,
      subjectType: "ENTITY",
      subjectId: req.params.entityId,
      action: "JOIN_ENTITY",
      payload: { role },
    });

    return res.json(membership);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/locations", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId, ["ADMIN"]);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
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

app.post("/entities/:entityId/resources", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId, ["ADMIN"]);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
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

app.post("/entities/:entityId/inventory", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
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

app.post("/entities/:entityId/goals/weekly-plan", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId, ["ADMIN"]);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
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

app.post("/entities/:entityId/tracks", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
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

app.post("/entities/:entityId/capture/:lensType", requireActor, async (req, res) => {
  const lensType = req.params.lensType.toUpperCase();
  if (!["INVENTORY_LENS", "MEAL_PLAN_LENS"].includes(lensType)) {
    return res.status(400).json({ error: "Unsupported lens type" });
  }
  try {
    const actorId = (req as RequestWithContext).actorId!;
    await ensureDefaultSensors(req.params.entityId);
    await ensureDefaultLenses();

    const sensor = await prisma.sensor.findFirst({
      where: { entityId: req.params.entityId, type: "MOBILE_CAMERA" },
    });
    if (!sensor) return res.status(400).json({ error: "Sensor type not found for entity" });

    const track = await prisma.track.create({
      data: {
        entityId: req.params.entityId,
        actorId,
        sensorId: sensor.id,
        mediaUrl: "https://example.com/pantry.jpg",
        telemetry: { stub: true },
      },
    });
    const lens = await prisma.lens.findFirst({ where: { type: lensType } });
    if (!lens) return res.status(400).json({ error: "Lens not found" });
    const lensRun = await prisma.lensRun.create({
      data: {
        trackId: track.id,
        lensId: lens.id,
        analystType: "AI",
        status: "PENDING",
      },
    });

    const result = await processLensRun(lensRun.id, actorId);
    return res.json(result);
  } catch (error) {
    return respondError(res, error);
  }
});

app.get("/entities/:entityId/tasks", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const schema = z.object({
    type: z.string().optional(),
    actorId: z.string().uuid().optional(),
    status: z.string().optional(),
    tag: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const tasks = await prisma.task.findMany({
      where: {
        entityId: req.params.entityId,
        type: parsed.data.type,
        status: parsed.data.status,
        tags: parsed.data.tag ? { has: parsed.data.tag } : undefined,
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

app.post("/tasks/:taskId/status", requireActor, async (req, res) => {
  const schema = z.object({
    status: z.enum(["PENDING", "IN_PROGRESS", "DONE", "BLOCKED"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  try {
    const existing = await prisma.task.findUnique({ where: { id: req.params.taskId } });
    if (!existing) return res.status(404).json({ error: "Task not found" });

    const updated = await prisma.task.update({
      where: { id: req.params.taskId },
      data: { status: parsed.data.status },
    });

    // If marking a BUY_RESOURCE task as DONE for the first time, increment inventory
    if (
      existing.type === "BUY_RESOURCE" &&
      existing.status !== "DONE" &&
      parsed.data.status === "DONE" &&
      existing.metadata &&
      typeof existing.metadata === "object" &&
      "inventoryItemId" in (existing.metadata as any)
    ) {
      const meta: any = existing.metadata;
      const qty = typeof meta.quantity === "number" ? meta.quantity : 1;
      if (meta.inventoryItemId) {
        await prisma.inventoryItem.upsert({
          where: { id: meta.inventoryItemId },
          update: {
            quantity: { increment: qty },
          },
          create: {
            id: meta.inventoryItemId,
            entityId: existing.entityId,
            resourceId: meta.resourceId ?? undefined,
            locationId: meta.locationId ?? undefined,
            quantity: qty,
          },
        });
      }
    }
    await logAudit({
      entityId: updated.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "TASK",
      subjectId: updated.id,
      action: "UPDATE_TASK_STATUS",
      payload: { status: parsed.data.status },
    });
    return res.json(updated);
  } catch (error) {
    return respondError(res, error);
  }
});

app.get("/entities/:entityId/lens-runs", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  try {
    const lensRuns = await prisma.lensRun.findMany({
      where: { track: { entityId: req.params.entityId } },
      include: { lens: true, track: true },
      orderBy: [{ createdAt: "desc" }],
    });
    return res.json(lensRuns);
  } catch (error) {
    return respondError(res, error);
  }
});

app.get("/entities/:entityId/questions", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  try {
    const questions = await prisma.question.findMany({
      where: { entityId: req.params.entityId },
      include: { answers: true, changeSet: true },
      orderBy: [{ createdAt: "desc" }],
    });
    return res.json(questions);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/questions", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId, ["ADMIN"]);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const schema = z.object({
    taskId: z.string().uuid().optional(),
    goalId: z.string().uuid().optional(),
    changeSetId: z.string().uuid().optional(),
    subjectType: z.string(),
    subjectId: z.string().uuid(),
    questionType: z.string(),
    config: z.any().optional(),
    batchId: z.string().optional(),
    prompt: z.string(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const question = await prisma.question.create({
      data: {
        entityId: req.params.entityId,
        ...parsed.data,
      },
    });
    return res.json(question);
  } catch (error) {
    return respondError(res, error);
  }
});

async function buildInventoryDiffPayload(entityId: string) {
  const [resource] = await prisma.resource.findMany({ where: { entityId }, take: 1 });
  const [location] = await prisma.location.findMany({ where: { entityId }, take: 1 });
  const items =
    resource && location
      ? [
          {
            resourceId: resource.id,
            locationId: location.id,
            quantity: 1,
          },
        ]
      : [];
  return { items, note: "Stub inventory diff generated by analyst" };
}

async function buildWeeklyPlanPayload(entityId: string, goalId?: string) {
  const tasks = [
    {
      goalId,
      type: "BUY_RESOURCE",
      status: "PENDING",
      dueAt: new Date(),
    },
    {
      goalId,
      type: "COOK_RECIPE_STEP",
      status: "PENDING",
      dueAt: new Date(),
    },
  ];
  return { tasks, note: "Stub weekly plan generated by analyst" };
}

async function processLensRun(lensRunId: string, actorId?: string) {
  const lensRun = await prisma.lensRun.findUnique({
    where: { id: lensRunId },
    include: { lens: true, track: true },
  });
  if (!lensRun) throw new Error("LensRun not found");
  const entityId = lensRun.track.entityId;

  let payload: any = {};
  let changeSetType = "INVENTORY_DIFF";
  if (lensRun.lens.type === "MEAL_PLAN_LENS") {
    payload = await buildWeeklyPlanPayload(entityId);
    changeSetType = "WEEKLY_MEAL_PLAN";
  } else {
    payload = await buildInventoryDiffPayload(entityId);
    changeSetType = "INVENTORY_DIFF";
  }

  const changeSet = await prisma.changeSet.create({
    data: {
      entityId,
      taskId: null,
      trackId: lensRun.trackId,
      subjectType: "TRACK",
      subjectId: lensRun.trackId,
      type: changeSetType,
      payload,
      status: "PENDING",
    },
  });

  const question = await prisma.question.create({
    data: {
      entityId,
      changeSetId: changeSet.id,
      subjectType: "CHANGESET",
      subjectId: changeSet.id,
      questionType: "BOOLEAN",
      prompt: changeSetType === "INVENTORY_DIFF" ? "Apply inventory updates?" : "Approve weekly meal plan?",
      batchId: changeSet.id,
    },
  });

  const updatedRun = await prisma.lensRun.update({
    where: { id: lensRun.id },
    data: {
      status: "COMPLETED",
      rawOutput: payload,
    },
  });

  await logAudit({
    entityId,
    actorId,
    subjectType: "CHANGESET",
    subjectId: changeSet.id,
    action: "CREATE_CHANGESET_FROM_LENS_RUN",
    payload,
  });

  return { lensRun: updatedRun, changeSet, question };
}

app.post("/lens-runs/:lensRunId/process", requireActor, async (req, res) => {
  try {
    const lensRun = await prisma.lensRun.findUnique({
      where: { id: req.params.lensRunId },
      include: { lens: true, track: true },
    });
    if (!lensRun) return res.status(404).json({ error: "LensRun not found" });
    const entityId = lensRun.track.entityId;
    const allowed = await assertMembership(entityId, (req as RequestWithContext).actorId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    const result = await processLensRun(req.params.lensRunId, (req as RequestWithContext).actorId);
    return res.json(result);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/questions/:questionId/answer", requireActor, async (req, res) => {
  const schema = z.object({
    taskId: z.string().uuid(),
    value: z.any(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const question = await prisma.question.findUnique({ where: { id: req.params.questionId } });
    if (!question) return res.status(404).json({ error: "Question not found" });
    const allowed = await assertMembership(question.entityId, (req as RequestWithContext).actorId);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    const answer = await prisma.answer.create({
      data: {
        questionId: req.params.questionId,
        taskId: parsed.data.taskId,
        value: parsed.data.value,
      },
    });
    await logAudit({
      entityId: question.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "QUESTION",
      subjectId: question.id,
      action: "ANSWER_QUESTION",
    });
    return res.json(answer);
  } catch (error) {
    return respondError(res, error);
  }
});

app.get("/entities/:entityId/changesets", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const schema = z.object({
    type: z.string().optional(),
    status: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const changeSets = await prisma.changeSet.findMany({
      where: { entityId: req.params.entityId, type: parsed.data.type, status: parsed.data.status },
      include: { questions: true, task: true, track: true },
      orderBy: [{ createdAt: "desc" }],
    });
    return res.json(changeSets);
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/entities/:entityId/changesets", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId, ["ADMIN"]);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const schema = z.object({
    taskId: z.string().uuid().optional(),
    trackId: z.string().uuid().optional(),
    subjectType: z.string(),
    subjectId: z.string().uuid(),
    type: z.string(),
    payload: z.any(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const changeSet = await prisma.changeSet.create({
      data: {
        entityId: req.params.entityId,
        status: "PENDING",
        ...parsed.data,
      },
    });
    await logAudit({
      entityId: req.params.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "CHANGESET",
      subjectId: changeSet.id,
      action: "CREATE_CHANGESET",
    });
    return res.json(changeSet);
  } catch (error) {
    return respondError(res, error);
  }
});

async function applyInventoryDiff(entityId: string, payload: any) {
  const items: any[] = payload?.items ?? [];
  const results = [];
  for (const item of items) {
    if (!item.resourceId || !item.locationId) continue;
    if (item.action === "TO_BUY") {
      const resource = await prisma.resource.findUnique({ where: { id: item.resourceId } });
      const task = await prisma.task.create({
        data: {
          entityId,
          type: "BUY_RESOURCE",
          status: "PENDING",
          locationId: item.locationId,
          title: resource ? `Buy ${resource.name}` : "Buy resource",
          metadata: {
            inventoryItemId: item.inventoryItemId,
            resourceId: item.resourceId,
            locationId: item.locationId,
            quantity: item.quantity ?? 1,
          },
          tags: ["to-buy"],
        },
      });
      results.push({ taskId: task.id, action: "to-buy" });
      continue;
    }
    if (item.action === "DELETE" || (typeof item.quantity === "number" && item.quantity <= 0)) {
      await prisma.inventoryItem.deleteMany({
        where: {
          entityId,
          resourceId: item.resourceId,
          locationId: item.locationId,
        },
      });
      results.push({ resourceId: item.resourceId, locationId: item.locationId, action: "deleted" });
      continue;
    }
    const updated = await prisma.inventoryItem.upsert({
      where: {
        resourceId_entityId_locationId: {
          resourceId: item.resourceId,
          entityId,
          locationId: item.locationId,
        },
      },
      update: {
        quantity: item.quantity,
        expiresAt: item.expiresAt ? new Date(item.expiresAt) : undefined,
      },
      create: {
        entityId,
        resourceId: item.resourceId,
        locationId: item.locationId,
        quantity: item.quantity ?? 0,
        expiresAt: item.expiresAt ? new Date(item.expiresAt) : undefined,
      },
    });
    results.push(updated);
  }
  return results;
}

async function applyWeeklyPlan(entityId: string, payload: any) {
  const tasks: any[] = payload?.tasks ?? [];
  const createdTasks = [];
  for (const t of tasks) {
    const created = await prisma.task.create({
      data: {
        entityId,
        goalId: t.goalId,
        solutionId: t.solutionId,
        stepId: t.stepId,
        type: t.type ?? "BUY_RESOURCE",
        status: t.status ?? "PENDING",
        dueAt: t.dueAt ? new Date(t.dueAt) : undefined,
        startsAt: t.startsAt ? new Date(t.startsAt) : undefined,
      },
    });
    createdTasks.push(created);
  }
  return createdTasks;
}

app.post("/changesets/:changeSetId/apply", requireActor, async (req, res) => {
  try {
    const changeSet = await prisma.changeSet.findUnique({ where: { id: req.params.changeSetId } });
    if (!changeSet) return res.status(404).json({ error: "ChangeSet not found" });
    const allowed = await assertMembership(changeSet.entityId, (req as RequestWithContext).actorId, ["ADMIN"]);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    if (changeSet.status !== "APPROVED") {
      return res.status(409).json({ error: "ChangeSet must be APPROVED before apply" });
    }

    let result: any = {};
    if (changeSet.type === "INVENTORY_DIFF") {
      result = { inventory: await applyInventoryDiff(changeSet.entityId, changeSet.payload) };
    } else if (changeSet.type === "WEEKLY_MEAL_PLAN") {
      result = { tasks: await applyWeeklyPlan(changeSet.entityId, changeSet.payload) };
    } else {
      result = { message: "No apply handler for this change set type" };
    }

    await prisma.task.create({
      data: {
        entityId: changeSet.entityId,
        type: "APPLY_CHANGESET",
        status: "DONE",
        changeSets: { connect: { id: changeSet.id } },
      },
    });

    const updated = await prisma.changeSet.update({
      where: { id: changeSet.id },
      data: { status: "APPLIED", appliedAt: new Date() },
    });

    await logAudit({
      entityId: changeSet.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "CHANGESET",
      subjectId: changeSet.id,
      action: "APPLY_CHANGESET",
      payload: { result },
    });

    return res.json({ changeSetId: changeSet.id, applied: true, result, changeSet: updated });
  } catch (error) {
    return respondError(res, error);
  }
});

app.post("/changesets/:changeSetId/approve", requireActor, async (req, res) => {
  try {
    const changeSet = await prisma.changeSet.findUnique({ where: { id: req.params.changeSetId } });
    if (!changeSet) return res.status(404).json({ error: "ChangeSet not found" });
    const allowed = await assertMembership(changeSet.entityId, (req as RequestWithContext).actorId, ["ADMIN"]);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });
    if (changeSet.status === "APPLIED") {
      return res.status(409).json({ error: "Already applied" });
    }
    const updated = await prisma.changeSet.update({
      where: { id: changeSet.id },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
    await logAudit({
      entityId: changeSet.entityId,
      actorId: (req as RequestWithContext).actorId,
      subjectType: "CHANGESET",
      subjectId: changeSet.id,
      action: "APPROVE_CHANGESET",
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

app.get("/entities/:entityId/summary", requireActor, async (req, res) => {
  const allowed = await assertMembership(req.params.entityId, (req as RequestWithContext).actorId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
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
