"use client";

type Summary = {
  tasks: any[];
  inventory: any[];
  goals: any[];
};

export function SummaryPanel({
  summary,
  loading,
  onCreateToBuy,
}: {
  summary: Summary;
  loading: boolean;
  onCreateToBuy: (inventoryItemId: string, quantity: number) => Promise<void>;
}) {
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
                <div className="actions">
                  <button
                    onClick={() => {
                      const qtyInput = window.prompt("Quantity to buy?", "1");
                      const qty = qtyInput ? parseFloat(qtyInput) : 1;
                      if (Number.isNaN(qty)) return;
                      onCreateToBuy(item.id, qty);
                    }}
                  >
                    Add To-Buy Task
                  </button>
                </div>
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
