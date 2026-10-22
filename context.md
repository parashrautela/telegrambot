# Context

This bot branch implements the client-review backlog except Google sign-in, explicitly excluded by the user. Source changes are complete and tested locally.

Read [the implementation report](docs/client-review-implementation-2026-10-22.md) and [changes.md](changes.md) before continuing. Preserve legacy data and existing authentication. The companion repositories are `parashrautela/telegrambot` and `parashrautela/workflow-managment-`.

Release the bot before the web app because the web uses new bridge endpoints. Railway currently reports an upstream issue and paused deploys, so deployment and real Telegram acceptance remain outstanding. Do not replace production environment settings with local `.env` values.

Google sign-in is out of scope. Existing silent Telegram members need `/join` or verified ID recovery; complete enumeration is not available through the Bot API. Digest delivery requires each recipient to press Start, and uncertain sends must not be automatically retried.
