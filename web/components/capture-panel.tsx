"use client";

import { useState } from "react";
import { fetchWithAuth } from "../lib/api";

export function CapturePanel({
  entityId,
  apiBase,
  getToken,
  onCreated,
}: {
  entityId: string;
  apiBase: string;
  getToken: () => Promise<string | null>;
  onCreated: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const runCapture = async (lensType: "INVENTORY_LENS" | "MEAL_PLAN_LENS") => {
    if (!entityId) return;
    setLoading(true);
    setMessage("");
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const res = await fetchWithAuth(`${apiBase}/entities/${entityId}/capture/${lensType}`, headers, { method: "POST" });
    if (res?.changeSet?.id) {
      setMessage(`Created change set ${res.changeSet.id.slice(0, 6)} and question`);
      await onCreated();
    } else {
      setMessage("Capture failed");
    }
    setLoading(false);
  };

  return (
    <div className="card">
      <h2>Capture (stub)</h2>
      <p className="hint">Simulates mobile capture → lens run → changeset + review question.</p>
      <div className="actions">
        <button onClick={() => runCapture("INVENTORY_LENS")} disabled={!entityId || loading}>
          Pantry capture
        </button>
        <button onClick={() => runCapture("MEAL_PLAN_LENS")} disabled={!entityId || loading}>
          Weekly plan
        </button>
      </div>
      {message && <div className="hint">{message}</div>}
    </div>
  );
}
