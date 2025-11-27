"use client";

import { useMemo, useState } from "react";
import { fetchWithAuth } from "../lib/api";

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
  refreshSummary,
}: {
  entityId: string;
  apiBase: string;
  getToken: () => Promise<string | null>;
  tasks: Task[];
  refreshSummary: () => Promise<void>;
}) {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      return (!statusFilter || t.status === statusFilter) && (!tagFilter || (t.tags ?? []).includes(tagFilter));
    });
  }, [tasks, statusFilter, tagFilter]);

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

  return (
    <div className="card">
      <h2>Tasks</h2>
      {!entityId && <p className="hint">Set an Entity ID to view tasks.</p>}
      {entityId && (
        <>
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
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
