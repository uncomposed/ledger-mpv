"use client";

import { fetchWithAuth } from "../lib/api";

export function TaskAssign({
  taskId,
  entityId,
  apiBase,
  getToken,
  actorId,
  onChange,
}: {
  taskId: string;
  entityId: string;
  apiBase: string;
  getToken: () => Promise<string | null>;
  actorId: string;
  onChange: () => Promise<void>;
}) {
  const assignToMe = async () => {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    await fetchWithAuth(
      `${apiBase}/tasks/${taskId}/assign`,
      headers,
      { method: "POST", body: JSON.stringify({ actorId, role: "RESPONSIBLE" }) },
    );
    await onChange();
  };

  const unassignMe = async () => {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    await fetchWithAuth(
      `${apiBase}/tasks/${taskId}/unassign`,
      headers,
      { method: "POST", body: JSON.stringify({ actorId, role: "RESPONSIBLE" }) },
    );
    await onChange();
  };

  return (
    <div className="actions" style={{ marginTop: 4 }}>
      <button onClick={assignToMe}>Assign to me</button>
      <button onClick={unassignMe}>Unassign</button>
    </div>
  );
}
