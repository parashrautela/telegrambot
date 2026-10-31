# Architecture and data ownership

## System boundaries

```text
Founder private chat ─┐
                     ├─ Telegram bot service ─ Google Sheets
Project groups ──────┘          │
                               │ authenticated HTTP
                               ▼
                        Workflow web service ─ PostgreSQL
                               │
                        React web interfaces

Separate local implementation:
React staff workspace ─ Local workspace HTTP service ─ SQLite
```

The bot service and production web service deploy independently. Their HTTP
integration uses a shared bearer secret kept on the servers. The SQLite workspace
is an independent local implementation with its own staff accounts and tasks.

## Bot source responsibilities

| Location                       | Responsibility                                                    |
| ------------------------------ | ----------------------------------------------------------------- |
| `src/index.js`                 | Stable production process entry                                   |
| `src/bot/application.js`       | Construct handlers, initialize Sheets, start polling and retries  |
| `src/bot/group-registry.js`    | Discover groups and synchronize their observed roster             |
| `src/bot/founder-assistant.js` | Private chat history and confirmable group-message drafts         |
| `src/bot/projects.js`          | Project summaries, IDs, workflow-choice messages                  |
| `src/bot/membership.js`        | Join/leave events, onboarding, role changes                       |
| `src/bot/resources.js`         | Resource requests, delivery, and uploaded resource intake         |
| `src/bot/group-commands.js`    | Team commands, task permissions, confirmable AI updates           |
| `src/bot/founder-commands.js`  | Founder commands and guided setup                                 |
| `src/bot/founder-callbacks.js` | Founder approval, onboarding, plan and message callbacks          |
| `src/projects/service.js`      | Project creation and workflow activation invariants               |
| `src/workflow/`                | Scheduling and dependency rules, templates and schema definitions |
| `src/storage/sheets.js`        | Sheets persistence and row mapping                                |
| `src/integrations/`            | External API calls, request intake/delivery, authenticated bridge |

Handlers receive the store and collaborators explicitly. Handler construction
does not start polling; `startBot()` owns startup. Conversation memory and pending
drafts remain in memory and expire on restart, as before.

## Record ownership

| Records                                                                | Authority                                            |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Bot operational task dates, dependency gates, onboarding               | Google Sheets                                        |
| Production web identities, sessions, internal discussion, query review | Web application's PostgreSQL state                   |
| Web projections of bot tasks                                           | Hydrated by the task adapter/synchronization modules |
| Local workspace accounts, checklists, messages, read positions         | Its own SQLite database                              |

Do not infer synchronization between records just because both applications call
them a project, task, or approval. The local checklist does not update the bot's
operational schedule. The production web app uses its explicit bot adapters.

## Important flows

1. A Telegram message enters the single group polling worker. A marked request or
   supported group message is captured in Sheets with a deterministic request ID.
   The delivery code sends it to the web app and records acknowledged delivery.
   The retry worker retries persisted unsynchronized requests.
2. A founder reviews a request in the production web app. Feature routes enforce
   access, update internal work, and use the bot bridge for supported operational
   changes and reviewed Telegram delivery.
3. The local workspace authenticates staff through hashed passwords and cookie
   sessions. Business operations use SQLite transactions and project membership
   checks. It exposes a separate `/api/workspace` contract.

## Deployment and compatibility

`src/index.js` and `work/production-web/backend/server.js` remain the process
entry points. The production web server continues to serve the built
`frontend/app.js` and `frontend/app.css`. Runtime file/database locations and
environment variable names were preserved during the restructuring.

The nested web repository must be supplied separately during handover. Do not
move or delete its `.git` directory to make it appear to be part of this repository.

## Existing limits and follow-up work

- The production web service loads most state into memory and saves it as one
  PostgreSQL JSON record. It assumes one writer. A move to relational tables and
  concurrent writers needs its own migration and compatibility plan.
- That service serializes HTTP requests. Long external calls can delay unrelated
  requests. Changing this safely requires revisiting shared-state rollback.
- The production web code expects bot routes, including task synchronization,
  task notices, and resource content, that this checkout's bridge does not yet
  implement. Tests with a mocked bridge do not establish service compatibility.
  Resolve the deployed bot version and these contracts before release.
- Google Sheets updates across multiple rows are not a database transaction.
  Keep one polling worker and preserve retry/audit behavior.
- The local workspace needs its own persistent SQLite volume and consistent
  backups if deployed. It is not a migration of the production application.

These are explicit engineering follow-ups, not claims solved by moving files.
