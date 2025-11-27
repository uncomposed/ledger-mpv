export async function fetchWithAuth(url: string, headers: Record<string, string>, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), ...headers } });
  if (!res.ok) {
    console.error("Request failed", res.status, await res.text());
    return null;
  }
  return res.json();
}
