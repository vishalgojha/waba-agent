function toGraphError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const e = data?.error || {};

  const details = {
    status,
    message: e.message || err?.message || "Graph API error",
    type: e.type,
    code: e.code,
    subcode: e.error_subcode,
    fbtrace_id: e.fbtrace_id
  };

  const hint = (() => {
    if (status === 401 || status === 403) {
      return "Auth failed. Check permanent token + app permissions (whatsapp_business_messaging, whatsapp_business_management).";
    }
    if (status === 400 && details.code === 100) {
      return "Bad request. Often wrong IDs (phone number ID / WABA ID) or template name/language mismatch.";
    }
    if (status === 429) return "Rate limited. Backoff and try again later.";
    return null;
  })();

  return { details, hint };
}

module.exports = { toGraphError };

