const axios = require("axios");

function zohoBaseUrl(dc = "in") {
  const x = String(dc || "in").toLowerCase();
  if (x === "com") return "https://www.zohoapis.com";
  if (x === "eu") return "https://www.zohoapis.eu";
  if (x === "au") return "https://www.zohoapis.com.au";
  if (x === "jp") return "https://www.zohoapis.jp";
  if (x === "in") return "https://www.zohoapis.in";
  return "https://www.zohoapis.in";
}

function pickLastName(name, fallback) {
  const t = String(name || "").trim();
  if (t) return t;
  return fallback || "WhatsApp";
}

async function zohoCreateLead({ accessToken, dc = "in", module = "Leads", lead }) {
  if (!accessToken) throw new Error("Missing Zoho access token.");
  const base = zohoBaseUrl(dc);
  const url = `${base}/crm/v2/${module}`;

  const phone = lead?.phone || lead?.from || "";
  const lastName = pickLastName(lead?.name, phone || "WhatsApp");
  const data = {
    Last_Name: lastName,
    Company: lead?.company || "WhatsApp",
    Phone: phone ? String(phone) : undefined,
    Description: lead?.text ? String(lead.text).slice(0, 1000) : undefined
  };

  // Remove undefined keys to avoid Zoho validation issues.
  for (const k of Object.keys(data)) {
    if (data[k] === undefined) delete data[k];
  }

  const res = await axios.post(
    url,
    { data: [data] },
    {
      timeout: 20_000,
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }
    }
  );

  const first = res.data?.data?.[0] || null;
  return { action: "created", data: res.data, record: first };
}

module.exports = { zohoCreateLead, zohoBaseUrl };

