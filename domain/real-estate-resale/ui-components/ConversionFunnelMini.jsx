import React from "react";

export function ConversionFunnelMini({ funnel }) {
  const data = funnel || {};
  const rows = [
    { key: "imported", label: "Imported" },
    { key: "messaged", label: "Messaged" },
    { key: "reengaged", label: "Re-engaged" },
    { key: "qualified", label: "Qualified" },
    { key: "site_visit_or_brochure", label: "Visit/Brochure" }
  ];
  const max = Math.max(1, ...rows.map((r) => Number(data[r.key] || 0)));

  return (
    <div className="funnel-mini">
      <h4>First 48h Funnel</h4>
      {rows.map((r) => {
        const value = Number(data[r.key] || 0);
        const width = `${Math.max(8, Math.round((value / max) * 100))}%`;
        return (
          <div key={r.key} className="funnel-row">
            <span>{r.label}</span>
            <div className="bar-wrap">
              <div className="bar" style={{ width }} />
            </div>
            <strong>{value}</strong>
          </div>
        );
      })}
    </div>
  );
}
