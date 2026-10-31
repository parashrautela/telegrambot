# Studio Iksha Operations

Telegram project operations and a companion workflow management application for
construction and interior teams.

**New here? Start with [the handover guide](docs/HANDOVER.md).**
It explains which application to change, how data flows, and how to verify a change.

## Applications

| Application           | Source                           | Data                     | Role                                                                   |
| --------------------- | -------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| Telegram bots         | `src/bot/`, entry `src/index.js` | Google Sheets            | Founder commands, project groups, onboarding, operational workflows    |
| Workflow web app      | `work/production-web/`           | PostgreSQL in production | Founder/staff/client interfaces, scheduling, discussions, query review |
| Local staff workspace | `src/workspace/` + `frontend/`   | SQLite                   | Separate local implementation and isolated demo                        |

The workflow web app is an **independent Git repository** checked out inside this
workspace. It has its own dependencies, CI, build, environment, and deployment.
Cloning this parent repository does not automatically clone that repository.
The local staff workspace is not a replacement for the production web app.

## Quick start

Use Node.js 22.13 or newer and npm. Install reproducible dependencies:

```sh
npm ci
npm --prefix frontend ci
```

For an isolated preview with temporary data and credentials:

```sh
npm run frontend:build
npm run workspace:demo
```

Open the URL printed by the demo. It does not load `.env`, poll Telegram, or
access Google Sheets.

For bot setup, copy `.env.example` to `.env` and follow the
[Telegram operations guide](docs/guides/telegram-operations.md). Run only one
polling instance per bot token. Sheet setup and seeding commands write real data.

For the independently checked-out web app:

```sh
npm --prefix work/production-web ci
npm run web:dev
```

Configure its own `.env` first; see its [README](work/production-web/README.md).

## Commands

| Command                | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `npm start`            | Start the bot using deployment environment variables   |
| `npm run start:local`  | Start the bot using the local `.env`                   |
| `npm run workspace`    | Start the persistent local workspace                   |
| `npm run frontend`     | Start the local workspace's Vite frontend              |
| `npm test`             | Run bot and local workspace tests                      |
| `npm run check`        | Check all server/script syntax and workflow invariants |
| `npm run verify`       | Run syntax checks, tests, and the local frontend build |
| `npm run format:check` | Check source and current documentation formatting      |
| `npm run format`       | Apply the repository's formatting rules                |
| `npm run web:verify`   | Verify the independently checked-out web app           |
| `npm run verify:all`   | Verify both repositories when both are installed       |

Tests use isolated fixtures and local HTTP servers. They do not require live
Telegram, Sheets, Google sign-in, or a production database.

## Source map

```text
src/
  index.js          Bot process entry point
  bot/              Startup wiring and Telegram handlers
  config/           Environment readers
  integrations/     Telegram, OpenAI, web bridge, request delivery
  projects/         Project creation and activation rules
  storage/          Google Sheets adapter
  workflow/         Templates, dependency scheduling, review rules
  workspace/        Local HTTP service, SQLite setup, business operations
frontend/src/
  features/workspace/  Local workspace API, dialogs, timeline, styles
  components/ui/       Shared UI primitives
scripts/            Setup, sample data, and verification commands
docs/               Handover, architecture, guides, and historical records
work/production-web/  Independent production web repository
```

Tests sit beside their modules as `*.test.js`; cross-service HTTP tests in the web
repository live in `backend/tests/`. Build outputs, credentials, databases, and
dependency folders are not source code to reorganize or hand-edit.

## Engineering references

- [Handover and first-day checklist](docs/HANDOVER.md)
- [Architecture and data ownership](docs/ARCHITECTURE.md)
- [Contribution conventions](CONTRIBUTING.md)
- [Documentation index](docs/README.md)
- [Production web architecture](work/production-web/docs/ARCHITECTURE.md)

Current scaling and integration limits are recorded in the architecture guides.
Repository organization does not remove those operational limits.
