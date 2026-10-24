# Context

This bot branch implements the client-review backlog except Google sign-in, explicitly excluded by the user. Source changes are complete and tested locally.

Read [the implementation report](docs/client-review-implementation-2026-10-22.md) and [changes.md](changes.md) before continuing. Preserve legacy data and existing authentication. The companion repositories are `parashrautela/telegrambot` and `parashrautela/workflow-managment-`.

Release the bot before the web app because the web uses new bridge endpoints. Railway currently reports an upstream issue and paused deploys, so deployment and real Telegram acceptance remain outstanding. Do not replace production environment settings with local `.env` values.

Google sign-in is out of scope. Existing silent Telegram members need `/join` or verified ID recovery; complete enumeration is not available through the Bot API. Digest delivery requires each recipient to press Start, and uncertain sends must not be automatically retried.

## Review and release handoff

- Web draft PR: https://github.com/parashrautela/workflow-managment-/pull/28 (implementation head `9b4a7da`; Vercel preview check succeeded).
- Bot draft PR: https://github.com/parashrautela/telegrambot/pull/17 (implementation head `92401e8`).
- Both PRs report clean merge state. No production merge or deployment was made. Railway reports deployments paused during an upstream issue.
- Next release action: deploy the bot, then the web, then perform the real Telegram acceptance checks. Google sign-in remains excluded.


## 2026-10-24 — task shares and meeting notifications

Added authenticated task-notice transport for the web communication/meeting release. It verifies active project recipients, sends safe text mentions and optional image/PDF uploads as multipart documents, uses bounded requests and reports partial failure without claiming delivery. Private Start registration now supports project participants for meeting notifications; digest staff behavior remains. 77 bot tests pass, including safe mentions, multipart files, departed recipients and partial failure. Production publication pending; release this bot before the companion web app. No real messages were sent during validation.
