import React, { useEffect, useState } from "react";

export function MagicModePanel({ client }) {
  const [enabled, setEnabled] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [busy, setBusy] = useState(false);

  async function api(path, options = {}) {
    const res = await fetch(path, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function refresh() {
    const out = await api(`/api/resale/metrics?client=${encodeURIComponent(client)}`);
    setMetrics(out.metrics || null);
  }

  async function toggle(next) {
    setBusy(true);
    try {
      await api("/api/resale/magic-mode", {
        method: "POST",
        body: { client, enabled: next }
      });
      setEnabled(next);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function startMagic() {
    setBusy(true);
    try {
      await api("/api/resale/magic-start", {
        method: "POST",
        body: { client }
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, [client]);

  return (
    <section className="magic-panel">
      <header>
        <h3>Real Estate Resale - Magic Mode</h3>
        <p>Auto-handle 80-90% resale follow-ups with guardrails.</p>
      </header>
      <div className="controls">
        <button disabled={busy} onClick={() => toggle(!enabled)}>
          {enabled ? "Disable Magic Mode" : "Enable Magic Mode"}
        </button>
        <button disabled={busy} onClick={startMagic}>Queue Nurture</button>
      </div>
      {metrics && (
        <div className="kpis">
          <div><label>Re-engaged</label><strong>{metrics.contacts_reengaged}</strong></div>
          <div><label>Qualified</label><strong>{metrics.qualified_leads}</strong></div>
          <div><label>Brochure</label><strong>{metrics.brochure_requests}</strong></div>
          <div><label>Site Visit</label><strong>{metrics.site_visit_requests}</strong></div>
        </div>
      )}
    </section>
  );
}
