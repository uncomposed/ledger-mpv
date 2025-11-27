"use client";

type Summary = {
  tasks: any[];
  inventory: any[];
  goals: any[];
};

export function SummaryPanel({ summary, loading }: { summary: Summary; loading: boolean }) {
  return (
    <div className="card">
      <h2>Summary</h2>
      {loading && <p className="hint">Loading…</p>}
      <div className="columns">
        <div>
          <strong>Inventory</strong>
          <ul className="list">
            {summary.inventory?.map((item: any) => (
              <li key={item.id} className="list-item">
                {item.resource?.name ?? "Item"} — qty {item.quantity} ({item.location?.name ?? "Unknown"})
              </li>
            ))}
          </ul>
        </div>
        <div>
          <strong>Goals</strong>
          <ul className="list">
            {summary.goals?.map((g: any) => (
              <li key={g.id} className="list-item">
                {g.type} — {g.state}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
