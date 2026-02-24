// @ts-nocheck
function extractChanges(payload) {
  const out = [];
  const entries = payload?.entry || [];
  for (const e of entries) {
    for (const c of e?.changes || []) out.push(c);
  }
  return out;
}

function extractMessages(payload) {
  const msgs = [];
  for (const c of extractChanges(payload)) {
    const value = c?.value;
    const arr = value?.messages || [];
    for (const m of arr) {
      msgs.push({
        from: m.from,
        id: m.id,
        timestamp: m.timestamp,
        type: m.type,
        text: m.text?.body,
        image: m.image,
        audio: m.audio,
        interactive: m.interactive,
        context: m.context
      });
    }
  }
  return msgs;
}

function extractStatuses(payload) {
  const sts = [];
  for (const c of extractChanges(payload)) {
    const value = c?.value;
    const arr = value?.statuses || [];
    for (const s of arr) {
      sts.push({
        id: s.id,
        status: s.status,
        timestamp: s.timestamp,
        recipient_id: s.recipient_id,
        errors: s.errors
      });
    }
  }
  return sts;
}

module.exports = { extractMessages, extractStatuses };

