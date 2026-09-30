"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/client";

type Key = { id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null };
export function IntegrationsSection() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [label, setLabel] = useState("Home Assistant");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    apiFetch<{ user: { role: string } | null }>("/api/auth/session").then(async session => {
      if (session.user?.role !== "ADMIN") return;
      setAdmin(true);
      setKeys((await apiFetch<{ keys: Key[] }>("/api/settings/api-keys")).keys);
    }).catch(err => setError(err.message));
  }, []);
  async function create() {
    setBusy(true); setError(""); setToken(null);
    try {
      const result = await apiFetch<{ token: string }>("/api/settings/api-keys", { method: "POST", body: JSON.stringify({ label }) });
      setToken(result.token);
      setKeys((await apiFetch<{ keys: Key[] }>("/api/settings/api-keys")).keys);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create key"); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError("");
    try {
      await apiFetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
      setToken(null);
      setKeys((await apiFetch<{ keys: Key[] }>("/api/settings/api-keys")).keys);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not revoke key"); }
    finally { setBusy(false); }
  }
  if (!admin) return null;
  return <section className="card">
    <h2>Home Assistant &amp; Jarvis</h2>
    <p>Create a separate read-only key for each connection. Keys can read this household’s calendar, but cannot change shifts or appointments.</p>
    <label>Connection name <input value={label} maxLength={80} onChange={e => setLabel(e.target.value)} /></label>{" "}
    <button className="btn btn-secondary" type="button" disabled={busy || !label.trim()} onClick={create}>Create read-only key</button>
    {error && <p role="alert">{error}</p>}
    {token && <div role="status"><p>Save this key now. It is shown only once.</p>
      <textarea aria-label="New integration key" readOnly value={token} rows={2} style={{ width: "100%" }} />
      <button className="btn btn-secondary" type="button" onClick={() => setToken(null)}>Hide key</button>
    </div>}
    <p>JSON summary: <code>/api/integrations/summary</code><br />Calendar feed: <code>/api/integrations/calendar.ics</code></p>
    <p>Home Assistant Remote Calendar: username <code>our-days</code>, password is the key. Add <code>?kind=events</code>, <code>?kind=shifts</code> or <code>?kind=together</code> for separate calendars.</p>
    <ul>{keys.map(key => <li key={key.id}><strong>{key.label}</strong> — {key.revokedAt ? "Revoked" : `Last used: ${key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never"}`} { !key.revokedAt && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => revoke(key.id)}>Revoke</button>}</li>)}</ul>
  </section>;
}
