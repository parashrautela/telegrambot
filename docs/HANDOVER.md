# Engineering handover

## Read these first

1. [Root README](../README.md): applications, commands, and source map.
2. [Architecture](ARCHITECTURE.md): record ownership and integration boundaries.
3. [Production web README](../work/production-web/README.md): the deployed workflow application's setup.
4. [Contributing](../CONTRIBUTING.md): change and verification conventions.

The repository contains existing product work in both Git checkouts. Review
`git status` in each before staging. The production web checkout has its own
history and must be handed over or cloned separately.

## First hour

Use Node 22.13+ and install with the committed lockfiles:

```sh
npm ci
npm --prefix frontend ci
npm run verify
npm run format:check
```

Install and verify the production web checkout separately:

```sh
cd work/production-web
npm ci
npm run verify
npm run format:check
```

These checks use temporary data and mock external services. They do not confirm
live service credentials or deployment compatibility.

To see a safe local example, run `npm run frontend:build` and
`npm run workspace:demo` from the parent repository. Use the temporary credentials
printed by the demo. This preview belongs to the local workspace implementation.

## Where to make a change

| Change                                          | Start here                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| Founder Telegram commands or callback buttons   | `src/bot/founder-commands.js`, `founder-callbacks.js`                     |
| Team Telegram commands and confirmation flow    | `src/bot/group-commands.js`                                               |
| Group discovery or role assignment              | `src/bot/group-registry.js`, `src/bot/membership.js`                      |
| Workflow activation rules                       | `src/projects/service.js`                                                 |
| Operational task dependencies or schedule rules | `src/workflow/engine.js`                                                  |
| Sheets columns or templates                     | `src/workflow/schema.js`, `src/storage/sheets.js`                         |
| Bot/web request delivery                        | `src/integrations/decision-requests.js`, `src/integrations/web-bridge.js` |
| Production web feature                          | Its `backend/<feature>/` and `frontend/src/features/<feature>/`           |
| Local workspace API or SQLite setup             | `src/workspace/server.js`, `store.js`, `database.js`                      |
| Local workspace interface                       | `frontend/src/features/workspace/Workspace.tsx`                           |

## Before a production release

Confirm which deployed repositories and revisions own the bot and web service.
Verify the bot bridge endpoints required by the web feature against the real bot
version; several are missing in this local bot checkout. Validate real Google
sign-in, project access, Telegram delivery, and persistent storage in staging.

Keep one polling instance for each bot token and one writer for the current
production web state store. Back up data before schema or deployment changes.
The production web app needs PostgreSQL; the local workspace needs a persistent
SQLite volume if it is ever deployed.

The source restructuring does not change production data or deploy a release.
Never use a second production polling worker as a local smoke test.

## Historical material

Current setup and architecture documents take precedence over planning notes.
`docs/archive/` keeps prior change/context records, `docs/plans/` keeps product
plans, and `docs/references/` keeps original reference documents. The
[documentation index](README.md) separates these from current operating guides.
