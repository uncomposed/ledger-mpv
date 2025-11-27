"use client";

import { useEffect, useState } from "react";

export function AIKeyPanel() {
  const [key, setKey] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem("aiApiKey");
    if (stored) setKey(stored);
  }, []);

  return (
    <div className="card">
      <h2>AI API Key</h2>
      <p className="hint">Stored client-side; sent only when triggering analyst jobs.</p>
      <input
        type="password"
        className="input"
        placeholder="sk-..."
        value={key}
        onChange={(e) => {
          setKey(e.target.value);
          window.localStorage.setItem("aiApiKey", e.target.value);
        }}
      />
    </div>
  );
}
