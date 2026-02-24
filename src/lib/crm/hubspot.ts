// @ts-nocheck
const axios = require("axios");

function splitName(name) {
  const t = String(name || "").trim().replace(/\s+/g, " ");
  if (!t) return { firstname: null, lastname: null };
  const parts = t.split(" ");
  if (parts.length === 1) return { firstname: parts[0], lastname: "." };
  return { firstname: parts.slice(0, -1).join(" "), lastname: parts[parts.length - 1] };
}

async function hubspotSearchByPhone({ accessToken, phone }) {
  const url = "https://api.hubapi.com/crm/v3/objects/contacts/search";
  const res = await axios.post(
    url,
    {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "phone",
              operator: "EQ",
              value: String(phone)
            }
          ]
        }
      ],
      properties: ["phone", "firstname", "lastname"],
      limit: 1
    },
    {
      timeout: 20_000,
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );
  const results = res.data?.results || [];
  return results[0] || null;
}

async function hubspotUpsertContact({ accessToken, lead }) {
  if (!accessToken) throw new Error("Missing HubSpot access token.");
  const phone = lead?.phone || lead?.from;
  if (!phone) throw new Error("Missing lead phone.");

  const { firstname, lastname } = splitName(lead?.name);
  const properties = {
    phone: String(phone),
    ...(firstname ? { firstname } : {}),
    ...(lastname ? { lastname } : {})
  };

  const existing = await hubspotSearchByPhone({ accessToken, phone: String(phone) });
  if (existing?.id) {
    const url = `https://api.hubapi.com/crm/v3/objects/contacts/${existing.id}`;
    const res = await axios.patch(
      url,
      { properties },
      { timeout: 20_000, headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return { action: "updated", id: existing.id, data: res.data };
  }

  const url = "https://api.hubapi.com/crm/v3/objects/contacts";
  const res = await axios.post(
    url,
    { properties },
    { timeout: 20_000, headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return { action: "created", id: res.data?.id || null, data: res.data };
}

module.exports = { hubspotUpsertContact };

