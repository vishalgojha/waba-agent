# HANDOFF QUICK

## Repo
- `waba-agent` (branch: `main`)
- Primary file changed: `public/waba-gateway-ui.html`

## What changed
- Gateway token shortcut now targets: `https://business.facebook.com/latest/settings/system_users`
- AI fallback commands improved in `src/lib/chat/agent.js`
  - `whoami`, `show templates`, `show memory`, `send welcome text to +<number>`
- Chat/UI reliability fixes: scroll visibility, null-ID crashes, dark toggle wiring.
- Redesign merge backup: `public/waba-gateway-ui.pre-redesign.backup.html`

## Tests (latest)
- `npm run test:gateway` ?
- `npm run test:chat` ?

## Known caveats
- Meta may still redirect based on account/business context.
- If chat says "AI parsing issue", runtime model endpoint is not available to current gateway process.

## Next agent first steps
1. Run gateway:
   - `npm start -- gw -c acme-realty --port 3011`
2. Hard refresh browser (`Ctrl+F5`).
3. Validate chat commands:
   - `whoami`
   - `show templates`
   - `show memory`
   - `send welcome text to +919812345678`
4. Validate token button landing path.

## Working tree note
- Repo has unrelated modified/untracked files; separate intentional changes before commit.
