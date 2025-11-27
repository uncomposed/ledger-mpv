"use client";

type Question = {
  id: string;
  prompt: string;
  batchId?: string | null;
  createdAt?: string;
};

export function QueuePanel({ questions }: { questions: Question[] }) {
  return (
    <div className="card">
      <h2>Queue</h2>
      {questions.length === 0 && <p className="hint">No pending questions.</p>}
      <ul className="list">
        {questions.map((q) => (
          <li key={q.id} className="list-item">
            <div>
              <strong>{q.prompt}</strong>
              {q.batchId && <span className="pill">Batch {q.batchId.slice(0, 6)}</span>}
            </div>
            {q.createdAt && <div className="hint">Created {new Date(q.createdAt).toLocaleString()}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
