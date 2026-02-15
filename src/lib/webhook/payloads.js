function sampleTextInbound({ from = "919999999999", toPhoneNumberId = "PHONE_NUMBER_ID", body = "Hi, price please" } = {}) {
  // Minimal-ish payload shape for local testing.
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: toPhoneNumberId },
              contacts: [{ wa_id: from, profile: { name: "Test Lead" } }],
              messages: [
                {
                  from,
                  id: "wamid.TEST",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body }
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

module.exports = { sampleTextInbound };

