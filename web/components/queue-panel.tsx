"use client";

import { fetchWithAuth } from "../lib/api";

type Question = {
  id: string;
  prompt: string;
  batchId?: string | null;
  createdAt?: string;
  changeSetId?: string | null;
  changeSet?: any;
};

function renderChangeSet(changeSet?: any) {
  if (!changeSet) return null;
  if (changeSet.type === "INVENTORY_DIFF") {
    const items = changeSet.payload?.items ?? [];
    return (
      <div className="hint">
        Inventory changes:
        <ul className="list">
          {items.map((i: any, idx: number) => (
            <li key={idx} className="list-item">
              {i.action === "TO_BUY" ? "To buy" : "Update"} — resource {i.resourceId?.slice(0, 6) ?? "?"} @ location{" "}
              {i.locationId?.slice(0, 6) ?? "?"} qty {i.quantity ?? "?"}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (changeSet.type === "WEEKLY_MEAL_PLAN") {
    const tasks = changeSet.payload?.tasks ?? [];
    return (
      <div className="hint">
        Plan tasks:
        <ul className="list">
          {tasks.map((t: any, idx: number) => (
            <li key={idx} className="list-item">
              {t.type} {t.dueAt ? `due ${new Date(t.dueAt).toLocaleDateString()}` : ""}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return <pre className="hint">{JSON.stringify(changeSet.payload, null, 2)}</pre>;
}

export function QueuePanel({
  questions,
  apiBase,
  getToken,
  refresh,
}: {
  questions: Question[];
  apiBase: string;
  getToken: () => Promise<string | null>;
  refresh: () => Promise<void>;
}) {
  const grouped = questions.reduce<Record<string, Question[]>>((acc, q) => {
    const key = q.batchId ?? q.id;
    acc[key] = acc[key] ? [...acc[key], q] : [q];
    return acc;
  }, {});

  const approve = async (changeSetId: string) => {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };
    await fetchWithAuth(`${apiBase}/changesets/${changeSetId}/approve`, headers, { method: "POST" });
    await refresh();
  };
  const apply = async (changeSetId: string) => {
    const token = await getToken();
    const headers = { Authorization: `Bearer ${token}` };
    await fetchWithAuth(`${apiBase}/changesets/${changeSetId}/apply`, headers, { method: "POST" });
    await refresh();
  };

  return (
    <div className="card">
      <h2>Queue</h2>
      {questions.length === 0 && <p className="hint">No pending questions.</p>}
      {Object.entries(grouped).map(([batchId, qs]) => {
        const cs = qs[0].changeSet;
        return (
          <div key={batchId} className="card" style={{ marginBottom: 8 }}>
            <div className="hint">Batch {batchId.slice(0, 6)}</div>
            {qs.map((q) => (
              <div key={q.id} style={{ marginBottom: 6 }}>
                <strong>{q.prompt}</strong>
                {q.createdAt && <div className="hint">Created {new Date(q.createdAt).toLocaleString()}</div>}
              </div>
            ))}
            {renderChangeSet(cs)}
            {cs?.id && (
              <div className="actions" style={{ marginTop: 6 }}>
                <button onClick={() => approve(cs.id)}>Approve</button>
                <button onClick={() => apply(cs.id)}>Apply</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
