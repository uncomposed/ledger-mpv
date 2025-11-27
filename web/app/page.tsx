"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { fetchWithAuth } from "../lib/api";
import { AIKeyPanel } from "../components/ai-key-panel";
import { TasksPanel } from "../components/tasks-panel";
import { QueuePanel } from "../components/queue-panel";
import { SummaryPanel } from "../components/summary-panel";

type Summary = {
  tasks: any[];
  inventory: any[];
  goals: any[];
};

export default function Home() {
  const { getToken, isSignedIn } = useAuth();
  const [entityId, setEntityId] = useState<string>("");
  const [summary, setSummary] = useState<Summary>({ tasks: [], inventory: [], goals: [] });
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const apiBase = useMemo(() => process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000", []);

  useEffect(() => {
    if (!isSignedIn) return;
    // For MVP, let user paste entityId once; could be improved with list endpoint
    const storedEntity = window.localStorage.getItem("entityId");
    if (storedEntity) setEntityId(storedEntity);
  }, [isSignedIn]);

  useEffect(() => {
    if (!entityId || !isSignedIn) return;
    const load = async () => {
      setLoading(true);
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };
      try {
        const [summaryRes, questionsRes] = await Promise.all([
          fetchWithAuth(`${apiBase}/entities/${entityId}/summary`, headers),
          fetchWithAuth(`${apiBase}/entities/${entityId}/questions`, headers),
        ]);
        setSummary(summaryRes ?? { tasks: [], inventory: [], goals: [] });
        setQuestions(questionsRes ?? []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [entityId, apiBase, getToken, isSignedIn]);

  if (!isSignedIn) {
    return <div className="card">Sign in to view your household.</div>;
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Entity</h2>
        <p className="hint">Paste your Entity ID from backend responses (e.g., /seed/demo)</p>
        <input
          value={entityId}
          onChange={(e) => {
            setEntityId(e.target.value);
            window.localStorage.setItem("entityId", e.target.value);
          }}
          placeholder="Entity ID"
          className="input"
        />
      </div>

      <AIKeyPanel />

      <SummaryPanel summary={summary} loading={loading} />

      <TasksPanel
        entityId={entityId}
        apiBase={apiBase}
        getToken={getToken}
        tasks={summary.tasks}
        refreshSummary={async () => {
          const token = await getToken();
          const headers = { Authorization: `Bearer ${token}` };
          const nextSummary = await fetchWithAuth(`${apiBase}/entities/${entityId}/summary`, headers);
          setSummary(nextSummary ?? { tasks: [], inventory: [], goals: [] });
        }}
      />

      <QueuePanel questions={questions} />
    </div>
  );
}
