"use client";

import { useMemo, useState } from "react";
import { fetchWithAuth } from "../lib/api";
import { TaskAssign } from "./task-assign";

type Task = {
  id: string;
  type: string;
  status: string;
  tags?: string[];
  dueAt?: string;
};

export function TasksPanel({
  entityId,
  apiBase,
  getToken,
  tasks,
  actorId,
  refreshSummary,
}: {
  entityId: string;
  apiBase: string;
  getToken: () => Promise<string | null>;
  tasks: Task[];
  actorId: string;
  actorId: string;
  refreshSummary: () => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [newTaskType, setNewTaskType] = useState("CUSTOM_TASK");
  const [newTaskTag, setNewTaskTag] = useState("");
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      const hasTag = !tagFilter || (t.tags ?? []).includes(tagFilter);
      const hasStatus = !statusFilter || t.status === statusFilter;
      const mine = !mineOnly || (actorId && (t as any).taskActors?.some((a: any) => a.actorId === actorId && a.role === "RESPONSIBLE"));
      return hasTag && hasStatus && mine;
    });
  }, [tasks, statusFilter, tagFilter, mineOnly, actorId]);

  const updateStatus = async (taskId: string, status: string) => {
    if (!entityId) return;
    setLoading(true);
    const token = await getToken();
    await fetchWithAuth(
      `${apiBase}/tasks/${taskId}/status`,
      { Authorization: `Bearer ${token}` },
      { method: "POST", body: JSON.stringify({ status }), headers: { "Content-Type": "application/json" } },
    );
    await refreshSummary();
    setLoading(false);
  };

  const createTask = async () => {
    if (!entityId || !newTaskType) return;
    setLoading(true);
    const token = await getToken();
    await fetchWithAuth(
      `${apiBase}/entities/${entityId}/tasks`,
      { Authorization: `Bearer ${token}` },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newTaskType,
          tags: newTaskTag ? [newTaskTag] : [],
          assignToActor: true,
        }),
      },
    );
    await refreshSummary();
    setLoading(false);
    setNewTaskType("CUSTOM_TASK");
    setNewTaskTag("");
  };

    return (
      <div className="card">
        <h2>Tasks</h2>
        {!entityId && <p className="hint">Set an Entity ID to view tasks.</p>}
        {entityId && (
          <>
          <div className="card" style={{ marginBottom: 8 }}>
            <div className="hint">Quick create task</div>
            <div className="filters">
              <input
                className="input"
                value={newTaskType}
                onChange={(e) => setNewTaskType(e.target.value)}
                placeholder="Task type (e.g., BUY_RESOURCE)"
              />
              <input
                className="input"
                value={newTaskTag}
                onChange={(e) => setNewTaskTag(e.target.value)}
                placeholder="Tag (optional)"
              />
              <button onClick={createTask} disabled={loading}>
                Create
              </button>
            </div>
          </div>
          <div className="filters">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="DONE">Done</option>
              <option value="BLOCKED">Blocked</option>
            </select>
            <input
              className="input"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="Filter by tag"
            />
            <label className="hint" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
              My tasks only
            </label>
          </div>
          <ul className="list">
            {filtered.map((t) => (
              <li key={t.id} className="list-item">
                <div>
                  <strong>{t.type}</strong> — {t.status}
                  {t.tags && t.tags.length > 0 && <span className="pill">Tags: {t.tags.join(", ")}</span>}
                  {t.dueAt && <span className="pill">Due {new Date(t.dueAt).toLocaleDateString()}</span>}
                </div>
                <div className="actions">
                  <button onClick={() => updateStatus(t.id, "PENDING")} disabled={loading}>
                    Pending
                  </button>
                  <button onClick={() => updateStatus(t.id, "IN_PROGRESS")} disabled={loading}>
                    In Progress
                  </button>
                  <button onClick={() => updateStatus(t.id, "DONE")} disabled={loading}>
                    Done
                  </button>
                  <button onClick={() => updateStatus(t.id, "BLOCKED")} disabled={loading}>
                    Blocked
                  </button>
                </div>
                {actorId && (
                  <TaskAssign
                    taskId={t.id}
                    entityId={entityId}
                    apiBase={apiBase}
                    getToken={getToken}
                    actorId={actorId}
                    onChange={refreshSummary}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
