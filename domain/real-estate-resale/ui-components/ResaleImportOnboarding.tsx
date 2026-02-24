// @ts-nocheck
import React, { useState } from "react";

export function ResaleImportOnboarding({ client, onDone }) {
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function importNow() {
    setBusy(true);
    try {
      const res = await fetch("/api/resale/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client,
          csv: csvText,
          queueMagic: true
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      setResult(out);
      onDone?.(out);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="resale-import-onboarding">
      <h3>Import Resale Leads</h3>
      <p>Paste CSV with: name,phone,last_message_date,property_interested,notes</p>
      <textarea
        rows={8}
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        placeholder={"name,phone,last_message_date,property_interested,notes\nVishal,+9198...,2026-02-01,2 BHK Wakad,Asked for brochure"}
      />
      <button disabled={busy || !csvText.trim()} onClick={importNow}>
        {busy ? "Importing..." : "Import + Start Magic"}
      </button>
      {result && (
        <div className="import-result">
          <strong>{result.imported}</strong> imported, <strong>{result.total}</strong> total leads.
          {result.queued ? ` Queued ${result.queued.queued} nurture actions.` : ""}
        </div>
      )}
    </div>
  );
}
