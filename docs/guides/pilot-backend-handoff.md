# Pilot backend handoff — 7 October 2026

Backend-only draft PRs:

- Web: https://github.com/parashrautela/workflow-managment-/pull/5
- Telegram: https://github.com/parashrautela/telegrambot/pull/4

Both PRs preserve frontend files. They are not merged or deployed. Review both
changes together. See `pilot-api-contract.md` for the exact requests, responses,
permissions, enums, dates, pagination, configuration, and limitations.

## Frontend developer's integration work

1. Create projects in Setup. Client assignment uses
   `POST /api/founder/projects/:id/client`.
2. Load `/api/founder/workflows`, then start the selected workflow with
   `POST /api/founder/projects/:id/workflow/start`. Setup cannot become active
   through a status PATCH before a client/workflow is assigned.
3. Use project `/workspace` and `/tasks` endpoints for real tasks; use task
   `/messages` for discussion. Task statuses include Completed and Cancelled.
4. Employees load `/api/employee/decision-requests` and use query `/comment`;
   founders use query `/approve`, `/reject`, and `/convert`.
5. Images use the staff-authenticated query `/attachments/:index` endpoint,
   using same-origin session cookies.
6. Preserve the existing explicit Publish confirmation. Supply a stable
   idempotencyKey for each final reply. A Failed delivery can retry; Unknown
   must show the error and require checking Telegram. Never auto-retry Unknown.
7. Use member DELETE/account disable endpoints for revocation. Full notification
   aggregation, Drive permission sync, and advanced scheduling remain deferred.

The bot still uses its one existing polling worker. Select its existing bot
workflow after approving the client; that stores ClientTelegramID. The web
pilot workflow creates separate internal coordination tasks, not synchronized
bot/Sheets schedules. For older bot projects without ClientTelegramID, backfill
only the confirmed approved client's ID before testing automatic capture.

## Deployment and live acceptance

Needed from Parash: pilot web-app URL and bot-service URL, plus confirmation of
which environment receives the reviewed PRs. No secrets need to be pasted in chat.
Verify the services have matching INTEGRATION_SHARED_SECRET, the bot has
WEB_APP_URL, and the web service has GROUP_BOT_TOKEN, BOT_BRIDGE_URL,
PUBLIC_URL (exact HTTPS origin), and DATABASE_URL. Keep one replica per service.
Bot startup ensures the additive Sheet sync columns; preserve production data.

After review/deployment, create a dummy project/client, start both required
workflows, send Telegram text and a photo from the assigned client, discuss as
two staff users, convert/assign/update a task, explicitly publish a final reply,
verify it in Telegram, refresh, and confirm access revocation. The automatic
retry queue covers requests already saved in Sheets; it does not add a durable
Telegram update inbox. Media is authenticated through a bounded proxy; separate
cloud archival is not implemented.

## Verified locally

- Six web-backend tests pass, including the mocked pilot core loop, persistent
  state/replies, uncertain delivery, media access/limits, and interrupted sends.
- Eleven tests pass on the isolated Telegram PR branch; syntax/workflow checks
  pass (42 template tasks).
- Original checkout: seven request/bridge tests and sixteen workspace/project
  tests pass. Frontend hashes match the pre-work baseline byte-for-byte.
- Live Telegram/Sheets, production PostgreSQL, and integrated UI acceptance are
  still pending. No bot polling, live external messages, merge, or deployment
  was started during this work.
